/** Application outbound port, implemented by an infrastructure adapter. */

import type {
    Course,
    CourseMaterials,
    CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    MaterialDetail,
    MaterialResources,
    MaterialResourcesSnapshot,
} from "../domain/mod.ts";
import { Context, type Effect, Schema } from "effect";
import type { HeadPolicy, LmsAuthenticationStatus } from "./contract.ts";

export type { HeadPolicy, LmsAuthenticationStatus } from "./contract.ts";

/** One exclusive, single-tab session with the external LMS. */
export interface LmsSourceSession {
    readonly fetchCourses: Effect.Effect<readonly Course[], LmsSourceGatewayError>;
    readonly fetchCourseMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterialsSnapshot, LmsSourceGatewayError | LmsCourseNotFoundError>;
    readonly fetchMaterialResources: (
        lmsMaterialId: LmsMaterialId,
        preferredCourseId?: LmsCourseId,
    ) => Effect.Effect<MaterialResourcesSnapshot, LmsSourceGatewayError | LmsMaterialNotFoundError>;
}

/** Opens an authenticated LMS session for the duration of one operation. */
export interface LmsSourceGatewayService {
    readonly withSession: <A, E, R>(
        headPolicy: HeadPolicy,
        use: (session: LmsSourceSession) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<
        A,
        E | LmsSourceGatewayError | LmsAuthenticationRequiredError | LmsAuthenticationStorageError,
        R
    >;
}

/** Authentication-state operations, implemented by the browser adapter. */
export interface LmsAuthenticationGatewayService {
    readonly registerFido: (
        headPolicy: HeadPolicy,
    ) => Effect.Effect<void, LmsSourceGatewayError | LmsAuthenticationRequiredError | LmsAuthenticationStorageError>;
    readonly login: (
        headPolicy: HeadPolicy,
    ) => Effect.Effect<void, LmsSourceGatewayError | LmsAuthenticationRequiredError | LmsAuthenticationStorageError>;
    readonly logout: Effect.Effect<void, LmsAuthenticationStorageError>;
    readonly status: Effect.Effect<
        LmsAuthenticationStatus,
        LmsSourceGatewayError | LmsAuthenticationStorageError
    >;
}

/** The persistent cache, implemented by the SQLite adapter. */
export interface LmsCacheGatewayService {
    /** Latest known course, even when the material's resources have never been fetched. */
    readonly findMaterialCourseId: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<LmsCourseId | undefined, LmsCacheGatewayError>;
    readonly listCourses: Effect.Effect<readonly Course[], LmsCacheGatewayError | LmsCacheMissError>;
    readonly listCourseMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterials, LmsCacheGatewayError | LmsCacheMissError>;
    readonly listMaterialResources: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialResources, LmsCacheGatewayError | LmsCacheMissError>;
    readonly getMaterialDetail: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialDetail, LmsCacheGatewayError | LmsCacheMissError>;
    readonly appendCourses: (courses: readonly Course[]) => Effect.Effect<void, LmsCacheGatewayError>;
    readonly appendCourseMaterials: (snapshot: CourseMaterialsSnapshot) => Effect.Effect<void, LmsCacheGatewayError>;
    readonly appendMaterialResources: (
        snapshot: MaterialResourcesSnapshot,
    ) => Effect.Effect<void, LmsCacheGatewayError>;
}

/** Context service for an external LMS data source. */
export class LmsSourceGateway extends Context.Service<LmsSourceGateway, LmsSourceGatewayService>()(
    "ku-potato/core/LmsSourceGateway",
) {}

/** Context service for locally persisted LMS authentication. */
export class LmsAuthenticationGateway extends Context.Service<
    LmsAuthenticationGateway,
    LmsAuthenticationGatewayService
>()(
    "ku-potato/core/LmsAuthenticationGateway",
) {}

/** Context service for the persistent LMS cache. */
export class LmsCacheGateway extends Context.Service<LmsCacheGateway, LmsCacheGatewayService>()(
    "ku-potato/core/LmsCacheGateway",
) {}

/** A failure while obtaining data from KU-LMS. */
export class LmsSourceGatewayError extends Schema.TaggedError<LmsSourceGatewayError>()(
    "LmsSourceGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}

/** The stored session cannot access the LMS without user interaction. */
export class LmsAuthenticationRequiredError extends Schema.TaggedError<LmsAuthenticationRequiredError>()(
    "LmsAuthenticationRequiredError",
    { message: Schema.String },
) {}

/** The requested course no longer exists in the current LMS course list. */
export class LmsCourseNotFoundError extends Schema.TaggedError<LmsCourseNotFoundError>()(
    "LmsCourseNotFoundError",
    {
        lmsCourseId: Schema.String,
        message: Schema.String,
    },
) {}

/** The requested globally identified material does not exist in the LMS. */
export class LmsMaterialNotFoundError extends Schema.TaggedError<LmsMaterialNotFoundError>()(
    "LmsMaterialNotFoundError",
    {
        lmsMaterialId: Schema.String,
        message: Schema.String,
    },
) {}

/** A failure while reading, writing, or deleting local authentication state. */
export class LmsAuthenticationStorageError extends Schema.TaggedError<LmsAuthenticationStorageError>()(
    "LmsAuthenticationStorageError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}

/** A failure while reading or recording the persistent cache. */
export class LmsCacheGatewayError extends Schema.TaggedError<LmsCacheGatewayError>()(
    "LmsCacheGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}

/** The requested value has never been synchronized into the cache. */
export class LmsCacheMissError extends Schema.TaggedError<LmsCacheMissError>()(
    "LmsCacheMissError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}
