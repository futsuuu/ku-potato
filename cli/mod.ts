/** Inbound adapter for the command-line interface. */

import type { ListCourses, SyncCourses } from "ku-potato-core/in_port";
import type { LmsCacheGateway, LmsSourceGateway } from "ku-potato-core/out_port";
import type { Course } from "ku-potato-domain";
import { Effect } from "effect";
import * as gunshi from "gunshi";

/**
 * Runs the CLI against input ports supplied by the composition root.
 *
 * `list-courses` deliberately receives only the cache-backed query.  KU-LMS
 * access is reserved for the explicit `sync-courses` command.
 */
export const main = Effect.fn("CliInboundAdapter.run")(function* (
    commandArgs: readonly string[],
    listCourses: ListCourses,
    syncCourses: SyncCourses,
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
