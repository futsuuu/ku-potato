import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { DateTime, Effect } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Tests construct synchronous fixture paths.
import { basename, join } from "node:path";
import { ResourceFileGatewayError } from "../core/out_port.ts";
import { LmsResourceId } from "../domain/mod.ts";
import { makeResourceFileGateway } from "./mod.ts";

const resourceId = LmsResourceId("SRS0000000000001");
const withDirectory = async (use: (directory: string) => Promise<void>) => {
    const directory = await Deno.makeTempDir({ prefix: "ku-potato-filesystem-test-" });
    try {
        await use(directory);
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
};

Deno.test("resource files use UUIDs and retain their original names and content digest", () =>
    withDirectory(async (directory) => {
        const source = join(directory, "input");
        await Deno.writeTextFile(source, "abc");
        const gateway = makeResourceFileGateway(join(directory, "archive"));
        const saved = await Effect.runPromise(gateway.save(resourceId, source, "../original document.pdf"));
        assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saved.uuid));
        assertEquals(saved.originalFilename, "../original document.pdf");
        assertEquals(saved.size, 3);
        assertEquals(saved.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assertEquals(basename(gateway.path(resourceId, saved.uuid)), saved.uuid);
        assertEquals(await Deno.readTextFile(gateway.path(resourceId, saved.uuid)), "abc");
        // Download cleanup is controlled separately from durable storage.
        assertEquals(await Deno.readTextFile(source), "abc");
    }));

Deno.test("unchanged content reuses its UUID without rewriting; changed content leaves the old file intact", () =>
    withDirectory(async (directory) => {
        const source = join(directory, "input");
        const gateway = makeResourceFileGateway(join(directory, "archive"));
        await Deno.writeTextFile(source, "first document");
        const first = await Effect.runPromise(gateway.save(resourceId, source, "first.pdf"));
        const firstPath = gateway.path(resourceId, first.uuid);
        const timestamp = DateTime.toDate(DateTime.makeUnsafe("2020-01-01T00:00:00Z"));
        await Deno.utime(firstPath, timestamp, timestamp);
        const before = (await Deno.stat(firstPath)).mtime;
        const unchanged = await Effect.runPromise(gateway.save(resourceId, source, "renamed.pdf", first));
        assertEquals(unchanged.uuid, first.uuid);
        assertEquals(unchanged.originalFilename, "renamed.pdf");
        assertEquals((await Deno.stat(firstPath)).mtime, before);
        await Deno.writeTextFile(source, "second document");
        const changed = await Effect.runPromise(gateway.save(resourceId, source, "second.pdf", unchanged));
        assertNotEquals(changed.uuid, first.uuid);
        assertEquals(await Deno.readTextFile(firstPath), "first document");
        assertEquals(await Deno.readTextFile(gateway.path(resourceId, changed.uuid)), "second document");
        await Effect.runPromise(gateway.remove(resourceId, first.uuid));
        await assertRejects(() => Deno.stat(firstPath), Deno.errors.NotFound);
        await Effect.runPromise(gateway.remove(resourceId, first.uuid));
        assertEquals(await Deno.readTextFile(gateway.path(resourceId, changed.uuid)), "second document");
    }));

Deno.test("missing and corrupt saved files are repaired with fresh UUIDs even when the source digest matches", () =>
    withDirectory(async (directory) => {
        const source = join(directory, "input");
        const gateway = makeResourceFileGateway(join(directory, "archive"));
        await Deno.writeTextFile(source, "document");
        const first = await Effect.runPromise(gateway.save(resourceId, source, "document.pdf"));
        await Deno.remove(gateway.path(resourceId, first.uuid));
        const repairedMissing = await Effect.runPromise(gateway.save(resourceId, source, "document.pdf", first));
        assertNotEquals(repairedMissing.uuid, first.uuid);
        assertEquals(await Deno.readTextFile(gateway.path(resourceId, repairedMissing.uuid)), "document");
        // Same size deliberately verifies that the adapter checks actual bytes.
        await Deno.writeTextFile(gateway.path(resourceId, repairedMissing.uuid), "corrupt!");
        const repairedCorrupt = await Effect.runPromise(
            gateway.save(resourceId, source, "document.pdf", repairedMissing),
        );
        assertNotEquals(repairedCorrupt.uuid, repairedMissing.uuid);
        assertEquals(await Deno.readTextFile(gateway.path(resourceId, repairedCorrupt.uuid)), "document");
    }));

Deno.test("resource ID and UUID validation prevent paths escaping the storage directory", () =>
    withDirectory(async (directory) => {
        const source = join(directory, "input");
        await Deno.writeTextFile(source, "document");
        const gateway = makeResourceFileGateway(join(directory, "archive"));
        const uuid = "12345678-1234-1234-1234-123456789012";
        for (const id of ["../escape", "SRS1/../../escape", "C:\\escape", "SRS"]) {
            assertThrows(() => gateway.path(LmsResourceId(id), uuid));
            await assertRejects(
                () => Effect.runPromise(gateway.save(LmsResourceId(id), source, "document.pdf")),
                ResourceFileGatewayError,
            );
        }
        for (const value of ["../escape", "12345678-1234-1234-1234-123456789012/../escape", "C:\\escape", ""]) {
            assertThrows(() => gateway.path(resourceId, value));
            await assertRejects(() => Effect.runPromise(gateway.remove(resourceId, value)), ResourceFileGatewayError);
        }
        assertEquals(await Deno.readTextFile(source), "document");
    }));

Deno.test("independent gateway instances serialize operations and release their OS locks after success and failure", () =>
    withDirectory(async (directory) => {
        const root = join(directory, "archive");
        const first = makeResourceFileGateway(root);
        const second = makeResourceFileGateway(root);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const order: string[] = [];
        let secondEntered = false;
        const firstOperation = Effect.runPromise(first.withResourceLock(
            resourceId,
            Effect.promise(async () => {
                order.push("first-enter");
                entered.resolve();
                await release.promise;
                order.push("first-exit");
            }),
        ));
        await entered.promise;
        const secondOperation = Effect.runPromise(second.withResourceLock(
            resourceId,
            Effect.sync(() => {
                secondEntered = true;
                order.push("second-enter");
            }),
        ));
        try {
            await Effect.runPromise(Effect.sleep("50 millis"));
            assertEquals(secondEntered, false);
        } finally {
            release.resolve();
            await Promise.all([firstOperation, secondOperation]);
        }
        assertEquals(order, ["first-enter", "first-exit", "second-enter"]);
        await assertRejects(() =>
            Effect.runPromise(
                first.withResourceLock(
                    resourceId,
                    Effect.fail(new ResourceFileGatewayError({ operation: "test", message: "operation failed" })),
                ),
            )
        );
        const value = await Effect.runPromise(
            second.withResourceLock(resourceId, Effect.succeed("released")).pipe(Effect.timeout("2 seconds")),
        );
        assertEquals(value, "released");
    }));
