import { assert, assertEquals, assertRejects } from "@std/assert";
import { Effect } from "effect";
import { makeLmsAuthenticationGateway, makeLmsGateways } from "./mod.ts";
import { credentialSourcesStoragePath } from "./webauthn.ts";
import {
    LmsAuthenticationStorageError,
    LmsCourseNotFoundError,
    LmsMaterialNotFoundError,
    LmsSourceGatewayError,
} from "../core/out_port.ts";
import { type CourseMaterialsSnapshot, LmsCourseId, LmsMaterialId, type Material } from "../domain/mod.ts";
import { hasAuthenticationState, storageStatePath, withAuthenticatedPage } from "./testing.ts";

Deno.test("Logout removes isolated authentication state and succeeds when it is already absent", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-logout-test-" });
    const statePath = `${directory}/storage-state.json`;
    try {
        await Deno.writeTextFile(statePath, "{}");
        await Deno.writeTextFile(credentialSourcesStoragePath(statePath), "{}");
        const authentication = makeLmsAuthenticationGateway(statePath);
        await Effect.runPromise(authentication.logout);
        await assertRejects(() => Deno.stat(statePath), Deno.errors.NotFound);
        await assertRejects(() => Deno.stat(credentialSourcesStoragePath(statePath)), Deno.errors.NotFound);
        await Effect.runPromise(authentication.logout);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});

