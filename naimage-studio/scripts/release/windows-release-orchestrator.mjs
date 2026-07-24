import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRestartRuntimeBoundary } from "./restart-runtime-boundary.mjs";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = String(packageMetadata.version || "").trim();
const compatibility = String(packageMetadata.naimageUpdateCompatibility || "").trim();
const minimumVersion = String(packageMetadata.naimageUpdateMinimumVersion || version).trim();
const releaseDir = join(projectRoot, "release");
const releaseToolsDir = join(projectRoot, ".release-tools");
const releaseLockPath = join(releaseToolsDir, "windows-release.lock");
const incompleteMarkerPath = join(releaseDir, ".naimage-release-incomplete.json");
const publicKeyPath = join(projectRoot, "build", "update-public-key.pem");
const privateKeyPath = process.env.NAIMAGE_RELEASE_PRIVATE_KEY
  ? resolve(process.env.NAIMAGE_RELEASE_PRIVATE_KEY)
  : join(projectRoot, "config", "release-signing-private.pem");
const defaultBaselineRoot = join(
  projectRoot,
  ".diagnostics",
  "restart-update-e2e",
  "baseline-build",
  "win-unpacked"
);
const defaultLegacyBaselineExe = join(defaultBaselineRoot, "iiimage Studio.exe");
const defaultCanonicalBaselineExe = join(defaultBaselineRoot, "naimage.exe");
const defaultBaselineExe = version === "1.0.5" || existsSync(defaultLegacyBaselineExe)
  ? defaultLegacyBaselineExe
  : defaultCanonicalBaselineExe;
const defaultSettingsPath = join(projectRoot, "config", "app-settings.json");
const { canonicalDesktopRelease } = require(join(projectRoot, "update-release.cjs"));
const canonicalDesktopReleaseProduct = "naimage-studio";
let activeReleaseChild = null;

function resolvePnpmInvocation() {
  if (process.platform !== "win32") return { command: "pnpm", argsPrefix: [] };
  const candidates = [process.env.npm_execpath, process.env.PNPM_SCRIPT_SRC_DIR]
    .map((value) => String(value || "").trim())
    .filter((value) => value.endsWith("pnpm.cjs"));
  const located = spawnSync("where.exe", ["pnpm.cmd"], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 10_000
  });
  if (located.status === 0) {
    for (const wrapper of String(located.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      candidates.push(join(dirname(wrapper), "node_modules", "pnpm", "bin", "pnpm.cjs"));
    }
  }
  const cliPath = candidates.map((value) => resolve(value)).find((value) => existsSync(value));
  if (!cliPath) throw new Error("找不到可由 Node 直接执行的 pnpm.cjs；拒绝通过 shell 拼接正式发布命令。");
  return { command: process.execPath, argsPrefix: [cliPath] };
}

const pnpmInvocation = resolvePnpmInvocation();
const pnpmArgs = (...args) => [...pnpmInvocation.argsPrefix, ...args];

export const formalReleaseStepNames = Object.freeze([
  "release:verify",
  "package:win",
  "package:smoke",
  "package:installer-smoke",
  "test:update",
  "test:update-helper",
  "release:manifest",
  "package:update-e2e",
  "release:sha-verify"
]);

function valueArg(name, fallback = "") {
  const item = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return item ? item.split("=").slice(1).join("=") : fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isInside(candidate, root) {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseVersion(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? match.slice(1, 5).map((part) => Number(part || 0)) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function canonicalWindowsVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) return String(value || "").trim();
  return parsed[3] === 0
    ? parsed.slice(0, 3).join(".")
    : parsed.join(".");
}

export function resolveDesktopUpgradeContract({
  targetVersion,
  targetMinimumVersion,
  baselineVersion,
  baselineProductName
}) {
  const canonicalBaselineVersion = canonicalWindowsVersion(baselineVersion);
  const supportedProducts = new Set(["iiimage Studio", "naimage"]);
  if (!supportedProducts.has(String(baselineProductName || ""))) {
    throw new Error(`更新 E2E 基线产品无效：${baselineProductName || "unknown"}。`);
  }
  if (!parseVersion(targetVersion) || !parseVersion(targetMinimumVersion) || !parseVersion(canonicalBaselineVersion)) {
    throw new Error("更新 E2E 版本契约包含无效版本号。");
  }
  if (compareVersions(canonicalBaselineVersion, targetVersion) !== -1) {
    throw new Error(`更新 E2E 基线版本必须低于 ${targetVersion}，当前为 ${canonicalBaselineVersion}。`);
  }
  if (targetVersion === "1.0.5") {
    if (targetMinimumVersion !== "1.0.5") {
      throw new Error("naimage 1.0.5 必须将 minimum_version 固定为 1.0.5。");
    }
    if (canonicalBaselineVersion !== "1.0.4" || baselineProductName !== "iiimage Studio") {
      throw new Error("naimage 1.0.5 必须使用冻结的 iiimage Studio 1.0.4 作为升级基线。");
    }
  }
  const minimumComparison = compareVersions(canonicalBaselineVersion, targetMinimumVersion);
  return {
    baselineVersion: canonicalBaselineVersion,
    baselineProductName,
    targetVersion,
    minimumVersion: targetMinimumVersion,
    updateType: minimumComparison >= 0 ? "restart" : "installer",
    restartEligible: minimumComparison >= 0,
    requiresFullInstaller: minimumComparison < 0
  };
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    windowsHide: true,
    encoding: "utf8",
    timeout: options.timeout || 30_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error || `exit ${result.status}`).trim();
    throw new Error(`${basename(command)} ${args.join(" ")} failed: ${detail.slice(-4000)}`);
  }
  return String(result.stdout || "").trim();
}

