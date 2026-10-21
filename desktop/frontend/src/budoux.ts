import { loadDefaultJapaneseParser } from "budoux";

const parser = loadDefaultJapaneseParser();

export function splitJapaneseText(text: string) {
  return parser.parse(text);
}

// Process only text nodes so sanitized LMS markup, attributes and explicit breaks stay intact.
export function addJapaneseBreaks(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const visit = (parent: Node) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const parts = splitJapaneseText(node.textContent);
        if (parts.length < 2) continue;
        const fragment = document.createDocumentFragment();
        for (const [index, part] of parts.entries()) {
          if (index) fragment.append(document.createElement("wbr"));
          fragment.append(document.createTextNode(part));
        }
        node.replaceWith(fragment);
      } else if (node instanceof Element && !node.matches("pre, code")) {
        visit(node);
      }
    }
  };
  visit(template.content);
  return template.innerHTML;
}
