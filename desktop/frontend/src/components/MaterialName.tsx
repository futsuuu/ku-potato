import type { Schema } from "../api";
import MaterialIcon from "./MaterialIcon";

export default function MaterialName(props: { material: Schema["Material"] }) {
  return (
    <span class="flex items-center gap-sm">
      <MaterialIcon type={props.material.type} />
      <span class="link-label min-w-none">{props.material.name}</span>
    </span>
  );
}
