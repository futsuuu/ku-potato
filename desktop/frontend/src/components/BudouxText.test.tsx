// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { expect, it } from "vite-plus/test";
import BudouxText from "./BudouxText";

it("updates optional breaks when the displayed text changes", () => {
  const [text, setText] = createSignal("今日は天気です。");
  const host = document.createElement("div");
  const dispose = render(() => <BudouxText text={text()} />, host);
  expect(host.querySelector(".budoux-text")).not.toBeNull();
  expect(host.querySelectorAll("wbr")).toHaveLength(1);
  expect(host.textContent).toBe("今日は天気です。");
  setText("第3回TypeScriptとSolidのコンポーネント設計（2026年度）");
  flush();
  expect(host.textContent).toBe("第3回TypeScriptとSolidのコンポーネント設計（2026年度）");
  setText("短い");
  flush();
  expect(host.querySelectorAll("wbr")).toHaveLength(0);
  expect(host.textContent).toBe("短い");
  dispose();
});
