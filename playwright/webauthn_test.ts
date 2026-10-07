import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { type BrowserContext, chromium } from "playwright-core";
import { LmsAuthenticationStorageError } from "../core/out_port.ts";
import { createVirtualAuthenticator, readStoredCredentialSources, registerWebAuthnCredential } from "./webauthn.ts";

const origin = "https://slink.secioss.com";
const username = "test@kogakuin.ac.jp";
const createOptions = {
    publicKey: {
        challenge: Array.from({ length: 32 }, (_, index) => index),
        rp: { id: "slink.secioss.com", name: "Test" },
        user: { id: [1, 2, 3], name: username, displayName: "Test" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
    },
};

Deno.test("Virtual WebAuthn credential sources survive browser restart and page reuse with signature counters", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/webauthn-credential-sources.json`;
    try {
        const browser = await chromium.launch({ channel: "chrome", headless: true });
        try {
            const context = await browser.newContext();
            await context.route(
                `${origin}/**`,
                (route) => route.fulfill({ body: "<!doctype html><title>WebAuthn test</title>" }),
            );
            const page = await context.newPage();
            const authenticator = await Effect.runPromise(createVirtualAuthenticator(page));
            await page.goto(origin);
            await page.evaluate(async (options) => {
                await navigator.credentials.create({
                    publicKey: {
                        ...options.publicKey,
                        challenge: new Uint8Array(options.publicKey.challenge),
                        user: { ...options.publicKey.user, id: new Uint8Array(options.publicKey.user.id) },
                        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
                        authenticatorSelection: { residentKey: "required", userVerification: "required" },
                    },
                });
            }, createOptions);
            await Effect.runPromise(authenticator.saveCredentialSources(path, username));
            await Effect.runPromise(authenticator.close);
        } finally {
            await browser.close();
        }
        const storedCredentialSources = await Effect.runPromise(readStoredCredentialSources(path));
        assert(storedCredentialSources);
        assertEquals(storedCredentialSources.username, username);
        assertEquals(storedCredentialSources.credentials.length, 1);
        const credentialSource = storedCredentialSources.credentials[0];
        assertEquals(credentialSource.isResidentCredential, true);
        assertEquals(credentialSource.rpId, createOptions.publicKey.rp.id);
        assertEquals(
            Array.from(Uint8Array.from(atob(credentialSource.userHandle!), (char) => char.charCodeAt(0))),
            createOptions.publicKey.user.id,
        );
        const restarted = await chromium.launch({ channel: "chrome", headless: true });
        try {
            const context = await restarted.newContext();
            await context.route(
                `${origin}/**`,
                (route) => route.fulfill({ body: "<!doctype html><title>WebAuthn test</title>" }),
            );
            const page = await context.newPage();
            let authenticator = await Effect.runPromise(createVirtualAuthenticator(page, storedCredentialSources));
            await page.goto(origin);
            // A discoverable credential also works without an allowCredentials list.
            let signatureCounter = credentialSource.signCount;
            for (const credentialId of [credentialSource.credentialId, undefined]) {
                const authenticationResult = await page.evaluate(async (credentialId) => {
                    const credential = await navigator.credentials.get({
                        publicKey: {
                            challenge: crypto.getRandomValues(new Uint8Array(32)),
                            rpId: "slink.secioss.com",
                            allowCredentials: credentialId
                                ? [{
                                    type: "public-key",
                                    id: Uint8Array.from(atob(credentialId), (char) => char.charCodeAt(0)),
                                }]
                                : [],
                            userVerification: "required",
                        },
                    }) as PublicKeyCredential;
                    const response = credential.response as AuthenticatorAssertionResponse;
                    const data = new Uint8Array(response.authenticatorData);
                    return {
                        id: credential.id,
                        userHandle: Array.from(new Uint8Array(response.userHandle!)),
                        flags: data[32],
                        signCount: new DataView(data.buffer).getUint32(33),
                    };
                }, credentialId);
                assert(authenticationResult.flags & 1, "The UP flag must indicate simulated user presence.");
                assert(authenticationResult.flags & 4, "The UV flag must indicate simulated user verification.");
                assertEquals(authenticationResult.userHandle, createOptions.publicKey.user.id);
                assertEquals(
                    authenticationResult.id,
                    credentialSource.credentialId.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
                );
                assert(authenticationResult.signCount > signatureCounter);
                signatureCounter = authenticationResult.signCount;
                await Effect.runPromise(authenticator.saveCredentialSources(path, username));
                const updated = await Effect.runPromise(readStoredCredentialSources(path));
                assert(updated);
                assertEquals(updated.credentials[0].privateKey, credentialSource.privateKey);
                assertEquals(updated.credentials[0].signCount, authenticationResult.signCount);
                await Effect.runPromise(authenticator.close);
                authenticator = await Effect.runPromise(createVirtualAuthenticator(page, updated));
            }
            await Effect.runPromise(authenticator.close);
        } finally {
            await restarted.close();
        }
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("Invalid stored WebAuthn credential sources report a storage error without exposing secret values", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/webauthn-credential-sources.json`;
    try {
        assertEquals(await Effect.runPromise(readStoredCredentialSources(path)), undefined);
        for (
            const contents of [
                "not JSON",
                JSON.stringify({ version: 1, username, credentials: [] }),
                JSON.stringify({ version: 1, username, credentials: [{ privateKey: "DO_NOT_EXPOSE" }] }),
            ]
        ) {
            await Deno.writeTextFile(path, contents);
            const error = await assertRejects(
                () => Effect.runPromise(readStoredCredentialSources(path)),
                LmsAuthenticationStorageError,
            );
            assert(!error.message.includes("DO_NOT_EXPOSE"));
        }
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

const settingsUrl = `${origin}/user/?app=u2fregister`;

async function fixture(context: BrowserContext, path: string) {
    let registered = false;
    let label = "";
    await context.route(settingsUrl, async (route) => {
        const data = new URLSearchParams(route.request().postData() ?? "");
        if (data.get("operation") === "register") {
            // The credential source must already be durable when the RP receives the registration response.
            const storedCredentialSources = await Effect.runPromise(readStoredCredentialSources(path));
            assert(storedCredentialSources);
            assertEquals(storedCredentialSources.username, username);
            registered = true;
        }
        if (data.get("operation") === "update") {
            assertEquals(data.get("id"), "new-registration");
            label = data.get("label") ?? "";
        }
        await route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html>
            <h1>FIDO認証デバイスの設定</h1><p>ログインID: ${username}</p>
            <form method="post" id="register">
                <input name="operation" id="operation" type="hidden">
                <input name="id" id="id" type="hidden">
                <input name="label" id="label" type="hidden">
                <table id="datatable"><tbody>
                    <tr><td>Existing registration<input name="ids[]" value="" type="hidden"><input id="id_0" value="existing-registration" type="hidden"></td></tr>
                    ${
                registered
                    ? `<tr><td><span>${label}</span><input name="ids[]" value="" type="hidden"><input id="id_1" value="new-registration" type="hidden">
                    <button class="js-u2f-edit" type="button" onclick="document.getElementById('dialog').hidden=false">Edit</button></td></tr>`
                    : ""
            }
                </tbody></table>
                <button id="create_button" type="button">登録</button>
            </form>
            <div id="dialog" hidden><input id="prompt"><button type="button" onclick="document.getElementById('operation').value='update';document.getElementById('id').value='new-registration';document.getElementById('label').value=document.getElementById('prompt').value;document.getElementById('register').submit()">更新</button></div>
            <script>
                document.getElementById('create_button').onclick = async () => {
                    const options = ${JSON.stringify(createOptions)};
                    options.publicKey.challenge = new Uint8Array(options.publicKey.challenge);
                    options.publicKey.user.id = new Uint8Array(options.publicKey.user.id);
                    await navigator.credentials.create(options);
                    document.getElementById('operation').value = 'register';
                    document.getElementById('register').submit();
                };
            </script>`,
        });
    });
    return () => ({ registered, label });
}

Deno.test("WebAuthn registration persists the credential source before submission and labels only the new registration", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/webauthn-credential-sources.json`;
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const context = await browser.newContext();
        const result = await fixture(context, path);
        const page = await context.newPage();
        const authenticator = await Effect.runPromise(createVirtualAuthenticator(page));
        await Effect.runPromise(registerWebAuthnCredential(page, path, authenticator));
        assertEquals(result(), { registered: true, label: "KU-POTATO (Playwright)" });
        assertEquals(await page.locator("#datatable tbody tr").first().innerText(), "Existing registration");
    } finally {
        await browser.close();
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("WebAuthn registration aborts the server submission if its credential source cannot be saved", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/unwritable.json`;
    await Deno.mkdir(path);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const context = await browser.newContext();
        const result = await fixture(context, path);
        const page = await context.newPage();
        page.setDefaultTimeout(1500);
        const authenticator = await Effect.runPromise(createVirtualAuthenticator(page));
        const error = await assertRejects(
            () => Effect.runPromise(registerWebAuthnCredential(page, path, authenticator)),
            LmsAuthenticationStorageError,
        );
        assertEquals(error.operation, "save credential sources");
        assertEquals(result().registered, false);
    } finally {
        await browser.close();
        await Deno.remove(directory, { recursive: true });
    }
});
