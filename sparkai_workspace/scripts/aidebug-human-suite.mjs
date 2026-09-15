import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";

import { BasicCdpClient as CdpClient, evaluateRuntime as evaluate, pollForDebugTarget } from "./aidebug/harness/cdp.mjs";
import { decodePng } from "./aidebug/harness/png.mjs";
import { capturePngScreenshot } from "./aidebug/harness/screenshot.mjs";

function cliValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function parseJsonOption(raw, fallback = {}) {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON option: ${value.slice(0, 160)} (${error instanceof Error ? error.message : String(error)})`);
  }
}

const knownSuites = [
  "core",
  "plain-chat",
  "tools",
  "tool-natural",
  "context-compact-tools",
  "feedback-after-compact",
  "ambiguous-intent",
  "reference-context-boundary",
  "experience-boundary",
  "broad",
  "ask-user-edge",
  "workflow-broad",
  "ui-agent-polish",
  "feedback-continuation",
  "multi-count-continuation"
];
const debugPort = Number(cliValue("--port") || 9343);
const promptFileArg = cliValue("--prompt-file");
const inlinePromptArg = cliValue("--message") || cliValue("--prompt");
const oneShotPrompt = promptFileArg
  ? readFileSync(resolve(process.cwd(), promptFileArg), "utf8")
  : inlinePromptArg;
const oneShotMode = Boolean(String(oneShotPrompt || "").trim());
const requestedSuiteName = String(cliValue("--suite") || "core").trim() || "core";
const suiteName = oneShotMode ? "one-shot" : requestedSuiteName;
const oneShotLabel = String(cliValue("--label") || "one-shot").trim() || "one-shot";
const oneShotExpect = parseJsonOption(cliValue("--expect"), {});
const oneShotTimeoutMs = Number(cliValue("--timeout-ms") || 0);
if (Number.isFinite(oneShotTimeoutMs) && oneShotTimeoutMs > 0 && oneShotExpect.timeoutMs === undefined) {
  oneShotExpect.timeoutMs = oneShotTimeoutMs;
}
const oneShotEvalTimeoutMs = Number(cliValue("--eval-timeout-ms") || 0) || Math.max(Number(oneShotExpect.timeoutMs || 300000) + 30000, 60000);
const cpuOverloadRetries = Math.max(0, Math.min(Number(cliValue("--cpu-retries") || 2), 5));
const cpuOverloadRetryMs = Math.max(1000, Math.min(Number(cliValue("--cpu-retry-ms") || 15000), 120000));
const repoRoot = resolve(import.meta.dirname, "..");
const helpRequested = process.argv.includes("--help") || process.argv.includes("-h");
const listSuitesRequested = process.argv.includes("--list-suites");
const statusRequested = process.argv.includes("--status");
const statusScreenshotRequested = process.argv.includes("--screenshot");

function printUsage() {
  console.log(
    [
      "naimage AIDebug human suite",
      "",
      "Usage:",
      "  node scripts/aidebug-human-suite.mjs --port=9343 --suite=core",
      "  node scripts/aidebug-human-suite.mjs --port=9343 --message=\"看看当前画布有哪些节点，不要生图。\" --expect=\"{\\\"tools\\\":[\\\"workflow\\\"]}\"",
      "  node scripts/aidebug-human-suite.mjs --port=9343 --status --screenshot",
      "  node scripts/aidebug-human-suite.mjs --list-suites",
      "",
      "Options:",
      "  --port=<number>          Electron remote debugging port. Default: 9343.",
      "  --suite=<name>           Suite to run. Default: core.",
      "  --message=<text>         Send one real composer message instead of a fixed suite.",
      "  --prompt=<text>          Alias of --message.",
      "  --prompt-file=<path>     Read one real composer message from a file.",
      "  --expect=<json>          Optional one-shot expectation object, same fields as suite steps.",
      "  --label=<text>           One-shot step label. Default: one-shot.",
      "  --timeout-ms=<number>    One-shot UI wait timeout.",
      "  --cpu-retries=<number>   Retry a step on transient runtime errors such as CPU/memory overload or credential cooldown. Default: 2.",
      "  --cpu-retry-ms=<number>  Wait between transient runtime retries. Default: 15000.",
      "  --desktop-log=<path>     Markdown report path.",
      "  --status                 Print current UI/Agent debug state without mutating the UI.",
      "  --screenshot             With --status, save a current UI screenshot.",
      "  --list-suites            Print known suites without touching the UI.",
      "  --help                   Print this help.",
      "",
      `Suites: ${knownSuites.join(", ")}`
    ].join("\n")
  );
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function stepDiagnosticText(step = {}) {
  return [
    step.error,
    step.state?.error,
    step.state?.lastAssistant,
    step.state?.lastError,
    ...(Array.isArray(step.runProgress) ? step.runProgress.map((item) => `${item?.phase || ""} ${item?.summary || ""}`) : [])
  ].filter(Boolean).join("\n");
}

function isCpuOverloadStep(step = {}) {
  return /(?:cpu|memory) overloaded|system (?:cpu|memory) overloaded/i.test(stepDiagnosticText(step));
}

function transientRuntimeRetryReason(step = {}) {
  const text = stepDiagnosticText(step);
  if (/(?:cpu|memory) overloaded|system (?:cpu|memory) overloaded/i.test(text)) return "cpu-overload";
  if (/credentials?.*(?:cooling down|cooldown)|all credentials.*cooling down|rate limit|temporar(?:y|ily) unavailable/i.test(text)) return "runtime-transient";
  return "";
}

if (helpRequested) {
  printUsage();
  process.exit(0);
}

if (listSuitesRequested) {
  console.log(JSON.stringify({ ok: true, suites: knownSuites }, null, 2));
  process.exit(0);
}

if (!oneShotMode && !statusRequested && !knownSuites.includes(suiteName)) {
  console.error(JSON.stringify({ ok: false, error: `Unknown suite: ${suiteName}`, suites: knownSuites }, null, 2));
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(repoRoot, ".diagnostics", "human-agent", `run-${runId}`);
const lockPath = join(repoRoot, ".diagnostics", "human-agent", `.aidebug-ui-${debugPort}.lock`);
// Keep automated evidence inside the repository. Writing to Desktop is opt-in
// through --desktop-log so routine regression runs never recreate old clutter.
const defaultDesktopLogDir = join(repoRoot, ".diagnostics", "human-agent", "logs");
const desktopLogArg = process.argv.find((item) => item.startsWith("--desktop-log="));
const desktopLog = desktopLogArg?.split("=").slice(1).join("=") ||
  join(defaultDesktopLogDir, `naimage-AIDebug-人类化真实输入-${runId}.md`);

mkdirSync(runDir, { recursive: true });
mkdirSync(dirname(desktopLog), { recursive: true });

const failureContext = { steps: [], screenshots: [] };
let uiLockAcquired = false;

function acquireUiLock() {
  const staleMs = 30 * 60 * 1000;
  const now = Date.now();
  if (existsSync(lockPath)) {
    let stale = false;
    let detail = "";
    try {
      const stat = statSync(lockPath);
      stale = now - stat.mtimeMs > staleMs;
    } catch {
      stale = false;
    }
    try {
      detail = readFileSync(lockPath, "utf8").trim();
      const lock = JSON.parse(detail);
      const pid = Number(lock.pid || 0);
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch {
          stale = true;
        }
      }
    } catch {
      detail = "";
    }
    if (stale) {
      rmSync(lockPath, { force: true });
    } else {
      throw new Error(`AIDebug UI on port ${debugPort} is already locked by another human suite. Run mutating suites serially or use an isolated Electron instance. ${detail}`);
    }
  }
  const payload = JSON.stringify({ pid: process.pid, suite: suiteName, runId, startedAt: new Date().toISOString(), port: debugPort });
  writeFileSync(lockPath, payload, { flag: "wx" });
  uiLockAcquired = true;
}

function releaseUiLock() {
  if (!uiLockAcquired) return;
  try {
    rmSync(lockPath, { force: true });
  } catch {
    // Best-effort cleanup; stale locks are handled on the next run.
  }
  uiLockAcquired = false;
}

process.once("exit", releaseUiLock);
const viewFixturePath = join(runDir, "aidebug-view-fixture.png");
const preferredViewFixturePath = join(repoRoot, "showcase", "real-image2", "2026-07-13-java-language-visual.png");
const fallbackViewFixturePath = join(repoRoot, "public", "naimage.png");
const sourceViewFixturePath = existsSync(preferredViewFixturePath) ? preferredViewFixturePath : fallbackViewFixturePath;
if (existsSync(sourceViewFixturePath)) {
  await sharp(sourceViewFixturePath)
    .resize(768, 1024, {
      fit: existsSync(preferredViewFixturePath) ? "cover" : "contain",
      position: "attention",
      background: { r: 12, g: 16, b: 22, alpha: 1 }
    })
    .png({ compressionLevel: 9 })
    .toFile(viewFixturePath);
} else {
  writeFileSync(
    viewFixturePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQkwMaACDAwAFwICBXS9U/8AAAAASUVORK5CYII=",
      "base64"
    )
  );
}
const viewFixtureAssetUrl = `naimage-asset://local/${relative(repoRoot, viewFixturePath).split(/[\\/]+/).map(encodeURIComponent).join("/")}`;

async function waitForTarget() {
  return pollForDebugTarget({
    port: debugPort,
    attempts: 120,
    intervalMs: 250,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url || "").includes("127.0.0.1:5173")),
    notFoundMessage: `No naimage page target found on ${debugPort}.`
  });
}

async function readViewportMetrics(client) {
  return evaluate(
    client,
    `(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      visualViewportWidth: Math.round(window.visualViewport?.width || 0),
      visualViewportHeight: Math.round(window.visualViewport?.height || 0)
    }))()`,
    5000
  ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
}

async function clearViewportOverride(client) {
  await client.send("Emulation.clearDeviceMetricsOverride", {}, 5000).catch(() => null);
  await client.send("Emulation.setVisibleSize", { width: 0, height: 0 }, 5000).catch(() => null);
  await delay(120);
  await evaluate(client, `window.dispatchEvent(new Event("resize")); undefined`, 3000).catch(() => null);
  await delay(120);
}

async function setWindowSize(client, targetId, width, height) {
  const requested = { width: Number(width), height: Number(height) };
  const attempts = [];
  try {
    const { windowId } = await client.send("Browser.getWindowForTarget", { targetId }, 10000);
    await client.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: requested.width, height: requested.height, windowState: "normal" }
    }, 10000);
    attempts.push({ method: "Browser.setWindowBounds", ok: true });
  } catch (error) {
    attempts.push({ method: "Browser.setWindowBounds", ok: false, error: error instanceof Error ? error.message : String(error) });
    const resizeResult = await evaluate(client, `window.resizeTo(${requested.width}, ${requested.height}); undefined`, 5000)
      .then(() => ({ ok: true }))
      .catch((resizeError) => ({ ok: false, error: resizeError instanceof Error ? resizeError.message : String(resizeError) }));
    attempts.push({ method: "window.resizeTo", ...resizeResult });
  }
  const emulationResult = await client.send("Emulation.setDeviceMetricsOverride", {
    width: requested.width,
    height: requested.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: requested.width,
    screenHeight: requested.height
  }, 10000)
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  attempts.push({ method: "Emulation.setDeviceMetricsOverride", ...emulationResult });
  const visibleSizeResult = await client.send("Emulation.setVisibleSize", {
    width: requested.width,
    height: requested.height
  }, 10000)
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  attempts.push({ method: "Emulation.setVisibleSize", ...visibleSizeResult });
  await delay(260);
  await evaluate(client, `window.dispatchEvent(new Event("resize")); undefined`, 3000).catch(() => null);
  await delay(260);
  const metrics = await readViewportMetrics(client);
  const viewportOk = Math.abs(Number(metrics?.innerWidth || 0) - requested.width) <= 2
    && Math.abs(Number(metrics?.innerHeight || 0) - requested.height) <= 2;
  return { requested, metrics, viewportOk, attempts };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePngRgba(width, height, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (stride + 1);
    raw[target] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, target + 1);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND")
  ]);
}

