import type { JSX } from "@solidjs/web";
import type { Schema } from "../api";
import MaterialInfo from "./MaterialInfo";
import MaterialName from "./MaterialName";
import ItemContent from "./ItemContent";

export default function MaterialSummary(props: {
  material: Schema["Material"];
  children?: JSX.Element;
}) {
  return (
    <ItemContent>
      <MaterialName material={props.material} />
      <MaterialInfo material={props.material} />
      {props.children}
    </ItemContent>
  );
}
