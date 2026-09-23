import { assertEquals } from "@std/assert";
import { Effect, Exit } from "effect";
import {
    parseLmsCourseId,
    parseLmsDate,
    parseLmsMaterialId,
    parseMaterialType,
    parsePublicationDeadline,
} from "./mod.ts";

Deno.test("講義クリックハンドラーからLMS講義IDを抽出する", () => {
    assertEquals(Effect.runSync(parseLmsCourseId("formSubmit('KOG0000000066101')")), "KOG0000000066101");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsCourseId("openCourse('KOG1')"))), true);
});

Deno.test("教材セルからLMS教材IDを抽出する", () => {
    assertEquals(Effect.runSync(parseLmsMaterialId("SRY0000002556959")), "SRY0000002556959");
    assertEquals(Effect.runSync(parseLmsMaterialId("REP0000001438895")), "REP0000001438895");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsMaterialId("material-1"))), true);
});

Deno.test("教材の表示名を種類ごとに変換する", () => {
    assertEquals(Effect.runSync(parseMaterialType("資料")), "material");
    assertEquals(Effect.runSync(parseMaterialType("e-learning")), "e-learning");
    assertEquals(Effect.runSync(parseMaterialType("レポート")), "report");
    assertEquals(Effect.runSync(parseMaterialType("テスト")), "test");
    assertEquals(Effect.runSync(parseMaterialType("アンケート")), "questionnaire");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseMaterialType("その他"))), true);
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseMaterialType(null))), true);
});

Deno.test("公開期限を日付・期限なし・公開終了に分類する", () => {
    assertEquals(Effect.runSync(parsePublicationDeadline(undefined)), "no-deadline");
    assertEquals(Effect.runSync(parsePublicationDeadline("公開終了")), "unavailable");
    assertEquals(
        (Effect.runSync(parsePublicationDeadline("2026/09/27 24:00")) as Date).toISOString(),
        "2026-09-27T15:00:00.000Z",
    );
});

Deno.test("LMSの日付・日時を日本時間としてパースする", () => {
    assertEquals(Effect.runSync(parseLmsDate(undefined)), undefined);
    assertEquals(Effect.runSync(parseLmsDate("2026/09/15"))?.toISOString(), "2026-09-14T15:00:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/09/15 23:59"))?.toISOString(), "2026-09-15T14:59:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2024/02/29 12:34:56"))?.toISOString(), "2024-02-29T03:34:56.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/09/27 24:00"))?.toISOString(), "2026-09-27T15:00:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/12/31 24:00"))?.toISOString(), "2026-12-31T15:00:00.000Z");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsDate("not-a-date"))), true);
});
