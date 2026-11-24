import { Show } from "solid-js";
import type { Schema } from "../../api";
import { formatDate } from "../../format";
import LmsHtmlContent from "../../components/LmsHtmlContent";

const statuses: Record<Schema["Report"]["status"], string> = {
  unviewed: "未閲覧",
  unsubmitted: "未提出",
  submitted: "提出済み",
  "resubmission-required": "再提出が必要",
  evaluated: "評価済み",
  unknown: "不明",
};

export default function ReportContent(props: { report: Schema["Report"]; archived: boolean }) {
  return (
    <section class="report-section">
      <h2 class="section-heading">課題内容</h2>
      <LmsHtmlContent
        html={props.report.promptHtml ?? ""}
        kind="report"
        fallback={<p class="no-content">課題文はありません。</p>}
      />
      <dl class="report-details">
        <dt>提出状況</dt>
        <dd>{statuses[props.report.status]}</dd>
        <dt>提出期間</dt>
        <dd class="tnum">
          {props.report.submissionPeriodKind === "unlisted"
            ? "指定なし"
            : props.report.submissionPeriodKind === "at"
              ? `${props.report.submissionStartsAt ? formatDate(props.report.submissionStartsAt) : "開始日時の指定なし"} ～ ${props.report.submissionDueAt ? formatDate(props.report.submissionDueAt) : "締切の指定なし"}`
              : "不明"}
        </dd>
      </dl>
      <Show when={props.archived && props.report.retrievedAt}>
        <small class="muted-note">
          過去の取得データ: <span class="tnum">{formatDate(props.report.retrievedAt!)}</span>取得
        </small>
      </Show>
    </section>
  );
}
