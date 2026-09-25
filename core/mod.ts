import type {
    GetAuthenticationStatus,
    ListCourses,
    ListMaterials,
    ListMaterialsOptions,
    Login,
    Logout,
    MaterialListFailure,
    QueryOptions,
    SyncPolicy,
    ViewMaterial,
    ViewMaterialOptions,
} from "./in_port.ts";
import {
    LmsAuthenticationGateway,
    LmsCacheGateway,
    type LmsCacheMissError,
    LmsSourceGateway,
    type LmsSourceSession,
} from "./out_port.ts";
import type { Course, CourseMaterials, LmsCourseId } from "ku-potato-domain";
import { Effect } from "effect";

const login = (head: QueryOptions["head"]) =>
    Effect.gen(function* () {
        const authentication = yield* LmsAuthenticationGateway;
        return yield* authentication.login(head);
    });

const logout = Effect.gen(function* () {
    const authentication = yield* LmsAuthenticationGateway;
    return yield* authentication.logout;
});

const getAuthenticationStatus = Effect.gen(function* () {
    const authentication = yield* LmsAuthenticationGateway;
    return yield* authentication.status;
});

const listCourses = Effect.fn("Core.listCourses")(function* (options: QueryOptions) {
    const cache = yield* LmsCacheGateway;
    const source = yield* LmsSourceGateway;
    return yield* readWithPolicy(
        options.sync,
        cache.listCourses,
        source.withSession(options.head, (session) =>
            session.fetchCourses.pipe(
                Effect.tap((courses) => cache.appendCourses(courses)),
            )),
    );
});

const listMaterials = Effect.fn("Core.listMaterials")(function* (
    options: ListMaterialsOptions,
) {
    const cache = yield* LmsCacheGateway;
    const source = yield* LmsSourceGateway;
    const requestedCourseIds = deduplicateCourseIds(options.lmsCourseIds);
    const courseIds = requestedCourseIds.length > 0
        ? requestedCourseIds
        : availableCourseIds(yield* listCourses({ sync: options.sync, head: options.head }));
    const materialsByCourseId = new Map<LmsCourseId, CourseMaterials>();
    const failures: MaterialListFailure[] = [];
    const courseIdsToFetch: LmsCourseId[] = [];

    if (options.sync === "true") {
        courseIdsToFetch.push(...courseIds);
    } else {
        for (const lmsCourseId of courseIds) {
            const cached = yield* Effect.result(cache.listCourseMaterials(lmsCourseId));
            if (cached._tag === "Success") {
                materialsByCourseId.set(lmsCourseId, cached.success);
            } else if (cached.failure._tag === "LmsCacheMissError" && options.sync === "auto") {
                courseIdsToFetch.push(lmsCourseId);
            } else {
                failures.push({ lmsCourseId, error: cached.failure });
            }
        }
    }

    if (courseIdsToFetch.length > 0) {
        yield* source.withSession(options.head, (session) =>
            Effect.gen(function* () {
                for (const lmsCourseId of courseIdsToFetch) {
                    const fetched = yield* Effect.result(fetchAndCacheCourseMaterials(session, cache, lmsCourseId));
                    if (fetched._tag === "Success") {
                        materialsByCourseId.set(lmsCourseId, fetched.success);
                    } else if (fetched.failure._tag !== "LmsCourseNotFoundError") {
                        failures.push({ lmsCourseId, error: fetched.failure });
                    }
                }
            }));
    }

    return {
        courseMaterials: courseIds.flatMap((lmsCourseId) => {
            const courseMaterials = materialsByCourseId.get(lmsCourseId);
            return courseMaterials === undefined ? [] : [courseMaterials];
        }),
        failures,
    };
});

const viewMaterial = Effect.fn("Core.viewMaterial")(function* (options: ViewMaterialOptions) {
    const cache = yield* LmsCacheGateway;
    const source = yield* LmsSourceGateway;
    return yield* readWithPolicy(
        options.sync,
        cache.getMaterialDetail(options.lmsMaterialId),
        source.withSession(options.head, (session) =>
            session.fetchMaterialResources(options.lmsMaterialId).pipe(
                Effect.tap((snapshot) => cache.appendMaterialResources(snapshot)),
                Effect.andThen(cache.getMaterialDetail(options.lmsMaterialId)),
            )),
    );
});

const fetchAndCacheCourseMaterials = Effect.fn("Core.fetchAndCacheCourseMaterials")(function* (
    session: LmsSourceSession,
    cache: LmsCacheGateway["Service"],
    lmsCourseId: LmsCourseId,
) {
    const snapshot = yield* session.fetchCourseMaterials(lmsCourseId);
    yield* cache.appendCourseMaterials(snapshot);
    return yield* cache.listCourseMaterials(lmsCourseId);
});

const readWithPolicy = <A, CacheError, FetchError, R>(
    sync: SyncPolicy,
    cached: Effect.Effect<A, CacheError | LmsCacheMissError>,
    fetched: Effect.Effect<A, FetchError, R>,
): Effect.Effect<A, CacheError | LmsCacheMissError | FetchError, R> => {
    if (sync === "true") return fetched;
    if (sync === "false") return cached;
    return cached.pipe(Effect.catchTag("LmsCacheMissError", () => fetched));
};

const deduplicateCourseIds = (courseIds: readonly LmsCourseId[]): readonly LmsCourseId[] => [
    ...new Set(courseIds),
];

const availableCourseIds = (courses: readonly Course[]): readonly LmsCourseId[] =>
    courses.flatMap((course) => course.availability === "available" ? [course.lmsCourseId] : []);

export function makeLogin(): Login {
    return { execute: login };
}

export function makeLogout(): Logout {
    return { execute: logout };
}

export function makeGetAuthenticationStatus(): GetAuthenticationStatus {
    return { execute: getAuthenticationStatus };
}

export function makeListCourses(): ListCourses {
    return { execute: listCourses };
}

export function makeListMaterials(): ListMaterials {
    return { execute: listMaterials };
}

export function makeViewMaterial(): ViewMaterial {
    return { execute: viewMaterial };
}
