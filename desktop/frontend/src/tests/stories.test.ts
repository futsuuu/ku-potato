import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

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
