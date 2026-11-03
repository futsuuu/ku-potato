import { spawnSync } from "node:child_process";

const check = process.argv.includes("--check");
const result = spawnSync(
  "gofmt",
  [check ? "-l" : "-w", "app-server", "browser-worker", "internal", "desktop", "tools"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.exitCode = result.status === 0 && check && result.stdout ? 1 : (result.status ?? 1);
