// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Events } from "@wailsio/runtime";
import WindowFrame from "./WindowFrame";
import PageHeader from "./PageHeader";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appCSS = readFileSync(resolve(import.meta.dirname, "../styles/app.css"), "utf8");

const Window = vi.hoisted(() => ({
  IsMaximised: vi.fn(async () => false),
  Minimise: vi.fn(async () => {}),
  ToggleMaximise: vi.fn(async () => {}),
  Close: vi.fn(async () => {}),
}));

vi.mock("@wailsio/runtime", () => ({
  Window,
  Events: {
    Types: {
      Common: {
        WindowMaximise: "common:WindowMaximise",
        WindowUnMaximise: "common:WindowUnMaximise",
        WindowRestore: "common:WindowRestore",
      },
    },
    On: vi.fn(() => vi.fn()),
  },
}));

let dispose: (() => void) | undefined;
let stylesheet: HTMLStyleElement;
const setResizable = vi.fn();
const button = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const emit = (name: string) => {
  const handler = vi.mocked(Events.On).mock.calls.find(([event]) => event === name)![1];
  handler({ name, data: undefined });
};
const mount = async (ready = false) => {
  dispose = render(
    () => (
      <WindowFrame>
        {ready ? (
          <div class="app-layout">
            <aside class="sidebar">KU-POTATO</aside>
            <main class="main-content">
              <PageHeader title="講義資料" ancestors={[{ label: "講義一覧", href: "/" }]}>
                <button aria-label="更新">更新</button>
              </PageHeader>
              <div class="page-content">教材</div>
            </main>
          </div>
        ) : (
          <div class="connection-screen">
            <header class="connection-header">接続待ち</header>
          </div>
        )}
      </WindowFrame>
    ),
    document.body,
  );
  flush();
  await vi.dynamicImportSettled();
};

beforeEach(() => {
  window._wails = { environment: { OS: "windows" }, setResizable };
  stylesheet = document.createElement("style");
  // jsdom drops Chromium's app-region. Mirror it to test CSS selector coverage.
  stylesheet.textContent = appCSS.replaceAll("app-region:", "--test-app-region:");
  document.head.append(stylesheet);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  stylesheet.remove();
  delete window._wails;
  vi.resetAllMocks();
});

const expectState = async (maximized: boolean) => {
  const label = maximized ? "元のサイズに戻す" : "最大化";
  await vi.waitFor(() => expect(button(label)).not.toBeNull());
  expect(button(label).textContent?.trim()).toBe(maximized ? "\uE923" : "\uE922");
  expect(button(label).hasAttribute("title")).toBe(false);
  expect(setResizable).toHaveBeenLastCalledWith(!maximized);
};

it.each(["browser", "linux", "darwin"])("keeps native controls out of %s", async (OS) => {
  if (OS === "browser") delete window._wails;
  else window._wails = { environment: { OS } };
  await mount();
  expect(document.querySelector(".window-controls")).toBeNull();
  expect(document.querySelector(".windows-window")).toBeNull();
  expect(document.body.textContent).toBe("接続待ち");
  expect(Events.On).not.toHaveBeenCalled();
  expect(Window.IsMaximised).not.toHaveBeenCalled();
  expect(setResizable).not.toHaveBeenCalled();
});

it.each(["browser", "windows"])("keeps inner scrolling in %s", async (OS) => {
  if (OS === "browser") delete window._wails;
  else window._wails = { environment: { OS } };
  await mount(true);
  expect(getComputedStyle(document.querySelector(".window-frame")!).height).toBe(
    `${window.innerHeight}px`,
  );
  const content = getComputedStyle(document.querySelector(".window-content")!);
  expect(content.height).toBe("100%");
  expect(content.overflow).toBe("auto");
  const layout = getComputedStyle(document.querySelector(".app-layout")!);
  expect(layout.height).toBe(`${window.innerHeight}px`);
  expect(layout.overflow).toBe("hidden");
  expect(getComputedStyle(document.querySelector(".page-content")!).overflow).toBe("auto");
});

it("provides caption controls and dispatches native actions while connecting", async () => {
  await mount();
  expect(document.querySelector(".windows-window")).not.toBeNull();
  expect(button("最小化").textContent).toBe("\uE921");
  expect(button("最大化").textContent?.trim()).toBe("\uE922");
  expect(button("閉じる").textContent).toBe("\uE8BB");
  expect(document.querySelectorAll(".window-controls [aria-hidden='true']")).toHaveLength(3);
  button("最小化").click();
  button("最大化").click();
  button("閉じる").click();
  await vi.waitFor(() => expect(Window.Close).toHaveBeenCalledOnce());
  expect(Window.Minimise).toHaveBeenCalledExactlyOnceWith();
  expect(Window.ToggleMaximise).toHaveBeenCalledExactlyOnceWith();
  expect(Window.Close).toHaveBeenCalledExactlyOnceWith();
});

it("uses regular WebView buttons fixed at the top right without caption hit targets", async () => {
  await mount();
  const controls = getComputedStyle(document.querySelector(".window-controls")!);
  expect(controls.position).toBe("fixed");
  expect(controls.top).toBe("0px");
  expect(controls.right).toBe("0px");
  const region = (element: Element) =>
    getComputedStyle(element).getPropertyValue("--wails-non-client-region").trim();
  for (const label of ["最小化", "最大化", "閉じる"]) {
    expect(region(button(label))).toBe("");
    expect(getComputedStyle(button(label)).getPropertyValue("--test-app-region")).not.toBe("drag");
  }
  expect(
    getComputedStyle(document.querySelector(".connection-header")!).getPropertyValue(
      "--test-app-region",
    ),
  ).toBe("drag");
});

