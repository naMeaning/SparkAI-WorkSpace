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
import { createRequire } from "node:module";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { path7za } from "7zip-bin";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const {
  ACCESS_POLICY_FILENAME,
  ACCESS_VARIANT_DUAL,
  ACCESS_VARIANT_SPARKAPI,
  buildAccessPolicy,
  parseAccessPolicy,
  windowsCoreInstallerArtifactName,
  windowsInstallerArtifactName,
  windowsLegacyInstallerArtifactName
} = require(join(projectRoot, "runtime", "access-variant.cjs"));
const mirror = String(process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/").replace(/\/+$/, "");
const cacheRoot = process.env.ELECTRON_BUILDER_CACHE || join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "electron-builder",
  "Cache"
);
const toolsRoot = join(process.cwd(), ".release-tools", "downloads");
const isDirectoryBuild = process.argv.includes("--dir");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const productVersion = String(packageMetadata.version || "").trim();
const releaseDir = join(projectRoot, "release");
const brandedUninstallerDir = join(projectRoot, ".release-tools", "brand-uninstaller");
const brandedUninstaller = join(brandedUninstallerDir, "SparkAI WorkSpace Uninstaller.exe");
const brandedInstallerDir = join(projectRoot, ".release-tools", "brand-installer");
const coreInstallerName = windowsCoreInstallerArtifactName(productVersion);
const legacyInstallerName = windowsLegacyInstallerArtifactName(productVersion);

function builtAccessVariant() {
  const policyPath = join(projectRoot, "dist", ACCESS_POLICY_FILENAME);
  if (!existsSync(policyPath)) throw new Error(`Access policy was not built before packaging: ${policyPath}`);
  let policy = null;
  try {
    policy = parseAccessPolicy(JSON.parse(readFileSync(policyPath, "utf8")));
  } catch {
    // The explicit error below keeps packaging from guessing a public name.
  }
  if (!policy) throw new Error(`Built access policy is invalid: ${policyPath}`);
  if (String(process.env.SPARKAI_ACCESS_VARIANT || process.env.SPARKAI_ACCOUNT_ONLY || "").trim()) {
    const requestedPolicy = buildAccessPolicy(process.env);
    if (requestedPolicy.variant !== policy.variant) {
      throw new Error(`Built access policy ${policy.variant} does not match requested packaging variant ${requestedPolicy.variant}.`);
    }
  }
  return policy.variant;
}

const accessVariant = isDirectoryBuild ? null : builtAccessVariant();
const publicInstallerName = accessVariant ? windowsInstallerArtifactName(productVersion, accessVariant) : "";

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

function resolveWorkspaceDotnet() {
  const workspaceRoot = resolve(projectRoot, "..");
  const toolRoot = join(workspaceRoot, ".tools");
  const portable = join(toolRoot, "dotnet", process.platform === "win32" ? "dotnet.exe" : "dotnet");
  const envRoot = String(process.env.DOTNET_ROOT || process.env.DOTNET_ROOT_X64 || "").trim();
  const envDotnet = envRoot ? join(envRoot, process.platform === "win32" ? "dotnet.exe" : "dotnet") : "";
  const selected = [portable, envDotnet].find((candidate) => candidate && existsSync(candidate));
  if (!selected) {
    throw new Error(`Workspace .NET SDK not found at ${portable}. Activate the local toolchain before packaging.`);
  }
  return { command: selected, toolRoot, dotnetRoot: dirname(selected) };
}

function workspaceDotnetEnv() {
  const { command, toolRoot, dotnetRoot } = resolveWorkspaceDotnet();
  return {
    command,
    env: {
      ...process.env,
      DOTNET_ROOT: dotnetRoot,
      DOTNET_ROOT_X64: dotnetRoot,
      DOTNET_CLI_HOME: join(toolRoot, "dotnet-cli-home"),
      NUGET_PACKAGES: join(toolRoot, "nuget-packages"),
      DOTNET_MULTILEVEL_LOOKUP: "0",
      DOTNET_NOLOGO: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      PATH: `${dotnetRoot}${delimiter}${process.env.PATH || ""}`
    }
  };
}

