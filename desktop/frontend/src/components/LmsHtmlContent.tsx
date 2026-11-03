/* oxlint-disable solid/no-innerhtml -- Render only LMS HTML sanitized before insertion. */
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import ExternalLink from "@lucide/solid/icons/external-link";
import { addJapaneseBreaks } from "../budoux";
import { compactFolderDescriptionHtml, openLmsHtmlLink, sanitizeLmsHtml } from "../lms-html";

function LmsHtmlMarkup(props: { html: string; kind: "folder" | "report" }) {
  let element: HTMLDivElement | undefined;
  const [links, setLinks] = createSignal<Element[]>([]);
  onSettled(() => {
    if (element) setLinks([...element.querySelectorAll("a[href]")]);
  });
  return (
    <>
      <div
        ref={(value) => (element = value)}
        class={props.kind === "folder" ? "folder-description" : "report-content"}
        innerHTML={props.html}
      />
      <For each={links()}>
        {(link) => (
          <Portal mount={link}>
            <ExternalLink class="icon lms-link-icon" aria-hidden="true" />
          </Portal>
        )}
      </For>
    </>
  );
}

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
  // Recreate the markup and its portals together when sanitized HTML changes.
  return (
    <Show when={content().trim() && content()} keyed fallback={props.fallback}>
      {(html) => (
        <div class="lms-html budoux-text" onClick={openLmsHtmlLink}>
          <LmsHtmlMarkup html={html} kind={props.kind} />
        </div>
      )}
    </Show>
  );
}
