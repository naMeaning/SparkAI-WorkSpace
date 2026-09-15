import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const { ACCESS_POLICY_FILENAME, parseAccessPolicy, windowsInstallerArtifactName } = require(join(projectRoot, "runtime", "access-variant.cjs"));
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = String(packageMetadata.version || "").trim();
const accessPolicyPath = join(projectRoot, "dist", ACCESS_POLICY_FILENAME);
const accessPolicy = existsSync(accessPolicyPath)
  ? parseAccessPolicy(JSON.parse(readFileSync(accessPolicyPath, "utf8")))
  : null;
if (!accessPolicy) throw new Error(`Built access policy is required for installer smoke: ${accessPolicyPath}`);
const installerArg = process.argv.find((item) => item.startsWith("--installer="));
const installer = resolve(
  installerArg?.split("=").slice(1).join("=") ||
  join(projectRoot, "release", windowsInstallerArtifactName(version, accessPolicy.variant))
);
const uninstallerSourceArg = process.argv.find((item) => item.startsWith("--uninstaller-source="));
const uninstallerSource = uninstallerSourceArg
  ? resolve(uninstallerSourceArg.split("=").slice(1).join("="))
  : "";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(projectRoot, ".diagnostics", "release", `installer-smoke-${stamp}`);
const installDir = join(runDir, "中文 安装路径", "naimage");
const installedExe = join(installDir, "SparkAIWorkSpace.exe");
const uninstaller = join(installDir, "SparkAIWorkSpace-uninstaller.exe");
const failureRollbackDir = join(runDir, "故障回滚路径", "naimage");
const cancelledInstallDir = join(runDir, "取消安装路径", "naimage");
const watchdogRollbackDir = join(runDir, "Watchdog 回滚路径", "naimage");
const noShortcutDir = join(runDir, "无快捷方式路径", "naimage");
const noShortcutExe = join(noShortcutDir, "SparkAIWorkSpace.exe");
const noShortcutUninstaller = join(noShortcutDir, "SparkAIWorkSpace-uninstaller.exe");
const noShortcutRepairAttemptDir = join(runDir, "无快捷方式禁止迁移路径", "naimage");
const noShortcutRepairAttemptUninstaller = join(noShortcutRepairAttemptDir, "SparkAIWorkSpace-uninstaller.exe");
const migrationAttemptDir = join(runDir, "禁止迁移路径", "naimage");
const migrationUninstaller = join(migrationAttemptDir, "SparkAIWorkSpace-uninstaller.exe");
const lockedOptionsCapture = join(runDir, "existing-install-path-locked.png");
const preservedDataDir = join(runDir, "卸载保留数据", "naimage");
const preservedDataSentinel = join(preservedDataDir, "project-library-preserved.txt");
const preservedLocalDataDir = join(runDir, "卸载保留本地辅助数据", "naimage");
const preservedLocalDataSentinel = join(preservedLocalDataDir, "installer-log-preserved.txt");
const clearedDataDir = join(runDir, "卸载清理数据", "naimage");
const clearedDataSentinel = join(clearedDataDir, "project-library-cleared.txt");
const clearedLocalDataDir = join(runDir, "卸载清理本地辅助数据", "naimage");
const clearedLocalDataSentinel = join(clearedLocalDataDir, "installer-log-cleared.txt");
const externalProjectDir = join(runDir, "外部项目必须保留");
const externalProjectSentinel = join(externalProjectDir, "external-project-preserved.txt");
const protectedProgramFilesDir = join(process.env.ProgramFiles || "C:\\Program Files", `naimage Smoke ${stamp}`);
const protectedWindowsDir = join(process.env.SystemRoot || "C:\\Windows", "System32", `naimage Smoke ${stamp}`);
const reportPath = join(runDir, "report.json");
const operationLockPath = join(tmpdir(), "naimage-studio-installer", "operation-lock", "install-uninstall.lock");
const packagedSmokeScript = join(scriptDir, "packaged-smoke.mjs");
// The developer workstation can retain a legacy per-machine 1.0.1 install.
// Smoke always passes /currentuser and ignores only that machine-level
// detection so the isolated HKCU install can be verified without touching it.
const smokeEnvironment = {
  ...process.env,
  NAIMAGE_INSTALLER_DIAGNOSTIC_IGNORE_MACHINE: "1",
  NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_DATA_OVERRIDE: "1",
  NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_TIMEOUT_OVERRIDE: "1"
};

