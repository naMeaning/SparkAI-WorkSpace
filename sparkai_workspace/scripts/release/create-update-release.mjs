import { createHash, sign, verify } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const releaseNotes = JSON.parse(readFileSync(join(scriptDir, "release-notes.json"), "utf8"));
const { canonicalDesktopRelease, desktopReleaseProduct, desktopReleaseSchemaVersion } = require(join(projectRoot, "update-release.cjs"));
const { ACCESS_VARIANT_DUAL, windowsInstallerArtifactName } = require(join(projectRoot, "runtime", "access-variant.cjs"));
const version = String(packageMetadata.version || "").trim();
const compatibility = String(packageMetadata.naimageUpdateCompatibility || "").trim();
const minimumVersion = String(packageMetadata.naimageUpdateMinimumVersion || version).trim();
const releaseDir = join(projectRoot, "release");
const unpackedAsar = join(releaseDir, "win-unpacked", "resources", "app.asar");
const installerName = windowsInstallerArtifactName(version, ACCESS_VARIANT_DUAL);
const installerPath = join(releaseDir, installerName);
const restartName = `naimage-Restart-Update-${version}-x64.asar`;
const restartPath = join(releaseDir, restartName);
const privateKeyPath = process.env.NAIMAGE_RELEASE_PRIVATE_KEY
  ? resolve(process.env.NAIMAGE_RELEASE_PRIVATE_KEY)
  : join(projectRoot, "config", "release-signing-private.pem");
const publicKeyPath = join(projectRoot, "build", "update-public-key.pem");

for (const [label, file] of [["安装包", installerPath], ["应用资源", unpackedAsar], ["更新签名私钥", privateKeyPath], ["客户端更新公钥", publicKeyPath]]) {
  if (!existsSync(file)) throw new Error(`${label}不存在：${file}`);
}
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error(`无效版本号：${version}`);
if (!compatibility) throw new Error("package.json 缺少 naimageUpdateCompatibility。");
if (desktopReleaseProduct !== "naimage-studio") {
  throw new Error(`发布产品必须为 naimage-studio，当前为 ${desktopReleaseProduct || "unknown"}。`);
}

const privateKey = readFileSync(privateKeyPath);
const publicKey = readFileSync(publicKeyPath);
const keyProbe = Buffer.from(`naimage-studio-release-key:${version}:${compatibility}`, "utf8");
if (!verify(null, keyProbe, publicKey, sign(null, keyProbe, privateKey))) {
  throw new Error("发布签名私钥与客户端内置更新公钥不匹配，已停止生成清单。");
}

copyFileSync(unpackedAsar, restartPath);

function artifact(path, filename) {
  const stat = statSync(path);
  return {
    filename,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    size: stat.size
  };
}

const manifest = {
  schema_version: desktopReleaseSchemaVersion,
  product: desktopReleaseProduct,
  channel: "stable",
  version,
  published_at: new Date().toISOString(),
  minimum_version: minimumVersion,
  compatibility,
  notes: Array.isArray(releaseNotes[version]) ? releaseNotes[version] : [`SparkAI WorkSpace ${version} 稳定性与体验更新。`],
  restart: artifact(restartPath, restartName),
  installer: artifact(installerPath, installerName)
};
function signedManifest(candidateManifest) {
  const candidate = { ...candidateManifest };
  const canonicalRelease = Buffer.from(canonicalDesktopRelease(candidate), "utf8");
  const signature = sign(null, canonicalRelease, privateKey);
  if (!verify(null, canonicalRelease, publicKey, signature)) {
    throw new Error("发布签名私钥与客户端内置更新公钥不匹配，已停止生成清单。");
  }
  candidate.signature = signature.toString("base64");
  return candidate;
}

const canonicalManifest = signedManifest(manifest);

const manifestPath = join(releaseDir, "desktop-release.json");
const installerMetadataPath = join(releaseDir, `${installerName}.json`);
// A release is represented by one canonical manifest. Remove output left by
// the retired rename bridge so it cannot be uploaded with a new release.
rmSync(join(releaseDir, "desktop-release-legacy.json"), { force: true });
writeFileSync(manifestPath, `${JSON.stringify(canonicalManifest, null, 2)}\n`, "utf8");
writeFileSync(installerMetadataPath, `${JSON.stringify({
  filename: installerName,
  version,
  platform: "windows",
  architecture: "x64",
  size: canonicalManifest.installer.size,
  sha256: canonicalManifest.installer.sha256
}, null, 2)}\n`, "utf8");

const checksumPath = join(releaseDir, "SHA256SUMS.txt");
const checksumFiles = [installerPath, restartPath, manifestPath, installerMetadataPath];
writeFileSync(checksumPath, checksumFiles
  .map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${file.slice(releaseDir.length + 1)}`)
  .join("\n") + "\n", "utf8");

console.log(JSON.stringify({
  manifestPath,
  restartPath,
  installerPath,
  installerMetadataPath,
  checksumPath,
  version,
  compatibility,
  signatureVerified: true
}, null, 2));
