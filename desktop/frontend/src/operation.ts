import { createSignal, onCleanup } from "solid-js";
import type { Observe, Status } from "./api";
import { errorMessage } from "./api";

export function createOperation<T>() {
  const [data, setData] = createSignal<T | undefined>(undefined);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<Status | undefined>(undefined);
  let current: AbortController | undefined;
  onCleanup(() => {
    current?.abort();
    current = undefined;
  });
  async function run(load: (options: Observe) => Promise<T>) {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    setPending(true);
    setError("");
    setStatus(undefined);
    try {
      const result = await load({
        signal: controller.signal,
        onStatus: (value) => {
          if (current === controller) setStatus(value);
        },
      });
      if (current === controller) setData(() => result);
      return current === controller ? result : undefined;
    } catch (cause) {
      if (!controller.signal.aborted && current === controller) setError(errorMessage(cause));
      return undefined;
    } finally {
      if (current === controller) setPending(false);
    }
  }
  const clear = () => setData(undefined);
  return { data, pending, error, status, run, clear };
}
