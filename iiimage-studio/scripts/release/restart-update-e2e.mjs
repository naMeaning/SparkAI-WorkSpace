import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const releaseVersion = String(packageMetadata.version || "").trim();
const valueArg = (name, fallback = "") => {
  const item = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return item ? item.split("=").slice(1).join("=") : fallback;
};
const executable = resolve(valueArg(
  "--exe",
  join(projectRoot, ".diagnostics", "restart-update-e2e", "baseline-build", "win-unpacked", "iiimage Studio.exe")
));
const sourceSettings = resolve(valueArg("--settings", join(projectRoot, "config", "app-settings.json")));
const expectedAsar = resolve(valueArg(
  "--expected-asar",
  join(projectRoot, "release", `iiimage-Studio-Restart-Update-${releaseVersion}-x64.asar`)
));
const seedPendingArg = valueArg("--seed-pending", "");
const seedPendingSource = seedPendingArg ? resolve(seedPendingArg) : "";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(projectRoot, ".diagnostics", "release", `restart-update-e2e-${stamp}`);
const configDir = join(runDir, "config");
const userDataDir = join(runDir, "user-data");
const runtimeDir = join(runDir, "runtime");
const electronLog = join(runtimeDir, "electron.log");
const reportPath = join(runDir, "report.json");
const settingsPath = join(configDir, "app-settings.json");
const helperLog = join(configDir, "updates", "update-helper.log");
const helperBootstrapLog = join(configDir, "updates", "update-helper-bootstrap.log");
const targetAsar = join(dirname(executable), "resources", "app.asar");
const marker = `restart-update-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const remotePort = 13800 + (process.pid % 1200);

for (const filePath of [executable, sourceSettings, expectedAsar, targetAsar]) {
  if (!existsSync(filePath)) throw new Error(`Required update fixture is missing: ${filePath}`);
}
mkdirSync(configDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
copyFileSync(sourceSettings, settingsPath);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const expectedHash = sha256(expectedAsar);
const expectedSize = statSync(expectedAsar).size;
const downloadMode = seedPendingSource ? "seeded" : "live";
if (seedPendingSource) {
  if (!existsSync(seedPendingSource)) throw new Error(`Seeded pending update is missing: ${seedPendingSource}`);
  if (statSync(seedPendingSource).size !== expectedSize || sha256(seedPendingSource) !== expectedHash) {
    throw new Error("Seeded pending update does not match the expected signed release asset.");
  }
  const seedDestinationDir = join(configDir, "updates", releaseVersion);
  const seedDestination = join(seedDestinationDir, basename(expectedAsar));
  mkdirSync(seedDestinationDir, { recursive: true });
  copyFileSync(seedPendingSource, seedDestination);
  writeFileSync(join(configDir, "updates", "pending-update.json"), `${JSON.stringify({
    kind: "restart",
    version: releaseVersion,
    path: seedDestination,
    sha256: expectedHash,
    size: expectedSize,
    downloadedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
}

function isInside(candidate, root) {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

async function waitUntil(predicate, timeoutMs, intervalMs = 250) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw lastError || new Error(`Timed out after ${timeoutMs} ms.`);
}

const child = spawn(executable, [
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${remotePort}`
], {
  cwd: dirname(executable),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    IIIMAGE_CONFIG_DIR: configDir,
    IIIMAGE_DEBUG_DIR: runtimeDir,
    IIIMAGE_ELECTRON_LOG: electronLog
  }
});

let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

async function waitForTarget() {
  return waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Baseline app exited early with code ${child.exitCode}.`);
    const response = await fetch(`http://127.0.0.1:${remotePort}/json`);
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || null;
  }, 45_000);
}

function cdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("Unable to open update E2E CDP socket.")), { once: true });
  });
  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const pendingCall = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(pendingCall.timer);
    if (message.error) pendingCall.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else pendingCall.resolve(message.result);
  });
  const call = async (method, params = {}, timeoutMs = 30_000) => {
    await opened;
    const id = ++sequence;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { socket, call };
}

