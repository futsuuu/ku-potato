import { assertEquals, assertThrows } from "@std/assert";
import { parseLmsDate, parseMaterialType, parsePublicationDeadline } from "./main.ts";

Deno.test("教材の表示名を種類ごとに変換する", () => {
    assertEquals(parseMaterialType("資料"), "material");
    assertEquals(parseMaterialType("e-learning"), "e-learning");
    assertEquals(parseMaterialType("レポート"), "report");
    assertEquals(parseMaterialType("テスト"), "test");
    assertEquals(parseMaterialType("アンケート"), "questionnaire");
    assertThrows(() => parseMaterialType("その他"));
    assertThrows(() => parseMaterialType(null));
});

Deno.test("公開期限を日付・期限なし・公開終了に分類する", () => {
    assertEquals(parsePublicationDeadline(undefined), "no-deadline");
    assertEquals(parsePublicationDeadline("公開終了"), "unavailable");
    assertEquals(parsePublicationDeadline("2026/09/27 24:00"), new Date("2026-09-28T00:00:00+09:00"));
});

Deno.test("LMSの日付・日時を日本時間としてパースする", () => {
    assertEquals(parseLmsDate(undefined), undefined);
    assertEquals(parseLmsDate("2026/09/15")?.toISOString(), "2026-09-14T15:00:00.000Z");
    assertEquals(parseLmsDate("2026/09/15 23:59")?.toISOString(), "2026-09-15T14:59:00.000Z");
    assertEquals(parseLmsDate("2024/02/29 12:34:56")?.toISOString(), "2024-02-29T03:34:56.000Z");
    assertEquals(parseLmsDate("2026/09/27 24:00")?.toISOString(), "2026-09-27T15:00:00.000Z");
    assertEquals(parseLmsDate("2026/12/31 24:00")?.toISOString(), "2026-12-31T15:00:00.000Z");
});
