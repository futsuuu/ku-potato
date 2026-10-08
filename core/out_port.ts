/** Application outbound port, implemented by an infrastructure adapter. */

import type {
    Course,
    CourseMaterials,
    CourseMaterialsSnapshot,
    LmsCourseId,
    LmsMaterialId,
    LmsResourceId,
    MaterialDetail,
    MaterialResources,
    MaterialResourcesSnapshot,
    Resource,
    ResourceAcquisition,
    ResourceDownload,
    SavedResourceFile,
} from "../domain/mod.ts";
import { Context, type Effect, type Option, type Result, Schema } from "effect";
import type {
    ApplicationJobDefinition,
    HeadPolicy,
    Job,
    JobCompletion,
    JobDefinition,
    JobFailure,
    JobRequest,
    LmsAuthenticationStatus,
} from "./contract.ts";

export type {
    ApplicationJobDefinition,
    CourseMaterialsJobDefinition,
    HeadPolicy,
    Job,
    JobCompletion,
    JobDefinition,
    JobFailure,
    JobRequest,
    LmsAuthenticationStatus,
} from "./contract.ts";

export interface JobQueueService<D extends JobDefinition = ApplicationJobDefinition> {
    readonly enqueue: <R extends JobRequest<D>>(
        request: R,
    ) => Effect.Effect<Job<Extract<D, { kind: R["kind"] }>>, LmsArchiveGatewayError>;
    readonly get: <K extends D["kind"]>(
        id: number,
        kind: K,
    ) => Effect.Effect<Job<Extract<D, { kind: K }>> | undefined, LmsArchiveGatewayError>;
    readonly claim: (
        ownerId: string,
        leaseMs: number,
    ) => Effect.Effect<Job<D> | undefined, LmsArchiveGatewayError>;
    readonly heartbeat: (job: Job<D>, leaseMs: number) => Effect.Effect<boolean, LmsArchiveGatewayError>;
    readonly complete: (completion: JobCompletion<D>) => Effect.Effect<boolean, LmsArchiveGatewayError>;
    readonly fail: (
        job: Job<D>,
        error: JobFailure,
        retryDelayMs: number,
    ) => Effect.Effect<boolean, LmsArchiveGatewayError>;
    /** None means no successful result; Some preserves outputs including undefined. */
    readonly result: <K extends D["kind"]>(
        id: number,
        kind: K,
    ) => Effect.Effect<Option.Option<Extract<D, { kind: K }>["output"]>, LmsArchiveGatewayError>;
}

export class JobQueue extends Context.Service<JobQueue, JobQueueService>()("ku-potato/core/JobQueue") {}

/** The list used for acquisition remains available even when clicking the resource fails. */
export interface LmsResourceRetrieval {
    readonly snapshot: MaterialResourcesSnapshot;
    readonly download: Result.Result<ResourceDownload, LmsSourceGatewayError>;
}

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
    readonly downloadResource: (
        lmsMaterialId: LmsMaterialId,
        position: number | LmsResourceId,
        preferredCourseId?: LmsCourseId,
    ) => Effect.Effect<LmsResourceRetrieval, LmsSourceGatewayError | LmsMaterialNotFoundError>;
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
    /** Creates a credential source in a virtual authenticator and registers its public key with the SSO provider. */
    readonly registerWebAuthnCredential: (
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

/** Local archive of retrieved course, material, and resource-list snapshots, implemented by the SQLite adapter. */
export interface LmsArchiveGatewayService {
    readonly getResourceState: (
        materialId: LmsMaterialId,
        resourceId: LmsResourceId,
    ) => Effect.Effect<Resource | undefined, LmsArchiveGatewayError>;
    readonly recordResourceAttempt: (
        materialId: LmsMaterialId,
        resourceId: LmsResourceId,
        attempt: ResourceAcquisition["lastAttempt"],
    ) => Effect.Effect<void, LmsArchiveGatewayError>;
    readonly commitResourceAcquisition: (
        materialId: LmsMaterialId,
        resourceId: LmsResourceId,
        file: SavedResourceFile | undefined,
        at: Date,
    ) => Effect.Effect<SavedResourceFile | undefined, LmsArchiveGatewayError>;
    /** Latest known course, even when the material's resources have never been fetched. */
    readonly findMaterialCourseId: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<LmsCourseId | undefined, LmsArchiveGatewayError>;
    readonly listCourses: Effect.Effect<readonly Course[], LmsArchiveGatewayError | LmsArchiveDataMissingError>;
    readonly listCourseMaterials: (
        lmsCourseId: LmsCourseId,
    ) => Effect.Effect<CourseMaterials, LmsArchiveGatewayError | LmsArchiveDataMissingError>;
    readonly listMaterialResources: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialResources, LmsArchiveGatewayError | LmsArchiveDataMissingError>;
    readonly getMaterialDetail: (
        lmsMaterialId: LmsMaterialId,
    ) => Effect.Effect<MaterialDetail, LmsArchiveGatewayError | LmsArchiveDataMissingError>;
    readonly appendCourses: (courses: readonly Course[]) => Effect.Effect<void, LmsArchiveGatewayError>;
    readonly appendCourseMaterials: (snapshot: CourseMaterialsSnapshot) => Effect.Effect<void, LmsArchiveGatewayError>;
    readonly appendMaterialResources: (
        snapshot: MaterialResourcesSnapshot,
    ) => Effect.Effect<void, LmsArchiveGatewayError>;
}

/** Persistent file storage. Paths are derived from IDs and UUIDs, never archived. */
export interface ResourceFileGatewayService {
    readonly path: (resourceId: LmsResourceId, uuid: string) => string;
    readonly save: (
        resourceId: LmsResourceId,
        downloadedPath: string,
        originalFilename: string,
        previous?: SavedResourceFile,
    ) => Effect.Effect<SavedResourceFile, ResourceFileGatewayError>;
    readonly remove: (resourceId: LmsResourceId, uuid: string) => Effect.Effect<void, ResourceFileGatewayError>;
    readonly discardDownload: (path: string) => Effect.Effect<void, ResourceFileGatewayError>;
    /** Serializes complete metadata/file switches, including between local processes. */
    readonly withResourceLock: <A, E, R>(
        resourceId: LmsResourceId,
        use: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ResourceFileGatewayError, R>;
}

export class ResourceFileGateway extends Context.Service<ResourceFileGateway, ResourceFileGatewayService>()(
    "ku-potato/core/ResourceFileGateway",
) {}

export class ResourceFileGatewayError
    extends Schema.TaggedError<ResourceFileGatewayError>()("ResourceFileGatewayError", {
        operation: Schema.String,
        message: Schema.String,
    }) {}

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

/** Context service for the persistent LMS archive. */
export class LmsArchiveGateway extends Context.Service<LmsArchiveGateway, LmsArchiveGatewayService>()(
    "ku-potato/core/LmsArchiveGateway",
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

/** A failure while reading or recording the persistent archive. */
export class LmsArchiveGatewayError extends Schema.TaggedError<LmsArchiveGatewayError>()(
    "LmsArchiveGatewayError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}

/** The requested value has never been synchronized into the archive. */
export class LmsArchiveDataMissingError extends Schema.TaggedError<LmsArchiveDataMissingError>()(
    "LmsArchiveDataMissingError",
    {
        operation: Schema.String,
        message: Schema.String,
    },
) {}
