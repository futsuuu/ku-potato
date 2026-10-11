import type { Schema } from "./api";

export const materialTypes: Record<Schema["Material"]["type"], string> = {
  material: "教材",
  report: "レポート",
  test: "テスト",
  questionnaire: "アンケート",
  "e-learning": "eラーニング",
  board: "掲示板",
  feedback: "フィードバック",
  unknown: "不明",
};
export function formatDate(value: string) {
  if (value === "no-deadline") return "期限なし";
  if (value === "unavailable") return "公開終了";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "不明"
    : new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : { timeStyle: "short" as const }),
      }).format(date);
}
export function upcoming(assignments: Schema["Assignment"][], now: number) {
  return assignments
    .filter(
      (value) => !value.material.archived && Date.parse(value.material.publicationDeadline) > now,
    )
    .sort(
      (a, b) =>
        Date.parse(a.material.publicationDeadline) - Date.parse(b.material.publicationDeadline),
    );
}
export const stages: Record<Schema["Progress"]["stage"], string> = {
  waiting: "処理待ち",
  authenticating: "認証中",
  "logging-out": "ログアウト中",
  registering: "認証デバイスを登録中",
  "fetching-courses": "講義を取得中",
  "fetching-materials": "教材を取得中",
  "fetching-resources": "資料を取得中",
  downloading: "ダウンロード中",
  saving: "保存中",
  completed: "完了",
};
