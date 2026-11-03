import RefreshCw from "@lucide/solid/icons/refresh-cw";

export default function RefreshButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="refresh-button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <RefreshCw class="icon" aria-hidden="true" />
    </button>
  );
}
