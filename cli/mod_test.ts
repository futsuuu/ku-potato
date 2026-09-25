import { assertEquals } from "@std/assert";
import type {
    GetAuthenticationStatus,
    ListCourses,
    ListMaterials,
    Login,
    Logout,
    ViewMaterial,
} from "ku-potato-core/in_port";
import {
    LmsAuthenticationGateway,
    LmsCacheGateway,
    LmsSourceGateway,
    LmsSourceGatewayError,
} from "ku-potato-core/out_port";
import { LmsCourseId } from "ku-potato-domain";
import { Effect } from "effect";
import { CliInboundAdapter } from "./mod.ts";

Deno.test("階層化したコマンドはポリシーとIDを対応する入力ポートへ渡す", async () => {
    const calls: string[] = [];
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
        execute: ({ sync, head }) => Effect.sync(() => calls.push(`course-list:${sync}:${head}`)).pipe(Effect.as([])),
    };
    const listMaterials: ListMaterials = {
        execute: ({ lmsCourseIds, sync, head }) =>
            Effect.sync(() => calls.push(`material-list:${lmsCourseIds.join(",")}:${sync}:${head}`)).pipe(
                Effect.as({ courseMaterials: [], failures: [] }),
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

    assertEquals(await runCli(["auth", "login", "--head", "false"], ports({ login })), 0);
    assertEquals(await runCli(["auth", "logout"], ports({ logout })), 0);
    assertEquals(await runCli(["auth", "status"], ports({ status })), 0);
    assertEquals(await runCli(["course", "list", "--sync", "true", "--head", "false"], ports({ listCourses })), 0);
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
        ),
        0,
    );
    assertEquals(
        await runCli(["material", "view", "SRY1", "--head", "true"], ports({ viewMaterial })),
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
});

Deno.test("教材一覧の部分失敗は終了コード1を返す", async () => {
    const listMaterials: ListMaterials = {
        execute: () =>
            Effect.succeed({
                courseMaterials: [],
                failures: [{
                    lmsCourseId: LmsCourseId("course-1"),
                    error: new LmsSourceGatewayError({ operation: "fetch", message: "broken" }),
                }],
            }),
    };

    assertEquals(await runCli(["material", "list"], ports({ listMaterials })), 1);
});

type Ports = {
    readonly login: Login;
    readonly logout: Logout;
    readonly status: GetAuthenticationStatus;
    readonly listCourses: ListCourses;
    readonly listMaterials: ListMaterials;
    readonly viewMaterial: ViewMaterial;
};

const ports = (overrides: Partial<Ports>): Ports => ({
    login: { execute: () => Effect.die("unexpected auth login") },
    logout: { execute: Effect.die("unexpected auth logout") },
    status: { execute: Effect.die("unexpected auth status") },
    listCourses: { execute: () => Effect.die("unexpected course list") },
    listMaterials: { execute: () => Effect.die("unexpected material list") },
    viewMaterial: { execute: () => Effect.die("unexpected material view") },
    ...overrides,
});

const runCli = (commandArgs: readonly string[], inputPorts: Ports) =>
    Effect.runPromise(
        CliInboundAdapter.run(
            commandArgs,
            inputPorts.login,
            inputPorts.logout,
            inputPorts.status,
            inputPorts.listCourses,
            inputPorts.listMaterials,
            inputPorts.viewMaterial,
        ).pipe(
            Effect.provideService(LmsAuthenticationGateway, unavailableAuthentication),
            Effect.provideService(LmsCacheGateway, unavailableCache),
            Effect.provideService(LmsSourceGateway, unavailableSource),
        ),
    );

const unavailableAuthentication = LmsAuthenticationGateway.of({
    login: () => Effect.die("unexpected authentication login"),
    logout: Effect.die("unexpected authentication logout"),
    status: Effect.die("unexpected authentication status"),
});

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
