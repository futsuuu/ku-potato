import { Show } from "solid-js";
import Progress from "./Progress";

export default function ConnectionScreen(props: {
  pending: boolean;
  error: string;
  onReload: () => void;
}) {
  return (
    <div class="connection-screen">
      <header class="connection-header">
        <span class="app-brand">KU-POTATO</span>
      </header>
      <Progress pending={props.pending} error={props.error} />
      <Show when={props.error}>
        <button class="app-button" onClick={() => props.onReload()}>
          再読み込み
        </button>
      </Show>
    </div>
  );
}
