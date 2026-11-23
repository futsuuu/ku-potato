import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { createOpenApiMarkdownRenderer } from "@scalar/openapi-to-markdown";
import type { OpenAPIV3_1 } from "@scalar/openapi-types";

export async function generateDocs(
  document: OpenAPIV3_1.Document,
  destination: string,
): Promise<void> {
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
  const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item?.[method];
      if (!operation) return [];
      const id = operation.operationId;
      if (typeof id !== "string") {
        throw new Error(`Invalid documentation page name: ${id}`);
      }
      return [{ path, method, id }];
    }),
  );
  const schemas = Object.keys(document.components?.schemas ?? {});
  for (const name of [...operations.map(({ id }) => id), ...schemas]) {
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`Invalid documentation page name: ${name}`);
    }
  }
  const operationNames = ["readme", ...operations.map(({ id }) => id.toLowerCase())];
  if (new Set(operationNames).size !== operationNames.length) {
    throw new Error("Documentation page names must be unique");
  }
  if (new Set(schemas.map((name) => name.toLowerCase())).size !== schemas.length) {
    throw new Error("Schema page names must be unique");
  }

  const renderer = await createOpenApiMarkdownRenderer(document);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), ".openapi-docs-"));
  try {
    await mkdir(join(temporary, "schemas"));
    const introduction = await renderer.render({ introduction: true });
    const operationLinks = operations.map(
      ({ path, method, id }) => `- [${method.toUpperCase()} ${path}](${id}.md)`,
    );
    const schemaLinks = schemas.map((name) => `- [${name}](schemas/${name}.md)`);
    await writeFile(
      join(temporary, "README.md"),
      `${introduction.trimEnd()}\n\n## Operations\n\n${operationLinks.join("\n")}\n\n## Schemas\n\n${schemaLinks.join("\n")}\n`,
    );
    const pages = [
      ...operations.map(({ id }) => ({
        file: `${id}.md`,
        selection: { operation: { operationId: id } },
      })),
      ...schemas.map((name) => ({ file: `schemas/${name}.md`, selection: { model: name } })),
    ];
    for (const { file, selection } of pages) {
      const markdown = await renderer.render({
        ...selection,
        schemaReferences: {
          mode: "linked",
          resolveUrl: ({ name }) =>
            schemas.includes(name)
              ? posix.relative(posix.dirname(file), `schemas/${name}.md`)
              : undefined,
        },
      });
      const index = posix.relative(posix.dirname(file), "README.md");
      await writeFile(join(temporary, file), `${markdown.trimEnd()}\n\n[API index](${index})\n`);
    }
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function main(args: string[], cwd: string): Promise<void> {
  if (args.length !== 2) {
    throw new Error("usage: node generate.ts <openapi.json> <output-directory>");
  }
  const input = resolve(cwd, args[0]);
  const output = resolve(cwd, args[1]);
  const inputLocation = relative(output, input);
  if (
    inputLocation !== ".." &&
    !inputLocation.startsWith(`..${sep}`) &&
    !isAbsolute(inputLocation)
  ) {
    throw new Error("Output directory must not contain the input document");
  }
  const document = JSON.parse(await readFile(input, "utf8"));
  await generateDocs(document, output);
}

if (import.meta.main) {
  await main(process.argv.slice(2), process.cwd());
}