function pngVisualQuality(buffer) {
  try {
    const png = decodePng(buffer);
    const stepX = Math.max(1, Math.floor(png.width / 90));
    const stepY = Math.max(1, Math.floor(png.height / 60));
    const buckets = new Set();
    let sampled = 0;
    let opaque = 0;
    let visibleInk = 0;
    let minChannel = 255;
    let maxChannel = 0;
    for (let y = 0; y < png.height; y += stepY) {
      for (let x = 0; x < png.width; x += stepX) {
        const index = (y * png.width + x) * 4;
        const alpha = png.data[index + 3];
        sampled += 1;
        if (alpha <= 16) continue;
        opaque += 1;
        const red = png.data[index];
        const green = png.data[index + 1];
        const blue = png.data[index + 2];
        const brightness = (red + green + blue) / 3;
        const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
        minChannel = Math.min(minChannel, red, green, blue);
        maxChannel = Math.max(maxChannel, red, green, blue);
        if (brightness < 244 || channelSpread > 10) visibleInk += 1;
        buckets.add(`${red >> 4}-${green >> 4}-${blue >> 4}`);
      }
    }
    const opaqueRatio = Math.round((opaque / Math.max(1, sampled)) * 1000) / 1000;
    const visibleInkRatio = Math.round((visibleInk / Math.max(1, sampled)) * 1000) / 1000;
    const channelSpread = Math.round(maxChannel - minChannel);
    const ok = png.width >= 320 && png.height >= 240 && opaqueRatio >= 0.8 && visibleInkRatio >= 0.018 && buckets.size >= 8 && channelSpread >= 24;
    return { ok, width: png.width, height: png.height, sampled, opaqueRatio, visibleInkRatio, uniqueColorBuckets: buckets.size, channelSpread, error: "" };
  } catch (error) {
    return { ok: false, width: 0, height: 0, sampled: 0, opaqueRatio: 0, visibleInkRatio: 0, uniqueColorBuckets: 0, channelSpread: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function screenshot(client, label) {
  const attempts = [];
  const filePath = join(runDir, `${label}.png`);
  let bestBuffer = null;
  let bestSource = "";
  let bestScore = -1;
  const writeAttempt = (source, buffer, extra = {}) => {
    const quality = pngVisualQuality(buffer);
    const score = Number(quality.visibleInkRatio || 0) + Number(quality.uniqueColorBuckets || 0) / 100000;
    if (score > bestScore) {
      bestScore = score;
      bestBuffer = buffer;
      bestSource = source;
    }
    attempts.push({ source, quality, ...extra });
    if (quality.ok) {
      writeFileSync(filePath, buffer);
      return true;
    }
    return false;
  };
  try {
    await client.send("Page.bringToFront", {}, 5000).catch(() => null);
    await delay(120);
    try {
      const buffer = await capturePngScreenshot(client, { fromSurface: true, captureBeyondViewport: false }, 20000, { missingData: "empty" });
      if (writeAttempt("cdp-from-surface", buffer)) {
        writeFileSync(join(runDir, `${label}.capture.json`), JSON.stringify({ label, selected: "cdp-from-surface", attempts }, null, 2));
        return filePath;
      }
    } catch (error) {
      attempts.push({ source: "cdp-from-surface", error: error instanceof Error ? error.message : String(error) });
    }
    try {
      const buffer = await capturePngScreenshot(client, { fromSurface: false, captureBeyondViewport: false }, 15000, { missingData: "empty" });
      if (writeAttempt("cdp-view", buffer)) {
        writeFileSync(join(runDir, `${label}.capture.json`), JSON.stringify({ label, selected: "cdp-view", attempts }, null, 2));
        return filePath;
      }
    } catch (error) {
      attempts.push({ source: "cdp-view", error: error instanceof Error ? error.message : String(error) });
    }
    for (const scope of ["page", "window"]) {
      try {
        const nativeCapture = await evaluate(
          client,
          `window.__naimageDebugCaptureGui ? window.__naimageDebugCaptureGui(${JSON.stringify(label)}, ${JSON.stringify(scope)}) : Promise.resolve({ ok: false, error: "capture hook missing" })`,
          20000
        );
        if (nativeCapture?.ok && nativeCapture.path && existsSync(nativeCapture.path)) {
          const buffer = readFileSync(nativeCapture.path);
          if (writeAttempt(`native-${scope}`, buffer, { nativeCapture })) {
            writeFileSync(join(runDir, `${label}.capture.json`), JSON.stringify({ label, selected: `native-${scope}`, attempts }, null, 2));
            return filePath;
          }
        } else {
          attempts.push({ source: `native-${scope}`, nativeCapture });
        }
      } catch (error) {
        attempts.push({ source: `native-${scope}`, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const fallback = attempts
      .map((attempt) => ({ ...attempt, score: attempt.quality?.visibleInkRatio ?? -1 }))
      .sort((a, b) => b.score - a.score)[0];
    if (fallback?.nativeCapture?.path && existsSync(fallback.nativeCapture.path)) {
      writeFileSync(filePath, readFileSync(fallback.nativeCapture.path));
    } else if (bestBuffer) {
      writeFileSync(filePath, bestBuffer);
    }
    writeFileSync(join(runDir, `${label}.capture.json`), JSON.stringify({ label, selected: fallback?.source || bestSource || "none", attempts, issue: "low-quality-screenshot" }, null, 2));
    if (fallback?.source || bestBuffer) return filePath;
  } catch (error) {
    let debugState = null;
    try {
      debugState = await evaluate(client, "window.__naimageDebugAgentState?.() || null", 8000);
    } catch {
      debugState = null;
    }
    const filePath = join(runDir, `${label}.screenshot-error.txt`);
    writeFileSync(filePath, [
      error instanceof Error ? error.message : String(error),
      debugState ? JSON.stringify({
        agentStatus: debugState.agentStatus,
        nodeCount: debugState.nodeCount,
        selectedNodeId: debugState.selectedNodeId,
        imageTaskModalOpen: debugState.imageTaskModalOpen
      }, null, 2) : ""
    ].filter(Boolean).join("\n\n"));
    return filePath;
  }
  const errorPath = join(runDir, `${label}.screenshot-error.txt`);
  writeFileSync(errorPath, JSON.stringify({ label, attempts, error: "No screenshot capture produced a usable image." }, null, 2));
  return errorPath;
}

function writeScreenshotContactSheet(screenshots) {
  const imageFiles = screenshots.filter((item) => /\.png$/i.test(String(item || "")));
  if (!imageFiles.length) return "";
  const filePath = join(runDir, "screenshot-contact-sheet.html");
  const cards = imageFiles.map((item, index) => {
    const name = basename(item);
    return [
      "<figure>",
      `<figcaption>${String(index + 1).padStart(2, "0")} ${name}</figcaption>`,
      `<img src="./${name}" alt="${name}">`,
      "</figure>"
    ].join("");
  }).join("\n");
  writeFileSync(filePath, [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<title>naimage AIDebug Screenshot Contact Sheet</title>",
    "<style>",
    "body{margin:0;padding:16px;background:#101418;color:#e5edf2;font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}",
    "h1{margin:0 0 12px;font-size:16px;letter-spacing:0}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}",
    "figure{min-width:0;margin:0;border:1px solid #2a333d;border-radius:8px;background:#161d23;overflow:hidden}",
    "figcaption{padding:8px 10px;color:#9fb1bf;border-bottom:1px solid #2a333d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "img{display:block;width:100%;height:auto;background:#0b0f13}",
    "</style>",
    "<h1>naimage AIDebug Screenshot Contact Sheet</h1>",
    `<p>runDir: ${runDir}</p>`,
    "<div class=\"grid\">",
    cards,
    "</div>"
  ].join("\n"));
  return filePath;
}

function writeScreenshotContactSheetPng(screenshots) {
  const imageFiles = screenshots.filter((item) => /\.png$/i.test(String(item || "")) && existsSync(item));
  if (!imageFiles.length) return "";
  try {
    const decoded = imageFiles.map((item) => ({ item, png: decodePng(readFileSync(item)) }));
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(decoded.length))));
    const thumbWidth = 420;
    const thumbHeight = 236;
    const captionHeight = 26;
    const gutter = 16;
    const padding = 18;
    const cardWidth = thumbWidth;
    const cardHeight = thumbHeight + captionHeight;
    const rows = Math.ceil(decoded.length / columns);
    const width = padding * 2 + columns * cardWidth + (columns - 1) * gutter;
    const height = padding * 2 + rows * cardHeight + (rows - 1) * gutter;
    const canvas = Buffer.alloc(width * height * 4);
    const setPixel = (x, y, red, green, blue, alpha = 255) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const offset = (y * width + x) * 4;
      canvas[offset] = red;
      canvas[offset + 1] = green;
      canvas[offset + 2] = blue;
      canvas[offset + 3] = alpha;
    };
    const fillRect = (x, y, w, h, red, green, blue, alpha = 255) => {
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy += 1) {
        for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx += 1) {
          setPixel(xx, yy, red, green, blue, alpha);
        }
      }
    };
    fillRect(0, 0, width, height, 16, 20, 24);
    decoded.forEach(({ png }, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardX = padding + column * (cardWidth + gutter);
      const cardY = padding + row * (cardHeight + gutter);
      fillRect(cardX, cardY, cardWidth, cardHeight, 22, 29, 35);
      fillRect(cardX, cardY, cardWidth, captionHeight, 31, 40, 48);
      fillRect(cardX, cardY + captionHeight, thumbWidth, thumbHeight, 11, 15, 19);
      const scale = Math.min(thumbWidth / png.width, thumbHeight / png.height);
      const drawWidth = Math.max(1, Math.round(png.width * scale));
      const drawHeight = Math.max(1, Math.round(png.height * scale));
      const drawX = cardX + Math.floor((thumbWidth - drawWidth) / 2);
      const drawY = cardY + captionHeight + Math.floor((thumbHeight - drawHeight) / 2);
      for (let y = 0; y < drawHeight; y += 1) {
        const sourceY = Math.min(png.height - 1, Math.floor(y / scale));
        for (let x = 0; x < drawWidth; x += 1) {
          const sourceX = Math.min(png.width - 1, Math.floor(x / scale));
          const source = (sourceY * png.width + sourceX) * 4;
          setPixel(drawX + x, drawY + y, png.data[source], png.data[source + 1], png.data[source + 2], png.data[source + 3]);
        }
      }
    });
    const filePath = join(runDir, "screenshot-contact-sheet.png");
    writeFileSync(filePath, encodePngRgba(width, height, canvas));
    return filePath;
  } catch (error) {
    writeFileSync(join(runDir, "screenshot-contact-sheet-error.txt"), error instanceof Error ? error.stack || error.message : String(error));
    return "";
  }
}

async function closeTransientDialogs(client) {
  await evaluate(
    client,
    `(() => {
      document.querySelector(".ask-user-dialog .secondary-wide")?.click();
      document.querySelector(".reference-picker-dialog .secondary-wide")?.click();
      document.querySelector(".image-task-dialog.ask-user-dialog .ui-surface-close")?.click();
      return true;
    })()`,
    10000
  ).catch(() => false);
}

function realComposerStepExpression(label, prompt, expect = {}) {
  return `new Promise((resolve) => {
    const label = ${JSON.stringify(label)};
    const prompt = ${JSON.stringify(prompt)};
    const expect = ${JSON.stringify(expect)};
    const startedAt = Date.now();
    const timeoutMs = Number(expect.timeoutMs || 300000);
    const visualAnchorPattern = /(公主切|黑长直|小红书|东方审美|二次元|写实|近景|微海报|头像|海报|高级|封面|角色|黑头发)/i;
    const feedbackOnlyPattern = /^(这张|这个|刚才|效果|优点|缺点|满意|不满意|记住|下次|以后)/i;
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const readState = () => window.__naimageDebugAgentState?.() || {};
    const fail = (error, extra = {}) => {
      resolve({ ok: false, label, prompt, error, durationMs: Date.now() - startedAt, state: readState(), ...extra });
    };
    window.__naimageDebugOpenSurface?.("main");
      window.setTimeout(() => {
        const beforeState = readState();
        const beforeNodeIds = new Set((Array.isArray(beforeState.nodes) ? beforeState.nodes : []).map((node) => String(node.id || "")));
        const progressKey = (item) => [
          item?.runId || "",
          item?.modelRound || item?.detail?.round || "",
          item?.phase || "",
          item?.tool || "",
          item?.summary || "",
          item?.entryId || "",
          JSON.stringify(item?.input || null),
          JSON.stringify(item?.detail || null)
        ].join("::");
        const beforeProgressKeys = new Set((Array.isArray(beforeState.progress) ? beforeState.progress : []).map(progressKey));
        const observedProgress = [];
        const observedProgressKeys = new Set();
        let unmetExecutionSince = 0;
        const rememberProgress = (items) => {
          for (const item of Array.isArray(items) ? items : []) {
            const key = progressKey(item);
            if (beforeProgressKeys.has(key) || observedProgressKeys.has(key)) continue;
            observedProgressKeys.add(key);
            observedProgress.push(item);
          }
        };
        const textarea = document.querySelector(".agent-composer textarea, .project-agent-composer textarea");
      if (!textarea) return fail("composer textarea missing", { beforeState });
      textarea.focus();
      setTextareaValue(textarea, prompt);
      const submitStartedAt = Date.now();
      const submitTimer = window.setInterval(() => {
        const send = document.querySelector(".send-button:not(.is-stop), .project-agent-composer button[aria-label='发送']");
        if (send && !send.disabled) {
          window.clearInterval(submitTimer);
          send.click();
          const pollStartedAt = Date.now();
          const pollTimer = window.setInterval(() => {
            const state = readState();
            const progress = Array.isArray(state.progress) ? state.progress : [];
            rememberProgress(progress);
            const latestRunId =
              [...observedProgress].reverse().find((item) => item?.runId && item.phase === "runtime-request")?.runId ||
              [...observedProgress].reverse().find((item) => item?.runId)?.runId ||
              "";
            const runProgressForId = latestRunId ? observedProgress.filter((item) => item?.runId === latestRunId) : [];
            const runProgress = runProgressForId.some((item) => item.phase === "tool-start" || item.phase === "tool-done" || item.phase === "tool-error")
              ? runProgressForId
              : observedProgress;
            const modelForce = runProgress.filter((item) => item.phase === "model-force");
            const modelToolChoice = runProgress.filter((item) => item.phase === "model-tool-choice");
            const modelArgCorrect = runProgress.filter((item) => item.phase === "model-arg-correct");
            const modelContract = runProgress.filter((item) => item.phase === "model-contract-warning" || item.phase === "model-contract-failed");
            const modelRequestDetails = runProgress.filter((item) => item.phase === "model-request-detail").map((item) => item.detail || item.summary);
            const modelResponseDetails = runProgress.filter((item) => item.phase === "model-response-detail").map((item) => item.detail || item.summary);
            const inputsFor = (tool) => runProgress
              .filter((item) => item.tool === tool && item.input && typeof item.input === "object" && !Array.isArray(item.input))
              .map((item) => item.input);
            const imageInputs = inputsFor("image_gen");
            const imageExecutionInputs = runProgress
              .filter((item) =>
                item.tool === "image_gen" &&
                ["image-request", "image-response", "image-dry-run"].includes(String(item.phase || "")) &&
                item.input &&
                typeof item.input === "object" &&
                !Array.isArray(item.input)
              )
              .map((item) => item.input);
            const experienceInputs = inputsFor("experience");
            const workflowInputs = inputsFor("workflow");
            const commandInputs = inputsFor("command");
            const askUserInputs = inputsFor("ask_user");
            const webSearchInputs = inputsFor("web_search");
            const viewImageInputs = inputsFor("view_image");
            const imageEvents = runProgress.filter((item) =>
              (item.tool === "image_gen" && (item.phase === "tool-start" || item.phase === "tool-done" || item.phase === "tool-error")) ||
              String(item.phase || "").startsWith("image-")
            );
            const actualToolEvents = runProgress.filter((item) =>
              item.phase === "tool-start" ||
              item.phase === "tool-done" ||
              item.phase === "tool-error" ||
              String(item.phase || "").startsWith("image-")
            );
            const experienceEvents = runProgress.filter((item) => item.tool === "experience");
            const newImageNodes = (Array.isArray(state.nodes) ? state.nodes : []).filter((node) =>
              !beforeNodeIds.has(String(node.id || "")) &&
              node.type === "image" &&
              node.imageState === "done" &&
              Number(node.assetCount || 0) > 0
            );
            const newAssetCount = newImageNodes.reduce((total, node) => total + Number(node.assetCount || 0), 0);
            const latestImageInput =
              [...imageExecutionInputs].reverse().find((input) => String(input.operation || input.mode || "generate") === "generate") ||
              [...imageInputs].reverse().find((input) => String(input.operation || input.mode || "generate") === "generate") ||
              imageInputs[imageInputs.length - 1] ||
              {};
            const promptText = String(latestImageInput.prompt || "");
            const promptTexts = [...imageExecutionInputs, ...imageInputs].map((input) => String(input.prompt || ""));
            const promptIncludes = Array.isArray(expect.promptIncludes) ? expect.promptIncludes.map(String).filter(Boolean) : [];
            const promptExcludes = Array.isArray(expect.promptExcludes) ? expect.promptExcludes.map(String).filter(Boolean) : [];
            const countOk = !expect.imageCount || imageInputs.some((input) => Number(input.count || 1) === Number(expect.imageCount));
            const minAssetsOk = !expect.minAssets || newAssetCount >= Number(expect.minAssets);
            const parentOk = !expect.parentId || imageInputs.some((input) => String(input.parentId || "") === String(expect.parentId || ""));
            const expectedGenerationMode = String(expect.generationMode || "");
            const generationModeOk = !expectedGenerationMode || imageExecutionInputs.some((input) =>
              String(input.generationMode || "") === expectedGenerationMode
            );
            const expectedCollectionKind = String(expect.collectionKind || "");
            const collectionKindOk = !expectedCollectionKind || newImageNodes.some((node) =>
              String(node.imageCollection?.kind || "") === expectedCollectionKind
            );
            const expectedResultParentId = String(expect.resultParentId || "");
            const resultParentOk = !expectedResultParentId || newImageNodes.some((node) =>
              String(node.parentId || "") === expectedResultParentId
            );
            const newImageNodeIds = new Set(newImageNodes.map((node) => String(node.id || "")));
            const newImageLayouts = (Array.isArray(state.nodeLayouts) ? state.nodeLayouts : []).filter((layout) =>
              newImageNodeIds.has(String(layout.id || ""))
            );
            const minimumTileContentFill = Number(expect.minTileContentFill || 0);
            const tileContentFillOk = !(minimumTileContentFill > 0) || newImageLayouts.some((layout) =>
              Number(layout.imageTileCount || 0) >= Number(expect.imageCount || 1) &&
              Number(layout.imageTileContentFillMin || 0) >= minimumTileContentFill
            );
            const primaryTileColumnWiderOk = !expect.primaryTileColumnWider || newImageLayouts.some((layout) => {
              const widths = Array.isArray(layout.imageTileColumnWidths) ? layout.imageTileColumnWidths.map(Number).filter((value) => value > 0) : [];
              return widths.length === 2 && widths[0] >= widths[1] * 1.35;
            });
            const visibleRunMessages = Array.isArray(state.messages) ? state.messages : [];
            const runUserIndex = [...visibleRunMessages].reverse().findIndex((message) =>
              message.role === "user" && String(message.content || "") === prompt
            );
            const absoluteRunUserIndex = runUserIndex < 0 ? -1 : visibleRunMessages.length - 1 - runUserIndex;
            const assistantTexts = visibleRunMessages
              .slice(absoluteRunUserIndex + 1)
              .filter((message) => message.role === "assistant" && message.meta !== "progress" && message.meta !== "thinking")
              .map((message) => String(message.content || "").replace(/\s+/g, " ").trim())
              .filter(Boolean);
            const duplicateAssistantPairs = [];
            for (let left = 0; left < assistantTexts.length; left += 1) {
              for (let right = left + 1; right < assistantTexts.length; right += 1) {
                const shorter = assistantTexts[left].length <= assistantTexts[right].length ? assistantTexts[left] : assistantTexts[right];
                const longer = shorter === assistantTexts[left] ? assistantTexts[right] : assistantTexts[left];
                if (shorter.length >= 12 && longer.startsWith(shorter)) duplicateAssistantPairs.push([assistantTexts[left], assistantTexts[right]]);
              }
            }
            const duplicateAssistantFinalOk = !expect.noDuplicateAssistantFinal || duplicateAssistantPairs.length === 0;
            const expectedVisiblePromptCount = Number(expect.visiblePromptCount || 0);
            const visiblePromptCounts = visibleRunMessages
              .slice(absoluteRunUserIndex + 1)
              .filter((message) => message?.toolTrace?.name === "image_gen" && message?.toolTrace?.stage !== "result")
              .map((message) => Array.isArray(message.toolTrace?.prompts) ? message.toolTrace.prompts.length : 0);
            const visiblePromptCount = visiblePromptCounts.length ? Math.max(...visiblePromptCounts) : 0;
            const domPromptBlockCount = document.querySelectorAll(".agent-tool-prompt-block").length;
            const visiblePromptCountOk = !(expectedVisiblePromptCount > 0) || (
              visiblePromptCount === expectedVisiblePromptCount &&
              domPromptBlockCount >= expectedVisiblePromptCount
            );
            const imagePromptOk = !expect.inheritVisualPrompt || (visualAnchorPattern.test(promptText) && !feedbackOnlyPattern.test(promptText.trim()));
            const promptIncludesOk = !promptIncludes.length || promptTexts.some((text) => promptIncludes.every((item) => text.includes(item)));
            const promptExcludesOk = promptExcludes.every((item) => promptTexts.every((text) => !text.includes(item)));
            const wantsImage = Boolean(expect.image);
            const wantsExperienceAdd = Boolean(expect.experienceAdd);
            const wantsExperienceRead = Boolean(expect.experienceRead);
            const forbidsImage = Boolean(expect.noImage);
            const wantsNoTools = Boolean(expect.noTools);
            const expectedTools = Array.isArray(expect.tools) ? expect.tools.map(String) : [];
            const forbiddenTools = Array.isArray(expect.forbidTools) ? expect.forbidTools.map(String) : [];
            const expectedWorkflowOperations = Array.isArray(expect.workflowOperations) ? expect.workflowOperations.map(String) : [];
            const commandIncludes = String(expect.commandIncludes || "");
            const expectsAskUser = Boolean(expect.askUser);
            const expectsReferenceImages = Boolean(expect.referenceImages);
            const forbidsAskUserDialog = Boolean(expect.noAskUserDialog);
            const forbidsReferenceDialog = Boolean(expect.noReferenceDialog);
            const modelCalledToolNames = modelResponseDetails.flatMap((item) =>
              Array.isArray(item?.toolCalls) ? item.toolCalls.map((call) => String(call?.name || "")).filter(Boolean) : []
            );
            const executedToolNames = Array.from(new Set(runProgress
              .filter((item) => item.phase === "tool-start")
              .map((item) => String(item.tool || ""))
              .filter(Boolean)));
            const modelToolEvidenceMissing = executedToolNames.filter((tool) => !modelCalledToolNames.includes(tool));
            const modelToolEvidenceOk = modelToolEvidenceMissing.length === 0;
            const usedImageGen = imageEvents.length > 0;
            const usedAnyTool = actualToolEvents.length > 0 || modelCalledToolNames.length > 0;
            const usedToolNames = new Set([
              ...actualToolEvents.map((item) => String(item.tool || "")).filter(Boolean),
              ...modelCalledToolNames
            ]);
            const usedExperienceAdd = experienceInputs.some((input) => String(input.action || "") === "add");
            const usedExperienceRead = experienceInputs.some((input) => String(input.action || "") === "read");
            const expectedToolsOk = expectedTools.every((tool) => usedToolNames.has(tool));
            const forbiddenToolsOk = forbiddenTools.every((tool) => !usedToolNames.has(tool));
            const workflowOperations = workflowInputs.map((input) => String(input.operation || "list_nodes"));
            const expectedWorkflowOperationsOk = expectedWorkflowOperations.every((operation) => workflowOperations.includes(operation));
            const commandOk = !commandIncludes || commandInputs.some((input) => String(input.command || "").includes(commandIncludes));
            const experienceReadIndex = runProgress.findIndex((item) => item.tool === "experience" && item.input?.action === "read");
            const imageIndex = runProgress.findIndex((item) => item.tool === "image_gen" || String(item.phase || "").startsWith("image-"));
            const orderedExperienceRead = !wantsExperienceRead || (experienceReadIndex >= 0 && (!wantsImage || (imageIndex >= 0 && experienceReadIndex <= imageIndex)));
            const unexpectedWorkflowClear = workflowInputs.some((input) => input.operation === "clear_canvas");
            const workflowClearOk = !unexpectedWorkflowClear || Boolean(expect.allowWorkflowClear);
            const imageTaskModalOpen = Boolean(document.querySelector(".image-task-dialog.image-create-dialog"));
            const askUserDialogOpen = Boolean(document.querySelector(".ask-user-dialog"));
            const referencePickerDialogOpen = Boolean(document.querySelector(".reference-picker-dialog"));
            const dialogOk = (!expectsAskUser || askUserDialogOpen || referencePickerDialogOpen) && (!expectsReferenceImages || referencePickerDialogOpen);
            const noAskUserDialogOk = !forbidsAskUserDialog || !askUserDialogOpen;
            const noReferenceDialogOk = !forbidsReferenceDialog || !referencePickerDialogOpen;
            const requestToolNames = modelRequestDetails.flatMap((item) => Array.isArray(item?.toolNames) ? item.toolNames.map(String) : []);
            const internalToolsExposed = requestToolNames.filter((name) => name === "memory" || name === "context_manage");
            const internalToolsOk = internalToolsExposed.length === 0;
            const sawRunStart = Boolean(latestRunId && runProgress.some((item) =>
              item.phase === "runtime-request" ||
              item.phase === "runtime-start" ||
              item.phase === "model-request"
            ));
            const sawTerminalSignal = runProgress.some((item) =>
              item.phase === "model-response" ||
              item.phase === "model-error" ||
              item.phase === "runtime-error" ||
              item.phase === "tool-done" ||
              item.phase === "tool-error" ||
              item.phase === "command-done" ||
              item.phase === "command-error" ||
              /^image-(response|error|dry-run)$/i.test(String(item.phase || ""))
            );
            const idle = state.agentStatus === "idle" || state.agentStatus === "error";
            if (idle && sawRunStart && (sawTerminalSignal || state.agentStatus === "error")) {
              const autonomyOk = !modelForce.length && !modelToolChoice.length && !modelArgCorrect.length && !modelContract.length;
              const expectsExecutableProgress = Boolean(
                wantsImage ||
                expectedTools.length ||
                expectedWorkflowOperations.length ||
                wantsExperienceAdd ||
                wantsExperienceRead ||
                expectsAskUser ||
                expectsReferenceImages ||
                commandIncludes ||
                expect.minAssets
              );
              const ok = Boolean(
                state.agentStatus === "idle" &&
                autonomyOk &&
                modelToolEvidenceOk &&
                internalToolsOk &&
                (!wantsImage || usedImageGen) &&
                (!forbidsImage || !usedImageGen) &&
                (!wantsNoTools || !usedAnyTool) &&
                expectedToolsOk &&
                forbiddenToolsOk &&
                expectedWorkflowOperationsOk &&
                commandOk &&
                dialogOk &&
                noAskUserDialogOk &&
                noReferenceDialogOk &&
                (!wantsExperienceAdd || usedExperienceAdd) &&
                (!wantsExperienceRead || usedExperienceRead) &&
                countOk &&
                minAssetsOk &&
                parentOk &&
                generationModeOk &&
                collectionKindOk &&
                resultParentOk &&
                tileContentFillOk &&
                primaryTileColumnWiderOk &&
                duplicateAssistantFinalOk &&
                visiblePromptCountOk &&
                imagePromptOk &&
                promptIncludesOk &&
                promptExcludesOk &&
                orderedExperienceRead &&
                workflowClearOk &&
                !imageTaskModalOpen
              );
              if (!ok && state.agentStatus === "idle" && expectsExecutableProgress) {
                unmetExecutionSince = unmetExecutionSince || Date.now();
                if (Date.now() - unmetExecutionSince < 10000) return;
              }
              window.clearInterval(pollTimer);
              resolve({
                ok,
                label,
                prompt,
                durationMs: Date.now() - startedAt,
                latestRunId,
                autonomyOk,
                usedImageGen,
                usedAnyTool,
                usedToolNames: Array.from(usedToolNames),
                modelCalledToolNames,
                executedToolNames,
                modelToolEvidenceOk,
                modelToolEvidenceMissing,
                usedExperienceAdd,
                usedExperienceRead,
                expectedToolsOk,
                forbiddenToolsOk,
                expectedWorkflowOperationsOk,
                workflowOperations,
                commandOk,
                dialogOk,
                noAskUserDialogOk,
                noReferenceDialogOk,
                internalToolsOk,
                internalToolsExposed,
                countOk,
                minAssetsOk,
                parentOk,
                generationModeOk,
                expectedGenerationMode,
                collectionKindOk,
                expectedCollectionKind,
                resultParentOk,
                expectedResultParentId,
                tileContentFillOk,
                minimumTileContentFill,
                primaryTileColumnWiderOk,
                duplicateAssistantFinalOk,
                duplicateAssistantPairs,
                expectedVisiblePromptCount,
                visiblePromptCount,
                domPromptBlockCount,
                visiblePromptCountOk,
                newImageLayouts,
                imagePromptOk,
                promptIncludesOk,
                promptExcludesOk,
                promptIncludes,
                promptExcludes,
                orderedExperienceRead,
                unexpectedWorkflowClear,
                imageTaskModalOpen,
                askUserDialogOpen,
                newImageNodes,
                newAssetCount,
                imageInputs,
                experienceInputs,
                workflowInputs,
                commandInputs,
                askUserInputs,
                webSearchInputs,
                viewImageInputs,
                latestImageInput,
                modelForce,
                modelToolChoice,
                modelArgCorrect,
                modelContract,
                modelRequestDetails,
                modelResponseDetails,
                askUserDialogOpen,
                referencePickerDialogOpen,
                runProgress,
                sawRunStart,
                sawTerminalSignal,
                beforeState,
                state,
                error: ok ? "" : "Real composer step did not meet expected agent behavior."
              });
              return;
            }
            if (Date.now() - pollStartedAt > timeoutMs) {
              window.clearInterval(pollTimer);
              fail("step timed out", { latestRunId, runProgress, beforeState, timeoutMs });
            }
          }, 260);
          return;
        }
        if (Date.now() - submitStartedAt > 5000) {
          window.clearInterval(submitTimer);
          fail("send button did not become enabled", { beforeState });
        }
      }, 80);
    }, 240);
  })`;
}

function summariseStep(step) {
  return {
    label: step.label,
    ok: step.ok,
    error: step.error || "",
    usedImageGen: step.usedImageGen,
    usedAnyTool: step.usedAnyTool,
    usedToolNames: step.usedToolNames || [],
    modelCalledToolNames: step.modelCalledToolNames || [],
    executedToolNames: step.executedToolNames || [],
    modelToolEvidenceOk: step.modelToolEvidenceOk,
    modelToolEvidenceMissing: step.modelToolEvidenceMissing || [],
    usedExperienceAdd: step.usedExperienceAdd,
    usedExperienceRead: step.usedExperienceRead,
    workflowOperations: step.workflowOperations || [],
    newAssetCount: step.newAssetCount,
    countOk: step.countOk,
    parentOk: step.parentOk,
    generationModeOk: step.generationModeOk,
    expectedGenerationMode: step.expectedGenerationMode || "",
    collectionKindOk: step.collectionKindOk,
    expectedCollectionKind: step.expectedCollectionKind || "",
    resultParentOk: step.resultParentOk,
    expectedResultParentId: step.expectedResultParentId || "",
    tileContentFillOk: step.tileContentFillOk,
    minimumTileContentFill: step.minimumTileContentFill || 0,
    primaryTileColumnWiderOk: step.primaryTileColumnWiderOk,
    duplicateAssistantFinalOk: step.duplicateAssistantFinalOk,
    duplicateAssistantPairs: step.duplicateAssistantPairs || [],
    expectedVisiblePromptCount: step.expectedVisiblePromptCount || 0,
    visiblePromptCount: step.visiblePromptCount || 0,
    domPromptBlockCount: step.domPromptBlockCount || 0,
    visiblePromptCountOk: step.visiblePromptCountOk,
    imagePromptOk: step.imagePromptOk,
    promptIncludesOk: step.promptIncludesOk,
    promptExcludesOk: step.promptExcludesOk,
    promptIncludes: step.promptIncludes || [],
    promptExcludes: step.promptExcludes || [],
    autonomyOk: step.autonomyOk,
    internalToolsOk: step.internalToolsOk,
    forbiddenToolsOk: step.forbiddenToolsOk,
    expectedWorkflowOperationsOk: step.expectedWorkflowOperationsOk,
    commandOk: step.commandOk,
    dialogOk: step.dialogOk,
    dialogLayoutOk: step.dialogLayoutOk,
    dialogMetricSummary: step.dialogMetricSummary || "",
    noAskUserDialogOk: step.noAskUserDialogOk,
    noReferenceDialogOk: step.noReferenceDialogOk,
    askUserDialogOpen: step.askUserDialogOpen,
    referencePickerDialogOpen: step.referencePickerDialogOpen,
    modelForce: step.modelForce?.length || 0,
    modelToolChoice: step.modelToolChoice?.length || 0,
    modelArgCorrect: step.modelArgCorrect?.length || 0,
    modelContract: step.modelContract?.length || 0,
    exposedInternalTools: step.internalToolsExposed || [],
    stressNodeCount: step.stressNodeCount,
    stressLayoutCount: step.stressLayoutCount,
    stressSelectedViewportOk: step.stressSelectedViewportOk,
    stressDebugAvgMs: step.stressDebugAvgMs,
    stressDebugMaxMs: step.stressDebugMaxMs,
    stressSetupMs: step.stressSetupMs,
    stressParentedNodeCount: step.stressParentedNodeCount,
    uiIssueCount: step.uiIssueCount,
    uiIssues: step.uiIssues || [],
    uiAudits: step.uiAudits || [],
    contextCompactOk: step.contextCompactOk,
    contextCompactEventCount: step.contextCompactEventCount,
    seededMessageCount: step.seededMessageCount,
    runtimeTransientRetries: step.runtimeTransientRetries || 0,
    cpuOverloadRetries: step.cpuOverloadRetries || 0,
    toolCalls: step.modelResponseDetails?.map((item) => item?.toolCalls?.map((call) => call.name).join("+") || `count=${item?.toolCallCount ?? "?"}`).join("|") || ""
  };
}

function writeReport(steps, screenshots) {
  const ok = steps.every((step) => step.ok);
  const contactSheet = writeScreenshotContactSheet(screenshots);
  const contactSheetPng = writeScreenshotContactSheetPng(screenshots);
  const lines = [
    "# naimage Agent Human Suite",
    "",
    `- ok: ${ok}`,
    `- suite: ${suiteName}`,
    `- runDir: ${runDir}`,
    `- debugPort: ${debugPort}`,
    `- screenshots: ${screenshots.join(" | ")}`,
    contactSheet ? `- screenshotContactSheet: ${contactSheet}` : "",
    contactSheetPng ? `- screenshotContactSheetPng: ${contactSheetPng}` : "",
    "",
    "## Prompt Set",
    "",
    ...steps.map((step) => `- ${step.label}: ${step.prompt}`),
    "",
    "## Results",
    "",
    ...steps.map((step) => {
      const s = summariseStep(step);
      const stress = s.stressNodeCount === undefined ? "" : `, stress=${s.stressNodeCount}/${s.stressLayoutCount}, viewport=${s.stressSelectedViewportOk ? "ok" : "fail"}, parented=${s.stressParentedNodeCount ?? "-"}, debugAvg=${s.stressDebugAvgMs}ms, debugMax=${s.stressDebugMaxMs}ms, setup=${s.stressSetupMs}ms`;
      const compact = s.contextCompactOk === undefined ? "" : `, compact=${s.contextCompactOk ? "ok" : "fail"}(${s.contextCompactEventCount ?? 0}), seeded=${s.seededMessageCount ?? "-"}`;
      const dialogLayout = s.dialogLayoutOk === undefined ? "" : `, layout=${s.dialogLayoutOk ? "ok" : "fail"}${s.dialogMetricSummary ? `(${s.dialogMetricSummary})` : ""}`;
      const ui = s.uiIssueCount === undefined ? "" : `, uiIssues=${s.uiIssueCount}${s.uiIssues?.length ? `(${s.uiIssues.slice(0, 4).join(" | ")})` : ""}`;
      const mode = s.expectedGenerationMode ? `, mode=${s.expectedGenerationMode}:${s.generationModeOk ? "ok" : "fail"}` : "";
      const collection = s.expectedCollectionKind ? `, collection=${s.expectedCollectionKind}:${s.collectionKindOk ? "ok" : "fail"}` : "";
      const resultParent = s.expectedResultParentId ? `, resultParent=${s.resultParentOk ? "ok" : "fail"}` : "";
      const fill = s.minimumTileContentFill ? `, tileFill=${s.tileContentFillOk ? "ok" : "fail"}` : "";
      const mosaic = s.primaryTileColumnWiderOk === undefined ? "" : `, mosaic=${s.primaryTileColumnWiderOk ? "ok" : "fail"}`;
      const duplicate = s.duplicateAssistantFinalOk === undefined ? "" : `, finalDedup=${s.duplicateAssistantFinalOk ? "ok" : "fail"}`;
      return `- ${s.label}: ok=${s.ok}, tools=${s.usedToolNames?.length ? s.usedToolNames.join("+") : "none"}, modelToolEvidence=${s.modelToolEvidenceOk === false ? `fail(${s.modelToolEvidenceMissing?.join("+") || "missing"})` : "ok"}, workflowOps=${s.workflowOperations?.length ? s.workflowOperations.join("+") : "none"}, image=${s.usedImageGen ? "yes" : "no"}, expAdd=${s.usedExperienceAdd ? "yes" : "no"}, expRead=${s.usedExperienceRead ? "yes" : "no"}, assets=${s.newAssetCount ?? 0}, count=${s.countOk ? "ok" : "fail"}, parent=${s.parentOk ? "ok" : "fail"}${mode}${collection}${resultParent}${fill}${mosaic}${duplicate}, prompt=${s.imagePromptOk ? "ok" : "fail"}, includes=${s.promptIncludesOk === false ? "fail" : "ok"}, excludes=${s.promptExcludesOk === false ? "fail" : "ok"}, autonomy=${s.autonomyOk ? "ok" : "fail"}, internalTools=${s.internalToolsOk ? "ok" : "fail"}, forbidden=${s.forbiddenToolsOk === false ? "fail" : "ok"}, workflowExpect=${s.expectedWorkflowOperationsOk ? "ok" : "fail"}, command=${s.commandOk ? "ok" : "fail"}, dialog=${s.dialogOk ? "ok" : "fail"}${dialogLayout}${ui}, noAskDialog=${s.noAskUserDialogOk === false ? "fail" : "ok"}, noRefDialog=${s.noReferenceDialogOk === false ? "fail" : "ok"}, force=${s.modelForce}, toolChoice=${s.modelToolChoice}, argCorrect=${s.modelArgCorrect}, contract=${s.modelContract}, retries=${s.runtimeTransientRetries}/${s.cpuOverloadRetries}, calls=${s.toolCalls || "none"}${stress}${compact}${s.error ? `, error=${s.error}` : ""}`;
    }),
    "",
    "## Raw Summary",
    "",
    "```json",
    JSON.stringify(steps.map(summariseStep), null, 2),
    "```",
    "",
    "## Next",
    "",
    ok
      ? "- Continue broader prompt variation and verify no context_manage tool is exposed to the main Agent."
      : "- Fix the first failed step before expanding the suite."
  ];
  writeFileSync(desktopLog, `${lines.join("\n")}\n`);
  writeFileSync(join(runDir, "report.json"), JSON.stringify({ ok, runDir, desktopLog, screenshots, screenshotContactSheet: contactSheet, screenshotContactSheetPng: contactSheetPng, steps }, null, 2));
  return ok;
}

async function main() {
  if (!statusRequested) acquireUiLock();
  const target = await waitForTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await evaluate(client, "Boolean(document.querySelector('.agent-composer textarea, .project-agent-composer textarea'))", 20000);

  const steps = [];
  const screenshots = [];
  failureContext.steps = steps;
  failureContext.screenshots = screenshots;
  try {
    if (statusRequested) {
      const state = await evaluate(
        client,
        `(() => {
          const debugState = window.__naimageDebugAgentState?.() || {};
          const nodes = Array.isArray(debugState.nodes) ? debugState.nodes : [];
          const selectedNode = nodes.find((node) => String(node.id || "") === String(debugState.selectedNodeId || ""));
          return {
            url: location.href,
            title: document.title,
            agentStatus: debugState.agentStatus || "",
            nodeCount: Number(debugState.nodeCount ?? nodes.length ?? 0),
            layoutCount: Number(debugState.layoutCount ?? 0),
            parentedNodeCount: Number(debugState.parentedNodeCount ?? 0),
            selectedNodeId: debugState.selectedNodeId || "",
            selectedNodeType: selectedNode?.type || "",
            selectedNodeParentId: debugState.selectedNodeParentId || selectedNode?.parentId || "",
            latestRunId: debugState.latestRunId || "",
            imageTaskModalOpen: Boolean(document.querySelector(".image-task-dialog.image-create-dialog")),
            askUserDialogOpen: Boolean(document.querySelector(".ask-user-dialog")),
            referencePickerDialogOpen: Boolean(document.querySelector(".reference-picker-dialog")),
            composerReady: Boolean(document.querySelector(".agent-composer textarea, .project-agent-composer textarea")),
            nodes: nodes.slice(-12).map((node) => ({
              id: node.id,
              type: node.type,
              title: node.title,
              parentId: node.parentId || "",
              imageState: node.imageState || "",
              assetCount: node.assetCount || 0
            }))
          };
        })()`,
        20000
      );
      const screenshotPath = statusScreenshotRequested ? await screenshot(client, "status") : "";
      console.log(JSON.stringify({ ok: true, mode: "status", debugPort, runDir, screenshot: screenshotPath, state }, null, 2));
      return;
    }

    const runComposerStep = async (index, label, prompt, expect, evalTimeoutMs = 180000) => {
      let stepResult = null;
      let overloadAttempts = 0;
      let transientAttempts = 0;
      const fixedSuiteTimeoutFloorMs = oneShotMode ? 0 : 195000;
      const effectiveExpect = {
        ...expect,
        timeoutMs: Math.max(Number(expect?.timeoutMs || 0), fixedSuiteTimeoutFloorMs)
      };
      const effectiveEvalTimeoutMs = Math.max(evalTimeoutMs, Number(effectiveExpect.timeoutMs || 0) + 30000);
      for (let attempt = 0; attempt <= cpuOverloadRetries; attempt += 1) {
        await closeTransientDialogs(client);
        stepResult = await evaluate(
          client,
          realComposerStepExpression(label, prompt, effectiveExpect),
          effectiveEvalTimeoutMs
        );
        const retryReason = transientRuntimeRetryReason(stepResult);
        if (!retryReason || attempt >= cpuOverloadRetries) break;
        if (retryReason === "cpu-overload") overloadAttempts += 1;
        transientAttempts += 1;
        await delay(cpuOverloadRetryMs);
      }
      if (stepResult && transientAttempts) {
        stepResult.runtimeTransientRetries = transientAttempts;
        stepResult.cpuOverloadRetries = overloadAttempts;
        stepResult.error = stepResult.ok ? "" : `${stepResult.error || "Real composer step did not meet expected agent behavior."} (runtime transient retries: ${transientAttempts}, cpu overload retries: ${overloadAttempts})`;
      }
      steps.push(stepResult);
      screenshots.push(await screenshot(client, `${String(index).padStart(2, "0")}-${label}`));
      if (!stepResult?.ok && ["thinking", "editing"].includes(String(stepResult?.state?.agentStatus || ""))) {
        stepResult.cleanup = await evaluate(
          client,
          `new Promise((resolve) => {
            const startedAt = Date.now();
            const stop = document.querySelector(".send-button.is-stop, button[aria-label='停止']");
            stop?.click();
            const timer = window.setInterval(() => {
              const status = String(window.__naimageDebugAgentState?.()?.agentStatus || "");
              if (!["thinking", "editing"].includes(status) || Date.now() - startedAt > 20000) {
                window.clearInterval(timer);
                resolve({ clicked: Boolean(stop), status, elapsedMs: Date.now() - startedAt });
              }
            }, 120);
          })`,
          25000
        ).catch((error) => ({ clicked: false, status: "cleanup-error", error: String(error) }));
      }
      await closeTransientDialogs(client);
      return stepResult;
    };

    if (oneShotMode) {
      await runComposerStep(
        1,
        oneShotLabel,
        String(oneShotPrompt || "").trim(),
        oneShotExpect,
        oneShotEvalTimeoutMs
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, mode: "one-shot", suite: suiteName, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "ui-agent-polish") {
      const result = await evaluate(
        client,
        `new Promise((resolve) => {
          const waitFor = (predicate, timeout = 8000) => new Promise((done) => {
            const startedAt = performance.now();
            const tick = () => {
              let value = null;
              try { value = predicate(); } catch {}
              if (value) return done(value);
              if (performance.now() - startedAt > timeout) return done(null);
              window.setTimeout(tick, 80);
            };
            tick();
          });
          const px = (value) => Number.parseFloat(String(value || "0")) || 0;
          const rectOf = (element) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            };
          };
          (async () => {
            window.__naimageDebugOpenSurface?.("main");
            const seeded = window.__naimageDebugSeedAgentMessages?.({
              messages: [
                {
                  id: "aidebug-agent-polish-user",
                  role: "user",
                  status: "done",
                  content: "帮我生成一张测试图，并把结果同步到画布节点。"
                },
                {
                  id: "aidebug-agent-polish-thought",
                  role: "assistant",
                  status: "running",
                  meta: "thinking",
                  collapsed: false,
                  content: "正在解析用户的生图目标，并确认是否需要调用 Image Gen。"
                },
                {
                  id: "aidebug-agent-polish-workflow",
                  role: "assistant",
                  status: "done",
                  content: "",
                  toolTrace: {
                    label: "Workflow",
                    name: "workflow",
                    operation: "list_nodes",
                    brief: "读取当前画布节点。"
                  }
                },
                {
                  id: "aidebug-agent-polish-imagegen",
                  role: "assistant",
                  status: "running",
                  content: "",
                  toolTrace: {
                    label: "Image Gen",
                    name: "image_gen",
                    operation: "generate",
                    brief: "根据提示生成图片，并同步到画布节点。"
                  }
                },
                {
                  id: "aidebug-agent-polish-summary",
                  role: "assistant",
                  status: "done",
                  content: "已生成1张图片，节点已同步。"
                }
              ]
            });
            const ready = await waitFor(() => document.querySelectorAll(".agent-tool-trace").length >= 2 && document.querySelector(".agent-tool-imagegen-timer"));
            const toolCards = Array.from(document.querySelectorAll(".agent-tool-trace"));
            const imageCard = toolCards.find((card) => /Image Gen/i.test(card.textContent || "")) || null;
            const workflowCard = toolCards.find((card) => /WorkFlow|Workflow/i.test(card.textContent || "")) || null;
            const thinkingBlock = document.querySelector(".agent-thinking-block");
            const imageMessage = imageCard?.closest(".agent-message");
            const workflowMessage = workflowCard?.closest(".agent-message");
            const imageCardStyle = imageCard ? getComputedStyle(imageCard) : null;
            const workflowCardStyle = workflowCard ? getComputedStyle(workflowCard) : null;
            const thinkingStyle = thinkingBlock ? getComputedStyle(thinkingBlock) : null;
            const imageMessageStyle = imageMessage ? getComputedStyle(imageMessage) : null;
            const feedText = (document.querySelector(".agent-feed, .project-agent-feed")?.textContent || "").replace(/\\s+/g, " ").trim();
            const toolTitles = toolCards.map((card) => (card.querySelector(".agent-tool-trace-title")?.textContent || "").replace(/\\s+/g, " ").trim());
            const briefs = Array.from(document.querySelectorAll(".agent-tool-brief-outside")).map((node) => (node.textContent || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
            const imageTimerText = (document.querySelector(".agent-tool-imagegen-timer")?.textContent || "").replace(/\\s+/g, " ").trim();
            const detail = {
              seeded: Boolean(seeded),
              ready: Boolean(ready),
              cardCount: toolCards.length,
              imageTitleOk: Boolean(imageCard && !imageCard.querySelector(".agent-tool-trace-title")),
              workflowTitleOk: /正在使用工具 ·\\s*WorkFlow|正在使用工具 ·\\s*Workflow/.test(toolTitles.join("\\n")),
              briefOutsideOk: briefs.length >= 1 && toolCards.every((card) => !card.querySelector(".agent-tool-brief-outside, .agent-tool-trace-brief")),
              imageTimerOk: /Image Gen 正在绘图\\s*\\d+s/.test(imageTimerText),
              conciseSummaryOk: /已生成1张图片，节点已同步/.test(feedText),
              noLegacyRunningText: !/仍在执行|正在思考/.test(feedText),
              toolBorderLeftPx: imageCardStyle ? px(imageCardStyle.borderLeftWidth) : -1,
              workflowToolBorderLeftPx: workflowCardStyle ? px(workflowCardStyle.borderLeftWidth) : -1,
              thinkingBorderLeftPx: thinkingStyle ? px(thinkingStyle.borderLeftWidth) : -1,
              timelineBorderLeftPx: imageMessageStyle ? px(imageMessageStyle.borderLeftWidth) : -1,
              imageCardRect: rectOf(imageCard),
              workflowCardRect: rectOf(workflowCard),
              imageMessageRect: rectOf(imageMessage),
              workflowMessageRect: rectOf(workflowMessage),
              toolTitles,
              briefs,
              imageTimerText,
              feedText: feedText.slice(0, 800)
            };
            detail.toolTraceNoLeftRuleOk = detail.toolBorderLeftPx === 0 && detail.workflowToolBorderLeftPx === 0;
            detail.thoughtNoLeftRuleOk = detail.thinkingBorderLeftPx === 0;
            detail.timelineLeftRuleOk = detail.timelineBorderLeftPx >= 0.5;
            detail.ok = Boolean(
              detail.seeded &&
              detail.ready &&
              detail.cardCount >= 2 &&
              detail.imageTitleOk &&
              detail.workflowTitleOk &&
              detail.briefOutsideOk &&
              detail.imageTimerOk &&
              detail.conciseSummaryOk &&
              detail.noLegacyRunningText &&
              detail.toolTraceNoLeftRuleOk &&
              detail.thoughtNoLeftRuleOk &&
              detail.timelineLeftRuleOk
            );
            resolve(detail);
          })().catch((error) => resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        })`,
        30000
      );
      screenshots.push(await screenshot(client, "01-ui-agent-polish"));
      const step = {
        label: "ui-agent-polish",
        prompt: "seed Agent thoughts/tool traces and verify timeline, tool card, Image Gen timer, and concise status styling",
        ok: Boolean(result?.ok),
        error: result?.ok ? "" : `Agent polish failed: ${JSON.stringify(result)}`,
        usedImageGen: false,
        usedAnyTool: false,
        usedToolNames: [],
        autonomyOk: true,
        internalToolsOk: true,
        forbiddenToolsOk: true,
        expectedWorkflowOperationsOk: true,
        commandOk: true,
        dialogOk: true,
        noAskUserDialogOk: true,
        noReferenceDialogOk: true,
        countOk: true,
        parentOk: true,
        imagePromptOk: true,
        promptIncludesOk: Boolean(result?.imageTitleOk && result?.briefOk && result?.conciseSummaryOk),
        promptExcludesOk: Boolean(result?.noLegacyRunningText),
        agentPolish: result
      };
      steps.push(step);
      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, result, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "plain-chat") {
      await runComposerStep(
        1,
        "plain-no-tool-agent-boundary",
        "先别画图，也别动任何工具。用一句话说清楚：Agent 遇到需要真实执行的请求时应该怎么做？",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        120000
      );

      await runComposerStep(
        2,
        "plain-no-tool-workflow-boundary",
        "还是不要调用工具。只用一句话回答：workflow 和 image_gen 的区别是什么？",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        120000
      );

      await runComposerStep(
        3,
        "plain-no-tool-command-boundary",
        "不要调用工具，只回答一句：shell_command 和 workflow 分别适合什么场景？",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        120000
      );

      await runComposerStep(
        4,
        "plain-no-tool-memory-boundary",
        "别动工具，只用一句话解释：experience、FastMemory 和 ask_user 分别是什么？",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        120000
      );

      await runComposerStep(
        5,
        "plain-no-tool-observe-boundary",
        "还是不要调用工具，说明 view_image 和 web_search 的区别。",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        120000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "tools") {
      await runComposerStep(
        1,
        "workflow-image-only-boundary",
        "检查一下当前画布有哪些图片成果；不要创建备注、提示词、任务或其他非图片节点，也不要生图。",
        { tools: ["workflow"], workflowOperations: ["list_nodes"], noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        2,
        "workflow-list-nodes",
        "看看当前画布有哪些节点，不要生图。",
        { tools: ["workflow"], workflowOperations: ["list_nodes"], noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        3,
        "workflow-clear-canvas",
        "把画布清理一下，不要生图。",
        { tools: ["workflow"], workflowOperations: ["clear_canvas"], allowWorkflowClear: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        4,
        "command-get-location",
        "用 shell_command 执行 Get-Location 看一下当前项目目录，不要生图。",
        { tools: ["shell_command"], commandIncludes: "Get-Location", noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        5,
        "experience-add",
        "别画图，记一下：以后这种近景角色图要干净、有设计感，脸部不要油，背景不要空，但也别像证件照。",
        { tools: ["experience"], experienceAdd: true, noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        6,
        "experience-read",
        "先把刚才记下来的绘画经验读一下给我看，别画图。",
        { tools: ["experience"], experienceRead: true, noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        7,
        "web-search",
        "请用 web_search 查一下 naimage Agent 工具 schema 设计这个关键词，不要生图。",
        { tools: ["web_search"], noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        8,
        "ask-user-reference",
        "我想按参考图改一张图，但我还没上传参考图；请先问我要参考图，不要生图。",
        { tools: ["ask_user"], askUser: true, referenceImages: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        9,
        "view-image-local",
        `用 view_image 观察这张本地图片：${viewFixturePath}。只检查它能不能作为本地图片上下文登记，不要生图。`,
        { tools: ["view_image"], noImage: true, timeoutMs: 120000 },
        150000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, runDir, desktopLog, screenshots, viewFixturePath, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "tool-natural") {
      const isolation = await evaluate(
        client,
        `Promise.resolve(window.__naimageAIDebug?.newConversation?.()).then((result) => ({
          ok: Boolean(result?.ok && result?.fastMemoryEmpty === true && Number(result?.fastMemoryLength || 0) === 0),
          previousConversationId: result?.previousConversationId || "",
          conversationId: result?.conversationId || "",
          fastMemoryEmpty: result?.fastMemoryEmpty === true,
          fastMemoryLength: Number(result?.fastMemoryLength || 0)
        }))`,
        20000
      );
      if (!isolation?.ok) throw new Error(`tool-natural new conversation isolation failed: ${JSON.stringify(isolation)}`);
      await runComposerStep(
        1,
        "natural-workflow-list",
        "画布现在都有什么内容？帮我看一眼就行，先别生成图片。",
        { tools: ["workflow"], workflowOperations: ["list_nodes"], noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        2,
        "natural-command-location",
        "我想确认一下这个项目当前实际工作目录在哪里，帮我查一下，不要动图片和画布。",
        { tools: ["shell_command"], commandIncludes: "Get-Location", noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        3,
        "natural-workflow-clear",
        "这个画布先清空，准备重新来一轮，不要生成图。",
        { tools: ["workflow"], workflowOperations: ["clear_canvas"], allowWorkflowClear: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        4,
        "natural-image-generate",
        "直接生成一张东方审美的黑长直公主切近景角色微海报，二次元写实但不要太写实，画面干净、有设计感，不要文字。",
        { tools: ["image_gen"], image: true, imageCount: 1, minAssets: 1, noAskUserDialog: true, noReferenceDialog: true, timeoutMs: 300000 },
        340000
      );

      await runComposerStep(
        5,
        "natural-workflow-describe-image",
        "查看刚生成的当前图片成果详情，告诉我它的来源和文件信息；不要再生图，也不要创建其他节点。",
        { tools: ["workflow"], workflowOperations: ["describe_node"], noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        6,
        "natural-experience-add",
        "这类近景角色以后记住：脸部要清爽，背景不能空，整体要像精致微海报，不要证件照感。今天先别画。",
        { tools: ["experience"], experienceAdd: true, noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        7,
        "natural-experience-read",
        "刚才沉淀的绘画经验先翻出来给我看，暂时别画。",
        { tools: ["experience"], experienceRead: true, noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        8,
        "natural-web-search",
        "联网查一下 OpenAI image generation docs 里 image generation 这个关键词，简单看结果就好，不要生图。",
        { tools: ["web_search"], noImage: true, timeoutMs: 140000 },
        170000
      );

      await runComposerStep(
        9,
        "natural-view-image",
        `帮我看看这个本地文件能不能作为图片上下文登记：${viewFixturePath}。不要生成图片。`,
        { tools: ["view_image"], noImage: true, timeoutMs: 120000 },
        150000
      );

      await runComposerStep(
        10,
        "natural-ask-reference",
        "我想照着一张参考图改画面，但是图还没传。你先问我要图，不要自己想象，也不要先生成。",
        { tools: ["ask_user"], askUser: true, referenceImages: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, isolation, runDir, desktopLog, screenshots, viewFixturePath, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "context-compact-tools") {
      const marker = `AIDEBUG_CONTEXT_COMPACT_TOOLS_${Date.now()}`;
      const seededMessageCount = 48;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          Promise.resolve(window.__naimageAIDebug?.newConversation?.()).then((freshConversation) => {
            const messages = Array.from({ length: ${seededMessageCount} }, (_item, index) => ({
              role: index % 2 === 0 ? "user" : "assistant",
              content: [
                ${JSON.stringify(marker)},
                "历史压缩协议样本 " + String(index + 1).padStart(2, "0"),
                "用户目标始终是让 Agent 自然选择工具、真实执行、不要把文字承诺当完成。",
                "绘图偏好：二次元写实、公主切、东方审美、小红书微海报、脸部清爽、背景有层次。",
                "工具边界：workflow 管画布，view_image 看本地图片，image_gen 真实生图，experience 只存绘画经验。"
              ].join("\\n")
            }));
            let ok = true;
            for (let index = 0; index < messages.length; index += 12) {
              ok = Boolean(window.__naimageDebugSeedAgentMessages?.({
                messages: messages.slice(index, index + 12),
                append: index > 0
              })) && ok;
            }
            const cleared = window.__naimageDebugApplyAgentActions?.([{ type: "workflow.canvas.clear", mode: "all" }]);
            window.setTimeout(() => {
              const state = window.__naimageDebugAgentState?.() || {};
              resolve({
                ok: Boolean(ok && cleared && freshConversation?.ok && freshConversation?.fastMemoryEmpty === true),
                freshConversation,
                messageCount: Number(state.messageCount || 0),
                nodeCount: Number(state.nodeCount || 0),
                state
              });
            }, 700);
          }).catch((error) => resolve({ ok: false, error: String(error), state: window.__naimageDebugAgentState?.() }));
        })`,
        30000
      );
      screenshots.push(await screenshot(client, "00-context-compact-tools-setup"));
      if (!setup?.ok || Number(setup?.messageCount || 0) < 30) {
        steps.push({
          ok: false,
          label: "context-compact-setup",
          prompt: "seed long visible conversation and clear canvas",
          error: `Failed to seed long conversation. messageCount=${setup?.messageCount ?? "?"}`,
          state: setup?.state,
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          workflowOperations: [],
          countOk: true,
          parentOk: true,
          imagePromptOk: true,
          promptIncludesOk: true,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          seededMessageCount
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      const compactStep = await runComposerStep(
        1,
        "compact-workflow-list",
        `这轮是长会话压缩后的工具协议测试，标记 ${marker}。先帮我看一眼画布现在有什么，不要生图。`,
        { tools: ["workflow"], workflowOperations: ["list_nodes"], noImage: true, timeoutMs: 220000 },
        260000
      );
      const compactEvents = (Array.isArray(compactStep.runProgress) ? compactStep.runProgress : []).filter((item) => String(item?.phase || "").startsWith("context-compact"));
      compactStep.contextCompactEventCount = compactEvents.length;
      compactStep.contextCompactOk = compactEvents.some((item) => item.phase === "context-compact-done");
      compactStep.seededMessageCount = seededMessageCount;
      compactStep.ok = Boolean(compactStep.ok && compactStep.contextCompactOk);
      if (!compactStep.contextCompactOk) {
        compactStep.error = compactStep.error || "Expected context compact events before workflow tool execution.";
      }

      await runComposerStep(
        2,
        "compact-view-image",
        `压缩之后再帮我看看这个本地图片文件能不能登记成图片上下文：${viewFixturePath}。不要生成图片。`,
        { tools: ["view_image"], noImage: true, noAskUserDialog: true, noReferenceDialog: true, timeoutMs: 140000 },
        180000
      );

      await runComposerStep(
        3,
        "compact-image-generate",
        "现在真实生成一张竖屏小红书微海报风的二次元写实黑长直公主切近景角色图，东方审美，有设计感和艺术感，不要太写实，不要九宫格，不要把任何说明文字画进画面。",
        {
          tools: ["image_gen"],
          image: true,
          minAssets: 1,
          promptIncludes: ["黑长直", "公主切"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 360000
        },
        420000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "feedback-after-compact") {
      const marker = `AIDEBUG_FEEDBACK_AFTER_COMPACT_${Date.now()}`;
      const seededMessageCount = 48;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          Promise.resolve(window.__naimageAIDebug?.newConversation?.()).then((freshConversation) => {
            const prompt = "${marker} source image: 竖屏小红书微海报风，东方审美黑长直公主切近景角色图，二次元写实但不要太写实，背景高级有设计感。";
            const messages = Array.from({ length: ${seededMessageCount} }, (_item, index) => ({
              role: index % 2 === 0 ? "user" : "assistant",
              content: [
                ${JSON.stringify(marker)},
                "历史压缩反馈续图样本 " + String(index + 1).padStart(2, "0"),
                "用户目标：让 Agent 理解自然反馈，在需要续图时直接真实调用 image_gen。",
                "绘图偏好：二次元写实、黑长直、公主切近景、东方审美、小红书微海报、脸部清爽、背景有层次。",
                "工具边界：experience 只沉淀绘画经验，不应把本次续图反馈当成 FastMemory 写入完成。"
              ].join("\\n")
            }));
            let seeded = true;
            for (let index = 0; index < messages.length; index += 12) {
              seeded = Boolean(window.__naimageDebugSeedAgentMessages?.({
                messages: messages.slice(index, index + 12),
                append: index > 0
              })) && seeded;
            }
            const applied = window.__naimageDebugApplyAgentActions?.([
              { type: "workflow.canvas.clear", mode: "all" },
              {
                type: "workflow.node.create",
                toolRunId: "aidebug-feedback-after-compact-source",
                node: {
                  title: "AIDebug 压缩后反馈续图源图",
                  prompt,
                  nodeType: "image",
                  status: "done",
                  x: 180,
                  y: 150,
                  outputs: 1,
                  assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-feedback-after-compact-source", revisedPrompt: prompt }],
                  imageState: "done",
                  imageParams: {
                    prompt,
                    size: "768x1024",
                    ratio: "3:4",
                    resolution: "1080P",
                    count: 1,
                    quality: "auto",
                    batchMode: "parallel",
                    referenceImages: []
                  }
                }
              }
            ]);
            window.setTimeout(async () => {
              const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
              const state = window.__naimageDebugAgentState?.() || {};
              resolve({
                ok: Boolean(seeded && applied && freshConversation?.ok && freshConversation?.fastMemoryEmpty === true),
                freshConversation,
                selected,
                messageCount: Number(state.messageCount || 0),
                nodeCount: Number(state.nodeCount || 0),
                state
              });
            }, 900);
          }).catch((error) => resolve({ ok: false, error: String(error), state: window.__naimageDebugAgentState?.() }));
        })`,
        30000
      );
      screenshots.push(await screenshot(client, "00-feedback-after-compact-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || Number(setup?.messageCount || 0) < 30 || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "feedback-after-compact-setup",
          prompt: "seed long visible conversation and selected source image node",
          error: `Failed to seed long conversation/source image. messageCount=${setup?.messageCount ?? "?"}, sourceNodeId=${sourceNodeId || "?"}`,
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: true,
          parentOk: Boolean(sourceNodeId),
          imagePromptOk: false,
          promptIncludesOk: false,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: [],
          seededMessageCount
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      const compactStep = await runComposerStep(
        1,
        "feedback-continue-after-compact",
        "这张脸有点油，背景稍微空，保留黑长直公主切近景这个方向，继续补一张，更有设计感，不要太写实，不要加字。",
        {
          tools: ["experience", "image_gen"],
          forbidTools: ["workflow", "ask_user"],
          experienceAdd: true,
          image: true,
          imageCount: 1,
          minAssets: 1,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          promptIncludes: ["黑长直", "公主切", "哑光", "背景"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 360000
        },
        420000
      );
      const compactEvents = (Array.isArray(compactStep.runProgress) ? compactStep.runProgress : []).filter((item) => String(item?.phase || "").startsWith("context-compact"));
      compactStep.contextCompactEventCount = compactEvents.length;
      compactStep.contextCompactOk = compactEvents.some((item) => item.phase === "context-compact-done");
      compactStep.seededMessageCount = seededMessageCount;
      compactStep.ok = Boolean(compactStep.ok && compactStep.contextCompactOk);
      if (!compactStep.contextCompactOk) {
        compactStep.error = compactStep.error || "Expected context compact events before feedback continuation image_gen execution.";
      }

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "ask-user-edge") {
      await runComposerStep(
        1,
        "ask-reference-missing",
        "我想按参考图改一张图，但现在还没上传参考图。你先问我要参考图，不要自己生成，也不要猜。",
        { tools: ["ask_user"], askUser: true, referenceImages: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      const marker = `AIDEBUG_ASK_EDGE_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-ask-edge-source",
              node: {
                title: "AIDebug ask_user 边界源图",
                prompt: "${marker} source image for ask_user reference boundary",
                nodeType: "image",
                status: "done",
                x: 180,
                y: 150,
                outputs: 1,
                assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-ask-edge-source", revisedPrompt: "${marker}" }],
                imageState: "done",
                imageParams: {
                  prompt: "${marker} source image for ask_user reference boundary",
                  size: "768x1024",
                  ratio: "3:4",
                  resolution: "1080P",
                  count: 1,
                  quality: "auto",
                  batchMode: "parallel",
                  referenceImages: []
                }
              }
            }
          ]);
          window.setTimeout(async () => {
            const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
            resolve({ ok: Boolean(ok), selected, state: window.__naimageDebugAgentState?.() });
          }, 700);
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-ask-user-edge-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "ask-user-edge-setup",
          prompt: "create and select image source for ask_user edge tests",
          error: "Failed to create/select ask_user edge source image node.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: false,
          expectedWorkflowOperationsOk: false,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: false,
          noReferenceDialogOk: false,
          countOk: true,
          parentOk: false,
          imagePromptOk: true,
          promptIncludesOk: true,
          promptExcludesOk: true
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await runComposerStep(
        2,
        "selected-source-edit-without-ask",
        "基于当前选中的图片生成一张低饱和冷调版本，保留主体身份和原构图，不要再问我要参考图，也不要脱离当前图凭空重画。",
        {
          tools: ["image_gen"],
          forbidTools: ["ask_user"],
          image: true,
          imageCount: 1,
          minAssets: 1,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 320000
        },
        360000
      );

      await runComposerStep(
        3,
        "vague-aesthetic-defaults",
        "不用问我参数，直接做一张竖屏小红书微海报风的黑长直公主切近景角色图，二次元但带一点写实，不要太写实，东方审美，有设计感。",
        {
          tools: ["image_gen"],
          forbidTools: ["ask_user"],
          image: true,
          minAssets: 1,
          noAskUserDialog: true,
          noReferenceDialog: true,
          promptExcludes: ["用户反馈已写入 FastMemory"],
          timeoutMs: 320000
        },
        360000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "workflow-broad") {
      const marker = `AIDEBUG_WORKFLOW_BROAD_${Date.now()}`;
      const setup = await evaluate(
        client,
        `(async () => {
          window.__naimageDebugOpenSurface?.("main");
          const seeded = await window.__naimageAIDebug?.seedCanvas?.({ count: 2 });
          const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
          const state = window.__naimageDebugAgentState?.();
          return { ok: Boolean(seeded?.ok && selected?.ok && state?.nodes?.every((node) => node.type === "image")), seeded, selected, state };
        })()`,
        20000
      );
      screenshots.push(await screenshot(client, "00-workflow-broad-setup"));
      if (!setup?.ok) {
        steps.push({
          ok: false,
          label: "workflow-broad-setup",
          prompt: "seed two image artifacts",
          error: "Failed to seed image-only workflow broad artifacts.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          autonomyOk: true,
          internalToolsOk: true,
          expectedWorkflowOperationsOk: false,
          commandOk: true,
          dialogOk: true,
          countOk: true,
          parentOk: true,
          imagePromptOk: true,
          promptIncludesOk: true,
          promptExcludesOk: true
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      const focusStep = await runComposerStep(
        1,
        "workflow-focus-a",
        "定位到 A 节点，不要生图。",
        { tools: ["workflow"], workflowOperations: ["focus_node"], noImage: true, timeoutMs: 120000 },
        150000
      );
      focusStep.focusOk = String(focusStep.state?.selectedNodeId || "") === "A";
      focusStep.ok = Boolean(focusStep.ok && focusStep.focusOk);
      focusStep.error = focusStep.ok ? "" : focusStep.error || "A node was not focused.";

      const updateStep = await runComposerStep(
        2,
        "workflow-update-a",
        `把当前节点标题改成 AIDebug 已更新节点，内容改成：${marker} updated prompt。不要生图。`,
        { tools: ["workflow"], workflowOperations: ["update_node"], noImage: true, timeoutMs: 120000 },
        150000
      );
      const updatedA = (Array.isArray(updateStep.state?.nodes) ? updateStep.state.nodes : []).find((node) => node.id === "A");
      updateStep.updateOk = Boolean(updatedA && String(updatedA.title || "").includes("已更新") && String(updatedA.prompt || "").includes("updated prompt"));
      updateStep.ok = Boolean(updateStep.ok && updateStep.updateOk);
      updateStep.error = updateStep.ok ? "" : updateStep.error || "A node was not updated.";

      const connectStep = await runComposerStep(
        3,
        "workflow-connect-a-b",
        "把 A 节点连接到 B 节点，不要生图。",
        { tools: ["workflow"], workflowOperations: ["connect_nodes"], noImage: true, timeoutMs: 120000 },
        150000
      );
      const connectedB = (Array.isArray(connectStep.state?.nodes) ? connectStep.state.nodes : []).find((node) => node.id === "B");
      connectStep.connectOk = Boolean(connectedB && String(connectedB.parentId || "") === "A");
      connectStep.ok = Boolean(connectStep.ok && connectStep.connectOk);
      connectStep.error = connectStep.ok ? "" : connectStep.error || "B node was not connected to A.";

      const disconnectStep = await runComposerStep(
        4,
        "workflow-disconnect-b",
        "断开 B 节点的输入连线，不要生图。",
        { tools: ["workflow"], workflowOperations: ["disconnect_node"], noImage: true, timeoutMs: 120000 },
        150000
      );
      const disconnectedB = (Array.isArray(disconnectStep.state?.nodes) ? disconnectStep.state.nodes : []).find((node) => node.id === "B");
      disconnectStep.disconnectOk = Boolean(disconnectedB && !String(disconnectedB.parentId || ""));
      disconnectStep.ok = Boolean(disconnectStep.ok && disconnectStep.disconnectOk);
      disconnectStep.error = disconnectStep.ok ? "" : disconnectStep.error || "B input connection was not disconnected.";

      const deleteStep = await runComposerStep(
        5,
        "workflow-delete-a-only",
        "删除 A 节点，只删除它本身，不要删除 B 节点，不要生图。",
        { tools: ["workflow"], workflowOperations: ["delete_node"], noImage: true, timeoutMs: 120000 },
        150000
      );
      const finalNodes = Array.isArray(deleteStep.state?.nodes) ? deleteStep.state.nodes : [];
      deleteStep.deleteOk = Boolean(!finalNodes.some((node) => node.id === "A") && finalNodes.some((node) => node.id === "B"));
      deleteStep.ok = Boolean(deleteStep.ok && deleteStep.deleteOk);
      deleteStep.error = deleteStep.ok ? "" : deleteStep.error || "A was not deleted while B remained.";

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "feedback-continuation") {
      const marker = `AIDEBUG_FEEDBACK_SOURCE_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const prompt = "${marker} source image: 竖屏小红书微海报风，东方审美黑长直公主切近景角色图，二次元写实但不要太写实，背景高级有设计感。";
          Promise.resolve(window.__naimageAIDebug?.newConversation?.()).then((freshConversation) => {
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-feedback-continuation-source",
              node: {
                title: "AIDebug 反馈续图源图",
                prompt,
                nodeType: "image",
                status: "done",
                x: 180,
                y: 150,
                outputs: 1,
                assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-feedback-continuation-source", revisedPrompt: prompt }],
                imageState: "done",
                imageParams: {
                  prompt,
                  size: "1024x1365",
                  ratio: "3:4",
                  resolution: "1080P",
                  count: 1,
                  quality: "auto",
                  batchMode: "parallel",
                  referenceImages: []
                }
              }
            }
          ]);
          window.setTimeout(async () => {
            const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
            resolve({ ok: Boolean(ok && freshConversation?.ok !== false && freshConversation?.fastMemoryEmpty === true), freshConversation, selected, state: window.__naimageDebugAgentState?.() });
          }, 700);
          }).catch((error) => resolve({ ok: false, error: String(error), state: window.__naimageDebugAgentState?.() }));
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-feedback-continuation-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "feedback-continuation-setup",
          prompt: "seed selected source image node",
          error: "Failed to create/select feedback continuation source image node.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: true,
          parentOk: false,
          imagePromptOk: false,
          promptIncludesOk: false,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: []
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await runComposerStep(
        1,
        "feedback-continue-source-image",
        "这张脸有点油，背景稍微空，保留黑长直公主切近景这个方向，继续补一张，更有设计感，不要太写实，不要加字。",
        {
          tools: ["experience", "image_gen"],
          forbidTools: ["workflow", "ask_user"],
          experienceAdd: true,
          image: true,
          imageCount: 1,
          minAssets: 1,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          promptIncludes: [marker, "用户反馈与调整方向"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 960000
        },
        1020000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "multi-count-continuation") {
      const marker = `AIDEBUG_MULTI_COUNT_SOURCE_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const prompt = "${marker} source image: 竖屏小红书微海报风，东方审美黑长直公主切近景角色图，二次元写实但不要太写实，画面干净高级，背景有设计层次。";
          Promise.resolve(window.__naimageAIDebug?.newConversation?.()).then((freshConversation) => {
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-multi-count-continuation-source",
              node: {
                title: "AIDebug 多图续作源图",
                prompt,
                nodeType: "image",
                status: "done",
                x: 180,
                y: 150,
                outputs: 1,
                assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-multi-count-continuation-source", revisedPrompt: prompt }],
                imageState: "done",
                imageParams: {
                  prompt,
                  size: "1024x1365",
                  ratio: "3:4",
                  resolution: "1080P",
                  count: 1,
                  quality: "auto",
                  batchMode: "parallel",
                  referenceImages: []
                }
              }
            }
          ]);
          window.setTimeout(async () => {
            const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
            resolve({ ok: Boolean(ok && freshConversation?.ok !== false && freshConversation?.fastMemoryEmpty === true), freshConversation, selected, state: window.__naimageDebugAgentState?.() });
          }, 700);
          }).catch((error) => resolve({ ok: false, error: String(error), state: window.__naimageDebugAgentState?.() }));
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-multi-count-continuation-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "multi-count-continuation-setup",
          prompt: "seed selected source image node for multi-count continuation",
          error: "Failed to create/select multi-count continuation source image node.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: false,
          parentOk: false,
          imagePromptOk: false,
          promptIncludesOk: false,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: []
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await runComposerStep(
        1,
        "multi-count-continue-three",
        "这个方向对了，按这张继续给我整三版，三张独立图就行，不要拼一起，也别做九宫格，别太写实。",
        {
          tools: ["experience", "image_gen"],
          forbidTools: ["workflow", "ask_user"],
          experienceAdd: true,
          image: true,
          imageCount: 3,
          minAssets: 3,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          generationMode: "parallel",
          collectionKind: "batch",
          resultParentId: sourceNodeId,
          minTileContentFill: 0.7,
          primaryTileColumnWider: true,
          noDuplicateAssistantFinal: true,
          visiblePromptCount: 3,
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 960000
        },
        1020000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "ambiguous-intent") {
      const marker = `AIDEBUG_AMBIGUOUS_SOURCE_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const prompt = "${marker} source image: 竖屏小红书微海报风，东方审美黑长直公主切近景角色图，二次元写实但不要太写实，画面干净高级，背景有设计层次。";
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-ambiguous-source",
              node: {
                title: "AIDebug 模糊表达源图",
                prompt,
                nodeType: "image",
                status: "done",
                x: 180,
                y: 150,
                outputs: 1,
                assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-ambiguous-source", revisedPrompt: prompt }],
                imageState: "done",
                imageParams: {
                  prompt,
                  size: "768x1024",
                  ratio: "3:4",
                  resolution: "1080P",
                  count: 1,
                  quality: "auto",
                  batchMode: "parallel",
                  referenceImages: []
                }
              }
            },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-ambiguous-note",
              node: {
                title: "AIDebug 临时备注",
                prompt: "${marker} note: 用户会用很口语的表达要求换版、多张续作和查看画布。",
                nodeType: "review",
                status: "review",
                x: 560,
                y: 220
              }
            }
          ]);
          window.setTimeout(async () => {
            const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
            resolve({ ok: Boolean(ok), selected, state: window.__naimageDebugAgentState?.() });
          }, 700);
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-ambiguous-intent-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "ambiguous-intent-setup",
          prompt: "seed selected source image node and one note node",
          error: "Failed to create/select ambiguous intent source image node.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: true,
          parentOk: false,
          imagePromptOk: false,
          promptIncludesOk: false,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: []
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      const changeStep = await runComposerStep(
        1,
        "ambiguous-change-version",
        "这个氛围不对，换一版，别太像证件照，也别加字。",
        {
          tools: ["experience", "image_gen"],
          forbidTools: ["workflow", "ask_user"],
          experienceAdd: true,
          image: true,
          imageCount: 1,
          minAssets: 1,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          promptIncludes: [marker, "用户反馈与调整方向"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 340000
        },
        380000
      );
      const generatedNodeId = String(changeStep.newImageNodes?.[0]?.id || "");
      changeStep.generatedNodeId = generatedNodeId;
      changeStep.ok = Boolean(changeStep.ok && generatedNodeId);
      changeStep.error = changeStep.ok ? "" : changeStep.error || "Ambiguous version-change request did not create a generated image node.";
      if (!changeStep.ok || !generatedNodeId) {
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, generatedNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await evaluate(client, `window.__naimageAIDebug?.selectNode?.({ id: ${JSON.stringify(generatedNodeId)} })`, 20000);
      await runComposerStep(
        2,
        "ambiguous-last-image-three",
        "参考上一张再来三张，方向保持，三张独立图，别拼一起，也别做成九宫格。",
        {
          tools: ["image_gen"],
          forbidTools: ["experience", "workflow", "ask_user"],
          image: true,
          imageCount: 3,
          minAssets: 3,
          parentId: generatedNodeId,
          inheritVisualPrompt: true,
          promptIncludes: [marker, "来源画面要求", "三张独立图"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 460000
        },
        500000
      );

      await runComposerStep(
        3,
        "ambiguous-organize-list",
        "帮我整理一下画布，看看现在有哪些节点，不要删除，也不要生图。",
        {
          tools: ["workflow"],
          workflowOperations: ["list_nodes"],
          noImage: true,
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 140000
        },
        170000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, generatedNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "reference-context-boundary") {
      await runComposerStep(
        1,
        "reference-missing-natural",
        "我想按参考图那种感觉做一张，但我还没传图，你先让我传参考图，别自己脑补也别生图。",
        { tools: ["ask_user"], askUser: true, referenceImages: true, noImage: true, timeoutMs: 120000 },
        150000
      );

      const marker = `AIDEBUG_REFERENCE_CONTEXT_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const prompt = "${marker} current reference image: 竖屏小红书微海报风，东方审美黑长直公主切近景角色图，二次元写实但不要太写实，画面干净高级，背景有设计层次。";
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" },
            {
              type: "workflow.node.create",
              toolRunId: "aidebug-reference-context-source",
              node: {
                title: "AIDebug 当前参考图源图",
                prompt,
                nodeType: "image",
                status: "done",
                x: 180,
                y: 150,
                outputs: 1,
                assets: [{ index: 1, type: "file", path: ${JSON.stringify(viewFixturePath)}, assetUrl: ${JSON.stringify(viewFixtureAssetUrl)}, runId: "aidebug-reference-context-source", revisedPrompt: prompt }],
                imageState: "done",
                imageParams: {
                  prompt,
                  size: "768x1024",
                  ratio: "3:4",
                  resolution: "1080P",
                  count: 1,
                  quality: "auto",
                  batchMode: "parallel",
                  referenceImages: []
                }
              }
            }
          ]);
          window.setTimeout(async () => {
            const selected = await window.__naimageAIDebug?.selectNode?.({ id: "A" }).catch((error) => ({ ok: false, error: String(error) }));
            resolve({ ok: Boolean(ok), selected, state: window.__naimageDebugAgentState?.() });
          }, 700);
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-reference-context-setup"));
      const sourceNodeId = setup?.selected?.id || setup?.state?.selectedNodeId || "A";
      if (!setup?.ok || !sourceNodeId) {
        steps.push({
          ok: false,
          label: "reference-context-setup",
          prompt: "seed selected source image node as current reference context",
          error: "Failed to create/select reference context source image node.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: true,
          parentOk: false,
          imagePromptOk: false,
          promptIncludesOk: false,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: []
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await runComposerStep(
        2,
        "reference-current-selected-image",
        "就按当前这张参考图的感觉再做一张，保留黑长直公主切近景，画面更有设计感，不要再问我要图，也别加字。",
        {
          tools: ["image_gen"],
          forbidTools: ["ask_user", "workflow", "experience"],
          image: true,
          imageCount: 1,
          minAssets: 1,
          parentId: sourceNodeId,
          inheritVisualPrompt: true,
          promptIncludes: [marker, "来源画面要求"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 340000
        },
        380000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, sourceNodeId, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "experience-boundary") {
      const marker = `AIDEBUG_EXPERIENCE_BOUNDARY_${Date.now()}`;
      const setup = await evaluate(
        client,
        `new Promise((resolve) => {
          window.__naimageDebugOpenSurface?.("main");
          const ok = window.__naimageDebugApplyAgentActions?.([
            { type: "workflow.canvas.clear", mode: "all" }
          ]);
          window.setTimeout(() => resolve({ ok: Boolean(ok), state: window.__naimageDebugAgentState?.() }), 500);
        })`,
        20000
      );
      screenshots.push(await screenshot(client, "00-experience-boundary-setup"));
      if (!setup?.ok) {
        steps.push({
          ok: false,
          label: "experience-boundary-setup",
          prompt: "clear canvas before experience boundary suite",
          error: "Failed to clear canvas for experience boundary suite.",
          state: setup?.state || {},
          usedImageGen: false,
          usedAnyTool: false,
          usedToolNames: [],
          usedExperienceAdd: false,
          usedExperienceRead: false,
          workflowOperations: [],
          newAssetCount: 0,
          countOk: true,
          parentOk: true,
          imagePromptOk: true,
          promptIncludesOk: true,
          promptExcludesOk: true,
          autonomyOk: true,
          internalToolsOk: true,
          forbiddenToolsOk: true,
          expectedWorkflowOperationsOk: true,
          commandOk: true,
          dialogOk: true,
          noAskUserDialogOk: true,
          noReferenceDialogOk: true,
          askUserDialogOpen: false,
          referencePickerDialogOpen: false,
          modelForce: [],
          modelToolChoice: [],
          modelArgCorrect: [],
          modelContract: [],
          internalToolsExposed: []
        });
        const ok = writeReport(steps, screenshots);
        console.log(JSON.stringify({ ok, suite: suiteName, marker, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
        process.exitCode = 1;
        return;
      }

      await runComposerStep(
        1,
        "experience-record-only",
        `先别画也别动画布，只记一条绘画经验：${marker} 公主切近景角色图要清爽、有东方审美和微海报设计感，脸部不要油，背景不要空，也不要像证件照。`,
        {
          tools: ["experience"],
          experienceAdd: true,
          noImage: true,
          forbidTools: ["workflow", "image_gen", "ask_user"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 140000
        },
        170000
      );

      const readThenGenerate = await runComposerStep(
        2,
        "experience-read-then-generate",
        `先读取刚才那条 ${marker} 绘画经验，然后按这个经验生成一张竖屏小红书微海报风的二次元写实黑长直公主切近景角色图，东方审美，有艺术感和设计感，不要太写实，也不要加字。`,
        {
          tools: ["experience", "image_gen"],
          experienceRead: true,
          image: true,
          minAssets: 1,
          promptIncludes: ["公主切"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 360000
        },
        400000
      );
      const generatedNodeId = readThenGenerate?.newImageNodes?.[0]?.id || "";

      await runComposerStep(
        3,
        "feedback-continue-not-fastmemory-only",
        "这版脸有点油，背景还是空；不要把反馈写进 FastMemory 当作完成，直接按刚才图继续补一张，更有设计感，还是黑长直公主切近景，不要太写实，不要加字。",
        {
          tools: ["experience", "image_gen"],
          forbidTools: ["workflow", "ask_user"],
          experienceAdd: true,
          image: true,
          imageCount: 1,
          minAssets: 1,
          ...(generatedNodeId ? { parentId: generatedNodeId } : {}),
          inheritVisualPrompt: true,
          promptIncludes: ["用户反馈与调整方向", "脸有点油"],
          promptExcludes: ["用户反馈已写入 FastMemory"],
          noAskUserDialog: true,
          noReferenceDialog: true,
          timeoutMs: 320000
        },
        360000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, marker, generatedNodeId, setup, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    if (suiteName === "broad") {
      await runComposerStep(
        1,
        "plain-no-tool",
        "先别画也别动工具，你就一句话告诉我：现在这套 Agent 应该怎么处理我的绘画反馈？",
        { noTools: true, noImage: true, timeoutMs: 90000 },
        110000
      );

      await runComposerStep(
        2,
        "remember-only",
        "别画图，记一下：以后这种头像脸部不要油，背景别空，近景要高级一点，不要像证件照。",
        { experienceAdd: true, noImage: true, timeoutMs: 140000 },
        160000
      );

      await runComposerStep(
        3,
        "read-only",
        "先把刚才记的绘画经验读一下给我看，别画。",
        { experienceRead: true, noImage: true, timeoutMs: 140000 },
        160000
      );

      const vagueCover = await runComposerStep(
        4,
        "vague-cover-image",
        "那来个更像封面的，头发黑，别大头贴，干净点，氛围高级一点。",
        { image: true, minAssets: 1, inheritVisualPrompt: true, timeoutMs: 300000 },
        330000
      );
      const coverParentId = vagueCover?.newImageNodes?.[0]?.id || "";

      await runComposerStep(
        5,
        "continue-two",
        "这个方向可以，再给我整两版，别太写实，也别加文字。",
        { image: true, imageCount: 2, minAssets: 2, parentId: coverParentId, inheritVisualPrompt: true, timeoutMs: 360000 },
        390000
      );

      await runComposerStep(
        6,
        "feedback-continue",
        "这次脸有点油，近景再紧一点，补一张就行，还是别太写实。",
        { image: true, imageCount: 1, minAssets: 1, inheritVisualPrompt: true, timeoutMs: 300000 },
        330000
      );

      const ok = writeReport(steps, screenshots);
      console.log(JSON.stringify({ ok, suite: suiteName, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
      if (!ok) process.exitCode = 1;
      return;
    }

    const first = await evaluate(
      client,
      realComposerStepExpression(
        "vague-image",
        "你给我弄张小红书那种高级一点的头像海报吧，黑头发，近一点，别太假，别土，像二次元但有点真实。",
        { image: true, imageCount: 1, minAssets: 1, timeoutMs: 300000 }
      ),
      320000
    );
    steps.push(first);
    screenshots.push(await screenshot(client, "01-vague-image"));
    const parentId = first?.newImageNodes?.[0]?.id || "";

    const remember = await evaluate(
      client,
      realComposerStepExpression(
        "remember-experience",
        "这张挺对味，记住：干净高级一点，脸别太油，近景别空，别做成大头贴；下次按这个经验来就行。现在先别生图。",
        { experienceAdd: true, noImage: true, timeoutMs: 120000 }
      ),
      140000
    );
    steps.push(remember);
    screenshots.push(await screenshot(client, "02-remember-experience"));

    const continueThree = await evaluate(
      client,
      realComposerStepExpression(
        "continue-three",
        "嗯按刚才那个感觉再来三张，别拼一起，也别整太写实。",
        { image: true, imageCount: 3, minAssets: 3, parentId, inheritVisualPrompt: true, timeoutMs: 420000 }
      ),
      450000
    );
    steps.push(continueThree);
    screenshots.push(await screenshot(client, "03-continue-three"));

    const readExperience = await evaluate(
      client,
      realComposerStepExpression(
        "read-experience-image",
        "你先看看刚才记的经验，再给我做一版更像封面、更有设计感的，别带字。",
        { image: true, minAssets: 1, experienceRead: true, inheritVisualPrompt: true, timeoutMs: 300000 }
      ),
      330000
    );
    steps.push(readExperience);
    screenshots.push(await screenshot(client, "04-read-experience-image"));

    const ok = writeReport(steps, screenshots);
    console.log(JSON.stringify({ ok, runDir, desktopLog, screenshots, steps: steps.map(summariseStep) }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    client.close();
    releaseUiLock();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack || error.message : String(error);
  const steps = Array.isArray(failureContext.steps) ? [...failureContext.steps] : [];
  const screenshots = Array.isArray(failureContext.screenshots) ? [...failureContext.screenshots] : [];
  steps.push({
    label: `${suiteName}-fatal`,
    prompt: "suite terminated before normal report finalization",
    ok: false,
    error: message,
    stack,
    usedImageGen: false,
    usedAnyTool: false,
    usedToolNames: [],
    autonomyOk: true,
    internalToolsOk: true,
    forbiddenToolsOk: true,
    expectedWorkflowOperationsOk: true,
    commandOk: true,
    dialogOk: false,
    dialogLayoutOk: false,
    noAskUserDialogOk: true,
    noReferenceDialogOk: true,
    countOk: false,
    parentOk: false,
    imagePromptOk: false,
    promptIncludesOk: false,
    promptExcludesOk: false
  });
  writeReport(steps, screenshots);
  console.error(error);
  process.exit(1);
});
