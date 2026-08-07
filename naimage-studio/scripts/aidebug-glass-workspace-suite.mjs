import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  BasicCdpClient,
  evaluateRuntime as evaluate,
  pollForDebugTarget,
  waitForRuntimeExpression
} from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { createAidebugReporting } from "./aidebug/harness/reporting.mjs";
import { captureStableCdpScene, createObservationLog } from "./aidebug/harness/standalone-gui-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `glass-workspace-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const fallbackPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const THEME_IDS = ["dark-rose", "dark-ember", "dark-emerald", "light-silver", "light-lemon", "light-sky", "light-blush"];
const MATERIAL_IDS = ["clear", "frosted", "dense"];
const RAIL_TAB_IDS = ["results", "layers", "requirements", "templates", "history"];
const VIEW_MODE_IDS = ["workbench", "focus", "review"];
const CUSTOM_APPEARANCE = Object.freeze({
  theme: "light-sky",
  material: "custom",
  opacity: 61,
  blur: 0,
  saturation: 173,
  highlight: 57,
  shadow: 39,
  radius: 24,
  accent: "coral",
  noise: false,
  reduceMotion: true
});

const qaInventory = [
  { id: "default", claim: "A fresh workspace starts with dark-ember and Frosted glass.", evidence: "00-default-workbench.png" },
  { id: "themes", claim: "All seven registered themes update the live root without rebuilding canvas state.", evidence: "01-theme-*.png" },
  { id: "materials", claim: "Clear, Frosted and Dense are live material presets.", evidence: "02-material-*.png" },
  { id: "custom-controls", claim: "Every numeric range, accent, noise and reduced-motion control updates live root tokens and can restore the recommended preset.", evidence: "03-custom-all-controls.png + 03-reset-recommended.png" },
  { id: "rapid-theme-switch", claim: "Rapid light/dark switching preserves the same canonical canvas and node DOM objects and geometry.", evidence: "report.json rapidThemeSwitch + canvasDomIdentity" },
  { id: "cold-restart", claim: "A saved high-radius, zero-blur custom material survives a real Electron close and cold restart through the pre-React bootstrap.", evidence: "09-custom-before-restart.png + 10-custom-after-restart.png" },
  { id: "asset-rail", claim: "The left asset rail exposes results, layers, requirements, templates and history as real tabs.", evidence: "04-rail-*.png" },
  { id: "project-search", claim: "Topbar search queries live image, requirement and conversation state and navigates through canonical selectors.", evidence: "04-search-live-state.png + report.json projectSearch" },
  { id: "view-modes", claim: "Workbench, Focus and Review switch presentation while preserving node IDs and viewport.", evidence: "05-mode-*.png" },
  { id: "safe-continuation", claim: "Focus continuation opens the existing confirmation editor without dispatching image generation.", evidence: "05-focus-continue-confirmation.png + report.json focusContinuation" },
  { id: "review-direction", claim: "Review direction selection uses and persists the canonical selected node id.", evidence: "05-review-direction.png + report.json reviewDirection" },
  { id: "non-image-navigation", claim: "Selecting a requirement or unfinished image from Focus or Review returns to Workbench and reveals the canonical target.", evidence: "05-requirement-navigation-workbench.png + report.json nonImageNavigation" },
  { id: "surfaces", claim: "Settings, menu and the single Agent control center use bounded glass surfaces.", evidence: "06-settings-surface.png, 07-menu-surface.png, 00-default-workbench.png" },
  { id: "minimum-window", claim: "The complete shell, settings and menu remain usable at the supported 884 x 640 minimum window.", evidence: "08-minimum-window-884x640*.png" },
  { id: "artwork-isolation", claim: "Artwork images stay opacity 1 with no filter or backdrop-filter.", evidence: "all scenes + report.json computedImageStyles" },
  { id: "runtime-health", claim: "The suite records zero application Renderer exceptions/console errors and no horizontal page overflow; a known pre-navigation Electron bootstrap pair is reported separately.", evidence: "report.json consoleErrors + ignoredConsoleErrors + scene overflow" },
  { id: "no-provider", claim: "Fixture images are local data URLs and no real image provider is enabled.", evidence: "report.json environment + process logs" }
];

const observationLog = createObservationLog();
const { observations, recordObservation } = observationLog;
const screenshots = {};
const checks = {};
const evidenceResults = [];
const consoleErrors = [];
const ignoredConsoleErrors = [];
const consoleErrorKeys = new Set();

let viteProcess;
let electronProcess;
let client;
let target;
let reporting;

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function addConsoleError(source, detail) {
  const normalized = typeof detail === "string" ? { text: detail } : detail || {};
  const key = JSON.stringify([source, normalized.text || normalized.description || normalized.url || "", normalized.lineNumber || 0]);
  if (consoleErrorKeys.has(key)) return;
  consoleErrorKeys.add(key);
  const entry = { at: new Date().toISOString(), source, ...normalized };
  const text = String(normalized.text || normalized.description || "");
  if (
    source === "console.error" &&
    (
      text === "Electron sandboxed_renderer.bundle.js script failed to run" ||
      text.includes("Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null")
    )
  ) {
    ignoredConsoleErrors.push({ ...entry, reason: "Electron pre-navigation sandbox bootstrap noise; application preload and bridge readiness are asserted separately." });
    return;
  }
  consoleErrors.push(entry);
}

function attachConsoleTelemetry() {
  client.socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails || {};
      addConsoleError("Runtime.exceptionThrown", {
        text: detail.exception?.description || detail.text || "Renderer exception",
        url: detail.url || "",
        lineNumber: Number(detail.lineNumber || 0),
        columnNumber: Number(detail.columnNumber || 0)
      });
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      addConsoleError("console.error", {
        text: (message.params.args || []).map((item) => item.value ?? item.description ?? "").join(" ")
      });
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      const entry = message.params.entry;
      addConsoleError("Log.entryAdded", {
        text: entry.text || "Renderer log error",
        url: entry.url || "",
        lineNumber: Number(entry.lineNumber || 0)
      });
    }
  });
}

async function waitFor(expression, timeoutMs = 12_000, intervalMs = 80) {
  return waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs });
}

async function clickSelector(selector, index = 0) {
  const clicked = await evaluate(client, `(() => {
    const items = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const element = items[${Number(index)}];
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Clickable element is unavailable: ${selector}[${index}]`);
}

async function clickTheme(themeId, settleMs = 240) {
  await clickSelector(`[data-glass-section="themes"] [data-glass-theme="${themeId}"]`);
  await waitFor(`document.documentElement.dataset.glassTheme === ${JSON.stringify(themeId)}`);
  await delay(settleMs);
}

async function clickMaterial(materialId) {
  await clickSelector(`[data-glass-section="materials"] [data-glass-material="${materialId}"]`);
  await waitFor(`document.documentElement.dataset.glassMaterial === ${JSON.stringify(materialId)}`);
  await delay(240);
}

async function setRangeValue(selector, value) {
  const changed = await evaluate(client, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Range input is unavailable: ${selector}`);
}

async function setCheckboxValue(selector, checked) {
  const changed = await evaluate(client, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return false;
    if (input.checked !== ${checked ? "true" : "false"}) input.click();
    return input.checked === ${checked ? "true" : "false"};
  })()`);
  assert.equal(changed, true, `Checkbox input is unavailable: ${selector}`);
}

async function setTextValue(selector, value) {
  const changed = await evaluate(client, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Text input is unavailable: ${selector}`);
}

async function readCanvasInvariant() {
  return evaluate(client, `(() => {
    const state = window.__naimageAIDebug?.state?.();
    return state ? { nodeIds: [...state.nodesRefIds], viewport: { ...state.viewport } } : null;
  })()`);
}

async function assertCanvasInvariant(label, expected) {
  const actual = await readCanvasInvariant();
  assert.deepEqual(actual, expected, `${label} must not change canvas node IDs or viewport`);
  return actual;
}

async function installCanvasDomProbe() {
  return evaluate(client, `(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const geometry = (element) => {
      const box = element.getBoundingClientRect();
      return { left: round(box.left), top: round(box.top), width: round(box.width), height: round(box.height) };
    };
    const canvas = document.querySelector('.workflow-canvas');
    if (!(canvas instanceof HTMLElement)) return null;
    const nodes = Array.from(canvas.querySelectorAll('.flow-node[data-node-id]'));
    const nodeRefs = new Map(nodes.map((node) => [node.getAttribute('data-node-id') || '', node]));
    window.__naimageGlassCanvasDomProbe = { canvas, nodeRefs };
    return {
      canvasGeometry: geometry(canvas),
      nodeGeometry: Object.fromEntries(nodes.map((node) => [node.getAttribute('data-node-id') || '', geometry(node)])),
      nodeIds: [...nodeRefs.keys()]
    };
  })()`);
}

async function readCanvasDomProbe() {
  return evaluate(client, `(() => {
    const probe = window.__naimageGlassCanvasDomProbe;
    const canvas = document.querySelector('.workflow-canvas');
    if (!probe || !(canvas instanceof HTMLElement)) return null;
    const round = (value) => Math.round(value * 10) / 10;
    const geometry = (element) => {
      const box = element.getBoundingClientRect();
      return { left: round(box.left), top: round(box.top), width: round(box.width), height: round(box.height) };
    };
    const nodes = Array.from(canvas.querySelectorAll('.flow-node[data-node-id]'));
    return {
      sameCanvas: canvas === probe.canvas,
      sameNodeCount: nodes.length === probe.nodeRefs.size,
      sameNodeElements: nodes.every((node) => probe.nodeRefs.get(node.getAttribute('data-node-id') || '') === node),
      canvasConnected: probe.canvas.isConnected,
      canvasGeometry: geometry(canvas),
      nodeGeometry: Object.fromEntries(nodes.map((node) => [node.getAttribute('data-node-id') || '', geometry(node)])),
      nodeIds: nodes.map((node) => node.getAttribute('data-node-id') || '')
    };
  })()`);
}

async function assertCanvasDomProbe(label, expected) {
  try {
    await waitFor(`(() => {
      const probe = window.__naimageGlassCanvasDomProbe;
      const canvas = document.querySelector('.workflow-canvas');
      if (!probe || !(canvas instanceof HTMLElement) || canvas !== probe.canvas || !probe.canvas.isConnected) return false;
      const nodes = Array.from(canvas.querySelectorAll('.flow-node[data-node-id]'));
      return nodes.length === probe.nodeRefs.size && nodes.every((node) => probe.nodeRefs.get(node.getAttribute('data-node-id') || '') === node);
    })()`, 5_000, 80);
  } catch (error) {
    const actual = await readCanvasDomProbe();
    throw new Error(`${label} canvas DOM probe did not stabilize: ${JSON.stringify({ expectedNodeIds: expected?.nodeIds || [], actual })}`, { cause: error });
  }
  const actual = await readCanvasDomProbe();
  assert(actual, `${label} canvas DOM probe is unavailable`);
  assert.equal(actual.sameCanvas, true, `${label} must preserve the canonical canvas DOM object`);
  assert.equal(actual.sameNodeCount, true, `${label} must preserve the rendered node count`);
  assert.equal(actual.sameNodeElements, true, `${label} must preserve every rendered node DOM object`);
  assert.equal(actual.canvasConnected, true, `${label} must keep the canonical canvas connected`);
  assert.deepEqual(actual.canvasGeometry, expected.canvasGeometry, `${label} must preserve canvas geometry`);
  assert.deepEqual(actual.nodeGeometry, expected.nodeGeometry, `${label} must preserve node geometry`);
  assert.deepEqual(actual.nodeIds, expected.nodeIds, `${label} must preserve rendered node order`);
  return actual;
}

async function readAppearance() {
  return evaluate(client, `(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      theme: root.dataset.glassTheme || '',
      mode: root.dataset.glassMode || '',
      material: root.dataset.glassMaterial || '',
      accent: root.dataset.glassAccent || '',
      accentResolved: root.dataset.glassAccentResolved || '',
      glassRgb: style.getPropertyValue('--glass-rgb').trim(),
      opacity: style.getPropertyValue('--glass-opacity').trim(),
      blur: style.getPropertyValue('--glass-blur').trim(),
      saturation: style.getPropertyValue('--glass-saturation').trim(),
      highlight: style.getPropertyValue('--glass-highlight').trim(),
      shadow: style.getPropertyValue('--glass-shadow').trim(),
      radius: style.getPropertyValue('--glass-radius').trim(),
      noise: root.dataset.glassNoise || '',
      reduceMotion: root.dataset.glassReduceMotion || '',
      noiseOpacity: style.getPropertyValue('--glass-noise-opacity').trim(),
      motionDuration: style.getPropertyValue('--glass-motion-duration').trim(),
      accentColor: style.getPropertyValue('--accent').trim()
    };
  })()`);
}

async function applyCustomAppearanceControls() {
  await clickTheme(CUSTOM_APPEARANCE.theme);
  await clickMaterial("frosted");
  for (const key of ["opacity", "blur", "saturation", "highlight", "shadow", "radius"]) {
    await setRangeValue(`#glass-${key}`, CUSTOM_APPEARANCE[key]);
  }
  await clickSelector(`[data-glass-section="accent"] [data-glass-accent="${CUSTOM_APPEARANCE.accent}"]`);
  await setCheckboxValue('[data-glass-toggle="noise"] input', CUSTOM_APPEARANCE.noise);
  await setCheckboxValue('[data-glass-toggle="reduce-motion"] input', CUSTOM_APPEARANCE.reduceMotion);
  await waitFor(`document.documentElement.dataset.glassMaterial === 'custom' &&
    document.documentElement.dataset.glassAccent === ${JSON.stringify(CUSTOM_APPEARANCE.accent)} &&
    document.documentElement.dataset.glassNoise === 'off' &&
    document.documentElement.dataset.glassReduceMotion === 'true'`);
  await delay(180);
}

async function startElectronRenderer({ debugPort, vitePort, logName }) {
  const electronLog = createWriteStream(join(runDir, logName));
  electronProcess = spawn(
    process.execPath,
    [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: {
        ...process.env,
        NAIMAGE_DEV_URL: `http://127.0.0.1:${vitePort}`,
        NAIMAGE_AIDEBUG: "1",
        NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
        NAIMAGE_AIDEBUG_REAL_AGENT: "0",
        NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
        NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
        NAIMAGE_CONFIG_DIR: configDir,
        NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log")
      }
    }
  );
  electronProcess.stdout?.pipe(electronLog);
  electronProcess.stderr?.pipe(electronLog);
  target = await pollForDebugTarget({
    port: debugPort,
    attempts: 180,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Glass workspace Electron renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  attachConsoleTelemetry();
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");
  await waitFor("Boolean(document.querySelector('.ide-shell') && document.querySelector('.workspace-asset-rail') && document.querySelector('.project-agent-panel') && window.__naimageAIDebug)", 20_000, 100);
  await delay(400);
}

async function closeElectronRenderer() {
  const closingClient = client;
  const closingProcess = electronProcess;
  let closeRequested = false;
  if (closingClient) {
    closeRequested = await evaluate(closingClient, `(() => {
      if (!window.naimageConfig?.windowControl) return false;
      setTimeout(() => { void window.naimageConfig.windowControl({ action: 'close' }); }, 0);
      return true;
    })()`).catch(() => false);
  }
  const graceful = await waitForChildExit(closingProcess, 5_000);
  closingClient?.close();
  if (!graceful) await forceKillProcessTree(closingProcess?.pid);
  if (client === closingClient) client = undefined;
  if (electronProcess === closingProcess) electronProcess = undefined;
  target = undefined;
  return { closeRequested, graceful };
}

async function setWindowSize(width, height) {
  const attempts = [];
  try {
    const ipc = await evaluate(client, `(async () => await window.naimageConfig?.debugWindowBounds?.(${JSON.stringify({ width, height })}))()`);
    if (!ipc?.ok) throw new Error(ipc?.error || "debugWindowBounds unavailable");
    attempts.push({ method: "debugWindowBounds", ok: true, bounds: ipc.bounds, contentBounds: ipc.contentBounds });
  } catch (error) {
    attempts.push({ method: "debugWindowBounds", ok: false, error: error instanceof Error ? error.message : String(error) });
    try {
      const windowInfo = await client.send("Browser.getWindowForTarget", { targetId: target.id }, 5_000);
      await client.send("Browser.setWindowBounds", {
        windowId: windowInfo.windowId,
        bounds: { width, height, windowState: "normal" }
      }, 5_000);
      attempts.push({ method: "Browser.setWindowBounds", ok: true });
    } catch (browserError) {
      attempts.push({ method: "Browser.setWindowBounds", ok: false, error: browserError instanceof Error ? browserError.message : String(browserError) });
    }
  }
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  }, 5_000);
  await client.send("Emulation.setVisibleSize", { width, height }, 5_000).catch(() => null);
  await evaluate(client, "window.dispatchEvent(new Event('resize')); undefined");
  await delay(520);
  const metrics = await evaluate(client, `({
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight
  })`);
  return { requested: { width, height }, attempts, metrics };
}