function cleanProjectBuildOutput(csprojRelativePath) {
  const projectDir = dirname(join(projectRoot, csprojRelativePath));
  for (const name of ["bin", "obj"]) {
    const target = join(projectDir, name);
    if (!existsSync(target)) continue;
    if (!isPathInside(target, projectDir)) throw new Error(`Refusing to clean build output outside ${projectDir}.`);
    rmSync(target, { recursive: true, force: true });
  }
}

async function run(command, args, cwd = process.cwd(), env = process.env) {
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: { ...env }
    });
    child.on("error", rejectExit);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`${basename(command)} exited with code ${exitCode}.`);
}

async function publishDotnetProject(csprojRelativePath, outputDir, extraProperties = []) {
  const { command, env } = workspaceDotnetEnv();
  cleanProjectBuildOutput(csprojRelativePath);
  mkdirSync(outputDir, { recursive: true });
  await run(command, [
    "publish",
    csprojRelativePath,
    "-c", "Release",
    "-o", outputDir,
    `-p:ProductVersion=${productVersion}`,
    ...extraProperties
  ], projectRoot, env);
}

async function publishBrandedUninstaller() {
  rmSync(brandedUninstallerDir, { recursive: true, force: true });
  mkdirSync(brandedUninstallerDir, { recursive: true });
  await publishDotnetProject(
    join("tools", "windows-installer", "Uninstaller", "naimage.Studio.Uninstaller.csproj"),
    brandedUninstallerDir
  );
  if (!existsSync(brandedUninstaller)) throw new Error(`Branded uninstaller was not produced: ${brandedUninstaller}`);
}

async function wrapCoreInstaller() {
  const coreSource = join(releaseDir, coreInstallerName);
  const finalInstaller = join(releaseDir, publicInstallerName);
  if (!existsSync(coreSource)) throw new Error(`NSIS core installer was not produced: ${coreSource}`);
  rmSync(brandedInstallerDir, { recursive: true, force: true });
  mkdirSync(brandedInstallerDir, { recursive: true });
  const coreInstaller = join(brandedInstallerDir, coreInstallerName);
  renameSync(coreSource, coreInstaller);
  const coreHashPath = join(brandedInstallerDir, "core.sha256");
  const coreHash = createHash("sha256").update(readFileSync(coreInstaller)).digest("hex");
  writeFileSync(coreHashPath, `${coreHash}\n`, "ascii");

  const publishDir = join(brandedInstallerDir, "publish");
  await publishDotnetProject(
    join("tools", "windows-installer", "Installer", "naimage.Studio.Installer.csproj"),
    publishDir,
    [
      `-p:CoreInstallerPath=${coreInstaller}`,
      `-p:CoreInstallerHashPath=${coreHashPath}`
    ]
  );
  const publishedInstaller = join(publishDir, "SparkAI WorkSpace Installer.exe");
  if (!existsSync(publishedInstaller)) throw new Error(`Branded setup was not produced: ${publishedInstaller}`);
  copyFileSync(publishedInstaller, finalInstaller);

  // Rebuilding the public setup invalidates every current-version update
  // descriptor. Never leave an older signed manifest beside a newer EXE: a
  // partially completed release must look incomplete instead of publishable.
  rmSync(join(releaseDir, "desktop-release.json"), { force: true });
  rmSync(join(releaseDir, "desktop-release-legacy.json"), { force: true });
  rmSync(join(releaseDir, "SHA256SUMS.txt"), { force: true });
  for (const installerName of [
    windowsInstallerArtifactName(productVersion, ACCESS_VARIANT_DUAL),
    windowsInstallerArtifactName(productVersion, ACCESS_VARIANT_SPARKAPI),
    legacyInstallerName
  ]) {
    rmSync(join(releaseDir, `${installerName}.json`), { force: true });
  }
  rmSync(join(releaseDir, `naimage-Restart-Update-${productVersion}-x64.asar`), { force: true });

  // electron-builder's blockmap belongs to the hidden NSIS core and must not
  // be published beside the branded wrapper as if it described the final exe.
  rmSync(`${coreSource}.blockmap`, { force: true });
  const legacyInstaller = join(releaseDir, legacyInstallerName);
  rmSync(legacyInstaller, { force: true });
  rmSync(`${legacyInstaller}.blockmap`, { force: true });
  console.log(JSON.stringify({
    accessVariant,
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
