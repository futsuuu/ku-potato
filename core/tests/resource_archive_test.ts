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
    LmsSourceGateway,
    LmsSourceGatewayError,
    type LmsSourceSession,
    ResourceFileGateway,
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

Deno.test("acquisition preserves the last successful file through source and DB failures and repairs damage", async () => {
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
                        if (sourceFailure) {
                            return yield* new LmsSourceGatewayError({
                                operation: "download",
                                message: "source unavailable",
                            });
                        }
                        const temporary = yield* Effect.promise(() =>
                            Deno.makeTempDir({ prefix: "ku-potato-download-test-" })
                        );
                        const path = join(temporary, "download.pdf");
                        yield* Effect.promise(() => Deno.writeTextFile(path, body));
                        return { type: "file", path, originalFilename: "lecture.pdf" } as const;
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
                    Layer.succeed(ResourceFileGateway, files),
                    Layer.succeed(LmsSourceGateway, { withSession: (_head, use) => use(session) }),
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
            databaseFailure = true;
            const failedDb = yield* Effect.result(acquire());
            assert(Result.isFailure(failedDb));
            assertEquals((yield* state())?.savedFile, first.savedFile);
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
            resources = [];
            yield* archive.appendMaterialResources(snapshot());
            const removed = yield* application.viewMaterial.execute({
                lmsMaterialId: materialId,
                sync: "false",
                head: "false",
            });
            assertEquals(removed.resources[0]?.availability, "archived");
            assertEquals(removed.resources[0]?.savedFile, repaired.savedFile);
            assert(Result.isFailure(yield* Effect.result(acquire())));
            assertEquals((yield* state())?.savedFile, repaired.savedFile);
        })));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
