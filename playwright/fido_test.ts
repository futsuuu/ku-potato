import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { type BrowserContext, chromium } from "playwright-core";
import { LmsAuthenticationStorageError } from "../core/out_port.ts";
import { createVirtualAuthenticator, readFidoState, registerFido } from "./fido.ts";

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

Deno.test("Virtual FIDO keys survive a browser restart and preserve increasing signature counters", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/fido.json`;
    try {
        const browser = await chromium.launch({ channel: "chrome", headless: true });
        try {
            const context = await browser.newContext();
            await context.route(
                `${origin}/**`,
                (route) => route.fulfill({ body: "<!doctype html><title>FIDO test</title>" }),
            );
            const page = await context.newPage();
            const authenticator = await createVirtualAuthenticator(page);
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
            await authenticator.save(path, username);
        } finally {
            await browser.close();
        }
        const state = await Effect.runPromise(readFidoState(path));
        assert(state);
        const restarted = await chromium.launch({ channel: "chrome", headless: true });
        try {
            const context = await restarted.newContext();
            await context.route(
                `${origin}/**`,
                (route) => route.fulfill({ body: "<!doctype html><title>FIDO test</title>" }),
            );
            const page = await context.newPage();
            const authenticator = await createVirtualAuthenticator(page, state);
            await page.goto(origin);
            const assertion = await page.evaluate(async (credentialId) => {
                const credential = await navigator.credentials.get({
                    publicKey: {
                        challenge: crypto.getRandomValues(new Uint8Array(32)),
                        rpId: "slink.secioss.com",
                        allowCredentials: [{
                            type: "public-key",
                            id: Uint8Array.from(atob(credentialId), (char) => char.charCodeAt(0)),
                        }],
                        userVerification: "required",
                    },
                }) as PublicKeyCredential;
                const data = new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData);
                return { id: credential.id, flags: data[32], signCount: new DataView(data.buffer).getUint32(33) };
            }, state.credentials[0].credentialId);
            assert(assertion.flags & 1, "User presence must be verified.");
            assert(assertion.flags & 4, "User verification must succeed.");
            assertEquals(
                assertion.id,
                state.credentials[0].credentialId.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
            );
            assert(assertion.signCount > state.credentials[0].signCount);
            await authenticator.save(path, username);
            const updated = await Effect.runPromise(readFidoState(path));
            assert(updated);
            assertEquals(updated.credentials[0].privateKey, state.credentials[0].privateKey);
            assertEquals(updated.credentials[0].signCount, assertion.signCount);
        } finally {
            await restarted.close();
        }
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("Invalid FIDO state reports a storage error without exposing secret values", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/fido.json`;
    try {
        assertEquals(await Effect.runPromise(readFidoState(path)), undefined);
        for (
            const contents of [
                "not JSON",
                JSON.stringify({ version: 1, username, credentials: [] }),
                JSON.stringify({ version: 1, username, credentials: [{ privateKey: "DO_NOT_EXPOSE" }] }),
            ]
        ) {
            await Deno.writeTextFile(path, contents);
            const error = await assertRejects(
                () => Effect.runPromise(readFidoState(path)),
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
            // The key must already be durable when the server receives the registration.
            const state = await Effect.runPromise(readFidoState(path));
            assert(state);
            assertEquals(state.username, username);
            registered = true;
        }
        if (data.get("operation") === "update") {
            assertEquals(data.get("id"), "new-device");
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
                    <tr><td>Existing device<input name="ids[]" value="" type="hidden"><input id="id_0" value="existing-device" type="hidden"></td></tr>
                    ${
                registered
                    ? `<tr><td><span>${label}</span><input name="ids[]" value="" type="hidden"><input id="id_1" value="new-device" type="hidden">
                    <button class="js-u2f-edit" type="button" onclick="document.getElementById('dialog').hidden=false">Edit</button></td></tr>`
                    : ""
            }
                </tbody></table>
                <button id="create_button" type="button">登録</button>
            </form>
            <div id="dialog" hidden><input id="prompt"><button type="button" onclick="document.getElementById('operation').value='update';document.getElementById('id').value='new-device';document.getElementById('label').value=document.getElementById('prompt').value;document.getElementById('register').submit()">更新</button></div>
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

Deno.test("FIDO registration persists the key before submission and labels only the new device", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/fido.json`;
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const context = await browser.newContext();
        const result = await fixture(context, path);
        const page = await context.newPage();
        const authenticator = await createVirtualAuthenticator(page);
        await Effect.runPromise(registerFido(page, path, authenticator));
        assertEquals(result(), { registered: true, label: "KU-POTATO (Playwright)" });
        assertEquals(await page.locator("#datatable tbody tr").first().innerText(), "Existing device");
    } finally {
        await browser.close();
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("FIDO registration aborts the server submission if its private key cannot be saved", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/unwritable.json`;
    await Deno.mkdir(path);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const context = await browser.newContext();
        const result = await fixture(context, path);
        const page = await context.newPage();
        page.setDefaultTimeout(1500);
        const authenticator = await createVirtualAuthenticator(page);
        const error = await assertRejects(
            () => Effect.runPromise(registerFido(page, path, authenticator)),
            LmsAuthenticationStorageError,
        );
        assertEquals(error.operation, "save FIDO credentials");
        assertEquals(result().registered, false);
    } finally {
        await browser.close();
        await Deno.remove(directory, { recursive: true });
    }
});
