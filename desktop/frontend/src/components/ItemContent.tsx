import type { JSX } from "@solidjs/web";

export default function ItemContent(props: { children: JSX.Element }) {
  return <div class="item-content">{props.children}</div>;
}