function powershellJson(script, environment = {}) {
  const errors = [];
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    try {
      const output = runCapture(shell, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script
      ], { env: environment, timeout: 30_000 });
      return JSON.parse(output.replace(/^\uFEFF/, ""));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`PowerShell JSON probe failed: ${errors.join(" | ")}`);
}

function executableMetadata(filePath) {
  return powershellJson(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$item = Get-Item -LiteralPath $env:NAIMAGE_RELEASE_EXE
$version = $item.VersionInfo
$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
[ordered]@{
  fileVersion = [string]$version.FileVersion
  productVersion = [string]$version.ProductVersion
  productName = [string]$version.ProductName
  companyName = [string]$version.CompanyName
  signature = [string]$signature.Status
} | ConvertTo-Json -Compress
`, { NAIMAGE_RELEASE_EXE: filePath });
}

function assertWindowsExecutable(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`${label}不存在：${filePath}`);
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(2);
    readSync(descriptor, header, 0, 2, 0);
    if (header.toString("ascii") !== "MZ") throw new Error(`${label}不是有效的 Windows EXE：${filePath}`);
  } finally {
    closeSync(descriptor);
  }
}

function releaseArtifactPaths(root = releaseDir, targetVersion = version) {
  const installerName = `naimage-Setup-${targetVersion}-x64.exe`;
  const restartName = `naimage-Restart-Update-${targetVersion}-x64.asar`;
  return {
    installerName,
    restartName,
    installerPath: join(root, installerName),
    restartPath: join(root, restartName),
    manifestPath: join(root, "desktop-release.json"),
    sidecarPath: join(root, `${installerName}.json`),
    checksumPath: join(root, "SHA256SUMS.txt"),
    unpackedAsarPath: join(root, "win-unpacked", "resources", "app.asar")
  };
}

export function invalidateReleaseCompleteness(root = releaseDir, targetVersion = version, marker = {}) {
  mkdirSync(root, { recursive: true });
  const artifacts = releaseArtifactPaths(root, targetVersion);
  const markerPath = join(root, ".naimage-release-incomplete.json");
  writeFileSync(markerPath, `${JSON.stringify({
    product: "naimage-studio",
    version: targetVersion,
    incomplete: true,
    updatedAt: new Date().toISOString(),
    ...marker
  }, null, 2)}\n`, "utf8");
  for (const filePath of [
    artifacts.manifestPath,
    artifacts.sidecarPath,
    artifacts.checksumPath,
    artifacts.restartPath
  ]) {
    rmSync(filePath, { force: true });
  }
  // Never let output from the retired rename bridge survive a new build.
  rmSync(join(root, "desktop-release-legacy.json"), { force: true });
  return { markerPath, artifacts };
}

function ensureKeyPairMatches() {
  for (const [label, filePath] of [["发布签名私钥", privateKeyPath], ["客户端更新公钥", publicKeyPath]]) {
    if (!existsSync(filePath)) throw new Error(`${label}不存在：${filePath}`);
  }
  const privateKey = readFileSync(privateKeyPath);
  const publicKey = readFileSync(publicKeyPath);
  const probe = Buffer.from(`naimage-release-preflight:${version}:${compatibility}`, "utf8");
  const signature = sign(null, probe, privateKey);
  if (!verify(null, probe, publicKey, signature)) {
    throw new Error("发布签名私钥与客户端内置更新公钥不匹配。");
  }
  return {
    privateKeyConfigured: true,
    privateKeyProjectLocal: isInside(privateKeyPath, projectRoot),
    publicKeyPath: relative(projectRoot, publicKeyPath),
    signatureBytes: signature.length
  };
}

function ensureTool(command, args = ["--version"]) {
  return runCapture(command, args, { timeout: 30_000 }).split(/\r?\n/).filter(Boolean).at(-1) || "unknown";
}

function releaseMachineState() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`正式 Windows 发布只允许在 win32/x64 执行，当前为 ${process.platform}/${process.arch}。`);
  }
  return powershellJson(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$uninstallPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\887890c3-49de-5e86-9a32-28781d680b7f'
$installPath = 'HKCU:\\Software\\887890c3-49de-5e86-9a32-28781d680b7f'
$running = @(
  Get-Process -Name 'naimage' -ErrorAction SilentlyContinue
  Get-Process -Name 'iiimage Studio' -ErrorAction SilentlyContinue
)
[ordered]@{
  installed = (Test-Path -LiteralPath $uninstallPath) -or (Test-Path -LiteralPath $installPath)
  runningCount = $running.Count
} | ConvertTo-Json -Compress
`);
}

