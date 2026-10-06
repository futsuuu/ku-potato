import type { DesktopMaterial } from "../../bindings.ts";
import { DateTime } from "effect";

const types: Record<DesktopMaterial["type"], string> = {
    material: "教材",
    report: "レポート",
    test: "テスト",
    questionnaire: "アンケート",
    "e-learning": "eラーニング",
};

export const formatDate = (value: string) =>
    DateTime.format(DateTime.makeUnsafe(value), { locale: "ja-JP", timeZone: "Asia/Tokyo", dateStyle: "medium" });

const deadline = (value: string) => {
    if (value === "no-deadline") return "期限なし";
    if (value === "unavailable") return "公開終了";
    return DateTime.format(DateTime.makeUnsafe(value), {
        locale: "ja-JP",
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        timeStyle: "short",
    });
};

export default function MaterialInfo(props: { material: DesktopMaterial }) {
    return (
        <small class="app-meta">
            {types[props.material.type]} · 公開期限: {deadline(props.material.publicationDeadline)}
        </small>
    );
}