async function readEvidenceSnapshot() {
  return evaluate(client, `(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left * 10) / 10,
        top: Math.round(box.top * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        bottom: Math.round(box.bottom * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10
      };
    };
    const surfaceSelectors = [
      '.ide-topbar',
      '.workspace-asset-rail',
      '.canvas-panel',
      '.project-agent-panel',
      '.workspace-direction-switcher',
      '.settings-drawer',
      '.project-menu-popover',
      '.workspace-focus-stage',
      '.workspace-review-grid'
    ];
    const surfaces = surfaceSelectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!visible(element)) return [];
      const style = getComputedStyle(element);
      return [{
        selector,
        rect: rect(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: style.overflowX,
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none'
      }];
    });
    const clipped = surfaces.filter((item) => item.rect && (
      item.rect.left < -1 || item.rect.top < -1 || item.rect.right > innerWidth + 1 || item.rect.bottom > innerHeight + 1
    ));
    const surfaceOverflow = surfaces.filter((item) =>
      item.scrollWidth > item.clientWidth + 1 && item.overflowX !== 'auto' && item.overflowX !== 'scroll'
    );
    const artworkSelectors = '.flow-node img, .workspace-asset-rail-item img, .workspace-focus-stage img, .workspace-review-grid img';
    const computedImageStyles = Array.from(document.querySelectorAll(artworkSelectors)).filter(visible).map((image, index) => {
      const style = getComputedStyle(image);
      return {
        index,
        className: image.className || '',
        opacity: style.opacity,
        filter: style.filter,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
        rect: rect(image)
      };
    });
    const imageStyleFailures = computedImageStyles.filter((item) =>
      Number.parseFloat(item.opacity) !== 1 || item.filter !== 'none' || item.backdropFilter !== 'none'
    );
    const debugState = window.__naimageAIDebug?.state?.();
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const stateIssues = [
      ...clipped.map((item) => ({ key: 'surface-clipped', expected: 'inside viewport', actual: item })),
      ...imageStyleFailures.map((item) => ({ key: 'artwork-style-isolation', expected: { opacity: '1', filter: 'none', backdropFilter: 'none' }, actual: item }))
    ];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      surfaceOk: Boolean(document.querySelector('.ide-shell') && document.querySelector('.workspace-asset-rail') && document.querySelector('.project-agent-panel')),
      state: {
        viewport: { width: innerWidth, height: innerHeight },
        appearance: {
          theme: root.dataset.glassTheme || '',
          mode: root.dataset.glassMode || '',
          material: root.dataset.glassMaterial || '',
          accent: root.dataset.glassAccent || '',
          opacity: rootStyle.getPropertyValue('--glass-opacity').trim(),
          blur: rootStyle.getPropertyValue('--glass-blur').trim(),
          radius: rootStyle.getPropertyValue('--glass-radius').trim()
        },
        workspaceMode: ['workbench', 'focus', 'review'].find((mode) => document.querySelector('.ide-main')?.classList.contains('workspace-mode-' + mode)) || '',
        railTab: document.querySelector('.workspace-asset-rail')?.getAttribute('data-active-tab') || '',
        nodeIds: debugState ? [...debugState.nodesRefIds] : [],
        canvasViewport: debugState ? { ...debugState.viewport } : null,
        surfaces,
        computedImageStyles
      },
      stateIssues,
      overflow: {
        documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
        elementOverflowX: surfaceOverflow
      }
    };
  })()`);
}

async function capture(label) {
  const result = await captureStableCdpScene({
    client,
    runDir,
    label,
    readSnapshot: readEvidenceSnapshot,
    timeoutMs: 20_000
  });
  evidenceResults.push(result);
  screenshots[label] = {
    path: result.screenshotPath,
    sha256: result.screenshotEvidence.sha256,
    width: result.screenshotEvidence.width,
    height: result.screenshotEvidence.height
  };
  if (!result.visualReliability.ok) {
    throw new Error(`Glass workspace visual evidence failed for ${label}: ${result.visualReliability.failureReasons.join(", ")}`);
  }
  return result;
}

function railTabHasExpectedContent(tabId, state) {
  if (tabId === "templates") return state.itemCount > 0 || state.emptyVisible;
  return state.itemCount > 0;
}

async function selectRailTab(tabId) {
  const index = RAIL_TAB_IDS.indexOf(tabId);
  assert(index >= 0, `Unknown rail tab: ${tabId}`);
  await clickSelector(".workspace-asset-rail-tabs > button", index);
  await waitFor(`document.querySelector('.workspace-asset-rail')?.getAttribute('data-active-tab') === ${JSON.stringify(tabId)}`);
  await delay(180);
  return evaluate(client, `(() => ({
    activeTab: document.querySelector('.workspace-asset-rail')?.getAttribute('data-active-tab') || '',
    activeButtons: document.querySelectorAll('.workspace-asset-rail-tabs > button[aria-pressed="true"]').length,
    itemCount: document.querySelectorAll('.workspace-asset-rail-list .workspace-asset-rail-item').length,
    emptyVisible: Boolean(document.querySelector('.workspace-asset-rail-empty'))
  }))()`);
}

async function selectWorkspaceMode(modeId) {
  const index = VIEW_MODE_IDS.indexOf(modeId);
  assert(index >= 0, `Unknown workspace mode: ${modeId}`);
  await clickSelector(".workspace-direction-switcher > button", index);
  await waitFor(`document.querySelector('.ide-main')?.classList.contains(${JSON.stringify(`workspace-mode-${modeId}`)}) === true`);
  await delay(260);
  return evaluate(client, `(() => ({
    mode: ${JSON.stringify(modeId)},
    activeButtons: document.querySelectorAll('.workspace-direction-switcher > button[aria-pressed="true"]').length,
    focusVisible: Boolean(document.querySelector('.workspace-focus-stage')),
    reviewVisible: Boolean(document.querySelector('.workspace-review-grid')),
    workbenchStageVisible: (() => {
      const stage = document.querySelector('.workflow-canvas-stage');
      return stage ? getComputedStyle(stage).display !== 'none' : false;
    })()
  }))()`);
}

async function runWorkspaceDomainSmoke() {
  const seeded = await evaluate(client, `(async () => {
    const result = await window.__naimageAIDebug.seedSelectionCanvas();
    await window.__naimageAIDebug.fitCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A'], primaryId: 'A' });
    return { result, state: window.__naimageAIDebug.state() };
  })()`, 30_000);
  assert.equal(seeded?.result?.ok, true);
  assert.equal(seeded.state.workspaceDomain, "general");
  assert.equal(seeded.state.selectedNodeId, "A");

  const invariant = await readCanvasInvariant();
  assert(invariant?.nodeIds?.length > 0);
  const domBaseline = await installCanvasDomProbe();
  assert(domBaseline?.nodeIds?.length > 0);
  const executionBaseline = {
    agentStatus: seeded.state.agentStatus,
    activeRunId: seeded.state.activeRunId,
    messageCount: seeded.state.messageCount,
    progressCount: seeded.state.progressCount,
    nodeCount: seeded.state.nodeCount,
    selectedNodeId: seeded.state.selectedNodeId,
    selectedNodeIds: seeded.state.selectedNodeIds
  };

  const trigger = await evaluate(client, `(() => {
    const element = document.querySelector('.workspace-domain-switcher-trigger');
    return element instanceof HTMLElement ? { text: element.textContent?.trim(), title: element.title } : null;
  })()`);
  assert.match(trigger?.text || "", /通用创作/);
  assert.match(trigger?.title || "", /Ctrl\/Cmd \+ 1/);

  const compactWindow = await setWindowSize(884, 640);
  assert(Math.abs(compactWindow.metrics.innerWidth - 884) <= 2);
  const compactTrigger = await evaluate(client, `(() => {
    const trigger = document.querySelector('.workspace-domain-switcher-trigger');
    const label = trigger?.querySelector('span:nth-child(2)');
    if (!(trigger instanceof HTMLElement) || !(label instanceof HTMLElement)) return null;
    const triggerRect = trigger.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const labelStyle = getComputedStyle(label);
    return {
      text: label.textContent?.trim() || '',
      triggerWidth: triggerRect.width,
      labelWidth: labelRect.width,
      labelPosition: labelStyle.position,
      insideViewport: triggerRect.left >= -1 && triggerRect.right <= innerWidth + 1
    };
  })()`);
  assert.equal(compactTrigger?.text, "通用创作");
  assert((compactTrigger?.triggerWidth || 0) >= 72);
  assert((compactTrigger?.labelWidth || 0) >= 36);
  assert.notEqual(compactTrigger?.labelPosition, "absolute");
  assert.equal(compactTrigger?.insideViewport, true);
  await clickSelector(".workspace-domain-switcher-trigger");
  await waitFor("document.querySelectorAll('.workspace-domain-menu > button').length === 4");
  const compactMenu = await evaluate(client, `(() => {
    const menu = document.querySelector('.workspace-domain-menu');
    if (!(menu instanceof HTMLElement)) return null;
    const rect = menu.getBoundingClientRect();
    return {
      titles: Array.from(menu.querySelectorAll('strong')).map((item) => item.textContent?.trim() || ''),
      insideViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
    };
  })()`);
  assert.deepEqual(compactMenu?.titles, ["通用创作", "电商创作", "社媒创作", "科研绘图"]);
  assert.equal(compactMenu?.insideViewport, true);
  await capture("workspace-domain-compact-menu");
  await clickSelector(".workspace-domain-switcher-trigger");
  await waitFor("!document.querySelector('.workspace-domain-menu')");
  await setWindowSize(1400, 900);
  await waitFor("innerWidth >= 1300 && innerHeight >= 800");

  await clickSelector(".workspace-domain-switcher-trigger");
  await waitFor("document.querySelectorAll('.workspace-domain-menu > button').length === 4");
  const menu = await evaluate(client, `(() => ({
    items: Array.from(document.querySelectorAll('.workspace-domain-menu > button')).map((button) => ({
      title: button.querySelector('strong')?.textContent?.trim() || '',
      description: button.querySelector('small')?.textContent?.trim() || '',
      shortcut: button.getAttribute('aria-keyshortcuts') || '',
      visibleShortcutCount: button.querySelectorAll('kbd').length
    })),
    activeCount: document.querySelectorAll('.workspace-domain-menu > button[aria-checked="true"]').length
  }))()`);
  assert.deepEqual(menu.items.map((item) => item.title), ["通用创作", "电商创作", "社媒创作", "科研绘图"]);
  assert(menu.items.every((item) => item.description.length > 0));
  assert(menu.items.every((item) => item.shortcut.includes("Control+") && item.visibleShortcutCount === 0));
  assert.equal(menu.activeCount, 1);

  await clickSelector(".workspace-domain-menu > button", 1);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'commerce' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-commerce')");
  await assertCanvasInvariant("Commerce domain switch", invariant);
  const commerceDom = await readCanvasDomProbe();
  assert.equal(commerceDom?.sameCanvas, true);
  assert.equal(commerceDom?.sameNodeCount, true);
  assert.equal(commerceDom?.sameNodeElements, true);
  assert.equal(commerceDom?.canvasConnected, true);
  assert.deepEqual(commerceDom?.nodeIds, domBaseline.nodeIds);

  await waitFor("Boolean(document.querySelector('.workspace-domain-tools[data-workspace-domain=\"commerce\"]'))");
  await waitFor("document.querySelectorAll('.workspace-domain-tool-button').length === 6");
  const commerceRail = await evaluate(client, `(() => ({
    heading: document.querySelector('.workspace-domain-tools-heading')?.textContent?.trim() || '',
    commands: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('data-domain-tool-command') || ''),
    labels: Array.from(document.querySelectorAll('.workspace-domain-tool-button span')).map((item) => item.textContent?.trim() || ''),
    shortcutTitles: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('title') || ''),
    recoveryVisible: Boolean(document.querySelector('.workspace-domain-tools-settings'))
  }))()`);
  assert.match(commerceRail.heading, /电商工具/);
  assert.deepEqual(commerceRail.commands, [
    "sparkai.commerce-toolkit.open-sku-library",
    "sparkai.commerce-toolkit.generate-listing-set",
    "sparkai.commerce-toolkit.translate-listing-set",
    "sparkai.commerce-toolkit.open-template-market",
    "sparkai.commerce-toolkit.open-ab-comparison",
    "sparkai.commerce-toolkit.open-export-center"
  ]);
  assert.deepEqual(commerceRail.labels, ["SKU", "套图", "翻译", "模板", "A/B", "导出"]);
  assert(commerceRail.shortcutTitles.every((title) => title.includes("Ctrl/⌘")));
  assert.equal(commerceRail.recoveryVisible, false);
  await capture("workspace-domain-commerce-tools");

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'social' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-social')");
  await waitFor("document.querySelectorAll('.workspace-domain-tool-button').length === 5");
  await assertCanvasInvariant("Social domain shortcut", invariant);
  const socialRail = await evaluate(client, `(() => ({
    heading: document.querySelector('.workspace-domain-tools-heading')?.textContent?.trim() || '',
    commands: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('data-domain-tool-command') || ''),
    recoveryVisible: Boolean(document.querySelector('.workspace-domain-tools-settings'))
  }))()`);
  assert.match(socialRail.heading, /社媒工具/);
  assert.equal(socialRail.commands.length, 5);
  assert.equal(socialRail.recoveryVisible, false);
  await capture("workspace-domain-social-tools");

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', code: 'Digit4', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'research' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-research')");
  await waitFor("document.querySelectorAll('.workspace-domain-tool-button').length === 6");
  await assertCanvasInvariant("Research domain shortcut", invariant);
  const researchRail = await evaluate(client, `(() => ({
    heading: document.querySelector('.workspace-domain-tools-heading')?.textContent?.trim() || '',
    commands: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('data-domain-tool-command') || ''),
    recoveryVisible: Boolean(document.querySelector('.workspace-domain-tools-settings'))
  }))()`);
  assert.match(researchRail.heading, /科研工具/);
  assert.equal(researchRail.commands.length, 6);
  assert.equal(researchRail.recoveryVisible, false);
  await capture("workspace-domain-research-tools");

  await clickSelector(".project-quick-actions > button", 0);
  await waitFor("document.querySelectorAll('.project-create-dialog .project-domain-card').length === 4");
  const projectDialog = await evaluate(client, `(() => ({
    titles: Array.from(document.querySelectorAll('.project-create-dialog .project-domain-card strong')).map((item) => item.textContent?.trim() || ''),
    descriptions: Array.from(document.querySelectorAll('.project-create-dialog .project-domain-card small')).map((item) => item.textContent?.trim() || ''),
    selected: document.querySelector('.project-create-dialog .project-domain-card[aria-pressed="true"] strong')?.textContent?.trim() || ''
  }))()`);
  assert.deepEqual(projectDialog.titles, ["通用创作", "电商创作", "社媒创作", "科研绘图"]);
  assert(projectDialog.descriptions.every((item) => item.length > 0));
  assert.equal(projectDialog.selected, "科研绘图", "New projects must inherit the current workspace domain until the user chooses another card");
  await capture("workspace-domain-new-project");
  await clickSelector('.project-create-dialog button[aria-label="关闭新建项目"]');
  await waitFor("!document.querySelector('.project-create-dialog')");

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'general' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-general')");
  const finalState = await evaluate(client, "window.__naimageAIDebug.state()");
  assert.deepEqual({
    agentStatus: finalState.agentStatus,
    activeRunId: finalState.activeRunId,
    messageCount: finalState.messageCount,
    progressCount: finalState.progressCount,
    nodeCount: finalState.nodeCount,
    selectedNodeId: finalState.selectedNodeId,
    selectedNodeIds: finalState.selectedNodeIds
  }, executionBaseline, "Workspace switching must not alter Agent execution, messages, nodes, or selection");
  await assertCanvasInvariant("Return to general domain", invariant);
  assert.deepEqual(consoleErrors, [], `Renderer console errors were recorded: ${JSON.stringify(consoleErrors, null, 2)}`);

  checks.workspaceDomain = {
    ok: true,
    domains: menu.items.map((item) => item.title),
    selectedNodeId: finalState.selectedNodeId,
    canvasDomPreserved: true,
    agentExecutionPreserved: true,
    compactTrigger,
    compactMenu,
    commerceTools: commerceRail.commands,
    socialTools: socialRail.commands,
    researchTools: researchRail.commands,
    projectCards: projectDialog.titles
  };
  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "workspace-domain-smoke",
      suite: "workspace-domain-gui",
      agentMode: "mock-agent",
      liveImageProvider: false,
      networkUsedForGeneration: false
    },
    reportAfterObservations: { checks, screenshots, consoleErrors, ignoredConsoleErrors },
    consoleAfterSummary: { checks: 1, screenshots: Object.keys(screenshots).length, consoleErrors: consoleErrors.length }
  });
  assert.equal(report.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "workspace-domain-gui", report: join(runDir, "report.json"), screenshot: screenshots["workspace-domain-new-project"]?.path })}\n`);
}

async function readSocialContentDialog() {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.social-content-dialog');
    if (!(dialog instanceof HTMLElement)) return null;
    const body = dialog.querySelector('.social-content-body');
    const footer = dialog.querySelector('.ui-surface-footer');
    const rect = dialog.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      title: dialog.querySelector('.ui-surface-heading h2')?.textContent?.trim() || '',
      activePlatform: dialog.querySelector('.social-platform-switch button[aria-pressed="true"] strong')?.textContent?.trim() || '',
      selectValues: Array.from(dialog.querySelectorAll('select')).map((item) => item.value),
      numberValues: Array.from(dialog.querySelectorAll('input[type="number"]')).map((item) => item.value),
      readonlyValues: Array.from(dialog.querySelectorAll('input[readonly]')).map((item) => item.value),
      notices: Array.from(dialog.querySelectorAll('.ui-inline-notice-copy')).map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
      sourceSummary: dialog.querySelector('.social-source-summary')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      footerSummary: dialog.querySelector('.social-content-footer-summary')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      viewportOk: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      footerViewportOk: Boolean(footerRect && footerRect.left >= -1 && footerRect.top >= -1 && footerRect.right <= innerWidth + 1 && footerRect.bottom <= innerHeight + 1),
      bodyOverflowX: body instanceof HTMLElement ? body.scrollWidth > body.clientWidth + 1 : true,
      dialogRect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  })()`);
}

