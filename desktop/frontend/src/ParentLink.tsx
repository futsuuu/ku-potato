export default function ParentLink(props: { href: string; label: string }) {
  return (
    <a class="parent-link" href={props.href}>
      {props.label}へ戻る
    </a>
  );
}
