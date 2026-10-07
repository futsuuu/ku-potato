import { assert, assertEquals } from "@std/assert";
import { DateTime, Effect } from "effect";
import { Application, ApplicationError, type ListMaterials } from "../core/in_port.ts";
import { LmsCourseId, LmsMaterialId, type Material } from "../domain/mod.ts";
import { upcomingAssignments } from "./client/assignments.ts";
import { DesktopInboundAdapter } from "./mod.ts";

const courseId = LmsCourseId("course-1");
const otherCourseId = LmsCourseId("course-2");
const failedCourseId = LmsCourseId("course-failed");
const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-04T12:00:00+09:00"));

const material = (
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

const application = (listMaterials: ListMaterials) =>
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
                application({
                    execute: (options) => {
                        requested.push(options);
                        return Effect.succeed({
                            courseMaterials: [{
                                lmsCourseId: courseId,
                                folders: [{
                                    name: "Week 1",
                                    materials: [
                                        material("no-deadline", "report", "no-deadline"),
                                        material("later", "e-learning", now + 2000),
                                        material("expired", "test", now - 1),
                                        material("exact-deadline", "report", now),
                                        material("closed", "e-learning", "unavailable"),
                                        material("handout", "material", now + 1),
                                        material("survey", "questionnaire", now + 1750),
                                        material("survey-no-deadline", "questionnaire", "no-deadline"),
                                        material("survey-expired", "questionnaire", now - 1),
                                    ],
                                }, {
                                    name: "Week 2",
                                    materials: [material("soon", "test", now + 1000)],
                                }],
                            }, {
                                lmsCourseId: otherCourseId,
                                folders: [{
                                    name: "Homework",
                                    materials: [material("other-course", "report", now + 1500)],
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
    // The same cached results stop showing assignments as their deadlines arrive.
    assertEquals(upcomingAssignments(result.data.assignments, now + 2000), []);
});

Deno.test("desktop does not discover all courses when no courses are available", async () => {
    const result = await Effect.runPromise(
        DesktopInboundAdapter.listAssignments([], "auto").pipe(
            Effect.provideService(
                Application,
                application({
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
                application({
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
