import { assertEquals } from "@std/assert";
import type {
    ListCourseMaterials,
    ListCourses,
    ListMaterialResources,
    SyncCourseMaterials,
    SyncCourses,
    SyncMaterialResources,
} from "ku-potato-core/in_port";
import { LmsCacheGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import { type CourseMaterials, LmsCourseId, LmsMaterialId, type MaterialResources } from "ku-potato-domain";
import { Effect } from "effect";
import { CliInboundAdapter } from "./mod.ts";

Deno.test("教材・資料コマンドは対応する入力ポートへIDを渡す", async () => {
    const calls: string[] = [];
    const courseMaterials: CourseMaterials = { lmsCourseId: LmsCourseId("course-1"), folders: [] };
    const materialResources: MaterialResources = {
        lmsMaterialId: LmsMaterialId("material-1"),
        resources: [],
    };
    const listCourseMaterials: ListCourseMaterials = {
        execute: (lmsCourseId) =>
            Effect.sync(() => calls.push(`list-course-materials:${lmsCourseId}`)).pipe(
                Effect.as(courseMaterials),
            ),
    };
    const syncCourseMaterials: SyncCourseMaterials = {
        execute: (lmsCourseId) =>
            Effect.sync(() => calls.push(`sync-course-materials:${lmsCourseId}`)).pipe(
                Effect.as(courseMaterials),
            ),
    };
    const listMaterialResources: ListMaterialResources = {
        execute: (lmsMaterialId) =>
            Effect.sync(() => calls.push(`list-material-resources:${lmsMaterialId}`)).pipe(
                Effect.as(materialResources),
            ),
    };
    const syncMaterialResources: SyncMaterialResources = {
        execute: (lmsMaterialId) =>
            Effect.sync(() => calls.push(`sync-material-resources:${lmsMaterialId}`)).pipe(
                Effect.as(materialResources),
            ),
    };

    await runCli(
        ["list-course-materials", "course-1"],
        listCourseMaterials,
        syncCourseMaterials,
        listMaterialResources,
        syncMaterialResources,
    );
    await runCli(
        ["sync-course-materials", "course-1"],
        listCourseMaterials,
        syncCourseMaterials,
        listMaterialResources,
        syncMaterialResources,
    );
    await runCli(
        ["list-material-resources", "material-1"],
        listCourseMaterials,
        syncCourseMaterials,
        listMaterialResources,
        syncMaterialResources,
    );
    await runCli(
        ["sync-material-resources", "material-1"],
        listCourseMaterials,
        syncCourseMaterials,
        listMaterialResources,
        syncMaterialResources,
    );

    assertEquals(calls, [
        "list-course-materials:course-1",
        "sync-course-materials:course-1",
        "list-material-resources:material-1",
        "sync-material-resources:material-1",
    ]);
});

const runCli = (
    commandArgs: readonly string[],
    listCourseMaterials: ListCourseMaterials,
    syncCourseMaterials: SyncCourseMaterials,
    listMaterialResources: ListMaterialResources,
    syncMaterialResources: SyncMaterialResources,
) => Effect.runPromise(
    CliInboundAdapter.run(
        commandArgs,
        unavailableListCourses,
        unavailableSyncCourses,
        listCourseMaterials,
        syncCourseMaterials,
        listMaterialResources,
        syncMaterialResources,
    ).pipe(
        Effect.provideService(LmsCacheGateway, unavailableCache),
        Effect.provideService(LmsSourceGateway, unavailableSource),
    ),
);

const unavailableListCourses: ListCourses = { execute: Effect.die("unexpected list-courses") };
const unavailableSyncCourses: SyncCourses = { execute: Effect.die("unexpected sync-courses") };

const unavailableCache = LmsCacheGateway.of({
    listCourses: Effect.die("unexpected cache list-courses"),
    listCourseMaterials: () => Effect.die("unexpected cache list-course-materials"),
    listMaterialResources: () => Effect.die("unexpected cache list-material-resources"),
    getMaterialDetail: () => Effect.die("unexpected cache get-material-detail"),
    appendCourses: () => Effect.die("unexpected cache append-courses"),
    appendCourseMaterials: () => Effect.die("unexpected cache append-course-materials"),
    appendMaterialResources: () => Effect.die("unexpected cache append-material-resources"),
});

const unavailableSource = LmsSourceGateway.of({
    withSession: () => Effect.die("unexpected source session"),
});
