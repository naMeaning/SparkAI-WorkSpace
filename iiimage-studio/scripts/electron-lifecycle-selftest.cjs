"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const diagnosticsRoot = path.join(repoRoot, ".diagnostics", "electron");
const runDir = path.join(diagnosticsRoot, `lifecycle-selftest-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const logPath = path.join(runDir, "electron.log");
const reportPath = path.join(runDir, "report.json");
const electronExecutable = (() => {
  try {
    const executable = require("electron");
    return typeof executable === "string" && existsSync(executable) ? executable : "";
  } catch {
    return "";
  }
})();

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Electron lifecycle probe exceeded ${timeoutMs}ms.`)), timeoutMs);
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

async function waitForProcessGone(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processAlive(pid);
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

async function main() {
  assert(electronExecutable, "Electron executable was not found.");
  mkdirSync(runDir, { recursive: true });
  const child = spawn(electronExecutable, [`--user-data-dir=${path.join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      IIIMAGE_LIFECYCLE_SELFTEST: "1",
      IIIMAGE_LOCAL_SERVER_ENTRY: path.join(repoRoot, "scripts", "lifecycle-server-fixture.cjs"),
      IIIMAGE_CONFIG_DIR: path.join(runDir, "config"),
      IIIMAGE_ELECTRON_LOG: logPath,
      IIIMAGE_DEV_URL: ""
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  let exit;
  try {
    exit = await waitForExit(child, 15_000);
  } catch (error) {
    terminateProcessTree(child);
    await waitForProcessGone(child.pid, 3_000);
    throw error;
  }
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const serverPid = Number(log.match(/local server start pid=(\d+)/)?.[1] || 0);
  const serverGone = await waitForProcessGone(serverPid);
  const checks = {
    electronExitedCleanly: exit.code === 0,
    logCreated: Boolean(log),
    serverStarted: serverPid > 0,
    serverStopRequested: /local server stop pid=\d+/.test(log),
    shutdownCompleted: /shutdown complete duration=\d+ms timedOut=false/.test(log),
    serverGone
  };
  const report = {
    ok: Object.values(checks).every(Boolean),
    runDir,
    logPath,
    exit,
    serverPid,
    checks,
    stdout: stdout.slice(-2_000),
    stderr: stderr.slice(-2_000)
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assert(report.ok, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
