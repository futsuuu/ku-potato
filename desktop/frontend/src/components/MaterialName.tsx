import type { Schema } from "../api";
import MaterialIcon from "./MaterialIcon";
import BudouxText from "./BudouxText";

export default function MaterialName(props: { material: Schema["Material"] }) {
  return (
    <span class="material-name">
      <MaterialIcon type={props.material.type} />
      <span class="link-label">
        <BudouxText text={props.material.name} />
      </span>
    </span>
  );
}
