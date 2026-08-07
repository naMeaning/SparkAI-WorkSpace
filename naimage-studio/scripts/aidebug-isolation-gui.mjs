import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `aidebug-isolation-gui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const userDataDir = join(runDir, "user-data");
const expectedConfigDir = join(userDataDir, "data");
const reportPath = join(runDir, "report.json");
const screenshotPath = join(runDir, "isolated-canvas.png");
const repositoryConfigDir = join(repoRoot, "config");
const repositoryStateFiles = [
  "app-settings.json",
  "session.json",
  "project-list.json",
  join("projects", "default", "session.json")
].map((relativePath) => join(repositoryConfigDir, relativePath));
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");

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
  return Object.fromEntries(repositoryStateFiles.map((filePath) => [relative(repositoryConfigDir, filePath), fileSnapshot(filePath)]));
}

async function waitForProjectSession(timeoutMs = 15_000) {
  const projectListPath = join(expectedConfigDir, "project-list.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = JSON.parse(readFileSync(projectListPath, "utf8"));
      const project = list.projects?.find((item) => item.id === list.activeProjectId) || list.projects?.[0];
      const sessionPath = resolve(String(project?.sessionPath || ""));
      const projectsRoot = resolve(expectedConfigDir, "projects");
      if (
        sessionPath &&
        (sessionPath === projectsRoot || sessionPath.startsWith(`${projectsRoot}${sep}`)) &&
        existsSync(sessionPath)
      ) {
        const session = JSON.parse(readFileSync(sessionPath, "utf8"));
        if (Array.isArray(session.nodes) && session.nodes.length === 1) return { list, project, sessionPath, session };
      }
    } catch {
      // Main and Renderer may be between atomic writes; retry the authoritative file.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the isolated project session to persist one node.");
}

function cleanEnvironment(values) {
  const environment = { ...process.env };
  delete environment.NAIMAGE_CONFIG_DIR;
  delete environment.NAIMAGE_AIDEBUG_ISOLATION_ROOT;
  return Object.assign(environment, values);
}

async function main() {
  assert(existsSync(electronCli), "Electron CLI was not found.");
  assert(existsSync(viteCli), "Vite CLI was not found.");
  mkdirSync(runDir, { recursive: true });
  const beforeRepositoryState = repositorySnapshot();
  const devPort = await allocateDebugPort();
  const debugPort = await allocateDebugPort();
  const devUrl = `http://127.0.0.1:${devPort}`;
  let viteProcess;
  let electronProcess;
  let client;
  let electronStdout = "";
  let electronStderr = "";
  try {
    viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForHttpServer(devUrl, { attempts: 100, intervalMs: 100, errorMessage: `Vite did not respond: ${devUrl}` });

    electronProcess = spawn(process.execPath, [
      electronCli,
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "electron-main.cjs"
    ], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnvironment({
        NAIMAGE_DEV_URL: devUrl,
        NAIMAGE_AIDEBUG: "1",
        NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
        NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
        NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
        NAIMAGE_DEBUG_DIR: join(runDir, "runtime"),
        NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log")
      })
    });
    electronProcess.stdout?.on("data", (chunk) => { electronStdout += String(chunk); });
    electronProcess.stderr?.on("data", (chunk) => { electronStderr += String(chunk); });

    const target = await pollForDebugTarget({
      port: debugPort,
      attempts: 120,
      intervalMs: 100,
      findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url || "").startsWith(devUrl)),
      beforeAttempt: () => {
        if (electronProcess.exitCode !== null) throw new Error(`Electron exited early with code ${electronProcess.exitCode}.`);
      },
      notFoundMessage: "AIDebug isolation GUI target did not appear."
    });
    client = new BasicCdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForRuntimeExpression(
      client,
      "Boolean(window.naimageRuntime?.aidebugEnabled && window.naimageRuntime?.isolatedConfig && window.__naimageDebugAgentState?.().configReady && window.__naimageAIDebug?.state && window.__naimageDebugCreateImageContainer)",
      { timeoutMs: 30_000, intervalMs: 100 }
    );
    const runtime = await evaluateRuntime(client, `({
      runtime: { ...window.naimageRuntime },
      debugControlType: typeof window.__naimageAIDebug,
      initialNodeCount: Number(window.__naimageAIDebug.state()?.nodeCount || 0)
    })`);
    assert.deepEqual(runtime.runtime, { aidebugEnabled: true, isolatedConfig: true });
    assert.equal(runtime.debugControlType, "object");
    assert.equal(runtime.initialNodeCount, 0);

    const mutation = await evaluateRuntime(client, `window.__naimageDebugCreateImageContainer({ worldX: 240, worldY: 180, role: "source" })`);
    assert.equal(mutation?.ok, true);
    assert.equal(typeof mutation?.id, "string");
    await waitForRuntimeExpression(client, "window.__naimageAIDebug.state()?.nodeCount === 1", { timeoutMs: 10_000, intervalMs: 100 });
    await delay(600);
    await waitForRuntimeExpression(client, "typeof window.__naimageDebugMoveNode === 'function'", { timeoutMs: 10_000, intervalMs: 100 });
    const moved = await evaluateRuntime(client, `window.__naimageDebugMoveNode({ id: ${JSON.stringify(mutation.id)}, x: 300, y: 220 })`);
    assert.equal(moved, true);
    await waitForRuntimeExpression(client, "Number(window.__naimageAIDebug.persistenceMetrics?.().writeCount || 0) >= 1", { timeoutMs: 10_000, intervalMs: 100 });
    const persistenceMetrics = await evaluateRuntime(client, "window.__naimageAIDebug.persistenceMetrics?.() || null");
    const persisted = await waitForProjectSession();
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

    const afterRepositoryState = repositorySnapshot();
    const checks = {
      runtimeGateEnabled: runtime.runtime.aidebugEnabled && runtime.runtime.isolatedConfig,
      debugControlInstalled: runtime.debugControlType === "object",
      isolatedSessionPersistedOneNode: persisted.session.nodes.length === 1,
      isolatedSessionPath: persisted.sessionPath.startsWith(`${resolve(expectedConfigDir, "projects")}${sep}`),
      repositoryConfigUnchanged: JSON.stringify(beforeRepositoryState) === JSON.stringify(afterRepositoryState),
      screenshotCreated: existsSync(screenshotPath) && statSync(screenshotPath).size > 10_000
    };
    const report = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      expectedConfigDir,
      screenshotPath,
      checks,
      runtime,
      persistenceMetrics,
      persisted: {
        activeProjectId: persisted.list.activeProjectId,
        nodeCount: persisted.session.nodes.length
      },
      electronStdout: electronStdout.slice(-2_000),
      electronStderr: electronStderr.slice(-2_000)
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    assert(report.ok, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify({ ok: true, reportPath, screenshotPath, checks }, null, 2)}\n`);
  } finally {
    client?.close();
    if (electronProcess?.pid) await forceKillProcessTree(electronProcess.pid);
    if (viteProcess?.pid) await forceKillProcessTree(viteProcess.pid);
    await waitForChildExit(electronProcess, 5_000);
    await waitForChildExit(viteProcess, 5_000);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
