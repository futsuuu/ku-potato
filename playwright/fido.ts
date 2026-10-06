import { Effect, Schema } from "effect";
import type { Page } from "playwright-core";
import { LmsAuthenticationStorageError, LmsSourceGatewayError } from "../core/out_port.ts";
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
    return yield* Schema.decodeEffect(FidoStateJson)(contents).pipe(
        Effect.mapError(() =>
            new LmsAuthenticationStorageError({
                operation: "read FIDO credentials",
                message: "保存済みのFIDO認証情報が不正です。",
            })
        ),
    );
});

/** CDP authenticator state is independent of Playwright's cookies and local storage. */
export const createVirtualAuthenticator = Effect.fn("PlaywrightBrowser.createVirtualAuthenticator")(function* (
    page: Page,
    state?: FidoState,
) {
    const cdp = yield* tryPromise("create virtual FIDO authenticator", () => page.context().newCDPSession(page));
    yield* tryPromise("enable WebAuthn", () => cdp.send("WebAuthn.enable"));
    const { authenticatorId } = yield* tryPromise(
        "create virtual FIDO authenticator",
        () =>
            cdp.send("WebAuthn.addVirtualAuthenticator", {
                options: {
                    protocol: "ctap2",
                    transport: "usb",
                    hasResidentKey: true,
                    hasUserVerification: true,
                    isUserVerified: true,
                    automaticPresenceSimulation: true,
                },
            }),
    );
    for (const credential of state?.credentials ?? []) {
        yield* tryPromise(
            "restore FIDO credential",
            () => cdp.send("WebAuthn.addCredential", { authenticatorId, credential }),
        );
    }
    return {
        save: Effect.fn("PlaywrightBrowser.saveFidoCredentials")(function* (path: string, username: string) {
            const { credentials } = yield* authenticationStorageTry(
                "save FIDO credentials",
                () => cdp.send("WebAuthn.getCredentials", { authenticatorId }),
            );
            const contents = yield* Schema.decodeUnknownEffect(FidoState)({ version: 1, username, credentials }).pipe(
                Effect.flatMap(Schema.encodeEffect(FidoStateJson)),
                Effect.mapError(() =>
                    new LmsAuthenticationStorageError({
                        operation: "save FIDO credentials",
                        message: "仮想FIDO認証器から取得した認証情報が不正です。",
                    })
                ),
            );
            yield* writeAuthenticationFile(path, contents);
        }),
    };
});
export type VirtualAuthenticator = Effect.Success<ReturnType<typeof createVirtualAuthenticator>>;

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
    const text = yield* tryPromise("read FIDO account", () => page.locator("body").innerText());
    const username = text.match(/ログインID:\s*([^\s]+)/)?.[1];
    if (!username) {
        return yield* new LmsSourceGatewayError({
            operation: "read FIDO account",
            message: "FIDO設定画面のログインIDが見つかりません。",
        });
    }
    const rows = page.locator("#datatable tbody tr");
    const existingIds = yield* tryPromise(
        "read registered FIDO devices",
        () =>
            rows.locator("input[id^='id_']").evaluateAll((inputs) =>
                inputs.map((input) => (input as HTMLInputElement).value)
            ),
    );
    const url = page.url();
    const context = yield* Effect.context<never>();
    let storageFailure: LmsAuthenticationStorageError | undefined;
    const interceptRegistration = (route: import("playwright-core").Route) =>
        Effect.runPromiseWith(context)(Effect.gen(function* () {
            if (new URLSearchParams(route.request().postData() ?? "").get("operation") === "register") {
                const saved = yield* Effect.result(authenticator.save(path, username));
                if (saved._tag === "Failure") {
                    storageFailure = new LmsAuthenticationStorageError({
                        operation: "save FIDO credentials",
                        message: "FIDO認証情報を保存できなかったため、登録を中止しました。",
                    });
                    yield* tryPromise("abort FIDO registration", () => route.abort());
                    return;
                }
            }
            yield* tryPromise("continue FIDO registration", () => route.fallback());
        }));
    yield* tryPromise("protect FIDO registration", () => page.route(url, interceptRegistration));
    const registration = yield* Effect.result(Effect.gen(function* () {
        const [result] = yield* tryPromise("register FIDO device", () =>
            Promise.all([
                page.waitForResponse((response) =>
                    response.url() === url &&
                    new URLSearchParams(response.request().postData() ?? "").get("operation") === "register"
                ),
                page.locator("#create_button").click(),
            ]));
        if (!result.ok()) {
            return yield* new LmsSourceGatewayError({
                operation: "register FIDO device",
                message: "FIDO認証デバイスの登録が拒否されました。",
            });
        }
        yield* tryPromise("register FIDO device", () =>
            page.waitForFunction(
                (existingIds) =>
                    [...document.querySelectorAll<HTMLInputElement>("#datatable input[id^='id_']")]
                        .some((input) => !existingIds.includes(input.value)),
                existingIds,
            ));
        const ids = yield* tryPromise(
            "register FIDO device",
            () =>
                rows.locator("input[id^='id_']").evaluateAll((inputs) =>
                    inputs.map((input) => (input as HTMLInputElement).value)
                ),
        );
        const index = ids.findIndex((id) => !existingIds.includes(id));
        if (index === -1) {
            return yield* new LmsSourceGatewayError({
                operation: "register FIDO device",
                message: "登録したFIDO認証デバイスを確認できません。",
            });
        }
        yield* tryPromise("register FIDO device", () => rows.nth(index).locator(".js-u2f-edit").click());
        yield* tryPromise("register FIDO device", () => page.locator("#prompt").fill("KU-POTATO (Playwright)"));
        yield* tryPromise(
            "register FIDO device",
            () => page.getByRole("button", { name: "更新", exact: true }).click(),
        );
        yield* tryPromise(
            "register FIDO device",
            () => page.locator("#datatable").getByText("KU-POTATO (Playwright)", { exact: true }).waitFor(),
        );
    }));
    yield* tryPromise("remove FIDO registration interception", () => page.unroute(url, interceptRegistration));
    if (storageFailure) return yield* storageFailure;
    if (registration._tag === "Failure") return yield* registration.failure;
    yield* authenticator.save(path, username);
});
