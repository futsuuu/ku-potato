/** Application outbound port, implemented by an infrastructure adapter. */

import type {
    Course,
    CourseMaterials,
    CourseMaterialsRefresh,
    LmsCourseId,
    LmsMaterialId,
    MaterialResources,
    MaterialResourcesRefresh,
} from "ku-potato-domain";
import { Context, type Effect, Schema } from "effect";

/** The external LMS data source, implemented by the Playwright adapter. */
export interface LmsSourceGatewayService {
    readonly refreshCourses: Effect.Effect<readonly Course[], LmsSourceGatewayError>;
    readonly refreshCourseMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterialsRefresh, LmsSourceGatewayError>;
    readonly refreshMaterialResources: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialResourcesRefresh, LmsSourceGatewayError>;
}

/** The persistent cache, implemented by the SQLite adapter. */
export interface LmsCacheGatewayService {
    readonly listCourses: Effect.Effect<readonly Course[], LmsCacheGatewayError | LmsCacheMissError>;
    readonly listCourseMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterials, LmsCacheGatewayError | LmsCacheMissError>;
    readonly listMaterialResources: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialResources, LmsCacheGatewayError | LmsCacheMissError>;
    readonly appendCourses: (courses: readonly Course[]) => Effect.Effect<void, LmsCacheGatewayError>;
    readonly appendCourseMaterials: (refresh: CourseMaterialsRefresh) => Effect.Effect<void, LmsCacheGatewayError>;
    readonly appendMaterialResources: (refresh: MaterialResourcesRefresh) => Effect.Effect<void, LmsCacheGatewayError>;
}

/** Context service for an external LMS data source. */
export class LmsSourceGateway extends Context.Service<LmsSourceGateway, LmsSourceGatewayService>()(
    "ku-potato/core/LmsSourceGateway",
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
