/** Application inbound ports, implemented by the application layer. */

import type { Course, CourseMaterials, LmsCourseId, LmsMaterialId, MaterialDetail } from "../domain/mod.ts";
import { Context, type Effect, Schema } from "effect";
import type { HeadPolicy, LmsAuthenticationStatus } from "./contract.ts";

export type { HeadPolicy, LmsAuthenticationStatus } from "./contract.ts";

/** A user-visible failure of an application operation. */
export class ApplicationError extends Schema.TaggedError<ApplicationError>()("ApplicationError", {
    reason: Schema.Literals([
        "source",
        "authentication-required",
        "authentication-storage",
        "cache",
        "cache-miss",
        "material-not-found",
    ]),
    message: Schema.String,
}) {}

/** Whether a query may synchronize its cache from KU-LMS. */
export type SyncPolicy = "auto" | "true" | "false";

export type QueryOptions = {
    readonly sync: SyncPolicy;
    readonly head: HeadPolicy;
};

export type QueryError = ApplicationError;

export interface Login {
    readonly execute: (
        head: HeadPolicy,
    ) => Effect.Effect<void, ApplicationError>;
}

export interface Logout {
    readonly execute: Effect.Effect<void, ApplicationError>;
}

export interface GetAuthenticationStatus {
    readonly execute: Effect.Effect<LmsAuthenticationStatus, ApplicationError>;
}

export interface ListCourses {
    readonly execute: (
        options: QueryOptions,
    ) => Effect.Effect<readonly Course[], QueryError>;
}

export type ListMaterialsOptions = QueryOptions & {
    readonly lmsCourseIds: readonly LmsCourseId[];
};

export type MaterialListFailure = {
    readonly lmsCourseId: LmsCourseId;
    readonly error: ApplicationError;
};

export type MaterialListResult = {
    readonly courseMaterials: readonly CourseMaterials[];
    readonly failures: readonly MaterialListFailure[];
};

export interface ListMaterials {
    readonly execute: (
        options: ListMaterialsOptions,
    ) => Effect.Effect<MaterialListResult, QueryError>;
}

export type ViewMaterialOptions = QueryOptions & {
    readonly lmsMaterialId: LmsMaterialId;
};

export interface ViewMaterial {
    readonly execute: (
        options: ViewMaterialOptions,
    ) => Effect.Effect<MaterialDetail, QueryError>;
}

/** Application features supplied to inbound adapters. */
export class Application extends Context.Service<Application, {
    readonly login: Login;
    readonly logout: Logout;
    readonly getAuthenticationStatus: GetAuthenticationStatus;
    readonly listCourses: ListCourses;
    readonly listMaterials: ListMaterials;
    readonly viewMaterial: ViewMaterial;
}>()("ku-potato/core/Application") {}
