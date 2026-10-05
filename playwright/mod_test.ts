import { assertEquals, assertRejects } from "@std/assert";
import { Effect, Exit } from "effect";
import {
    makeLmsAuthenticationGateway,
    parseLmsCourseId,
    parseLmsDate,
    parseLmsMaterialId,
    parseMaterialType,
    parsePublicationDeadline,
} from "./mod.ts";

Deno.test("Extracts LMS course IDs from course click handlers", () => {
    assertEquals(Effect.runSync(parseLmsCourseId("formSubmit('KOG0000000066101')")), "KOG0000000066101");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsCourseId("openCourse('KOG1')"))), true);
});

Deno.test("Extracts LMS material IDs from material cells", () => {
    assertEquals(Effect.runSync(parseLmsMaterialId("SRY0000002556959")), "SRY0000002556959");
    assertEquals(Effect.runSync(parseLmsMaterialId("REP0000001438895")), "REP0000001438895");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsMaterialId("material-1"))), true);
});

Deno.test("Parses all supported material types and rejects unknown types", () => {
    assertEquals(Effect.runSync(parseMaterialType("資料")), "material");
    assertEquals(Effect.runSync(parseMaterialType("e-learning")), "e-learning");
    assertEquals(Effect.runSync(parseMaterialType("レポート")), "report");
    assertEquals(Effect.runSync(parseMaterialType("テスト")), "test");
    assertEquals(Effect.runSync(parseMaterialType("アンケート")), "questionnaire");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseMaterialType("その他"))), true);
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseMaterialType(null))), true);
});

Deno.test("Classifies publication deadlines as a date, no deadline, or unavailable", () => {
    assertEquals(Effect.runSync(parsePublicationDeadline(undefined)), "no-deadline");
    assertEquals(Effect.runSync(parsePublicationDeadline("公開終了")), "unavailable");
    assertEquals(
        (Effect.runSync(parsePublicationDeadline("2026/09/27 24:00")) as Date).toISOString(),
        "2026-09-27T15:00:00.000Z",
    );
});

Deno.test("Parses LMS dates and times in Japan Standard Time", () => {
    assertEquals(Effect.runSync(parseLmsDate(undefined)), undefined);
    assertEquals(Effect.runSync(parseLmsDate("2026/09/15"))?.toISOString(), "2026-09-14T15:00:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/09/15 23:59"))?.toISOString(), "2026-09-15T14:59:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2024/02/29 12:34:56"))?.toISOString(), "2024-02-29T03:34:56.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/09/27 24:00"))?.toISOString(), "2026-09-27T15:00:00.000Z");
    assertEquals(Effect.runSync(parseLmsDate("2026/12/31 24:00"))?.toISOString(), "2026-12-31T15:00:00.000Z");
    assertEquals(Exit.isFailure(Effect.runSyncExit(parseLmsDate("not-a-date"))), true);
});

Deno.test("Logout removes isolated authentication state and succeeds when it is already absent", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-logout-test-" });
    const statePath = `${directory}/storage-state.json`;
    try {
        await Deno.writeTextFile(statePath, "{}");
        const authentication = makeLmsAuthenticationGateway(statePath);
        await Effect.runPromise(authentication.logout);
        await assertRejects(() => Deno.stat(statePath), Deno.errors.NotFound);
        await Effect.runPromise(authentication.logout);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
