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
    type LmsArchiveDataMissingError,
    LmsArchiveGateway,
    type LmsArchiveGatewayError,
    LmsAuthenticationGateway,
    type LmsAuthenticationRequiredError,
    type LmsAuthenticationStorageError,
    type LmsMaterialNotFoundError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceSession,
    ResourceFileGateway,
    type ResourceFileGatewayError,
} from "./out_port.ts";
import type { Course, CourseMaterials, LmsCourseId } from "../domain/mod.ts";
import { DateTime, Effect, Layer, Result, Schema } from "effect";

type OutboundServices = LmsAuthenticationGateway | LmsArchiveGateway | LmsSourceGateway | ResourceFileGateway;
type GatewayError =
    | LmsSourceGatewayError
    | LmsAuthenticationRequiredError
    | LmsAuthenticationStorageError
    | LmsArchiveGatewayError
    | LmsArchiveDataMissingError
    | LmsMaterialNotFoundError;
type StorageOrGatewayError = GatewayError | ResourceFileGatewayError;

const toApplicationError = (error: StorageOrGatewayError): ApplicationError => {
    switch (error._tag) {
        case "LmsSourceGatewayError":
            return new ApplicationError({ reason: "source", message: error.message });
        case "LmsAuthenticationRequiredError":
            return new ApplicationError({ reason: "authentication-required", message: error.message });
        case "LmsAuthenticationStorageError":
            return new ApplicationError({ reason: "authentication-storage", message: error.message });
        case "LmsArchiveGatewayError":
            return new ApplicationError({ reason: "archive", message: error.message });
        case "LmsArchiveDataMissingError":
            return new ApplicationError({ reason: "archive-data-missing", message: error.message });
        case "LmsMaterialNotFoundError":
            return new ApplicationError({ reason: "material-not-found", message: error.message });
        case "ResourceFileGatewayError":
            return new ApplicationError({ reason: "resource-storage", message: error.message });
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
    const archive = yield* LmsArchiveGateway;
    const source = yield* LmsSourceGateway;
    return yield* readWithPolicy(
        options.sync,
        archive.listCourses,
        source.withSession(options.head, (session) =>
            session.fetchCourses.pipe(
                Effect.tap((courses) => archive.appendCourses(courses)),
                Effect.andThen(archive.listCourses),
            )),
    );
});

