const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const serverRoot = __dirname;
const repoRoot = path.resolve(serverRoot, "..", "..");
const newApiRoot = path.join(serverRoot, "new-api");
const dataDir = process.env.AI_GATEWAY_DATA_DIR || process.env.NAIMAGE_SERVER_DATA_DIR || path.join(serverRoot, "config", "new-api");
const port = String(process.env.NAIMAGE_SERVER_PORT || process.env.PORT || "17860");
const parentPid = Number(process.env.NAIMAGE_PARENT_PID || 0);
const isSmoke = process.argv.includes("--smoke");
const isBuildOnly = process.argv.includes("--build-only");
const externalFrontendDevServer = process.env.AI_GATEWAY_FRONTEND_DEV_SERVER === "true";
const binaryPath = path.join(newApiRoot, "bin", process.platform === "win32" ? "naimage-new-api.exe" : "naimage-new-api");
const defaultDistIndex = path.join(newApiRoot, "web", "default", "dist", "index.html");
const defaultWebRoot = path.join(newApiRoot, "web", "default");
const defaultWebBuildCache = path.join(defaultWebRoot, "node_modules", ".cache");
const vendorModules = path.join(newApiRoot, "vendor", "modules.txt");
const webNodeModules = path.join(newApiRoot, "web", "node_modules");
const logDir = path.join(serverRoot, ".diagnostics", "new-api");
const latestLog = path.join(logDir, "latest.log");
const skippedStaleCheckDirs = new Set([
  ".git",
  ".diagnostics",
  "bin",
  "data",
  "dist",
  "logs",
  "node_modules",
  "upload",
  "vendor"
]);

function log(message) {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(latestLog, `[${new Date().toISOString()}] ${message}\n`, { flag: "a", encoding: "utf8" });
  console.log(message);
}

