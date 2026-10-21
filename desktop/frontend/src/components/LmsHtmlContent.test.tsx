// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vite-plus/test";
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

it("compacts only folder descriptions before adding BudouX breaks", () => {
  dispose = render(
    () => <LmsHtmlContent kind="folder" html="<p>今日は天気です。<br><br>今日は天気です。</p>" />,
    document.body,
  );
  expect(document.querySelector(".folder-description-gap")).not.toBeNull();
  expect(document.querySelectorAll("p wbr")).toHaveLength(2);
});
