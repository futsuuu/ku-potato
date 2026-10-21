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
  setText("短い");
  flush();
  expect(host.querySelectorAll("wbr")).toHaveLength(0);
  expect(host.textContent).toBe("短い");
  dispose();
});
