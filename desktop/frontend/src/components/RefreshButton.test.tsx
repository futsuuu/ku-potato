// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vite-plus/test";
import RefreshButton from "./RefreshButton";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

it.each([false, true])("handles clicks with disabled=%s", (disabled) => {
  const onClick = vi.fn();
  dispose = render(
    () => <RefreshButton label="教材を再取得" disabled={disabled} onClick={onClick} />,
    document.body,
  );
  const button = document.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("教材を再取得");
  expect(button.title).toBe("教材を再取得");
  expect(button.disabled).toBe(disabled);
  button.click();
  expect(onClick).toHaveBeenCalledTimes(disabled ? 0 : 1);
});
