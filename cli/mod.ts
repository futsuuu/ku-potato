/** Inbound adapter for the command-line interface. */

import type { MaterialListResult } from "../core/in_port.ts";
import { Application, type HeadPolicy } from "../core/in_port.ts";
import {
    type Course,
    type CourseMaterials,
    LmsCourseId,
    LmsMaterialId,
    type Material,
    type MaterialDetail,
} from "../domain/mod.ts";
import { Effect, Schema, Terminal } from "effect";
import * as gunshi from "gunshi";

type DisplayableError = { readonly message: string };

class CliCommandError extends Schema.TaggedError<CliCommandError>()("CliCommandError", {
    message: Schema.String,
}) {}

const display = (message: string) =>
    Terminal.Terminal.pipe(Effect.flatMap((terminal) => terminal.display(`${message}\n`)));

const policyChoices = ["auto", "true", "false"] as const;
const headArgument = {
    type: "enum",
    choices: policyChoices,
    default: "auto",
    description: "ブラウザ表示: auto（認証操作時のみ）、true、false",
} as const;
const syncArgument = {
    type: "enum",
    choices: policyChoices,
    default: "auto",
    description: "同期方法: auto（不足時のみ）、true（必ず同期）、false（キャッシュのみ）",
} as const;

/** Runs the command hierarchy against input ports supplied by the composition root. */
export const main = Effect.fn("CliInboundAdapter.run")(function* (
    commandArgs: readonly string[],
) {
    const { login, registerFido, logout, getAuthenticationStatus, listCourses, listMaterials, viewMaterial } =
        yield* Application;
    const context = yield* Effect.context<Terminal.Terminal>();
    let exitCode = 0;
    const markFailure = Effect.sync(() => {
        exitCode = 1;
    });
    const run = <E extends DisplayableError>(effect: Effect.Effect<void, E, Terminal.Terminal>) =>
        Effect.runPromiseWith(context)(
            effect.pipe(
                Effect.catch((error) =>
                    display(error.message).pipe(
                        Effect.andThen(markFailure),
                    )
                ),
            ),
        );
    const runLogin = (head: HeadPolicy) =>
        run(login.execute(head).pipe(Effect.andThen(display("KU-LMSにログインしました。"))));
    const runLogout = () => run(logout.execute.pipe(Effect.andThen(display("ローカルの認証情報を削除しました。"))));
    const runAuthenticationStatus = () =>
        run(getAuthenticationStatus.execute.pipe(
            Effect.flatMap((status) => display(status === "authenticated" ? "認証済み" : "未認証")),
        ));
    const runCourseList = (sync: typeof policyChoices[number], head: HeadPolicy) =>
        run(
            listCourses.execute({ sync, head }).pipe(
                Effect.flatMap((courses) => Effect.forEach(courses, printCourse)),
                Effect.asVoid,
            ),
        );
    const runMaterialList = (
        courseIds: readonly string[] | undefined,
        sync: typeof policyChoices[number],
        head: HeadPolicy,
    ) => run(
        listMaterials.execute({
            lmsCourseIds: (courseIds ?? []).map(LmsCourseId),
            sync,
            head,
        }).pipe(
            Effect.flatMap(printMaterialListResult),
            Effect.tap((result) => result.failures.length > 0 ? markFailure : Effect.void),
            Effect.asVoid,
        ),
    );
    const runMaterialView = (
        materialId: string,
        sync: typeof policyChoices[number],
        head: HeadPolicy,
    ) => run(
        viewMaterial.execute({ lmsMaterialId: LmsMaterialId(materialId), sync, head }).pipe(
            Effect.flatMap(printMaterialDetail),
            Effect.asVoid,
        ),
    );

    yield* Effect.tryPromise({
        try: () =>
            gunshi.cli(
                [...commandArgs],
                gunshi.define({
                    name: "ku-potato",
                    description: "Command-Line Interface for KU-PORT and KU-LMS",
                }),
                {
                    name: "ku-potato",
                    version: "0.0.0",
                    description: "Command-Line Interface for KU-PORT and KU-LMS",
                    subCommands: {
                        auth: gunshi.define({
                            name: "auth",
                            description: "KU-LMSの認証状態を管理する",
                            subCommands: {
                                "register-fido": gunshi.define({
                                    name: "register-fido",
                                    description: "自動ログイン用の仮想FIDO認証器を登録する",
                                    args: { head: headArgument },
                                    run: (command) =>
                                        run(
                                            registerFido.execute(command.values.head).pipe(
                                                Effect.andThen(display("仮想FIDO認証器を登録しました。")),
                                            ),
                                        ),
                                }),
                                login: gunshi.define({
                                    name: "login",
                                    description: "KU-LMSへログインする",
                                    args: { head: headArgument },
                                    run: (command) => runLogin(command.values.head),
                                }),
                                logout: gunshi.define({
                                    name: "logout",
                                    description: "ローカルの認証情報を削除する",
                                    run: runLogout,
                                }),
                                status: gunshi.define({
                                    name: "status",
                                    description: "保存済みの認証状態をheadlessで確認する",
                                    run: runAuthenticationStatus,
                                }),
                            },
                        }),
                        course: gunshi.define({
                            name: "course",
                            description: "講義を表示する",
                            subCommands: {
                                list: gunshi.define({
                                    name: "list",
                                    description: "講義一覧を表示する",
                                    args: { sync: syncArgument, head: headArgument },
                                    run: (command) => runCourseList(command.values.sync, command.values.head),
                                }),
                            },
                        }),
                        material: gunshi.define({
                            name: "material",
                            description: "教材を表示する",
                            subCommands: {
                                list: gunshi.define({
                                    name: "list",
                                    description: "教材一覧を講義ごとに表示する",
                                    args: {
                                        course: {
                                            type: "string",
                                            multiple: true,
                                            description: "対象のLMS講義ID（複数指定可）",
                                        },
                                        sync: syncArgument,
                                        head: headArgument,
                                    },
                                    run: (command) =>
                                        runMaterialList(
                                            command.values.course,
                                            command.values.sync,
                                            command.values.head,
                                        ),
                                }),
                                view: gunshi.define({
                                    name: "view",
                                    description: "教材の詳細を表示する",
                                    args: {
                                        materialId: {
                                            type: "positional",
                                            required: true,
                                            description: "LMS教材ID",
                                        },
                                        sync: syncArgument,
                                        head: headArgument,
                                    },
                                    run: (command) =>
                                        runMaterialView(
                                            command.values.materialId,
                                            command.values.sync,
                                            command.values.head,
                                        ),
                                }),
                            },
                        }),
                    },
                },
            ),
        catch: (cause) => new CliCommandError({ message: cause instanceof Error ? cause.message : String(cause) }),
    }).pipe(
        Effect.asVoid,
        Effect.catch((error) => display(error.message).pipe(Effect.andThen(markFailure))),
    );
    return exitCode;
});

