import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { path7za } from "7zip-bin";

const mirror = String(process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/").replace(/\/+$/, "");
const cacheRoot = process.env.ELECTRON_BUILDER_CACHE || join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "electron-builder",
  "Cache"
);
const toolsRoot = join(process.cwd(), ".release-tools", "downloads");
const isDirectoryBuild = process.argv.includes("--dir");
const packageMetadata = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const productVersion = String(packageMetadata.version || "").trim();
const releaseDir = join(process.cwd(), "release");
const brandedUninstallerDir = join(process.cwd(), ".release-tools", "brand-uninstaller");
const brandedUninstaller = join(brandedUninstallerDir, "iiimage Studio Uninstaller.exe");
const brandedInstallerDir = join(process.cwd(), ".release-tools", "brand-installer");

function isPathInside(candidate, root) {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

const artifacts = [
  {
    cacheGroup: "winCodeSign",
    folder: "winCodeSign-2.6.0",
    archive: "winCodeSign-2.6.0.7z",
    marker: "rcedit-x64.exe"
  },
  ...(isDirectoryBuild ? [] : [
    {
      cacheGroup: "nsis",
      folder: "nsis-3.0.4.1",
      archive: "nsis-3.0.4.1.7z",
      marker: join("Bin", "makensis.exe")
    },
    {
      // electron-builder stores the companion plugin archive beside NSIS
      // itself (Cache/nsis), even though its download artifact is named
      // nsis-resources.
      cacheGroup: "nsis",
      folder: "nsis-resources-3.4.1",
      archive: "nsis-resources-3.4.1.7z",
      marker: join("plugins", "x86-unicode", "nsis7z.dll")
    }
  ])
];

async function download(url, destination) {
  if (existsSync(destination)) return;
  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  const staging = `${destination}.part-${process.pid}`;
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(staging)));
  const { renameSync } = await import("node:fs");
  renameSync(staging, destination);
}

async function ensureArtifact(artifact) {
  const destination = join(cacheRoot, artifact.cacheGroup, artifact.folder);
  const marker = join(destination, artifact.marker);
  if (existsSync(marker)) return;
  const archivePath = join(toolsRoot, artifact.archive);
  await download(`${mirror}/${artifact.folder}/${artifact.archive}`, archivePath);
  mkdirSync(destination, { recursive: true });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(path7za, ["x", "-bd", "-y", archivePath, `-o${destination}`], {
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", rejectExit);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  // winCodeSign contains macOS symlinks that cannot be created without Windows
  // developer mode. 7-Zip reports code 2 after extracting the Windows tools;
  // the marker is the authoritative success condition for this build host.
  if (!existsSync(marker)) {
    if (!isPathInside(destination, cacheRoot)) throw new Error(`Refusing to clean build cache outside ${cacheRoot}.`);
    rmSync(destination, { recursive: true, force: true });
    throw new Error(`Unable to prepare ${artifact.folder}; 7-Zip exit code ${exitCode}.`);
  }
}

async function run(command, args, cwd = process.cwd()) {
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: { ...process.env }
    });
    child.on("error", rejectExit);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`${basename(command)} exited with code ${exitCode}.`);
}

async function publishBrandedUninstaller() {
  rmSync(brandedUninstallerDir, { recursive: true, force: true });
  mkdirSync(brandedUninstallerDir, { recursive: true });
  await run("dotnet", [
    "publish",
    join("tools", "windows-installer", "Uninstaller", "iiimage.Studio.Uninstaller.csproj"),
    "-c", "Release",
    "-o", brandedUninstallerDir,
    `-p:ProductVersion=${productVersion}`
  ]);
  if (!existsSync(brandedUninstaller)) throw new Error(`Branded uninstaller was not produced: ${brandedUninstaller}`);
}

async function wrapCoreInstaller() {
  const finalName = `iiimage-Studio-Setup-${productVersion}-x64.exe`;
  const finalInstaller = join(releaseDir, finalName);
  if (!existsSync(finalInstaller)) throw new Error(`NSIS core installer was not produced: ${finalInstaller}`);
  rmSync(brandedInstallerDir, { recursive: true, force: true });
  mkdirSync(brandedInstallerDir, { recursive: true });
  const coreInstaller = join(brandedInstallerDir, `iiimage-Studio-Core-${productVersion}-x64.exe`);
  renameSync(finalInstaller, coreInstaller);
  const coreHashPath = join(brandedInstallerDir, "core.sha256");
  const coreHash = createHash("sha256").update(readFileSync(coreInstaller)).digest("hex");
  writeFileSync(coreHashPath, `${coreHash}\n`, "ascii");

  const publishDir = join(brandedInstallerDir, "publish");
  await run("dotnet", [
    "publish",
    join("tools", "windows-installer", "Installer", "iiimage.Studio.Installer.csproj"),
    "-c", "Release",
    "-o", publishDir,
    `-p:ProductVersion=${productVersion}`,
    `-p:CoreInstallerPath=${coreInstaller}`,
    `-p:CoreInstallerHashPath=${coreHashPath}`
  ]);
  const publishedInstaller = join(publishDir, "iiimage Studio Setup.exe");
  if (!existsSync(publishedInstaller)) throw new Error(`Branded setup was not produced: ${publishedInstaller}`);
  copyFileSync(publishedInstaller, finalInstaller);

  // Rebuilding the public setup invalidates every current-version update
  // descriptor. Never leave an older signed manifest beside a newer EXE: a
  // partially completed release must look incomplete instead of publishable.
  rmSync(join(releaseDir, "desktop-release.json"), { force: true });
  rmSync(join(releaseDir, "SHA256SUMS.txt"), { force: true });
  rmSync(`${finalInstaller}.json`, { force: true });
  rmSync(join(releaseDir, `iiimage-Studio-Restart-Update-${productVersion}-x64.asar`), { force: true });

  // electron-builder's blockmap belongs to the hidden NSIS core and must not
  // be published beside the branded wrapper as if it described the final exe.
  rmSync(`${finalInstaller}.blockmap`, { force: true });
  console.log(JSON.stringify({
    finalInstaller,
    coreInstaller,
    brandedUninstaller,
    coreSha256: coreHash,
    finalBytes: readFileSync(finalInstaller).byteLength,
    staleReleaseMetadataInvalidated: true
  }, null, 2));
}

for (const artifact of artifacts) await ensureArtifact(artifact);
if (!isDirectoryBuild) await publishBrandedUninstaller();

const builderCli = join(process.cwd(), "node_modules", "electron-builder", "out", "cli", "cli.js");
const builderArgs = [builderCli, "--win"];
if (isDirectoryBuild) builderArgs.push("--x64", "--dir");
else builderArgs.push("nsis", "--x64");

const exitCode = await new Promise((resolveExit, rejectExit) => {
  const child = spawn(process.execPath, builderArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: { ...process.env, ELECTRON_BUILDER_BINARIES_MIRROR: `${mirror}/`, ELECTRON_BUILDER_CACHE: cacheRoot }
  });
  child.on("error", rejectExit);
  child.on("exit", (code) => resolveExit(code ?? 1));
});
if (exitCode !== 0) process.exitCode = exitCode;
else if (!isDirectoryBuild) await wrapCoreInstaller();
