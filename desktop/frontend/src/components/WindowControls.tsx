import { Show } from "solid-js";

// Microsoft's caption glyphs, provided by Windows (no bundled font or approximation).
// https://learn.microsoft.com/en-us/windows/apps/design/style/segoe-fluent-icons-font
const captionIcons = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
};

export default function WindowControls(props: {
  maximized: boolean;
  error: string;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Show when={props.error}>
        <span class="window-control-error" role="alert">
          {props.error}
        </span>
      </Show>
      <div class="window-controls" role="group" aria-label="ウィンドウ操作">
        <button
          type="button"
          class="window-control window-control-minimize"
          aria-label="最小化"
          title="最小化"
          onClick={() => props.onMinimize()}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {captionIcons.minimize}
          </span>
        </button>
        <button
          type="button"
          class="window-control window-control-maximize"
          aria-label={props.maximized ? "元のサイズに戻す" : "最大化"}
          onClick={() => props.onToggleMaximize()}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {props.maximized ? captionIcons.restore : captionIcons.maximize}
          </span>
        </button>
        <button
          type="button"
          class="window-control window-control-close"
          aria-label="閉じる"
          title="閉じる"
          onClick={() => props.onClose()}
        >
          <span class="window-caption-icon" aria-hidden="true">
            {captionIcons.close}
          </span>
        </button>
      </div>
    </>
  );
}
