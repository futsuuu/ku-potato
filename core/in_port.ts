/** Application inbound ports, implemented by the application layer. */

import type { Course, CourseMaterials, LmsCourseId, LmsMaterialId, MaterialResources } from "ku-potato-domain";
import type { Effect } from "effect";
import type {
    LmsAuthenticationRequiredError,
    LmsAuthenticationStorageError,
    LmsCacheGateway,
    LmsCacheGatewayError,
    LmsCacheMissError,
    LmsCourseNotFoundError,
    LmsMaterialNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
} from "./out_port.ts";

export interface ListCourses {
    readonly execute: Effect.Effect<readonly Course[], LmsCacheGatewayError | LmsCacheMissError, LmsCacheGateway>;
}

export interface SyncCourses {
    readonly execute: Effect.Effect<
        readonly Course[],
        | LmsSourceGatewayError
        | LmsAuthenticationRequiredError
        | LmsAuthenticationStorageError
        | LmsCacheGatewayError
        | LmsCacheMissError,
        LmsSourceGateway | LmsCacheGateway
    >;
}

export interface ListCourseMaterials {
    readonly execute: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterials, LmsCacheGatewayError | LmsCacheMissError, LmsCacheGateway>;
}

export interface SyncCourseMaterials {
    readonly execute: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<
        CourseMaterials,
        | LmsSourceGatewayError
        | LmsAuthenticationRequiredError
        | LmsAuthenticationStorageError
        | LmsCourseNotFoundError
        | LmsCacheGatewayError
        | LmsCacheMissError,
        LmsSourceGateway | LmsCacheGateway
    >;
}

export interface ListMaterialResources {
    readonly execute: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialResources, LmsCacheGatewayError | LmsCacheMissError, LmsCacheGateway>;
}

export interface SyncMaterialResources {
    readonly execute: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<
        MaterialResources,
        | LmsSourceGatewayError
        | LmsAuthenticationRequiredError
        | LmsAuthenticationStorageError
        | LmsMaterialNotFoundError
        | LmsCacheGatewayError
        | LmsCacheMissError,
        LmsSourceGateway | LmsCacheGateway
    >;
}
