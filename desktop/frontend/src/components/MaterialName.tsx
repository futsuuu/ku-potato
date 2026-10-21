import type { Schema } from "../api";
import MaterialIcon from "./MaterialIcon";
import BudouxText from "./BudouxText";

export default function MaterialName(props: { material: Schema["Material"] }) {
  return (
    <span class="flex items-center gap-sm">
      <MaterialIcon type={props.material.type} />
      <span class="link-label min-w-none">
        <BudouxText text={props.material.name} />
      </span>
    </span>
  );
}
