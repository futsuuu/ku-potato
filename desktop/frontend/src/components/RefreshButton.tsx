export default function RefreshButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="inline-flex items-center justify-center rounded-none p-sm text-ink disabled:cursor-default hover:enabled:bg-surface"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <span class="i-lucide-refresh-cw opacity-opaque" aria-hidden="true" />
    </button>
  );
}
