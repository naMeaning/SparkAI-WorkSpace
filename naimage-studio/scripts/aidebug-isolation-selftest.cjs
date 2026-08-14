"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const diagnosticsRoot = path.join(repoRoot, ".diagnostics", "electron");
const runDir = path.join(diagnosticsRoot, `aidebug-isolation-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const userDataDir = path.join(runDir, "user-data");
const expectedConfigDir = path.join(userDataDir, "data");
const rendererIndex = path.join(runDir, "renderer.html");
const electronLog = path.join(runDir, "electron.log");
const reportPath = path.join(runDir, "report.json");
const fixtureProjectId = "aidebug-isolation-project";
const fixtureProjectDir = path.join(runDir, "fixture-projects", fixtureProjectId);
const fixtureSessionPath = path.join(fixtureProjectDir, "session.json");
const repositoryConfigDir = path.join(repoRoot, "config");
const repositoryStateFiles = [
  "app-settings.json",
  "session.json",
  "project-list.json",
  path.join("projects", "default", "session.json")
].map((relativePath) => path.join(repositoryConfigDir, relativePath));
const electronExecutable = (() => {
  try {
    const executable = require("electron");
    return typeof executable === "string" && existsSync(executable) ? executable : "";
  } catch {
    return "";
  }
})();

function fileSnapshot(filePath) {
  if (!existsSync(filePath)) return { exists: false };
  const stat = statSync(filePath);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex")
  };
}

function repositorySnapshot() {
  return Object.fromEntries(repositoryStateFiles.map((filePath) => [path.relative(repositoryConfigDir, filePath), fileSnapshot(filePath)]));
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 10_000
    });
    return;
  }
  try { child.kill("SIGKILL"); } catch {}
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error(`Electron did not exit within ${timeoutMs}ms.`)), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForFiles(filePaths, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (filePaths.every((filePath) => existsSync(filePath))) return true;
    if (child.exitCode !== null || child.signalCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return filePaths.every((filePath) => existsSync(filePath));
}

function isolatedEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment.NAIMAGE_CONFIG_DIR;
  delete environment.NAIMAGE_AIDEBUG_ISOLATION_ROOT;
  Object.assign(environment, {
    NAIMAGE_AIDEBUG: "1",
    NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
    NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
    NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
    NAIMAGE_RENDERER_INDEX: rendererIndex,
    NAIMAGE_DEV_URL: "",
    NAIMAGE_DEBUG_DIR: path.join(runDir, "runtime"),
    NAIMAGE_ELECTRON_LOG: electronLog,
    ...overrides
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
  }
  return environment;
}

function prepareFixtureProject() {
  mkdirSync(expectedConfigDir, { recursive: true });
  mkdirSync(fixtureProjectDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(fixtureSessionPath, `${JSON.stringify({
    schemaVersion: 5,
    workspaceDomain: "general",
    sessionRevision: 0,
    nodeSequence: 0,
    canvasRevision: 0,
    messages: [],
    conversations: [],
    nodes: [],
    layoutGroups: [],
    selectedNodeId: ""
  }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(expectedConfigDir, "project-list.json"), `${JSON.stringify({
    activeProjectId: fixtureProjectId,
    projects: [{
      id: fixtureProjectId,
      name: "AIDebug 隔离项目",
      path: fixtureProjectDir,
      sessionPath: fixtureSessionPath,
      createdAt: now,
      updatedAt: now,
      external: true
    }]
  }, null, 2)}\n`, "utf8");
}

async function main() {
  assert(electronExecutable, "Electron executable was not found.");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(rendererIndex, "<!doctype html><html><body>AIDebug isolation probe</body></html>\n", "utf8");
  prepareFixtureProject();

  const electronMainSource = readFileSync(path.join(repoRoot, "electron-main.cjs"), "utf8");
  const preloadSource = readFileSync(path.join(repoRoot, "preload.cjs"), "utf8");
  const rendererSource = readFileSync(path.join(repoRoot, "src", "main.tsx"), "utf8");
  assert.match(electronMainSource, /app\.isPackaged \|\| resolvedExplicitUserDataPath[\s\S]{0,120}app\.getPath\("userData"\), "data"/);
  assert.match(electronMainSource, /AIDebug refused to start without an isolated --user-data-dir and config directory/);
  assert.match(electronMainSource, /additionalArguments: aidebugRendererArguments/);
  assert.match(preloadSource, /exposeInMainWorld\("naimageRuntime"/);
  assert.match(rendererSource, /window\.naimageRuntime\?\.aidebugEnabled === true[\s\S]{0,120}window\.naimageRuntime\?\.isolatedConfig === true/);

  const beforeRepositoryState = repositorySnapshot();
  const child = spawn(electronExecutable, [`--user-data-dir=${userDataDir}`, "electron-main.cjs"], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnvironment()
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  const expectedFiles = [
    path.join(expectedConfigDir, "app-settings.json"),
    path.join(expectedConfigDir, "project-list.json"),
    fixtureSessionPath
  ];
  const isolatedFilesCreated = await waitForFiles(expectedFiles, child);
  const earlyExit = child.exitCode !== null || child.signalCode !== null;
  terminateProcessTree(child);
  const isolatedExit = await waitForExit(child).catch(() => ({ code: child.exitCode, signal: child.signalCode }));
  const afterRepositoryState = repositorySnapshot();

  const projectList = isolatedFilesCreated
    ? JSON.parse(readFileSync(path.join(expectedConfigDir, "project-list.json"), "utf8"))
    : null;
  const isolatedProjectPaths = Array.isArray(projectList?.projects) && projectList.projects.every((project) => {
    const projectPath = path.resolve(String(project?.path || ""));
    const projectsRoot = path.resolve(runDir, "fixture-projects");
    return projectPath === projectsRoot || projectPath.startsWith(`${projectsRoot}${path.sep}`);
  });

  const rejectedUserDataDir = path.join(runDir, "rejected-user-data");
  const rejected = spawn(electronExecutable, [`--user-data-dir=${rejectedUserDataDir}`, "electron-main.cjs"], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnvironment({ NAIMAGE_CONFIG_DIR: repositoryConfigDir })
  });
  let rejectedStdout = "";
  let rejectedStderr = "";
  rejected.stdout?.on("data", (chunk) => { rejectedStdout += String(chunk); });
  rejected.stderr?.on("data", (chunk) => { rejectedStderr += String(chunk); });
  const rejectedExit = await waitForExit(rejected, 10_000).catch((error) => {
    terminateProcessTree(rejected);
    throw error;
  });
  const rejectionOutput = `${rejectedStdout}\n${rejectedStderr}`;
  const afterRejectedRepositoryState = repositorySnapshot();

  const checks = {
    isolatedFilesCreated,
    isolatedProcessStayedAlive: !earlyExit,
    isolatedProjectPaths,
    repositoryConfigUnchanged: JSON.stringify(beforeRepositoryState) === JSON.stringify(afterRepositoryState),
    dangerousConfigRejected: rejectedExit.code !== 0 && /AIDebug refused to start/.test(rejectionOutput),
    repositoryConfigStillUnchanged: JSON.stringify(beforeRepositoryState) === JSON.stringify(afterRejectedRepositoryState),
    rejectedConfigCreatedNoSession: !existsSync(path.join(rejectedUserDataDir, "data", "session.json"))
  };
  const report = {
    ok: Object.values(checks).every(Boolean),
    runDir,
    expectedConfigDir,
    checks,
    isolatedExit,
    rejectedExit,
    stdout: stdout.slice(-2_000),
    stderr: stderr.slice(-2_000),
    rejectionOutput: rejectionOutput.slice(-2_000)
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assert(report.ok, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
