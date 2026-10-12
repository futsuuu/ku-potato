/* oxlint-disable solid/no-innerhtml -- Render only the allowlisted HTML sanitized by DOMPurify below. */
import { Show } from "solid-js";
import DOMPurify from "dompurify";
import type { Schema } from "./api";
import { formatDate } from "./format";
import { openExternal } from "./native";

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
  const prompt = () =>
    DOMPurify.sanitize(props.report.promptHtml ?? "", {
      ALLOWED_TAGS: [
        "p",
        "br",
        "div",
        "span",
        "h2",
        "h3",
        "h4",
        "ul",
        "ol",
        "li",
        "strong",
        "b",
        "em",
        "i",
        "code",
        "pre",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "a",
      ],
      ALLOWED_ATTR: ["href", "title", "colspan", "rowspan"],
      ALLOWED_URI_REGEXP: /^https?:\/\//i,
    });
  return (
    <section class="report-section">
      <h2>課題内容</h2>
      <Show when={prompt().trim()} fallback={<p class="empty">課題文はありません。</p>}>
        <div
          class="report-content report-links:i-lucide-external-link"
          innerHTML={prompt()}
          onClick={(event) => {
            const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
            if (link instanceof HTMLAnchorElement) {
              event.preventDefault();
              openExternal(link.href);
            }
          }}
        />
      </Show>
      <dl class="report-metadata">
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
      <Show when={props.archived && props.report.fetchedAt}>
        <small class="meta">
          過去の取得データ: <span class="tnum">{formatDate(props.report.fetchedAt!)}</span>取得
        </small>
      </Show>
    </section>
  );
}
