/**
 * Inbound adapter for the command-line interface.
 */

import type { Course, CourseMaterials } from "ku-potato-domain";
import type { ListCourseMaterials, ListCourses } from "ku-potato-core/in_port";
import { Effect } from "effect";
import * as gunshi from "gunshi";

/**
 * Runs the CLI against an input function supplied by the composition root.
 *
 * This module deliberately has no application-layer dependency. Dependency
 * selection and adaptation of the core input port belong to the entrypoint.
 */
export const main = Effect.fn("CliInboundAdapter.run")(function* (
    commandArgs: readonly string[],
    listCourseMaterials: ListCourseMaterials,
    listCourses: ListCourses,
) {
    const context = yield* Effect.context<never>();
    return yield* Effect.promise(() =>
        gunshi.cli(
            [...commandArgs],
            gunshi.define({
                name: "ku-potato",
                description: "Command-Line Interface for KU-PORT and KU-LMS",
                run: () =>
                    Effect.runPromiseWith(context)(
                        listCourseMaterials.execute.pipe(
                            Effect.flatMap((courses) => Effect.forEach(courses, printCourseMaterials)),
                            Effect.asVoid,
                        ),
                    ),
            }),
            {
                name: "ku-potato",
                version: "0.0.0",
                description: "Command-Line Interface for KU-PORT and KU-LMS",
                subCommands: {
                    "list-courses": gunshi.define({
                        name: "list-courses",
                        description: "講義一覧を取得する",
                        run: () =>
                            Effect.runPromiseWith(context)(
                                listCourses.execute.pipe(
                                    Effect.flatMap((courses) => Effect.forEach(courses, printCourse)),
                                    Effect.asVoid,
                                ),
                            ),
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
    function* (course: CourseMaterials) {
        yield* Effect.log(`講義名: ${course.name}`);
        if (course.availability === "unavailable") {
            yield* Effect.log("  利用不可");
            return;
        }
        yield* Effect.log(`  講義コード: ${course.courseCode ?? "不明"}`);
        yield* Effect.log(`  年度: ${course.year ?? "不明"}`);
        if (course.folders.length === 0) yield* Effect.log("  教材フォルダー名: （なし）");
        for (const folder of course.folders) {
            yield* Effect.log(`  教材フォルダー名: ${folder.name}`);
            if (folder.classDate !== undefined) yield* Effect.log(`    授業実施日: ${folder.classDate.toISOString()}`);
            if (folder.materials.length === 0) yield* Effect.log("    教材名: （なし）");
            for (const material of folder.materials) {
                yield* Effect.log(`    教材名: ${material.name}`);
                yield* Effect.log(`      種類: ${material.type}`);
                const deadline = material.publicationDeadline;
                yield* Effect.log(`      公開期限: ${deadline instanceof Date ? deadline.toISOString() : deadline}`);
                if (material.type === "material") {
                    if (material.resourceNames === null) yield* Effect.log("      資料名: （未公開）");
                    else if (material.resourceNames.length === 0) yield* Effect.log("      資料名: （なし）");
                    else for (const name of material.resourceNames) yield* Effect.log(`      資料名: ${name}`);
                }
            }
        }
    },
);
