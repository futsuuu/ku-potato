import type { JSX } from "@solidjs/web";
import { For, onSettled, Show } from "solid-js";

export default function PageHeader(props: {
  title: string;
  ancestors?: readonly { label: string; href: string }[];
  icon?: JSX.Element;
  children?: JSX.Element;
}) {
  let header: HTMLElement | undefined;
  onSettled(() => {
    const element = header;
    const main = element?.closest<HTMLElement>(".main-content");
    const content = main?.querySelector<HTMLElement>(".page-content");
    if (!element || !main || !content) return;
    const updateLayout = () => {
      const bounds = main.getBoundingClientRect();
      element.style.top = `${bounds.top}px`;
      element.style.left = `${bounds.left}px`;
      element.style.width = `${bounds.width}px`;
      // The untouched bottom padding gives the theme's responsive vertical gutter.
      const gutter = Number.parseFloat(getComputedStyle(content).paddingBottom) || 0;
      const contentOffset = `${element.getBoundingClientRect().height + gutter}px`;
      content.style.paddingTop = contentOffset;
      content.style.scrollPaddingTop = contentOffset;
    };
    updateLayout();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    observer.observe(main);
    return () => observer.disconnect();
  });
  return (
    <header class="page-header" ref={(element) => (header = element)}>
      <Show when={props.children}>
        {(actions) => <div class="header-actions">{actions()}</div>}
      </Show>
      <nav class="breadcrumbs" aria-label="パンくずリスト">
        <ol>
          <For each={props.ancestors ?? []} keyed={(ancestor) => ancestor.href}>
            {(ancestor) => (
              <li class="breadcrumb-parent">
                <a href={ancestor().href} title={ancestor().label}>
                  {ancestor().label}
                </a>
                <span class="i-lucide-chevron-right" aria-hidden="true" />
              </li>
            )}
          </For>
          <li class="breadcrumb-current" aria-current="page">
            {props.icon}
            <h1 title={props.title}>{props.title}</h1>
          </li>
        </ol>
      </nav>
    </header>
  );
}
