// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { addJapaneseBreaks, splitJapaneseText } from "./budoux";

it("inserts optional breaks at Japanese phrase boundaries without changing the text", () => {
  const text = "今日は天気です。";
  expect(splitJapaneseText(text)).toEqual(["今日は", "天気です。"]);
  const element = document.createElement("div");
  element.innerHTML = addJapaneseBreaks(`<p>${text}</p>`);
  expect(element.querySelectorAll("wbr")).toHaveLength(1);
  expect(element.textContent).toBe(text);
});

it("preserves HTML structure, attributes, explicit breaks, and code", () => {
  const html =
    '<a href="https://example.com/今日は天気です。">今日は天気です。</a><br><code>今日は天気です。</code><pre>今日は天気です。</pre>';
  const element = document.createElement("div");
  element.innerHTML = addJapaneseBreaks(html);
  expect(element.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.com/今日は天気です。",
  );
  expect(element.querySelector("a wbr")).not.toBeNull();
  expect(element.querySelectorAll("br")).toHaveLength(1);
  expect(element.querySelector("code wbr, pre wbr")).toBeNull();
  expect(element.textContent).toBe("今日は天気です。今日は天気です。今日は天気です。");
});