const listMaterials = Effect.fn("Core.listMaterials")(function* (
    options: ListMaterialsOptions,
) {
    const archive = yield* LmsArchiveGateway;
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
            const archived = yield* Effect.result(archive.listCourseMaterials(lmsCourseId));
            if (Result.isSuccess(archived)) {
                materialsByCourseId.set(lmsCourseId, archived.success);
            } else if (archived.failure._tag === "LmsArchiveDataMissingError" && options.sync === "auto") {
                courseIdsToFetch.push(lmsCourseId);
            } else {
                failures.push({ lmsCourseId, error: toApplicationError(archived.failure) });
            }
        }
    }

    if (courseIdsToFetch.length > 0) {
        yield* source.withSession(options.head, (session) =>
            Effect.gen(function* () {
                for (const lmsCourseId of courseIdsToFetch) {
                    const fetched = yield* Effect.result(fetchAndArchiveCourseMaterials(session, archive, lmsCourseId));
                    if (Result.isSuccess(fetched)) {
                        materialsByCourseId.set(lmsCourseId, fetched.success);
                    } else if (fetched.failure._tag === "LmsCourseNotFoundError") {
                        const retained = yield* Effect.result(archive.listCourseMaterials(lmsCourseId));
                        if (
                            Result.isSuccess(retained) &&
                            retained.success.folders.some((folder) =>
                                folder.materials.some((material) => material.archived)
                            )
                        ) {
                            materialsByCourseId.set(lmsCourseId, retained.success);
                        }
                    } else {
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
    const archive = yield* LmsArchiveGateway;
    const source = yield* LmsSourceGateway;
    const detail = yield* readWithPolicy(
        options.sync,
        archive.getMaterialDetail(options.lmsMaterialId),
        Effect.gen(function* () {
            const preferredCourseId = yield* archive.findMaterialCourseId(options.lmsMaterialId);
            return yield* source.withSession(
                options.head,
                (session) =>
                    session.fetchMaterialResources(options.lmsMaterialId, preferredCourseId).pipe(
                        Effect.tap((snapshot) => archive.appendMaterialResources(snapshot)),
                        Effect.andThen(archive.getMaterialDetail(options.lmsMaterialId)),
                    ),
            );
        }),
    );
    const files = yield* ResourceFileGateway;
    return {
        ...detail,
        resources: detail.resources.map((resource) => ({
            ...resource,
            ...(resource.savedFile && resource.lmsResourceId
                ? { savedPath: files.path(resource.lmsResourceId, resource.savedFile.uuid) }
                : {}),
        })),
    };
});

const fetchAndArchiveCourseMaterials = Effect.fn("Core.fetchAndArchiveCourseMaterials")(function* (
    session: LmsSourceSession,
    archive: LmsArchiveGateway["Service"],
    lmsCourseId: LmsCourseId,
) {
    const snapshot = yield* session.fetchCourseMaterials(lmsCourseId);
    yield* archive.appendCourseMaterials(snapshot);
    return yield* archive.listCourseMaterials(lmsCourseId);
});

const downloadResource = Effect.fn("Core.downloadResource")(function* (options: DownloadResourceOptions) {
    const archive = yield* LmsArchiveGateway;
    const source = yield* LmsSourceGateway;
    const files = yield* ResourceFileGateway;
    const preferredCourseId = yield* archive.findMaterialCourseId(options.lmsMaterialId);
    let resourceId = options.lmsResourceId;
    if (resourceId === undefined) {
        const archived = yield* Effect.result(archive.listMaterialResources(options.lmsMaterialId));
        if (Result.isSuccess(archived)) {
            const resource = archived.success.resources[options.position];
            if (resource === undefined) {
                return yield* new LmsSourceGatewayError({
                    operation: "download resource",
                    message: "資料の位置が一覧の範囲外です。",
                });
            }
            resourceId = resource.lmsResourceId;
            if (resourceId === undefined) {
                return yield* new LmsSourceGatewayError({
                    operation: "download resource",
                    message: "旧形式の資料一覧です。教材の資料一覧を再取得してください。",
                });
            }
        } else if (archived.failure._tag !== "LmsArchiveDataMissingError") {
            return yield* archived.failure;
        }
    }
    if (resourceId === undefined) {
        const snapshot = yield* source.withSession(
            options.head,
            (session) => session.fetchMaterialResources(options.lmsMaterialId, preferredCourseId),
        );
        yield* archive.appendMaterialResources(snapshot);
        resourceId = snapshot.materialResources.resources[options.position]?.lmsResourceId;
    }
    if (resourceId === undefined) {
        return yield* new LmsSourceGatewayError({
            operation: "download resource",
            message: "資料のIDを取得できません。",
        });
    }
    const selectedId = resourceId;
    const attempt = Effect.gen(function* () {
        let downloadedPath: string | undefined;
        return yield* Effect.gen(function* () {
            const { snapshot, download } = yield* source.withSession(
                options.head,
                (session) =>
                    Effect.gen(function* () {
                        const retrieval = yield* session.downloadResource(
                            options.lmsMaterialId,
                            selectedId,
                            preferredCourseId,
                        );
                        if (Result.isSuccess(retrieval.download) && retrieval.download.success.type === "file") {
                            // Retain ownership if archiving or authentication finalization fails after the callback.
                            downloadedPath = retrieval.download.success.path;
                        }
                        yield* archive.appendMaterialResources(retrieval.snapshot);
                        return retrieval;
                    }),
            );
            if (Result.isFailure(download)) return yield* download.failure;
            const downloaded = download.success;
            const resource = snapshot.materialResources.resources.find((row) => row.lmsResourceId === selectedId);
            if (resource === undefined) {
                return yield* new LmsSourceGatewayError({
                    operation: "download resource",
                    message: "資料は現在の一覧にありません。保存済み内容を参照してください。",
                });
            }
            // Switch durable success state only after the entire source session has succeeded.
            if (downloaded.type === "external") {
                yield* archive.commitResourceAcquisition(
                    options.lmsMaterialId,
                    selectedId,
                    undefined,
                    DateTime.toDate(DateTime.nowUnsafe()),
                );
                return downloaded;
            }
            const previous = yield* archive.getResourceState(options.lmsMaterialId, selectedId);
            const file = yield* files.save(
                selectedId,
                downloaded.path,
                downloaded.originalFilename ?? resource.name,
                previous?.savedFile,
            );
            const saved = { ...file, sourceUrl: resource.url };
            const obsolete = yield* archive.commitResourceAcquisition(
                options.lmsMaterialId,
                selectedId,
                saved,
                DateTime.toDate(DateTime.nowUnsafe()),
            );
            if (obsolete && obsolete.uuid !== saved.uuid) {
                yield* files.remove(selectedId, obsolete.uuid).pipe(Effect.catch(Effect.logError));
            }
            return {
                ...downloaded,
                path: files.path(selectedId, saved.uuid),
                originalFilename: saved.originalFilename,
            };
        }).pipe(
            Effect.ensuring(
                Effect.suspend(() =>
                    downloadedPath === undefined
                        ? Effect.void
                        : files.discardDownload(downloadedPath).pipe(Effect.catch(Effect.logError))
                ),
            ),
        );
    });
    return yield* files.withResourceLock(selectedId, attempt).pipe(Effect.catch((error) =>
        Effect.gen(function* () {
            yield* archive.recordResourceAttempt(options.lmsMaterialId, selectedId, {
                at: DateTime.toDate(DateTime.nowUnsafe()),
                status: "failure",
                error: error.message,
            }).pipe(Effect.catch(Effect.logError));
            return yield* error;
        })
    ));
});

const readWithPolicy = <A, ArchiveError, FetchError, R>(
    sync: SyncPolicy,
    archived: Effect.Effect<A, ArchiveError | LmsArchiveDataMissingError>,
    fetched: Effect.Effect<A, FetchError, R>,
): Effect.Effect<A, ArchiveError | LmsArchiveDataMissingError | FetchError, R> => {
    if (sync === "true") return fetched;
    if (sync === "false") return archived;
    return archived.pipe(Effect.catchTag("LmsArchiveDataMissingError", () => fetched));
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
        const bind = <A, E extends StorageOrGatewayError>(
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
