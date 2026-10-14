// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vite-plus/test";
import PageHeader from "./PageHeader";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("tracks the fixed header's position and content offset across resizing", () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(225, 0, 500, 80));
  const spacing = vi
    .spyOn(window, "getComputedStyle")
    .mockReturnValue({ paddingBottom: "24px" } as CSSStyleDeclaration);
  dispose = render(
    () => (
      <main class="main-content">
        <PageHeader title="講義資料" />
        <div class="page-content">本文</div>
      </main>
    ),
    document.body,
  );
  flush();
  const main = document.querySelector<HTMLElement>(".main-content")!;
  const header = main.querySelector<HTMLElement>(".page-header")!;
  const content = main.querySelector<HTMLElement>(".page-content")!;
  expect(header.style.top).toBe("0px");
  expect(header.style.left).toBe("225px");
  expect(header.style.width).toBe("500px");
  expect(content.style.paddingTop).toBe("104px");
  expect(content.style.scrollPaddingTop).toBe("104px");
  expect(main.getAttribute("style")).toBeNull();
  expect(observe).toHaveBeenCalledWith(header);
  expect(observe).toHaveBeenCalledWith(main);

  measure.mockReturnValue(new DOMRect(0, 160, 300, 120));
  spacing.mockReturnValue({ paddingBottom: "16px" } as CSSStyleDeclaration);
  resize?.();
  expect(header.style.top).toBe("160px");
  expect(header.style.left).toBe("0px");
  expect(header.style.width).toBe("300px");
  expect(content.style.paddingTop).toBe("136px");
  expect(content.style.scrollPaddingTop).toBe("136px");

  dispose();
  dispose = undefined;
  expect(disconnect).toHaveBeenCalledOnce();
});

it("preserves breadcrumb links and focus when ancestors are recreated or renamed", () => {
  const initial = [
    { label: "講義一覧", href: "/" },
    { label: "情報科学", href: "/courses/C%201" },
  ];
  const [ancestors, setAncestors] = createSignal(initial);
  dispose = render(() => <PageHeader title="講義資料" ancestors={ancestors()} />, document.body);
  const [rootLink, courseLink] = document.querySelectorAll<HTMLAnchorElement>(".breadcrumbs a");
  courseLink!.focus();

  setAncestors(initial.map((ancestor) => ({ ...ancestor })));
  flush();
  const links = document.querySelectorAll(".breadcrumbs a");
  expect(links[0]).toBe(rootLink);
  expect(links[1]).toBe(courseLink);
  expect(document.activeElement).toBe(courseLink);

  setAncestors(initial.map((ancestor) => ({ ...ancestor, label: `${ancestor.label}（更新）` })));
  flush();
  expect(document.querySelectorAll(".breadcrumbs a")[1]).toBe(courseLink);
  expect(courseLink?.textContent).toBe("情報科学（更新）");
  expect(courseLink?.title).toBe("情報科学（更新）");
  expect(document.activeElement).toBe(courseLink);
});