async function runSocialContentSmoke() {
  const seeded = await evaluate(client, `(async () => {
    const result = await window.__naimageAIDebug.seedSelectionCanvas();
    await window.__naimageAIDebug.fitCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A'], primaryId: 'A' });
    return { result, state: window.__naimageAIDebug.state() };
  })()`, 30_000);
  assert.equal(seeded?.result?.ok, true);
  assert.equal(seeded.state.workspaceDomain, "general");
  assert.equal(seeded.state.selectedNodeId, "A");
  const invariant = await readCanvasInvariant();
  const baseline = {
    agentStatus: seeded.state.agentStatus,
    activeRunId: seeded.state.activeRunId,
    messageCount: seeded.state.messageCount,
    progressCount: seeded.state.progressCount,
    nodeCount: seeded.state.nodeCount,
    selectedNodeId: seeded.state.selectedNodeId,
    selectedNodeIds: seeded.state.selectedNodeIds
  };

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'social' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-social')");
  await assertCanvasInvariant("Social domain switch", invariant);
  await waitFor("Boolean(document.querySelector('.workspace-domain-tools[data-workspace-domain=\"social\"]'))");

  const beforeInstall = await evaluate(client, `(() => ({
    toolCount: document.querySelectorAll('.workspace-domain-tool-button').length,
    recoveryLabel: document.querySelector('.workspace-domain-tools-settings')?.getAttribute('aria-label') || ''
  }))()`);
  assert.equal(beforeInstall.toolCount, 0);
  assert.equal(beforeInstall.recoveryLabel, "前往设置启用社媒工具");
  await clickSelector(".workspace-domain-tools-settings");
  await waitFor("document.querySelector('.settings-drawer .settings-section-tab[aria-pressed=\"true\"]')?.textContent?.trim() === '插件'");
  await waitFor("Boolean(document.querySelector('[data-plugin-id=\"sparkai.social-content\"] .ui-action-primary'))");
  await clickSelector('[data-plugin-id="sparkai.social-content"] .ui-action-primary');
  await waitFor("document.querySelector('[data-plugin-id=\"sparkai.social-content\"] .settings-plugin-enable-toggle')?.getAttribute('aria-checked') === 'true'");
  await clickSelector(".settings-drawer .settings-surface-footer .ui-action-primary");
  await waitFor("document.querySelector('.settings-drawer .settings-surface-footer .ui-action-primary')?.disabled === true");
  await clickSelector(".settings-drawer .ui-surface-close");
  await waitFor("!document.querySelector('.settings-drawer') && document.querySelectorAll('.workspace-domain-tool-button').length === 5");

  const tools = await evaluate(client, `(() => ({
    commands: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('data-domain-tool-command') || ''),
    labels: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.querySelector('span')?.textContent?.trim() || ''),
    titles: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('title') || ''),
    visibleShortcutCount: document.querySelectorAll('.workspace-domain-tool-button kbd').length
  }))()`);
  assert.deepEqual(tools.commands, [
    "sparkai.social-content.new-xiaohongshu",
    "sparkai.social-content.new-douyin",
    "sparkai.social-content.open-recent",
    "sparkai.social-content.open-templates",
    "sparkai.social-content.open-publish-export"
  ]);
  assert.deepEqual(tools.labels, ["小红书", "抖音", "最近", "模板", "导出"]);
  assert.equal(tools.visibleShortcutCount, 0);
  assert(tools.titles[0].includes("Ctrl/⌘") && tools.titles[1].includes("Ctrl/⌘"));

  await clickSelector('[data-domain-tool-command="sparkai.social-content.new-xiaohongshu"]');
  await waitFor("Boolean(document.querySelector('.social-content-dialog'))");
  const xiaohongshu = await readSocialContentDialog();
  assert.equal(xiaohongshu?.title, "新建小红书图文");
  assert.equal(xiaohongshu?.activePlatform, "小红书图文");
  assert.deepEqual(xiaohongshu?.selectValues, ["experience-share", "3:4"]);
  assert.deepEqual(xiaohongshu?.numberValues, ["7"]);
  assert(xiaohongshu?.notices.some((item) => item.includes("第一次使用该工作流")));
  assert(xiaohongshu?.notices.some((item) => item.includes("预计生成约 8 张") && item.includes("点击执行即授权")));
  assert.match(xiaohongshu?.sourceSummary || "", /使用当前选中的 1 个图片素材范围/);
  assert.match(xiaohongshu?.footerSummary || "", /7 页图文.*8 张素材/);
  assert.equal(xiaohongshu?.viewportOk, true);
  assert.equal(xiaohongshu?.footerViewportOk, true);
  assert.equal(xiaohongshu?.bodyOverflowX, false);
  await capture("social-xiaohongshu-dialog");
  await clickSelector(".social-content-dialog .ui-surface-close");
  await waitFor("!document.querySelector('.social-content-dialog')");

  await clickSelector('[data-domain-tool-command="sparkai.social-content.new-douyin"]');
  await waitFor("Boolean(document.querySelector('.social-content-dialog'))");
  const douyin = await readSocialContentDialog();
  assert.equal(douyin?.title, "新建抖音短视频");
  assert.equal(douyin?.activePlatform, "抖音短视频");
  assert.deepEqual(douyin?.selectValues, ["voiceover-assets", "30"]);
  assert.deepEqual(douyin?.numberValues, ["6"]);
  assert.deepEqual(douyin?.readonlyValues, ["9:16"]);
  assert(douyin?.notices.some((item) => item.includes("第一次使用该工作流")));
  assert(douyin?.notices.some((item) => item.includes("预计生成约 7 张") && item.includes("1 个视频任务") && item.includes("点击执行即授权")));
  assert.match(douyin?.footerSummary || "", /30 秒.*6 镜.*7 张素材/);
  assert.equal(douyin?.viewportOk, true);
  assert.equal(douyin?.footerViewportOk, true);
  assert.equal(douyin?.bodyOverflowX, false);
  await capture("social-douyin-dialog");
  await clickSelector(".social-content-dialog .ui-surface-close");
  await waitFor("!document.querySelector('.social-content-dialog')");

  await clickSelector('[data-domain-tool-command="sparkai.social-content.open-publish-export"]');
  await waitFor("document.querySelector('.workspace-asset-rail')?.getAttribute('data-active-tab') === 'requirements'");
  await waitFor("document.querySelector('.project-agent-panel')?.textContent?.includes('当前画布还没有可导出的社媒项目。') === true");
  const finalState = await evaluate(client, "window.__naimageAIDebug.state()");
  assert.equal(finalState.messageCount, baseline.messageCount + 1, "Missing export guidance should add one local system message, not invoke the model");
  assert.deepEqual({
    agentStatus: finalState.agentStatus,
    activeRunId: finalState.activeRunId,
    progressCount: finalState.progressCount,
    nodeCount: finalState.nodeCount,
    selectedNodeId: finalState.selectedNodeId,
    selectedNodeIds: finalState.selectedNodeIds
  }, {
    agentStatus: baseline.agentStatus,
    activeRunId: baseline.activeRunId,
    progressCount: baseline.progressCount,
    nodeCount: baseline.nodeCount,
    selectedNodeId: baseline.selectedNodeId,
    selectedNodeIds: baseline.selectedNodeIds
  }, "Switching mode and opening Social dialogs must not call a model, mutate canvas nodes, or alter selection");
  await assertCanvasInvariant("Social dialog and export guidance", invariant);
  assert.deepEqual(consoleErrors, [], `Renderer console errors were recorded: ${JSON.stringify(consoleErrors, null, 2)}`);
  await capture("social-export-guidance");

  checks.socialContent = {
    ok: true,
    commands: tools.commands,
    labels: tools.labels,
    xiaohongshu,
    douyin,
    exportGuard: { activeRailTab: "requirements", localGuidanceMessages: 1, directoryPickerGuardedByMissingRequirement: true },
    modelCalls: 0,
    providerCalls: 0
  };
  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "social-content-smoke",
      suite: "social-content-gui",
      agentMode: "mock-agent",
      liveImageProvider: false,
      networkUsedForGeneration: false
    },
    reportAfterObservations: { checks, screenshots, consoleErrors, ignoredConsoleErrors },
    consoleAfterSummary: { checks: 1, screenshots: Object.keys(screenshots).length, consoleErrors: consoleErrors.length }
  });
  assert.equal(report.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "social-content-gui", report: join(runDir, "report.json"), screenshots: Object.keys(screenshots).length, modelCalls: 0 })}\n`);
}

async function readScientificFigureDialog() {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.scientific-figure-dialog');
    if (!(dialog instanceof HTMLElement)) return null;
    const body = dialog.querySelector('.scientific-figure-body');
    const footer = dialog.querySelector('.ui-surface-footer');
    const rect = dialog.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return {
      title: dialog.querySelector('.ui-surface-heading h2')?.textContent?.trim() || '',
      hero: dialog.querySelector('.scientific-hero')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      typeLabels: Array.from(dialog.querySelectorAll('.scientific-type-grid button span')).map((item) => item.textContent?.trim() || ''),
      backendLabels: Array.from(dialog.querySelectorAll('.scientific-backend-switch button > span')).map((item) => item.textContent?.trim() || ''),
      activeBackend: dialog.querySelector('.scientific-backend-switch button.active > span')?.textContent?.trim() || '',
      issueLabels: Array.from(dialog.querySelectorAll('.scientific-checklist li')).map((item) => item.textContent?.trim() || ''),
      panelCount: dialog.querySelectorAll('.scientific-panel-card').length,
      hasDataEmptyState: Boolean(dialog.querySelector('.scientific-data-empty')),
      footerActions: Array.from(dialog.querySelectorAll('.ui-surface-footer button')).map((item) => ({ text: item.textContent?.trim() || '', disabled: item.disabled })),
      viewportOk: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      footerViewportOk: Boolean(footerRect && footerRect.left >= -1 && footerRect.top >= -1 && footerRect.right <= innerWidth + 1 && footerRect.bottom <= innerHeight + 1),
      bodyOverflowX: body instanceof HTMLElement ? body.scrollWidth > body.clientWidth + 1 : true,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      dialogRect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  })()`);
}

