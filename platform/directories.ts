/** User-local directories shared by the filesystem adapters. */
import { homedir } from "node:os";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- OS-specific paths resolved synchronously for adapter defaults.
import { join, posix, win32 } from "node:path";

interface DirectoryOptions {
    os?: typeof Deno.build.os;
    env?: (name: string) => string | undefined;
    home?: () => string;
}

/** Resolve OS conventions without ever using the working directory. */
export function applicationDirectories(
    { os = Deno.build.os, env = (name) => Deno.env.get(name), home = homedir }: DirectoryOptions = {},
): { data: string; cache: string } {
    const path = os === "windows" ? win32 : posix;
    // A rooted Windows path (\folder) still depends on the current drive.
    const isAbsolute = (directory: string): boolean =>
        path.isAbsolute(directory) && (os !== "windows" || win32.parse(directory).root.length > 1);
    const homeDirectory = (): string => {
        const directory = home();
        if (!isAbsolute(directory)) {
            throw new Error("Could not determine an absolute user home directory.");
        }
        return directory;
    };

    switch (os) {
        case "windows": {
            const localAppData = env("LOCALAPPDATA");
            const base = localAppData && isAbsolute(localAppData)
                ? localAppData
                : win32.join(homeDirectory(), "AppData", "Local");
            const directory = win32.join(base, "KU-POTATO");
            return { data: directory, cache: directory };
        }
        case "darwin": {
            const library = posix.join(homeDirectory(), "Library");
            return {
                data: posix.join(library, "Application Support", "KU-POTATO"),
                cache: posix.join(library, "Caches", "KU-POTATO"),
            };
        }
        case "linux": {
            const xdgDirectory = (name: string, ...fallback: string[]): string => {
                const directory = env(name);
                // XDG requires absolute paths; empty and relative values are ignored.
                return directory && posix.isAbsolute(directory) ? directory : posix.join(homeDirectory(), ...fallback);
            };
            return {
                data: posix.join(xdgDirectory("XDG_DATA_HOME", ".local", "share"), "ku-potato"),
                cache: posix.join(xdgDirectory("XDG_CACHE_HOME", ".cache"), "ku-potato"),
            };
        }
        default:
            throw new Error(`Unsupported operating system: ${os}`);
    }
}

/** Locate a persistent data file using the host OS's path separators. */
export const applicationDataPath = (...segments: string[]): string => join(applicationDirectories().data, ...segments);

/** Locate a disposable cache file using the host OS's path separators. */
export const applicationCachePath = (...segments: string[]): string =>
    join(applicationDirectories().cache, ...segments);
