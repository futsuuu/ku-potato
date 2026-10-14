import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const frontend = new URL("../../desktop/frontend/", import.meta.url);

if (process.argv.length !== 3) {
  throw new Error("usage: node generate.mjs <openapi.json>");
}

const schema = JSON.parse(await readFile(process.argv[2], "utf8"));
const source = astToString(await openapiTS(schema));
const formatted = execFileSync("vp", ["fmt", "--stdin-filepath=src/api.generated.ts"], {
  cwd: frontend,
  input: source,
  encoding: "utf8",
});
await writeFile(new URL("src/api.generated.ts", frontend), formatted);