async function runScientificFigureSmoke() {
  const seeded = await evaluate(client, `(async () => {
    const result = await window.__naimageAIDebug.seedSelectionCanvas();
    await window.__naimageAIDebug.fitCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A'], primaryId: 'A' });
    return { result, state: window.__naimageAIDebug.state() };
  })()`, 30_000);
  assert.equal(seeded?.result?.ok, true);
  const invariant = await readCanvasInvariant();
  const baseline = {
    agentStatus: seeded.state.agentStatus,
    activeRunId: seeded.state.activeRunId,
    messageCount: seeded.state.messageCount,
    progressCount: seeded.state.progressCount,
    nodeCount: seeded.state.nodeCount,
    selectedNodeId: seeded.state.selectedNodeId,
    selectedNodeIds: seeded.state.selectedNodeIds
  };
  const nodeGlass = await evaluate(client, `(() => {
    const node = Array.from(document.querySelectorAll('.flow-node[data-node-id="A"]')).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const image = node?.querySelector('.node-image-preview img, .node-image-tile img, .container-image-tile img');
    const nodeStyle = node ? getComputedStyle(node) : null;
    const imageStyle = image ? getComputedStyle(image) : null;
    return {
      borderRadius: nodeStyle?.borderRadius || '',
      backgroundColor: nodeStyle?.backgroundColor || '',
      imageOpacity: imageStyle?.opacity || '',
      imageFilter: imageStyle?.filter || '',
      imageBlendMode: imageStyle?.mixBlendMode || ''
    };
  })()`);
  assert(Number.parseFloat(nodeGlass.borderRadius) >= 10);
  assert.notEqual(nodeGlass.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(nodeGlass.imageOpacity, "1");
  assert.equal(nodeGlass.imageFilter, "none");
  assert.equal(nodeGlass.imageBlendMode, "normal");

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', code: 'Digit4', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'research' && document.querySelector('.ide-main')?.classList.contains('workspace-domain-research')");
  await assertCanvasInvariant("Research domain switch", invariant);
  await waitFor("Boolean(document.querySelector('.workspace-domain-tools[data-workspace-domain=\"research\"]'))");
  const initialToolCount = await evaluate(client, "document.querySelectorAll('.workspace-domain-tool-button').length");
  if (initialToolCount === 0) {
    await clickSelector(".workspace-domain-tools-settings");
    await waitFor("document.querySelector('.settings-drawer .settings-section-tab[aria-pressed=\"true\"]')?.textContent?.trim() === '插件'");
    await waitFor("Boolean(document.querySelector('[data-plugin-id=\"sparkai.scientific-figure\"] .ui-action-primary'))");
    await clickSelector('[data-plugin-id="sparkai.scientific-figure"] .ui-action-primary');
    await waitFor("document.querySelector('[data-plugin-id=\"sparkai.scientific-figure\"] .settings-plugin-enable-toggle')?.getAttribute('aria-checked') === 'true'");
    await clickSelector(".settings-drawer .settings-surface-footer .ui-action-primary");
    await waitFor("document.querySelector('.settings-drawer .settings-surface-footer .ui-action-primary')?.disabled === true");
    await clickSelector(".settings-drawer .ui-surface-close");
  }
  await waitFor("!document.querySelector('.settings-drawer') && document.querySelectorAll('.workspace-domain-tool-button').length === 6");
  const tools = await evaluate(client, `(() => ({
    commands: Array.from(document.querySelectorAll('.workspace-domain-tool-button')).map((button) => button.getAttribute('data-domain-tool-command') || ''),
    labels: Array.from(document.querySelectorAll('.workspace-domain-tool-button span')).map((item) => item.textContent?.trim() || ''),
    visibleShortcutCount: document.querySelectorAll('.workspace-domain-tool-button kbd').length
  }))()`);
  assert.deepEqual(tools.commands, [
    "sparkai.scientific-figure.import-data",
    "sparkai.scientific-figure.new-chart",
    "sparkai.scientific-figure.new-panel",
    "sparkai.scientific-figure.new-schematic",
    "sparkai.scientific-figure.rerender",
    "sparkai.scientific-figure.export"
  ]);
  assert.deepEqual(tools.labels, ["数据", "图表", "Panel", "示意", "重绘", "导出"]);
  assert.equal(tools.visibleShortcutCount, 0);

  await clickSelector('[data-domain-tool-command="sparkai.scientific-figure.new-chart"]');
  await waitFor("Boolean(document.querySelector('.scientific-figure-dialog'))");
  const chartInitial = await readScientificFigureDialog();
  assert.equal(chartInitial?.title, "科研绘图工作台");
  assert.match(chartInitial?.hero || "", /先讲清结论.*受控执行/);
  assert.deepEqual(chartInitial?.typeLabels, ["数据图表", "多 Panel 论文图", "科研示意图", "流程图", "论文图片比较"]);
  assert.deepEqual(chartInitial?.backendLabels, ["Python", "R"]);
  assert.equal(chartInitial?.activeBackend, "");
  assert.equal(chartInitial?.hasDataEmptyState, true);
  assert(chartInitial?.issueLabels.some((item) => item.includes("Python 或 R")));
  assert.equal(chartInitial?.viewportOk, true);
  assert.equal(chartInitial?.footerViewportOk, true);
  assert.equal(chartInitial?.bodyOverflowX, false);
  assert(Number.parseFloat(chartInitial?.borderRadius || "0") >= 16);
  await clickSelector(".scientific-backend-switch button", 0);
  await waitFor("document.querySelector('.scientific-backend-switch button.active > span')?.textContent?.trim() === 'Python'");
  const chartPython = await readScientificFigureDialog();
  assert.equal(chartPython?.activeBackend, "Python");
  assert.equal(chartPython?.issueLabels.some((item) => item.includes("Python 或 R")), false);
  await capture("scientific-chart-glass-dialog");

  await setWindowSize(1000, 700);
  await waitFor("innerWidth <= 1000 && innerHeight <= 700");
  const compact = await readScientificFigureDialog();
  assert.equal(compact?.viewportOk, true);
  assert.equal(compact?.footerViewportOk, true);
  assert.equal(compact?.bodyOverflowX, false);
  await capture("scientific-chart-compact-1000x700");
  await setWindowSize(1400, 900);
  await waitFor("innerWidth >= 1300 && innerHeight >= 800");
  await clickSelector(".scientific-figure-dialog .ui-surface-close");
  await waitFor("!document.querySelector('.scientific-figure-dialog')");

  await clickSelector('[data-domain-tool-command="sparkai.scientific-figure.new-panel"]');
  await waitFor("document.querySelectorAll('.scientific-panel-card').length === 2");
  const panelDialog = await readScientificFigureDialog();
  assert.equal(panelDialog?.panelCount, 2);
  assert.equal(panelDialog?.viewportOk, true);
  assert.equal(panelDialog?.bodyOverflowX, false);
  await capture("scientific-panel-glass-dialog");
  await clickSelector(".scientific-figure-dialog .ui-surface-close");
  await waitFor("!document.querySelector('.scientific-figure-dialog')");

  const finalState = await evaluate(client, "window.__naimageAIDebug.state()");
  assert.deepEqual({
    agentStatus: finalState.agentStatus,
    activeRunId: finalState.activeRunId,
    messageCount: finalState.messageCount,
    progressCount: finalState.progressCount,
    nodeCount: finalState.nodeCount,
    selectedNodeId: finalState.selectedNodeId,
    selectedNodeIds: finalState.selectedNodeIds
  }, baseline, "Research planning dialogs must not call a model, mutate canvas nodes, or alter selection");
  await assertCanvasInvariant("Scientific dialogs", invariant);
  assert.deepEqual(consoleErrors, [], `Renderer console errors were recorded: ${JSON.stringify(consoleErrors, null, 2)}`);

  checks.scientificFigure = {
    ok: true,
    commands: tools.commands,
    labels: tools.labels,
    chartInitial,
    chartPython,
    compact,
    panelDialog,
    nodeGlass,
    modelCalls: 0,
    providerCalls: 0,
    runnerCalls: 0
  };
  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "scientific-figure-smoke",
      suite: "scientific-figure-gui",
      agentMode: "mock-agent",
      liveImageProvider: false,
      networkUsedForGeneration: false
    },
    reportAfterObservations: { checks, screenshots, consoleErrors, ignoredConsoleErrors },
    consoleAfterSummary: { checks: 1, screenshots: Object.keys(screenshots).length, consoleErrors: consoleErrors.length }
  });
  assert.equal(report.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "scientific-figure-gui", report: join(runDir, "report.json"), screenshots: Object.keys(screenshots).length, modelCalls: 0, runnerCalls: 0 })}\n`);
}

async function runCommerceTutorialSmoke() {
  const seeded = await evaluate(client, `(async () => {
    const result = await window.__naimageAIDebug.seedSelectionCanvas();
    await window.__naimageAIDebug.fitCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A'], primaryId: 'A' });
    return { result, state: window.__naimageAIDebug.state() };
  })()`, 30_000);
  assert.equal(seeded?.result?.ok, true);
  const invariant = await readCanvasInvariant();
  const baseline = {
    agentStatus: seeded.state.agentStatus,
    activeRunId: seeded.state.activeRunId,
    messageCount: seeded.state.messageCount,
    progressCount: seeded.state.progressCount,
    nodeCount: seeded.state.nodeCount
  };

  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true })); undefined`);
  await waitFor("window.__naimageAIDebug.state().workspaceDomain === 'commerce' && Boolean(document.querySelector('.workspace-domain-tools[data-workspace-domain=\"commerce\"]'))");
  const initialToolCount = await evaluate(client, "document.querySelectorAll('.workspace-domain-tool-button').length");
  if (initialToolCount === 0) {
    await clickSelector(".workspace-domain-tools-settings");
    await waitFor("document.querySelector('.settings-drawer .settings-section-tab[aria-pressed=\"true\"]')?.textContent?.trim() === '插件'");
    await clickSelector('[data-plugin-id="sparkai.commerce-toolkit"] .ui-action-primary');
    await waitFor("document.querySelector('[data-plugin-id=\"sparkai.commerce-toolkit\"] .settings-plugin-enable-toggle')?.getAttribute('aria-checked') === 'true'");
    await clickSelector(".settings-drawer .settings-surface-footer .ui-action-primary");
    await waitFor("document.querySelector('.settings-drawer .settings-surface-footer .ui-action-primary')?.disabled === true");
    await clickSelector(".settings-drawer .ui-surface-close");
  }
  await waitFor("!document.querySelector('.settings-drawer') && document.querySelectorAll('.workspace-domain-tool-button').length === 6");

  await clickSelector(".app-help-button");
  await waitFor("Boolean(document.querySelector('.help-center-dialog'))");
  const tutorialNavIndex = await evaluate(client, `Array.from(document.querySelectorAll('.help-center-nav > button')).findIndex((button) => button.textContent?.includes('AI 示例教学'))`);
  assert(tutorialNavIndex >= 0);
  await clickSelector(".help-center-nav > button", tutorialNavIndex);
  await waitFor("document.querySelector('.help-center-nav > button[aria-pressed=\"true\"]')?.textContent?.includes('AI 示例教学') === true");
  await clickSelector(".help-tutorial-intro > .ui-action-button");
  await waitFor("Boolean(document.querySelector('.commerce-tutorial-layer.stage-welcome')) && !document.querySelector('.help-center-dialog')");

  const welcome = await evaluate(client, `(() => {
    const coach = document.querySelector('.commerce-tutorial-coach');
    const rect = coach?.getBoundingClientRect();
    const style = coach ? getComputedStyle(coach) : null;
    return {
      title: coach?.querySelector('h3')?.textContent?.trim() || '',
      safety: coach?.textContent?.includes('教学本身零费用') || false,
      borderRadius: style?.borderRadius || '',
      backgroundColor: style?.backgroundColor || '',
      viewportOk: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1)
    };
  })()`);
  assert.match(welcome.title, /第一套跨境商品图/);
  assert.equal(welcome.safety, true);
  assert(Number.parseFloat(welcome.borderRadius) >= 18);
  assert.notEqual(welcome.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(welcome.viewportOk, true);

  await clickSelector(".stage-welcome .commerce-tutorial-action.primary");
  await waitFor("Boolean(document.querySelector('.commerce-tutorial-layer.stage-import'))");
  await capture("commerce-tutorial-import-glass");
  await clickSelector(".stage-import .commerce-tutorial-actions .commerce-tutorial-action", 1);
  await waitFor("Boolean(document.querySelector('.commerce-tutorial-layer.stage-tool'))");
  const toolStage = await evaluate(client, `(() => ({
    hasSpotlight: Boolean(document.querySelector('.commerce-tutorial-spotlight')),
    copy: document.querySelector('.commerce-tutorial-content')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    setToolVisible: Boolean(document.querySelector('[data-domain-tool-command="sparkai.commerce-toolkit.generate-listing-set"]'))
  }))()`);
  assert.equal(toolStage.hasSpotlight, true);
  assert.equal(toolStage.setToolVisible, true);
  assert.match(toolStage.copy, /套图.*Agent/);
  await capture("commerce-tutorial-tool-choice");

  await clickSelector(".stage-tool .commerce-tutorial-actions .commerce-tutorial-action", 1);
  await waitFor("Boolean(document.querySelector('.commerce-tutorial-layer.stage-agent')) && document.querySelector('.project-agent-composer textarea')?.value?.includes('Amazon') === true");
  const agentStage = await evaluate(client, `(() => ({
    prompt: document.querySelector('.project-agent-composer textarea')?.value || '',
    explainsNoSend: document.querySelector('.commerce-tutorial-notice')?.textContent?.includes('尚未发送') || false,
    coachOnLeft: document.querySelector('.commerce-tutorial-coach')?.classList.contains('is-left') || false
  }))()`);
  assert.match(agentStage.prompt, /7 张上架套图/);
  assert.equal(agentStage.explainsNoSend, true);
  assert.equal(agentStage.coachOnLeft, true);
  await capture("commerce-tutorial-agent-example");

  await clickSelector(".stage-agent .commerce-tutorial-actions .commerce-tutorial-action", 1);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog')) && Boolean(document.querySelector('.commerce-tutorial-layer.stage-consent'))");
  const consent = await evaluate(client, `(() => ({
    dialogTitle: document.querySelector('.commerce-set-dialog .ui-surface-heading h2')?.textContent?.trim() || '',
    executionButtons: Array.from(document.querySelectorAll('.commerce-set-dialog .ui-surface-footer button')).map((button) => button.textContent?.trim() || ''),
    feeCopy: document.querySelector('.commerce-set-execution')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    tutorialBehindDialog: Number(getComputedStyle(document.querySelector('.commerce-tutorial-layer')).zIndex) < Number(getComputedStyle(document.querySelector('.ui-surface-layer.dialog-layer')).zIndex)
  }))()`);
  assert.match(consent.dialogTitle, /套图/);
  assert(consent.executionButtons.some((label) => label.includes("确认并执行")));
  assert.match(consent.feeCopy, /可计费请求/);
  assert.equal(consent.tutorialBehindDialog, true);
  await clickSelector(".commerce-set-dialog .ui-surface-close");
  await waitFor("!document.querySelector('.commerce-set-dialog') && Boolean(document.querySelector('.commerce-tutorial-layer.stage-consent'))");

  const finalState = await evaluate(client, "window.__naimageAIDebug.state()");
  assert.deepEqual({
    agentStatus: finalState.agentStatus,
    activeRunId: finalState.activeRunId,
    messageCount: finalState.messageCount,
    progressCount: finalState.progressCount,
    nodeCount: finalState.nodeCount
  }, baseline, "Tutorial guidance and preview must not call a model or mutate canvas nodes");
  const finalCanvas = await readCanvasInvariant();
  assert.deepEqual(finalCanvas?.nodeIds, invariant?.nodeIds, "Commerce tutorial preview must not add or remove canvas nodes");
  assert.deepEqual(consoleErrors, [], `Renderer console errors were recorded: ${JSON.stringify(consoleErrors, null, 2)}`);

  checks.commerceTutorial = {
    ok: true,
    welcome,
    toolStage,
    agentStage: { explainsNoSend: agentStage.explainsNoSend, coachOnLeft: agentStage.coachOnLeft },
    consent,
    modelCalls: 0,
    providerCalls: 0
  };
  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "commerce-tutorial-smoke",
      suite: "commerce-tutorial-gui",
      agentMode: "mock-agent",
      liveImageProvider: false,
      networkUsedForGeneration: false
    },
    reportAfterObservations: { checks, screenshots, consoleErrors, ignoredConsoleErrors },
    consoleAfterSummary: { checks: 1, screenshots: Object.keys(screenshots).length, consoleErrors: consoleErrors.length }
  });
  assert.equal(report.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "commerce-tutorial-gui", report: join(runDir, "report.json"), screenshots: Object.keys(screenshots).length, modelCalls: 0 })}\n`);
}

async function runStaticSelfTest() {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const workspaceSource = readFileSync(join(repoRoot, "src", "workspace-chrome.tsx"), "utf8");
  const glassLabSource = readFileSync(join(repoRoot, "src", "glass-lab.tsx"), "utf8");
  const commerceTutorialSource = readFileSync(join(repoRoot, "src", "commerce-tutorial.tsx"), "utf8");
  const commerceTutorialStyle = readFileSync(join(repoRoot, "src", "styles", "04i-commerce-tutorial.css"), "utf8");
  const suiteSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.deepEqual(THEME_IDS, ["dark-rose", "dark-ember", "dark-emerald", "light-silver", "light-lemon", "light-sky", "light-blush"]);
  assert.deepEqual(MATERIAL_IDS, ["clear", "frosted", "dense"]);
  assert.deepEqual(RAIL_TAB_IDS, ["results", "layers", "requirements", "templates", "history"]);
  assert.deepEqual(VIEW_MODE_IDS, ["workbench", "focus", "review"]);
  assert.equal(new Set(qaInventory.map((item) => item.id)).size, qaInventory.length);
  assert.match(qaInventory.find((item) => item.id === "asset-rail")?.claim || "", /results, layers, requirements, templates and history/);
  assert.equal(railTabHasExpectedContent("templates", { itemCount: 0, emptyVisible: true }), true);
  assert.equal(railTabHasExpectedContent("templates", { itemCount: 1, emptyVisible: false }), true);
  assert.equal(railTabHasExpectedContent("templates", { itemCount: 0, emptyVisible: false }), false);
  for (const tabId of RAIL_TAB_IDS.filter((id) => id !== "templates")) {
    assert.equal(railTabHasExpectedContent(tabId, { itemCount: 0, emptyVisible: true }), false, `${tabId} must remain fixture-backed`);
    assert.equal(railTabHasExpectedContent(tabId, { itemCount: 1, emptyVisible: false }), true, `${tabId} must accept fixture content`);
  }
  assert.equal(packageJson.scripts?.["aidebug:glass-workspace"], "node scripts/aidebug-glass-workspace-suite.mjs");
  assert.equal(packageJson.scripts?.["test:aidebug-glass-workspace"], "node scripts/aidebug-glass-workspace-suite.mjs --self-test");
  assert.equal(packageJson.scripts?.["aidebug:social-content"], "node scripts/aidebug-glass-workspace-suite.mjs --social-content-smoke");
  assert.equal(packageJson.scripts?.["aidebug:scientific-figure"], "node scripts/aidebug-glass-workspace-suite.mjs --scientific-figure-smoke");
  assert.equal(packageJson.scripts?.["aidebug:commerce-tutorial"], "node scripts/aidebug-glass-workspace-suite.mjs --commerce-tutorial-smoke");
  for (const token of ["WorkspaceAssetRail", "WorkspaceDirectionSwitcher", "data-active-tab"]) assert(workspaceSource.includes(token), `workspace chrome is missing ${token}`);
  for (const token of ["data-glass-theme", "data-glass-material", "data-glass-accent", "data-glass-control", "data-glass-toggle=\"noise\"", "data-glass-toggle=\"reduce-motion\""]) assert(glassLabSource.includes(token), `Glass Lab is missing ${token}`);
  for (const token of ["resolveCommerceTutorialStage", "COMMERCE_TUTORIAL_AGENT_PROMPT", "baselineResultCount", "教学本身零费用", "套图创作者徽章"]) assert(commerceTutorialSource.includes(token), `Commerce tutorial is missing ${token}`);
  for (const token of ["commerce-tutorial-spotlight", "commerce-tutorial-confetti", "prefers-reduced-motion", "var(--glass-backdrop-filter)"]) assert(commerceTutorialStyle.includes(token), `Commerce tutorial style is missing ${token}`);
  for (const token of ["NAIMAGE_AIDEBUG_LIVE_IMAGE: \"0\"", "NAIMAGE_AIDEBUG_REAL_AGENT: \"0\"", "seedSelectionCanvas()", "seedConnectionGeometryCanvas()", "CUSTOM_APPEARANCE", "installCanvasDomProbe", "waitForChildExit", "coldRestartPersistence", "setWindowSize(884, 640)", "projectSearch", "focusContinuation", "reviewDirection", "nonImageNavigation", "consoleErrors"]) assert(suiteSource.includes(token), `suite safety/coverage token is missing: ${token}`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    suite: "glass-workspace-static-selftest",
    themes: THEME_IDS.length,
    materials: MATERIAL_IDS.length,
    railTabs: RAIL_TAB_IDS.length,
    viewModes: VIEW_MODE_IDS.length,
    claims: qaInventory.length,
    providerNetworkEnabled: false
  })}\n`);
}

