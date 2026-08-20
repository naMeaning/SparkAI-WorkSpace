import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
for (const directory of ["src", "test", "scripts"]) {
  for (const name of readdirSync(join(root, directory))) {
    if (name.endsWith(".mjs")) files.push(join(root, directory, name));
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`SparkAI extension source check passed (${files.length} files).`);