function resolveReleaseInputs() {
  return {
    baselineExe: resolve(valueArg(
      "--baseline-exe",
      process.env.NAIMAGE_RELEASE_BASELINE_EXE || defaultBaselineExe
    )),
    settingsPath: resolve(valueArg(
      "--settings",
      process.env.NAIMAGE_RELEASE_SETTINGS || defaultSettingsPath
    ))
  };
}

function verifyFormalInputs(inputs) {
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error(`无效版本号：${version}`);
  if (!compatibility) throw new Error("package.json 缺少 naimageUpdateCompatibility。");
  if (!parseVersion(minimumVersion)) throw new Error("package.json 缺少有效的 naimageUpdateMinimumVersion。");
  const requiredScripts = [
    "release:verify",
    "package:win",
    "package:smoke",
    "package:installer-smoke",
    "package:update-e2e",
    "test:update",
    "test:update-rollback",
    "test:update-helper",
    "release:manifest"
  ];
  for (const script of requiredScripts) {
    if (!packageMetadata.scripts?.[script]) throw new Error(`package.json 缺少发布步骤 ${script}。`);
  }
  for (const filePath of [
    join(scriptDir, "build-windows.mjs"),
    join(scriptDir, "create-update-release.mjs"),
    join(scriptDir, "restart-update-e2e.mjs"),
    join(scriptDir, "installer-smoke.mjs"),
    join(scriptDir, "packaged-smoke.mjs")
  ]) {
    if (!existsSync(filePath)) throw new Error(`发布脚本缺失：${filePath}`);
  }

  if (!isInside(inputs.baselineExe, projectRoot)) {
    throw new Error("更新 E2E 基线必须位于项目目录内，禁止修改用户真实安装目录。");
  }
  assertWindowsExecutable(inputs.baselineExe, "更新 E2E 上一版程序");
  const baselineRoot = dirname(inputs.baselineExe);
  for (const filePath of [
    join(baselineRoot, "resources", "app.asar"),
    join(baselineRoot, "resources", "update-helper.ps1"),
    join(baselineRoot, "resources", "update-launcher.ps1")
  ]) {
    if (!existsSync(filePath)) throw new Error(`更新 E2E 基线组件缺失：${filePath}`);
  }
  const baselineMetadata = executableMetadata(inputs.baselineExe);
  const baselineVersion = String(baselineMetadata.productVersion || baselineMetadata.fileVersion || "");
  const upgradeContract = resolveDesktopUpgradeContract({
    targetVersion: version,
    targetMinimumVersion: minimumVersion,
    baselineVersion,
    baselineProductName: String(baselineMetadata.productName || "")
  });

  if (!isInside(inputs.settingsPath, projectRoot)) {
    throw new Error("更新 E2E 设置夹具必须位于项目目录内，禁止读取用户真实配置目录。");
  }
  if (!existsSync(inputs.settingsPath)) throw new Error(`更新 E2E 设置夹具不存在：${inputs.settingsPath}`);
  const settings = JSON.parse(readFileSync(inputs.settingsPath, "utf8"));
  if (!String(settings.serverSessionCookie || "").trim() || !String(settings.serverUserId || "").trim()) {
    throw new Error("更新 E2E 设置夹具缺少隔离测试所需的登录会话；不会输出其内容。");
  }

  const machine = releaseMachineState();
  if (machine.installed || Number(machine.runningCount) > 0) {
    throw new Error("检测到已安装或正在运行的 naimage / iiimage Studio；正式安装 smoke 拒绝触碰现有用户环境。");
  }
  const fsInfo = statfsSync(projectRoot);
  const freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
  if (freeBytes < 8 * 1024 ** 3) throw new Error("可用磁盘空间不足 8 GB，无法安全执行完整发布门禁。");

  return {
    ok: true,
    baselineExe: inputs.baselineExe,
    baselineVersion,
    baselineProductName: String(baselineMetadata.productName || ""),
    upgradeContract,
    settingsPath: inputs.settingsPath,
    settingsCredentialValuesRedacted: true,
    machine,
    freeBytes,
    tools: {
      node: process.version,
      pnpm: ensureTool(pnpmInvocation.command, pnpmArgs("--version")),
      dotnet: ensureTool("dotnet")
    },
    keys: ensureKeyPairMatches()
  };
}

