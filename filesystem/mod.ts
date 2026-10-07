import { DenoCrypto } from "@effect/platform-deno";
import { Crypto, Effect, Layer, Result, Schema } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Incremental hashing keeps memory bounded for files of any size.
import { createHash } from "node:crypto";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Paths are derived synchronously, matching platform directory defaults.
import { basename, dirname, join } from "node:path";
import type { LmsResourceId, SavedResourceFile } from "../domain/mod.ts";
import { ResourceFileGateway, ResourceFileGatewayError, type ResourceFileGatewayService } from "../core/out_port.ts";
import { applicationDataPath } from "../platform/directories.ts";

const fileTry = <A>(operation: string, use: () => Promise<A>) =>
    Effect.tryPromise({
        try: use,
        catch: (cause) =>
            new ResourceFileGatewayError({
                operation,
                message: cause instanceof Error ? cause.message : String(cause),
            }),
    });

const digest = Effect.fn("ResourceFiles.digest")(function* (path: string) {
    return yield* Effect.scoped(Effect.gen(function* () {
        const hash = createHash("sha256");
        let size = 0;
        const file = yield* Effect.acquireRelease(
            fileTry("open file to hash", () => Deno.open(path, { read: true })),
            (handle) => Effect.sync(() => handle.close()),
        );
        const buffer = new Uint8Array(1024 * 1024);
        for (;;) {
            const length = yield* fileTry("read file to hash", () => file.read(buffer));
            if (length === null) break;
            hash.update(buffer.subarray(0, length));
            size += length;
        }
        return { sha256: hash.digest("hex"), size };
    }));
});

const resourceIdSchema = Schema.String.check(Schema.isPattern(/^SRS\d+$/));
const uuidSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i));
// oxlint-disable-next-line effecttsgo/schema-sync -- The pure path port must derive a path synchronously.
const decodeResourceId = Schema.decodeSync(resourceIdSchema);
// oxlint-disable-next-line effecttsgo/schema-sync -- The pure path port must derive a path synchronously.
const decodeUuid = Schema.decodeSync(uuidSchema);

/** UUID files are immutable. The application switches the DB reference after save completes. */
export const makeResourceFileGateway = (root = applicationDataPath("resources")): ResourceFileGatewayService => {
    const directory = (resourceId: LmsResourceId): string => join(root, decodeResourceId(resourceId));
    const path = (resourceId: LmsResourceId, uuid: string): string => join(directory(resourceId), decodeUuid(uuid));
    return ResourceFileGateway.of({
        path,
        save: (resourceId, downloadedPath, originalFilename, previous) =>
            Effect.gen(function* () {
                const content = yield* digest(downloadedPath);
                if (previous?.sha256 === content.sha256 && previous.size === content.size) {
                    const existing = yield* Effect.result(digest(path(resourceId, previous.uuid)));
                    if (
                        Result.isSuccess(existing) && existing.success.sha256 === content.sha256 &&
                        existing.success.size === content.size
                    ) {
                        return { ...previous, originalFilename };
                    }
                }
                yield* fileTry(
                    "create resource directory",
                    () => Deno.mkdir(directory(resourceId), { recursive: true }),
                );
                const uuid = yield* Crypto.Crypto.use((service) => service.randomUUIDv4).pipe(
                    Effect.provide(DenoCrypto.layer),
                    Effect.mapError((cause) =>
                        new ResourceFileGatewayError({ operation: "create file UUID", message: cause.message })
                    ),
                );
                const destination = path(resourceId, uuid);
                yield* Effect.scoped(Effect.gen(function* () {
                    yield* fileTry("copy resource", () => Deno.copyFile(downloadedPath, destination));
                    const file = yield* Effect.acquireRelease(
                        fileTry("open saved resource", () => Deno.open(destination, { write: true })),
                        (handle) => Effect.sync(() => handle.close()),
                    );
                    yield* fileTry("flush saved resource", () => file.sync());
                })).pipe(Effect.catch((error) =>
                    Effect.gen(function* () {
                        yield* fileTry("discard partial resource", () => Deno.remove(destination)).pipe(
                            Effect.ignore,
                        );
                        return yield* error;
                    })
                ));
                return { uuid, originalFilename, ...content } satisfies SavedResourceFile;
            }),
        remove: (resourceId, uuid) =>
            fileTry("remove superseded resource", () =>
                Deno.remove(path(resourceId, uuid)).catch((cause) => {
                    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
                })),
        discardDownload: (downloadedPath) =>
            Effect.gen(function* () {
                yield* fileTry("discard temporary download", () => Deno.remove(downloadedPath));
                // The source adapter creates a private directory per download. Remove only empty directories.
                if (basename(dirname(downloadedPath)).startsWith("ku-potato-")) {
                    yield* fileTry("discard empty temporary directory", () => Deno.remove(dirname(downloadedPath)))
                        .pipe(Effect.ignore);
                }
            }),
        withResourceLock: (resourceId, use) =>
            Effect.scoped(Effect.gen(function* () {
                yield* fileTry("create resource lock directory", () =>
                    Deno.mkdir(directory(resourceId), { recursive: true }));
                const lock = yield* Effect.acquireRelease(
                    fileTry("open resource lock", () =>
                        Deno.open(join(directory(resourceId), ".lock"), {
                            read: true,
                            write: true,
                            create: true,
                        })),
                    (file) =>
                        Effect.sync(() => file.close()),
                );
                yield* fileTry("lock resource", () => lock.lock(true));
                return yield* use;
            })),
    });
};

export const makeResourceFileGatewayLayer = (root = applicationDataPath("resources")) =>
    Layer.succeed(ResourceFileGateway, makeResourceFileGateway(root));
