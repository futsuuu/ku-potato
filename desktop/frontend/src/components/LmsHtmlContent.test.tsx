// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vite-plus/test";
import LmsHtmlContent from "./LmsHtmlContent";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

it.each(["folder", "report"] as const)("adds BudouX breaks to %s HTML", (kind) => {
  dispose = render(
    () => <LmsHtmlContent kind={kind} html="<p>今日は天気です。</p>" />,
    document.body,
  );
  expect(document.querySelector("p wbr")).not.toBeNull();
  expect(document.querySelector("p")?.textContent).toBe("今日は天気です。");
});

it.each(["folder", "report"] as const)(
  "renders library icons only for safe %s links",
  async (kind) => {
    dispose = render(
      () => (
        <LmsHtmlContent
          kind={kind}
          html='<a href="https://example.com/">資料</a><a href="javascript:alert(1)">危険</a><a>リンクなし</a>'
        />
      ),
      document.body,
    );
    await vi.waitFor(() => expect(document.querySelectorAll("svg.lms-link-icon")).toHaveLength(1));
    expect(document.querySelector("a[href] svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll("a:not([href]) svg")).toHaveLength(0);
  },
);

it("replaces link icons with updated HTML and cleans them up on disposal", async () => {
  const [html, setHtml] = createSignal('<a href="https://example.com/first">最初</a>');
  dispose = render(
    () => <LmsHtmlContent kind="report" html={html()} fallback={<p>本文なし</p>} />,
    document.body,
  );
  await vi.waitFor(() => expect(document.querySelectorAll("svg.lms-link-icon")).toHaveLength(1));
  const oldIcon = document.querySelector(".lms-link-icon")!;
  const oldLink = oldIcon.parentElement!;
  setHtml(
    '<a href="https://example.com/second">次</a><a href="https://example.com/third">追加</a>',
  );
  flush();
  await vi.waitFor(() => expect(document.querySelectorAll("svg.lms-link-icon")).toHaveLength(2));
  expect(oldIcon.isConnected).toBe(false);
  expect(oldLink.querySelector("svg")).toBeNull();
  const links = [...document.querySelectorAll("a[href]")];
  setHtml("");
  flush();
  expect(document.body.textContent).toBe("本文なし");
  expect(document.querySelector(".lms-link-icon")).toBeNull();
  for (const link of links) expect(link.querySelector("svg")).toBeNull();
  setHtml('<a href="https://example.com/last">最後</a>');
  flush();
  await vi.waitFor(() => expect(document.querySelectorAll("svg.lms-link-icon")).toHaveLength(1));
  const lastLink = document.querySelector("a[href]")!;
  dispose();
  dispose = undefined;
  expect(lastLink.isConnected).toBe(false);
  expect(lastLink.querySelector("svg")).toBeNull();
});

it("compacts only folder descriptions before adding BudouX breaks", () => {
  dispose = render(
    () => <LmsHtmlContent kind="folder" html="<p>今日は天気です。<br><br>今日は天気です。</p>" />,
    document.body,
  );
  expect(document.querySelector(".folder-description-gap")).not.toBeNull();
  expect(document.querySelectorAll("p wbr")).toHaveLength(2);
});
