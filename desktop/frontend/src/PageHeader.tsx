import type { JSX } from "@solidjs/web";

export default function PageHeader(props: {
  title: string;
  icon?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <header class="page-header">
      <div class="header-title">
        <div class="min-w-none flex items-center gap-sm">
          {props.icon}
          <h1 title={props.title}>{props.title}</h1>
        </div>
      </div>
      <div class="actions">{props.children}</div>
    </header>
  );
}
