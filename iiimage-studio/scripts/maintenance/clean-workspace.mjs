import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const quiet = args.includes("--quiet");
const scopeArg = args.find((value) => value.startsWith("--scope="));
const requestedScopes = new Set(
  String(scopeArg?.split("=").slice(1).join("=") || "diagnostics,release,logs,legacy-launcher")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const allowedScopes = new Set(["diagnostics", "release", "logs", "legacy-launcher"]);
const keepElectronArg = args.find((value) => value.startsWith("--keep-electron="));
const keepReleaseArg = args.find((value) => value.startsWith("--keep-release="));
const keepElectron = boundedInteger(keepElectronArg, 12, 2, 100);
const keepRelease = boundedInteger(keepReleaseArg, 4, 1, 30);

for (const scope of requestedScopes) {
  if (!allowedScopes.has(scope)) {
    throw new Error(`Unknown cleanup scope: ${scope}. Allowed: ${[...allowedScopes].join(", ")}`);
  }
}

function boundedInteger(argument, fallback, minimum, maximum) {
  const parsed = Number(argument?.split("=").slice(1).join("="));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function assertSafeTarget(target) {
  const absolute = resolve(target);
  const rel = relative(repoRoot, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to remove path outside the repository: ${absolute}`);
  }
  return absolute;
}

function sizeOf(target) {
  if (!existsSync(target)) return 0;
  const metadata = statSync(target);
  if (metadata.isFile()) return metadata.size;
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(join(target, entry.name));
  }
  return total;
}

function markdownFiles() {
  const files = [];
  const visit = (target) => {
    if (!existsSync(target)) return;
    const metadata = statSync(target);
    if (metadata.isFile()) {
      if (target.toLowerCase().endsWith(".md")) files.push(target);
      return;
    }
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      visit(join(target, entry.name));
    }
  };
  for (const rootEntry of ["README.md", "AGENTS.md", "PRODUCT_INTENT.md", "SOURCE_INFO.md", "docs"]) {
    visit(join(repoRoot, rootEntry));
  }
  return files;
}

function documentedRuns(kind) {
  const names = new Set();
  const expression = new RegExp(`\\.diagnostics[\\\\/]${kind}[\\\\/]([A-Za-z0-9._-]+)`, "g");
  for (const file of markdownFiles()) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(expression)) names.add(match[1]);
  }
  return names;
}

function addRunDirectoryCandidates(kind, keepCount, candidates, preserved) {
  const root = join(repoRoot, ".diagnostics", kind);
  if (!existsSync(root)) return;
  const documented = documentedRuns(kind);
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const target = join(root, entry.name);
      return { name: entry.name, target, mtimeMs: statSync(target).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const recent = new Set(directories.slice(0, keepCount).map((entry) => entry.name));

  for (const entry of directories) {
    if (documented.has(entry.name) || recent.has(entry.name)) {
      preserved.push({ target: entry.target, reason: documented.has(entry.name) ? "documented evidence" : "recent run" });
    } else {
      candidates.push({ target: entry.target, reason: `stale ${kind} run` });
    }
  }

  if (kind === "electron") {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) candidates.push({ target: join(root, entry.name), reason: "reproducible loose AIDebug output" });
    }
  }
}

function addLegacyReleaseCandidates(candidates, preserved) {
  const releaseRoot = join(repoRoot, "release");
  if (!existsSync(releaseRoot)) return;
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const currentVersion = String(packageJson.version || "");
  for (const entry of readdirSync(releaseRoot, { withFileTypes: true })) {
    const target = join(releaseRoot, entry.name);
    const versions = [...entry.name.matchAll(/(?:^|[-_])(\d+\.\d+\.\d+)(?=[-_.]|$)/g)].map((match) => match[1]);
    const staleChecksumManifest = entry.name === "SHA256SUMS.txt" && !readFileSync(target, "utf8").includes(currentVersion);
    if (entry.name.startsWith("baseline-") || staleChecksumManifest || (versions.length > 0 && !versions.includes(currentVersion))) {
      candidates.push({ target, reason: `release artifact older than ${currentVersion}` });
    } else {
      preserved.push({ target, reason: versions.includes(currentVersion) ? "current release" : "release support output" });
    }
  }
}

function addLogCandidates(candidates) {
  const devLogs = join(repoRoot, ".dev-logs");
  if (existsSync(devLogs)) candidates.push({ target: devLogs, reason: "reproducible development logs" });
  const diagnosticsRoot = join(repoRoot, ".diagnostics");
  if (existsSync(diagnosticsRoot)) {
    for (const entry of readdirSync(diagnosticsRoot, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith(".log") || entry.name === "aidebug-history.md")) {
        candidates.push({ target: join(diagnosticsRoot, entry.name), reason: "reproducible diagnostic log" });
      }
    }
  }
}

const candidates = [];
const preserved = [];
if (requestedScopes.has("diagnostics")) {
  addRunDirectoryCandidates("electron", keepElectron, candidates, preserved);
  addRunDirectoryCandidates("release", keepRelease, candidates, preserved);
}
if (requestedScopes.has("release")) addLegacyReleaseCandidates(candidates, preserved);
if (requestedScopes.has("logs")) addLogCandidates(candidates);
if (requestedScopes.has("legacy-launcher")) {
  const legacyLauncher = join(repoRoot, "scripts", "launcher");
  if (existsSync(legacyLauncher)) candidates.push({ target: legacyLauncher, reason: "superseded by tools/dev-launcher" });
}

const uniqueCandidates = [...new Map(candidates.map((entry) => [resolve(entry.target).toLowerCase(), entry])).values()];
const measured = uniqueCandidates.map((entry) => ({ ...entry, bytes: sizeOf(entry.target) }));
const totalBytes = measured.reduce((sum, entry) => sum + entry.bytes, 0);

for (const entry of measured) {
  const target = assertSafeTarget(entry.target);
  if (!quiet) process.stdout.write(`${apply ? "REMOVE" : "WOULD REMOVE"} ${relative(repoRoot, target)} (${formatBytes(entry.bytes)}) - ${entry.reason}\n`);
  if (apply) rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}

process.stdout.write(
  `${JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", scopes: [...requestedScopes], candidateCount: measured.length, preservedCount: preserved.length, reclaimableBytes: totalBytes, reclaimable: formatBytes(totalBytes) }, null, 2)}\n`
);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
