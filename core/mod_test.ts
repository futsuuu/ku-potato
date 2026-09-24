import { assertEquals } from "@std/assert";
import {
    LmsCacheGateway,
    type LmsCacheGatewayService,
    LmsSourceGateway,
    type LmsSourceGatewayService,
} from "./out_port.ts";
import { type Course, LmsCourseId } from "ku-potato-domain";
import { Effect } from "effect";
import { makeListCourses, makeSyncCourses } from "./mod.ts";

const courses: readonly Course[] = [{
    lmsCourseId: LmsCourseId("course-1"),
    name: "Programming",
    availability: "available",
}];

Deno.test("ListCourses executes with the cache service alone", async () => {
    const cache = LmsCacheGateway.of(cacheGateway({ listCourses: Effect.succeed(courses) }));

    const result = await Effect.runPromise(
        makeListCourses().execute.pipe(Effect.provideService(LmsCacheGateway, cache)),
    );

    assertEquals(result, courses);
});

Deno.test("SyncCourses obtains data from the source then reads the persisted value", async () => {
    let cachedCourses: readonly Course[] = [];
    const cache = LmsCacheGateway.of(cacheGateway({
        listCourses: Effect.sync(() => cachedCourses),
        appendCourses: (retrievedCourses) =>
            Effect.sync(() => {
                cachedCourses = retrievedCourses;
            }),
    }));
    const source = LmsSourceGateway.of(sourceGateway({ refreshCourses: Effect.succeed(courses) }));

    const result = await Effect.runPromise(
        makeSyncCourses().execute.pipe(
            Effect.provideService(LmsCacheGateway, cache),
            Effect.provideService(LmsSourceGateway, source),
        ),
    );

    assertEquals(result, courses);
});

const cacheGateway = (overrides: Partial<LmsCacheGatewayService>): LmsCacheGatewayService => ({
    listCourses: Effect.die("unexpected listCourses"),
    listCourseMaterials: () => Effect.die("unexpected listCourseMaterials"),
    listMaterialResources: () => Effect.die("unexpected listMaterialResources"),
    appendCourses: () => Effect.die("unexpected appendCourses"),
    appendCourseMaterials: () => Effect.die("unexpected appendCourseMaterials"),
    appendMaterialResources: () => Effect.die("unexpected appendMaterialResources"),
    ...overrides,
});

const sourceGateway = (overrides: Partial<LmsSourceGatewayService>): LmsSourceGatewayService => ({
    refreshCourses: Effect.die("unexpected refreshCourses"),
    refreshCourseMaterials: () => Effect.die("unexpected refreshCourseMaterials"),
    refreshMaterialResources: () => Effect.die("unexpected refreshMaterialResources"),
    ...overrides,
});
