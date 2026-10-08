import { assert, assertEquals } from "@std/assert";
import { DateTime, Effect } from "effect";
import { Application, ApplicationError, type ListMaterials } from "../core/in_port.ts";
import { LmsCourseId, LmsMaterialId, LmsResourceId, type Material, type MaterialDetail } from "../domain/mod.ts";
import { upcomingAssignments } from "./client/assignments.ts";
import { DesktopInboundAdapter } from "./mod.ts";

const courseId = LmsCourseId("course-1");
const otherCourseId = LmsCourseId("course-2");
const failedCourseId = LmsCourseId("course-failed");
const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-04T12:00:00+09:00"));

const assignmentMaterial = (
    id: string,
    type: Material["type"],
    deadline: number | "no-deadline" | "unavailable",
): Material => {
    const common = {
        lmsMaterialId: LmsMaterialId(id),
        name: id,
        publicationDeadline: typeof deadline === "number"
            ? DateTime.toDateUtc(DateTime.makeUnsafe(deadline))
            : deadline,
    };
    return type === "material" ? { ...common, type, resourceAvailability: "available" } : { ...common, type };
};

const assignmentApplication = (listMaterials: ListMaterials) =>
    Application.of({
        login: { execute: () => Effect.die("unexpected login") },
        registerWebAuthnCredential: { execute: () => Effect.die("unexpected WebAuthn registration") },
        logout: { execute: Effect.die("unexpected logout") },
        getAuthenticationStatus: { execute: Effect.die("unexpected authentication status") },
        listCourses: { execute: () => Effect.die("unexpected course list") },
        listMaterials,
        viewMaterial: { execute: () => Effect.die("unexpected material view") },
        downloadResource: { execute: () => Effect.die("unexpected resource download") },
    });

Deno.test("desktop aggregates assignments across courses and keeps partial failures", async () => {
    const requested: Parameters<ListMaterials["execute"]>[0][] = [];
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listAssignments([courseId, otherCourseId, failedCourseId], "true").pipe(
            Effect.provideService(
                Application,
                assignmentApplication({
                    execute: (options) => {
                        requested.push(options);
                        return Effect.succeed({
                            courseMaterials: [{
                                lmsCourseId: courseId,
                                folders: [{
                                    name: "Week 1",
                                    materials: [
                                        assignmentMaterial("no-deadline", "report", "no-deadline"),
                                        assignmentMaterial("later", "e-learning", now + 2000),
                                        assignmentMaterial("expired", "test", now - 1),
                                        assignmentMaterial("exact-deadline", "report", now),
                                        assignmentMaterial("closed", "e-learning", "unavailable"),
                                        assignmentMaterial("handout", "material", now + 1),
                                        assignmentMaterial("survey", "questionnaire", now + 1750),
                                        assignmentMaterial("survey-no-deadline", "questionnaire", "no-deadline"),
                                        assignmentMaterial("survey-expired", "questionnaire", now - 1),
                                    ],
                                }, {
                                    name: "Week 2",
                                    materials: [assignmentMaterial("soon", "test", now + 1000)],
                                }],
                            }, {
                                lmsCourseId: otherCourseId,
                                folders: [{
                                    name: "Homework",
                                    materials: [assignmentMaterial("other-course", "report", now + 1500)],
                                }],
                            }],
                            failures: [{
                                lmsCourseId: failedCourseId,
                                error: new ApplicationError({ reason: "source", message: "LMS unavailable" }),
                            }],
                        });
                    },
                }),
            ),
        ),
    );
    assertEquals(requested, [{
        lmsCourseIds: [courseId, otherCourseId, failedCourseId],
        sync: "true",
        head: "auto",
    }]);
    assert(result.status === "success");
    const upcoming = upcomingAssignments(result.data.assignments, now);
    assertEquals(upcoming.map(({ material }) => material.name), ["soon", "other-course", "survey", "later"]);
    assertEquals(upcoming.map(({ folderName }) => folderName), ["Week 2", "Homework", "Week 1", "Week 1"]);
    assertEquals(upcoming[1]?.lmsCourseId, otherCourseId);
    assertEquals(upcoming[0]?.material.publicationDeadline, "2026-10-04T03:00:01.000Z");
    assertEquals(result.data.failures, [{
        lmsCourseId: failedCourseId,
        error: { reason: "source", message: "LMS unavailable" },
    }]);
    // The same archived results stop showing assignments as their deadlines arrive.
    assertEquals(upcomingAssignments(result.data.assignments, now + 2000), []);
});

