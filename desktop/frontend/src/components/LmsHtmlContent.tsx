/* oxlint-disable solid/no-innerhtml -- Render only LMS HTML sanitized before insertion. */
import { createMemo, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { addJapaneseBreaks } from "../budoux";
import { compactFolderDescriptionHtml, openLmsHtmlLink, sanitizeLmsHtml } from "../lms-html";

export default function LmsHtmlContent(props: {
  html: string;
  kind: "folder" | "report";
  fallback?: JSX.Element;
}) {
  const content = createMemo(() =>
    addJapaneseBreaks(
      props.kind === "folder"
        ? compactFolderDescriptionHtml(props.html)
        : sanitizeLmsHtml(props.html),
    ),
  );
  return (
    <Show when={content().trim()} fallback={props.fallback}>
      <div
        class="[&_a[href]]:after:i-lucide-external-link budoux-text [&_a[href]:focus-visible]:text-accent [&_a[href]:hover]:text-accent [&_a[href]]:underlined-link [&_a[href]]:after:ml-xs [&_a[href]]:after:align-middle [&_a[href]]:after:content-empty"
        onClick={openLmsHtmlLink}
      >
        <Show
          when={props.kind === "folder"}
          fallback={
            <div
              class="report-content [&>*+*]:mt-md [&_table]:max-w-full [&_pre]:whitespace-pre-wrap [&_table]:border-collapse [&_td]:table-cell-bordered [&_th]:table-cell-bordered"
              innerHTML={content()}
            />
          }
        >
          <div
            class="folder-description mt-lg text-small [&>*+*]:mt-sm [&_.folder-description-gap]:block [&_.folder-description-gap]:pt-sm"
            innerHTML={content()}
          />
        </Show>
      </div>
    </Show>
  );
}
