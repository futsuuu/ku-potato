// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { ComponentProps } from "solid-js";
import type { API, Schema } from "../api";
import Authentication from "./Authentication";

const api = {
  auth: vi.fn<API["auth"]>(async () => ({ status: "unauthenticated" })),
  login: vi.fn<API["login"]>(async () => ({ status: "authenticated" })),
  check: vi.fn<API["check"]>(async () => ({ status: "unauthenticated" })),
  register: vi.fn<API["register"]>(async () => ({ registered: true })),
  webauthn: vi.fn<API["webauthn"]>(async () => ({ registered: false })),
  deleteWebAuthn: vi.fn<API["deleteWebAuthn"]>(async () => ({ registered: false })),
};
const onLogin = vi.fn();
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function mount(authenticationAPI: ComponentProps<typeof Authentication>["api"] = api) {
  dispose = render(
    () => (
      <Authentication api={authenticationAPI} title="認証" onLogin={onLogin}>
        <p class="saved-content">保存済みの教材を閲覧できます。</p>
      </Authentication>
    ),
    document.body,
  );
}

async function click(label: string) {
  let button: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    button = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
  });
  button!.click();
}

it.each([
  ["authenticated", "ログイン済み"],
  ["unauthenticated", "未ログイン"],
  ["unknown", "認証未確認"],
] satisfies [Schema["Authentication"]["status"], string][])(
  "displays the %s authentication state",
  async (status, expected) => {
    api.auth.mockResolvedValueOnce({ status });
    mount();
    await vi.waitFor(() =>
      expect(document.querySelector("section > span")?.textContent).toBe(expected),
    );
    expect(document.querySelector(".saved-content") === null).toBe(status === "authenticated");
    expect(onLogin).not.toHaveBeenCalled();
  },
);

it("disables authentication actions while checking the initial state", async () => {
  api.auth.mockReturnValueOnce(new Promise(() => {}));
  mount();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull());
  expect(document.querySelector("section > span")?.textContent).toBe("認証未確認");
  expect([...document.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
});

it("shows initial authentication failures without hiding saved content", async () => {
  api.auth.mockRejectedValueOnce(new Error("認証状態を取得できませんでした。"));
  mount();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "認証状態を取得できませんでした。",
    ),
  );
  expect(document.querySelector(".saved-content")?.textContent).toBe(
    "保存済みの教材を閲覧できます。",
  );
  expect(document.querySelector<HTMLButtonElement>(".app-button")?.disabled).toBe(false);
});

it("offers deletion instead of registration for saved credentials", async () => {
  api.webauthn.mockResolvedValueOnce({ registered: true });
  mount();
  await vi.waitFor(() =>
    expect(document.querySelector(".authentication-settings")?.textContent).toContain(
      "保存済みWebAuthn情報を削除",
    ),
  );
  expect(document.querySelector(".authentication-settings")?.textContent).not.toContain(
    "認証デバイスを登録",
  );
});

it.each(["authenticated", "unauthenticated"] as const)(
  "omits WebAuthn settings for a %s provider without credential support",
  async (status) => {
    api.auth.mockResolvedValueOnce({ status });
    mount({ auth: api.auth, login: api.login, check: api.check });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>(".app-button")?.disabled).toBe(false),
    );
    expect(document.querySelector("details")).toBeNull();
    expect(api.webauthn).not.toHaveBeenCalled();
  },
);

it("updates the state and notifies the parent after login", async () => {
  mount();
  await click("ブラウザでログイン");
  await vi.waitFor(() =>
    expect(document.querySelector("section > span")?.textContent).toBe("ログイン済み"),
  );
  expect(api.login).toHaveBeenCalledOnce();
  expect(onLogin).toHaveBeenCalledOnce();
  expect(document.querySelector(".saved-content")).toBeNull();
});

it("checks authentication without notifying the parent of a login", async () => {
  api.check.mockResolvedValueOnce({ status: "authenticated" });
  mount();
  await click("認証状態を確認");
  await vi.waitFor(() =>
    expect(document.querySelector("section > span")?.textContent).toBe("ログイン済み"),
  );
  expect(api.check).toHaveBeenCalledOnce();
  expect(onLogin).not.toHaveBeenCalled();
});

it("registers and deletes credentials", async () => {
  mount();
  await click("認証デバイスを登録");
  await click("保存済みWebAuthn情報を削除");
  await vi.waitFor(() =>
    expect(document.querySelector(".authentication-settings")?.textContent).toContain(
      "認証デバイスを登録",
    ),
  );
  expect(api.register).toHaveBeenCalledOnce();
  expect(api.deleteWebAuthn).toHaveBeenCalledOnce();
  expect(onLogin).not.toHaveBeenCalled();
});

it("displays login progress and prevents duplicate actions", async () => {
  api.login.mockImplementationOnce((observe) => {
    observe?.onStatus?.({
      attempt: 1,
      status: "running",
      progress: { stage: "authenticating", completed: 0, total: 1 },
    });
    return new Promise(() => {});
  });
  mount();
  await click("ブラウザでログイン");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain("認証中"),
  );
  expect([...document.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  expect(onLogin).not.toHaveBeenCalled();
});

it("shows login failures and enables retrying", async () => {
  api.login.mockRejectedValueOnce(new Error("ログインに失敗しました。"));
  mount();
  await click("ブラウザでログイン");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "ログインに失敗しました。",
    ),
  );
  expect(document.querySelector("section > span")?.textContent).toBe("未ログイン");
  expect(document.querySelector<HTMLButtonElement>(".app-button")?.disabled).toBe(false);
  expect(onLogin).not.toHaveBeenCalled();
});