Deno.test("desktop does not discover all courses when no courses are available", async () => {
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listAssignments([], "auto").pipe(
            Effect.provideService(
                Application,
                assignmentApplication({
                    execute: () => Effect.die("unexpected material list"),
                }),
            ),
        ),
    );
    assertEquals(result, { status: "success", data: { assignments: [], failures: [] } });
});

Deno.test("desktop surfaces assignment query failures", async () => {
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listAssignments([courseId], "auto").pipe(
            Effect.provideService(
                Application,
                assignmentApplication({
                    execute: () =>
                        Effect.fail(
                            new ApplicationError({ reason: "authentication-required", message: "Login required" }),
                        ),
                }),
            ),
        ),
    );
    assertEquals(result, {
        status: "error",
        error: { reason: "authentication-required", message: "Login required" },
    });
});

const course = { lmsCourseId: LmsCourseId("course-1"), name: "Programming", availability: "available" } as const;
const material = {
    lmsMaterialId: LmsMaterialId("material-1"),
    name: "Handout",
    type: "material",
    publicationDeadline: "unavailable",
    resourceAvailability: "unavailable",
} as const;

const application = (viewMaterial: Application["Service"]["viewMaterial"]): Application["Service"] => ({
    login: { execute: () => Effect.die("unexpected login") },
    logout: { execute: Effect.die("unexpected logout") },
    registerWebAuthnCredential: { execute: () => Effect.die("unexpected credential registration") },
    getAuthenticationStatus: { execute: Effect.die("unexpected authentication status") },
    listCourses: { execute: () => Effect.succeed([course]) },
    listMaterials: {
        execute: () =>
            Effect.succeed({
                courseMaterials: [{
                    lmsCourseId: course.lmsCourseId,
                    folders: [{
                        name: "Week 1",
                        materials: [
                            material,
                            {
                                ...material,
                                lmsMaterialId: LmsMaterialId("material-2"),
                                resourceAvailability: "available",
                            },
                            { ...material, lmsMaterialId: LmsMaterialId("material-3"), type: "report" },
                        ],
                    }],
                }],
                failures: [],
            }),
    },
    viewMaterial,
    downloadResource: { execute: () => Effect.die("unexpected download") },
});

Deno.test.each([
    { name: "not retrieved", resources: undefined },
    { name: "empty list", resources: [] },
    {
        name: "one resource",
        resources: [{
            name: "handout.pdf",
            lmsResourceId: LmsResourceId("SRS1"),
            type: "file",
            sourceKind: "ファイル資料",
        }],
    },
])("desktop exposes unavailable material resources when archived: $name", async ({ resources }) => {
    const calls: string[] = [];
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listMaterials(course.lmsCourseId, "true").pipe(
            Effect.provideService(
                Application,
                application({
                    execute: (options) => {
                        assertEquals(options, {
                            lmsMaterialId: material.lmsMaterialId,
                            sync: "false",
                            head: "auto",
                        });
                        calls.push(options.lmsMaterialId);
                        return resources === undefined
                            ? Effect.fail(
                                new ApplicationError({ reason: "archive-data-missing", message: "Not retrieved" }),
                            )
                            : Effect.succeed({ course, material, resources });
                    },
                }),
            ),
        ),
    );
    assertEquals(calls, [material.lmsMaterialId]);
    assertEquals(result.status, "success");
    if (result.status === "success") {
        assertEquals(result.data.folders[0]?.materials.map((item) => item.canViewResources), [
            resources !== undefined,
            true,
            false,
        ]);
    }
});

Deno.test("desktop displays archived resources for an unavailable material", async () => {
    const detail = {
        course,
        material,
        resources: [{
            name: "handout.pdf",
            lmsResourceId: LmsResourceId("SRS1"),
            type: "file",
            sourceKind: "ファイル資料",
        }],
    } satisfies MaterialDetail;
    const result = await Effect.runPromise(
        DesktopInboundAdapter.viewMaterial(material.lmsMaterialId, "auto").pipe(
            Effect.provideService(
                Application,
                application({
                    execute: (options) => {
                        assertEquals(options, { lmsMaterialId: material.lmsMaterialId, sync: "auto", head: "auto" });
                        return Effect.succeed(detail);
                    },
                }),
            ),
        ),
    );
    assertEquals(result, { status: "success", data: detail });
});

Deno.test("desktop reports archive read failures when checking unavailable materials", async () => {
    const error = new ApplicationError({ reason: "archive", message: "Cannot read archive" });
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listMaterials(course.lmsCourseId, "auto").pipe(
            Effect.provideService(Application, application({ execute: () => Effect.fail(error) })),
        ),
    );
    assertEquals(result, { status: "error", error: { reason: error.reason, message: error.message } });
});
