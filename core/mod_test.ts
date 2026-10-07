import { assert, assertEquals } from "@std/assert";
import { Application } from "./in_port.ts";
import {
    LmsArchiveDataMissingError,
    LmsArchiveGateway,
    type LmsArchiveGatewayService,
    LmsAuthenticationGateway,
    LmsCourseNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceGatewayService,
    type LmsSourceSession,
    ResourceFileGateway,
} from "./out_port.ts";
import {
    type Course,
    type CourseMaterials,
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    LmsResourceId,
    type MaterialDetail,
    type MaterialResourcesSnapshot,
} from "../domain/mod.ts";
import { Effect, Layer, Result } from "effect";
import { ApplicationLive } from "./mod.ts";

const courseId = LmsCourseId("course-1");
const missingCourseId = LmsCourseId("course-missing");
const brokenCourseId = LmsCourseId("course-broken");
const course = {
    lmsCourseId: courseId,
    name: "Programming",
    availability: "available",
} as const;
const courses: readonly Course[] = [course];
const courseMaterials: CourseMaterials = {
    lmsCourseId: courseId,
    folders: [{
        name: "Week 1",
        materials: [{
            lmsMaterialId: LmsMaterialId("SRY1"),
            name: "Handout",
            type: "material",
            publicationDeadline: "no-deadline",
            resourceAvailability: "available",
        }],
    }],
};

Deno.test("course list auto reads a complete archive without opening an LMS session", async () => {
    const archive = LmsArchiveGateway.of(archiveGateway({ listCourses: Effect.succeed(courses) }));
    const source = LmsSourceGateway.of({ withSession: () => Effect.die("unexpected LMS session") });

    const result = await Effect.runPromise(
        Application.use((app) => app.listCourses.execute({ sync: "auto", head: "auto" })).pipe(
            Effect.provide(testApplicationLayer(archive, source)),
        ),
    );

    assertEquals(result, courses);
});

Deno.test("course list auto fetches and archives a missing course snapshot", async () => {
    let archivedCourses: readonly Course[] | undefined;
    const archive = LmsArchiveGateway.of(archiveGateway({
        listCourses: Effect.suspend(() =>
            archivedCourses === undefined
                ? Effect.fail(archiveDataMissing("listCourses"))
                : Effect.succeed(archivedCourses)
        ),
        appendCourses: (retrievedCourses) =>
            Effect.sync(() => {
                archivedCourses = retrievedCourses;
            }),
    }));
    const heads: string[] = [];
    const source = LmsSourceGateway.of(sourceGateway({ fetchCourses: Effect.succeed(courses) }, heads));

    const result = await Effect.runPromise(
        Application.use((app) => app.listCourses.execute({ sync: "auto", head: "false" })).pipe(
            Effect.provide(testApplicationLayer(archive, source)),
        ),
    );

    assertEquals(result, courses);
    assertEquals(heads, ["false"]);
});

Deno.test("application translates source failures before returning them to the inbound adapter", async () => {
    const archive = LmsArchiveGateway.of(archiveGateway({}));
    const source = LmsSourceGateway.of(sourceGateway({
        fetchCourses: Effect.fail(new LmsSourceGatewayError({ operation: "fetch", message: "LMS unavailable" })),
    }));

    const result = await Effect.runPromise(Effect.result(
        Application.use((app) => app.listCourses.execute({ sync: "true", head: "false" })).pipe(
            Effect.provide(testApplicationLayer(archive, source)),
        ),
    ));

    assert(Result.isFailure(result));
    assertEquals(result.failure._tag, "ApplicationError");
    assertEquals(result.failure.reason, "source");
    assertEquals(result.failure.message, "LMS unavailable");
});

Deno.test("material list ignores missing courses and retains internal failures", async () => {
    const stored = new Map<string, CourseMaterials>();
    const archive = LmsArchiveGateway.of(archiveGateway({
        appendCourseMaterials: (snapshot) =>
            Effect.sync(() => {
                stored.set(snapshot.courseMaterials.lmsCourseId, snapshot.courseMaterials);
            }),
        listCourseMaterials: (lmsCourseId) => {
            const value = stored.get(lmsCourseId);
            return value === undefined ? Effect.fail(archiveDataMissing("listCourseMaterials")) : Effect.succeed(value);
        },
    }));
    const snapshot: CourseMaterialsSnapshot = { courses, courseMaterials };
    const source = LmsSourceGateway.of(sourceGateway({
        fetchCourseMaterials: (lmsCourseId) => {
            if (lmsCourseId === courseId) return Effect.succeed(snapshot);
            if (lmsCourseId === missingCourseId) {
                return Effect.fail(new LmsCourseNotFoundError({ lmsCourseId, message: "missing" }));
            }
            return Effect.fail(new LmsSourceGatewayError({ operation: "fetch", message: "broken" }));
        },
    }));

    const result = await Effect.runPromise(
        Application.use((app) =>
            app.listMaterials.execute({
                lmsCourseIds: [courseId, missingCourseId, brokenCourseId, courseId],
                sync: "true",
                head: "auto",
            })
        ).pipe(
            Effect.provide(testApplicationLayer(archive, source)),
        ),
    );

    assertEquals(result.courseMaterials, [courseMaterials]);
    assertEquals(result.failures.map(({ lmsCourseId, error }) => [lmsCourseId, error.message]), [
        [brokenCourseId, "broken"],
    ]);
    assertEquals(result.failures[0]?.error.reason, "source");
});

