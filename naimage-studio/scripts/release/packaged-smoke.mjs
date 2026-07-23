import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const exeArg = process.argv.find((item) => item.startsWith("--exe="));
const settingsArg = process.argv.find((item) => item.startsWith("--settings="));
const liveNetwork = process.argv.includes("--live-network");
const executable = resolve(exeArg?.split("=").slice(1).join("=") || join(projectRoot, "release", "win-unpacked", "naimage.exe"));
const sourceSettings = settingsArg ? resolve(settingsArg.split("=").slice(1).join("=")) : "";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(projectRoot, ".diagnostics", "release", `packaged-smoke-${stamp}`);
const configDir = join(runDir, "config");
const userDataDir = join(runDir, "user-data");
const debugDir = join(runDir, "runtime");
const electronLog = join(runDir, "electron.log");
const reportPath = join(runDir, "report.json");
const remotePort = 12100 + (process.pid % 1600);

if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

function packagedRuntimeHygiene(executablePath) {
  const root = dirname(executablePath);
  const forbiddenDirectoryNames = new Set([".v8-cache", ".diagnostics", ".git", "__pycache__"]);
  const forbiddenFileNames = new Set([
    "app-settings.json",
    "project-list.json",
    "session.json",
    "release-signing-private.pem"
  ]);
  const forbidden = [];
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) {
        if (forbiddenDirectoryNames.has(entry.name)) forbidden.push(relativePath);
        else visit(absolute);
      } else if (entry.isFile()) {
        fileCount += 1;
        totalBytes += statSync(absolute).size;
        if (forbiddenFileNames.has(entry.name) || /(?:^|\/)config\/(?:.*\.)?(?:pem|key|cookie)$/i.test(relativePath)) {
          forbidden.push(relativePath);
        }
      }
    }
  };
  visit(root);
  if (forbidden.length) {
    throw new Error(`Packaged runtime contains development caches or private state: ${forbidden.slice(0, 20).join(", ")}`);
  }
  return { ok: true, root, fileCount, totalBytes, forbidden: [] };
}

const hygiene = packagedRuntimeHygiene(executable);
mkdirSync(configDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(debugDir, { recursive: true });
if (sourceSettings) {
  if (!existsSync(sourceSettings)) throw new Error(`Packaged smoke settings not found: ${sourceSettings}`);
  copyFileSync(sourceSettings, join(configDir, "app-settings.json"));
}

function fixturePng(width = 64, height = 64, transparent = false) {
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const subject = x >= 14 && x <= 49 && y >= 12 && y <= 51;
      png.data[offset] = subject ? 45 : 242;
      png.data[offset + 1] = subject ? 152 : 246;
      png.data[offset + 2] = subject ? 210 : 245;
      png.data[offset + 3] = transparent ? (subject ? 255 : 0) : 255;
    }
  }
  return PNG.sync.write(png);
}

const sourceBytes = fixturePng();
const layerBytes = fixturePng(64, 64, true);
const background = new PNG({ width: 64, height: 64, colorType: 6, inputColorType: 6, inputHasAlpha: true });
for (let offset = 0; offset < background.data.length; offset += 4) {
  background.data[offset] = 242;
  background.data[offset + 1] = 246;
  background.data[offset + 2] = 245;
  background.data[offset + 3] = 255;
}
const backgroundBytes = PNG.sync.write(background);
const fixturePath = join(runDir, "external-reference.png");
writeFileSync(fixturePath, sourceBytes);
const sourceDataUrl = `data:image/png;base64,${sourceBytes.toString("base64")}`;
const layerDataUrl = `data:image/png;base64,${layerBytes.toString("base64")}`;
const backgroundDataUrl = `data:image/png;base64,${backgroundBytes.toString("base64")}`;

