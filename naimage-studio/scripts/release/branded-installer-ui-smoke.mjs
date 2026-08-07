import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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
if (!accessPolicy) throw new Error(`Built access policy is required for installer UI smoke: ${accessPolicyPath}`);
const installerArg = process.argv.find((item) => item.startsWith("--installer="));
const uninstallerArg = process.argv.find((item) => item.startsWith("--uninstaller="));
const installer = resolve(
  installerArg?.split("=").slice(1).join("=") ||
  join(projectRoot, "release", windowsInstallerArtifactName(version, accessPolicy.variant))
);
const uninstaller = resolve(
  uninstallerArg?.split("=").slice(1).join("=") ||
  join(projectRoot, ".release-tools", "brand-uninstaller", "SparkAI WorkSpace Uninstaller.exe")
);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join(projectRoot, ".diagnostics", "release", `branded-installer-ui-${stamp}`);
const reportPath = join(outputDir, "report.json");
const smokeEnvironment = { ...process.env, NAIMAGE_INSTALLER_DIAGNOSTIC_IGNORE_MACHINE: "1" };
const designWidth = 920;
const designHeight = 620;
const workAreaMargin = 32;

for (const [label, path] of [["installer", installer], ["uninstaller", uninstaller]]) {
  if (!existsSync(path)) throw new Error(`Branded ${label} not found: ${path}`);
}
mkdirSync(outputDir, { recursive: true });

