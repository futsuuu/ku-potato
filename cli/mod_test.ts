import { assertEquals } from "@std/assert";
import type {
    GetAuthenticationStatus,
    ListCourses,
    ListMaterials,
    Login,
    Logout,
    RegisterWebAuthnCredential,
    ViewMaterial,
} from "../core/in_port.ts";
import { Application, ApplicationError } from "../core/in_port.ts";
import { LmsCourseId, LmsMaterialId } from "../domain/mod.ts";
import { Effect, Terminal } from "effect";
import { CliInboundAdapter } from "./mod.ts";

Deno.test("階層化したコマンドはポリシーとIDを対応する入力ポートへ渡す", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const login: Login = {
        execute: (head) => Effect.sync(() => calls.push(`auth-login:${head}`)).pipe(Effect.asVoid),
    };
    const logout: Logout = {
        execute: Effect.sync(() => calls.push("auth-logout")).pipe(Effect.asVoid),
    };
    const status: GetAuthenticationStatus = {
        execute: Effect.sync(() => calls.push("auth-status")).pipe(Effect.as("authenticated" as const)),
    };
    const listCourses: ListCourses = {
        execute: ({ sync, head }) =>
            Effect.sync(() => calls.push(`course-list:${sync}:${head}`)).pipe(Effect.as([
                { lmsCourseId: LmsCourseId("course-1"), name: "Programming", availability: "available" as const },
                { name: "Closed", availability: "unavailable" as const },
            ])),
    };
    const listMaterials: ListMaterials = {
        execute: ({ lmsCourseIds, sync, head }) =>
            Effect.sync(() => calls.push(`material-list:${lmsCourseIds.join(",")}:${sync}:${head}`)).pipe(
                Effect.as({
                    courseMaterials: [{
                        lmsCourseId: LmsCourseId("course-1"),
                        folders: [{ name: "Week 1", materials: [] }],
                    }],
                    failures: [],
                }),
            ),
    };
    const viewMaterial: ViewMaterial = {
        execute: ({ lmsMaterialId, sync, head }) =>
            Effect.sync(() => calls.push(`material-view:${lmsMaterialId}:${sync}:${head}`)).pipe(
                Effect.as({
                    course: {
                        lmsCourseId: LmsCourseId("course-1"),
                        name: "Programming",
                        availability: "available" as const,
                    },
                    material: {
                        lmsMaterialId,
                        name: "Handout",
                        type: "material" as const,
                        publicationDeadline: "no-deadline" as const,
                        resourceAvailability: "available" as const,
                    },
                    resources: [],
                }),
            ),
    };

    assertEquals(await runCli(["auth", "login", "--head", "false"], ports({ login }), output), 0);
    assertEquals(await runCli(["auth", "logout"], ports({ logout }), output), 0);
    assertEquals(await runCli(["auth", "status"], ports({ status }), output), 0);
    assertEquals(
        await runCli(["course", "list", "--sync", "true", "--head", "false"], ports({ listCourses }), output),
        0,
    );
    assertEquals(
        await runCli(
            [
                "material",
                "list",
                "--course",
                "course-1",
                "--course",
                "course-2",
                "--sync",
                "false",
            ],
            ports({ listMaterials }),
            output,
        ),
        0,
    );
    assertEquals(
        await runCli(["material", "view", "SRY1", "--head", "true"], ports({ viewMaterial }), output),
        0,
    );

    assertEquals(calls, [
        "auth-login:false",
        "auth-logout",
        "auth-status",
        "course-list:true:false",
        "material-list:course-1,course-2:false:auto",
        "material-view:SRY1:auto:true",
    ]);
    assertEquals(output, [
        "KU-LMSにログインしました。\n",
        "ローカルの認証情報を削除しました。\n",
        "認証済み\n",
        "講義名: Programming\n",
        "  LMS講義ID: course-1\n",
        "講義名: Closed\n",
        "  利用不可\n",
        "LMS講義ID: course-1\n",
        "教材フォルダー: Week 1\n",
        "  教材: （なし）\n",
        "講義名: Programming\n",
        "LMS講義ID: course-1\n",
        "教材: Handout\n",
        "  LMS教材ID: SRY1\n",
        "  種類: material\n",
        "  公開期限: no-deadline\n",
        "  資料公開状態: 公開中\n",
        "資料: （なし）\n",
    ]);
});

Deno.test("WebAuthnクレデンシャル登録コマンドは入力ポートへブラウザ表示ポリシーを渡す", async () => {
    const heads: string[] = [];
    const output: string[] = [];
    const registerWebAuthnCredential: RegisterWebAuthnCredential = {
        execute: (head) =>
            Effect.sync(() => {
                heads.push(head);
            }),
    };
    assertEquals(
        await runCli(
            ["auth", "register-webauthn-credential", "--head", "false"],
            ports({ registerWebAuthnCredential }),
            output,
        ),
        0,
    );
    assertEquals(heads, ["false"]);
    assertEquals(output, ["仮想認証器でWebAuthnクレデンシャルを登録しました。\n"]);
});

