import { assertEquals } from "@std/assert";
import {
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
} from "ku-potato-domain";
import { Effect } from "effect";
import { makeListCourses, makeListMaterials, makeViewMaterial } from "./mod.ts";

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
        makeListCourses().execute({ sync: "auto", head: "auto" }).pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
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
        makeListCourses().execute({ sync: "auto", head: "false" }).pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
        ),
    );

    assertEquals(result, courses);
    assertEquals(heads, ["false"]);
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
        makeListMaterials().execute({
            lmsCourseIds: [courseId, missingCourseId, brokenCourseId, courseId],
            sync: "true",
            head: "auto",
        }).pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
        ),
    );

    assertEquals(result.courseMaterials, [courseMaterials]);
    assertEquals(result.failures.map(({ lmsCourseId, error }) => [lmsCourseId, error.message]), [
        [brokenCourseId, "broken"],
    ]);
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
        makeListMaterials().execute({ lmsCourseIds: [], sync: "auto", head: "false" }).pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
        ),
    );

    assertEquals(result, { courseMaterials: [courseMaterials], failures: [] });
    assertEquals(heads, ["false"]);
});

Deno.test("material view true fetches a fresh resource snapshot before reading its detail", async () => {
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
        fetchMaterialResources: () => Effect.succeed(snapshot),
    }, heads));

    const result = await Effect.runPromise(
        makeViewMaterial().execute({ lmsMaterialId: material.lmsMaterialId, sync: "true", head: "true" }).pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
        ),
    );

    assertEquals(result, materialDetail);
    assertEquals(heads, ["true"]);
});

const cacheGateway = (overrides: Partial<LmsCacheGatewayService>): LmsCacheGatewayService => ({
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
