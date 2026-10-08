import { assert, assertEquals } from "@std/assert";
import { DateTime, Effect, Option, Result } from "effect";
import { type CourseMaterialsSnapshot, LmsCourseId, LmsMaterialId, LmsResourceId } from "../domain/mod.ts";
import { makeLmsArchiveGateway, openArchiveDatabase } from "./mod.ts";
import { courseMaterialsJobAdapter } from "./course_material_job.ts";
import { makeJobQueue } from "./queue.ts";

const courseId = LmsCourseId("course-1");
const snapshot = (name: string): CourseMaterialsSnapshot => ({
    courses: [{ lmsCourseId: courseId, name: "Course", availability: "available" }],
    courseMaterials: {
        lmsCourseId: courseId,
        folders: [{
            name: "Folder",
            materials: [{
                lmsMaterialId: LmsMaterialId("material-1"),
                name,
                type: "material",
                resourceAvailability: "available",
                publicationDeadline: DateTime.toDate(DateTime.makeUnsafe("2026-10-01T12:00:00Z")),
            }],
        }],
    },
});

Deno.test("queue result excludes URLs and files acquired after completion, including archived courses", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const archive = yield* makeLmsArchiveGateway(`${directory}/archive.sqlite3`);
            const otherId = LmsCourseId("other-course"), otherMaterialId = LmsMaterialId("other-material");
            const original = snapshot("Original");
            const other: CourseMaterialsSnapshot = {
                courses: [{ lmsCourseId: otherId, name: "Other course", availability: "available" }],
                courseMaterials: {
                    lmsCourseId: otherId,
                    folders: [{
                        name: "Other folder",
                        materials: [{
                            ...original.courseMaterials.folders[0].materials[0],
                            lmsMaterialId: otherMaterialId,
                        }],
                    }],
                },
            };
            yield* archive.appendCourseMaterials(original);
            yield* archive.appendCourseMaterials(other);
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            assertEquals(
                yield* queue.complete({
                    job: owner,
                    output: {
                        courses: original.courses,
                        courseMaterials: { lmsCourseId: courseId, folders: [] },
                    },
                }),
                true,
            );
            const completed = yield* queue.get(job.id, "fetch-course-materials");
            assert(completed?.status === "succeeded");
            const initial = yield* queue.result(completed.id, "fetch-course-materials");
            assert(Option.isSome(initial));
            assertEquals(initial.value.courseMaterials.folders, []);
            assertEquals(initial.value.courses, original.courses);
            for (const bundled of [original, other]) {
                const materialId = bundled.courseMaterials.folders[0].materials[0].lmsMaterialId;
                yield* archive.appendMaterialResources({
                    ...bundled,
                    materialResources: {
                        lmsMaterialId: materialId,
                        resources: [{
                            lmsResourceId: LmsResourceId("URL"),
                            name: "Link",
                            type: "external",
                            sourceKind: "URL資料",
                            url: "https://example.test/original",
                        }, {
                            lmsResourceId: LmsResourceId("FILE"),
                            name: "File",
                            type: "file",
                            sourceKind: "ファイル資料",
                        }],
                    },
                });
                assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
                yield* archive.commitResourceAcquisition(materialId, LmsResourceId("FILE"), {
                    uuid: "e6b356f2-730f-4d91-8f11-9730bd459d96",
                    originalFilename: "saved.pdf",
                    sha256: "hash",
                    size: 10,
                }, DateTime.toDate(DateTime.nowUnsafe()));
                assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
            }
            yield* archive.appendCourseMaterials({
                courses: original.courses,
                courseMaterials: { lmsCourseId: courseId, folders: [] },
            });
            assertEquals((yield* archive.listCourseMaterials(courseId)).folders[0].materials[0].archived, true);
            assertEquals((yield* archive.listCourses)[1].archived, true);
            assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue result keeps saved URL overlays after URL changes, removal, and renamed material reappearance", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const archive = yield* makeLmsArchiveGateway(`${directory}/archive.sqlite3`);
            const otherId = LmsCourseId("other-course"), otherMaterialId = LmsMaterialId("other-material");
            const original = snapshot("Original");
            const bundles: CourseMaterialsSnapshot[] = [original, {
                courses: [{ lmsCourseId: otherId, name: "Other course", availability: "available" }],
                courseMaterials: {
                    lmsCourseId: otherId,
                    folders: [{
                        name: "Other folder",
                        materials: [{
                            ...original.courseMaterials.folders[0].materials[0],
                            lmsMaterialId: otherMaterialId,
                        }],
                    }],
                },
            }];
            const resources = (bundled: CourseMaterialsSnapshot, url?: string) => ({
                ...bundled,
                materialResources: {
                    lmsMaterialId: bundled.courseMaterials.folders[0].materials[0].lmsMaterialId,
                    resources: [{
                        lmsResourceId: LmsResourceId("URL"),
                        name: "Link",
                        type: "external" as const,
                        sourceKind: "URL資料",
                        ...(url === undefined ? {} : { url }),
                    }],
                },
            });
            for (const bundled of bundles) {
                yield* archive.appendMaterialResources(resources(bundled, "https://example.test/original"));
            }
            const removed = { courses: original.courses, courseMaterials: { lmsCourseId: courseId, folders: [] } };
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            assertEquals(yield* queue.complete({ job: owner, output: removed }), true);
            const completed = yield* queue.get(job.id, "fetch-course-materials");
            assert(completed?.status === "succeeded");
            const initial = yield* queue.result(completed.id, "fetch-course-materials");
            assert(Option.isSome(initial));
            assertEquals(initial.value.courseMaterials.folders[0].materials[0].name, "Original");
            assertEquals(initial.value.courseMaterials.folders[0].materials[0].archived, true);
            assertEquals(initial.value.courses[1], { ...bundles[1].courses[0], archived: true });
            for (const url of ["https://example.test/changed", undefined]) {
                for (const bundled of bundles) yield* archive.appendMaterialResources(resources(bundled, url));
                yield* archive.appendCourseMaterials(removed);
                assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
            }
            assertEquals(yield* archive.listCourses, original.courses);
            assertEquals((yield* archive.listCourseMaterials(courseId)).folders, []);
            yield* archive.appendCourseMaterials(snapshot("Reappeared renamed"));
            assertEquals(
                (yield* archive.listCourseMaterials(courseId)).folders[0].materials[0].name,
                "Reappeared renamed",
            );
            assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("failed and expired completions cannot write saved-material snapshot membership", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const path = `${directory}/archive.sqlite3`;
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], path);
            const archive = yield* makeLmsArchiveGateway(path);
            yield* archive.appendMaterialResources({
                ...snapshot("Original"),
                materialResources: {
                    lmsMaterialId: LmsMaterialId("material-1"),
                    resources: [{
                        lmsResourceId: LmsResourceId("URL"),
                        name: "Link",
                        type: "external",
                        sourceKind: "URL資料",
                        url: "https://example.test/original",
                    }],
                },
            });
            const database = yield* openArchiveDatabase(path);
            const counts = () =>
                database.$client.prepare(`
                select (select count(*) from course_material_retrievals) as retrievals,
                    (select count(*) from course_material_saved_materials) as saved
            `).get();
            assertEquals(counts(), { retrievals: 1, saved: 1 });
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            assert(
                Result.isFailure(
                    yield* Effect.result(
                        queue.complete({ job: owner, output: { ...snapshot("Invalid"), courses: [] } }),
                    ),
                ),
            );
            assertEquals(counts(), { retrievals: 1, saved: 1 });
            database.$client.exec(`create trigger reject_completion before update on jobs
                when new.status = 'succeeded' begin select raise(abort, 'reject completion'); end`);
            assert(Result.isFailure(yield* Effect.result(queue.complete({ job: owner, output: snapshot("Valid") }))));
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "running");
            assertEquals(counts(), { retrievals: 1, saved: 1 });
            database.$client.exec("drop trigger reject_completion");
            assertEquals(yield* queue.complete({ job: owner, output: snapshot("Valid") }), true);
            assertEquals(counts(), { retrievals: 2, saved: 2 });
            yield* queue.enqueue({ kind: "fetch-course-materials", input: { lmsCourseId: courseId, head: "false" } });
            const expired = yield* queue.claim("expired", 20);
            assert(expired);
            yield* Effect.sleep("30 millis");
            assertEquals(yield* queue.complete({ job: expired, output: snapshot("Expired") }), false);
            assertEquals(counts(), { retrievals: 2, saved: 2 });
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue result retains acquired removed materials using only history at its result reference", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const archive = yield* makeLmsArchiveGateway(`${directory}/archive.sqlite3`);
            const materialId = LmsMaterialId("material-1"), resourceId = LmsResourceId("SRS1");
            yield* archive.appendMaterialResources({
                ...snapshot("Original"),
                materialResources: {
                    lmsMaterialId: materialId,
                    resources: [{
                        lmsResourceId: resourceId,
                        name: "original.pdf",
                        type: "file",
                        sourceKind: "ファイル資料",
                    }],
                },
            });
            yield* archive.commitResourceAcquisition(materialId, resourceId, {
                uuid: "e6b356f2-730f-4d91-8f11-9730bd459d96",
                originalFilename: "original.pdf",
                sha256: "hash",
                size: 10,
            }, DateTime.toDate(DateTime.nowUnsafe()));
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            yield* queue.complete({
                job: owner,
                output: {
                    courses: snapshot("Original").courses,
                    courseMaterials: { lmsCourseId: courseId, folders: [] },
                },
            });
            const completed = yield* queue.get(job.id, "fetch-course-materials");
            assert(completed?.status === "succeeded");
            const initial = yield* queue.result(completed.id, "fetch-course-materials");
            assert(Option.isSome(initial));
            assertEquals(initial.value.courseMaterials.folders[0].materials[0].name, "Original");
            assertEquals(initial.value.courseMaterials.folders[0].materials[0].archived, true);
            yield* archive.appendCourseMaterials({
                ...snapshot("Renamed later"),
                courses: [{ lmsCourseId: courseId, name: "New course name", availability: "available" }],
                courseMaterials: {
                    ...snapshot("Renamed later").courseMaterials,
                    folders: [{ ...snapshot("Renamed later").courseMaterials.folders[0], name: "New folder name" }],
                },
            });
            assertEquals(yield* queue.result(completed.id, "fetch-course-materials"), initial);
            assertEquals((yield* archive.listCourseMaterials(courseId)).folders[0].materials[0].name, "Renamed later");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("generic queue claims more than three jobs independently of KU-LMS capacity", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            for (let index = 0; index < 4; index++) {
                yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: LmsCourseId(`course-${index}`), head: "false" },
                });
            }
            const owners = yield* Effect.forEach([0, 1, 2, 3], (index) => queue.claim(`worker-${index}`, 10000));
            assert(owners.every((owner) => owner !== undefined));
            assertEquals(yield* queue.claim("fourth", 1000), undefined);
            assertEquals(new Set(owners.map((owner) => owner?.id)).size, 4);
            for (const owner of owners) assertEquals((yield* queue.get(owner!.id, owner!.kind))?.status, "running");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue fences lost owners, renews leases, and returns the exact immutable result", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const archive = yield* makeLmsArchiveGateway(`${directory}/archive.sqlite3`);
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            assertEquals(
                (yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: courseId, head: "false" },
                })).id,
                job.id,
            );
            const lost = yield* queue.claim("worker-a", 30);
            assert(lost);
            yield* Effect.sleep("40 millis");
            assertEquals(yield* queue.heartbeat(lost, 1000), false);
            assertEquals(yield* queue.complete({ job: lost, output: snapshot("stale") }), false);
            const owner = yield* queue.claim("worker-b", 500);
            assert(owner);
            assertEquals(owner.id, job.id);
            assert(owner.leaseToken !== lost.leaseToken);
            assertEquals(yield* queue.heartbeat(owner, 1000), true);
            assertEquals(yield* queue.complete({ job: lost, output: snapshot("stale") }), false);
            assertEquals(
                yield* queue.fail(lost, { message: "old", tag: "Error", retry: false, blocked: false }, 0),
                false,
            );
            assertEquals(yield* queue.complete({ job: owner, output: snapshot("first") }), true);
            const done = yield* queue.get(job.id, "fetch-course-materials");
            assert(done?.status === "succeeded");
            yield* archive.appendCourseMaterials(snapshot("later"));
            assertEquals(yield* queue.result(done.id, "fetch-course-materials"), Option.some(snapshot("first")));
            const again = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            assert(again.id !== job.id);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("queue has bounded retry and blocked authentication can be resubmitted", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "auto" },
            });
            for (let attempt = 1; attempt <= 3; attempt++) {
                const owner = yield* queue.claim("worker", 1000);
                assert(owner);
                assertEquals(owner.attempts, attempt);
                yield* queue.fail(owner, {
                    message: "Network unavailable",
                    tag: "LmsSourceGatewayError",
                    retry: true,
                    blocked: false,
                }, 0);
            }
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "failed");
            assertEquals(yield* queue.claim("worker", 1000), undefined);
            const blocked = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "auto" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            yield* queue.fail(owner, {
                message: "Login required",
                tag: "LmsAuthenticationRequiredError",
                retry: false,
                blocked: true,
            }, 0);
            assertEquals((yield* queue.get(blocked.id, "fetch-course-materials"))?.status, "blocked");
            assert(
                (yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: courseId, head: "auto" },
                })).id !== blocked.id,
            );
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test("invalid snapshot rolls back both archive writes and completion", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-" });
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            const job = yield* queue.enqueue({
                kind: "fetch-course-materials",
                input: { lmsCourseId: courseId, head: "false" },
            });
            const owner = yield* queue.claim("worker", 1000);
            assert(owner);
            yield* Effect.result(queue.complete({ job: owner, output: { ...snapshot("invalid"), courses: [] } }));
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "running");
            assertEquals(yield* queue.result(1, "fetch-course-materials"), Option.none());
            assertEquals(yield* queue.complete({ job: owner, output: snapshot("valid") }), true);
            assertEquals((yield* queue.get(job.id, "fetch-course-materials"))?.status, "succeeded");
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
