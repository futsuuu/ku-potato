import { Show } from "solid-js";
import type { Schema } from "../api";
import { formatDate } from "../format";
import LmsHtmlContent from "./LmsHtmlContent";

const statuses: Record<Schema["ReportDetail"]["status"], string> = {
  unviewed: "未閲覧",
  unsubmitted: "未提出",
  submitted: "提出済み",
  "resubmission-required": "再提出が必要",
  evaluated: "評価済み",
  unknown: "不明",
};

export default function ReportContent(props: {
  report: Schema["ReportDetail"];
  archived: boolean;
}) {
  return (
    <section class="mt-section">
      <h2 class="mb-md">課題内容</h2>
      <LmsHtmlContent
        html={props.report.promptHtml ?? ""}
        kind="report"
        fallback={<p class="no-content">課題文はありません。</p>}
      />
      <dl class="grid my-section gap-x-section gap-y-sm grid-cols-key-value">
        <dt class="text-muted">提出状況</dt>
        <dd class="m-none break-anywhere">{statuses[props.report.status]}</dd>
        <dt class="text-muted">提出期間</dt>
        <dd class="m-none tnum break-anywhere">
          {props.report.submissionPeriodKind === "unlisted"
            ? "指定なし"
            : props.report.submissionPeriodKind === "at"
              ? `${props.report.submissionStartsAt ? formatDate(props.report.submissionStartsAt) : "開始日時の指定なし"} ～ ${props.report.submissionDueAt ? formatDate(props.report.submissionDueAt) : "締切の指定なし"}`
              : "不明"}
        </dd>
      </dl>
      <Show when={props.archived && props.report.fetchedAt}>
        <small class="muted-note">
          過去の取得データ: <span class="tnum">{formatDate(props.report.fetchedAt!)}</span>取得
        </small>
      </Show>
    </section>
  );
}
