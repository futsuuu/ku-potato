import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Effect, Layer, Result } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Synchronous paths keep isolated fixture directories explicit.
import { join } from "node:path";
import { Application } from "../in_port.ts";
import { ApplicationLive } from "../mod.ts";
import {
    LmsArchiveGateway,
    LmsArchiveGatewayError,
    LmsAuthenticationGateway,
    LmsAuthenticationStorageError,
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceSession,
    ResourceFileGateway,
    ResourceFileGatewayError,
} from "../out_port.ts";
import {
    LmsCourseId,
    LmsMaterialId,
    LmsResourceId,
    type MaterialResourcesSnapshot,
    type Resource,
} from "../../domain/mod.ts";
import { makeResourceFileGateway } from "../../filesystem/mod.ts";
import { makeLmsArchiveGateway } from "../../sqlite/mod.ts";

Deno.test("acquisition preserves successful files through failures and archives the actual acquired metadata", async () => {
    const root = await Deno.makeTempDir({ prefix: "ku-potato-archive-test-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const archive = yield* makeLmsArchiveGateway(join(root, "archive.sqlite3"));
            const files = makeResourceFileGateway(join(root, "resources"));
            const materialId = LmsMaterialId("SRY1");
            const resourceId = LmsResourceId("SRS1");
            let resources: readonly Resource[] = [{
                name: "lecture.pdf",
                lmsResourceId: resourceId,
                type: "file",
                sourceKind: "ファイル資料",
            }];
            let body = "first version";
            let sourceFailure = false;
            let databaseFailure = false;
            let authenticationFailure = false;
            let fileFailure = false;
            let temporaryPath: string | undefined;
            let downloads = 0;
            let fetched = 0;
            const snapshot = (): MaterialResourcesSnapshot => ({
                courses: [{ lmsCourseId: LmsCourseId("course-1"), name: "Course", availability: "available" }],
                courseMaterials: {
                    lmsCourseId: LmsCourseId("course-1"),
                    folders: [{
                        name: "Week",
                        materials: [{
                            lmsMaterialId: materialId,
                            name: "Material",
                            type: "material",
                            publicationDeadline: "no-deadline",
                            resourceAvailability: "available",
                        }],
                    }],
                },
                materialResources: { lmsMaterialId: materialId, resources },
            });
            const session: LmsSourceSession = {
                fetchCourses: Effect.die("unexpected fetchCourses"),
                fetchCourseMaterials: () => Effect.die("unexpected fetchCourseMaterials"),
                fetchMaterialResources: () =>
                    Effect.sync(() => {
                        fetched++;
                        return snapshot();
                    }),
                downloadResource: (_id, selectedId) =>
                    Effect.gen(function* () {
                        assertEquals(selectedId, resourceId);
                        downloads++;
                        fetched++;
                        const latest = snapshot();
                        if (sourceFailure) {
                            return {
                                snapshot: latest,
                                download: Result.fail(
                                    new LmsSourceGatewayError({
                                        operation: "download",
                                        message: "source unavailable",
                                    }),
                                ),
                            };
                        }
                        const resource = resources.find((row) => row.lmsResourceId === selectedId);
                        if (resource === undefined) {
                            return {
                                snapshot: latest,
                                download: Result.fail(
                                    new LmsSourceGatewayError({
                                        operation: "download",
                                        message: "resource unavailable",
                                    }),
                                ),
                            };
                        }
                        if (resource.type === "external") {
                            return {
                                snapshot: latest,
                                download: Result.succeed({
                                    type: "external" as const,
                                    url: resource.url!,
                                }),
                            };
                        }
                        const temporary = yield* Effect.promise(() =>
                            Deno.makeTempDir({ prefix: "ku-potato-download-test-" })
                        );
                        const path = join(temporary, "download.pdf");
                        temporaryPath = path;
                        yield* Effect.promise(() => Deno.writeTextFile(path, body));
                        return { snapshot: latest, download: Result.succeed({ type: "file" as const, path }) };
                    }),
            };
            const application = yield* Application.pipe(
                Effect.provide(ApplicationLive.pipe(Layer.provide(Layer.mergeAll(
                    Layer.succeed(LmsArchiveGateway, {
                        ...archive,
                        commitResourceAcquisition: (...args) =>
                            databaseFailure
                                ? Effect.fail(
                                    new LmsArchiveGatewayError({
                                        operation: "commit",
                                        message: "database unavailable",
                                    }),
                                )
                                : archive.commitResourceAcquisition(...args),
                    }),
                    Layer.succeed(ResourceFileGateway, {
                        ...files,
                        save: (...args) =>
                            fileFailure
                                ? Effect.fail(
                                    new ResourceFileGatewayError({ operation: "save", message: "file unavailable" }),
                                )
                                : files.save(...args),
                    }),
                    Layer.succeed(LmsSourceGateway, {
                        withSession: (_head, use) =>
                            use(session).pipe(
                                Effect.filterOrFail(
                                    () => !authenticationFailure,
                                    () =>
                                        new LmsAuthenticationStorageError({
                                            operation: "save authentication state",
                                            message: "authentication storage unavailable",
                                        }),
                                ),
                            ),
                    }),
                    Layer.succeed(LmsAuthenticationGateway, {
                        registerWebAuthnCredential: () => Effect.die("unexpected authentication"),
                        login: () => Effect.die("unexpected login"),
                        logout: Effect.die("unexpected logout"),
                        status: Effect.die("unexpected status"),
                    }),
                )))),
            );
            const acquire = () =>
                application.downloadResource.execute({
                    lmsMaterialId: materialId,
                    lmsResourceId: resourceId,
                    position: 0,
                    head: "false",
                });
            const state = () => archive.getResourceState(materialId, resourceId);
            yield* acquire();
            const first = yield* state();
            assert(first?.savedFile);
            const firstPath = files.path(resourceId, first.savedFile.uuid);
            assertEquals(Deno.readTextFileSync(firstPath), body);
            yield* acquire();
            assertEquals((yield* state())?.savedFile?.uuid, first.savedFile.uuid);
            assertEquals(downloads, 2);
            assertEquals(fetched, 2);
            const detail = yield* application.viewMaterial.execute({
                lmsMaterialId: materialId,
                sync: "false",
                head: "false",
            });
            assertEquals(detail.resources[0]?.savedPath, firstPath);
            assertEquals(fetched, 2);
            const successfulAt = (yield* state())?.acquisition?.lastSucceededAt;
            sourceFailure = true;
            const failedSource = yield* Effect.result(acquire());
            assert(Result.isFailure(failedSource));
            const afterSource = yield* state();
            assertEquals(afterSource?.savedFile, first.savedFile);
            assertEquals(afterSource?.acquisition?.lastSucceededAt, successfulAt);
            assertEquals(afterSource?.acquisition?.lastAttempt.error, "source unavailable");
            assertEquals(Deno.readTextFileSync(firstPath), "first version");
            sourceFailure = false;
            body = "second version";
            authenticationFailure = true;
            assert(Result.isFailure(yield* Effect.result(acquire())));
            assertEquals((yield* state())?.savedFile, first.savedFile);
            assertEquals((yield* state())?.acquisition?.lastSucceededAt, successfulAt);
            assertEquals((yield* state())?.acquisition?.lastAttempt.error, "authentication storage unavailable");
            assertEquals(Deno.readTextFileSync(firstPath), "first version");
            assert(temporaryPath);
            assertEquals(yield* Effect.promise(() => Deno.stat(temporaryPath!).catch(() => "missing")), "missing");
            authenticationFailure = false;
            fileFailure = true;
            assert(Result.isFailure(yield* Effect.result(acquire())));
            assertEquals((yield* state())?.savedFile, first.savedFile);
            assertEquals((yield* state())?.acquisition?.lastSucceededAt, successfulAt);
            assertEquals((yield* state())?.acquisition?.lastAttempt.error, "file unavailable");
            assertEquals(Deno.readTextFileSync(firstPath), "first version");
            assertEquals(yield* Effect.promise(() => Deno.stat(temporaryPath!).catch(() => "missing")), "missing");
            fileFailure = false;
            databaseFailure = true;
            const failedDb = yield* Effect.result(acquire());
            assert(Result.isFailure(failedDb));
            assertEquals((yield* state())?.savedFile, first.savedFile);
            assertEquals((yield* state())?.acquisition?.lastSucceededAt, successfulAt);
            assertEquals((yield* state())?.acquisition?.lastAttempt.error, "database unavailable");
            assertEquals(Deno.readTextFileSync(firstPath), "first version");
            databaseFailure = false;
            yield* acquire();
            const second = yield* state();
            assert(second?.savedFile);
            assertNotEquals(second.savedFile.uuid, first.savedFile.uuid);
            assertEquals(Deno.readTextFileSync(files.path(resourceId, second.savedFile.uuid)), body);
            assertEquals(
                yield* Effect.promise(() =>
                    Deno.stat(firstPath).catch((error) =>
                        error instanceof Deno.errors.NotFound ? "missing" : "unexpected"
                    )
                ),
                "missing",
            );
            Deno.writeTextFileSync(files.path(resourceId, second.savedFile.uuid), "corrupted");
            yield* acquire();
            const repaired = yield* state();
            assert(repaired?.savedFile);
            assertNotEquals(repaired.savedFile.uuid, second.savedFile.uuid);
            assertEquals(Deno.readTextFileSync(files.path(resourceId, repaired.savedFile.uuid)), body);
            // The acquired snapshot replaces the stale list, including name, kind, and URL.
            resources = [{
                name: "Renamed external slides",
                lmsResourceId: resourceId,
                type: "external",
                sourceKind: "外部資料",
                url: "https://example.com/new",
            }];
            const beforeExternalFailure = (yield* state())?.acquisition?.lastSucceededAt;
            authenticationFailure = true;
            assert(Result.isFailure(yield* Effect.result(acquire())));
            const failedExternal = yield* state();
            assertEquals(failedExternal?.name, "Renamed external slides");
            assertEquals(failedExternal?.type, "external");
            assertEquals(failedExternal?.url, "https://example.com/new");
            assertEquals(failedExternal?.savedFile, repaired.savedFile);
            assertEquals(failedExternal?.acquisition?.lastSucceededAt, beforeExternalFailure);
            assertEquals(failedExternal?.acquisition?.lastAttempt.error, "authentication storage unavailable");
            authenticationFailure = false;
            assertEquals(yield* acquire(), { type: "external", url: "https://example.com/new" });
            resources = [{ ...resources[0]!, name: "Updated URL", url: "https://example.com/newer" }];
            sourceFailure = true;
            assert(Result.isFailure(yield* Effect.result(acquire())));
            assertEquals((yield* state())?.url, "https://example.com/newer");
            assertEquals((yield* state())?.name, "Updated URL");
            assertEquals((yield* state())?.savedFile, repaired.savedFile);
            sourceFailure = false;
            resources = [{
                ...resources[0]!,
                type: "file",
                name: "latest.pdf",
                url: "https://example.com/file-source",
            }];
            yield* acquire();
            const latestFile = (yield* state())?.savedFile;
            assert(latestFile);
            assertEquals(latestFile.originalFilename, "latest.pdf");
            assertEquals(latestFile.sourceUrl, "https://example.com/file-source");
            resources = [];
            yield* archive.appendMaterialResources(snapshot());
            const removed = yield* application.viewMaterial.execute({
                lmsMaterialId: materialId,
                sync: "false",
                head: "false",
            });
            assertEquals(removed.resources[0]?.availability, "archived");
            assertEquals(removed.resources[0]?.savedFile, latestFile);
            assert(Result.isFailure(yield* Effect.result(acquire())));
            assertEquals((yield* state())?.savedFile, latestFile);
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
