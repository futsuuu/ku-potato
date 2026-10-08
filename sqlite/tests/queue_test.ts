import { assert, assertEquals } from "@std/assert";
import { Effect } from "effect";
import { courseMaterialsJobAdapter } from "../course_material_job.ts";
import { makeJobQueue } from "../queue.ts";

const process = async (mode: string, directory: string) => {
    const result = await new Deno.Command(Deno.execPath(), {
        args: [
            "run",
            "--allow-all",
            "--unsafe-proto",
            new URL("./queue_process.ts", import.meta.url).pathname,
            mode,
            directory,
        ],
        stdout: "piped",
        stderr: "piped",
    }).output();
    const output = new TextDecoder().decode(result.stdout);
    assertEquals(result.code, mode === "crash" ? 17 : 0, new TextDecoder().decode(result.stderr));
    return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
};

Deno.test("multiple processes deduplicate jobs, fence ownership, and recover a crashed claimant", async () => {
    const directory = await Deno.makeTempDir({ prefix: "ku-queue-process-" });
    try {
        const producers = await Promise.all(Array.from({ length: 3 }, () => process("producer", directory)));
        assertEquals(producers[0][0].ids, producers[1][0].ids);
        assertEquals(producers[1][0].ids, producers[2][0].ids);
        const crashed = await process("crash", directory);
        assert(crashed[0].job);
        const outputs = await Promise.all(Array.from({ length: 6 }, () => process("worker", directory)));
        const events = outputs.flat().sort((left, right) => left.at - right.at || (left.event === "end" ? -1 : 1));
        let running = 0, peak = 0;
        for (const event of events) {
            running += event.event === "start" ? 1 : -1;
            peak = Math.max(peak, running);
        }
        assertEquals(running, 0);
        assert(peak >= 1 && peak <= 6);
        assertEquals(new Set(events.filter((event) => event.event === "end").map((event) => event.id)).size, 12);
        assertEquals(events.filter((event) => event.event === "end").length, 12);
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const queue = yield* makeJobQueue([courseMaterialsJobAdapter], `${directory}/archive.sqlite3`);
            for (const id of producers[0][0].ids) {
                assertEquals((yield* queue.get(id, "fetch-course-materials"))?.status, "succeeded");
            }
            assertEquals((yield* queue.get(crashed[0].job.id, "fetch-course-materials"))?.attempts, 2);
        })));
    } finally {
        await Deno.remove(directory, { recursive: true });
    }
});
