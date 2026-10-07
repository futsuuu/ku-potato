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

/** Credential sources in CDP's WebAuthn.Credential format, including credential private keys. */
// CDP represents the binary credentialId, privateKey (PKCS#8), and userHandle as base64 strings.
const CredentialSource = Schema.Struct({
    credentialId: Schema.NonEmptyString,
    // CDP's legacy name for a client-side discoverable credential.
    isResidentCredential: Schema.Boolean,
    rpId: Schema.NonEmptyString,
    privateKey: Schema.NonEmptyString,
    userHandle: Schema.optional(Schema.String),
    signCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    backupEligibility: Schema.optional(Schema.Boolean),
    backupState: Schema.optional(Schema.Boolean),
});

/** The portal login name and serialized credential sources used for automatic WebAuthn login. */
const StoredCredentialSources = Schema.Struct({
    version: Schema.Literal(1),
    // A Secioss login name, independent of the opaque WebAuthn userHandle.
    username: Schema.NonEmptyString,
    credentials: Schema.Array(CredentialSource).check(Schema.isMinLength(1)),
});
export type StoredCredentialSources = typeof StoredCredentialSources.Type;
const StoredCredentialSourcesJson = Schema.fromJsonString(StoredCredentialSources);
export const credentialSourcesStoragePath = (storageStatePath: string) =>
    `${parentDirectory(storageStatePath)}/webauthn-credential-sources.json`;

export const readStoredCredentialSources = Effect.fn("PlaywrightBrowser.readStoredCredentialSources")(
    function* (path: string) {
        const contents = yield* authenticationStorageTry(
            "read credential sources",
            () => readOptionalFile(path),
        );
        if (contents === undefined) return undefined;
        // Schema errors can include private keys. Keep their values out of diagnostics.
        return yield* Schema.decodeEffect(StoredCredentialSourcesJson)(contents).pipe(
            Effect.mapError(() =>
                new LmsAuthenticationStorageError({
                    operation: "read credential sources",
                    message: "保存済みのWebAuthnクレデンシャルソースが不正です。",
                })
            ),
        );
    },
);

/** Credential sources in the virtual authenticator are independent of Playwright's cookies and local storage. */
export const createVirtualAuthenticator = Effect.fn("PlaywrightBrowser.createVirtualAuthenticator")(function* (
    page: Page,
    storedCredentialSources?: StoredCredentialSources,
) {
    const cdp = yield* tryPromise("create virtual WebAuthn authenticator", () => page.context().newCDPSession(page));
    yield* tryPromise("enable WebAuthn", () => cdp.send("WebAuthn.enable"));
    const { authenticatorId } = yield* tryPromise(
        "create virtual WebAuthn authenticator",
        () =>
            cdp.send("WebAuthn.addVirtualAuthenticator", {
                options: {
                    protocol: "ctap2",
                    transport: "usb",
                    hasResidentKey: true,
                    hasUserVerification: true,
                    // Simulate successful user verification and user presence for automation.
                    isUserVerified: true,
                    automaticPresenceSimulation: true,
                },
            }),
    );
    for (const credentialSource of storedCredentialSources?.credentials ?? []) {
        yield* tryPromise(
            "restore WebAuthn credential source",
            () => cdp.send("WebAuthn.addCredential", { authenticatorId, credential: credentialSource }),
        );
    }
    return {
        close: tryPromise(
            "remove virtual WebAuthn authenticator",
            () => cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }),
        ).pipe(
            Effect.asVoid,
            Effect.ensuring(
                tryPromise("detach WebAuthn session", () => cdp.detach()).pipe(Effect.catch(Effect.logError)),
            ),
        ),
        saveCredentialSources: Effect.fn("PlaywrightBrowser.saveCredentialSources")(
            function* (path: string, username: string) {
                const { credentials: credentialSources } = yield* authenticationStorageTry(
                    "save credential sources",
                    () => cdp.send("WebAuthn.getCredentials", { authenticatorId }),
                );
                const contents = yield* Schema.decodeUnknownEffect(StoredCredentialSources)({
                    version: 1,
                    username,
                    credentials: credentialSources,
                }).pipe(
                    Effect.flatMap(Schema.encodeEffect(StoredCredentialSourcesJson)),
                    Effect.mapError(() =>
                        new LmsAuthenticationStorageError({
                            operation: "save credential sources",
                            message: "仮想認証器から取得したWebAuthnクレデンシャルソースが不正です。",
                        })
                    ),
                );
                yield* writeAuthenticationFile(path, contents);
            },
        ),
    };
});
export type VirtualAuthenticator = Effect.Success<ReturnType<typeof createVirtualAuthenticator>>;