Deno.test("material list auto discovers archived courses and fetches only missing materials", async () => {
    let stored: CourseMaterials | undefined;
    const archive = LmsArchiveGateway.of(archiveGateway({
        listCourses: Effect.succeed(courses),
        listCourseMaterials: () =>
            stored === undefined ? Effect.fail(archiveDataMissing("listCourseMaterials")) : Effect.succeed(stored),
        appendCourseMaterials: (snapshot) =>
            Effect.sync(() => {
                stored = snapshot.courseMaterials;
            }),
    }));
    const heads: string[] = [];
    const source = LmsSourceGateway.of(sourceGateway({
        fetchCourseMaterials: () => Effect.succeed({ courses, courseMaterials }),
    }, heads));

    const result = await Effect.runPromise(
        Application.use((app) => app.listMaterials.execute({ lmsCourseIds: [], sync: "auto", head: "false" })).pipe(
            Effect.provide(testApplicationLayer(archive, source)),
        ),
    );

    assertEquals(result, { courseMaterials: [courseMaterials], failures: [] });
    assertEquals(heads, ["false"]);
});

for (const sync of ["true", "auto"] as const) {
    for (const preferredCourseId of [courseId, undefined]) {
        Deno.test(`material view ${sync} fetches resources with course hint ${preferredCourseId}`, async () => {
            const material = courseMaterials.folders[0]!.materials[0]!;
            const materialDetail: MaterialDetail = {
                course,
                material,
                resources: [{ name: "week-1.pdf" }],
            };
            const snapshot: MaterialResourcesSnapshot = {
                courses,
                courseMaterials,
                materialResources: {
                    lmsMaterialId: material.lmsMaterialId,
                    resources: materialDetail.resources,
                },
            };
            let stored: MaterialDetail | undefined;
            const archive = LmsArchiveGateway.of(archiveGateway({
                findMaterialCourseId: () => Effect.succeed(preferredCourseId),
                getMaterialDetail: () =>
                    Effect.suspend(() =>
                        stored === undefined
                            ? Effect.fail(archiveDataMissing("getMaterialDetail"))
                            : Effect.succeed(stored)
                    ),
                appendMaterialResources: () =>
                    Effect.sync(() => {
                        stored = materialDetail;
                    }),
            }));
            const heads: string[] = [];
            const source = LmsSourceGateway.of(sourceGateway({
                fetchMaterialResources: (lmsMaterialId, actualCourseId) => {
                    assertEquals(lmsMaterialId, material.lmsMaterialId);
                    assertEquals(actualCourseId, preferredCourseId);
                    return Effect.succeed(snapshot);
                },
            }, heads));

            const result = await Effect.runPromise(
                Application.use((app) =>
                    app.viewMaterial.execute({ lmsMaterialId: material.lmsMaterialId, sync, head: "true" })
                ).pipe(
                    Effect.provide(testApplicationLayer(archive, source)),
                ),
            );

            assertEquals(result, materialDetail);
            assertEquals(heads, ["true"]);
        });
    }
}

Deno.test("material view uses a complete archive without looking up a course hint or opening the LMS", async () => {
    const detail: MaterialDetail = { course, material: courseMaterials.folders[0]!.materials[0]!, resources: [] };
    const archive = LmsArchiveGateway.of(archiveGateway({ getMaterialDetail: () => Effect.succeed(detail) }));
    const source = LmsSourceGateway.of({ withSession: () => Effect.die("unexpected LMS session") });
    for (const sync of ["auto", "false"] as const) {
        assertEquals(
            await Effect.runPromise(
                Application.use((app) =>
                    app.viewMaterial.execute({ lmsMaterialId: detail.material.lmsMaterialId, sync, head: "false" })
                ).pipe(Effect.provide(testApplicationLayer(archive, source))),
            ),
            detail,
        );
    }
});

const testApplicationLayer = (
    archive: LmsArchiveGateway["Service"],
    source: LmsSourceGateway["Service"],
) => ApplicationLive.pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(
        LmsAuthenticationGateway,
        LmsAuthenticationGateway.of({
            login: () => Effect.die("unexpected login"),
            registerWebAuthnCredential: () => Effect.die("unexpected WebAuthn credential registration"),
            logout: Effect.die("unexpected logout"),
            status: Effect.die("unexpected status"),
        }),
    ),
    Layer.succeed(LmsArchiveGateway, archive),
    Layer.succeed(LmsSourceGateway, source),
    Layer.succeed(ResourceFileGateway, {
        path: () => "saved-path",
        save: () => Effect.die("unexpected save"),
        remove: () => Effect.die("unexpected remove"),
        discardDownload: () => Effect.die("unexpected discard"),
        withResourceLock: (_id, use) => use,
    }),
)));

