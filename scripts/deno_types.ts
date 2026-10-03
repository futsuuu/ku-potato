export {};

// `deno types` omits desktop APIs. Fetch the declarations for the installed version.
const desktopTypesUrl =
    `https://raw.githubusercontent.com/denoland/deno/v${Deno.version.deno}/cli/tsc/dts/lib.deno.desktop.d.ts`;
// oxlint-disable-next-line effecttsgo/global-fetch -- Standalone setup script for the linter.
const response = await fetch(desktopTypesUrl);
if (!response.ok) {
    throw new Error(`Failed to download Deno desktop types: ${response.status} ${response.statusText}`);
}
const desktopTypes = await response.text();

const { success, code, stdout } = await new Deno.Command(Deno.execPath(), {
    args: ["types"],
    stdout: "piped",
    stderr: "inherit",
}).output();
if (!success) Deno.exit(code);

await Deno.mkdir("types", { recursive: true });
await Deno.writeFile("types/deno.d.ts", stdout);
await Deno.writeTextFile("types/deno.desktop.d.ts", desktopTypes);
