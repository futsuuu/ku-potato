import { Match, Switch } from "solid-js";
import CircleQuestionMark from "@lucide/solid/icons/circle-question-mark";
import ClipboardCheck from "@lucide/solid/icons/clipboard-check";
import FilePenLine from "@lucide/solid/icons/file-pen-line";
import FileText from "@lucide/solid/icons/file-text";
import ListChecks from "@lucide/solid/icons/list-checks";
import MessageSquareReply from "@lucide/solid/icons/message-square-reply";
import MessagesSquare from "@lucide/solid/icons/messages-square";
import MonitorPlay from "@lucide/solid/icons/monitor-play";
import type { Schema } from "../api";
import { materialTypes } from "../format";

export default function MaterialIcon(props: { type: Schema["Material"]["type"] }) {
  return (
    <span
      class="material-icon"
      role="img"
      aria-label={materialTypes[props.type]}
      title={materialTypes[props.type]}
    >
      <Switch fallback={<CircleQuestionMark class="icon" aria-hidden="true" />}>
        <Match when={props.type === "material"}>
          <FileText class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "report"}>
          <FilePenLine class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "test"}>
          <ListChecks class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "questionnaire"}>
          <ClipboardCheck class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "e-learning"}>
          <MonitorPlay class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "board"}>
          <MessagesSquare class="icon" aria-hidden="true" />
        </Match>
        <Match when={props.type === "feedback"}>
          <MessageSquareReply class="icon" aria-hidden="true" />
        </Match>
      </Switch>
    </span>
  );
}