const accessibilityProbePath = join(outputDir, "toggle-automation.json");
const accessibilityRun = spawnSync(installer, [`--toggle-automation-probe=${accessibilityProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (accessibilityRun.status !== 0 || !existsSync(accessibilityProbePath)) {
  throw new Error(`Toggle automation probe failed: exit=${accessibilityRun.status}`);
}
const accessibility = JSON.parse(readFileSync(accessibilityProbePath, "utf8").replace(/^\uFEFF/, ""));
if (
  !accessibility.ok ||
  !accessibility.isTabStop ||
  !accessibility.focusable ||
  !accessibility.togglePattern ||
  !accessibility.buttonLabelsSynchronized ||
  !accessibility.primaryIsDefault ||
  !accessibility.secondaryIsCancel ||
  accessibility.closeAutomationName !== "关闭窗口" ||
  !accessibility.disabledButtonVisuallyDistinct ||
  !accessibility.metadataClean ||
  String(accessibility.productVersion || "").includes("+")
) {
  throw new Error("Installer controls do not satisfy the keyboard/Automation contract.");
}

const completionAutoCloseProbePath = join(outputDir, "completion-auto-close.json");
const completionAutoCloseRun = spawnSync(installer, [`--completion-auto-close-probe=${completionAutoCloseProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (completionAutoCloseRun.status !== 0 || !existsSync(completionAutoCloseProbePath)) {
  throw new Error(`Installer completion auto-close probe failed: exit=${completionAutoCloseRun.status}`);
}
const completionAutoClose = JSON.parse(readFileSync(completionAutoCloseProbePath, "utf8").replace(/^\uFEFF/, ""));
if (
  !completionAutoClose.ok ||
  !completionAutoClose.completionShown ||
  !completionAutoClose.windowClosed ||
  completionAutoClose.completionElapsedMs < 40 ||
  completionAutoClose.completionElapsedMs >= 1000
) {
  throw new Error(`Installer completion window did not close automatically: ${JSON.stringify(completionAutoClose)}`);
}

const watchdogProbePath = join(outputDir, "process-watchdog.json");
const watchdogRun = spawnSync(installer, [`--watchdog-probe=${watchdogProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (watchdogRun.status !== 0 || !existsSync(watchdogProbePath)) {
  throw new Error(`Process watchdog probe failed: exit=${watchdogRun.status}`);
}
const watchdog = JSON.parse(readFileSync(watchdogProbePath, "utf8").replace(/^\uFEFF/, ""));
if (!watchdog.ok || !watchdog.timedOut || !watchdog.processTerminated || !watchdog.recoveryCompleted) {
  throw new Error("Installer process watchdog did not terminate and recover from a stalled process.");
}

const operationLockProbePath = join(outputDir, "operation-lock.json");
const operationLockRun = spawnSync(installer, [`--operation-lock-probe=${operationLockProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (operationLockRun.status !== 0 || !existsSync(operationLockProbePath)) {
  throw new Error(`Installer operation-lock probe failed: exit=${operationLockRun.status}`);
}
const operationLock = JSON.parse(readFileSync(operationLockProbePath, "utf8").replace(/^\uFEFF/, ""));
if (!operationLock.ok || !operationLock.firstAcquired || !operationLock.concurrentRejected || !operationLock.reacquiredAfterRelease) {
  throw new Error("Installer operation lock does not reject concurrent install/uninstall work and recover after release.");
}

const versionPolicyProbePath = join(outputDir, "version-policy.json");
const versionPolicyRun = spawnSync(installer, [`--version-policy-probe=${versionPolicyProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (versionPolicyRun.status !== 0 || !existsSync(versionPolicyProbePath)) {
  throw new Error(`Installer version-policy probe failed: exit=${versionPolicyRun.status}`);
}
const versionPolicy = JSON.parse(readFileSync(versionPolicyProbePath, "utf8").replace(/^\uFEFF/, ""));
if (!versionPolicy.ok || !versionPolicy.newerBlocked || !versionPolicy.sameAllowed || !versionPolicy.upgradeAllowed) {
  throw new Error("Installer version policy does not safely distinguish downgrade, repair, and upgrade.");
}

const dataPolicyProbePath = join(outputDir, "uninstaller-data-policy.json");
const dataPolicyRun = spawnSync(uninstaller, [`--data-policy-probe=${dataPolicyProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (dataPolicyRun.status !== 0 || !existsSync(dataPolicyProbePath)) {
  throw new Error(`Uninstaller data-policy probe failed: exit=${dataPolicyRun.status}`);
}
const dataPolicy = JSON.parse(readFileSync(dataPolicyProbePath, "utf8").replace(/^\uFEFF/, ""));
if (
  !dataPolicy.ok ||
  !dataPolicy.backRestoresPreserve ||
  !dataPolicy.closeHelpMatchesWindow ||
  !dataPolicy.metadataClean ||
  String(dataPolicy.productVersion || "").includes("+")
) {
  throw new Error("Uninstaller data policy or window-specific accessibility text is incorrect.");
}

const folderPickerProbePath = join(outputDir, "folder-picker.json");
const folderPickerRun = spawnSync(installer, [`--folder-picker-probe=${folderPickerProbePath}`], {
  cwd: projectRoot,
  windowsHide: true,
  encoding: "utf8",
  timeout: 30_000,
  env: smokeEnvironment
});
if (folderPickerRun.status !== 0 || !existsSync(folderPickerProbePath)) {
  throw new Error(`Modern folder picker probe failed: exit=${folderPickerRun.status}`);
}
const folderPicker = JSON.parse(readFileSync(folderPickerProbePath, "utf8").replace(/^\uFEFF/, ""));
if (!folderPicker.ok || !folderPicker.modernExplorerDialog || folderPicker.legacyFolderBrowserDialog) {
  throw new Error(`Folder picker is not using the modern Explorer dialog: ${folderPicker.error || "unknown"}`);
}

const captures = [
  { app: installer, name: "setup-welcome-100", page: "welcome", scale: 1 },
  { app: installer, name: "setup-welcome-125", page: "welcome", scale: 1.25 },
  { app: installer, name: "setup-welcome-150", page: "welcome", scale: 1.5 },
  { app: installer, name: "setup-welcome-200", page: "welcome", scale: 2 },
  { app: installer, name: "setup-1366x768-125", page: "welcome", scale: 1.25, physicalWorkArea: [1366, 768] },
  { app: installer, name: "setup-1366x768-150", page: "welcome", scale: 1.5, physicalWorkArea: [1366, 768] },
  { app: installer, name: "setup-1366x768-200", page: "welcome", scale: 2, physicalWorkArea: [1366, 768] },
  { app: installer, name: "setup-options-150", page: "options", scale: 1.5 },
  { app: installer, name: "setup-progress-150", page: "progress", scale: 1.5 },
  { app: installer, name: "setup-complete-150", page: "complete", scale: 1.5 },
  { app: installer, name: "setup-error-150", page: "error", scale: 1.5 },
  { app: uninstaller, name: "uninstall-confirm-100", page: "confirm", scale: 1 },
  { app: uninstaller, name: "uninstall-confirm-150", page: "confirm", scale: 1.5 },
  { app: uninstaller, name: "uninstall-confirm-1366x768-200", page: "confirm", scale: 2, physicalWorkArea: [1366, 768] },
  { app: uninstaller, name: "uninstall-data-confirm-150", page: "data-confirm", scale: 1.5 },
  { app: uninstaller, name: "uninstall-data-confirm-1366x768-200", page: "data-confirm", scale: 2, physicalWorkArea: [1366, 768] },
  { app: uninstaller, name: "uninstall-progress-150", page: "progress", scale: 1.5 },
  { app: uninstaller, name: "uninstall-complete-150", page: "complete", scale: 1.5 },
  { app: uninstaller, name: "uninstall-error-150", page: "error", scale: 1.5 }
];

const results = [];
for (const capture of captures) {
  const destination = join(outputDir, `${capture.name}.png`);
  const logicalWorkArea = capture.physicalWorkArea
    ? capture.physicalWorkArea.map((dimension) => dimension / capture.scale)
    : null;
  const environment = logicalWorkArea
    ? { ...smokeEnvironment, NAIMAGE_INSTALLER_DIAGNOSTIC_WORKAREA: `${logicalWorkArea[0]}x${logicalWorkArea[1]}` }
    : smokeEnvironment;
  const run = spawnSync(capture.app, [
    `--capture=${destination}`,
    `--capture-page=${capture.page}`,
    `--capture-scale=${capture.scale}`
  ], {
    cwd: projectRoot,
    windowsHide: true,
    encoding: "utf8",
    timeout: 45_000,
    env: environment
  });
  if (run.status !== 0 || !existsSync(destination)) {
    throw new Error(`${capture.name} failed: exit=${run.status}; ${String(run.stderr || "").slice(-2000)}`);
  }
  const image = sharp(destination);
  const metadata = await image.metadata();
  const stats = await image.stats();
  const raw = await sharp(destination).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fittedScale = logicalWorkArea
    ? Math.max(0.5, Math.min(
      1,
      Math.max(designWidth * 0.5, logicalWorkArea[0] - workAreaMargin) / designWidth,
      Math.max(designHeight * 0.5, logicalWorkArea[1] - workAreaMargin) / designHeight
    ))
    : 1;
  const logicalWidth = Math.floor(designWidth * fittedScale);
  const logicalHeight = Math.floor(designHeight * fittedScale);
  const expectedWidth = Math.ceil(logicalWidth * capture.scale);
  const expectedHeight = Math.ceil(logicalHeight * capture.scale);
  const visuallyNonEmpty = stats.channels.slice(0, 3).some(channel => channel.stdev > 18);
  const cornerOffset = Math.max(1, Math.ceil(capture.scale));
  const cornerAlpha = [
    [cornerOffset, cornerOffset],
    [raw.info.width - 1 - cornerOffset, cornerOffset],
    [cornerOffset, raw.info.height - 1 - cornerOffset],
    [raw.info.width - 1 - cornerOffset, raw.info.height - 1 - cornerOffset]
  ].map(([x, y]) => raw.data[(y * raw.info.width + x) * raw.info.channels + 3]);
  const cornerClippingOk = cornerAlpha.every(alpha => alpha < 220);
  results.push({
    ...capture,
    app: capture.app,
    destination,
    bytes: statSync(destination).size,
    width: metadata.width,
    height: metadata.height,
    expectedWidth,
    expectedHeight,
    logicalWorkArea,
    fittedScale,
    visuallyNonEmpty,
    cornerAlpha,
    cornerClippingOk,
    ok: metadata.width === expectedWidth && metadata.height === expectedHeight && visuallyNonEmpty && cornerClippingOk
  });
}

const ok = results.every(result => result.ok);
writeFileSync(reportPath, `${JSON.stringify({
  ok,
  generatedAt: new Date().toISOString(),
  version,
  installer,
  uninstaller,
  accessibility,
  accessibilityProbePath,
  completionAutoClose,
  completionAutoCloseProbePath,
  watchdog,
  watchdogProbePath,
  operationLock,
  operationLockProbePath,
  versionPolicy,
  versionPolicyProbePath,
  dataPolicy,
  dataPolicyProbePath,
  folderPicker,
  folderPickerProbePath,
  results
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok, reportPath, captureCount: results.length, outputDir }, null, 2));
if (!ok) process.exitCode = 1;
