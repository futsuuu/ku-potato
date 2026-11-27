import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it("keeps a page story beside every route", async () => {
  const directory = fileURLToPath(new URL("../routes/", import.meta.url));
  const files = await readdir(directory, { recursive: true });
  const routes = files.filter((file) => /^route\.tsx?$/.test(basename(file))).map(dirname);
  const pageStories = files
    .filter((file) => /^route\.stories\.tsx?$/.test(basename(file)))
    .map(dirname);
  expect(routes.length).toBeGreaterThan(0);
  expect(pageStories.toSorted()).toEqual(routes.toSorted());
});

it("keeps Storybook test imports out of stories", async () => {
  const directory = fileURLToPath(new URL("../", import.meta.url));
  const files = (await readdir(directory, { recursive: true })).filter((file) =>
    /\.stories\.tsx?$/.test(file),
  );
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(await readFile(join(directory, file), "utf8"), file).not.toMatch(
      /["']storybook\/test["']/,
    );
  }
});
