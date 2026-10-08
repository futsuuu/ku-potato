/* oxlint-disable effecttsgo/global-console-in-effect, effecttsgo/prefer-schema-over-json -- The subprocess fixture writes a JSON line protocol to its parent test. */
import { DateTime, Effect } from "effect";
import { courseMaterialsJobAdapter } from "../course_material_job.ts";
import { makeJobQueue } from "../queue.ts";
import { LmsCourseId } from "../../domain/mod.ts";

const [mode, directory] = Deno.args;
// oxlint-disable-next-line effecttsgo/crypto-random-uuid -- A subprocess identity is generated before the Effect program starts.
const ownerId = crypto.randomUUID();
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
    if (mode === "producer") {
        const ids: number[] = [];
        for (let index = 0; index < 12; index++) {
            ids.push(
                (yield* queue.enqueue({
                    kind: "fetch-course-materials",
                    input: { lmsCourseId: LmsCourseId(`course-${index}`), head: "false" },
                })).id,
            );
        }
        console.log(JSON.stringify({ ids }));
        return;
    }
    if (mode === "crash") {
        const job = yield* queue.claim(ownerId, 200);
        console.log(JSON.stringify({ job }));
        Deno.exit(17);
    }
    let idle = 0;
    while (idle < 50) {
        const worked = yield* Effect.scoped(Effect.gen(function* () {
            const job = yield* queue.claim(ownerId, 2000);
            if (job === undefined) return false;
            console.log(
                JSON.stringify({ event: "start", at: DateTime.toEpochMillis(DateTime.nowUnsafe()), id: job.id }),
            );
            yield* Effect.sleep("100 millis");
            yield* queue.complete({
                job: job,
                output: {
                    courses: [{
                        lmsCourseId: job.input.lmsCourseId,
                        name: job.input.lmsCourseId,
                        availability: "available",
                    }],
                    courseMaterials: { lmsCourseId: job.input.lmsCourseId, folders: [] },
                },
            });
            console.log(JSON.stringify({ event: "end", at: DateTime.toEpochMillis(DateTime.nowUnsafe()), id: job.id }));
            return true;
        }));
        if (worked) idle = 0;
        else {
            idle++;
            yield* Effect.sleep("20 millis");
        }
    }
})));
