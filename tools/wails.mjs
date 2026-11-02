import { spawnSync } from "node:child_process";

const result = spawnSync("go", ["tool", "wails3", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, WAILS_EXP_USE_WAKE: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