function gitOutput(args, encoding = null) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    windowsHide: true,
    encoding,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed.`);
  return result.stdout;
}

function sourceFingerprint() {
  const hash = createHash("sha256");
  const head = String(gitOutput(["rev-parse", "HEAD"], "utf8")).trim();
  hash.update(`head\0${head}\0`);
  hash.update(gitOutput(["diff", "--binary", "HEAD"]));
  const untracked = String(gitOutput(["ls-files", "--others", "--exclude-standard", "-z"], "utf8"))
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const item of untracked) {
    const filePath = join(projectRoot, item);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) continue;
    hash.update(`untracked\0${item}\0`);
    hash.update(readFileSync(filePath));
  }
  return { head, digest: hash.digest("hex"), untrackedCount: untracked.length };
}

function acquireReleaseLock() {
  mkdirSync(releaseToolsDir, { recursive: true });
  if (existsSync(releaseLockPath)) {
    let owner = null;
    try { owner = JSON.parse(readFileSync(releaseLockPath, "utf8")); } catch { }
    const pid = Number(owner?.pid || 0);
    if (pid > 0) {
      try {
        process.kill(pid, 0);
        throw new Error(`另一个正式发布编排仍在运行（PID ${pid}）。`);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(releaseLockPath, { force: true });
  }
  const descriptor = openSync(releaseLockPath, "wx");
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, version, startedAt: new Date().toISOString() }, null, 2)}\n`);
  return () => {
    try { closeSync(descriptor); } catch { }
    rmSync(releaseLockPath, { force: true });
  };
}

async function runStep(name, command, args, report) {
  const started = Date.now();
  const entry = { name, command, args, startedAt: new Date().toISOString(), status: "running" };
  report.steps.push(entry);
  process.stdout.write(`\n[naimage release] ${name}\n`);
  let exitCode = 1;
  let launchError = null;
  try {
    exitCode = await new Promise((resolveExit, rejectExit) => {
      const child = spawn(command, args, {
        cwd: projectRoot,
        windowsHide: true,
        stdio: "inherit",
        shell: false,
        env: { ...process.env }
      });
      activeReleaseChild = child;
      child.once("error", (error) => {
        if (activeReleaseChild === child) activeReleaseChild = null;
        rejectExit(error);
      });
      child.once("exit", (code) => {
        if (activeReleaseChild === child) activeReleaseChild = null;
        resolveExit(code ?? 1);
      });
    });
  } catch (error) {
    launchError = error;
  } finally {
    entry.finishedAt = new Date().toISOString();
    entry.durationMs = Date.now() - started;
  }
  if (launchError) {
    entry.exitCode = 1;
    entry.status = "failed";
    entry.error = launchError instanceof Error ? launchError.message : String(launchError);
    throw new Error(`${name} failed to start: ${entry.error}`);
  }
  entry.exitCode = exitCode;
  entry.status = exitCode === 0 ? "completed" : "failed";
  if (exitCode !== 0) throw new Error(`${name} failed with exit code ${exitCode}.`);
}

function terminateActiveReleaseChild() {
  const child = activeReleaseChild;
  activeReleaseChild = null;
  if (!child?.pid) return { attempted: false, pid: 0, exitCode: null };
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 15_000
    });
    return { attempted: true, pid: child.pid, exitCode: result.status ?? 1 };
  }
  const killed = child.kill("SIGTERM");
  return { attempted: true, pid: child.pid, exitCode: killed ? 0 : 1 };
}