export const CliInboundAdapter = { run: main };

export const printCourse = Effect.fn("CliInboundAdapter.printCourse")(function* (course: Course) {
    yield* display(`講義名: ${course.name}`);
    if (course.availability === "unavailable") {
        yield* display("  利用不可");
        return;
    }
    yield* display(`  LMS講義ID: ${course.lmsCourseId}`);
});

export const printCourseMaterials = Effect.fn("CliInboundAdapter.printCourseMaterials")(
    function* (courseMaterials: CourseMaterials) {
        yield* display(`LMS講義ID: ${courseMaterials.lmsCourseId}`);
        if (courseMaterials.folders.length === 0) {
            yield* display("教材フォルダー: （なし）");
            return;
        }
        for (const folder of courseMaterials.folders) {
            yield* display(`教材フォルダー: ${folder.name}`);
            if (folder.classDate !== undefined) yield* display(`  授業実施日: ${folder.classDate.toISOString()}`);
            if (folder.materials.length === 0) yield* display("  教材: （なし）");
            for (const material of folder.materials) yield* printMaterial(material, "  ");
        }
    },
);

const printMaterialListResult = Effect.fn("CliInboundAdapter.printMaterialListResult")(function* (
    result: MaterialListResult,
) {
    yield* Effect.forEach(result.courseMaterials, printCourseMaterials);
    for (const failure of result.failures) {
        yield* display(`講義 ${failure.lmsCourseId}: ${failure.error.message}`);
    }
    return result;
});

export const printMaterialDetail = Effect.fn("CliInboundAdapter.printMaterialDetail")(function* (
    detail: MaterialDetail,
) {
    yield* display(`講義名: ${detail.course.name}`);
    yield* display(`LMS講義ID: ${detail.course.lmsCourseId}`);
    yield* printMaterial(detail.material);
    if (detail.resources.length === 0) {
        yield* display("資料: （なし）");
        return;
    }
    for (const resource of detail.resources) yield* display(`資料: ${resource.name}`);
});

const printMaterial = Effect.fn("CliInboundAdapter.printMaterial")(function* (
    material: Material,
    indent = "",
) {
    yield* display(`${indent}教材: ${material.name}`);
    yield* display(`${indent}  LMS教材ID: ${material.lmsMaterialId}`);
    yield* display(`${indent}  種類: ${material.type}`);
    yield* display(
        `${indent}  公開期限: ${
            material.publicationDeadline instanceof Date
                ? material.publicationDeadline.toISOString()
                : material.publicationDeadline
        }`,
    );
    if (material.type === "material") {
        yield* display(
            `${indent}  資料公開状態: ${material.resourceAvailability === "available" ? "公開中" : "未公開"}`,
        );
    }
});
