import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const frontend = fileURLToPath(new URL("../../desktop/frontend/", import.meta.url));

// Consume Huma's runtime schema without storing an OpenAPI document.
const schema = JSON.parse(
  execFileSync("go", ["run", "./tools/api-codegen/schema"], {
    cwd: repository,
    encoding: "utf8",
  }),
);
const source = astToString(await openapiTS(schema));
await writeFile(new URL("../../desktop/frontend/src/api.generated.ts", import.meta.url), source);
execFileSync("vp", ["fmt", "src/api.generated.ts"], { cwd: frontend, stdio: "inherit" });