if (!existsSync(installer)) throw new Error(`Installer not found: ${installer}`);
if (uninstallerSource && !existsSync(uninstallerSource)) {
  throw new Error(`Uninstaller source not found: ${uninstallerSource}`);
}
mkdirSync(runDir, { recursive: true });

let injectedUninstallerCount = 0;
function injectCurrentUninstaller(destination) {
  if (!uninstallerSource) return;
  copyFileSync(uninstallerSource, destination);
  injectedUninstallerCount += 1;
}

function walkFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const files = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

function uniqueExisting(paths) {
  return [...new Set(paths.map((path) => resolve(path)))].filter((path) => existsSync(path));
}

function sameWindowsPath(left, right) {
  if (!left || !right) return false;
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function shortcutPaths() {
  const managedShortcutNames = new Set(["sparkai workspace.lnk", "naimage.lnk", "iiimage studio.lnk"]);
  const desktopRoots = uniqueExisting([
    join(homedir(), "Desktop"),
    join(homedir(), "OneDrive", "Desktop")
  ]);
  const startMenuRoot = process.env.APPDATA
    ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
    : "";
  const desktop = desktopRoots.flatMap((root) => walkFiles(root)).filter((path) => (
    managedShortcutNames.has(basename(path).toLowerCase())
  ));
  const startMenu = startMenuRoot && existsSync(startMenuRoot)
    ? walkFiles(startMenuRoot).filter((path) => managedShortcutNames.has(basename(path).toLowerCase()))
    : [];
  return { desktop: uniqueExisting(desktop), startMenu: uniqueExisting(startMenu) };
}

function run(command, args, timeout = 180_000, environment = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...smokeEnvironment, ...environment }
    });
    let stdout = "";
    let stderr = "";
    let spawnError = "";
    let timedOut = false;
    let treeKillStatus = null;
    let settled = false;
    let timer = null;
    const append = (current, chunk) => `${current}${String(chunk || "")}`.slice(-(8 * 1024 * 1024));
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      spawnError = String(error?.stack || error?.message || error);
    });

    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveRun({
        pid: child.pid || null,
        status: timedOut ? null : status,
        signal: timedOut ? "SIGTERM" : signal,
        timedOut,
        treeKillStatus,
        error: timedOut
          ? `Error: ${basename(command)} timed out after ${timeout} ms; process tree termination status ${treeKillStatus}.`
          : spawnError,
        stdout: stdout.slice(-12_000),
        stderr: stderr.slice(-12_000)
      });
    };

    child.on("close", finish);
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          cwd: projectRoot,
          windowsHide: true,
          encoding: "utf8",
          timeout: 30_000
        });
        treeKillStatus = killed.status;
        stdout = append(stdout, killed.stdout);
        stderr = append(stderr, killed.stderr);
      }
      setTimeout(() => finish(null, "SIGTERM"), 10_000).unref?.();
    }, timeout);
    timer.unref?.();
  });
}

function installerProcessSnapshot() {
  const script = `
$needle = $env:NAIMAGE_SMOKE_RUN_DIR
$rows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.ProcessId -ne $PID
} | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)
$rows | ConvertTo-Json -Compress -Depth 4
`;
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      cwd: projectRoot,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NAIMAGE_SMOKE_RUN_DIR: runDir }
    });
    if (result.status !== 0) continue;
    const output = String(result.stdout || "").replace(/^\uFEFF/, "").trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  throw new Error("Unable to query installer process hygiene through PowerShell.");
}

async function settleInstallerProcessHygiene() {
  await delay(750);
  const beforeForcedCleanup = installerProcessSnapshot();
  for (const processInfo of beforeForcedCleanup) {
    spawnSync("taskkill.exe", ["/PID", String(processInfo.ProcessId), "/T", "/F"], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: "ignore",
      timeout: 30_000
    });
  }
  if (beforeForcedCleanup.length) await delay(750);
  const afterForcedCleanup = installerProcessSnapshot();
  await delay(250);
  return {
    operationLockPath,
    orphanProcessesBeforeForcedCleanup: beforeForcedCleanup,
    forcedCleanupCount: beforeForcedCleanup.length,
    orphanProcessesAfterForcedCleanup: afterForcedCleanup,
    operationLockRemaining: existsSync(operationLockPath)
  };
}

