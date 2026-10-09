import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const metadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const { ACCESS_VARIANT_DUAL, windowsInstallerArtifactName } = require(join(projectRoot, "runtime/access-variant.cjs"));
const baselineInstaller = resolve(process.env.NAIMAGE_RELEASE_BASELINE_INSTALLER || "");
const targetInstaller = join(projectRoot, "release", windowsInstallerArtifactName(metadata.version, ACCESS_VARIANT_DUAL));
const baselineExe = resolve(process.env.NAIMAGE_RELEASE_BASELINE_EXE || "");
const runDir = join(projectRoot, ".diagnostics/release", `full-installer-upgrade-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const installDir = join(runDir, "中文 升级路径", "naimage");
const migrationDir = join(runDir, "不得迁移路径");
const appData = process.env.APPDATA;
const guid = "887890c3-49de-5e86-9a32-28781d680b7f";
const report = { ok: false, realModelRequests: 0, runDir, stages: [], failure: "" };
let installed = false;
const createdSettingsFiles = new Map();

function insideProject(path) {
  const rel = relative(projectRoot, path);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(":");
}
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function psJson(script, env = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ${script}`], {
    cwd: projectRoot, windowsHide: true, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, ...env }
  });
  if (result.status !== 0) throw new Error(String(result.stderr || "Windows probe failed").slice(-2000));
  return JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
}
function registration() {
  return psJson(`$ErrorActionPreference='Stop'; $k=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}' -ErrorAction SilentlyContinue; $i=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${guid}' -ErrorAction SilentlyContinue; if($null -eq $k){'null'}else{[ordered]@{version=$k.DisplayVersion;location=$i.InstallLocation;uninstall=$k.UninstallString}|ConvertTo-Json -Compress}`);
}
function exeMetadata(path) {
  return psJson("$v=(Get-Item -LiteralPath $env:SPARK_RELEASE_PROBE_EXE).VersionInfo; [ordered]@{version=$v.ProductVersion;product=$v.ProductName}|ConvertTo-Json -Compress", { SPARK_RELEASE_PROBE_EXE: path });
}
async function run(name, command, args) {
  const started = Date.now();
  const result = await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NAIMAGE_INSTALLER_DIAGNOSTIC_IGNORE_MACHINE: "1" }
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-5000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-5000); });
    const timer = setTimeout(() => {
      if (child.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 30_000 });
      reject(new Error(`${name} timed out`));
    }, 300_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolveRun({ code, output }); });
  });
  report.stages.push({ name, exitCode: result.code, durationMs: Date.now() - started, output: result.output });
  assert.equal(result.code, 0, `${name} failed`);
}
async function waitRemoved(path) {
  for (let i = 0; i < 100; i += 1) {
    if (!existsSync(path)) return;
    await delay(250);
  }
  throw new Error("Uninstall did not remove the upgraded executable");
}

assert.equal(process.platform, "win32");
assert.ok(appData, "Windows profile must be loaded");
assert.ok(process.env.NAIMAGE_RELEASE_BASELINE_INSTALLER && insideProject(baselineInstaller) && existsSync(baselineInstaller), "An explicit project-local baseline installer is required");
assert.ok(process.env.NAIMAGE_RELEASE_BASELINE_EXE && insideProject(baselineExe) && existsSync(baselineExe), "A project-local baseline runtime is required");
assert.ok(existsSync(targetInstaller), "Current full installer is missing");
assert.equal(registration(), null, "Refusing to replace an existing user installation");
assert.equal(psJson(`Test-Path -LiteralPath 'HKCU:\\Software\\${guid}' | ConvertTo-Json -Compress`), false, "Existing install registry must be clean");
mkdirSync(runDir, { recursive: true });

