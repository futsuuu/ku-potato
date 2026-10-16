import type { Schema } from "../api";
import { formatDate } from "../format";

export default function MaterialInfo(props: { material: Schema["Material"] }) {
  return (
    <small class="muted-note">
      <span class="tnum">{formatDate(props.material.publicationDeadline)}</span>
      {props.material.resourceAvailability === "unavailable" ? " · 現在は非公開" : ""}
      {props.material.archived &&
        props.material.type === "material" &&
        props.material.fetchedAt && (
          <>
            {" · 過去の取得データ: "}
            <span class="tnum">{formatDate(props.material.fetchedAt)}</span>取得
          </>
        )}
    </small>
  );
}
