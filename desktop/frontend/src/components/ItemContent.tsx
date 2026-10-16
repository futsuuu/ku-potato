import type { JSX } from "@solidjs/web";

export default function ItemContent(props: { children: JSX.Element }) {
  return <div class="min-w-none flex flex-col gap-xs break-anywhere">{props.children}</div>;
}