try {
  report.baseline = { ...exeMetadata(baselineExe), installerSha256: hash(baselineInstaller) };
  report.target = { version: metadata.version, installerSha256: hash(targetInstaller) };
  await run("install previous version", baselineInstaller, ["/S", `/D=${installDir}`]);
  installed = true;
  const oldExe = join(installDir, basename(baselineExe));
  assert.ok(existsSync(oldExe), "Previous version executable missing");
  report.previousInstalled = exeMetadata(oldExe);
  assert.equal(report.previousInstalled.version, report.baseline.version);
  assert.notEqual(report.previousInstalled.version.split(".").slice(0, 3).join("."), metadata.version, "Baseline must be a previous version");
  report.registrationBefore = registration();
  assert.equal(resolve(report.registrationBefore.location).toLowerCase(), installDir.toLowerCase());

  // These are new fixtures in the test user's actual legacy settings directory
  // and an external managed project; neither installer may overwrite them.
  const legacyConfig = join(appData, "naimage", "config");
  assert.ok(!existsSync(legacyConfig) || readdirSync(legacyConfig).length === 0, "Refusing to overwrite existing user settings");
  const project = join(runDir, "外部项目保留");
  mkdirSync(join(project, "output/imagegen"), { recursive: true });
  mkdirSync(legacyConfig, { recursive: true });
  const fixtures = new Map([
    [join(legacyConfig, "app-settings.json"), JSON.stringify({ imageModel: "gpt-image-2", imageAspectRatio: "3:2", accessMode: "custom" })],
    [join(legacyConfig, "project-list.json"), JSON.stringify({ activeProjectId: "upgrade-fixture", projects: [{ id: "upgrade-fixture", name: "升级保留", dir: project }] })],
    [join(project, "session.json"), JSON.stringify({ version: 5, nodes: [], messages: [{ role: "user", content: "升级保留夹具" }] })],
    [join(project, "output/imagegen/preserved.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDQAAAABJRU5ErkJggg==", "base64")]
  ]);
  for (const [path, content] of fixtures) {
    writeFileSync(path, content);
    if (dirname(path) === legacyConfig) createdSettingsFiles.set(path, hash(path));
  }
  const hashes = new Map([...fixtures.keys()].map((path) => [path, hash(path)]));

  await run("upgrade with full installer", targetInstaller, ["/S", `/D=${migrationDir}`]);
  const newExe = join(installDir, "SparkAIWorkSpace.exe");
  assert.ok(existsSync(newExe), "Current executable missing after upgrade");
  assert.ok(!existsSync(migrationDir) || readdirSync(migrationDir).length === 0, "Upgrade must keep the registered install directory");
  report.currentInstalled = exeMetadata(newExe);
  assert.equal(report.currentInstalled.version.replace(/\.0$/, ""), metadata.version);
  report.registrationAfter = registration();
  assert.equal(resolve(report.registrationAfter.location).toLowerCase(), installDir.toLowerCase());
  assert.ok(report.registrationAfter.uninstall.toLowerCase().includes("sparkaiworkspace-uninstaller.exe"));
  assert.equal(hash(join(installDir, "resources/app.asar")), hash(join(projectRoot, "release/win-unpacked/resources/app.asar")), "Installed application differs from the current candidate");
  for (const [path, before] of hashes) assert.equal(hash(path), before, "Upgrade altered preserved data");
  report.preservedFiles = [...hashes.keys()].map((path) => relative(runDir, path));
  report.installedAsarMatched = true;
  await run("upgraded runtime smoke", process.execPath, [join(projectRoot, "scripts/release/packaged-smoke.mjs"), `--exe=${newExe}`]);
  await run("uninstall upgraded app", join(installDir, "SparkAIWorkSpace-uninstaller.exe"), ["/S"]);
  await waitRemoved(newExe);
  installed = false;
  assert.equal(registration(), null, "Uninstall registry remained after cleanup");
  for (const [path, before] of hashes) assert.equal(hash(path), before, "Uninstall altered preserved data");
  report.ok = true;
} catch (error) {
  report.failure = String(error?.message || error);
} finally {
  if (installed) {
    const candidates = ["SparkAIWorkSpace-uninstaller.exe", "naimage-uninstaller.exe"];
    const uninstaller = candidates.map((name) => join(installDir, name)).find(existsSync);
    if (uninstaller) {
      try { await run("cleanup failed fixture", uninstaller, ["/S"]); }
      catch (error) { report.cleanupFailure = String(error?.message || error); }
    }
  }
  for (const [path, expectedHash] of createdSettingsFiles) {
    // Remove only the exact settings fixtures this run created in a previously
    // empty test profile. Preserve unexpected changes for diagnosis.
    if (existsSync(path) && hash(path) === expectedHash) rmSync(path);
    else if (existsSync(path)) {
      report.ok = false;
      report.cleanupFailure = "Created settings fixture changed unexpectedly; preserved for diagnosis";
    }
  }
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
