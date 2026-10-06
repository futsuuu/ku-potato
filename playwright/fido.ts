import { Effect, Schema } from "effect";
import type { Page } from "playwright-core";
import { LmsAuthenticationStorageError } from "../core/out_port.ts";
import {
    authenticationStorageTry,
    parentDirectory,
    readOptionalFile,
    writeAuthenticationFile,
} from "./authentication_storage.ts";
import { tryPromise } from "./promise.ts";

const Credential = Schema.Struct({
    credentialId: Schema.NonEmptyString,
    isResidentCredential: Schema.Boolean,
    rpId: Schema.NonEmptyString,
    privateKey: Schema.NonEmptyString,
    userHandle: Schema.optional(Schema.String),
    signCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    backupEligibility: Schema.optional(Schema.Boolean),
    backupState: Schema.optional(Schema.Boolean),
});

const FidoState = Schema.Struct({
    version: Schema.Literal(1),
    username: Schema.NonEmptyString,
    credentials: Schema.Array(Credential).check(Schema.isMinLength(1)),
});
export type FidoState = typeof FidoState.Type;
const FidoStateJson = Schema.fromJsonString(FidoState);
export const fidoStoragePath = (storageStatePath: string) => `${parentDirectory(storageStatePath)}/fido.json`;

export const readFidoState = Effect.fn("PlaywrightBrowser.readFidoState")(function* (path: string) {
    const contents = yield* authenticationStorageTry("read FIDO credentials", () => readOptionalFile(path));
    if (contents === undefined) return undefined;
    // Schema errors can include private keys. Keep their values out of diagnostics.
    return yield* Schema.decodeUnknownEffect(FidoStateJson)(contents).pipe(
        Effect.mapError(() =>
            new LmsAuthenticationStorageError({
                operation: "read FIDO credentials",
                message: "保存済みのFIDO認証情報が不正です。",
            })
        ),
    );
});

/** CDP authenticator state is independent of Playwright's cookies and local storage. */
export async function createVirtualAuthenticator(page: Page, state?: FidoState) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "usb",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    for (const credential of state?.credentials ?? []) {
        await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
    }
    return {
        async save(path: string, username: string) {
            const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
            const contents = await Effect.runPromise(
                Schema.decodeUnknownEffect(FidoState)({ version: 1, username, credentials }).pipe(
                    Effect.flatMap(Schema.encodeEffect(FidoStateJson)),
                    Effect.mapError(() => new Error("仮想FIDO認証器から取得した認証情報が不正です。")),
                ),
            );
            await writeAuthenticationFile(path, contents);
        },
    };
}
export type VirtualAuthenticator = Awaited<ReturnType<typeof createVirtualAuthenticator>>;

/** Persists the new private key before allowing its registration to reach the server. */
export const registerFido = Effect.fn("PlaywrightBrowser.registerFido")(function* (
    page: Page,
    path: string,
    authenticator: VirtualAuthenticator,
) {
    yield* tryPromise("open FIDO settings", () => page.goto("https://slink.secioss.com/user/?app=u2fregister"));
    yield* tryPromise(
        "verify FIDO settings",
        () => page.getByRole("heading", { name: "FIDO認証デバイスの設定" }).waitFor(),
    );
    const username = yield* tryPromise("read FIDO account", async () => {
        const text = await page.locator("body").innerText();
        const username = text.match(/ログインID:\s*([^\s]+)/)?.[1];
        if (!username) throw new Error("FIDO設定画面のログインIDが見つかりません。");
        return username;
    });
    const rows = page.locator("#datatable tbody tr");
    const existingIds = yield* tryPromise(
        "read registered FIDO devices",
        () =>
            rows.locator("input[id^='id_']").evaluateAll((inputs) =>
                inputs.map((input) => (input as HTMLInputElement).value)
            ),
    );
    const url = page.url();
    let storageFailure: LmsAuthenticationStorageError | undefined;
    const interceptRegistration = async (route: import("playwright-core").Route) => {
        if (new URLSearchParams(route.request().postData() ?? "").get("operation") === "register") {
            try {
                await authenticator.save(path, username);
            } catch {
                storageFailure = new LmsAuthenticationStorageError({
                    operation: "save FIDO credentials",
                    message: "FIDO認証情報を保存できなかったため、登録を中止しました。",
                });
                await route.abort();
                return;
            }
        }
        await route.fallback();
    };
    yield* tryPromise("protect FIDO registration", () => page.route(url, interceptRegistration));
    const registration = yield* Effect.result(tryPromise("register FIDO device", async () => {
        const [result] = await Promise.all([
            page.waitForResponse((response) =>
                response.url() === url &&
                new URLSearchParams(response.request().postData() ?? "").get("operation") === "register"
            ),
            page.locator("#create_button").click(),
        ]);
        if (!result.ok()) throw new Error("FIDO認証デバイスの登録が拒否されました。");
        await page.waitForFunction(
            (existingIds) =>
                [...document.querySelectorAll<HTMLInputElement>("#datatable input[id^='id_']")]
                    .some((input) => !existingIds.includes(input.value)),
            existingIds,
        );
        const ids = await rows.locator("input[id^='id_']").evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
        );
        const index = ids.findIndex((id) => !existingIds.includes(id));
        if (index === -1) throw new Error("登録したFIDO認証デバイスを確認できません。");
        await rows.nth(index).locator(".js-u2f-edit").click();
        await page.locator("#prompt").fill("KU-POTATO (Playwright)");
        await page.getByRole("button", { name: "更新", exact: true }).click();
        await page.locator("#datatable").getByText("KU-POTATO (Playwright)", { exact: true }).waitFor();
    }));
    yield* tryPromise("remove FIDO registration interception", () => page.unroute(url, interceptRegistration));
    if (storageFailure) return yield* storageFailure;
    if (registration._tag === "Failure") return yield* registration.failure;
    yield* authenticationStorageTry("save FIDO credentials", () => authenticator.save(path, username));
});
