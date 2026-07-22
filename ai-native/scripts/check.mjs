import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const pnpm = "pnpm";

const checks = [
  ["node", ["--test", "scripts/dev-main.test.mjs", "scripts/gateway-server.test.mjs"]],
  [pnpm, ["run", "verify:workspace"]],
  [pnpm, ["--filter", "@ai-native/crm-contracts", "check"]],
  [pnpm, ["--filter", "@ai-native/crm-api", "check"]],
  [pnpm, ["--filter", "@ai-native/ai-gateway", "smoke"]]
];

for (const [command, args] of checks) {
  const runCommand = isWindows ? process.env.ComSpec || "cmd.exe" : command;
  const runArgs = isWindows
    ? ["/d", "/s", "/c", [command, ...args].join(" ")]
    : args;
  const result = spawnSync(runCommand, runArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
