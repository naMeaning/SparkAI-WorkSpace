import { createHash, sign, verify } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const releaseNotes = JSON.parse(readFileSync(join(scriptDir, "release-notes.json"), "utf8"));
const { canonicalDesktopRelease, desktopReleaseProduct, desktopReleaseSchemaVersion } = require(join(projectRoot, "update-release.cjs"));
const version = String(packageMetadata.version || "").trim();
const compatibility = String(packageMetadata.iiimageUpdateCompatibility || "").trim();
const minimumVersion = String(packageMetadata.iiimageUpdateMinimumVersion || version).trim();
const releaseDir = join(projectRoot, "release");
const unpackedAsar = join(releaseDir, "win-unpacked", "resources", "app.asar");
const installerName = `iiimage-Studio-Setup-${version}-x64.exe`;
const installerPath = join(releaseDir, installerName);
const restartName = `iiimage-Studio-Restart-Update-${version}-x64.asar`;
const restartPath = join(releaseDir, restartName);
const privateKeyPath = process.env.IIIMAGE_RELEASE_PRIVATE_KEY
  ? resolve(process.env.IIIMAGE_RELEASE_PRIVATE_KEY)
  : join(projectRoot, "config", "release-signing-private.pem");
const publicKeyPath = join(projectRoot, "build", "update-public-key.pem");

for (const [label, file] of [["安装包", installerPath], ["应用资源", unpackedAsar], ["更新签名私钥", privateKeyPath], ["客户端更新公钥", publicKeyPath]]) {
  if (!existsSync(file)) throw new Error(`${label}不存在：${file}`);
}
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error(`无效版本号：${version}`);
if (!compatibility) throw new Error("package.json 缺少 iiimageUpdateCompatibility。");

const privateKey = readFileSync(privateKeyPath);
const publicKey = readFileSync(publicKeyPath);
const keyProbe = Buffer.from(`iiimage-studio-release-key:${version}:${compatibility}`, "utf8");
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
  notes: Array.isArray(releaseNotes[version]) ? releaseNotes[version] : [`iiimage Studio ${version} 稳定性与体验更新。`],
  restart: artifact(restartPath, restartName),
  installer: artifact(installerPath, installerName)
};
const canonicalRelease = Buffer.from(canonicalDesktopRelease(manifest), "utf8");
const signature = sign(null, canonicalRelease, privateKey);
if (!verify(null, canonicalRelease, publicKey, signature)) {
  throw new Error("发布签名私钥与客户端内置更新公钥不匹配，已停止生成清单。");
}
manifest.signature = signature.toString("base64");

const manifestPath = join(releaseDir, "desktop-release.json");
const installerMetadataPath = join(releaseDir, `${installerName}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(installerMetadataPath, `${JSON.stringify({
  filename: installerName,
  version,
  platform: "windows",
  architecture: "x64",
  size: manifest.installer.size,
  sha256: manifest.installer.sha256
}, null, 2)}\n`, "utf8");

const checksumPath = join(releaseDir, "SHA256SUMS.txt");
const checksumFiles = [installerPath, restartPath, manifestPath, installerMetadataPath];
writeFileSync(checksumPath, checksumFiles
  .map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${file.slice(releaseDir.length + 1)}`)
  .join("\n") + "\n", "utf8");

console.log(JSON.stringify({ manifestPath, restartPath, installerPath, installerMetadataPath, checksumPath, version, compatibility, signatureVerified: true }, null, 2));
