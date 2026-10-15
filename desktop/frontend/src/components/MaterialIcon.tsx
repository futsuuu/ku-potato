import { Match, Switch } from "solid-js";
import type { Schema } from "../api";
import { materialTypes } from "../format";

export default function MaterialIcon(props: { type: Schema["Material"]["type"] }) {
  return (
    <span
      class="inline-flex items-center"
      role="img"
      aria-label={materialTypes[props.type]}
      title={materialTypes[props.type]}
    >
      <Switch fallback={<span class="i-lucide-circle-help" aria-hidden="true" />}>
        <Match when={props.type === "material"}>
          <span class="i-lucide-file-text" aria-hidden="true" />
        </Match>
        <Match when={props.type === "report"}>
          <span class="i-lucide-file-pen-line" aria-hidden="true" />
        </Match>
        <Match when={props.type === "test"}>
          <span class="i-lucide-list-checks" aria-hidden="true" />
        </Match>
        <Match when={props.type === "questionnaire"}>
          <span class="i-lucide-clipboard-check" aria-hidden="true" />
        </Match>
        <Match when={props.type === "e-learning"}>
          <span class="i-lucide-monitor-play" aria-hidden="true" />
        </Match>
        <Match when={props.type === "board"}>
          <span class="i-lucide-messages-square" aria-hidden="true" />
        </Match>
        <Match when={props.type === "feedback"}>
          <span class="i-lucide-message-square-reply" aria-hidden="true" />
        </Match>
      </Switch>
    </span>
  );
}
