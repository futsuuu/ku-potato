/** Application inbound ports, implemented by the application layer. */

import type { Course, CourseMaterials, LmsCourseId, LmsMaterialId, MaterialDetail } from "ku-potato-domain";
import type { Effect } from "effect";
import type {
    HeadPolicy,
    LmsAuthenticationGateway,
    LmsAuthenticationRequiredError,
    LmsAuthenticationStatus,
    LmsAuthenticationStorageError,
    LmsCacheGateway,
    LmsCacheGatewayError,
    LmsCacheMissError,
    LmsMaterialNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
} from "./out_port.ts";

/** Whether a query may synchronize its cache from KU-LMS. */
export type SyncPolicy = "auto" | "true" | "false";

export type QueryOptions = {
    readonly sync: SyncPolicy;
    readonly head: HeadPolicy;
};

export type QueryError =
    | LmsSourceGatewayError
    | LmsAuthenticationRequiredError
    | LmsAuthenticationStorageError
    | LmsCacheGatewayError
    | LmsCacheMissError;

export interface Login {
    readonly execute: (
        head: HeadPolicy,
    ) => Effect.Effect<
        void,
        LmsSourceGatewayError | LmsAuthenticationRequiredError | LmsAuthenticationStorageError,
        LmsAuthenticationGateway
    >;
}

export interface Logout {
    readonly execute: Effect.Effect<void, LmsAuthenticationStorageError, LmsAuthenticationGateway>;
}

export interface GetAuthenticationStatus {
    readonly execute: Effect.Effect<
        LmsAuthenticationStatus,
        LmsSourceGatewayError | LmsAuthenticationStorageError,
        LmsAuthenticationGateway
    >;
}

export interface ListCourses {
    readonly execute: (
        options: QueryOptions,
    ) => Effect.Effect<readonly Course[], QueryError, LmsSourceGateway | LmsCacheGateway>;
}

export type ListMaterialsOptions = QueryOptions & {
    readonly lmsCourseIds: readonly LmsCourseId[];
};

export type MaterialListFailure = {
    readonly lmsCourseId: LmsCourseId;
    readonly error: LmsSourceGatewayError | LmsCacheGatewayError | LmsCacheMissError;
};

export type MaterialListResult = {
    readonly courseMaterials: readonly CourseMaterials[];
    readonly failures: readonly MaterialListFailure[];
};

export interface ListMaterials {
    readonly execute: (
        options: ListMaterialsOptions,
    ) => Effect.Effect<MaterialListResult, QueryError, LmsSourceGateway | LmsCacheGateway>;
}

export type ViewMaterialOptions = QueryOptions & {
    readonly lmsMaterialId: LmsMaterialId;
};

export interface ViewMaterial {
    readonly execute: (
        options: ViewMaterialOptions,
    ) => Effect.Effect<
        MaterialDetail,
        QueryError | LmsMaterialNotFoundError,
        LmsSourceGateway | LmsCacheGateway
    >;
}
