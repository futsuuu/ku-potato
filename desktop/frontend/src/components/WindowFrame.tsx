import { createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { isWindowsDesktop } from "../native";

// Microsoft's caption glyphs, provided by Windows (no bundled font or approximation).
// https://learn.microsoft.com/en-us/windows/apps/design/style/segoe-fluent-icons-font
const captionIcons = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
};

function WindowsWindowControls() {
  const [maximized, setMaximized] = createSignal(false);
  const [error, setError] = createSignal("");
  const reportError = () => setError("ウィンドウを操作できませんでした。");
  // Keep the runtime lazy, like the native bindings, and out of the browser entry.
  const runtime = import("@wailsio/runtime");
  const run = (action: (window: typeof import("@wailsio/runtime").Window) => Promise<unknown>) => {
    setError("");
    void runtime.then(({ Window }) => action(Window)).catch(reportError);
  };

  onSettled(() => {
    let disposed = false;
    let revision = 0;
    let off: (() => void)[] = [];
    void runtime
      .then(({ Events, Window }) => {
        if (disposed) return;
        const updateState = () => {
          const current = ++revision;
          void Window.IsMaximised()
            .then((value) => {
              if (disposed || current !== revision) return;
              // HWND hosting needs Wails' edge tracker for restored windows only.
              // This does not change native resizability or WS_THICKFRAME.
              window._wails?.setResizable?.(!value);
              setMaximized(value);
            })
            .catch(() => {
              if (!disposed && current === revision) reportError();
            });
        };
        // Also covers Win+Arrow, taskbar actions and restoring a maximized window.
        off = [
          Events.On(Events.Types.Common.WindowMaximise, updateState),
          Events.On(Events.Types.Common.WindowUnMaximise, updateState),
          Events.On(Events.Types.Common.WindowRestore, updateState),
        ];
        updateState();
      })
      .catch(() => {
        if (!disposed) reportError();
      });
    return () => {
      disposed = true;
      off.forEach((unsubscribe) => unsubscribe());
    };
  });

  return (
    <>
      <Show when={error()}>
        <span class="window-control-error" role="alert">
          {error()}
        </span>
      </Show>
      <div class="window-controls" role="group" aria-label="ウィンドウ操作">
        <button
          type="button"
          class="window-control window-control-minimize"
          aria-label="最小化"
          title="最小化"
          onClick={() => run((window) => window.Minimise())}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {captionIcons.minimize}
          </span>
        </button>
        <button
          type="button"
          class="window-control window-control-maximize"
          aria-label={maximized() ? "元のサイズに戻す" : "最大化"}
          onClick={() => run((window) => window.ToggleMaximise())}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {maximized() ? captionIcons.restore : captionIcons.maximize}
          </span>
        </button>
        <button
          type="button"
          class="window-control window-control-close"
          aria-label="閉じる"
          title="閉じる"
          onClick={() => run((window) => window.Close())}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {captionIcons.close}
          </span>
        </button>
      </div>
    </>
  );
}

export default function WindowFrame(props: { children: JSX.Element }) {
  return (
    <div class={{ "window-frame": true, "windows-window": isWindowsDesktop() }}>
      <Show when={isWindowsDesktop()}>
        <WindowsWindowControls />
      </Show>
      <div class="window-content">{props.children}</div>
    </div>
  );
}