Deno.test({
    name: "KU-LMS gateways exercise all source and authentication operations against the live site",
    ignore: !hasAuthenticationState,
    async fn(t) {
        const directory = await Deno.makeTempDir({ prefix: "ku-potato-live-test-" });
        const copiedStatePath = `${directory}/storage-state.json`;
        try {
            await withAuthenticatedPage((page) => page.context().storageState({ path: copiedStatePath }));
            const { authentication, source } = makeLmsGateways(copiedStatePath);
            if (
                !await t.step("Login saves authentication and status reports authenticated", async () => {
                    await Effect.runPromise(authentication.login("false"));
                    assertEquals(await Effect.runPromise(authentication.status), "authenticated");
                    const state = JSON.parse(await Deno.readTextFile(copiedStatePath));
                    assert(Array.isArray(state.cookies), "Login must persist browser cookies.");
                })
            ) return;

            await Effect.runPromise(source.withSession("false", (session) =>
                Effect.promise(async () => {
                    const courses = await Effect.runPromise(session.fetchCourses);
                    const availableCourses = courses.filter((course) => course.availability === "available");
                    let snapshot: CourseMaterialsSnapshot | undefined;
                    let publishedMaterial: Material | undefined;
                    let otherMaterial: Material | undefined;

                    await t.step("Fetches courses through the source session", () => {
                        for (const course of courses) {
                            assert(course.name.length > 0, "A fetched course must have a name.");
                        }
                    });

                    await t.step({
                        name: "Fetches course materials with their course snapshot",
                        ignore: availableCourses.length === 0,
                        async fn() {
                            for (const course of availableCourses) {
                                const result = await Effect.runPromise(
                                    session.fetchCourseMaterials(course.lmsCourseId),
                                );
                                assertEquals(result.courseMaterials.lmsCourseId, course.lmsCourseId);
                                assertEquals(result.courses, courses);
                                snapshot ??= result;
                                const materials = result.courseMaterials.folders.flatMap((folder) => folder.materials);
                                publishedMaterial ??= materials.find((material) =>
                                    material.type === "material" && material.resourceAvailability === "available"
                                );
                                otherMaterial ??= materials.find((material) =>
                                    material.type !== "material" || material.resourceAvailability === "unavailable"
                                );
                                for (const folder of result.courseMaterials.folders) {
                                    assert(folder.name.length > 0, "A material folder must have a name.");
                                    for (const material of folder.materials) {
                                        assert(material.name.length > 0, "A material must have a name.");
                                        assert(material.lmsMaterialId.length > 0, "A material must have an LMS ID.");
                                    }
                                }
                                if (publishedMaterial !== undefined && otherMaterial !== undefined) break;
                            }
                        },
                    });

                    await t.step({
                        name: "Fetches published material resources with their course and material snapshots",
                        ignore: publishedMaterial === undefined,
                        async fn() {
                            assert(publishedMaterial !== undefined);
                            const materialId = publishedMaterial.lmsMaterialId;
                            const result = await Effect.runPromise(
                                session.fetchMaterialResources(materialId),
                            );
                            assertEquals(result.materialResources.lmsMaterialId, publishedMaterial.lmsMaterialId);
                            assertEquals(result.courses, courses);
                            assert(
                                result.courseMaterials.folders.some((folder) =>
                                    folder.materials.some((material) => material.lmsMaterialId === materialId)
                                ),
                                "The resource snapshot must contain the requested material.",
                            );
                            for (const resource of result.materialResources.resources) {
                                assert(resource.name.length > 0, "A resource must have a name.");
                            }
                        },
                    });

                    await t.step({
                        name: "Returns no resources for other material types or unpublished materials",
                        ignore: otherMaterial === undefined,
                        async fn() {
                            assert(otherMaterial !== undefined);
                            const result = await Effect.runPromise(
                                session.fetchMaterialResources(otherMaterial.lmsMaterialId),
                            );
                            assertEquals(result.materialResources, {
                                lmsMaterialId: otherMaterial.lmsMaterialId,
                                resources: [],
                            });
                        },
                    });

                    await t.step("Rejects a missing course with the requested course ID", async () => {
                        const lmsCourseId = LmsCourseId("KU_POTATO_MISSING_COURSE");
                        const error = await assertRejects(
                            () => Effect.runPromise(session.fetchCourseMaterials(lmsCourseId)),
                            LmsCourseNotFoundError,
                        );
                        assertEquals(error.lmsCourseId, lmsCourseId);
                    });

                    await t.step("Rejects a missing material after searching the available courses", async () => {
                        const lmsMaterialId = LmsMaterialId("KU_POTATO_MISSING_MATERIAL");
                        const error = await assertRejects(
                            () => Effect.runPromise(session.fetchMaterialResources(lmsMaterialId)),
                            LmsMaterialNotFoundError,
                        );
                        assertEquals(error.lmsMaterialId, lmsMaterialId);
                    });

                    await t.step({
                        name: "Serializes concurrent source operations on the shared page",
                        ignore: snapshot === undefined,
                        async fn() {
                            assert(snapshot !== undefined);
                            const [listedCourses, fetchedMaterials] = await Promise.all([
                                Effect.runPromise(session.fetchCourses),
                                Effect.runPromise(session.fetchCourseMaterials(snapshot.courseMaterials.lmsCourseId)),
                            ]);
                            assertEquals(listedCourses, courses);
                            assertEquals(fetchedMaterials.courseMaterials, snapshot.courseMaterials);
                        },
                    });
                })));

            await t.step("Closes a failed session and permits the next session to run", async () => {
                await assertRejects(
                    () =>
                        Effect.runPromise(
                            source.withSession("false", () =>
                                Effect.fail(
                                    new LmsSourceGatewayError({
                                        operation: "live test callback",
                                        message: "Expected session failure.",
                                    }),
                                )),
                        ),
                    LmsSourceGatewayError,
                    "Expected session failure.",
                );
                await Effect.runPromise(source.withSession("auto", (session) => session.fetchCourses));
            });

            await t.step("Logout removes only the copied authentication and is idempotent", async () => {
                await Effect.runPromise(authentication.logout);
                await assertRejects(() => Deno.stat(copiedStatePath), Deno.errors.NotFound);
                await Effect.runPromise(authentication.logout);
                assertEquals(await Effect.runPromise(authentication.status), "unauthenticated");
                await Deno.stat(storageStatePath);
            });

            await t.step("Malformed saved authentication reports a storage error", async () => {
                await Deno.writeTextFile(copiedStatePath, "not valid JSON");
                const error = await assertRejects(
                    () => Effect.runPromise(authentication.status),
                    LmsAuthenticationStorageError,
                );
                assertEquals(error.operation, "restore authentication state");
            });
        } finally {
            await Deno.remove(directory, { recursive: true });
        }
    },
});
