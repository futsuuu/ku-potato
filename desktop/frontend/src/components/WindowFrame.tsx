import { createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { isWindowsDesktop } from "../native";
import WindowControls from "./WindowControls";

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
    <WindowControls
      maximized={maximized()}
      error={error()}
      onMinimize={() => run((window) => window.Minimise())}
      onToggleMaximize={() => run((window) => window.ToggleMaximise())}
      onClose={() => run((window) => window.Close())}
    />
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
