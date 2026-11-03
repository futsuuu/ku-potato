// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ServerURL } from "../bindings/github.com/futsuuu/ku-potato/desktop/app";
import App from "./App";

vi.mock("../bindings/github.com/futsuuu/ku-potato/desktop/app", () => ({
  ServerURL: vi.fn(),
}));
vi.mock("@wailsio/runtime", () => ({
  Window: { IsMaximised: vi.fn(async () => false) },
  Events: {
    Types: {
      Common: { WindowMaximise: "max", WindowUnMaximise: "unmax", WindowRestore: "restore" },
    },
    On: vi.fn(() => vi.fn()),
  },
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  delete window._wails;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("keeps Windows controls mounted while connecting and after the workspace loads", async () => {
  window._wails = { environment: { OS: "windows" } };
  window.history.replaceState(null, "", "/");
  let connect!: (url: string) => void;
  const connection = new Promise<string>((resolve) => {
    connect = resolve;
  });
  vi.mocked(ServerURL).mockReturnValueOnce(connection as ReturnType<typeof ServerURL>);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      return Response.json(
        path === "/courses" ? [] : { status: "unauthenticated", registered: false },
      );
    }),
  );
  dispose = render(() => <App />, document.body);
  flush();
  await vi.dynamicImportSettled();
  const controls = document.querySelector(".window-controls");
  expect(controls).not.toBeNull();
  expect(document.querySelector(".window-content .connection-header")?.textContent).toBe(
    "KU-POTATO",
  );

  connect("http://localhost");
  await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("講義一覧"), {
    timeout: 10000,
  });
  expect(document.querySelector(".window-content .app-layout")).not.toBeNull();
  expect(document.querySelector(".connection-screen")).toBeNull();
  expect(document.querySelector(".window-controls")).toBe(controls);
}, 15000);

it("keeps Windows controls available when connecting fails", async () => {
  window._wails = { environment: { OS: "windows" } };
  vi.mocked(ServerURL).mockRejectedValueOnce(new Error("server unavailable"));
  dispose = render(() => <App />, document.body);
  await vi.waitFor(() => expect(document.body.textContent).toContain("server unavailable"));
  expect(document.querySelector(".window-controls button[aria-label='閉じる']")).not.toBeNull();
  expect(document.querySelector(".window-content .connection-header")).not.toBeNull();
});