async function waitUntil(predicate, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await delay(250);
  }
  return false;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function signatureStatus(filePath) {
  if (!existsSync(filePath)) return "Missing";
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    const result = spawnSync(shell, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-AuthenticodeSignature -LiteralPath $env:NAIMAGE_SIGNATURE_PATH).Status.ToString()"
    ], {
      cwd: projectRoot,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NAIMAGE_SIGNATURE_PATH: filePath }
    });
    const status = String(result.stdout || "").trim();
    if (result.status === 0 && status) return status;
  }
  return "Unknown";
}

function registeredUninstallEntry() {
  const registryPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\887890c3-49de-5e86-9a32-28781d680b7f";
  const installRegistryPath = "Software\\887890c3-49de-5e86-9a32-28781d680b7f";
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$record = $null
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    $key = $base.OpenSubKey($env:NAIMAGE_UNINSTALL_REGISTRY_PATH)
    $installKey = $base.OpenSubKey($env:NAIMAGE_INSTALL_REGISTRY_PATH)
    if ($null -ne $key) {
      try {
        $installLocation = if ($null -ne $installKey) { [string]$installKey.GetValue('InstallLocation', '') } else { '' }
        $record = [ordered]@{
          uninstallString = [string]$key.GetValue('UninstallString', '')
          quietUninstallString = [string]$key.GetValue('QuietUninstallString', '')
          installLocation = $installLocation
          displayVersion = [string]$key.GetValue('DisplayVersion', '')
          registryView = [string]$view
        }
      } finally {
        $key.Dispose()
        if ($null -ne $installKey) { $installKey.Dispose() }
      }
      break
    }
    if ($null -ne $installKey) { $installKey.Dispose() }
  } finally { $base.Dispose() }
}
if ($null -eq $record) { exit 3 }
$record | ConvertTo-Json -Compress
`;
  let lastFailure = "";
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      cwd: projectRoot,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...smokeEnvironment,
        NAIMAGE_UNINSTALL_REGISTRY_PATH: registryPath,
        NAIMAGE_INSTALL_REGISTRY_PATH: installRegistryPath
      }
    });
    if (result.status === 3) return null;
    if (result.status === 0) {
      return JSON.parse(String(result.stdout || "").replace(/^\uFEFF/, "").trim());
    }
    lastFailure = String(result.stderr || result.error || `exit ${result.status}`).trim();
  }
  throw new Error(`Unable to query uninstall registration through the PowerShell Registry API: ${lastFailure}`);
}

async function runRegisteredCommand(commandLine, extraArguments, timeout = 120_000) {
  return run("cmd.exe", ["/d", "/s", "/c", `${commandLine} ${extraArguments.join(" ")}`], timeout);
}

const shortcutsBefore = shortcutPaths();
const preexistingInstallCandidates = uniqueExisting([
  join(process.env.LOCALAPPDATA || "", "Programs", "SparkAI WorkSpace", "SparkAIWorkSpace.exe"),
  join(process.env.LOCALAPPDATA || "", "Programs", "naimage", "naimage.exe"),
  join(process.env.LOCALAPPDATA || "", "naimage", "naimage.exe")
]);
const preexistingUninstallRegistration = registeredUninstallEntry();
if (
  shortcutsBefore.desktop.length ||
  shortcutsBefore.startMenu.length ||
  preexistingInstallCandidates.length ||
  preexistingUninstallRegistration
) {
  throw new Error(
    "A pre-existing naimage installation, uninstall registration, or shortcut was detected; refusing to run destructive installer smoke."
  );
}

let installResult = null;
let packagedSmokeResult = null;
let reinstallResult = null;
let uninstallResult = null;
let uninstallDiagnosticFailureResult = null;
let registeredUninstallLaunchResult = null;
let diagnosticFailureResult = null;
let diagnosticCancelResult = null;
let watchdogRollbackResult = null;
let noShortcutInstallResult = null;
let noShortcutRepairResult = null;
let noShortcutUninstallResult = null;
let protectedProgramFilesResult = null;
let protectedWindowsResult = null;
let lockedOptionsCaptureResult = null;
let cleanupAttempted = false;
let failure = "";
let shortcutsAfterInstall = { desktop: [], startMenu: [] };
let shortcutsAfterUninstall = { desktop: [], startMenu: [] };
let shortcutsDuringNoShortcutInstall = { desktop: [], startMenu: [] };
let shortcutsAfterNoShortcutRepair = { desktop: [], startMenu: [] };
let installerSignature = "Unknown";
let installedSignature = "Unknown";
let brandedUninstallEntry = null;
let brandedUninstallEntryAfter = null;
let brandedUninstallRegistration = "";
let brandedUninstallRegistrationAfter = "";
let preservedDataStillExists = false;
let preservedLocalDataStillExists = false;
let clearedDataRemoved = false;
let clearedLocalDataRemoved = false;
let externalProjectStillExists = false;

try {
  installerSignature = signatureStatus(installer);
  watchdogRollbackResult = await run(installer, ["/S", `/D=${watchdogRollbackDir}`], 120_000, {
    NAIMAGE_INSTALLER_DIAGNOSTIC_STALL_CORE: "1",
    NAIMAGE_INSTALLER_DIAGNOSTIC_CORE_TIMEOUT_MS: "120",
    NAIMAGE_INSTALLER_DIAGNOSTIC_RECOVERY_TIMEOUT_MS: "120"
  });
  if (watchdogRollbackResult.status === 0 || walkFiles(watchdogRollbackDir).length > 0 || registeredUninstallEntry()) {
    throw new Error("Installer watchdog terminal timeout did not return a clean rollback state.");
  }

  installResult = await run(installer, ["/S", `/D=${installDir}`], 300_000, {
    NAIMAGE_INSTALLER_DIAGNOSTIC_CORE_TIMEOUT_MS: "1"
  });
  if (installResult.status !== 0) throw new Error(`Installer exited with code ${installResult.status}.`);
  if (!(await waitUntil(() => existsSync(installedExe), 45_000))) {
    throw new Error("Installed executable did not appear.");
  }
  injectCurrentUninstaller(uninstaller);
  installedSignature = signatureStatus(installedExe);
  brandedUninstallEntry = registeredUninstallEntry();
  brandedUninstallRegistration = String(brandedUninstallEntry?.uninstallString || "");
  if (
    !brandedUninstallRegistration.toLowerCase().includes("sparkaiworkspace-uninstaller.exe") ||
    !String(brandedUninstallEntry?.quietUninstallString || "").toLowerCase().includes("sparkaiworkspace-uninstaller.exe") ||
    !sameWindowsPath(String(brandedUninstallEntry?.installLocation || ""), installDir)
  ) {
    throw new Error("Windows uninstall registration does not point to the branded uninstaller.");
  }
  registeredUninstallLaunchResult = await runRegisteredCommand(
    brandedUninstallEntry.quietUninstallString,
    ["--diagnostic-fail-before-core"],
    120_000
  );
  if (registeredUninstallLaunchResult.status === 0 || !existsSync(installedExe) || !existsSync(uninstaller)) {
    throw new Error("The registered uninstall entry did not launch the branded uninstaller or preserve the app after a diagnostic failure.");
  }
  lockedOptionsCaptureResult = await run(installer, [
    `--capture=${lockedOptionsCapture}`,
    "--capture-page=options",
    "--capture-scale=1.5"
  ], 60_000);
  if (lockedOptionsCaptureResult.status !== 0 || !existsSync(lockedOptionsCapture)) {
    throw new Error("Existing-install locked-path UI evidence was not created.");
  }
  // NSIS can expose the application files a fraction before its shortcut
  // creation step completes. Observe the finished installer state instead of
  // racing the last shell-integration writes.
  await waitUntil(() => {
    const shortcuts = shortcutPaths();
    return shortcuts.desktop.length > 0 && shortcuts.startMenu.length > 0;
  }, 30_000);
  shortcutsAfterInstall = shortcutPaths();
  packagedSmokeResult = await run(process.execPath, [packagedSmokeScript, `--exe=${installedExe}`], 180_000);
  if (packagedSmokeResult.status !== 0) throw new Error("Installed application runtime smoke failed.");
  if (!existsSync(uninstaller)) throw new Error("Uninstaller was not created.");
  reinstallResult = await run(installer, ["/S", `/D=${migrationAttemptDir}`], 300_000);
  const lockedUpgradeReady = await waitUntil(() => existsSync(installedExe) && existsSync(uninstaller), 60_000);
  if (reinstallResult.status !== 0 || !lockedUpgradeReady || walkFiles(migrationAttemptDir).length > 0) {
    throw new Error(`Repair/upgrade pass failed with code ${reinstallResult.status}.`);
  }
  injectCurrentUninstaller(uninstaller);
  uninstallDiagnosticFailureResult = await run(uninstaller, ["/S", "--diagnostic-fail-before-core"], 120_000);
  if (uninstallDiagnosticFailureResult.status === 0 || !existsSync(installedExe) || !existsSync(uninstaller)) {
    throw new Error("Branded silent uninstaller did not propagate its pre-commit failure exit code.");
  }
  mkdirSync(preservedDataDir, { recursive: true });
  mkdirSync(preservedLocalDataDir, { recursive: true });
  writeFileSync(preservedDataSentinel, "preserve branch evidence\n", "utf8");
  writeFileSync(preservedLocalDataSentinel, "preserve local branch evidence\n", "utf8");
  uninstallResult = await run(uninstaller, [
    "/S",
    `--diagnostic-user-data-dir=${preservedDataDir}`,
    `--diagnostic-local-data-dir=${preservedLocalDataDir}`
  ], 240_000, {
    NAIMAGE_UNINSTALLER_DIAGNOSTIC_CORE_TIMEOUT_MS: "1"
  });
  cleanupAttempted = true;
  if (uninstallResult.status !== 0) throw new Error(`Uninstaller exited with code ${uninstallResult.status}.`);
  await waitUntil(() => {
    const shortcuts = shortcutPaths();
    return walkFiles(installDir).length === 0 && shortcuts.desktop.length === 0 && shortcuts.startMenu.length === 0;
  }, 45_000);
  shortcutsAfterUninstall = shortcutPaths();
  preservedDataStillExists = existsSync(preservedDataSentinel);
  preservedLocalDataStillExists = existsSync(preservedLocalDataSentinel);
  brandedUninstallEntryAfter = registeredUninstallEntry();
  brandedUninstallRegistrationAfter = String(brandedUninstallEntryAfter?.uninstallString || "");
  if (!preservedDataStillExists) throw new Error("Default uninstall removed the isolated user-data sentinel.");
  if (!preservedLocalDataStillExists) throw new Error("Default uninstall removed the isolated local-data sentinel.");
  if (brandedUninstallRegistrationAfter) throw new Error("Windows uninstall registration remained after uninstall.");

  protectedProgramFilesResult = await run(installer, ["/S", `/D=${protectedProgramFilesDir}`], 120_000);
  if (protectedProgramFilesResult.status === 0 || walkFiles(protectedProgramFilesDir).length > 0) {
    throw new Error("Program Files protected-directory refusal failed.");
  }
  protectedWindowsResult = await run(installer, ["/S", `/D=${protectedWindowsDir}`], 120_000);
  if (protectedWindowsResult.status === 0 || walkFiles(protectedWindowsDir).length > 0) {
    throw new Error("Windows protected-directory refusal failed.");
  }

  diagnosticFailureResult = await run(installer, [
    "/S",
    "--diagnostic-fail-before-core",
    `/D=${failureRollbackDir}`
  ], 120_000);
  if (diagnosticFailureResult.status === 0 || walkFiles(failureRollbackDir).length > 0) {
    throw new Error("Pre-commit failure did not leave a clean rollback state.");
  }
  diagnosticCancelResult = await run(installer, [
    "/S",
    "--diagnostic-cancel-before-core",
    `/D=${cancelledInstallDir}`
  ], 120_000);
  if (diagnosticCancelResult.status === 0 || walkFiles(cancelledInstallDir).length > 0) {
    throw new Error("Pre-commit cancellation did not leave a clean state.");
  }

  noShortcutInstallResult = await run(installer, [
    "/S",
    "--no-desktop",
    "--no-start-menu",
    `/D=${noShortcutDir}`
  ], 240_000);
  if (noShortcutInstallResult.status !== 0 || !(await waitUntil(() => existsSync(noShortcutExe), 45_000))) {
    throw new Error(`No-shortcut installation failed with code ${noShortcutInstallResult.status}.`);
  }
  shortcutsDuringNoShortcutInstall = shortcutPaths();
  if (shortcutsDuringNoShortcutInstall.desktop.length || shortcutsDuringNoShortcutInstall.startMenu.length) {
    throw new Error("Shortcut opt-out was not honored.");
  }
  if (!existsSync(noShortcutUninstaller)) throw new Error("No-shortcut installation did not create the branded uninstaller.");
  injectCurrentUninstaller(noShortcutUninstaller);
  noShortcutRepairResult = await run(installer, ["/S", `/D=${noShortcutRepairAttemptDir}`], 300_000);
  if (noShortcutRepairResult.status !== 0 || !(await waitUntil(() => existsSync(noShortcutExe), 45_000))) {
    throw new Error(`No-shortcut repair failed with code ${noShortcutRepairResult.status}.`);
  }
  shortcutsAfterNoShortcutRepair = shortcutPaths();
  if (
    shortcutsAfterNoShortcutRepair.desktop.length ||
    shortcutsAfterNoShortcutRepair.startMenu.length ||
    walkFiles(noShortcutRepairAttemptDir).length > 0
  ) {
    throw new Error("Silent repair did not preserve shortcut opt-out or attempted to migrate the install path.");
  }
  injectCurrentUninstaller(noShortcutUninstaller);
  mkdirSync(clearedDataDir, { recursive: true });
  mkdirSync(clearedLocalDataDir, { recursive: true });
  mkdirSync(externalProjectDir, { recursive: true });
  writeFileSync(clearedDataSentinel, "clear branch evidence\n", "utf8");
  writeFileSync(clearedLocalDataSentinel, "clear local branch evidence\n", "utf8");
  writeFileSync(externalProjectSentinel, "external project evidence\n", "utf8");
  noShortcutUninstallResult = await run(noShortcutUninstaller, [
    "/S",
    "--delete-app-data",
    `--diagnostic-user-data-dir=${clearedDataDir}`,
    `--diagnostic-local-data-dir=${clearedLocalDataDir}`
  ], 180_000);
  if (noShortcutUninstallResult.status !== 0) throw new Error(`No-shortcut uninstaller exited with code ${noShortcutUninstallResult.status}.`);
  await waitUntil(() => walkFiles(noShortcutDir).length === 0, 45_000);
  clearedDataRemoved = !existsSync(clearedDataDir);
  clearedLocalDataRemoved = !existsSync(clearedLocalDataDir);
  externalProjectStillExists = existsSync(externalProjectSentinel);
  if (!clearedDataRemoved) throw new Error("Explicit data-clean uninstall left the isolated managed-data directory behind.");
  if (!clearedLocalDataRemoved) throw new Error("Explicit data-clean uninstall left the isolated local auxiliary-data directory behind.");
  if (!externalProjectStillExists) throw new Error("Explicit data-clean uninstall removed an external project sentinel.");
} catch (error) {
  failure = error instanceof Error ? error.stack || error.message : String(error);
  if (!cleanupAttempted && existsSync(uninstaller)) {
    uninstallResult = await run(uninstaller, ["/S"], 180_000);
    cleanupAttempted = true;
    await waitUntil(() => {
      const shortcuts = shortcutPaths();
      return walkFiles(installDir).length === 0 && shortcuts.desktop.length === 0 && shortcuts.startMenu.length === 0;
    }, 45_000);
  }
  if (existsSync(noShortcutUninstaller)) {
    noShortcutUninstallResult = await run(noShortcutUninstaller, ["/S"], 180_000);
    await waitUntil(() => walkFiles(noShortcutDir).length === 0, 45_000);
  }
  if (existsSync(noShortcutRepairAttemptUninstaller)) {
    await run(noShortcutRepairAttemptUninstaller, ["/S"], 180_000);
    await waitUntil(() => walkFiles(noShortcutRepairAttemptDir).length === 0, 45_000);
  }
  if (existsSync(migrationUninstaller)) {
    await run(migrationUninstaller, ["/S"], 180_000);
    await waitUntil(() => walkFiles(migrationAttemptDir).length === 0, 45_000);
  }
  shortcutsAfterUninstall = shortcutPaths();
}

const processHygiene = await settleInstallerProcessHygiene();
const remainingInstalledFiles = walkFiles(installDir);
const remainingNoShortcutFiles = walkFiles(noShortcutDir);
const failureRollbackFiles = walkFiles(failureRollbackDir);
const cancelledInstallFiles = walkFiles(cancelledInstallDir);
const watchdogRollbackFiles = walkFiles(watchdogRollbackDir);
const migrationAttemptFiles = walkFiles(migrationAttemptDir);
const noShortcutRepairAttemptFiles = walkFiles(noShortcutRepairAttemptDir);
const protectedProgramFiles = walkFiles(protectedProgramFilesDir);
const protectedWindowsFiles = walkFiles(protectedWindowsDir);
const desktopShortcutCreated = shortcutsAfterInstall.desktop.length > 0;
const startMenuShortcutCreated = shortcutsAfterInstall.startMenu.length > 0;
const desktopShortcutRemoved = shortcutsAfterUninstall.desktop.length === 0;
const startMenuShortcutRemoved = shortcutsAfterUninstall.startMenu.length === 0;
const ok = Boolean(
  !failure &&
  (!uninstallerSource || injectedUninstallerCount >= 4) &&
  installResult?.status === 0 &&
  packagedSmokeResult?.status === 0 &&
  reinstallResult?.status === 0 &&
  uninstallResult?.status === 0 &&
  uninstallDiagnosticFailureResult?.status !== 0 &&
  registeredUninstallLaunchResult?.status !== 0 &&
  diagnosticFailureResult?.status !== 0 &&
  diagnosticCancelResult?.status !== 0 &&
  watchdogRollbackResult?.status !== 0 &&
  noShortcutInstallResult?.status === 0 &&
  noShortcutRepairResult?.status === 0 &&
  noShortcutUninstallResult?.status === 0 &&
  protectedProgramFilesResult?.status !== 0 &&
  protectedWindowsResult?.status !== 0 &&
  lockedOptionsCaptureResult?.status === 0 &&
  desktopShortcutCreated &&
  startMenuShortcutCreated &&
  desktopShortcutRemoved &&
  startMenuShortcutRemoved &&
  preservedDataStillExists &&
  preservedLocalDataStillExists &&
  clearedDataRemoved &&
  clearedLocalDataRemoved &&
  externalProjectStillExists &&
  brandedUninstallEntry !== null &&
  brandedUninstallEntryAfter === null &&
  brandedUninstallRegistrationAfter === "" &&
  remainingInstalledFiles.length === 0 &&
  remainingNoShortcutFiles.length === 0 &&
  failureRollbackFiles.length === 0 &&
  cancelledInstallFiles.length === 0 &&
  watchdogRollbackFiles.length === 0 &&
  migrationAttemptFiles.length === 0 &&
  noShortcutRepairAttemptFiles.length === 0 &&
  protectedProgramFiles.length === 0 &&
  protectedWindowsFiles.length === 0 &&
  shortcutsDuringNoShortcutInstall.desktop.length === 0 &&
  shortcutsDuringNoShortcutInstall.startMenu.length === 0 &&
  shortcutsAfterNoShortcutRepair.desktop.length === 0 &&
  shortcutsAfterNoShortcutRepair.startMenu.length === 0 &&
  processHygiene.forcedCleanupCount === 0 &&
  processHygiene.orphanProcessesAfterForcedCleanup.length === 0 &&
  !processHygiene.operationLockRemaining
);

const report = {
  ok,
  generatedAt: new Date().toISOString(),
  installer,
  installerBytes: statSync(installer).size,
  installerSha256: sha256(installer),
  installerSignature,
  uninstallerSource: uninstallerSource || null,
  injectedUninstallerCount,
  installDir,
  installedExe,
  installedSignature,
  brandedUninstallEntry,
  brandedUninstallEntryAfter,
  brandedUninstallRegistration,
  brandedUninstallRegistrationAfter,
  registeredUninstallLaunchResult,
  installResult,
  packagedSmokeResult,
  reinstallResult,
  pathLock: {
    migrationAttemptDir,
    migrationAttemptFiles,
    lockedOptionsCapture,
    lockedOptionsCaptureResult
  },
  protectedDirectories: {
    programFiles: protectedProgramFilesDir,
    programFilesResult: protectedProgramFilesResult,
    programFilesRemaining: protectedProgramFiles,
    windows: protectedWindowsDir,
    windowsResult: protectedWindowsResult,
    windowsRemaining: protectedWindowsFiles
  },
  uninstaller,
  uninstallResult,
  uninstallDiagnosticFailureResult,
  dataPolicy: {
    preservedDataDir,
    preservedDataSentinel,
    preservedDataStillExists,
    preservedLocalDataDir,
    preservedLocalDataSentinel,
    preservedLocalDataStillExists,
    clearedDataDir,
    clearedDataRemoved,
    clearedLocalDataDir,
    clearedLocalDataRemoved,
    externalProjectDir,
    externalProjectSentinel,
    externalProjectStillExists
  },
  diagnostics: {
    failureRollbackDir,
    diagnosticFailureResult,
    failureRollbackFiles,
    cancelledInstallDir,
    diagnosticCancelResult,
    cancelledInstallFiles,
    watchdogRollbackDir,
    watchdogRollbackResult,
    watchdogRollbackFiles
  },
  watchdogRecovery: {
    installerFirstAttemptTimeoutMs: 1,
    installerRecovered: installResult?.status === 0,
    uninstallerFirstAttemptTimeoutMs: 1,
    uninstallerRecovered: uninstallResult?.status === 0
  },
  shortcutOptOut: {
    installDir: noShortcutDir,
    installResult: noShortcutInstallResult,
    repairResult: noShortcutRepairResult,
    repairAttemptDir: noShortcutRepairAttemptDir,
    repairAttemptFiles: noShortcutRepairAttemptFiles,
    uninstallResult: noShortcutUninstallResult,
    shortcuts: shortcutsDuringNoShortcutInstall,
    shortcutsAfterRepair: shortcutsAfterNoShortcutRepair,
    remainingFiles: remainingNoShortcutFiles
  },
  shortcuts: {
    before: shortcutsBefore,
    afterInstall: shortcutsAfterInstall,
    afterUninstall: shortcutsAfterUninstall,
    desktopShortcutCreated,
    startMenuShortcutCreated,
    desktopShortcutRemoved,
    startMenuShortcutRemoved
  },
  processHygiene,
  remainingInstalledFiles,
  remainingNoShortcutFiles,
  failure
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok,
  reportPath,
  installer,
  installerBytes: report.installerBytes,
  installerSha256: report.installerSha256,
  installerSignature,
  installedSignature,
  desktopShortcutCreated,
  startMenuShortcutCreated,
  desktopShortcutRemoved,
  startMenuShortcutRemoved,
  preservedDataStillExists,
  preservedLocalDataStillExists,
  clearedDataRemoved,
  clearedLocalDataRemoved,
  externalProjectStillExists,
  remainingInstalledFileCount: remainingInstalledFiles.length,
  remainingNoShortcutFileCount: remainingNoShortcutFiles.length,
  failureRollbackFileCount: failureRollbackFiles.length,
  cancelledInstallFileCount: cancelledInstallFiles.length,
  watchdogRollbackFileCount: watchdogRollbackFiles.length,
  migrationAttemptFileCount: migrationAttemptFiles.length,
  noShortcutRepairAttemptFileCount: noShortcutRepairAttemptFiles.length,
  protectedProgramFilesFileCount: protectedProgramFiles.length,
  protectedWindowsFileCount: protectedWindowsFiles.length,
  installerOrphanProcessCount: processHygiene.orphanProcessesAfterForcedCleanup.length,
  installerForcedCleanupCount: processHygiene.forcedCleanupCount,
  installerOperationLockRemaining: processHygiene.operationLockRemaining,
  failure
}, null, 2));
if (!ok) process.exitCode = 1;