const archiveGateway = (overrides: Partial<LmsArchiveGatewayService>): LmsArchiveGatewayService => ({
    getResourceState: () => Effect.die("unexpected getResourceState"),
    recordResourceAttempt: () => Effect.die("unexpected recordResourceAttempt"),
    commitResourceAcquisition: () => Effect.die("unexpected commitResourceAcquisition"),
    findMaterialCourseId: () => Effect.die("unexpected findMaterialCourseId"),
    listCourses: Effect.die("unexpected listCourses"),
    listCourseMaterials: () => Effect.die("unexpected listCourseMaterials"),
    listMaterialResources: () => Effect.die("unexpected listMaterialResources"),
    getMaterialDetail: () => Effect.die("unexpected getMaterialDetail"),
    appendCourses: () => Effect.die("unexpected appendCourses"),
    appendCourseMaterials: () => Effect.die("unexpected appendCourseMaterials"),
    appendMaterialResources: () => Effect.die("unexpected appendMaterialResources"),
    ...overrides,
});

const sourceGateway = (
    overrides: Partial<LmsSourceSession>,
    heads: string[] = [],
): LmsSourceGatewayService => {
    const session: LmsSourceSession = {
        fetchCourses: Effect.die("unexpected fetchCourses"),
        fetchCourseMaterials: () => Effect.die("unexpected fetchCourseMaterials"),
        fetchMaterialResources: () => Effect.die("unexpected fetchMaterialResources"),
        downloadResource: () => Effect.die("unexpected downloadResource"),
        ...overrides,
    };
    return {
        withSession: (head, use) =>
            Effect.suspend(() => {
                heads.push(head);
                return use(session);
            }),
    };
};

const archiveDataMissing = (operation: string): LmsArchiveDataMissingError =>
    new LmsArchiveDataMissingError({ operation, message: "missing" });

for (const preferredCourseId of [courseId, undefined]) {
    Deno.test(`resource acquisition pins its archived ID and records success with course hint ${preferredCourseId}`, async () => {
        const heads: string[] = [];
        const resource = {
            name: "link",
            lmsResourceId: LmsResourceId("SRS1"),
            type: "external",
            url: "https://example.com/shared",
        } as const;
        let commits = 0;
        const archive = archiveGateway({
            findMaterialCourseId: () => Effect.succeed(preferredCourseId),
            listMaterialResources: () =>
                Effect.succeed({ lmsMaterialId: LmsMaterialId("SRY1"), resources: [resource] }),
            appendMaterialResources: () => Effect.void,
            getResourceState: () => Effect.succeed(resource),
            commitResourceAcquisition: () =>
                Effect.sync(() => {
                    commits++;
                    return undefined;
                }),
        });
        const source = sourceGateway({
            fetchMaterialResources: () =>
                Effect.succeed({
                    courses,
                    courseMaterials,
                    materialResources: { lmsMaterialId: LmsMaterialId("SRY1"), resources: [resource] },
                }),
            downloadResource: (materialId, position, courseHint) => {
                assertEquals(materialId, LmsMaterialId("SRY1"));
                assertEquals(position, LmsResourceId("SRS1"));
                assertEquals(courseHint, preferredCourseId);
                return Effect.succeed({
                    snapshot: {
                        courses,
                        courseMaterials,
                        materialResources: { lmsMaterialId: materialId, resources: [resource] },
                    },
                    download: Result.succeed({ type: "external" as const, url: "https://example.com/shared" }),
                });
            },
        }, heads);
        const result = await Effect.runPromise(
            Application.use((app) =>
                app.downloadResource.execute({
                    lmsMaterialId: LmsMaterialId("SRY1"),
                    position: 0,
                    head: "false",
                })
            ).pipe(Effect.provide(testApplicationLayer(archive, source))),
        );
        assertEquals(result, { type: "external", url: "https://example.com/shared" });
        assertEquals(heads, ["false"]);
        assertEquals(commits, 1);
    });
}

Deno.test("invalid resource positions fail before archive lookup or authentication", async () => {
    for (const position of [-1, 0.5, NaN, Infinity]) {
        const result = await Effect.runPromise(Effect.result(
            Application.use((app) =>
                app.downloadResource.execute({
                    lmsMaterialId: LmsMaterialId("SRY1"),
                    position,
                    head: "auto",
                })
            ).pipe(Effect.provide(testApplicationLayer(archiveGateway({}), {
                withSession: () => Effect.die("unexpected session"),
            }))),
        ));
        assert(Result.isFailure(result));
        assertEquals(result.failure.reason, "invalid-position");
    }
});
