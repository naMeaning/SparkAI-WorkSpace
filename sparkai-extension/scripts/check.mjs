import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmScript = String(process.env.npm_execpath || "").trim();
const command = pnpmScript ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const prefix = pnpmScript ? [pnpmScript] : [];

const packageScriptCheck = spawnSync(process.execPath, ["--check", resolve(root, "scripts/package-extension.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: false
});
if (packageScriptCheck.error) throw packageScriptCheck.error;
if (packageScriptCheck.status !== 0) process.exit(packageScriptCheck.status ?? 1);

for (const args of [
  ["run", "verify:workspace"],
  ["--filter", "@sparkai/extension", "check"]
]) {
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