async function runGuiSuite() {
  mkdirSync(configDir, { recursive: true });
  recordObservation("info", "suite-checkpoint", { label: "bootstrap:prepare-run", runDir, mode: "glass-workspace-suite" });
  reporting = createAidebugReporting({
    runDir,
    desktopLogPath: join(runDir, "aidebug.log"),
    observations,
    mockAgent: true,
    cycleIndex: 1,
    cycleTotal: 1,
    fallbackPng,
    recordObservation,
    log: (value) => process.stdout.write(`${value}\n`)
  });
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");

  // Deliberately omit glass fields: this verifies the product defaults rather
  // than seeding the expected answer into the diagnostic configuration.
  writeFileSync(join(configDir, "app-settings.json"), `${JSON.stringify({
    theme: "light",
    agentPanelPlacement: "right",
    agentPanelWidth: 344,
    imageBatchSize: 2
  }, null, 2)}\n`, "utf8");

  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;
  const viteLog = createWriteStream(join(runDir, "vite.log"));

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      NAIMAGE_AIDEBUG: "1",
      NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
      NAIMAGE_AIDEBUG_REAL_AGENT: "0",
      NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
      NAIMAGE_AIDEBUG_AGENT_MODE: "mock"
    }
  });
  viteProcess.stdout?.pipe(viteLog);
  viteProcess.stderr?.pipe(viteLog);
  await waitForHttpServer(devUrl, { attempts: 160, intervalMs: 100, errorMessage: "Glass workspace AIDebug Vite server did not start." });
  await startElectronRenderer({ debugPort, vitePort, logName: "electron-process.log" });

  if (process.argv.includes("--workspace-domain-smoke")) {
    await runWorkspaceDomainSmoke();
    return;
  }
  if (process.argv.includes("--commerce-tutorial-smoke")) {
    await runCommerceTutorialSmoke();
    return;
  }
  if (process.argv.includes("--social-content-smoke")) {
    await runSocialContentSmoke();
    return;
  }
  if (process.argv.includes("--scientific-figure-smoke")) {
    await runScientificFigureSmoke();
    return;
  }

  const initialAppearance = await readAppearance();
  assert.equal(initialAppearance.theme, "dark-ember");
  assert.equal(initialAppearance.material, "frosted");
  assert.equal(initialAppearance.mode, "dark");
  assert(initialAppearance.glassRgb);
  assert(initialAppearance.blur.endsWith("px"));
  const storedDefault = await evaluate(client, "window.naimageConfig.loadSettings()");
  assert.equal(storedDefault?.settings?.glassTheme, "dark-ember");
  assert.equal(storedDefault?.settings?.glassMaterial, "frosted");
  checks.defaultAppearance = { ok: true, initialAppearance, stored: { glassTheme: storedDefault.settings.glassTheme, glassMaterial: storedDefault.settings.glassMaterial } };

  const seededFixture = await evaluate(client, "window.__naimageAIDebug.seedSelectionCanvas()", 30_000);
  assert.equal(seededFixture?.ok, true);
  assert(seededFixture?.fixtureIds?.layerIds?.length >= 2, "Local fixture must include real layer nodes");
  const requirementOpened = await evaluate(client, "window.__naimageAIDebug.openRequirementForSource({ id: 'A' })", 15_000);
  assert.equal(requirementOpened?.ok, true);
  await waitFor("Boolean(document.querySelector('.requirement-editor-dialog'))");
  await setTextValue(".requirement-editor-dialog .requirement-text-field textarea", "AIDebug reusable requirement fixture: preserve the product and prepare one clean marketplace variant.");
  await clickSelector(".requirement-editor-dialog .ui-surface-footer .ui-action-secondary");
  await waitFor("!document.querySelector('.requirement-editor-dialog') && document.querySelectorAll('.flow-node.requirement-node').length === 1", 15_000, 100);
  const fixture = await evaluate(client, `(async () => {
    await window.__naimageAIDebug.fitCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A'], primaryId: 'A' });
    return { state: window.__naimageAIDebug.state() };
  })()`, 30_000);
  assert(fixture.state.nodesRefIds.includes("A"));
  assert.equal(fixture.state.nodes.filter((node) => node.type === "requirement").length, 1);
  const invariant = await readCanvasInvariant();
  assert(invariant);
  const canvasDomBaseline = await installCanvasDomProbe();
  assert(canvasDomBaseline?.nodeIds?.length > 0, "The local fixture must expose rendered nodes for the DOM identity probe");
  checks.localFixture = {
    ok: true,
    nodeIds: invariant.nodeIds,
    layerIds: seededFixture.fixtureIds.layerIds,
    requirementCount: fixture.state.nodes.filter((node) => node.type === "requirement").length,
    assetMode: "local-data-url",
    realProviderCalled: false
  };
  const agentSurface = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-agent-panel');
    const style = panel ? getComputedStyle(panel) : null;
    const box = panel?.getBoundingClientRect();
    return {
      visible: Boolean(panel && box && box.width > 0 && box.height > 0),
      insideViewport: Boolean(box && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1),
      backgroundColor: style?.backgroundColor || '',
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || 'none'
    };
  })()`);
  assert.equal(agentSurface.visible, true);
  assert.equal(agentSurface.insideViewport, true);
  assert.match(agentSurface.backdropFilter, /blur\(/);
  checks.agentSurface = { ok: true, ...agentSurface };
  await capture("00-default-workbench");

  await clickSelector(".workspace-glass-lab-button");
  await waitFor("Boolean(document.querySelector('.settings-drawer .glass-lab'))", 15_000, 80);
  const settingsSurface = await evaluate(client, `(() => {
    const drawer = document.querySelector('.settings-drawer');
    const style = drawer ? getComputedStyle(drawer) : null;
    return {
      open: Boolean(drawer),
      appearanceSelected: document.querySelector('.settings-section-tab[aria-pressed="true"]')?.textContent?.trim() || '',
      radius: Number.parseFloat(style?.borderRadius || '0'),
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || 'none'
    };
  })()`);
  assert.equal(settingsSurface.open, true);
  assert(settingsSurface.radius > 0);
  assert.match(settingsSurface.backdropFilter, /blur\(/);
  checks.settingsSurface = { ok: true, ...settingsSurface };
  await capture("06-settings-surface");

  const themeChecks = [];
  for (const themeId of THEME_IDS) {
    await clickTheme(themeId);
    const appearance = await readAppearance();
    assert.equal(appearance.theme, themeId);
    assert.equal(appearance.mode, themeId.startsWith("dark-") ? "dark" : "light");
    assert(appearance.accentColor);
    await assertCanvasInvariant(`Theme ${themeId}`, invariant);
    const cardPressed = await evaluate(client, `document.querySelector('[data-glass-section="themes"] [data-glass-theme=${JSON.stringify(themeId)}]')?.getAttribute('aria-pressed') === 'true'`);
    assert.equal(cardPressed, true);
    themeChecks.push({ themeId, appearance, cardPressed });
    await capture(`01-theme-${themeId}`);
  }
  checks.sevenThemes = { ok: true, themes: themeChecks };

  const rapidThemeSequence = ["dark-rose", "light-silver", "dark-emerald", "light-lemon", "dark-ember", "light-blush", "dark-rose", "light-sky"];
  for (const themeId of rapidThemeSequence) await clickTheme(themeId, 35);
  const rapidThemeCanvas = await assertCanvasDomProbe("Rapid light/dark theme switching", canvasDomBaseline);
  await assertCanvasInvariant("Rapid light/dark theme switching", invariant);
  checks.rapidThemeSwitch = { ok: true, sequence: rapidThemeSequence, canvas: rapidThemeCanvas };

  const materialChecks = [];
  for (const materialId of MATERIAL_IDS) {
    await clickMaterial(materialId);
    const appearance = await readAppearance();
    assert.equal(appearance.material, materialId);
    assert(appearance.opacity);
    assert(appearance.blur);
    await assertCanvasInvariant(`Material ${materialId}`, invariant);
    materialChecks.push({ materialId, appearance });
    await capture(`02-material-${materialId}`);
  }
  checks.threeMaterials = { ok: true, materials: materialChecks };

  await clickTheme("light-sky");
  await clickMaterial("frosted");
  const controlExpectations = {
    opacity: "0.61",
    blur: "0px",
    saturation: "173%",
    highlight: "0.57",
    shadow: "0.39",
    radius: "24px"
  };
  const numericControlChecks = [];
  for (const key of ["opacity", "blur", "saturation", "highlight", "shadow", "radius"]) {
    await setRangeValue(`#glass-${key}`, CUSTOM_APPEARANCE[key]);
    await waitFor(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(`--glass-${key}`)}).trim() === ${JSON.stringify(controlExpectations[key])}`);
    const appearance = await readAppearance();
    assert.equal(appearance.material, "custom");
    assert.equal(appearance[key], controlExpectations[key]);
    const control = await evaluate(client, `(() => {
      const label = document.querySelector('[data-glass-control=${JSON.stringify(key)}]');
      return {
        value: label?.querySelector('input')?.value || '',
        output: label?.querySelector('output')?.textContent?.trim() || ''
      };
    })()`);
    assert.equal(control.value, String(CUSTOM_APPEARANCE[key]));
    assert(control.output.includes(String(CUSTOM_APPEARANCE[key])));
    numericControlChecks.push({ key, appearanceValue: appearance[key], ...control });
  }
  await clickSelector('[data-glass-section="accent"] [data-glass-accent="coral"]');
  await setCheckboxValue('[data-glass-toggle="noise"] input', false);
  await setCheckboxValue('[data-glass-toggle="reduce-motion"] input', true);
  await waitFor("document.documentElement.dataset.glassAccent === 'coral' && document.documentElement.dataset.glassNoise === 'off' && document.documentElement.dataset.glassReduceMotion === 'true'");
  await evaluate(client, "document.querySelector('[data-glass-section=\"behavior\"]')?.scrollIntoView({ block: 'center' }); undefined");
  await delay(260);
  const customAppearance = await readAppearance();
  assert.deepEqual({
    theme: customAppearance.theme,
    material: customAppearance.material,
    opacity: customAppearance.opacity,
    blur: customAppearance.blur,
    saturation: customAppearance.saturation,
    highlight: customAppearance.highlight,
    shadow: customAppearance.shadow,
    radius: customAppearance.radius,
    accent: customAppearance.accent,
    noise: customAppearance.noise,
    reduceMotion: customAppearance.reduceMotion,
    noiseOpacity: customAppearance.noiseOpacity,
    motionDuration: customAppearance.motionDuration
  }, {
    theme: "light-sky",
    material: "custom",
    opacity: "0.61",
    blur: "0px",
    saturation: "173%",
    highlight: "0.57",
    shadow: "0.39",
    radius: "24px",
    accent: "coral",
    noise: "off",
    reduceMotion: "true",
    noiseOpacity: "0",
    motionDuration: "0ms"
  });
  await assertCanvasInvariant("All custom Glass controls", invariant);
  const customCanvas = await assertCanvasDomProbe("All custom Glass controls", canvasDomBaseline);
  checks.allGlassControls = { ok: true, numeric: numericControlChecks, appearance: customAppearance, canvas: customCanvas };
  await capture("03-custom-all-controls");

  await clickSelector('[data-glass-action="reset-recommended"]');
  await waitFor("document.documentElement.dataset.glassMaterial === 'frosted' && document.documentElement.dataset.glassAccent === 'theme' && document.documentElement.dataset.glassNoise === 'on' && document.documentElement.dataset.glassReduceMotion === 'false'");
  const restoredRecommended = await readAppearance();
  assert.equal(restoredRecommended.opacity, "0.44");
  assert.equal(restoredRecommended.blur, "28px");
  assert.equal(restoredRecommended.saturation, "128%");
  assert.equal(restoredRecommended.radius, "14px");
  await assertCanvasDomProbe("Recommended Glass reset", canvasDomBaseline);
  checks.restoredRecommended = { ok: true, appearance: restoredRecommended };
  await capture("03-reset-recommended");

  await applyCustomAppearanceControls();
  await clickSelector(".settings-surface-footer .ui-action-primary");
  await waitFor("document.querySelector('.settings-surface-footer .ui-action-primary')?.disabled === true", 15_000, 100);
  const savedCustom = await evaluate(client, "window.naimageConfig.loadSettings()");
  assert.equal(savedCustom?.settings?.glassTheme, CUSTOM_APPEARANCE.theme);
  assert.equal(savedCustom?.settings?.glassMaterial, CUSTOM_APPEARANCE.material);
  assert.deepEqual(savedCustom?.settings?.glassParameters, {
    opacity: CUSTOM_APPEARANCE.opacity,
    blur: CUSTOM_APPEARANCE.blur,
    saturation: CUSTOM_APPEARANCE.saturation,
    highlight: CUSTOM_APPEARANCE.highlight,
    shadow: CUSTOM_APPEARANCE.shadow,
    radius: CUSTOM_APPEARANCE.radius,
    accent: CUSTOM_APPEARANCE.accent,
    noise: CUSTOM_APPEARANCE.noise,
    reduceMotion: CUSTOM_APPEARANCE.reduceMotion
  });
  await assertCanvasDomProbe("Saved custom Glass appearance", canvasDomBaseline);
  checks.savedCustomAppearance = { ok: true, saved: { theme: savedCustom.settings.glassTheme, material: savedCustom.settings.glassMaterial, parameters: savedCustom.settings.glassParameters } };
  await capture("09-custom-before-restart");
  await clickSelector(".settings-drawer .ui-surface-close");
  await waitFor("!document.querySelector('.settings-drawer')");

  const railChecks = [];
  for (const tabId of RAIL_TAB_IDS) {
    const state = await selectRailTab(tabId);
    assert.equal(state.activeTab, tabId);
    assert.equal(state.activeButtons, 1);
    assert(
      railTabHasExpectedContent(tabId, state),
      tabId === "templates"
        ? "Asset rail templates tab must expose saved templates or its explicit empty state"
        : `Asset rail ${tabId} tab must expose fixture-backed content`
    );
    await assertCanvasInvariant(`Asset rail tab ${tabId}`, invariant);
    railChecks.push({ tabId, ...state });
    await capture(`04-rail-${tabId}`);
  }
  checks.assetRailTabs = { ok: true, tabs: railChecks };
  await selectRailTab("results");

  await selectWorkspaceMode("focus");
  await clickSelector(".workspace-search-trigger");
  await waitFor("Boolean(document.querySelector('.workspace-search-popover input'))");
  await setTextValue(".workspace-search-popover input", "选择测试 B");
  await waitFor("Boolean(document.querySelector('.workspace-search-result[data-search-kind=\"node\"][data-search-id=\"B\"]'))");
  const searchNodeResult = await evaluate(client, `(() => {
    const result = document.querySelector('.workspace-search-result[data-search-kind="node"][data-search-id="B"]');
    const first = document.querySelector('.workspace-search-result[data-search-kind="node"]');
    const popover = document.querySelector('.workspace-search-popover');
    const input = popover?.querySelector('input');
    const title = result?.querySelector('strong');
    const detail = result?.querySelector('small');
    const popoverStyle = popover ? getComputedStyle(popover) : null;
    const alphaOf = (value) => {
      const text = String(value || '').trim().toLowerCase();
      if (!text || text === 'transparent') return 0;
      if (text.startsWith('rgba(')) {
        const closeIndex = text.lastIndexOf(')');
        const channels = text
          .slice(5, closeIndex > 5 ? closeIndex : undefined)
          .split(',')
          .map((channel) => channel.trim());
        const alphaText = channels[3] || '';
        const alpha = Number.parseFloat(alphaText);
        if (Number.isFinite(alpha)) return alphaText.endsWith('%') ? alpha / 100 : alpha;
      }
      const slashIndex = text.lastIndexOf('/');
      if (slashIndex >= 0) {
        const alphaText = text.slice(slashIndex + 1).split(')')[0].trim();
        const alpha = Number.parseFloat(alphaText);
        if (Number.isFinite(alpha)) return alphaText.endsWith('%') ? alpha / 100 : alpha;
      }
      return 1;
    };
    return {
      label: title?.textContent?.trim() || '',
      detail: detail?.textContent?.trim() || '',
      exactMatchRanksFirst: first === result,
      backgroundColor: popoverStyle?.backgroundColor || '',
      backgroundAlpha: alphaOf(popoverStyle?.backgroundColor),
      backdropFilter: popoverStyle?.backdropFilter || popoverStyle?.webkitBackdropFilter || '',
      inputFontSize: Number.parseFloat(input ? getComputedStyle(input).fontSize : '0') || 0,
      titleFontSize: Number.parseFloat(title ? getComputedStyle(title).fontSize : '0') || 0,
      detailFontSize: Number.parseFloat(detail ? getComputedStyle(detail).fontSize : '0') || 0
    };
  })()`);
  assert.equal(searchNodeResult.label, "选择测试 B");
  assert.equal(searchNodeResult.detail, "图片成果");
  assert.equal(searchNodeResult.exactMatchRanksFirst, true);
  assert(searchNodeResult.backgroundAlpha >= 0.95, `Project search surface must be effectively opaque: ${JSON.stringify(searchNodeResult)}`);
  assert.equal(searchNodeResult.backdropFilter, "none", `Project search must not bleed the canvas through backdrop filtering: ${JSON.stringify(searchNodeResult)}`);
  assert(searchNodeResult.inputFontSize >= 12 && searchNodeResult.titleFontSize >= 11 && searchNodeResult.detailFontSize >= 10, `Project search typography is too small: ${JSON.stringify(searchNodeResult)}`);
  await clickSelector('.workspace-search-result[data-search-kind="node"][data-search-id="B"]');
  await waitFor("window.__naimageAIDebug.state().selectedNodeId === 'B'");
  await clickSelector(".workspace-search-trigger");
  await waitFor("Boolean(document.querySelector('.workspace-search-popover input'))");
  const conversationSearchCount = await evaluate(client, "document.querySelectorAll('.workspace-search-result[data-search-kind=\"conversation\"]').length");
  assert(conversationSearchCount >= 1, "Project search must expose the active or persisted conversation");
  await capture("04-search-live-state");
  await clickSelector('.workspace-search-result[data-search-kind="conversation"]');
  await waitFor("!document.querySelector('.workspace-search-popover')");
  await assertCanvasInvariant("Project search navigation", invariant);
  checks.projectSearch = { ok: true, nodeResult: searchNodeResult, conversationSearchCount, selectedNodeId: "B" };

  const focusBeforeContinue = await readCanvasInvariant();
  await clickSelector(".workspace-focus-add");
  await waitFor("Boolean(document.querySelector('.unified-node-editor [data-node-editor-action=\"continue\"]'))", 15_000, 80);
  const focusContinuation = await evaluate(client, `(() => ({
    selectedNodeId: window.__naimageAIDebug.state().selectedNodeId,
    nodeIds: window.__naimageAIDebug.state().nodesRefIds,
    confirmationVisible: Boolean(document.querySelector('.unified-node-editor [data-node-editor-action="continue"]')),
    providerRequestVisible: Boolean(document.querySelector('.flow-node[data-node-id="B"] .node-progress'))
  }))()`);
  assert.equal(focusContinuation.selectedNodeId, "B");
  assert.equal(focusContinuation.confirmationVisible, true);
  assert.deepEqual(focusContinuation.nodeIds, focusBeforeContinue.nodeIds, "Opening Focus continuation must not create a result before user confirmation");
  await capture("05-focus-continue-confirmation");
  await clickSelector('.unified-node-editor [data-node-editor-action="cancel"]');
  await waitFor("!document.querySelector('.unified-node-editor')");
  checks.focusContinuation = { ok: true, ...focusContinuation, dispatchedProviderRequest: false };

  const modeChecks = [];
  for (const modeId of VIEW_MODE_IDS) {
    const state = await selectWorkspaceMode(modeId);
    assert.equal(state.activeButtons, 1);
    if (modeId === "focus") assert.equal(state.focusVisible, true);
    if (modeId === "review") assert.equal(state.reviewVisible, true);
    await assertCanvasInvariant(`Workspace mode ${modeId}`, invariant);
    modeChecks.push(state);
    await capture(`05-mode-${modeId}`);
  }
  checks.workspaceViewModes = { ok: true, modes: modeChecks, invariant };

  await selectWorkspaceMode("review");
  const reviewTarget = await evaluate(client, `(() => {
    const button = document.querySelectorAll('.workspace-review-card > button')[1];
    return { nodeId: button?.getAttribute('data-node-id') || '', label: button?.querySelector('strong')?.textContent?.trim() || '' };
  })()`);
  assert(reviewTarget.nodeId && reviewTarget.label, "Review mode must expose at least two fixture directions");
  const reviewTargetNodeId = reviewTarget.nodeId;
  assert(reviewTargetNodeId, "Review direction must map to a canonical node id");
  await clickSelector(".workspace-review-card > button", 1);
  await waitFor(`window.__naimageAIDebug.state().selectedNodeId === ${JSON.stringify(reviewTargetNodeId)}`);
  await waitFor(`(async () => {
    const state = window.__naimageAIDebug.state();
    const persisted = await window.naimageConfig.loadSession({ projectId: state.activeProjectId });
    return persisted?.session?.selectedNodeId === ${JSON.stringify(reviewTargetNodeId)};
  })()`, 15_000, 100);
  const reviewDirection = await evaluate(client, `(async () => {
    const state = window.__naimageAIDebug.state();
    const persisted = await window.naimageConfig.loadSession({ projectId: state.activeProjectId });
    return {
      selectedNodeId: state.selectedNodeId,
      persistedSelectedNodeId: persisted?.session?.selectedNodeId || '',
      pressedCount: document.querySelectorAll('.workspace-review-card > button[aria-pressed="true"]').length,
      currentDirectionText: document.querySelector('.workspace-review-card > button[aria-pressed="true"] small')?.textContent?.trim() || ''
    };
  })()`);
  assert.equal(reviewDirection.selectedNodeId, reviewTargetNodeId);
  assert.equal(reviewDirection.persistedSelectedNodeId, reviewTargetNodeId);
  assert.equal(reviewDirection.pressedCount, 1);
  assert.match(reviewDirection.currentDirectionText, /当前方向/);
  await assertCanvasInvariant("Review direction selection", invariant);
  checks.reviewDirection = { ok: true, targetLabel: reviewTarget.label, targetNodeId: reviewTargetNodeId, ...reviewDirection };
  await capture("05-review-direction");
  await selectWorkspaceMode("workbench");

  await clickSelector(".file-command-menu > button");
  await waitFor("Boolean(document.querySelector('.file-command-popover'))");
  const menuSurface = await evaluate(client, `(() => {
    const menu = document.querySelector('.file-command-popover');
    const style = menu ? getComputedStyle(menu) : null;
    const rect = menu?.getBoundingClientRect();
    return {
      open: Boolean(menu),
      itemCount: menu?.querySelectorAll('button').length || 0,
      insideViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
      radius: Number.parseFloat(style?.borderRadius || '0'),
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || 'none'
    };
  })()`);
  assert.equal(menuSurface.open, true);
  assert(menuSurface.itemCount >= 4);
  assert.equal(menuSurface.insideViewport, true);
  assert(menuSurface.radius > 0);
  assert.match(menuSurface.backdropFilter, /blur\(/);
  checks.menuSurface = { ok: true, ...menuSurface };
  await capture("07-menu-surface");
  await clickSelector(".file-command-menu > button");
  await waitFor("!document.querySelector('.file-command-popover')");

  await assertCanvasInvariant("All appearance, rail, and view switches", invariant);
  checks.canvasInvariant = { ok: true, before: invariant, after: await readCanvasInvariant() };

  await selectWorkspaceMode("focus");
  const requirementNavigationTarget = await evaluate(client, `(() => {
    const node = window.__naimageAIDebug.state().nodes.find((item) => item.type === 'requirement');
    return node ? { id: node.id, title: node.title || node.prompt || node.id } : null;
  })()`);
  assert(requirementNavigationTarget?.id && requirementNavigationTarget?.title, "The local fixture must expose a searchable requirement");
  await clickSelector(".workspace-search-trigger");
  await waitFor("Boolean(document.querySelector('.workspace-search-popover input'))");
  await setTextValue(".workspace-search-popover input", requirementNavigationTarget.title);
  await waitFor(`Boolean(document.querySelector('.workspace-search-result[data-search-kind="node"][data-search-id=${JSON.stringify(requirementNavigationTarget.id)}]'))`);
  await clickSelector(`.workspace-search-result[data-search-kind="node"][data-search-id=${JSON.stringify(requirementNavigationTarget.id)}]`);
  await waitFor(`document.querySelector('.ide-main')?.classList.contains('workspace-mode-workbench') === true && window.__naimageAIDebug.state().selectedNodeId === ${JSON.stringify(requirementNavigationTarget.id)}`);
  const nonImageNavigation = await evaluate(client, `(() => ({
    selectedNodeId: window.__naimageAIDebug.state().selectedNodeId,
    mode: document.querySelector('.ide-main')?.className.match(/workspace-mode-([^\\s]+)/)?.[1] || '',
    focusVisible: Boolean(document.querySelector('.workspace-focus-stage')),
    taskTitle: document.querySelector('.workspace-task-context strong')?.textContent?.trim() || '',
    nodeIds: window.__naimageAIDebug.state().nodesRefIds
  }))()`);
  assert.equal(nonImageNavigation.selectedNodeId, requirementNavigationTarget.id);
  assert.equal(nonImageNavigation.mode, "workbench");
  assert.equal(nonImageNavigation.focusVisible, false);
  assert.deepEqual(nonImageNavigation.nodeIds, invariant.nodeIds, "Requirement navigation must preserve canvas nodes");
  checks.nonImageNavigation = { ok: true, ...nonImageNavigation };
  await capture("05-requirement-navigation-workbench");

  const resumedLayoutRefocus = await evaluate(client, "window.__naimageAIDebug.resumeLayoutRefocus()");
  assert.equal(resumedLayoutRefocus?.ok, true, "Minimum-width QA must restore the product's selected-node resize refocus path");
  const minimumWindow = await setWindowSize(884, 640);
  assert(Math.abs(minimumWindow.metrics.innerWidth - 884) <= 2, `Expected 884 px content width: ${JSON.stringify(minimumWindow)}`);
  assert(Math.abs(minimumWindow.metrics.innerHeight - 640) <= 2, `Expected 640 px content height: ${JSON.stringify(minimumWindow)}`);
  await waitFor(`(() => {
    const canvas = document.querySelector('.canvas-panel');
    const selectedNodeId = window.__naimageAIDebug?.state?.().selectedNodeId || '';
    const selected = Array.from(document.querySelectorAll('.flow-node.selected[data-node-id]'))
      .find((element) => element.getAttribute('data-node-id') === selectedNodeId);
    if (!(canvas instanceof HTMLElement) || !(selected instanceof HTMLElement)) return false;
    const canvasRect = canvas.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return selectedRect.left >= canvasRect.left - 1 && selectedRect.top >= canvasRect.top - 1 && selectedRect.right <= canvasRect.right + 1 && selectedRect.bottom <= canvasRect.bottom + 1;
  })()`, 5_000, 80);
  const minimumLayout = await evaluate(client, `(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const inside = (box) => Boolean(box && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1);
    const rail = rect('.workspace-asset-rail');
    const canvas = rect('.canvas-panel');
    const agent = rect('.project-agent-panel');
    const topbar = rect('.ide-topbar');
    const center = rect('.workspace-topbar-center');
    const selectedNodeId = window.__naimageAIDebug?.state?.().selectedNodeId || '';
    const selectedNodeElements = Array.from(document.querySelectorAll('.flow-node.selected[data-node-id]'));
    const selectedNodeElement = selectedNodeElements.find((element) => element.getAttribute('data-node-id') === selectedNodeId) || null;
    const selectedNode = selectedNodeElement ? (() => {
      const box = selectedNodeElement.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    })() : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      documentOverflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
      bodyOverflowY: document.body.scrollHeight > document.body.clientHeight + 1,
      rail,
      canvas,
      agent,
      topbar,
      center,
      selectedNode,
      selectedNodeId,
      selectedNodeDomId: selectedNodeElement?.getAttribute('data-node-id') || '',
      selectedNodeCount: selectedNodeElements.length,
      railInside: inside(rail),
      canvasInside: inside(canvas),
      agentInside: inside(agent),
      topbarInside: inside(topbar),
      centerInside: inside(center),
      selectedNodeInsideCanvas: Boolean(selectedNode && canvas && selectedNode.left >= canvas.left - 1 && selectedNode.top >= canvas.top - 1 && selectedNode.right <= canvas.right + 1 && selectedNode.bottom <= canvas.bottom + 1),
      canvasUsable: Boolean(canvas && canvas.width >= 260 && canvas.height >= 360),
      agentUsable: Boolean(agent && agent.width >= 48 && agent.height >= 300)
    };
  })()`);
  assert.equal(minimumLayout.documentOverflowX, false);
  assert.equal(minimumLayout.documentOverflowY, false);
  assert.equal(minimumLayout.bodyOverflowX, false);
  assert.equal(minimumLayout.bodyOverflowY, false);
  assert.equal(minimumLayout.railInside, true);
  assert.equal(minimumLayout.canvasInside, true);
  assert.equal(minimumLayout.agentInside, true);
  assert.equal(minimumLayout.topbarInside, true);
  assert.equal(minimumLayout.centerInside, true);
  assert.ok(minimumLayout.selectedNodeId, `Minimum-window QA requires a canonical selected node: ${JSON.stringify(minimumLayout)}`);
  assert.equal(minimumLayout.selectedNodeCount, 1, `Exactly one selected node must be rendered: ${JSON.stringify(minimumLayout)}`);
  assert.equal(minimumLayout.selectedNodeDomId, minimumLayout.selectedNodeId, `Selected DOM node must match canonical selectedNodeId: ${JSON.stringify(minimumLayout)}`);
  assert.equal(minimumLayout.selectedNodeInsideCanvas, true, `Selected node must remain fully visible inside the minimum-width canvas: ${JSON.stringify(minimumLayout)}`);
  assert.equal(minimumLayout.canvasUsable, true);
  assert.equal(minimumLayout.agentUsable, true);
  assert.deepEqual((await readCanvasInvariant()).nodeIds, invariant.nodeIds, "Minimum-width resize must preserve canvas nodes");
  checks.minimumWindow884x640 = { ok: true, minimumWindow, minimumLayout };
  await capture("08-minimum-window-884x640");

  await clickSelector(".workspace-glass-lab-button");
  await waitFor("Boolean(document.querySelector('.settings-drawer .glass-lab'))", 15_000, 80);
  const minimumSettings = await evaluate(client, `(() => {
    const inside = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const box = element.getBoundingClientRect();
      return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    };
    const drawer = document.querySelector('.settings-drawer');
    const body = document.querySelector('.settings-surface-body');
    const footer = document.querySelector('.settings-surface-footer');
    const bodyStyle = body ? getComputedStyle(body) : null;
    return {
      drawerInside: inside(drawer),
      footerInside: inside(footer),
      bodyClientHeight: body?.clientHeight || 0,
      bodyScrollHeight: body?.scrollHeight || 0,
      bodyOverflowY: bodyStyle?.overflowY || '',
      bodyScrollSafe: Boolean(body && (body.scrollHeight <= body.clientHeight + 1 || /auto|scroll/.test(bodyStyle?.overflowY || ''))),
      numericControlCount: document.querySelectorAll('[data-glass-section="parameters"] input[type="range"]').length,
      behaviorToggleCount: document.querySelectorAll('[data-glass-section="behavior"] input[type="checkbox"]').length,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1
    };
  })()`);
  assert.equal(minimumSettings.drawerInside, true);
  assert.equal(minimumSettings.footerInside, true);
  assert.equal(minimumSettings.bodyScrollSafe, true);
  assert.equal(minimumSettings.numericControlCount, 6);
  assert.equal(minimumSettings.behaviorToggleCount, 2);
  assert.equal(minimumSettings.documentOverflowX, false);
  assert.equal(minimumSettings.bodyOverflowX, false);
  checks.minimumWindowSettings = { ok: true, ...minimumSettings };
  await capture("08-minimum-window-884x640-settings");
  await clickSelector(".settings-drawer .ui-surface-close");
  await waitFor("!document.querySelector('.settings-drawer')");

  await clickSelector(".file-command-menu > button");
  await waitFor("Boolean(document.querySelector('.file-command-popover'))");
  const minimumMenu = await evaluate(client, `(() => {
    const menu = document.querySelector('.file-command-popover');
    const box = menu?.getBoundingClientRect();
    return {
      visible: Boolean(menu && box && box.width > 0 && box.height > 0),
      inside: Boolean(box && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1),
      itemCount: menu?.querySelectorAll('button').length || 0
    };
  })()`);
  assert.equal(minimumMenu.visible, true);
  assert.equal(minimumMenu.inside, true);
  assert(minimumMenu.itemCount >= 4);
  checks.minimumWindowMenu = { ok: true, ...minimumMenu };
  await capture("08-minimum-window-884x640-menu");
  await clickSelector(".file-command-menu > button");
  await waitFor("!document.querySelector('.file-command-popover')");

  const firstClose = await closeElectronRenderer();
  assert.equal(firstClose.closeRequested, true, "The persistence check must request a real BrowserWindow close");
  assert.equal(firstClose.graceful, true, "The first Electron process must exit cleanly before restart");
  const restartDebugPort = await allocateDebugPort();
  await startElectronRenderer({ debugPort: restartDebugPort, vitePort, logName: "electron-restart-process.log" });
  const restarted = await evaluate(client, `(async () => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const persisted = await window.naimageConfig.loadSettings();
    let snapshot = null;
    try { snapshot = JSON.parse(localStorage.getItem('naimage.glassTheme.bootstrap.v1') || 'null'); } catch {}
    return {
      bootState: window.__naimageGlassBootState || null,
      root: {
        theme: root.dataset.glassTheme || '',
        mode: root.dataset.glassMode || '',
        material: root.dataset.glassMaterial || '',
        accent: root.dataset.glassAccent || '',
        noise: root.dataset.glassNoise || '',
        reduceMotion: root.dataset.glassReduceMotion || '',
        opacity: style.getPropertyValue('--glass-opacity').trim(),
        blur: style.getPropertyValue('--glass-blur').trim(),
        saturation: style.getPropertyValue('--glass-saturation').trim(),
        highlight: style.getPropertyValue('--glass-highlight').trim(),
        shadow: style.getPropertyValue('--glass-shadow').trim(),
        radius: style.getPropertyValue('--glass-radius').trim(),
        nativeBackgroundToken: style.getPropertyValue('--theme-canvas').trim()
      },
      persisted: persisted?.settings || null,
      snapshot
    };
  })()`);
  assert.equal(restarted.bootState?.restored, true);
  assert.equal(restarted.bootState?.schema, "v1");
  assert.equal(restarted.bootState?.glassTheme, CUSTOM_APPEARANCE.theme);
  assert.equal(restarted.bootState?.glassMaterial, CUSTOM_APPEARANCE.material);
  assert.equal(restarted.bootState?.accent, CUSTOM_APPEARANCE.accent);
  const restartAppearanceTrace = restarted.bootState?.appearanceTrace;
  assert(Array.isArray(restartAppearanceTrace), "Cold restart must expose the bounded bootstrap-to-React appearance trace");
  assert(restartAppearanceTrace.length >= 2 && restartAppearanceTrace.length <= 8, `Cold restart appearance trace must contain bootstrap and React layout entries: ${JSON.stringify(restartAppearanceTrace)}`);
  assert.equal(restartAppearanceTrace[0]?.source, "bootstrap");
  assert(restartAppearanceTrace.some((entry) => entry?.source === "react-layout"), `Cold restart appearance trace must include a React layout effect: ${JSON.stringify(restartAppearanceTrace)}`);
  for (const entry of restartAppearanceTrace) {
    assert.deepEqual({
      glassTheme: entry?.glassTheme,
      mode: entry?.mode,
      glassMaterial: entry?.glassMaterial,
      accent: entry?.accent,
      opacity: entry?.opacity,
      blur: entry?.blur,
      saturation: entry?.saturation,
      highlight: entry?.highlight,
      shadow: entry?.shadow,
      radius: entry?.radius,
      noise: entry?.noise,
      reduceMotion: entry?.reduceMotion
    }, {
      glassTheme: CUSTOM_APPEARANCE.theme,
      mode: "light",
      glassMaterial: CUSTOM_APPEARANCE.material,
      accent: CUSTOM_APPEARANCE.accent,
      opacity: CUSTOM_APPEARANCE.opacity,
      blur: CUSTOM_APPEARANCE.blur,
      saturation: CUSTOM_APPEARANCE.saturation,
      highlight: CUSTOM_APPEARANCE.highlight,
      shadow: CUSTOM_APPEARANCE.shadow,
      radius: CUSTOM_APPEARANCE.radius,
      noise: CUSTOM_APPEARANCE.noise,
      reduceMotion: CUSTOM_APPEARANCE.reduceMotion
    }, `Cold restart must never pass through a fallback appearance: ${JSON.stringify(restartAppearanceTrace)}`);
  }
  assert.deepEqual(restarted.root, {
    theme: "light-sky",
    mode: "light",
    material: "custom",
    accent: "coral",
    noise: "off",
    reduceMotion: "true",
    opacity: "0.61",
    blur: "0px",
    saturation: "173%",
    highlight: "0.57",
    shadow: "0.39",
    radius: "24px",
    nativeBackgroundToken: "#e8f2f6"
  });
  assert.equal(restarted.persisted?.glassTheme, CUSTOM_APPEARANCE.theme);
  assert.equal(restarted.persisted?.glassMaterial, CUSTOM_APPEARANCE.material);
  assert.deepEqual(restarted.persisted?.glassParameters, restarted.snapshot?.glassParameters);
  assert.equal(restarted.snapshot?.schemaVersion, 1);
  assert.equal(restarted.snapshot?.type, "naimage-glass-theme-bootstrap");
  checks.coldRestartPersistence = { ok: true, firstClose, ...restarted };

  await clickSelector(".workspace-glass-lab-button");
  await waitFor("Boolean(document.querySelector('.settings-drawer .glass-lab'))", 15_000, 80);
  const restartedControls = await evaluate(client, `(() => ({
    opacity: document.querySelector('#glass-opacity')?.value || '',
    blur: document.querySelector('#glass-blur')?.value || '',
    saturation: document.querySelector('#glass-saturation')?.value || '',
    highlight: document.querySelector('#glass-highlight')?.value || '',
    shadow: document.querySelector('#glass-shadow')?.value || '',
    radius: document.querySelector('#glass-radius')?.value || '',
    noise: document.querySelector('[data-glass-toggle="noise"] input')?.checked,
    reduceMotion: document.querySelector('[data-glass-toggle="reduce-motion"] input')?.checked
  }))()`);
  assert.deepEqual(restartedControls, {
    opacity: "61",
    blur: "0",
    saturation: "173",
    highlight: "57",
    shadow: "39",
    radius: "24",
    noise: false,
    reduceMotion: true
  });
  checks.restartedControlValues = { ok: true, ...restartedControls };
  await capture("10-custom-after-restart");
  await clickSelector(".settings-drawer .ui-surface-close");
  await waitFor("!document.querySelector('.settings-drawer')");

  const artworkStyles = await evaluate(client, `(() => Array.from(document.querySelectorAll('.flow-node img, .workspace-asset-rail-item img, .workspace-focus-stage img, .workspace-review-grid img')).map((image) => {
    const style = getComputedStyle(image);
    return { opacity: style.opacity, filter: style.filter, backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none' };
  }))()`);
  assert(artworkStyles.length > 0);
  assert(artworkStyles.every((item) => Number.parseFloat(item.opacity) === 1 && item.filter === "none" && item.backdropFilter === "none"));
  checks.artworkIsolation = { ok: true, imageCount: artworkStyles.length, styles: artworkStyles };

  const interactionFixture = await evaluate(client, `(async () => {
    await window.__naimageAIDebug.seedSelectionCanvas();
    await window.__naimageAIDebug.selectNodes({ ids: ['A', 'B', 'C'], primaryId: 'A' });
    const merged = await window.__naimageAIDebug.mergeSelectedImages();
    const group = merged?.state?.layoutGroups?.find((candidate) => candidate.memberNodeIds?.length === 3);
    return { ok: Boolean(merged?.ok && group?.hostNodeId), containerId: group?.hostNodeId || '', state: merged?.state || null };
  })()`, 30_000);
  assert.equal(interactionFixture.ok, true, `Final-viewer and drag fixture could not be created: ${JSON.stringify(interactionFixture)}`);

  const viewerOpened = await evaluate(client, `window.__naimageAIDebug.openImageViewer({ id: ${JSON.stringify(interactionFixture.containerId)}, index: 1 })`, 15_000);
  assert.equal(viewerOpened?.ok, true, `Final image viewer could not be opened: ${JSON.stringify(viewerOpened)}`);
  await waitFor("Boolean(document.querySelector('.image-viewer-stage') && document.querySelectorAll('.image-viewer-strip button[data-final-asset=\"true\"]').length === 3)", 15_000, 80);
  const finalViewerProof = await evaluate(client, `(() => {
    const viewer = document.querySelector('.image-viewer');
    const stage = viewer?.querySelector('.image-viewer-stage');
    const strip = viewer?.querySelector('.image-viewer-strip');
    const buttons = Array.from(strip?.querySelectorAll('button[data-final-asset="true"]') || []);
    const stripStyle = strip ? getComputedStyle(strip) : null;
    const stageRect = stage?.getBoundingClientRect();
    const stripRect = strip?.getBoundingClientRect();
    const rowTops = [...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)))];
    return {
      viewerVisible: Boolean(viewer && stageRect && stripRect && stageRect.width > 0 && stageRect.height > 0),
      finalAssetCount: Number(strip?.getAttribute('data-final-asset-count') || 0),
      finalButtonCount: buttons.length,
      previewCount: viewer?.querySelectorAll('[data-stream-preview-count], [data-preview-index], [data-preview-total]').length || 0,
      display: stripStyle?.display || '',
      flexWrap: stripStyle?.flexWrap || '',
      overflowX: stripStyle?.overflowX || '',
      overflowY: stripStyle?.overflowY || '',
      rowCount: rowTops.length,
      stageAboveStrip: Boolean(stageRect && stripRect && stageRect.bottom <= stripRect.top + 1),
      stageHeight: Math.round(stageRect?.height || 0),
      stripHeight: Math.round(stripRect?.height || 0)
    };
  })()`);
  assert.equal(finalViewerProof.viewerVisible, true);
  assert.equal(finalViewerProof.finalAssetCount, 3);
  assert.equal(finalViewerProof.finalButtonCount, 3);
  assert.equal(finalViewerProof.previewCount, 0);
  assert.equal(finalViewerProof.display, "flex");
  assert.equal(finalViewerProof.flexWrap, "nowrap");
  assert(["auto", "scroll"].includes(finalViewerProof.overflowX), `Viewer strip must scroll horizontally: ${JSON.stringify(finalViewerProof)}`);
  assert.equal(finalViewerProof.overflowY, "hidden");
  assert.equal(finalViewerProof.rowCount, 1);
  assert.equal(finalViewerProof.stageAboveStrip, true);
  assert(finalViewerProof.stageHeight > finalViewerProof.stripHeight * 2, `The primary image must remain dominant: ${JSON.stringify(finalViewerProof)}`);
  checks.finalImageViewer = { ok: true, ...finalViewerProof };
  await capture("11-final-image-viewer-single-row");
  await clickSelector('.image-viewer [aria-label="关闭图片查看器"]');
  await waitFor("!document.querySelector('.image-viewer')");

  const dragSelection = await evaluate(client, `(async () => {
    const nodeId = ${JSON.stringify(interactionFixture.containerId)};
    await window.__naimageAIDebug.selectNodes({ ids: [], primaryId: '' });
    document.documentElement.dataset.glassReduceMotion = 'false';
    document.documentElement.classList.remove('glass-reduce-motion');
    return { nodeId, selectedNodeId: window.__naimageAIDebug.state().selectedNodeId };
  })()`);
  assert.equal(dragSelection?.selectedNodeId, "", `Canvas drag fixture must begin unselected: ${JSON.stringify(dragSelection)}`);
  const dragFit = await evaluate(client, "window.__naimageAIDebug.fitCanvas()", 15_000);
  assert.equal(dragFit?.ok, true, `Canvas drag fixture could not fit the live canvas: ${JSON.stringify(dragFit)}`);
  const dragStart = await evaluate(client, `(() => {
    const nodeId = ${JSON.stringify(interactionFixture.containerId)};
    const element = document.querySelector('.flow-node[data-node-id="' + nodeId + '"]');
    const handle = element?.querySelector('.node-head');
    if (!(element instanceof HTMLElement) || !(handle instanceof HTMLElement)) return { ok: false, error: 'container drag DOM unavailable' };
    const beforeNode = window.__naimageAIDebug.state().nodes.find((node) => node.id === nodeId);
    const rect = handle.getBoundingClientRect();
    const startX = rect.left + Math.min(rect.width - 12, Math.max(12, rect.width * 0.46));
    const startY = rect.top + Math.min(rect.height - 8, Math.max(8, rect.height * 0.5));
    const endX = startX + 92;
    const endY = startY + 54;
    const pointerId = 964;
    const baseLeft = element.style.left;
    const baseTop = element.style.top;
    const beforeRect = element.getBoundingClientRect();
    const beforeTransform = getComputedStyle(element).transform;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: startX, clientY: startY }));
    const pointerDownRect = element.getBoundingClientRect();
    const pointerDownTransform = getComputedStyle(element).transform;
    element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: endX, clientY: endY }));
    return {
      ok: true,
      nodeId,
      before: beforeNode ? { x: beforeNode.x, y: beforeNode.y } : null,
      baseLeft,
      baseTop,
      endX,
      endY,
      pointerId,
      pointerDown: {
        beforeTransform,
        afterTransform: pointerDownTransform,
        shiftPx: Math.hypot(pointerDownRect.left - beforeRect.left, pointerDownRect.top - beforeRect.top)
      }
    };
  })()`);
  assert.equal(dragStart?.ok, true, `Canvas image-container drag could not start: ${JSON.stringify(dragStart)}`);
  assert(dragStart.pointerDown.shiftPx <= 0.5, `Canvas node jumped on pointerdown: ${JSON.stringify(dragStart.pointerDown)}`);
  await delay(140);
  const dragActive = await evaluate(client, `(() => {
    const element = document.querySelector('.flow-node[data-node-id=${JSON.stringify(dragStart.nodeId)}]');
    if (!(element instanceof HTMLElement)) return { ok: false, error: 'container drag DOM disappeared' };
    const activeStyle = getComputedStyle(element);
    const translateX = Number.parseFloat(element.style.getPropertyValue('--node-drag-x')) || 0;
    const translateY = Number.parseFloat(element.style.getPropertyValue('--node-drag-y')) || 0;
    const transformRules = [];
    const visitRules = (rules, sheetIndex) => {
      for (const rule of Array.from(rules || [])) {
        if (rule instanceof CSSStyleRule && rule.style.transform) {
          try {
            if (element.matches(rule.selectorText)) transformRules.push({ selector: rule.selectorText, transform: rule.style.transform, priority: rule.style.getPropertyPriority('transform'), sheetIndex });
          } catch {}
        } else if ('cssRules' in rule) {
          try { visitRules(rule.cssRules, sheetIndex); } catch {}
        }
      }
    };
    Array.from(document.styleSheets).forEach((sheet, sheetIndex) => {
      try { visitRules(sheet.cssRules, sheetIndex); } catch {}
    });
    const active = {
      className: element.className,
      translateX,
      translateY,
      computedTranslateX: activeStyle.getPropertyValue('--node-drag-x').trim(),
      computedTranslateY: activeStyle.getPropertyValue('--node-drag-y').trim(),
      transform: activeStyle.transform,
      inlineTransform: element.style.transform,
      transformRules,
      transitionProperty: activeStyle.transitionProperty,
      transitionDuration: activeStyle.transitionDuration,
      transitionDelay: activeStyle.transitionDelay,
      animationName: activeStyle.animationName,
      animationDuration: activeStyle.animationDuration,
      animations: element.getAnimations().map((animation) => ({
        type: animation.constructor?.name || '',
        playState: animation.playState,
        currentTime: animation.currentTime,
        id: animation.id || '',
        keyframes: animation.effect?.getKeyframes?.().map((frame) => ({ offset: frame.offset, transform: frame.transform })) || []
      })),
      supportsResolvedTransform: CSS.supports('transform', 'translate3d(' + (activeStyle.getPropertyValue('--node-drag-x').trim() || '0px') + ', ' + (activeStyle.getPropertyValue('--node-drag-y').trim() || '0px') + ', 0)'),
      rootReduceMotion: document.documentElement.dataset.glassReduceMotion || '',
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      willChange: activeStyle.willChange,
      selected: element.classList.contains('selected'),
      opacity: activeStyle.opacity,
      filter: activeStyle.filter,
      boxShadow: activeStyle.boxShadow,
      leftStable: element.style.left === ${JSON.stringify(dragStart.baseLeft)},
      topStable: element.style.top === ${JSON.stringify(dragStart.baseTop)}
    };
    const activeRect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: ${JSON.stringify(dragStart.pointerId)}, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: ${JSON.stringify(dragStart.endX)}, clientY: ${JSON.stringify(dragStart.endY)} }));
    const releasedRect = element.getBoundingClientRect();
    const releasedStyle = getComputedStyle(element);
    return {
      ok: true,
      active,
      release: {
        shiftPx: Math.hypot(releasedRect.left - activeRect.left, releasedRect.top - activeRect.top),
        activeRect: { left: activeRect.left, top: activeRect.top },
        releasedRect: { left: releasedRect.left, top: releasedRect.top },
        selected: element.classList.contains('selected'),
        animationName: releasedStyle.animationName,
        opacity: releasedStyle.opacity,
        filter: releasedStyle.filter,
        boxShadow: releasedStyle.boxShadow
      }
    };
  })()`);
  assert.equal(dragActive?.ok, true, `Canvas image-container drag active state could not be sampled: ${JSON.stringify(dragActive)}`);
  await delay(320);
  const dragSettled = await evaluate(client, `(() => {
    const nodeId = ${JSON.stringify(dragStart.nodeId)};
    const element = document.querySelector('.flow-node[data-node-id="' + nodeId + '"]');
    if (!(element instanceof HTMLElement)) return { ok: false, error: 'container drag DOM disappeared after pointerup' };
    const afterNode = window.__naimageAIDebug.state().nodes.find((node) => node.id === nodeId);
    const cleared = {
      dragging: element.classList.contains('dragging'),
      translateX: element.style.getPropertyValue('--node-drag-x'),
      translateY: element.style.getPropertyValue('--node-drag-y'),
      willChange: element.style.willChange,
      selected: element.classList.contains('selected'),
      animationName: getComputedStyle(element).animationName,
      opacity: getComputedStyle(element).opacity,
      filter: getComputedStyle(element).filter,
      runningAnimationCount: element.getAnimations().filter((animation) => animation.playState === 'running').length
    };
    return { ok: true, after: afterNode ? { x: afterNode.x, y: afterNode.y } : null, cleared };
  })()`);
  assert.equal(dragSettled?.ok, true, `Canvas image-container drag final state could not be sampled: ${JSON.stringify(dragSettled)}`);
  const active = dragActive.active;
  const cleared = dragSettled.cleared;
  const pointerDownStable = dragStart.pointerDown.shiftPx <= 0.5;
  const releaseStable = dragActive.release.shiftPx <= 1;
  const compositorActive = Math.abs(active.translateX) + Math.abs(active.translateY) > 1 && active.transform !== "none" && active.willChange.includes("transform") && active.leftStable && active.topStable;
  const committed = Boolean(dragStart.before && dragSettled.after && Math.abs(dragSettled.after.x - dragStart.before.x) > 40 && Math.abs(dragSettled.after.y - dragStart.before.y) > 20);
  const compositorCleared = !cleared.dragging && !cleared.translateX && !cleared.translateY && !cleared.willChange.includes("transform");
  const selectedBeforeRelease = active.selected && dragActive.release.selected && cleared.selected;
  const releaseSurfaceStable = active.animationName === "none" && dragActive.release.animationName === "none" && cleared.animationName === "none" && active.opacity === "1" && dragActive.release.opacity === "1" && cleared.opacity === "1" && active.filter === "none" && dragActive.release.filter === "none" && cleared.filter === "none" && active.boxShadow === dragActive.release.boxShadow && cleared.runningAnimationCount === 0;
  const canvasDragProof = { ok: pointerDownStable && releaseStable && compositorActive && committed && compositorCleared && selectedBeforeRelease && releaseSurfaceStable, nodeId: dragStart.nodeId, before: dragStart.before, after: dragSettled.after, pointerDown: dragStart.pointerDown, release: dragActive.release, active, cleared, pointerDownStable, releaseStable, compositorActive, committed, compositorCleared, selectedBeforeRelease, releaseSurfaceStable };
  assert.equal(canvasDragProof.ok, true, `Canvas image-container drag did not use a clean compositor preview: ${JSON.stringify(canvasDragProof)}`);
  checks.canvasCompositorDrag = { ok: true, ...canvasDragProof };

  const connectionFixture = await evaluate(client, "window.__naimageAIDebug.seedConnectionGeometryCanvas()", 30_000);
  assert.equal(connectionFixture?.ok, true, `Auto-sized connection fixture could not be created: ${JSON.stringify(connectionFixture)}`);
  await waitFor(`Boolean(document.querySelector('.edge.provenance[data-source-id=${JSON.stringify(connectionFixture.sourceId)}][data-target-id=${JSON.stringify(connectionFixture.targetId)}]'))`, 15_000, 80);
  const connectionBorderProof = await evaluate(client, `(() => {
    const sourceId = ${JSON.stringify(connectionFixture.sourceId)};
    const targetId = ${JSON.stringify(connectionFixture.targetId)};
    const source = document.querySelector('.flow-node[data-node-id="' + sourceId + '"]');
    const target = document.querySelector('.flow-node[data-node-id="' + targetId + '"]');
    const path = document.querySelector('.edge.provenance[data-source-id="' + sourceId + '"][data-target-id="' + targetId + '"]');
    const sourcePort = source?.querySelector('.node-port-out');
    const targetPort = target?.querySelector('.node-port-in');
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement) || !(path instanceof SVGPathElement) || !(sourcePort instanceof HTMLElement) || !(targetPort instanceof HTMLElement)) {
      return { ok: false, error: 'connection geometry DOM unavailable' };
    }
    const matrix = path.getScreenCTM();
    if (!matrix) return { ok: false, error: 'connection path screen matrix unavailable' };
    const screenPoint = (point) => new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const start = screenPoint(path.getPointAtLength(0));
    const end = screenPoint(path.getPointAtLength(path.getTotalLength()));
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const sourcePortRect = sourcePort.getBoundingClientRect();
    const targetPortRect = targetPort.getBoundingClientRect();
    const sourcePortCenter = { x: sourcePortRect.left + sourcePortRect.width / 2, y: sourcePortRect.top + sourcePortRect.height / 2 };
    const targetPortCenter = { x: targetPortRect.left + targetPortRect.width / 2, y: targetPortRect.top + targetPortRect.height / 2 };
    const state = window.__naimageAIDebug.state();
    const sourceState = state.nodes.find((node) => node.id === sourceId);
    const targetState = state.nodes.find((node) => node.id === targetId);
    const scale = Math.max(0.0001, Math.hypot(matrix.a, matrix.b));
    const errors = {
      sourceBorder: Math.abs(start.x - sourceRect.right),
      targetBorder: Math.abs(end.x - targetRect.left),
      sourcePort: Math.hypot(start.x - sourcePortCenter.x, start.y - sourcePortCenter.y),
      targetPort: Math.hypot(end.x - targetPortCenter.x, end.y - targetPortCenter.y),
      sourceVerticalCenter: Math.abs(start.y - (sourceRect.top + sourceRect.height / 2)),
      targetVerticalCenter: Math.abs(end.y - (targetRect.top + targetRect.height / 2))
    };
    return {
      ok: true,
      sourceStoredSize: { width: sourceState?.width ?? null, height: sourceState?.height ?? null },
      targetStoredSize: { width: targetState?.width ?? null, height: targetState?.height ?? null },
      sourceWorldWidth: sourceRect.width / scale,
      targetWorldWidth: targetRect.width / scale,
      errors,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      sourceBorder: { x: sourceRect.right, centerY: sourceRect.top + sourceRect.height / 2 },
      targetBorder: { x: targetRect.left, centerY: targetRect.top + targetRect.height / 2 }
    };
  })()`);
  assert.equal(connectionBorderProof?.ok, true, `Auto-sized connection geometry could not be sampled: ${JSON.stringify(connectionBorderProof)}`);
  assert.deepEqual(connectionBorderProof.sourceStoredSize, { width: null, height: null }, `Source fixture must exercise automatic render sizing: ${JSON.stringify(connectionBorderProof)}`);
  assert.deepEqual(connectionBorderProof.targetStoredSize, { width: null, height: null }, `Target fixture must exercise automatic render sizing: ${JSON.stringify(connectionBorderProof)}`);
  assert(connectionBorderProof.sourceWorldWidth > 340 && connectionBorderProof.targetWorldWidth > 340, `Auto-sized containers did not expand beyond their logical fallback width: ${JSON.stringify(connectionBorderProof)}`);
  assert(Math.max(...Object.values(connectionBorderProof.errors)) <= 2, `Connection endpoints must stay on the visible left/right borders and port centers: ${JSON.stringify(connectionBorderProof)}`);
  checks.connectionBorderAnchors = { ok: true, ...connectionBorderProof };
  await capture("12-auto-sized-connection-border-anchors");

  const typographyProof = await evaluate(client, `(() => {
    const size = (selector) => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize) || 0;
    return {
      body: Number.parseFloat(getComputedStyle(document.body).fontSize) || 0,
      agentStatus: size('.project-agent-status span'),
      composer: size('.project-agent-composer textarea'),
      modelTrigger: size('.project-agent-model-trigger strong')
    };
  })()`);
  assert(typographyProof.body >= 14 && typographyProof.agentStatus >= 12 && typographyProof.composer >= 14 && typographyProof.modelTrigger >= 13, `Critical UI typography is too small: ${JSON.stringify(typographyProof)}`);
  checks.criticalTypography = { ok: true, ...typographyProof };
  await capture("11-image-container-after-compositor-drag");

  await delay(400);
  assert.deepEqual(consoleErrors, [], `Renderer console errors were recorded: ${JSON.stringify(consoleErrors, null, 2)}`);
  checks.consoleHealth = { ok: true, consoleErrors: [], ignoredConsoleErrors };

  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "glass-workspace-suite",
      suite: "glass-workspace-gui",
      agentMode: "mock-agent",
      liveImageProvider: false,
      networkUsedForGeneration: false,
      minimumWidth: 884,
      minimumHeight: 640,
      realElectronRestart: true
    },
    reportAfterObservations: { qaInventory, checks, screenshots, consoleErrors, ignoredConsoleErrors },
    consoleAfterSummary: { checks: Object.keys(checks).length, screenshots: Object.keys(screenshots).length, consoleErrors: consoleErrors.length, ignoredConsoleErrors: ignoredConsoleErrors.length }
  });
  assert.equal(report.ok, true, "Glass workspace report contains failed visual scenes");
  assert(Object.values(checks).every((item) => item?.ok === true), "Glass workspace report contains failed functional checks");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runStaticSelfTest();
    return;
  }
  await runGuiSuite();
}

try {
  await main();
} catch (error) {
  if (!process.argv.includes("--self-test")) {
    const failure = {
      ok: false,
      suite: "glass-workspace-gui",
      error: error instanceof Error ? error.stack || error.message : String(error),
      checks,
      screenshots,
      consoleErrors,
      ignoredConsoleErrors,
      qaInventory,
      runDir
    };
    mkdirSync(runDir, { recursive: true });
    if (client) {
      try {
        await capture("failure-state");
      } catch {
        // Preserve the original failure and all evidence captured before it.
      }
    }
    writeFileSync(join(runDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  }
  throw error;
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
