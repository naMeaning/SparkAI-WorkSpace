import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(root, "release");
const servicePackage = JSON.parse(readFileSync(join(root, "services/sparkai-extension/package.json"), "utf8"));
const version = String(servicePackage.version || "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("SparkAI extension package version is invalid.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${String(result.stderr || result.stdout || "").trim()}`);
  return String(result.stdout || "").trim();
}

const allowDirty = process.argv.includes("--allow-dirty");
const worktree = run("git", ["status", "--porcelain", "--untracked-files=normal"]);
if (worktree && !allowDirty) throw new Error("Refusing to package a dirty worktree. Commit the deployment source first or use --allow-dirty for a local diagnostic build.");
const sourceRevision = run("git", ["rev-parse", "HEAD"]);

const bundleName = `sparkai-extension-deploy-${version}`;
const bundleDir = join(releaseRoot, bundleName);
const zipPath = join(releaseRoot, `${bundleName}.zip`);
const tarPath = join(releaseRoot, `${bundleName}.tar.gz`);
for (const target of [bundleDir, zipPath, tarPath]) {
  const resolved = resolve(target);
  if (!resolved.startsWith(`${resolve(releaseRoot)}${sep}`)) throw new Error(`Unsafe package target: ${resolved}`);
}

mkdirSync(releaseRoot, { recursive: true });
rmSync(bundleDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
rmSync(tarPath, { force: true });
mkdirSync(bundleDir, { recursive: true });

function copy(sourceRelative, targetRelative = sourceRelative) {
  const source = join(root, sourceRelative);
  const target = join(bundleDir, targetRelative);
  if (!existsSync(source)) throw new Error(`Missing package input: ${sourceRelative}`);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

copy("deploy/sparkai-extension/AGENTS.md", "AGENTS.md");
copy("deploy/sparkai-extension/README.md", "README.md");
copy("deploy/sparkai-extension/.env.example", ".env.example");
copy("deploy/sparkai-extension/Caddyfile.example", "Caddyfile.example");
copy("deploy/sparkai-extension/Caddyfile.host.example", "Caddyfile.host.example");
copy("deploy/sparkai-extension/.dockerignore.bundle", ".dockerignore");
copy("deploy/sparkai-extension/Dockerfile");
copy("services/sparkai-extension/package.json");
copy("services/sparkai-extension/README.md");
copy("services/sparkai-extension/src");
copy("services/sparkai-extension/scripts");
copy("services/sparkai-extension/test");

const composeSource = readFileSync(join(root, "deploy/sparkai-extension/compose.yaml"), "utf8");
const standaloneCompose = composeSource.replace("context: ../..", "context: .");
if (standaloneCompose === composeSource) throw new Error("Standalone Compose context rewrite did not apply.");
writeFileSync(join(bundleDir, "compose.yaml"), standaloneCompose, "utf8");

writeFileSync(join(bundleDir, "VERSION"), `${version}\n`, "utf8");
writeFileSync(join(bundleDir, "package.json"), `${JSON.stringify({
  name: "sparkai-extension-deploy-bundle",
  version,
  private: true,
  engines: { node: ">=24.0.0" },
  scripts: {
    check: "node services/sparkai-extension/scripts/check-sources.mjs && node --test services/sparkai-extension/test/*.test.mjs",
    "license:create": "node services/sparkai-extension/src/license-admin.mjs create",
    "license:list": "node services/sparkai-extension/src/license-admin.mjs list",
    "license:disable": "node services/sparkai-extension/src/license-admin.mjs disable"
  }
}, null, 2)}\n`, "utf8");

function filesUnder(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function normalizedPath(file) {
  return relative(bundleDir, file).split(sep).join("/");
}

function assertBundleBoundary(files) {
  const forbiddenPath = /(^|\/)(?:ai-gateway|crm-api|crm-contracts|production|node_modules|\.diagnostics|data)(?:\/|$)/i;
  const forbiddenSecret = /NAI-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,}\b/;
  for (const file of files) {
    const path = normalizedPath(file);
    if (forbiddenPath.test(path) || /(?:^|\/)\.env$|\.(?:db|sqlite|log)$/i.test(path)) throw new Error(`Forbidden bundle path: ${path}`);
    if (forbiddenSecret.test(readFileSync(file, "utf8"))) throw new Error(`Possible secret found in bundle input: ${path}`);
  }
}

let files = filesUnder(bundleDir);
assertBundleBoundary(files);
const manifest = {
  name: "sparkai-extension-deploy",
  version,
  source_revision: sourceRevision,
  created_at: new Date().toISOString(),
  docker_network_required: true,
  files: files.sort().map((file) => ({ path: normalizedPath(file), size: statSync(file).size, sha256: sha256(file) }))
};
writeFileSync(join(bundleDir, "BUNDLE-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

files = filesUnder(bundleDir).filter((file) => normalizedPath(file) !== "SHA256SUMS.txt");
assertBundleBoundary(files);
writeFileSync(
  join(bundleDir, "SHA256SUMS.txt"),
  `${files.sort().map((file) => `${sha256(file)}  ${normalizedPath(file)}`).join("\n")}\n`,
  "utf8"
);

run("tar", ["-czf", tarPath, "-C", releaseRoot, bundleName]);
run("tar", ["-a", "-cf", zipPath, "-C", releaseRoot, bundleName]);

const artifacts = [zipPath, tarPath].map((file) => ({
  path: file,
  size: statSync(file).size,
  sha256: sha256(file)
}));
writeFileSync(
  join(releaseRoot, "SHA256SUMS.txt"),
  `${artifacts.map((artifact) => `${artifact.sha256}  ${relative(releaseRoot, artifact.path)}`).join("\n")}\n`,
  "utf8"
);

console.log(JSON.stringify({ ok: true, bundleDir, sourceRevision, fileCount: files.length + 1, artifacts }, null, 2));
