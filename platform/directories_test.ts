import { assertEquals, assertThrows } from "@std/assert";
import { applicationDirectories } from "./directories.ts";

const environment = (values: Record<string, string> = {}) => (name: string): string | undefined => values[name];
const noHome = (): string => {
    throw new Error("Home directory must not be required when environment paths are valid.");
};

Deno.test("Windows uses the local application directory and the display name", () => {
    assertEquals(
        applicationDirectories({
            os: "windows",
            env: environment({ LOCALAPPDATA: "D:\\Local App Data", XDG_DATA_HOME: "/ignored" }),
            home: noHome,
        }),
        { data: "D:\\Local App Data\\KU-POTATO", cache: "D:\\Local App Data\\KU-POTATO" },
    );
    assertEquals(
        applicationDirectories({
            os: "windows",
            env: environment({ LOCALAPPDATA: "\\\\server\\share\\Local" }),
            home: noHome,
        }),
        { data: "\\\\server\\share\\Local\\KU-POTATO", cache: "\\\\server\\share\\Local\\KU-POTATO" },
    );
});

Deno.test("Windows ignores missing and relative bases without resolving against cwd", () => {
    for (const value of [undefined, "", "relative", "C:relative", "\\relative", "/relative"]) {
        assertEquals(
            applicationDirectories({
                os: "windows",
                env: environment(value === undefined ? {} : { LOCALAPPDATA: value }),
                home: () => "C:\\Users\\Alice",
            }),
            {
                data: "C:\\Users\\Alice\\AppData\\Local\\KU-POTATO",
                cache: "C:\\Users\\Alice\\AppData\\Local\\KU-POTATO",
            },
        );
    }
});

Deno.test("macOS separates application support and caches using the display name", () => {
    assertEquals(
        applicationDirectories({
            os: "darwin",
            env: environment({ LOCALAPPDATA: "C:\\ignored", XDG_DATA_HOME: "/ignored", XDG_CACHE_HOME: "/ignored" }),
            home: () => "/Users/Alice",
        }),
        { data: "/Users/Alice/Library/Application Support/KU-POTATO", cache: "/Users/Alice/Library/Caches/KU-POTATO" },
    );
});

Deno.test("Linux honors independent absolute XDG directories and uses the lowercase name", () => {
    assertEquals(
        applicationDirectories({
            os: "linux",
            env: environment({ XDG_DATA_HOME: "/mnt/data", XDG_CACHE_HOME: "/mnt/cache", LOCALAPPDATA: "C:\\ignored" }),
            home: noHome,
        }),
        { data: "/mnt/data/ku-potato", cache: "/mnt/cache/ku-potato" },
    );
    assertEquals(
        applicationDirectories({
            os: "linux",
            env: environment({ XDG_DATA_HOME: "/mnt/data" }),
            home: () => "/home/alice",
        }),
        { data: "/mnt/data/ku-potato", cache: "/home/alice/.cache/ku-potato" },
    );
    assertEquals(
        applicationDirectories({
            os: "linux",
            env: environment({ XDG_CACHE_HOME: "/mnt/cache" }),
            home: () => "/home/alice",
        }),
        { data: "/home/alice/.local/share/ku-potato", cache: "/mnt/cache/ku-potato" },
    );
});

Deno.test("Linux uses XDG defaults for unset, empty, and relative paths", () => {
    for (const value of [undefined, "", "relative", "~/relative", "C:\\relative"]) {
        assertEquals(
            applicationDirectories({
                os: "linux",
                env: environment(value === undefined ? {} : { XDG_DATA_HOME: value, XDG_CACHE_HOME: value }),
                home: () => "/home/alice",
            }),
            { data: "/home/alice/.local/share/ku-potato", cache: "/home/alice/.cache/ku-potato" },
        );
    }
});

Deno.test("Missing or relative home directories fail instead of falling back to cwd", () => {
    for (const os of ["windows", "darwin", "linux"] as const) {
        for (const home of ["", "relative"]) {
            assertThrows(
                () => applicationDirectories({ os, env: environment(), home: () => home }),
                Error,
                "Could not determine an absolute user home directory.",
            );
        }
    }
    assertThrows(
        () => applicationDirectories({ os: "windows", env: environment(), home: () => "\\Users\\Alice" }),
        Error,
        "Could not determine an absolute user home directory.",
    );
});

Deno.test("Unsupported operating systems fail explicitly", () => {
    assertThrows(
        () => applicationDirectories({ os: "freebsd", env: environment(), home: noHome }),
        Error,
        "Unsupported operating system: freebsd",
    );
});
