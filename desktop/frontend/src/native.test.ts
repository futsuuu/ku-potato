// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Browser } from "@wailsio/runtime";
import { OpenResource, ServerURL } from "../bindings/github.com/futsuuu/ku-potato/desktop/app";
import { createAPI } from "./api";
import { isDesktop, openExternal, serverURL } from "./native";

vi.mock("@wailsio/runtime", () => ({ Browser: { OpenURL: vi.fn(async () => {}) } }));
vi.mock("../bindings/github.com/futsuuu/ku-potato/desktop/app", () => ({
  ServerURL: vi.fn(async () => "http://127.0.0.1:8787"),
  OpenResource: vi.fn(async () => {}),
}));

afterEach(() => {
  delete window._wails;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("uses the native bridge to open saved resources without an HTTP launch request", async () => {
  window._wails = { environment: { OS: "linux" } };
  const fetch = vi.spyOn(globalThis, "fetch");
  const api = createAPI(await serverURL());
  expect(isDesktop()).toBe(true);
  expect(ServerURL).toHaveBeenCalledExactlyOnceWith();
  await api.openResource("SRY1", "SRS1");
  expect(OpenResource).toHaveBeenCalledExactlyOnceWith("SRY1", "SRS1");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { chrome: { webview: { postMessage: vi.fn() } } },
  { webkit: { messageHandlers: { external: { postMessage: vi.fn() } } } },
])("uses the native bridge before Wails injects environment: %o", async (bridge) => {
  for (const [name, value] of Object.entries(bridge)) vi.stubGlobal(name, value);
  expect(window._wails?.environment).toBeUndefined();
  expect(isDesktop()).toBe(true);
  expect(await serverURL()).toBe("http://127.0.0.1:8787");
  expect(ServerURL).toHaveBeenCalledExactlyOnceWith();
  await createAPI(await serverURL()).openResource("SRY1", "SRS1");
  expect(OpenResource).toHaveBeenCalledExactlyOnceWith("SRY1", "SRS1");
  await openExternal("https://example.com");
  expect(Browser.OpenURL).toHaveBeenCalledExactlyOnceWith("https://example.com/");
});

it("propagates native launch failures", async () => {
  window._wails = { environment: { OS: "linux" } };
  vi.mocked(OpenResource).mockRejectedValueOnce(new Error("no default application"));
  await expect(createAPI(await serverURL()).openResource("SRY1", "SRS1")).rejects.toThrow(
    "no default application",
  );
});

it("downloads the saved file in a browser without requesting a server launch or local path", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetch = vi.spyOn(globalThis, "fetch");
  await createAPI("/api/").openResource("material with spaces", "resource/part");
  expect(click).toHaveBeenCalledOnce();
  const link = click.mock.instances[0] as HTMLAnchorElement;
  expect(link.getAttribute("href")).toBe(
    "/api/materials/material%20with%20spaces/resources/resource%2Fpart/file",
  );
  expect(link.download).toBe("");
  expect(fetch).not.toHaveBeenCalled();
  expect(OpenResource).not.toHaveBeenCalled();
});

it("does not treat browser globals without a native transport as a desktop bridge", async () => {
  vi.stubGlobal("chrome", { runtime: {} });
  vi.stubGlobal("webkit", { messageHandlers: {} });
  expect(isDesktop()).toBe(false);
  expect(await serverURL()).toBe("/api");
  expect(ServerURL).not.toHaveBeenCalled();
});

it("does not treat an initialized browser runtime as a desktop bridge", async () => {
  window._wails = {};
  expect(isDesktop()).toBe(false);
  expect(await serverURL()).toBe("/api");
  expect(ServerURL).not.toHaveBeenCalled();
});

it("opens external links in the system browser on desktop", async () => {
  window._wails = { environment: { OS: "linux" } };
  const open = vi.spyOn(window, "open");
  await openExternal("https://example.com/guide");
  expect(Browser.OpenURL).toHaveBeenCalledExactlyOnceWith("https://example.com/guide");
  expect(open).not.toHaveBeenCalled();
});

it("propagates system browser launch failures", async () => {
  window._wails = { environment: { OS: "linux" } };
  vi.mocked(Browser.OpenURL).mockRejectedValueOnce(new Error("browser launch failed"));
  await expect(openExternal("https://example.com")).rejects.toThrow("browser launch failed");
});

it("opens external links in a new browser tab outside desktop", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  await openExternal("https://example.com/guide");
  expect(open).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/guide",
    "_blank",
    "noopener,noreferrer",
  );
  expect(Browser.OpenURL).not.toHaveBeenCalled();
});

it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hello"])(
  "rejects non-HTTP links without opening %s",
  async (url) => {
    const open = vi.spyOn(window, "open");
    await expect(openExternal(url)).rejects.toThrow("このリンクは開けません。");
    expect(Browser.OpenURL).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  },
);