function checksumEntries(checksumPath) {
  const entries = new Map();
  for (const line of readFileSync(checksumPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})  ([^\\/]+)$/);
    if (!match) throw new Error(`SHA256SUMS.txt 包含无效行：${line}`);
    if (entries.has(match[2])) throw new Error(`SHA256SUMS.txt 包含重复文件：${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

export function verifyReleaseArtifactsAt(root = releaseDir, targetVersion = version, options = {}) {
  const artifacts = releaseArtifactPaths(root, targetVersion);
  for (const [label, filePath] of [
    ["品牌安装包", artifacts.installerPath],
    ["重启更新 ASAR", artifacts.restartPath],
    ["签名发布清单", artifacts.manifestPath],
    ["安装包旁置元数据", artifacts.sidecarPath],
    ["SHA256 校验清单", artifacts.checksumPath],
    ["解包应用 ASAR", artifacts.unpackedAsarPath]
  ]) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`${label}不存在：${filePath}`);
  }

  const manifest = JSON.parse(readFileSync(artifacts.manifestPath, "utf8"));
  const sidecar = JSON.parse(readFileSync(artifacts.sidecarPath, "utf8"));
  const expectedCompatibility = options.compatibility || compatibility;
  const expectedMinimumVersion = options.minimumVersion || minimumVersion;
  if (
    manifest.schema_version !== 1 ||
    manifest.product !== canonicalDesktopReleaseProduct ||
    manifest.channel !== "stable" ||
    manifest.version !== targetVersion ||
    manifest.compatibility !== expectedCompatibility ||
    manifest.minimum_version !== expectedMinimumVersion
  ) {
    throw new Error("desktop-release.json 的产品或版本不匹配。");
  }
  const publicKey = options.publicKey || readFileSync(publicKeyPath);
  const signature = Buffer.from(String(manifest.signature || ""), "base64");
  if (!signature.length || !verify(
    null,
    Buffer.from(canonicalDesktopRelease(manifest), "utf8"),
    publicKey,
    signature
  )) throw new Error("desktop-release.json 最终签名验签失败。");

  const installerHash = sha256(artifacts.installerPath);
  const restartHash = sha256(artifacts.restartPath);
  const installerSize = statSync(artifacts.installerPath).size;
  const restartSize = statSync(artifacts.restartPath).size;
  if (
    manifest.installer?.filename !== artifacts.installerName ||
    manifest.installer?.sha256 !== installerHash ||
    Number(manifest.installer?.size) !== installerSize
  ) throw new Error("签名清单中的安装包信息与最终文件不一致。");
  if (
    manifest.restart?.filename !== artifacts.restartName ||
    manifest.restart?.sha256 !== restartHash ||
    Number(manifest.restart?.size) !== restartSize
  ) throw new Error("签名清单中的 Restart ASAR 信息与最终文件不一致。");
  if (
    sidecar.filename !== artifacts.installerName ||
    sidecar.version !== targetVersion ||
    sidecar.platform !== "windows" ||
    sidecar.architecture !== "x64" ||
    sidecar.sha256 !== installerHash ||
    Number(sidecar.size) !== installerSize
  ) throw new Error("安装包旁置元数据与最终文件不一致。");
  if (sha256(artifacts.unpackedAsarPath) !== restartHash) {
    throw new Error("Restart ASAR 与本轮 win-unpacked/app.asar 不一致。");
  }

  const expectedChecksums = new Map([
    [artifacts.installerName, installerHash],
    [artifacts.restartName, restartHash],
    [basename(artifacts.manifestPath), sha256(artifacts.manifestPath)],
    [basename(artifacts.sidecarPath), sha256(artifacts.sidecarPath)]
  ]);
  const actualChecksums = checksumEntries(artifacts.checksumPath);
  if (actualChecksums.size !== expectedChecksums.size) throw new Error("SHA256SUMS.txt 文件数量不正确。");
  for (const [name, expectedHash] of expectedChecksums) {
    if (actualChecksums.get(name) !== expectedHash) throw new Error(`SHA256SUMS.txt 校验失败：${name}`);
  }

  let metadata = null;
  if (!options.skipExecutableMetadata) {
    assertWindowsExecutable(artifacts.installerPath, "品牌安装包");
    metadata = executableMetadata(artifacts.installerPath);
    if (
      metadata.productVersion !== targetVersion ||
      metadata.productName !== "naimage" ||
      metadata.companyName !== "SparkAI" ||
      String(metadata.productVersion).includes("+")
    ) throw new Error("品牌安装包 Windows 元数据不符合发布规范。");
    if (!new Set(["Valid", "NotSigned"]).has(String(metadata.signature || ""))) {
      throw new Error(`品牌安装包 Authenticode 状态异常：${metadata.signature || "unknown"}`);
    }
  }

  return {
    ok: true,
    version: targetVersion,
    installer: { filename: artifacts.installerName, size: installerSize, sha256: installerHash },
    restart: { filename: artifacts.restartName, size: restartSize, sha256: restartHash },
    manifestSha256: sha256(artifacts.manifestPath),
    sidecarSha256: sha256(artifacts.sidecarPath),
    checksumEntries: actualChecksums.size,
    signatureVerified: true,
    metadata
  };
}

async function copyBaselineFixture(sourceExe, runDir) {
  const destinationRoot = join(runDir, "baseline-runtime");
  rmSync(destinationRoot, { recursive: true, force: true });
  cpSync(dirname(sourceExe), destinationRoot, { recursive: true, force: true, errorOnExist: false });
  const copiedExe = join(destinationRoot, basename(sourceExe));
  assertWindowsExecutable(copiedExe, "隔离更新 E2E 基线");
  return copiedExe;
}

async function runFormalRelease() {
  const inputs = resolveReleaseInputs();
  const runDir = join(projectRoot, ".diagnostics", "release", `final-release-${timestamp()}`);
  mkdirSync(runDir, { recursive: true });
  const reportPath = join(runDir, "orchestrator-report.json");
  const report = {
    ok: false,
    version,
    minimumVersion,
    compatibility,
    generatedAt: new Date().toISOString(),
    runDir,
    reportPath,
    steps: [],
    formalInputs: null,
    sourceBefore: null,
    sourceAfter: null,
    artifacts: null,
    failure: ""
  };
  const releaseAttemptId = `${Date.now()}-${process.pid}`;
  process.env.NAIMAGE_RELEASE_BASELINE_EXE = inputs.baselineExe;
  process.env.NAIMAGE_RELEASE_SETTINGS = inputs.settingsPath;
  const releaseLock = acquireReleaseLock();
  let finalizing = false;

  const markIncomplete = (reason) => invalidateReleaseCompleteness(releaseDir, version, {
    attemptId: releaseAttemptId,
    reason,
    reportPath
  });
  const onSignal = (signal) => {
    if (finalizing) return;
    finalizing = true;
    try { markIncomplete(`interrupted:${signal}`); } catch { }
    const interruptedStep = [...report.steps].reverse().find((step) => step.status === "running");
    if (interruptedStep) {
      interruptedStep.status = "interrupted";
      interruptedStep.finishedAt = new Date().toISOString();
      interruptedStep.exitCode = signal === "SIGINT" ? 130 : 143;
    }
    report.childTermination = terminateActiveReleaseChild();
    try { markIncomplete(`interrupted:${signal}:child-stopped`); } catch { }
    try { writeFileSync(reportPath, `${JSON.stringify({ ...report, failure: `interrupted:${signal}` }, null, 2)}\n`, "utf8"); } catch { }
    releaseLock();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    markIncomplete("formal-release-started");
    report.sourceBefore = sourceFingerprint();
    report.formalInputs = verifyFormalInputs(inputs);
    await runStep("release:verify", pnpmInvocation.command, pnpmArgs("run", "release:verify"), report);
    await runStep("package:win", pnpmInvocation.command, pnpmArgs("run", "package:win"), report);
    report.restartRuntimeBoundary = report.formalInputs.upgradeContract.restartEligible
      ? verifyRestartRuntimeBoundary({
        baselineRoot: dirname(inputs.baselineExe),
        candidateRoot: join(releaseDir, "win-unpacked"),
        expectedCompatibility: compatibility
      })
      : {
        ok: true,
        skipped: true,
        reason: "baseline-below-minimum-version-requires-full-installer"
      };
    await runStep("package:smoke", pnpmInvocation.command, pnpmArgs("run", "package:smoke"), report);
    await runStep("package:installer-smoke", pnpmInvocation.command, pnpmArgs("run", "package:installer-smoke"), report);
    await runStep("test:update", pnpmInvocation.command, pnpmArgs("run", "test:update"), report);
    await runStep("test:update-helper", pnpmInvocation.command, pnpmArgs("run", "test:update-helper"), report);
    await runStep("release:manifest", pnpmInvocation.command, pnpmArgs("run", "release:manifest"), report);

    const artifacts = releaseArtifactPaths();
    if (report.formalInputs.upgradeContract.restartEligible) {
      const isolatedBaselineExe = await copyBaselineFixture(inputs.baselineExe, runDir);
      await runStep("package:update-e2e", pnpmInvocation.command, pnpmArgs(
        "run",
        "package:update-e2e",
        "--",
        `--exe=${isolatedBaselineExe}`,
        `--settings=${inputs.settingsPath}`,
        `--expected-asar=${artifacts.restartPath}`,
        `--seed-pending=${artifacts.restartPath}`
      ), report);
    } else {
      const now = new Date().toISOString();
      report.steps.push({
        name: "package:update-e2e",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        status: "skipped",
        exitCode: 0,
        reason: "full-installer-required-by-minimum-version"
      });
    }

    const shaStarted = Date.now();
    const shaStep = { name: "release:sha-verify", startedAt: new Date().toISOString(), status: "running" };
    report.steps.push(shaStep);
    try {
      report.artifacts = verifyReleaseArtifactsAt();
      shaStep.status = "completed";
      shaStep.exitCode = 0;
    } catch (error) {
      shaStep.status = "failed";
      shaStep.exitCode = 1;
      throw error;
    } finally {
      shaStep.finishedAt = new Date().toISOString();
      shaStep.durationMs = Date.now() - shaStarted;
    }

    report.sourceAfter = sourceFingerprint();
    if (report.sourceAfter.digest !== report.sourceBefore.digest) {
      throw new Error("正式发布期间源工作树发生变化，所有产物已作废；请冻结代码后重新执行。");
    }

    rmSync(incompleteMarkerPath, { force: true });
    report.ok = true;
    report.completedAt = new Date().toISOString();
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, reportPath, artifacts: report.artifacts }, null, 2));
  } catch (error) {
    report.failure = error instanceof Error ? error.stack || error.message : String(error);
    report.failedAt = new Date().toISOString();
    try {
      markIncomplete("formal-release-failed");
    } catch (invalidationError) {
      report.invalidationFailure = invalidationError instanceof Error
        ? invalidationError.message
        : String(invalidationError);
    }
    try {
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (reportError) {
      console.error(`发布失败报告写入失败：${reportError instanceof Error ? reportError.message : String(reportError)}`);
    }
    console.error(report.failure);
    console.error(`发布失败，release 保持不可发布状态：${incompleteMarkerPath}`);
    process.exitCode = 1;
  } finally {
    finalizing = true;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    releaseLock();
  }
}

function writeChecksumFixture(root, names) {
  writeFileSync(join(root, "SHA256SUMS.txt"), `${names
    .map((name) => `${sha256(join(root, name))}  ${name}`)
    .join("\n")}\n`, "utf8");
}

function createArtifactFixture(root, targetVersion, pair) {
  mkdirSync(join(root, "win-unpacked", "resources"), { recursive: true });
  const artifacts = releaseArtifactPaths(root, targetVersion);
  writeFileSync(artifacts.installerPath, Buffer.from("MZ-fixture-setup", "utf8"));
  writeFileSync(artifacts.unpackedAsarPath, Buffer.from("fixture-asar", "utf8"));
  cpSync(artifacts.unpackedAsarPath, artifacts.restartPath);
  const manifest = {
    schema_version: 1,
    product: "naimage-studio",
    channel: "stable",
    version: targetVersion,
    published_at: "2026-07-20T00:00:00.000Z",
    minimum_version: minimumVersion,
    compatibility,
    notes: ["orchestrator selftest"],
    restart: {
      filename: artifacts.restartName,
      sha256: sha256(artifacts.restartPath),
      size: statSync(artifacts.restartPath).size
    },
    installer: {
      filename: artifacts.installerName,
      sha256: sha256(artifacts.installerPath),
      size: statSync(artifacts.installerPath).size
    }
  };
  manifest.signature = sign(
    null,
    Buffer.from(canonicalDesktopRelease(manifest), "utf8"),
    pair.privateKey
  ).toString("base64");
  writeFileSync(artifacts.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.sidecarPath, `${JSON.stringify({
    filename: artifacts.installerName,
    version: targetVersion,
    platform: "windows",
    architecture: "x64",
    size: manifest.installer.size,
    sha256: manifest.installer.sha256
  }, null, 2)}\n`, "utf8");
  writeChecksumFixture(root, [
    artifacts.installerName,
    artifacts.restartName,
    basename(artifacts.manifestPath),
    basename(artifacts.sidecarPath)
  ]);
  return artifacts;
}

function runSelftest() {
  const root = mkdtempSync(join(projectRoot, ".diagnostics", "release", "orchestrator-selftest-"));
  const fixtureRelease = join(root, "release");
  mkdirSync(fixtureRelease, { recursive: true });
  const pair = generateKeyPairSync("ed25519");
  const targetVersion = "9.9.9";
  const legacyUpgradeContract = resolveDesktopUpgradeContract({
    targetVersion: "1.0.5",
    targetMinimumVersion: "1.0.5",
    baselineVersion: "1.0.4.0",
    baselineProductName: "iiimage Studio"
  });
  if (legacyUpgradeContract.updateType !== "installer" || !legacyUpgradeContract.requiresFullInstaller) {
    throw new Error("1.0.4 -> 1.0.5 must require the full installer.");
  }
  const canonicalRestartContract = resolveDesktopUpgradeContract({
    targetVersion: "1.0.6",
    targetMinimumVersion: "1.0.5",
    baselineVersion: "1.0.5",
    baselineProductName: "naimage"
  });
  if (canonicalRestartContract.updateType !== "restart" || !canonicalRestartContract.restartEligible) {
    throw new Error("A compatible naimage baseline should remain restart-update eligible.");
  }
  let wrongFirstUpgradeBaselineRejected = false;
  try {
    resolveDesktopUpgradeContract({
      targetVersion: "1.0.5",
      targetMinimumVersion: "1.0.5",
      baselineVersion: "1.0.4",
      baselineProductName: "naimage"
    });
  } catch {
    wrongFirstUpgradeBaselineRejected = true;
  }
  if (!wrongFirstUpgradeBaselineRejected) {
    throw new Error("1.0.5 release gate accepted a non-legacy baseline.");
  }
  let artifacts = createArtifactFixture(fixtureRelease, targetVersion, pair);
  const verified = verifyReleaseArtifactsAt(fixtureRelease, targetVersion, {
    publicKey: pair.publicKey,
    skipExecutableMetadata: true
  });
  invalidateReleaseCompleteness(fixtureRelease, targetVersion, { reason: "selftest" });
  const invalidationOk =
    existsSync(join(fixtureRelease, ".naimage-release-incomplete.json")) &&
    existsSync(artifacts.installerPath) &&
    !existsSync(artifacts.manifestPath) &&
    !existsSync(join(fixtureRelease, "desktop-release-legacy.json")) &&
    !existsSync(artifacts.sidecarPath) &&
    !existsSync(artifacts.restartPath) &&
    !existsSync(artifacts.checksumPath);
  if (!invalidationOk) throw new Error("Release invalidation selftest failed.");

  rmSync(fixtureRelease, { recursive: true, force: true });
  mkdirSync(fixtureRelease, { recursive: true });
  artifacts = createArtifactFixture(fixtureRelease, targetVersion, pair);
  writeFileSync(artifacts.restartPath, Buffer.from("tampered-asar", "utf8"));
  let tamperRejected = false;
  try {
    verifyReleaseArtifactsAt(fixtureRelease, targetVersion, {
      publicKey: pair.publicKey,
      skipExecutableMetadata: true
    });
  } catch {
    tamperRejected = true;
  }
  if (!tamperRejected) throw new Error("Release checksum tamper selftest failed.");

  rmSync(fixtureRelease, { recursive: true, force: true });
  mkdirSync(fixtureRelease, { recursive: true });
  artifacts = createArtifactFixture(fixtureRelease, targetVersion, pair);
  const wrongProductManifest = JSON.parse(readFileSync(artifacts.manifestPath, "utf8"));
  wrongProductManifest.product = "other-studio";
  wrongProductManifest.signature = sign(
    null,
    Buffer.from(canonicalDesktopRelease(wrongProductManifest), "utf8"),
    pair.privateKey
  ).toString("base64");
  writeFileSync(artifacts.manifestPath, `${JSON.stringify(wrongProductManifest, null, 2)}\n`, "utf8");
  writeChecksumFixture(fixtureRelease, [
    artifacts.installerName,
    artifacts.restartName,
    basename(artifacts.manifestPath),
    basename(artifacts.sidecarPath)
  ]);
  let wrongProductRejected = false;
  try {
    verifyReleaseArtifactsAt(fixtureRelease, targetVersion, {
      publicKey: pair.publicKey,
      skipExecutableMetadata: true
    });
  } catch {
    wrongProductRejected = true;
  }
  if (!wrongProductRejected) throw new Error("Non-naimage release product selftest failed.");
  const expectedOrder = [
    "release:verify",
    "package:win",
    "package:smoke",
    "package:installer-smoke",
    "test:update",
    "test:update-helper",
    "release:manifest",
    "package:update-e2e",
    "release:sha-verify"
  ];
  if (formalReleaseStepNames.join("|") !== expectedOrder.join("|")) {
    throw new Error("Formal release step order changed unexpectedly.");
  }

  const report = {
    ok: true,
    root,
    verified,
    invalidationOk,
    tamperRejected,
    wrongProductRejected,
    legacyUpgradeContract,
    canonicalRestartContract,
    wrongFirstUpgradeBaselineRejected,
    formalReleaseStepNames
  };
  writeFileSync(join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

function printPlan() {
  console.log(JSON.stringify({
    ok: true,
    canonicalCommand: "pnpm run release:final",
    version,
    steps: formalReleaseStepNames,
    note: "只有最终 SHA/签名验证通过才移除 incomplete marker。"
  }, null, 2));
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  if (process.argv.includes("--selftest")) runSelftest();
  else if (process.argv.includes("--print-plan")) printPlan();
  else await runFormalRelease();
}
