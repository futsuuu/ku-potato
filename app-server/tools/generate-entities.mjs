import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const check = process.argv[2] === "--check";
assert.deepEqual(
  process.argv.slice(2),
  check ? ["--check"] : [],
  "usage: node app-server/tools/generate-entities.mjs [--check]",
);
const temporary = mkdtempSync(join(tmpdir(), "ku-potato-entities-"));
try {
  const databasePath = join(temporary, "schema.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(readFileSync("app-server/src/archive/schema.sql", "utf8"));
  } finally {
    database.close();
  }
  const generated = join(temporary, "entity");
  execFileSync(
    "sea-orm-cli",
    [
      "generate",
      "entity",
      "--database-url",
      `sqlite://${encodeURIComponent(databasePath)}`,
      "--output-dir",
      generated,
      "--entity-format",
      "compact",
      "--with-prelude",
      "none",
    ],
    { stdio: "inherit" },
  );
  const names = readdirSync(generated).sort();
  const destination = "app-server/src/archive/entity";
  if (check) {
    assert.deepEqual(readdirSync(destination).sort(), names, "Generated entity files differ");
    for (const name of names) {
      assert.equal(
        readFileSync(join(destination, name), "utf8"),
        readFileSync(join(generated, name), "utf8"),
        `Regenerate ${name} with vp run app-server:db:generate`,
      );
    }
  } else {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    for (const name of names) copyFileSync(join(generated, name), join(destination, name));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
