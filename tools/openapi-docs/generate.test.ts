import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { OpenAPIV3_1 } from "@scalar/openapi-types";
import { test, type TestContext } from "vite-plus/test";
import { generateDocs, main } from "./generate.ts";

function description(): OpenAPIV3_1.Document {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0", description: "API introduction" },
    security: [{ token: [] }],
    paths: {
      "/items/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: {
          operationId: "getItem",
          summary: "Get an item",
          responses: {
            200: {
              description: "Item",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
            },
          },
        },
        put: {
          operationId: "updateItem",
          summary: "Update an item",
          responses: { 204: { description: "Updated" } },
        },
      },
      "/status": {
        get: {
          operationId: "status",
          summary: "Read status",
          security: [],
          responses: { 204: { description: "Ready" } },
        },
      },
    },
    components: {
      securitySchemes: { token: { type: "apiKey", in: "header", name: "X-Token" } },
      schemas: {
        Item: {
          type: "object",
          properties: { owner: { $ref: "#/components/schemas/Owner" } },
        },
        Owner: { type: "object", properties: { name: { type: "string" } } },
        Unused: { type: "object", properties: { hidden: { type: "boolean" } } },
      },
    },
  };
}

async function directory(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openapi-docs-test-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return join(root, "docs");
}

async function pages(destination: string): Promise<Record<string, string>> {
  const files = await readdir(destination, { recursive: true, withFileTypes: true });
  const entries = await Promise.all(
    files
      .filter((file) => file.isFile())
      .map(async (file) => {
        const path = join(file.parentPath, file.name);
        return [
          relative(destination, path).replaceAll("\\", "/"),
          await readFile(path, "utf8"),
        ] as const;
      }),
  );
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

async function assertLocalLinks(
  destination: string,
  generated: Record<string, string>,
): Promise<void> {
  for (const [file, markdown] of Object.entries(generated)) {
    for (const [, href] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(href)) continue;
      const [path] = href.split("#");
      await assert.doesNotReject(
        readFile(join(destination, dirname(file), decodeURIComponent(path))),
        `${file} has a broken link: ${href}`,
      );
    }
  }
}

test("CLI generates independent references from input and output paths relative to the caller", async (t) => {
  const root = dirname(await directory(t));
  for (const name of ["first", "second"]) {
    const document = description();
    document.info = { title: `${name} API`, version: "1.0.0" };
    document.paths!["/status"]!.get!.operationId = `${name}Status`;
    await writeFile(join(root, `${name}.json`), JSON.stringify(document));
    await main([`${name}.json`, `${name} reference/`], root);
    const destination = join(root, `${name} reference`);
    const generated = await pages(destination);
    assert.match(generated["README.md"], new RegExp(`# ${name} API`));
    assert.match(generated[`${name}Status.md`], /# Read status/);
    await assertLocalLinks(destination, generated);
  }
  assert.match(await readFile(join(root, "first reference/README.md"), "utf8"), /# first API/);
});

test("CLI requires both paths and prevents replacing the input document or its directory", async (t) => {
  const root = dirname(await directory(t));
  const source = JSON.stringify(description());
  await writeFile(join(root, "openapi.json"), source);
  for (const args of [[], ["openapi.json"], ["openapi.json", "docs", "extra"]]) {
    await assert.rejects(main(args, root), /usage:/);
  }
  for (const output of ["openapi.json", "."]) {
    await assert.rejects(
      main(["openapi.json", output], root),
      /Output directory must not contain the input document/,
    );
    assert.equal(await readFile(join(root, "openapi.json"), "utf8"), source);
  }
  assert.deepEqual(await readdir(root), ["openapi.json"]);
});

test("writes one page per method and path with linked schemas and an index", async (t) => {
  const destination = await directory(t);
  const document = description();
  const original = structuredClone(document);
  await generateDocs(document, destination);
  assert.deepEqual(document, original);
  const generated = await pages(destination);
  assert.deepEqual(Object.keys(generated), [
    "getItem.md",
    "README.md",
    "schemas/Item.md",
    "schemas/Owner.md",
    "schemas/Unused.md",
    "status.md",
    "updateItem.md",
  ]);
  assert.match(generated["README.md"], /API introduction/);
  assert.match(generated["README.md"], /\[GET \/items\/\{id\}\]\(getItem\.md\)/);
  assert.match(generated["README.md"], /\[PUT \/items\/\{id\}\]\(updateItem\.md\)/);
  assert.match(generated["getItem.md"], /# Get an item/);
  assert.match(generated["getItem.md"], /\*\*Method:\*\*\s+`GET`/);
  assert.match(generated["getItem.md"], /`id`/);
  assert.match(generated["getItem.md"], /X-Token/);
  assert.match(generated["getItem.md"], /\(schemas\/Owner\.md\)/);
  assert.doesNotMatch(generated["getItem.md"], /Update an item|Read status|Unused|## Schemas/);
  assert.match(generated["updateItem.md"], /\*\*Method:\*\*\s+`PUT`/);
  assert.doesNotMatch(generated["updateItem.md"], /Get an item|Read status/);
  assert.doesNotMatch(generated["status.md"], /X-Token/);
  assert.match(generated["schemas/Item.md"], /\(Owner\.md\)/);
  assert.match(generated["schemas/Item.md"], /\[API index\]\(\.\.\/README\.md\)/);
  await assertLocalLinks(destination, generated);
});

test("regeneration is deterministic and removes stale operation and schema pages", async (t) => {
  const destination = await directory(t);
  const document = description();
  await generateDocs(document, destination);
  const original = await pages(destination);
  await generateDocs(document, destination);
  assert.deepEqual(await pages(destination), original);
  await writeFile(join(destination, "index.md"), "old introduction");
  await writeFile(join(destination, "stale.md"), "stale output");
  document.paths!["/items/{id}"]!.put!.operationId = "replaceItem";
  delete document.paths!["/status"];
  delete document.components!.schemas!.Unused;
  await generateDocs(document, destination);
  const generated = await pages(destination);
  assert.deepEqual(Object.keys(generated), [
    "getItem.md",
    "README.md",
    "replaceItem.md",
    "schemas/Item.md",
    "schemas/Owner.md",
  ]);
  assert.doesNotMatch(generated["README.md"], /status\.md|updateItem\.md|Unused\.md/);
  await assertLocalLinks(destination, generated);
  assert.deepEqual(await readdir(dirname(destination)), ["docs"]);
});

test("rejects missing, unsafe, and colliding names without changing existing output", async (t) => {
  const destination = await directory(t);
  await generateDocs(description(), destination);
  const original = await pages(destination);
  for (const id of [undefined, "../escape", "README", "readme", "ReadMe", "GETITEM", "getItem"]) {
    const document = description();
    document.paths!["/items/{id}"]!.put!.operationId = id;
    await assert.rejects(generateDocs(document, destination), /page name/);
    assert.deepEqual(await pages(destination), original);
  }
  const document = description();
  document.components!.schemas!.item = { type: "string" };
  await assert.rejects(generateDocs(document, destination), /Schema page names/);
  assert.deepEqual(await pages(destination), original);
});

test("keeps existing output and removes temporary files when writing fails", async (t) => {
  const destination = await directory(t);
  await generateDocs(description(), destination);
  const original = await pages(destination);
  const document = description();
  document.components!.schemas!["A".repeat(300)] = { type: "string" };
  await assert.rejects(generateDocs(document, destination));
  assert.deepEqual(await pages(destination), original);
  assert.deepEqual(await readdir(dirname(destination)), ["docs"]);
});