/** Registers a WebAuthn credential with Secioss; persists its credential source before submitting the response. */
export const registerWebAuthnCredential = Effect.fn("PlaywrightBrowser.registerWebAuthnCredential")(function* (
    page: Page,
    path: string,
    authenticator: VirtualAuthenticator,
) {
    yield* tryPromise(
        "open WebAuthn credential settings",
        () => page.goto("https://slink.secioss.com/user/?app=u2fregister"),
    );
    yield* tryPromise(
        "verify WebAuthn credential settings",
        () => page.getByRole("heading", { name: "FIDO認証デバイスの設定" }).waitFor(),
    );
    const text = yield* tryPromise("read portal username", () => page.locator("body").innerText());
    const username = text.match(/ログインID:\s*([^\s]+)/)?.[1];
    if (!username) {
        return yield* new LmsSourceGatewayError({
            operation: "read portal username",
            message: "FIDO設定画面のログインIDが見つかりません。",
        });
    }
    const rows = page.locator("#datatable tbody tr");
    // These are Secioss registration record IDs, not WebAuthn credential IDs or authenticator IDs.
    const existingRegistrationIds = yield* tryPromise(
        "read WebAuthn credential registrations",
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
                const saved = yield* Effect.result(authenticator.saveCredentialSources(path, username));
                if (saved._tag === "Failure") {
                    storageFailure = new LmsAuthenticationStorageError({
                        operation: "save credential sources",
                        message: "WebAuthnクレデンシャルソースを保存できなかったため、登録を中止しました。",
                    });
                    yield* tryPromise("abort WebAuthn credential registration", () => route.abort());
                    return;
                }
            }
            yield* tryPromise("continue WebAuthn credential registration", () => route.fallback());
        }));
    yield* tryPromise("protect WebAuthn credential registration", () => page.route(url, interceptRegistration));
    const registration = yield* Effect.result(Effect.gen(function* () {
        const [result] = yield* tryPromise("register WebAuthn credential", () =>
            Promise.all([
                page.waitForResponse((response) =>
                    response.url() === url &&
                    new URLSearchParams(response.request().postData() ?? "").get("operation") === "register"
                ),
                page.locator("#create_button").click(),
            ]));
        if (!result.ok()) {
            return yield* new LmsSourceGatewayError({
                operation: "register WebAuthn credential",
                message: "WebAuthnクレデンシャルの登録が拒否されました。",
            });
        }
        yield* tryPromise("register WebAuthn credential", () =>
            page.waitForFunction(
                (existingRegistrationIds) =>
                    [...document.querySelectorAll<HTMLInputElement>("#datatable input[id^='id_']")]
                        .some((input) => !existingRegistrationIds.includes(input.value)),
                existingRegistrationIds,
            ));
        const registrationIds = yield* tryPromise(
            "register WebAuthn credential",
            () =>
                rows.locator("input[id^='id_']").evaluateAll((inputs) =>
                    inputs.map((input) => (input as HTMLInputElement).value)
                ),
        );
        const index = registrationIds.findIndex((id) => !existingRegistrationIds.includes(id));
        if (index === -1) {
            return yield* new LmsSourceGatewayError({
                operation: "register WebAuthn credential",
                message: "登録したWebAuthnクレデンシャルを確認できません。",
            });
        }
        yield* tryPromise("register WebAuthn credential", () => rows.nth(index).locator(".js-u2f-edit").click());
        yield* tryPromise("register WebAuthn credential", () => page.locator("#prompt").fill("KU-POTATO (Playwright)"));
        yield* tryPromise(
            "register WebAuthn credential",
            () => page.getByRole("button", { name: "更新", exact: true }).click(),
        );
        yield* tryPromise(
            "register WebAuthn credential",
            () => page.locator("#datatable").getByText("KU-POTATO (Playwright)", { exact: true }).waitFor(),
        );
    }));
    yield* tryPromise(
        "remove WebAuthn credential registration interception",
        () => page.unroute(url, interceptRegistration),
    );
    if (storageFailure) return yield* storageFailure;
    if (registration._tag === "Failure") return yield* registration.failure;
    yield* authenticator.saveCredentialSources(path, username);
});
