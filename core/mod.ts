import {
    Application,
    ApplicationError,
    DownloadResourceOptions,
    ListMaterialsOptions,
    MaterialListFailure,
    QueryOptions,
    SyncPolicy,
    ViewMaterialOptions,
} from "./in_port.ts";
import {
    LmsAuthenticationGateway,
    type LmsAuthenticationRequiredError,
    type LmsAuthenticationStorageError,
    LmsCacheGateway,
    type LmsCacheGatewayError,
    type LmsCacheMissError,
    type LmsMaterialNotFoundError,
    LmsSourceGateway,
    type LmsSourceGatewayError,
    type LmsSourceSession,
} from "./out_port.ts";
import type { Course, CourseMaterials, LmsCourseId } from "../domain/mod.ts";
import { Effect, Layer, Result, Schema } from "effect";

type OutboundServices = LmsAuthenticationGateway | LmsCacheGateway | LmsSourceGateway;
type GatewayError =
    | LmsSourceGatewayError
    | LmsAuthenticationRequiredError
    | LmsAuthenticationStorageError
    | LmsCacheGatewayError
    | LmsCacheMissError
    | LmsMaterialNotFoundError;

const toApplicationError = (error: GatewayError): ApplicationError => {
    switch (error._tag) {
        case "LmsSourceGatewayError":
            return new ApplicationError({ reason: "source", message: error.message });
        case "LmsAuthenticationRequiredError":
            return new ApplicationError({ reason: "authentication-required", message: error.message });
        case "LmsAuthenticationStorageError":
            return new ApplicationError({ reason: "authentication-storage", message: error.message });
        case "LmsCacheGatewayError":
            return new ApplicationError({ reason: "cache", message: error.message });
        case "LmsCacheMissError":
            return new ApplicationError({ reason: "cache-miss", message: error.message });
        case "LmsMaterialNotFoundError":
            return new ApplicationError({ reason: "material-not-found", message: error.message });
    }
};

const login = Effect.fn("Core.login")(function* (head: QueryOptions["head"]) {
    const authentication = yield* LmsAuthenticationGateway;
    return yield* authentication.login(head);
});

const logout = Effect.gen(function* () {
    const authentication = yield* LmsAuthenticationGateway;
    return yield* authentication.logout;
});

const registerWebAuthnCredential = Effect.fn("Core.registerWebAuthnCredential")(function* (head: QueryOptions["head"]) {
    const authentication = yield* LmsAuthenticationGateway;
    return yield* authentication.registerWebAuthnCredential(head);
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
            if (Result.isSuccess(cached)) {
                materialsByCourseId.set(lmsCourseId, cached.success);
            } else if (cached.failure._tag === "LmsCacheMissError" && options.sync === "auto") {
                courseIdsToFetch.push(lmsCourseId);
            } else {
                failures.push({ lmsCourseId, error: toApplicationError(cached.failure) });
            }
        }
    }

    if (courseIdsToFetch.length > 0) {
        yield* source.withSession(options.head, (session) =>
            Effect.gen(function* () {
                for (const lmsCourseId of courseIdsToFetch) {
                    const fetched = yield* Effect.result(fetchAndCacheCourseMaterials(session, cache, lmsCourseId));
                    if (Result.isSuccess(fetched)) {
                        materialsByCourseId.set(lmsCourseId, fetched.success);
                    } else if (fetched.failure._tag !== "LmsCourseNotFoundError") {
                        failures.push({ lmsCourseId, error: toApplicationError(fetched.failure) });
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
        Effect.gen(function* () {
            const preferredCourseId = yield* cache.findMaterialCourseId(options.lmsMaterialId);
            return yield* source.withSession(
                options.head,
                (session) =>
                    session.fetchMaterialResources(options.lmsMaterialId, preferredCourseId).pipe(
                        Effect.tap((snapshot) => cache.appendMaterialResources(snapshot)),
                        Effect.andThen(cache.getMaterialDetail(options.lmsMaterialId)),
                    ),
            );
        }),
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

const downloadResource = Effect.fn("Core.downloadResource")(function* (options: DownloadResourceOptions) {
    const cache = yield* LmsCacheGateway;
    const source = yield* LmsSourceGateway;
    const preferredCourseId = yield* cache.findMaterialCourseId(options.lmsMaterialId);
    return yield* source.withSession(
        options.head,
        (session) => session.downloadResource(options.lmsMaterialId, options.position, preferredCourseId),
    );
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

/** Construct the application with its outbound services before it reaches an inbound adapter. */
export const ApplicationLive = Layer.effect(
    Application,
    Effect.gen(function* () {
        const context = yield* Effect.context<OutboundServices>();
        const bind = <A, E extends GatewayError>(
            operation: Effect.Effect<A, E, OutboundServices>,
        ): Effect.Effect<A, ApplicationError> =>
            operation.pipe(Effect.provide(context), Effect.mapError(toApplicationError));

        return Application.of({
            login: { execute: (head) => bind(login(head)) },
            registerWebAuthnCredential: { execute: (head) => bind(registerWebAuthnCredential(head)) },
            logout: { execute: bind(logout) },
            getAuthenticationStatus: { execute: bind(getAuthenticationStatus) },
            listCourses: { execute: (options) => bind(listCourses(options)) },
            listMaterials: { execute: (options) => bind(listMaterials(options)) },
            viewMaterial: { execute: (options) => bind(viewMaterial(options)) },
            downloadResource: {
                execute: (options) =>
                    Schema.decodeEffect(Schema.Natural)(options.position).pipe(
                        Effect.mapError(() =>
                            new ApplicationError({
                                reason: "invalid-position",
                                message: "資料のpositionには0以上の整数を指定してください。",
                            })
                        ),
                        Effect.flatMap(() => bind(downloadResource(options))),
                    ),
            },
        });
    }),
);
