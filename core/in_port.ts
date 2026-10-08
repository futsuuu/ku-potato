/** Application inbound ports, implemented by the application layer. */

import type {
    Course,
    CourseMaterials,
    LmsCourseId,
    LmsMaterialId,
    LmsResourceId,
    MaterialDetail,
    ResourceDownload,
} from "../domain/mod.ts";
import { Context, type Effect, type Option, Schema } from "effect";
import type {
    ApplicationJobDefinition,
    HeadPolicy,
    Job,
    JobDefinition,
    JobRequest,
    LmsAuthenticationStatus,
} from "./contract.ts";

export type {
    ApplicationJobDefinition,
    CourseMaterialsJobDefinition,
    HeadPolicy,
    Job,
    JobDefinition,
    JobRequest,
    LmsAuthenticationStatus,
} from "./contract.ts";

/** A user-visible failure of an application operation. */
export class ApplicationError extends Schema.TaggedError<ApplicationError>()("ApplicationError", {
    reason: Schema.Literals([
        "source",
        "authentication-required",
        "authentication-storage",
        "archive",
        "archive-data-missing",
        "material-not-found",
        "invalid-position",
        "resource-storage",
    ]),
    message: Schema.String,
}) {}

/** Whether a query may synchronize its archive from KU-LMS. */
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

/** Registers a public key credential using a virtual WebAuthn authenticator. */
export interface RegisterWebAuthnCredential {
    readonly execute: (head: HeadPolicy) => Effect.Effect<void, ApplicationError>;
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

export type DownloadResourceOptions = {
    readonly lmsMaterialId: LmsMaterialId;
    /** Zero-based index in the resource list, matching its archived DB position. */
    readonly position: number;
    /** Inbound adapters can pin the displayed identity even if the list changes. */
    readonly lmsResourceId?: LmsResourceId;
    readonly head: HeadPolicy;
};

export interface DownloadResource {
    readonly execute: (options: DownloadResourceOptions) => Effect.Effect<ResourceDownload, ApplicationError>;
}

/** Submission and observation only; callers do not start workers or access KU-LMS. */
export interface JobClientService<D extends JobDefinition = ApplicationJobDefinition> {
    readonly enqueue: <R extends JobRequest<D>>(
        request: R,
    ) => Effect.Effect<Job<Extract<D, { kind: R["kind"] }>>, ApplicationError>;
    readonly get: <K extends D["kind"]>(
        id: number,
        kind: K,
    ) => Effect.Effect<Job<Extract<D, { kind: K }>> | undefined, ApplicationError>;
    readonly result: <K extends D["kind"]>(
        id: number,
        kind: K,
    ) => Effect.Effect<Option.Option<Extract<D, { kind: K }>["output"]>, ApplicationError>;
    /** Return the terminal state; operation failures remain visible in the job record. */
    readonly wait: <K extends D["kind"]>(
        id: number,
        kind: K,
    ) => Effect.Effect<Job<Extract<D, { kind: K }>>, ApplicationError>;
}

export class QueuedJobs extends Context.Service<QueuedJobs, JobClientService>()("ku-potato/core/QueuedJobs") {}

export class JobWorkerConfigurationError
    extends Schema.TaggedError<JobWorkerConfigurationError>()("JobWorkerConfigurationError", {
        message: Schema.String,
    }) {}

/** Runs durable jobs until the host application shuts down. */
export class JobWorker extends Context.Service<JobWorker, {
    readonly run: Effect.Effect<never, ApplicationError>;
}>()("ku-potato/core/JobWorker") {}

/** Application features supplied to inbound adapters. */
export class Application extends Context.Service<Application, {
    readonly login: Login;
    readonly registerWebAuthnCredential: RegisterWebAuthnCredential;
    readonly logout: Logout;
    readonly getAuthenticationStatus: GetAuthenticationStatus;
    readonly listCourses: ListCourses;
    readonly listMaterials: ListMaterials;
    readonly viewMaterial: ViewMaterial;
    readonly downloadResource: DownloadResource;
}>()("ku-potato/core/Application") {}
