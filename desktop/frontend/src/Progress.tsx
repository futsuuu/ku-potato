import { Show } from "solid-js";
import type { Status } from "./api";
import { stages } from "./format";

export default function Progress(props: { pending: boolean; error: string; status?: Status }) {
  return (
    <>
      <Show when={props.pending}>
        <div class="progress" role="status" aria-live="polite">
          <span>
            {props.status?.status === "retrying" ? "再試行中 · " : ""}
            {props.status?.progress ? stages[props.status.progress.stage] : "読み込み中"}
          </span>
          <Show when={(props.status?.progress?.total ?? 0) > 0}>
            <span class="tnum">
              {props.status?.progress?.completed} / {props.status?.progress?.total}
            </span>
          </Show>
        </div>
      </Show>
      <Show when={props.error}>
        <p class="error" role="alert">
          {props.error}
        </p>
      </Show>
    </>
  );
}
