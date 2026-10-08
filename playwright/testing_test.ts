import { assertEquals, assertRejects } from "@std/assert";

Deno.test("live authentication tests require explicit opt-in before reading application secrets", async () => {
    const previous = Deno.env.get("KU_POTATO_LIVE_TESTS");
    const stat = Deno.stat;
    let reads = 0;
    try {
        Deno.env.delete("KU_POTATO_LIVE_TESTS");
        Deno.stat = (...args) => {
            reads++;
            return stat(...args);
        };
        const testing = await import(new URL("./testing.ts?guard=disabled", import.meta.url).href);
        assertEquals(testing.hasAuthenticationState, false);
        assertEquals(testing.hasStoredCredentialSources, false);
        assertEquals(reads, 0);
        await assertRejects(
            () => testing.withAuthenticatedPage(() => Promise.resolve()),
            Error,
            "KU_POTATO_LIVE_TESTS=1",
        );
        assertEquals(reads, 0);
    } finally {
        Deno.stat = stat;
        if (previous === undefined) Deno.env.delete("KU_POTATO_LIVE_TESTS");
        else Deno.env.set("KU_POTATO_LIVE_TESTS", previous);
    }
});