Deno.test("コマンドの失敗はTerminalに表示して終了コード1を返す", async () => {
    const output: string[] = [];
    const login: Login = {
        execute: () => Effect.fail(new ApplicationError({ reason: "source", message: "ログイン失敗" })),
    };

    assertEquals(await runCli(["auth", "login"], ports({ login }), output), 1);
    assertEquals(output, ["ログイン失敗\n"]);
});

Deno.test("教材一覧の部分失敗は終了コード1を返す", async () => {
    const output: string[] = [];
    const listMaterials: ListMaterials = {
        execute: () =>
            Effect.succeed({
                courseMaterials: [],
                failures: [{
                    lmsCourseId: LmsCourseId("course-1"),
                    error: new ApplicationError({ reason: "source", message: "broken" }),
                }],
            }),
    };

    assertEquals(await runCli(["material", "list"], ports({ listMaterials }), output), 1);
    assertEquals(output, ["講義 course-1: broken\n"]);
});

Deno.test("不明なコマンドはTerminalに表示して終了コード1を返す", async () => {
    const output: string[] = [];

    assertEquals(await runCli(["course", "unknown"], ports({}), output), 1);
    assertEquals(output, ["Command not found: unknown\n"]);
});

type Ports = {
    readonly login: Login;
    readonly registerWebAuthnCredential: RegisterWebAuthnCredential;
    readonly logout: Logout;
    readonly status: GetAuthenticationStatus;
    readonly listCourses: ListCourses;
    readonly listMaterials: ListMaterials;
    readonly viewMaterial: ViewMaterial;
    readonly downloadResource: Application["Service"]["downloadResource"];
};

const ports = (overrides: Partial<Ports>): Ports => ({
    login: { execute: () => Effect.die("unexpected auth login") },
    registerWebAuthnCredential: { execute: () => Effect.die("unexpected WebAuthn credential registration") },
    logout: { execute: Effect.die("unexpected auth logout") },
    status: { execute: Effect.die("unexpected auth status") },
    listCourses: { execute: () => Effect.die("unexpected course list") },
    listMaterials: { execute: () => Effect.die("unexpected material list") },
    viewMaterial: { execute: () => Effect.die("unexpected material view") },
    downloadResource: { execute: () => Effect.die("unexpected resource download") },
    ...overrides,
});

const runCli = (commandArgs: readonly string[], inputPorts: Ports, output: string[]) =>
    Effect.runPromise(
        CliInboundAdapter.run(commandArgs).pipe(
            Effect.provideService(
                Application,
                Application.of({
                    login: inputPorts.login,
                    registerWebAuthnCredential: inputPorts.registerWebAuthnCredential,
                    logout: inputPorts.logout,
                    getAuthenticationStatus: inputPorts.status,
                    listCourses: inputPorts.listCourses,
                    listMaterials: inputPorts.listMaterials,
                    viewMaterial: inputPorts.viewMaterial,
                    downloadResource: inputPorts.downloadResource,
                }),
            ),
            Effect.provideService(
                Terminal.Terminal,
                Terminal.make({
                    columns: Effect.succeed(80),
                    rows: Effect.succeed(24),
                    readInput: Effect.die("unexpected terminal input"),
                    readLine: Effect.die("unexpected terminal line"),
                    display: (text) =>
                        Effect.sync(() => {
                            output.push(text);
                        }),
                }),
            ),
        ),
    );

Deno.test("resource download prints only the downloaded path or external URL", async () => {
    for (
        const result of [
            { type: "file", path: "C:\\Temp\\handout.pdf" },
            { type: "external", url: "https://example.com/shared" },
        ] as const
    ) {
        const output: string[] = [];
        const input = ports({
            downloadResource: {
                execute: (options) => {
                    assertEquals(options, { lmsMaterialId: LmsMaterialId("SRY1"), position: 1, head: "false" });
                    return Effect.succeed(result);
                },
            },
        });
        assertEquals(await runCli(["resource", "download", "SRY1", "1", "--head", "false"], input, output), 0);
        assertEquals(output, [`${result.type === "file" ? result.path : result.url}\n`]);
    }
});

Deno.test("resource download failures return exit code 1", async () => {
    const output: string[] = [];
    const input = ports({
        downloadResource: {
            execute: () =>
                Effect.fail(
                    new ApplicationError({
                        reason: "source",
                        message: "資料が見つかりません。",
                    }),
                ),
        },
    });
    assertEquals(await runCli(["resource", "download", "SRY1", "0"], input, output), 1);
    assertEquals(output, ["資料が見つかりません。\n"]);
});