const child = spawn(executable, [
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${remotePort}`
], {
  cwd: dirname(executable),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NAIMAGE_AIDEBUG: "1",
    NAIMAGE_AIDEBUG_LIVE_IMAGE: liveNetwork ? "1" : "0",
    NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
    NAIMAGE_CONFIG_DIR: configDir,
    NAIMAGE_DEBUG_DIR: debugDir,
    NAIMAGE_ELECTRON_LOG: electronLog
  }
});

let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

async function waitForTarget(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // The DevTools endpoint appears after Electron creates its renderer.
    }
    await delay(250);
  }
  throw new Error("Packaged renderer DevTools target did not become ready.");
}

function cdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("Unable to open packaged renderer CDP socket.")), { once: true });
  });
  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveCall, reject: rejectCall, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) rejectCall(new Error(message.error.message || JSON.stringify(message.error)));
    else resolveCall(message.result);
  });
  const call = async (method, params = {}, timeoutMs = 60_000) => {
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

let result = null;
let failure = "";
let target = null;
try {
  target = await waitForTarget();
  const client = cdpClient(target.webSocketDebuggerUrl);
  await client.call("Runtime.enable");
  const expression = `(async () => {
    const waitUntil = async (predicate, timeoutMs = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (predicate()) return true;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      return false;
    };
    const bridgeReady = await waitUntil(() => Boolean(
      window.naimageConfig && window.naimageAgent &&
      (!${JSON.stringify(liveNetwork)} || (window.naimageServer && window.naimageUpdater))
    ));
    if (!bridgeReady) throw new Error("Production preload bridges did not become ready.");
    const settings = await window.naimageConfig.loadSettings();
    const projects = await window.naimageConfig.listProjects();
    const smoke = await window.naimageAgent.smoke();
    const saved = await window.naimageConfig.saveOutputImage({
      dataUrl: ${JSON.stringify(sourceDataUrl)},
      stem: "packaged-smoke",
      runId: "packaged-smoke-${stamp}",
      projectId: "default",
      bucket: "imagegen"
    });
    const readBack = saved?.asset?.path
      ? await window.naimageConfig.readAssetDataUrl({ path: saved.asset.path })
      : { ok: false, error: "saved asset path missing" };
    const imported = await window.naimageConfig.importLocalImage({
      path: ${JSON.stringify(fixturePath)},
      projectId: "default"
    });
    const semantic = await window.naimageConfig.refineSemanticLayers({
      width: 64,
      height: 64,
      previewSource: ${JSON.stringify(sourceDataUrl)},
      backgroundSource: ${JSON.stringify(backgroundDataUrl)},
      layers: [{
        id: "subject-fixture",
        role: "decoration",
        source: ${JSON.stringify(layerDataUrl)},
        preserveGeometry: true
      }]
    });
    const psd = saved?.asset
      ? await window.naimageConfig.exportAssetPsd({
          asset: saved.asset,
          assetIndex: 0,
          nodeTitle: "Packaged Smoke",
          projectId: "default",
          suggestedName: "packaged-smoke.psd",
          aidebugName: "packaged-smoke"
        })
      : { ok: false, error: "saved asset missing" };
    const thumbnail = await window.naimageConfig.thumbnailStats({});
    const network = ${JSON.stringify(liveNetwork)}
      ? await (async () => {
          const meStartedAt = performance.now();
          const me = await window.naimageServer.me();
          const meDurationMs = Math.round(performance.now() - meStartedAt);
          const updateStartedAt = performance.now();
          const update = await window.naimageUpdater.check();
          const updateDurationMs = Math.round(performance.now() - updateStartedAt);
          const logsStartedAt = performance.now();
          const logs = await window.naimageServer.logs();
          const logsDurationMs = Math.round(performance.now() - logsStartedAt);
          return {
            ok: Boolean(me?.ok && update?.ok && logs?.ok),
            meOk: Boolean(me?.ok),
            updateOk: Boolean(update?.ok),
            logsOk: Boolean(logs?.ok),
            logCount: Array.isArray(logs?.logs) ? logs.logs.length : 0,
            currentVersion: update?.currentVersion || "",
            latestVersion: update?.latestVersion || "",
            updateAvailable: update?.updateAvailable === true,
            updateType: update?.updateType || "none",
            meDurationMs,
            updateDurationMs,
            logsDurationMs
          };
        })()
      : { ok: true, skipped: true };
    const title = document.title;
    const bodyText = (document.body?.innerText || "").trim();
    return {
      ok: Boolean(
        settings && projects?.ok && smoke?.ok && saved?.ok && readBack?.ok &&
        imported?.ok && semantic?.ok && psd?.ok && thumbnail?.ok && network?.ok &&
        title === "naimage" && bodyText.length > 20
      ),
      title,
      bodyTextLength: bodyText.length,
      bridges: {
        config: Object.keys(window.naimageConfig || {}),
        agent: Object.keys(window.naimageAgent || {}),
        server: Object.keys(window.naimageServer || {})
      },
      projects: { ok: projects?.ok, count: projects?.projects?.length, activeProjectId: projects?.activeProjectId },
      smoke,
      saved: { ok: saved?.ok, path: saved?.asset?.path, width: saved?.asset?.width, height: saved?.asset?.height },
      readBack: { ok: readBack?.ok, matches: readBack?.dataUrl === ${JSON.stringify(sourceDataUrl)} },
      imported: { ok: imported?.ok, path: imported?.asset?.path, thumbnailPath: imported?.asset?.thumbnailPath },
      semantic: { ok: semantic?.ok, engine: semantic?.engine, layerCount: semantic?.layers?.length, reportCount: semantic?.reports?.length },
      psd: { ok: psd?.ok, path: psd?.path, count: psd?.count, layerNames: psd?.layerNames },
      thumbnail: { ok: thumbnail?.ok, stats: thumbnail?.stats },
      network
    };
  })()`;
  const evaluated = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, 180_000);
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text || "Packaged smoke evaluation failed.");
  }
  result = evaluated.result?.value;
  client.socket.close();
  if (!result?.ok) failure = "Packaged runtime checks returned a failing result.";
} catch (error) {
  failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  child.kill();
  await delay(1200);
  if (child.exitCode === null && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
}

const report = {
  ok: !failure && result?.ok === true,
  executable,
  hygiene,
  runDir,
  reportPath,
  target: target ? { title: target.title, url: target.url } : null,
  result,
  failure,
  process: { exitCode: child.exitCode, stdout, stderr },
  logTail: existsSync(electronLog) ? readFileSync(electronLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-120) : []
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (sourceSettings && existsSync(configDir)) {
  rmSync(configDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
console.log(JSON.stringify({ ok: report.ok, reportPath, executable, failure, result }, null, 2));
if (!report.ok) process.exitCode = 1;
