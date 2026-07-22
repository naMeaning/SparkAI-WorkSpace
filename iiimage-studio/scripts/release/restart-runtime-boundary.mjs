import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");

function resolveAsar() {
  const electronBuilderRoot = dirname(require.resolve("electron-builder/package.json"));
  return require(require.resolve("@electron/asar", { paths: [electronBuilderRoot] }));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRelativePath(root, filePath) {
  return relative(root, filePath).split(sep).join("/");
}

function packagedFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function isRestartReplacedPath(relativePath) {
  if (relativePath === "resources/app.asar") return true;
  // The product executable embeds the marketing version and icon, so its hash
  // changes for every installer even when the Electron runtime is unchanged.
  // It is never replaced by the restart updater and is intentionally excluded
  // from the runtime fingerprint; all other shell files remain part of it.
  return relativePath.toLowerCase() === "iiimage studio.exe";
}

export function readPackagedUpdateMetadata(appRoot) {
  const archive = join(resolve(appRoot), "resources", "app.asar");
  if (!existsSync(archive)) throw new Error(`Packaged app.asar is missing: ${archive}`);
  const asar = resolveAsar();
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const version = String(metadata.version || "").trim();
  const compatibility = String(metadata.iiimageUpdateCompatibility || "").trim();
  if (!version || !compatibility) throw new Error(`Packaged update metadata is incomplete: ${archive}`);
  return { version, compatibility };
}

export function restartUnsafeRuntimeManifest(appRoot) {
  const root = resolve(appRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Packaged application root is missing: ${root}`);
  const entries = packagedFiles(root)
    .map((filePath) => ({ filePath, relativePath: normalizedRelativePath(root, filePath) }))
    .filter((entry) => !isRestartReplacedPath(entry.relativePath))
    .map((entry) => {
      const bytes = readFileSync(entry.filePath);
      return {
        path: entry.relativePath,
        size: bytes.length,
        sha256: sha256Bytes(bytes)
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const canonical = entries.map((entry) => `${entry.path}\t${entry.size}\t${entry.sha256}`).join("\n");
  return {
    root,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    fingerprint: sha256Bytes(Buffer.from(canonical, "utf8")),
    entries
  };
}

export function verifyRestartRuntimeBoundary({ baselineRoot, candidateRoot, expectedCompatibility = "" }) {
  const baselineMetadata = readPackagedUpdateMetadata(baselineRoot);
  const candidateMetadata = readPackagedUpdateMetadata(candidateRoot);
  if (expectedCompatibility && candidateMetadata.compatibility !== expectedCompatibility) {
    throw new Error(`Candidate compatibility ${candidateMetadata.compatibility} does not match package.json ${expectedCompatibility}.`);
  }
  const baseline = restartUnsafeRuntimeManifest(baselineRoot);
  const candidate = restartUnsafeRuntimeManifest(candidateRoot);
  const runtimeChanged = baseline.fingerprint !== candidate.fingerprint;
  const compatibilityChanged = baselineMetadata.compatibility !== candidateMetadata.compatibility;
  if (runtimeChanged && !compatibilityChanged) {
    const baselineByPath = new Map(baseline.entries.map((entry) => [entry.path, entry]));
    const candidateByPath = new Map(candidate.entries.map((entry) => [entry.path, entry]));
    const changedPaths = [...new Set([...baselineByPath.keys(), ...candidateByPath.keys()])]
      .filter((path) => baselineByPath.get(path)?.sha256 !== candidateByPath.get(path)?.sha256)
      .sort((left, right) => left.localeCompare(right, "en"));
    throw new Error(
      `Restart-unsafe runtime files changed without an iiimageUpdateCompatibility bump: ${changedPaths.slice(0, 12).join(", ") || "unknown"}`
    );
  }
  return {
    ok: true,
    baselineVersion: baselineMetadata.version,
    candidateVersion: candidateMetadata.version,
    baselineCompatibility: baselineMetadata.compatibility,
    candidateCompatibility: candidateMetadata.compatibility,
    runtimeChanged,
    compatibilityChanged,
    updateTypeFromBaseline: runtimeChanged ? "installer" : "restart",
    baselineFingerprint: baseline.fingerprint,
    candidateFingerprint: candidate.fingerprint,
    baselineFileCount: baseline.fileCount,
    candidateFileCount: candidate.fileCount
  };
}

function valueArg(name, fallback = "") {
  const entry = process.argv.find((value) => value.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  const baselineRoot = resolve(valueArg("--baseline", join(projectRoot, ".diagnostics", "restart-update-e2e", "baseline-build", "win-unpacked")));
  const candidateRoot = resolve(valueArg("--candidate", join(projectRoot, "release", "win-unpacked")));
  try {
    const report = verifyRestartRuntimeBoundary({
      baselineRoot,
      candidateRoot,
      expectedCompatibility: String(packageMetadata.iiimageUpdateCompatibility || "").trim()
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