function runChecked(command, args, options = {}) {
  log(`run ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || newApiRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function newestMtimeMs(entryPath) {
  if (!existsSync(entryPath)) return 0;

  const stat = statSync(entryPath);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of readdirSync(entryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedStaleCheckDirs.has(entry.name)) continue;
    newest = Math.max(newest, newestMtimeMs(path.join(entryPath, entry.name)));
  }
  return newest;
}

function isStale(targetPath, sourcePaths) {
  if (!existsSync(targetPath)) return true;
  const targetMtime = statSync(targetPath).mtimeMs;
  return sourcePaths.some((sourcePath) => newestMtimeMs(sourcePath) > targetMtime);
}

function shouldBuildFrontendDist(targetPath, sourcePaths, options = {}) {
  if (options.externalFrontendDevServer && existsSync(targetPath)) return false;
  return isStale(targetPath, sourcePaths);
}

function frontendSourcePaths() {
  return [
    path.join(defaultWebRoot, "src"),
    path.join(defaultWebRoot, "public"),
    path.join(defaultWebRoot, "index.html"),
    path.join(defaultWebRoot, "package.json"),
    path.join(defaultWebRoot, "postcss.config.mjs"),
    path.join(defaultWebRoot, "rsbuild.config.ts"),
    path.join(defaultWebRoot, "tsconfig.json"),
    path.join(defaultWebRoot, "tsconfig.app.json"),
    path.join(defaultWebRoot, "tsconfig.node.json"),
    path.join(newApiRoot, "web", "bun.lock")
  ];
}

function binarySourcePaths() {
  return [
    defaultDistIndex,
    path.join(newApiRoot, "common"),
    path.join(newApiRoot, "constant"),
    path.join(newApiRoot, "controller"),
    path.join(newApiRoot, "dto"),
    path.join(newApiRoot, "i18n"),
    path.join(newApiRoot, "middleware"),
    path.join(newApiRoot, "model"),
    path.join(newApiRoot, "oauth"),
    path.join(newApiRoot, "pkg"),
    path.join(newApiRoot, "relay"),
    path.join(newApiRoot, "router"),
    path.join(newApiRoot, "service"),
    path.join(newApiRoot, "types"),
    path.join(newApiRoot, "go.mod"),
    path.join(newApiRoot, "go.sum"),
    path.join(newApiRoot, "main.go")
  ];
}

function assertNewApiLayout() {
  const required = [path.join(newApiRoot, "main.go"), path.join(newApiRoot, "go.mod"), path.join(newApiRoot, "web", "package.json")];
  const missing = required.filter((item) => !existsSync(item));
  if (missing.length) {
    throw new Error(`内置 New API 源码不完整：${missing.join(", ")}`);
  }
}

function ensureFrontendDist(options = {}) {
  if (!shouldBuildFrontendDist(defaultDistIndex, frontendSourcePaths(), options)) return false;
  runChecked("bun", ["install", "--frozen-lockfile", "--linker", "isolated"], { cwd: path.join(newApiRoot, "web") });
  rmSync(defaultWebBuildCache, { recursive: true, force: true });
  runChecked("bun", ["run", "build"], { cwd: path.join(newApiRoot, "web", "default"), env: { DISABLE_ESLINT_PLUGIN: "true" } });
  return true;
}

function ensureGoVendor() {
  if (!isStale(vendorModules, [path.join(newApiRoot, "go.mod"), path.join(newApiRoot, "go.sum")])) return false;
  runChecked("go", ["mod", "vendor"], { cwd: newApiRoot });
  return true;
}

function ensureBinary(options = {}) {
  if (existsSync(binaryPath) && statSync(binaryPath).size > 0 && !isStale(binaryPath, binarySourcePaths())) return false;
  mkdirSync(path.dirname(binaryPath), { recursive: true });
  ensureFrontendDist(options);
  ensureGoVendor();
  runChecked("go", ["build", "-mod=vendor", "-o", binaryPath, "."], { cwd: newApiRoot });
  return true;
}

function newApiEnv() {
  mkdirSync(dataDir, { recursive: true });
  const sqlitePath = process.env.SQLITE_PATH || `${path.join(dataDir, "one-api.db")}?_busy_timeout=30000`;
  return {
    ...process.env,
    PORT: port,
    SQLITE_PATH: sqlitePath,
    // Local development uses the canonical product-scoped fallback.
    // Production must supply its own stable secret.
    SESSION_SECRET: process.env.SESSION_SECRET || "naimage-new-api-local-session-secret",
    GENERATE_DEFAULT_TOKEN: process.env.GENERATE_DEFAULT_TOKEN || "true",
    GIN_MODE: process.env.GIN_MODE || "release"
  };
}

function isParentProcessAlive() {
  if (!parentPid || parentPid === process.pid) return true;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function smoke() {
  assertNewApiLayout();
  const frontendReady = existsSync(defaultDistIndex);
  const binaryReady = existsSync(binaryPath);
  const vendorReady = existsSync(vendorModules);
  const webNodeModulesReady = existsSync(webNodeModules);
  return {
    ok: true,
    backend: "new-api",
    root: newApiRoot,
    frontendReady,
    binaryReady,
    vendorReady,
    webNodeModulesReady,
    binaryPath,
    dataDir
  };
}

function start() {
  assertNewApiLayout();
  const frontendBuildOptions = { externalFrontendDevServer };
  const builtFrontend = ensureFrontendDist(frontendBuildOptions);
  const builtBinary = ensureBinary(frontendBuildOptions);
  log(`AI Gateway now runs embedded New API on http://127.0.0.1:${port}`);
  if (externalFrontendDevServer) log("New API frontend dev server owns browser assets in this local stack.");
  if (builtFrontend) log("New API frontend dist built.");
  if (builtBinary) log("New API backend binary built.");

  const child = spawn(binaryPath, [], {
    cwd: newApiRoot,
    env: newApiEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout?.on("data", (chunk) => log(`new-api stdout ${String(chunk).trim()}`));
  child.stderr?.on("data", (chunk) => log(`new-api stderr ${String(chunk).trim()}`));
  child.on("exit", (code, signal) => {
    log(`new-api exit code=${code} signal=${signal}`);
    process.exitCode = code || 0;
  });
  child.on("error", (error) => {
    log(`new-api spawn error ${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = () => {
    try {
      child.kill();
    } catch {
      // Process may already be gone.
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("message", (message) => {
    if (message === "shutdown") shutdown();
  });

  if (parentPid) {
    const timer = setInterval(() => {
      if (isParentProcessAlive()) return;
      clearInterval(timer);
      shutdown();
      setTimeout(() => process.exit(0), 1500).unref?.();
    }, 2500);
    timer.unref?.();
  }
}

if (isSmoke) {
  try {
    console.log(JSON.stringify(smoke(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else if (isBuildOnly) {
  try {
    assertNewApiLayout();
    const builtFrontend = ensureFrontendDist();
    const builtBinary = ensureBinary();
    console.log(JSON.stringify({ ok: true, backend: "new-api", builtFrontend, builtBinary, binaryPath }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  isStale,
  newestMtimeMs,
  shouldBuildFrontendDist,
  smoke
};