it("uses the page header for native dragging, excluding interactive controls", async () => {
  await mount(true);
  const header = document.querySelector(".page-header")!;
  expect(document.querySelector(".window-titlebar")).toBeNull();
  expect(getComputedStyle(document.querySelector(".sidebar")!).insetBlock).toBe("0px");
  const appRegion = (element: Element) =>
    getComputedStyle(element).getPropertyValue("--test-app-region").trim();
  expect(appRegion(header)).toBe("drag");
  expect(appRegion(button("更新"))).toBe("no-drag");
  expect(appRegion(header.querySelector("a")!)).toBe("no-drag");
  const backdrop = Array.from(stylesheet.sheet!.cssRules).find(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && rule.selectorText === ".windows-window .page-header::before",
  );
  // no-drag would also cut the overlapping header padding out of the caption.
  expect(backdrop?.style.getPropertyValue("--test-app-region")).toBe("initial");
  expect(getComputedStyle(header).getPropertyValue("--wails-draggable")).toBe("");
  header.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await Promise.resolve();
  // Windows owns caption double-clicks; a frontend handler would toggle twice.
  expect(Window.ToggleMaximise).not.toHaveBeenCalled();
});

it.each([false, true])(
  "loads the initial maximize state (%s) and configures edge resizing",
  async (maximized) => {
    vi.mocked(Window.IsMaximised).mockResolvedValue(maximized);
    await mount();
    await expectState(maximized);
    expect(Window.IsMaximised).toHaveBeenCalledExactlyOnceWith();
  },
);

it.each([
  Events.Types.Common.WindowMaximise,
  Events.Types.Common.WindowUnMaximise,
  Events.Types.Common.WindowRestore,
])("refreshes both the icon and edge resizing from native state on %s", async (event) => {
  await mount();
  await expectState(false);
  // Query the real state instead of inferring it from the event name. Restoring
  // from minimized can return to either a normal or a maximized window.
  for (const maximized of [true, false]) {
    Window.IsMaximised.mockClear();
    setResizable.mockClear();
    Window.IsMaximised.mockResolvedValue(maximized);
    emit(event);
    await expectState(maximized);
    expect(Window.IsMaximised).toHaveBeenCalledExactlyOnceWith();
    expect(setResizable).toHaveBeenCalledExactlyOnceWith(!maximized);
  }
});

it("ignores a stale state response without changing the icon or edge resizing", async () => {
  let resolveInitial: ((value: boolean) => void) | undefined;
  vi.mocked(Window.IsMaximised).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
  await mount();
  vi.mocked(Window.IsMaximised).mockResolvedValue(true);
  emit(Events.Types.Common.WindowMaximise);
  await vi.waitFor(() => expect(button("元のサイズに戻す")).not.toBeNull());
  setResizable.mockClear();
  resolveInitial!(false);
  await Promise.resolve();
  flush();
  expect(button("元のサイズに戻す")).not.toBeNull();
  expect(setResizable).not.toHaveBeenCalled();
});

it("removes all three native event listeners on disposal", async () => {
  await mount();
  const off = vi.mocked(Events.On).mock.results.map((result) => result.value);
  expect(off).toHaveLength(3);
  dispose?.();
  dispose = undefined;
  for (const unsubscribe of off) expect(unsubscribe).toHaveBeenCalledOnce();
});

it("does not apply a pending state response after disposal", async () => {
  let resolveState!: (value: boolean) => void;
  const state = new Promise<boolean>((resolve) => {
    resolveState = resolve;
  });
  Window.IsMaximised.mockReturnValueOnce(state);
  await mount();
  dispose!();
  dispose = undefined;
  setResizable.mockClear();
  resolveState(true);
  await state;
  await Promise.resolve();
  expect(setResizable).not.toHaveBeenCalled();
});

it("ignores a stale state failure but reports a current state failure", async () => {
  let rejectInitial!: (reason: Error) => void;
  const initial = new Promise<boolean>((_, reject) => {
    rejectInitial = reject;
  });
  Window.IsMaximised.mockReturnValueOnce(initial);
  await mount();
  Window.IsMaximised.mockResolvedValue(true);
  emit(Events.Types.Common.WindowMaximise);
  await expectState(true);
  rejectInitial(new Error("stale failure"));
  await initial.catch(() => {});
  await Promise.resolve();
  expect(document.querySelector('[role="alert"]')).toBeNull();

  Window.IsMaximised.mockRejectedValueOnce(new Error("current failure"));
  emit(Events.Types.Common.WindowRestore);
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "ウィンドウを操作できませんでした。",
    ),
  );
});

it.each([
  ["最小化", Window.Minimise],
  ["最大化", Window.ToggleMaximise],
  ["閉じる", Window.Close],
] as const)("reports %s failures and clears the error on retry", async (label, action) => {
  action.mockRejectedValueOnce(new Error("native failure"));
  await mount();
  button(label).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "ウィンドウを操作できませんでした。",
    ),
  );
  button(label).click();
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
