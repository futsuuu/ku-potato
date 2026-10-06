import { assert, assertEquals } from "@std/assert";
import { Application } from "./in_port.ts";
import {
    LmsAuthenticationGateway,
    LmsCacheGateway,
    type LmsCacheGatewayService,
    LmsCacheMissError,
    LmsCourseNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceGatewayService,
    type LmsSourceSession,
} from "./out_port.ts";
import {
    type Course,
    type CourseMaterials,
    type CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
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

Deno.test("course list auto reads a complete cache without opening an LMS session", async () => {
    const cache = LmsCacheGateway.of(cacheGateway({ listCourses: Effect.succeed(courses) }));
    const source = LmsSourceGateway.of({ withSession: () => Effect.die("unexpected LMS session") });

    const result = await Effect.runPromise(
        Application.use((app) => app.listCourses.execute({ sync: "auto", head: "auto" })).pipe(
            Effect.provide(testApplicationLayer(cache, source)),
        ),
    );

    assertEquals(result, courses);
});

Deno.test("course list auto fetches and caches a missing course snapshot", async () => {
    let cachedCourses: readonly Course[] | undefined;
    const cache = LmsCacheGateway.of(cacheGateway({
        listCourses: Effect.suspend(() =>
            cachedCourses === undefined ? Effect.fail(cacheMiss("listCourses")) : Effect.succeed(cachedCourses)
        ),
        appendCourses: (retrievedCourses) =>
            Effect.sync(() => {
                cachedCourses = retrievedCourses;
            }),
    }));
    const heads: string[] = [];
    const source = LmsSourceGateway.of(sourceGateway({ fetchCourses: Effect.succeed(courses) }, heads));

    const result = await Effect.runPromise(
        Application.use((app) => app.listCourses.execute({ sync: "auto", head: "false" })).pipe(
            Effect.provide(testApplicationLayer(cache, source)),
        ),
    );

    assertEquals(result, courses);
    assertEquals(heads, ["false"]);
});

Deno.test("application translates source failures before returning them to the inbound adapter", async () => {
    const cache = LmsCacheGateway.of(cacheGateway({}));
    const source = LmsSourceGateway.of(sourceGateway({
        fetchCourses: Effect.fail(new LmsSourceGatewayError({ operation: "fetch", message: "LMS unavailable" })),
    }));

    const result = await Effect.runPromise(Effect.result(
        Application.use((app) => app.listCourses.execute({ sync: "true", head: "false" })).pipe(
            Effect.provide(testApplicationLayer(cache, source)),
        ),
    ));

    assert(Result.isFailure(result));
    assertEquals(result.failure._tag, "ApplicationError");
    assertEquals(result.failure.reason, "source");
    assertEquals(result.failure.message, "LMS unavailable");
});

Deno.test("material list ignores missing courses and retains internal failures", async () => {
    const stored = new Map<string, CourseMaterials>();
    const cache = LmsCacheGateway.of(cacheGateway({
        appendCourseMaterials: (snapshot) =>
            Effect.sync(() => {
                stored.set(snapshot.courseMaterials.lmsCourseId, snapshot.courseMaterials);
            }),
        listCourseMaterials: (lmsCourseId) => {
            const value = stored.get(lmsCourseId);
            return value === undefined ? Effect.fail(cacheMiss("listCourseMaterials")) : Effect.succeed(value);
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
            Effect.provide(testApplicationLayer(cache, source)),
        ),
    );

    assertEquals(result.courseMaterials, [courseMaterials]);
    assertEquals(result.failures.map(({ lmsCourseId, error }) => [lmsCourseId, error.message]), [
        [brokenCourseId, "broken"],
    ]);
    assertEquals(result.failures[0]?.error.reason, "source");
});

Deno.test("material list auto discovers cached courses and fetches only missing materials", async () => {
    let stored: CourseMaterials | undefined;
    const cache = LmsCacheGateway.of(cacheGateway({
        listCourses: Effect.succeed(courses),
        listCourseMaterials: () =>
            stored === undefined ? Effect.fail(cacheMiss("listCourseMaterials")) : Effect.succeed(stored),
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
            Effect.provide(testApplicationLayer(cache, source)),
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
            const cache = LmsCacheGateway.of(cacheGateway({
                findMaterialCourseId: () => Effect.succeed(preferredCourseId),
                getMaterialDetail: () =>
                    Effect.suspend(() =>
                        stored === undefined ? Effect.fail(cacheMiss("getMaterialDetail")) : Effect.succeed(stored)
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
                    Effect.provide(testApplicationLayer(cache, source)),
                ),
            );

            assertEquals(result, materialDetail);
            assertEquals(heads, ["true"]);
        });
    }
}

Deno.test("material view uses a complete cache without looking up a course hint or opening the LMS", async () => {
    const detail: MaterialDetail = { course, material: courseMaterials.folders[0]!.materials[0]!, resources: [] };
    const cache = LmsCacheGateway.of(cacheGateway({ getMaterialDetail: () => Effect.succeed(detail) }));
    const source = LmsSourceGateway.of({ withSession: () => Effect.die("unexpected LMS session") });
    for (const sync of ["auto", "false"] as const) {
        assertEquals(
            await Effect.runPromise(
                Application.use((app) =>
                    app.viewMaterial.execute({ lmsMaterialId: detail.material.lmsMaterialId, sync, head: "false" })
                ).pipe(Effect.provide(testApplicationLayer(cache, source))),
            ),
            detail,
        );
    }
});

const testApplicationLayer = (
    cache: LmsCacheGateway["Service"],
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
    Layer.succeed(LmsCacheGateway, cache),
    Layer.succeed(LmsSourceGateway, source),
)));

const cacheGateway = (overrides: Partial<LmsCacheGatewayService>): LmsCacheGatewayService => ({
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

const cacheMiss = (operation: string): LmsCacheMissError => new LmsCacheMissError({ operation, message: "missing" });
