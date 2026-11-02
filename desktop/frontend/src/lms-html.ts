import DOMPurify from "dompurify";
import { openExternal } from "./native";

export function sanitizeLmsHtml(html: string) {
  return DOMPurify.sanitize(html, {
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
}

export function compactFolderDescriptionHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeLmsHtml(html);

  const compactBreaks = (parent: Element | DocumentFragment) => {
    const nodes = [...parent.childNodes];
    for (let index = 0; index < nodes.length;) {
      if (!(nodes[index] instanceof HTMLBRElement)) {
        index++;
        continue;
      }
      let end = index + 1;
      let breaks = 1;
      while (end < nodes.length) {
        const node = nodes[end];
        if (node instanceof HTMLBRElement) breaks++;
        else if (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()) break;
        end++;
      }
      if (breaks > 1) {
        const gap = document.createElement("span");
        gap.className = "folder-description-gap";
        gap.setAttribute("aria-hidden", "true");
        parent.replaceChild(gap, nodes[index]);
        for (const node of nodes.slice(index + 1, end)) parent.removeChild(node);
      }
      index = end;
    }
    for (const child of parent.children) compactBreaks(child);
  };

  compactBreaks(template.content);
  return template.innerHTML;
}

export function openLmsHtmlLink(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (link instanceof HTMLAnchorElement) {
    event.preventDefault();
    void openExternal(link.href);
  }
}
