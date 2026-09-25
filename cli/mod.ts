/** Inbound adapter for the command-line interface. */

import type {
    ListCourseMaterials,
    ListCourses,
    ListMaterialResources,
    SyncCourseMaterials,
    SyncCourses,
    SyncMaterialResources,
} from "ku-potato-core/in_port";
import type { LmsCacheGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import {
    type Course,
    type CourseMaterials,
    LmsCourseId,
    LmsMaterialId,
    type MaterialResources,
} from "ku-potato-domain";
import { Effect } from "effect";
import * as gunshi from "gunshi";

/**
 * Runs the CLI against input ports supplied by the composition root.
 *
 * `list-*` commands deliberately receive only cache-backed queries. KU-LMS
 * access is reserved for the corresponding explicit `sync-*` command.
 */
export const main = Effect.fn("CliInboundAdapter.run")(function* (
    commandArgs: readonly string[],
    listCourses: ListCourses,
    syncCourses: SyncCourses,
    listCourseMaterials: ListCourseMaterials,
    syncCourseMaterials: SyncCourseMaterials,
    listMaterialResources: ListMaterialResources,
    syncMaterialResources: SyncMaterialResources,
) {
    const context = yield* Effect.context<LmsCacheGateway | LmsSourceGateway>();
    const printCachedCourses = listCourses.execute.pipe(
        Effect.flatMap((courses) => Effect.forEach(courses, printCourse)),
        Effect.asVoid,
    );
    const synchronizeCourses = syncCourses.execute.pipe(
        Effect.flatMap((courses) => Effect.forEach(courses, printCourse)),
        Effect.asVoid,
    );
    const cachedCourseMaterials = (lmsCourseId: string) =>
        listCourseMaterials.execute(LmsCourseId(lmsCourseId)).pipe(
            Effect.flatMap(printCourseMaterials),
            Effect.asVoid,
        );
    const synchronizeCourseMaterials = (lmsCourseId: string) =>
        syncCourseMaterials.execute(LmsCourseId(lmsCourseId)).pipe(
            Effect.flatMap(printCourseMaterials),
            Effect.asVoid,
        );
    const cachedMaterialResources = (lmsMaterialId: string) =>
        listMaterialResources.execute(LmsMaterialId(lmsMaterialId)).pipe(
            Effect.flatMap(printMaterialResources),
            Effect.asVoid,
        );
    const synchronizeMaterialResources = (lmsMaterialId: string) =>
        syncMaterialResources.execute(LmsMaterialId(lmsMaterialId)).pipe(
            Effect.flatMap(printMaterialResources),
            Effect.asVoid,
        );
    const runCachedCourses = () =>
        Effect.runPromiseWith(context)(
            printCachedCourses.pipe(
                Effect.catchTag("LmsCacheMissError", (error) =>
                    Effect.logError(`${error.message} Run "ku-potato sync-courses" to synchronize it.`)),
            ),
        );
    const runSynchronizeCourses = () =>
        Effect.runPromiseWith(context)(
            synchronizeCourses.pipe(
                Effect.catchTag("LmsCacheMissError", (error) =>
                    Effect.logError(`${error.message} Run "ku-potato sync-courses" to synchronize it.`)),
            ),
        );
    const runCachedCourseMaterials = (lmsCourseId: string) =>
        Effect.runPromiseWith(context)(
            cachedCourseMaterials(lmsCourseId).pipe(
                Effect.catchTag("LmsCacheMissError", (error) =>
                    Effect.logError(
                        `${error.message} Run "ku-potato sync-course-materials ${lmsCourseId}" to synchronize it.`,
                    )),
            ),
        );
    const runSynchronizeCourseMaterials = (lmsCourseId: string) =>
        Effect.runPromiseWith(context)(synchronizeCourseMaterials(lmsCourseId));
    const runCachedMaterialResources = (lmsMaterialId: string) =>
        Effect.runPromiseWith(context)(
            cachedMaterialResources(lmsMaterialId).pipe(
                Effect.catchTag("LmsCacheMissError", (error) =>
                    Effect.logError(
                        `${error.message} Run "ku-potato sync-material-resources ${lmsMaterialId}" to synchronize it.`,
                    )),
            ),
        );
    const runSynchronizeMaterialResources = (lmsMaterialId: string) =>
        Effect.runPromiseWith(context)(synchronizeMaterialResources(lmsMaterialId));

    return yield* Effect.promise(() =>
        gunshi.cli(
            [...commandArgs],
            gunshi.define({
                name: "ku-potato",
                description: "Command-Line Interface for KU-PORT and KU-LMS",
                run: runCachedCourses,
            }),
            {
                name: "ku-potato",
                version: "0.0.0",
                description: "Command-Line Interface for KU-PORT and KU-LMS",
                subCommands: {
                    "list-courses": gunshi.define({
                        name: "list-courses",
                        description: "キャッシュ済みの講義一覧を表示する",
                        run: runCachedCourses,
                    }),
                    "sync-courses": gunshi.define({
                        name: "sync-courses",
                        description: "KU-LMSから講義一覧を取得してキャッシュを更新する",
                        run: runSynchronizeCourses,
                    }),
                    "list-course-materials": gunshi.define({
                        name: "list-course-materials",
                        description: "キャッシュ済みの教材一覧を表示する",
                        args: {
                            lmsCourseId: {
                                type: "positional",
                                description: "LMS講義ID",
                            },
                        },
                        run: (command) => runCachedCourseMaterials(command.values.lmsCourseId),
                    }),
                    "sync-course-materials": gunshi.define({
                        name: "sync-course-materials",
                        description: "KU-LMSから教材一覧を取得してキャッシュを更新する",
                        args: {
                            lmsCourseId: {
                                type: "positional",
                                description: "LMS講義ID",
                            },
                        },
                        run: (command) => runSynchronizeCourseMaterials(command.values.lmsCourseId),
                    }),
                    "list-material-resources": gunshi.define({
                        name: "list-material-resources",
                        description: "キャッシュ済みの資料一覧を表示する",
                        args: {
                            lmsMaterialId: {
                                type: "positional",
                                description: "LMS教材ID",
                            },
                        },
                        run: (command) => runCachedMaterialResources(command.values.lmsMaterialId),
                    }),
                    "sync-material-resources": gunshi.define({
                        name: "sync-material-resources",
                        description: "KU-LMSから資料一覧を取得してキャッシュを更新する",
                        args: {
                            lmsMaterialId: {
                                type: "positional",
                                description: "LMS教材ID",
                            },
                        },
                        run: (command) => runSynchronizeMaterialResources(command.values.lmsMaterialId),
                    }),
                },
            },
        )
    );
});

export const CliInboundAdapter = { run: main };

export const printCourse = Effect.fn("CliInboundAdapter.printCourse")(function* (course: Course) {
    yield* Effect.log(`講義名: ${course.name}`);
    if (course.availability === "unavailable") {
        yield* Effect.log("  利用不可");
        return;
    }
    yield* Effect.log(`  LMS講義ID: ${course.lmsCourseId}`);
});

export const printCourseMaterials = Effect.fn("CliInboundAdapter.printCourseMaterials")(
    function* (courseMaterials: CourseMaterials) {
        yield* Effect.log(`LMS講義ID: ${courseMaterials.lmsCourseId}`);
        if (courseMaterials.folders.length === 0) {
            yield* Effect.log("教材フォルダー: （なし）");
            return;
        }
        for (const folder of courseMaterials.folders) {
            yield* Effect.log(`教材フォルダー: ${folder.name}`);
            if (folder.classDate !== undefined) yield* Effect.log(`  授業実施日: ${folder.classDate.toISOString()}`);
            if (folder.materials.length === 0) yield* Effect.log("  教材: （なし）");
            for (const material of folder.materials) {
                yield* Effect.log(`  教材: ${material.name}`);
                yield* Effect.log(`    LMS教材ID: ${material.lmsMaterialId}`);
                yield* Effect.log(`    種類: ${material.type}`);
                yield* Effect.log(
                    `    公開期限: ${
                        material.publicationDeadline instanceof Date
                            ? material.publicationDeadline.toISOString()
                            : material.publicationDeadline
                    }`,
                );
                if (material.type === "material") {
                    yield* Effect.log(
                        `    資料: ${material.resourceAvailability === "available" ? "公開中" : "未公開"}`,
                    );
                }
            }
        }
    },
);

export const printMaterialResources = Effect.fn("CliInboundAdapter.printMaterialResources")(
    function* (materialResources: MaterialResources) {
        yield* Effect.log(`LMS教材ID: ${materialResources.lmsMaterialId}`);
        if (materialResources.resources.length === 0) {
            yield* Effect.log("資料: （なし）");
            return;
        }
        for (const resource of materialResources.resources) yield* Effect.log(`資料: ${resource.name}`);
    },
);