async function evaluate(client, expression, timeoutMs = 30_000) {
  const evaluated = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, timeoutMs);
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text || "Update E2E evaluation failed.");
  }
  return evaluated.result?.value;
}

function helperHealthyPid(text) {
  const matches = [...String(text || "").matchAll(/restart update healthy pid=(\d+)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : 0;
}

let client = null;
let result = null;
let failure = "";
let updatedPid = 0;
let stage = "launch";

try {
  stage = "wait-target";
  const target = await waitForTarget();
  client = cdpClient(target.webSocketDebuggerUrl);
  await client.call("Runtime.enable");
  stage = "prepare-sentinels";
  const setup = await evaluate(client, `(async () => {
    const waitUntil = async (predicate, timeoutMs = 15000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return true;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      return false;
    };
    if (!(await waitUntil(() => Boolean(window.iiimageConfig && window.iiimageAgent && window.iiimageUpdater)))) {
      throw new Error("Update bridges did not become ready.");
    }
    const marker = ${JSON.stringify(marker)};
    const loaded = await window.iiimageConfig.loadSession();
    const projectId = loaded?.activeProjectId || loaded?.project?.id || "default";
    const conversationId = "conversation-update-e2e";
    const session = loaded?.session || {};
    const saved = await window.iiimageConfig.saveSession({
      ...session,
      projectId,
      sessionRevision: Math.max(0, Number(session.sessionRevision || 0)) + 1,
      messages: [
        ...(Array.isArray(session.messages) ? session.messages : []),
        { id: marker, role: "user", content: marker, createdAt: new Date().toISOString() }
      ]
    });
    const memory = await window.iiimageAgent.saveFastMemory({ projectId, conversationId, text: marker });
    const settingsResponse = await window.iiimageConfig.loadSettings();
    const settingsSaved = await window.iiimageConfig.saveSettings({ ...(settingsResponse?.settings || {}), timeoutSeconds: 181 });
    return { ok: Boolean(loaded?.ok && saved?.ok && memory?.ok && settingsSaved?.ok), projectId, conversationId };
  })()`);
  if (!setup?.ok) throw new Error(`Unable to prepare preservation sentinels: ${JSON.stringify(setup)}`);

  stage = "check-update";
  let effectiveChecked;
  if (seedPendingSource) {
    const seededStatus = await evaluate(client, "window.iiimageUpdater.status()", 60_000);
    effectiveChecked = {
      ok: true,
      currentVersion: seededStatus?.currentVersion || "",
      latestVersion: releaseVersion,
      updateAvailable: true,
      updateType: "restart"
    };
  } else {
    effectiveChecked = await evaluate(client, "window.iiimageUpdater.check()", 60_000);
  }
  if (!effectiveChecked?.ok || !effectiveChecked?.updateAvailable || effectiveChecked?.updateType !== "restart" || effectiveChecked?.latestVersion !== releaseVersion) {
    throw new Error(`Unexpected update check result: ${JSON.stringify(effectiveChecked)}`);
  }
  stage = seedPendingSource ? "rehydrate-pending" : "download-update";
  const downloaded = seedPendingSource
    ? await evaluate(client, "window.iiimageUpdater.status()", 60_000)
    : await evaluate(client, "window.iiimageUpdater.downloadRestart()", 360_000);
  if (!downloaded?.ok || downloaded?.pending?.kind !== "restart") {
    throw new Error(`Restart update did not download: ${JSON.stringify(downloaded)}`);
  }
  stage = "verify-pending";
  const pendingPath = join(configDir, "updates", "pending-update.json");
  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  if (pending.sha256 !== expectedHash || pending.size !== expectedSize || !existsSync(pending.path)) {
    throw new Error("Downloaded pending update does not match the signed release asset.");
  }

  stage = "apply-update";
  const applied = await evaluate(client, "window.iiimageUpdater.applyRestart()", 60_000);
  if (!applied?.ok || !applied?.restarting) throw new Error(`Restart update was not applied: ${JSON.stringify(applied)}`);
  client.socket.close();
  client = null;

  stage = "wait-original-exit";
  // A 1.0.2 client can still have a legacy Electron-global fetch in flight.
  // The update helper safely waits out that request before replacing app.asar,
  // so keep this compatibility window slightly above the helper's 60s limit.
  await waitUntil(() => child.exitCode !== null, 90_000);
  stage = "wait-updated-health";
  const healthyLog = await waitUntil(() => {
    if (!existsSync(helperLog)) return "";
    const text = readFileSync(helperLog, "utf8");
    return /restart update healthy pid=\d+/.test(text) ? text : "";
  }, 180_000, 500);
  updatedPid = helperHealthyPid(healthyLog);
  stage = "verify-installed-release";
  if (!existsSync(targetAsar) || statSync(targetAsar).size !== expectedSize || sha256(targetAsar) !== expectedHash) {
    throw new Error(`Installed app.asar does not match the downloaded ${releaseVersion} release.`);
  }

  const sessionPath = join(configDir, "projects", setup.projectId, "session.json");
  const fastMemoryPath = join(configDir, "memory", "fastmemory.json");
  const preservedSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const sessionPreserved = existsSync(sessionPath) && readFileSync(sessionPath, "utf8").includes(marker);
  const fastMemoryPreserved = existsSync(fastMemoryPath) && readFileSync(fastMemoryPath, "utf8").includes(marker);
  const settingsPreserved = Boolean(
    preservedSettings.serverSessionCookie && preservedSettings.serverUserId &&
    Number(preservedSettings.timeoutSeconds) === 181
  );
  const backupRemoved = !existsSync(`${targetAsar}.iiimage-backup`);
  const sourceRemoved = !existsSync(pending.path);
  result = {
    ok: sessionPreserved && fastMemoryPreserved && settingsPreserved && backupRemoved && sourceRemoved,
    baselineVersion: effectiveChecked.currentVersion,
    updatedVersion: effectiveChecked.latestVersion,
    updateType: effectiveChecked.updateType,
    downloadMode,
    downloadedBytes: pending.size,
    expectedHash,
    targetHash: sha256(targetAsar),
    sessionPreserved,
    fastMemoryPreserved,
    settingsPreserved,
    backupRemoved,
    sourceRemoved,
    helperHealthy: true,
    updatedPid
  };
  if (!result.ok) throw new Error(`Preservation checks failed: ${JSON.stringify(result)}`);
  stage = "complete";
} catch (error) {
  failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  try { client?.socket?.close(); } catch {}
  if (child.exitCode === null && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  if (updatedPid <= 0) {
    for (let attempt = 0; attempt < 20 && updatedPid <= 0; attempt += 1) {
      if (existsSync(helperLog)) updatedPid = helperHealthyPid(readFileSync(helperLog, "utf8"));
      if (updatedPid <= 0) await delay(250);
    }
  }
  if (updatedPid > 0) {
    spawnSync("taskkill", ["/PID", String(updatedPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  await delay(2_000);
}

const logTail = existsSync(helperLog)
  ? readFileSync(helperLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-40)
  : [];
const report = {
  ok: !failure && result?.ok === true,
  generatedAt: new Date().toISOString(),
  executable,
  expectedAsar: basename(expectedAsar),
  expectedSize,
  downloadMode,
  stage,
  result,
  failure,
  process: { exitCode: child.exitCode, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) },
  helperLogTail: logTail,
  helperBootstrapLogTail: existsSync(helperBootstrapLog)
    ? readFileSync(helperBootstrapLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-80)
    : [],
  electronLogTail: existsSync(electronLog)
    ? readFileSync(electronLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-80)
    : []
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

// The copied production session is needed only during this isolated run. Never
// leave credentials in diagnostics, even when a later assertion fails.
const cleanupTargets = report.ok ? [configDir, userDataDir] : [userDataDir];
for (const sensitiveDir of cleanupTargets) {
  if (existsSync(sensitiveDir) && isInside(sensitiveDir, runDir)) {
    rmSync(sensitiveDir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
}
if (!report.ok && existsSync(settingsPath) && isInside(settingsPath, runDir)) rmSync(settingsPath, { force: true });

console.log(JSON.stringify({ ok: report.ok, reportPath, stage, result, failure }, null, 2));
if (!report.ok) process.exitCode = 1;
