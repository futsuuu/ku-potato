/* oxlint-disable effecttsgo/async-function, effecttsgo/global-fetch -- Playwright callbacks and browser fixtures use Promise APIs; coordinator requests stay on loopback. */
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { createVirtualAuthenticator, credentialSourcesStoragePath } from "../webauthn.ts";
import { makeLmsGateways } from "../mod.ts";

const origin = "https://slink.secioss.com";
const home = "https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex";
const options = {
    challenge: [1, 2, 3, 4],
    rp: { id: "slink.secioss.com", name: "Local test" },
    user: { id: [1, 2, 3], name: "test@example.invalid", displayName: "Test" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

/** All browser URLs are intercepted; only the loopback coordinator is contacted. */
export function interceptAuthentication(coordinator: string, failHome = false) {
    const launch = chromium.launch.bind(chromium);
    chromium.launch = async (launchOptions) => {
        const browser = await launch({ ...launchOptions, headless: true });
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (contextOptions) => {
            const context = await newContext(contextOptions);
            context.on("page", (page) => {
                page.setDefaultTimeout(2000);
                page.setDefaultNavigationTimeout(2000);
            });
            await context.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                if (url.pathname === "/lms") {
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body:
                            `<p>統合認証アカウントでログインします</p><form action="${origin}/pub/prelogin.cgi"><button name="loginButton">ログイン</button></form>`,
                    });
                }
                if (url.pathname === "/pub/prelogin.cgi") {
                    return route.fulfill({
                        contentType: "text/html",
                        body: `<!doctype html><script>
                        navigator.credentials.get({publicKey:{challenge:new Uint8Array([1,2,3,4]),rpId:'slink.secioss.com',userVerification:'required'}})
                        .then(async c=>{const data=new Uint8Array(c.response.authenticatorData);const count=new DataView(data.buffer).getUint32(33);
                            await fetch('/assertion?counter='+count);location.href='${home}';});
                        </script>`,
                    });
                }
                if (url.pathname === "/assertion") {
                    await fetch(`${coordinator}/assertion${url.search}`);
                    return route.fulfill({ body: "ok" });
                }
                return route.fulfill({
                    contentType: "text/html; charset=utf-8",
                    body: failHome
                        ? "<p>Expected failed HOME verification</p>"
                        : '<div class="lms-search-condition-title"><span>講義一覧</span></div><div class="lms-weekly-area"><p>No courses</p></div>',
                });
            });
            return context;
        };
        return browser;
    };
    return () => {
        chromium.launch = launch;
    };
}

export async function seedCredential(storagePath: string) {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const context = await browser.newContext();
        await context.route("**/*", (route) => route.fulfill({ body: "<!doctype html>" }));
        const page = await context.newPage();
        const authenticator = await Effect.runPromise(createVirtualAuthenticator(page));
        try {
            await page.goto(origin);
            await page.evaluate(async (options) => {
                await navigator.credentials.create({
                    publicKey: {
                        ...options,
                        challenge: new Uint8Array(options.challenge),
                        user: { ...options.user, id: new Uint8Array(options.user.id) },
                        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
                        authenticatorSelection: { residentKey: "required", userVerification: "required" },
                    },
                });
            }, options);
            await Effect.runPromise(authenticator.saveCredentialSources(
                credentialSourcesStoragePath(storagePath),
                "test@example.invalid",
            ));
        } finally {
            await Effect.runPromise(authenticator.close);
        }
    } finally {
        await browser.close();
    }
}

export function interceptRegistration() {
    const launch = chromium.launch.bind(chromium);
    let submissions = 0;
    let label = "";
    chromium.launch = async (launchOptions) => {
        const browser = await launch({ ...launchOptions, headless: true });
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (contextOptions) => {
            const context = await newContext(contextOptions);
            await context.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                if (url.pathname === "/lms") {
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body:
                            `<p>統合認証アカウントでログインします</p><form action="${home}"><button name="loginButton">ログイン</button></form>`,
                    });
                }
                if (url.hostname !== "slink.secioss.com") {
                    return route.fulfill({
                        contentType: "text/html; charset=utf-8",
                        body:
                            '<div class="lms-search-condition-title"><span>講義一覧</span></div><div class="lms-weekly-area"><p>No courses</p></div>',
                    });
                }
                const data = new URLSearchParams(route.request().postData() ?? "");
                if (data.get("operation") === "register") submissions++;
                if (data.get("operation") === "update") label = data.get("label") ?? "";
                await route.fulfill({
                    contentType: "text/html; charset=utf-8",
                    headers: data.get("operation") === "update"
                        ? { "set-cookie": "registration=complete; Path=/; Secure" }
                        : {},
                    body: `<!doctype html>
                    <h1>FIDO認証デバイスの設定</h1><p>ログインID: test@example.invalid</p>
                    <form method="post" id="register"><input name="operation" id="operation" type="hidden">
                    <input name="id" id="id" type="hidden"><input name="label" id="label" type="hidden">
                    <table id="datatable"><tbody>${
                        submissions
                            ? `<tr><td><span>${label}</span><input id="id_0" value="new" type="hidden"><button class="js-u2f-edit" type="button">Edit</button></td></tr>`
                            : ""
                    }</tbody></table>
                    <button id="create_button" type="button">登録</button></form>
                    <input id="prompt"><button type="button" onclick="document.getElementById('operation').value='update';document.getElementById('id').value='new';document.getElementById('label').value=document.getElementById('prompt').value;document.getElementById('register').submit()">更新</button>
                    <script>document.getElementById('create_button').onclick=async()=>{
                        const o=${
                        JSON.stringify(options)
                    };o.challenge=new Uint8Array(o.challenge);o.user.id=new Uint8Array(o.user.id);
                        o.authenticatorSelection={residentKey:'required',userVerification:'required'};
                        await navigator.credentials.create({publicKey:o});
                        document.getElementById('operation').value='register';document.getElementById('register').submit();};</script>`,
                });
            });
            return context;
        };
        return browser;
    };
    return {
        submissions: () => submissions,
        restore: () => {
            chromium.launch = launch;
        },
    };
}

if (import.meta.main) {
    const [storagePath, coordinator] = Deno.args;
    const restore = interceptAuthentication(coordinator);
    try {
        await Effect.runPromise(makeLmsGateways(storagePath).authentication.login("false"));
    } finally {
        restore();
    }
}
