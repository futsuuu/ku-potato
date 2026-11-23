import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const result = spawnSync(
  "cargo",
  [
    "build",
    "--locked",
    ...process.argv.slice(2),
    "--bin",
    "ku-potato-server",
    "--message-format=json-render-diagnostics",
  ],
  { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const artifact = result.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .findLast(
    (message) =>
      message.reason === "compiler-artifact" &&
      message.target.name === "ku-potato-server" &&
      message.executable,
  );
if (!artifact) throw new Error("Cargo did not produce the server executable");
const directory = "desktop/build/bin";
mkdirSync(directory, { recursive: true });
copyFileSync(
  artifact.executable,
  join(directory, process.platform === "win32" ? "ku-potato-server.exe" : "ku-potato-server"),
);
