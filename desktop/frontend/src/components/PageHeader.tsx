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
    <header
      class="page-header fixed left-sidebar right-none top-none z-header min-h-toolbar flex items-center gap-lg px-page py-lg before:pointer-events-none before:absolute before:inset-x-none before:top-none lt-sm:left-none before:bg-frosted lt-md:px-section lt-sm:px-lg lt-sm:py-md before:content-empty before:backdrop-blur-soft before:mask-fade-bottom before:-bottom-toolbar before:-z-action"
      ref={(element) => (header = element)}
    >
      <Show when={props.children}>
        {(actions) => <div class="flex shrink-none gap-sm -ml-lg lt-sm:-ml-sm">{actions()}</div>}
      </Show>
      <nav class="min-w-none flex-auto" aria-label="パンくずリスト">
        <ol class="m-none flex flex-wrap items-center gap-sm p-none list-none">
          <For each={props.ancestors ?? []} keyed={(ancestor) => ancestor.href}>
            {(ancestor) => (
              <li class="max-w-full min-w-none flex items-center gap-sm text-small text-muted">
                <a
                  class="min-w-none overflow-hidden text-ellipsis whitespace-nowrap focus-visible:text-accent hover:text-accent focus-visible:underline hover:underline"
                  href={ancestor().href}
                  title={ancestor().label}
                >
                  {ancestor().label}
                </a>
                <span class="i-lucide-chevron-right" aria-hidden="true" />
              </li>
            )}
          </For>
          <li class="min-w-none flex flex-auto items-center gap-sm" aria-current="page">
            {props.icon}
            <h1
              class="overflow-hidden text-ellipsis whitespace-nowrap lt-sm:text-heading"
              title={props.title}
            >
              {props.title}
            </h1>
          </li>
        </ol>
      </nav>
    </header>
  );
}
