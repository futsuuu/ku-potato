import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { Effect, Result } from "effect";
import { describeSqliteCause, isSqliteBusy, sqliteTry } from "./errors.ts";

const driverError = (message: string, errcode?: number) =>
    Object.assign(new Error(message), { code: "ERR_SQLITE_ERROR", ...(errcode === undefined ? {} : { errcode }) });

Deno.test("SQLite retry classification traverses Drizzle causes without inspecting query text", () => {
    const wrapped = new DrizzleQueryError("begin immediate", [], driverError("database is locked"));
    assert(isSqliteBusy(wrapped));
    assert(isSqliteBusy(new Error("outer", { cause: wrapped })));
    assert(isSqliteBusy(driverError("arbitrary driver message", 5)));
    assert(isSqliteBusy(driverError("arbitrary driver message", 6 + 256)));
    assert(!isSqliteBusy(driverError("database is locked", 19)));
    assert(!isSqliteBusy(new Error("database is locked")));
    assert(
        !isSqliteBusy(new DrizzleQueryError("insert into busy_jobs", ["database is locked"], driverError("invalid"))),
    );
    assertStringIncludes(describeSqliteCause(wrapped), "caused by: database is locked [ERR_SQLITE_ERROR]");
    const cycle = new Error("cycle");
    cycle.cause = cycle;
    assert(!isSqliteBusy(cycle));
    assertEquals(describeSqliteCause(cycle), "cycle");
});

Deno.test("SQLite retry retains driver causes and does not retry unrelated errors", async () => {
    let attempts = 0;
    const value = await Effect.runPromise(sqliteTry(() => {
        if (++attempts < 3) throw new DrizzleQueryError("select 1", [], driverError("database is locked"));
        return 42;
    }));
    assertEquals(value, 42);
    assertEquals(attempts, 3);
    attempts = 0;
    const failure = driverError("SQL logic error");
    const result = await Effect.runPromise(Effect.result(sqliteTry(() => {
        attempts++;
        throw new DrizzleQueryError("insert into busy_jobs", ["locked"], failure);
    })));
    assert(Result.isFailure(result));
    assertEquals(attempts, 1);
    assertInstanceOf(result.failure.cause, DrizzleQueryError);
    assertEquals(result.failure.cause.cause, failure);
});
