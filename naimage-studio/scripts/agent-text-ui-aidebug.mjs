import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  BasicCdpClient as CdpClient,
  evaluateRuntime as evaluate,
  pollForDebugTarget,
  waitForRuntimeExpression
} from "./aidebug/harness/cdp.mjs";
import {
  allocateDebugPort,
  forceKillProcessTree,
  isHttpServerReady as isServerReady,
  pipeProcessLogs,
  waitForHttpServer
} from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(repoRoot, ".diagnostics", "electron", `agent-text-ui-${timestamp}`);
const configDir = join(runDir, "config");
const devUrl = "http://127.0.0.1:5173";
const portArg = process.argv.find((item) => item.startsWith("--port="));
const requestedDebugPort = Number(portArg?.split("=")[1] || process.env.NAIMAGE_REMOTE_DEBUGGING_PORT || 0);
let debugPort = 0;
const electronCli = [
  join(repoRoot, "node_modules", "electron", "cli.js")
].find((candidate) => existsSync(candidate)) || "";
const viteCli = [
  join(repoRoot, "node_modules", "vite", "bin", "vite.js")
].find((candidate) => existsSync(candidate)) || "";

let viteProcess;
let electronProcess;
const checks = [];
const screenshots = [];

function note(label, detail = "") {
  process.stdout.write(`[agent-text-ui] ${label}${detail ? `: ${detail}` : ""}\n`);
}

function check(label, ok, detail = {}) {
  const row = { label, ok: Boolean(ok), detail };
  checks.push(row);
  note(ok ? "PASS" : "FAIL", label);
  return row.ok;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function waitForServer(url) {
  return waitForHttpServer(url, {
    attempts: 120,
    intervalMs: 250,
    errorMessage: `Vite dev server did not respond: ${url}`
  });
}

function startVite() {
  const command = viteCli ? process.execPath : isWindows ? "cmd.exe" : "pnpm";
  const args = viteCli
    ? [viteCli, "--host", "127.0.0.1", "--port", "5173"]
    : isWindows
      ? ["/d", "/s", "/c", "pnpm run dev:web"]
      : ["run", "dev:web"];
  return spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], shell: false });
}

function startElectron() {
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(runDir, "user-data")}`,
    "electron-main.cjs"
  ];
  const command = electronCli ? process.execPath : isWindows ? join(repoRoot, "node_modules", ".bin", "electron.cmd") : "electron";
  const commandArgs = electronCli ? [electronCli, ...args] : args;
  return spawn(command, commandArgs, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: "1",
      NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
      NAIMAGE_AIDEBUG_REAL_AGENT: "0",
      NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
      NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
      NAIMAGE_CONFIG_DIR: configDir
    }
  });
}

async function waitForDebugTarget() {
  return pollForDebugTarget({
    port: debugPort,
    attempts: 140,
    intervalMs: 250,
    beforeAttempt: () => {
      if (electronProcess && (electronProcess.exitCode !== null || electronProcess.signalCode !== null)) {
        throw new Error(`Electron exited before its remote debugging endpoint became ready (code=${electronProcess.exitCode}, signal=${electronProcess.signalCode || "none"}).`);
      }
    },
    findTarget: (targets) => targets.find((item) => item.type === "page" && (String(item.url).includes("127.0.0.1:5173") || String(item.title).includes("naimage"))),
    notFoundMessage: `No Electron renderer target found on port ${debugPort}.`
  });
}

async function waitForExpression(client, expression, timeoutMs = 15000) {
  return waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs: 120 });
}

async function setWindowSize(client, targetId, width, height) {
  let browserWindowId = null;
  const applyWindowSize = async () => {
    if (browserWindowId !== null) {
      await client.send("Browser.setWindowBounds", {
        windowId: browserWindowId,
        bounds: { width, height, windowState: "normal" }
      });
      return;
    }
    await evaluate(client, `window.resizeTo(${width}, ${height}); undefined`);
  };
  try {
    const { windowId } = await client.send("Browser.getWindowForTarget", { targetId });
    browserWindowId = windowId;
    await applyWindowSize();
  } catch {
    browserWindowId = null;
    await applyWindowSize();
  }
  const startedAt = Date.now();
  let viewport = null;
  let lastRetryAt = startedAt;
  while (Date.now() - startedAt < 5_000) {
    viewport = await evaluate(client, `({ width: window.innerWidth, height: window.innerHeight })`);
    if (Math.abs(Number(viewport?.width || 0) - width) <= 4 && Math.abs(Number(viewport?.height || 0) - height) <= 4) break;
    if (Date.now() - lastRetryAt >= 500) {
      await applyWindowSize();
      lastRetryAt = Date.now();
    }
    await delay(100);
  }
  if (Math.abs(Number(viewport?.width || 0) - width) > 4 || Math.abs(Number(viewport?.height || 0) - height) > 4) {
    throw new Error(`Window viewport did not reach ${width}x${height}; last viewport was ${Number(viewport?.width || 0)}x${Number(viewport?.height || 0)}.`);
  }
  await evaluate(client, `new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    const fallback = setTimeout(finish, 240);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(fallback);
      finish();
    }));
  })`);
  await delay(120);
}

async function captureScreenshot(client, label) {
  const path = join(runDir, `${label}.png`);
  try {
    await capturePngScreenshotToFile(client, path, { captureBeyondViewport: false }, 15000);
  } catch (error) {
    if (!String(error?.message || error).includes("Page.captureScreenshot timed out")) throw error;
    await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await delay(250);
    await capturePngScreenshotToFile(client, path, { captureBeyondViewport: false }, 30000);
  }
  screenshots.push(path);
  return path;
}

async function clickButton(client, text, scope = "document") {
  const result = await evaluate(client, `(() => {
    const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`};
    if (!root) return { ok: false, error: "scope-missing" };
    const expected = ${JSON.stringify(text)};
    const button = Array.from(root.querySelectorAll("button")).find((item) => (item.textContent || "").replace(/\\s+/g, " ").trim() === expected);
    if (!button) return { ok: false, error: "button-missing", buttons: Array.from(root.querySelectorAll("button")).map((item) => (item.textContent || "").replace(/\\s+/g, " ").trim()) };
    button.focus();
    button.click();
    return { ok: true };
  })()`);
  if (!result?.ok) throw new Error(`Unable to click button ${text}: ${JSON.stringify(result)}`);
}

async function clickAria(client, label) {
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
    if (!button) return false;
    button.focus();
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Unable to click aria button: ${label}`);
}

async function setEditorText(client, value) {
  const changed = await evaluate(client, `(() => {
    const textarea = document.querySelector(".agent-text-editor-dialog textarea");
    if (!textarea || textarea.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, ${JSON.stringify(value)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Agent text editor textarea is unavailable.");
  await delay(100);
}

async function openPromptEditor(client) {
  await evaluate(client, `window.__naimageDebugOpenSurface?.("settings")`);
  await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer'))`);
  await clickButton(client, "Agent", ".settings-drawer");
  await waitForExpression(client, `Array.from(document.querySelectorAll('.settings-drawer button')).some((button) => button.textContent?.trim() === '编辑提示词')`);
  await clickButton(client, "编辑提示词", ".settings-drawer");
  await waitForExpression(client, `Boolean(document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 提示词"] textarea:not(:disabled)'))`);
}

async function openFastMemoryEditor(client) {
  await evaluate(client, `window.__naimageDebugOpenSurface?.("main")`);
  await delay(120);
  await clickAria(client, "编辑 Agent 记忆");
  await waitForExpression(client, `Boolean(document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 记忆"] textarea:not(:disabled)'))`);
}

async function closeTextEditor(client) {
  const closed = await evaluate(client, `(() => {
    const dialog = document.querySelector('.agent-text-editor-dialog');
    const button = dialog?.querySelector('button[aria-label="关闭编辑器"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!closed) throw new Error("Unable to close Agent text editor.");
  await waitForExpression(client, `!document.querySelector('.agent-text-editor-dialog')`);
}

async function editorSnapshot(client) {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.agent-text-editor-dialog');
    const textarea = dialog?.querySelector('textarea');
    if (!dialog || !textarea) return null;
    const rect = dialog.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const footer = dialog.querySelector(':scope > footer');
    const footerRect = footer?.getBoundingClientRect();
    const forbiddenPatterns = [
      { name: 'fmem-id', regex: /fmem-[a-z0-9_-]+/i },
      { name: 'entry-id', regex: /entry[_ -]?id\\s*[=:]?/i },
      { name: 'selector', regex: /selector\\s*[=:]/i }
    ];
    const visibleText = (dialog.innerText || '').replace(/\\s+/g, ' ').trim();
    const editorText = textarea.value || '';
    return {
      ariaLabel: dialog.getAttribute('aria-label') || '',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
      dialog: {
        left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom),
        width: Math.round(rect.width), height: Math.round(rect.height), clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth,
        withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
        overflowX: dialog.scrollWidth > dialog.clientWidth + 1
      },
      textarea: {
        left: Math.round(textareaRect.left), right: Math.round(textareaRect.right), width: Math.round(textareaRect.width),
        clientWidth: textarea.clientWidth, scrollWidth: textarea.scrollWidth,
        withinDialog: textareaRect.left >= rect.left - 1 && textareaRect.right <= rect.right + 1,
        overflowX: textarea.scrollWidth > textarea.clientWidth + 1
      },
      footer: footerRect ? {
        left: Math.round(footerRect.left), right: Math.round(footerRect.right), width: Math.round(footerRect.width),
        scrollWidth: footer.scrollWidth, clientWidth: footer.clientWidth,
        withinDialog: footerRect.left >= rect.left - 1 && footerRect.right <= rect.right + 1,
        overflowX: footer.scrollWidth > footer.clientWidth + 1
      } : null,
      editorLength: editorText.length,
      editorText,
      visibleText,
      forbiddenHits: forbiddenPatterns.filter((item) => item.regex.test(visibleText) || item.regex.test(editorText)).map((item) => item.name),
      legacyEntryControls: dialog.querySelectorAll('[data-entry-id], .prompt-entry-list, input[name*="entry" i], input[name*="selector" i]').length,
      textareaCount: dialog.querySelectorAll('textarea').length
    };
  })()`);
}

async function surfaceSnapshot(client, selector) {
  return evaluate(client, `(() => {
    const surface = document.querySelector(${JSON.stringify(selector)});
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const header = surface.querySelector(':scope > .ui-surface-header');
    const title = header?.querySelector('h2');
    const close = header?.querySelector('.ui-surface-close');
    const headerRect = header?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    const footer = surface.querySelector(':scope > .ui-surface-footer');
    const footerRect = footer?.getBoundingClientRect();
    const layer = surface.parentElement;
    const layerRect = layer?.getBoundingClientRect();
    const layerStyle = layer ? getComputedStyle(layer) : null;
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    return {
      surface: surface.getAttribute('data-ui-surface') || '',
      role: surface.getAttribute('role') || '',
      ariaModal: surface.getAttribute('aria-modal') || '',
      ariaBusy: surface.getAttribute('aria-busy') || '',
      dirty: surface.getAttribute('data-ui-dirty') || '',
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        visualWidth: window.visualViewport?.width || 0,
        visualHeight: window.visualViewport?.height || 0,
        htmlOverflow: htmlStyle.overflow,
        bodyOverflow: bodyStyle.overflow
      },
      layer: layerRect ? {
        left: Math.round(layerRect.left),
        right: Math.round(layerRect.right),
        width: Math.round(layerRect.width),
        position: layerStyle?.position || '',
        inset: layerStyle?.inset || '',
        computedWidth: layerStyle?.width || '',
        maxWidth: layerStyle?.maxWidth || ''
      } : null,
      rect: {
        left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom),
        width: Math.round(rect.width), height: Math.round(rect.height),
        withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
        overflowX: surface.scrollWidth > surface.clientWidth + 1
      },
      header: headerRect ? {
        left: Math.round(headerRect.left), top: Math.round(headerRect.top), right: Math.round(headerRect.right), bottom: Math.round(headerRect.bottom),
        width: Math.round(headerRect.width), height: Math.round(headerRect.height),
        withinSurface: headerRect.left >= rect.left - 1 && headerRect.top >= rect.top - 1 && headerRect.right <= rect.right + 1 && headerRect.bottom <= rect.bottom + 1
      } : null,
      title: titleRect ? {
        text: (title.textContent || '').trim(),
        left: Math.round(titleRect.left), top: Math.round(titleRect.top), right: Math.round(titleRect.right), bottom: Math.round(titleRect.bottom),
        width: Math.round(titleRect.width), height: Math.round(titleRect.height),
        withinHeader: Boolean(headerRect && titleRect.left >= headerRect.left - 1 && titleRect.top >= headerRect.top - 1 && titleRect.right <= headerRect.right + 1 && titleRect.bottom <= headerRect.bottom + 1)
      } : null,
      close: closeRect ? {
        left: Math.round(closeRect.left), top: Math.round(closeRect.top), right: Math.round(closeRect.right), bottom: Math.round(closeRect.bottom),
        width: Math.round(closeRect.width), height: Math.round(closeRect.height),
        withinHeader: Boolean(headerRect && closeRect.left >= headerRect.left - 1 && closeRect.top >= headerRect.top - 1 && closeRect.right <= headerRect.right + 1 && closeRect.bottom <= headerRect.bottom + 1),
        withinViewport: closeRect.left >= -1 && closeRect.top >= -1 && closeRect.right <= window.innerWidth + 1 && closeRect.bottom <= window.innerHeight + 1
      } : null,
      footer: footerRect ? {
        left: Math.round(footerRect.left), right: Math.round(footerRect.right),
        withinSurface: footerRect.left >= rect.left - 1 && footerRect.right <= rect.right + 1 && footerRect.bottom <= rect.bottom + 1,
        overflowX: footer.scrollWidth > footer.clientWidth + 1
      } : null
    };
  })()`);
}

async function pressKey(client, key, shiftKey = false) {
  return evaluate(client, `(() => {
    const target = document.activeElement || document.body;
    return target.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)},
      shiftKey: ${Boolean(shiftKey)},
      bubbles: true,
      cancelable: true
    }));
  })()`);
}

async function pointerDownBackdrop(client, surface) {
  return evaluate(client, `(() => {
    const backdrop = document.querySelector(${JSON.stringify(`[data-ui-surface-layer="${surface}"] .ui-surface-backdrop`)});
    if (!backdrop) return false;
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
    return true;
  })()`);
}

async function focusTrapProbe(client, selector) {
  return evaluate(client, `(() => {
    const surface = document.querySelector(${JSON.stringify(selector)});
    if (!surface) return { ok: false, reason: 'surface-missing' };
    const nodes = Array.from(surface.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    if (nodes.length < 2) return { ok: false, reason: 'insufficient-focusables', count: nodes.length };
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    return {
      ok: document.activeElement === first,
      count: nodes.length,
      first: first.getAttribute('aria-label') || first.textContent?.trim() || first.tagName,
      last: last.getAttribute('aria-label') || last.textContent?.trim() || last.tagName,
      active: document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.textContent?.trim() || document.activeElement?.tagName || ''
    };
  })()`);
}

async function focusedControl(client) {
  return evaluate(client, `(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return '';
    return active.getAttribute('aria-label') || (active.textContent || '').replace(/\s+/g, ' ').trim() || active.tagName;
  })()`);
}

async function emulateReducedMotion(client, reduced) {
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]
  });
  await delay(120);
  return evaluate(client, `window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
}

async function motionSnapshot(client, selectors) {
  return evaluate(client, `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, present: false };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const animationNames = style.animationName.split(',').map((value) => value.trim());
      const iterationCounts = style.animationIterationCount.split(',').map((value) => value.trim());
      return {
        selector,
        present: true,
        display: style.display,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
        permanentAnimation: animationNames.some((name, index) => name !== 'none' && (iterationCounts[index] || iterationCounts[0]) === 'infinite'),
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        backdropFilter: style.backdropFilter,
        willChange: style.willChange,
        transform: style.transform,
        opacity: Number(style.opacity),
        layout: {
          offsetLeft: element.offsetLeft,
          offsetTop: element.offsetTop,
          offsetWidth: element.offsetWidth,
          offsetHeight: element.offsetHeight,
          rectLeft: Math.round(rect.left * 10) / 10,
          rectTop: Math.round(rect.top * 10) / 10,
          rectWidth: Math.round(rect.width * 10) / 10,
          rectHeight: Math.round(rect.height * 10) / 10
        }
      };
    };
    return {
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      rows: selectors.map(read)
    };
  })()`);
}

async function stableLayoutProbe(client, selector, waitMs = 260) {
  return evaluate(client, `(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { ok: false, reason: 'missing' };
    const read = () => ({
      offsetLeft: element.offsetLeft,
      offsetTop: element.offsetTop,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight
    });
    const before = read();
    await new Promise((resolve) => setTimeout(resolve, ${Number(waitMs)}));
    const after = element.isConnected ? read() : null;
    return { ok: Boolean(after) && JSON.stringify(before) === JSON.stringify(after), before, after };
  })()`);
}

function checkEditorLayout(label, snapshot, expectedWidth) {
  check(`${label}: editor exists`, Boolean(snapshot), snapshot || {});
  if (!snapshot) return;
  check(`${label}: viewport width`, Math.abs(snapshot.viewport.width - expectedWidth) <= 4, { ...snapshot.viewport, requestedWidth: expectedWidth, tolerance: 4 });
  check(`${label}: document has no horizontal overflow`, !snapshot.documentOverflowX, snapshot);
  check(`${label}: body has no horizontal overflow`, !snapshot.bodyOverflowX, snapshot);
  check(`${label}: dialog stays in viewport`, snapshot.dialog.withinViewport, snapshot.dialog);
  check(`${label}: dialog has no horizontal overflow`, !snapshot.dialog.overflowX, snapshot.dialog);
  check(`${label}: textarea stays in dialog`, snapshot.textarea.withinDialog, snapshot.textarea);
  check(`${label}: textarea has no horizontal overflow`, !snapshot.textarea.overflowX, snapshot.textarea);
  check(`${label}: footer stays in dialog`, Boolean(snapshot.footer?.withinDialog), snapshot.footer || {});
  check(`${label}: footer has no horizontal overflow`, !snapshot.footer?.overflowX, snapshot.footer || {});
  check(`${label}: single pure-text editor`, snapshot.textareaCount === 1 && snapshot.legacyEntryControls === 0, snapshot);
  check(`${label}: no internal metadata exposed`, snapshot.forbiddenHits.length === 0, snapshot.forbiddenHits);
}

function publicPayloadHasInternalMetadata(payload) {
  const keys = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (/entry|selector|keywords|compact_of/i.test(key)) keys.push(key);
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(payload);
  const serialized = JSON.stringify(payload);
  return { keys, fmemId: /fmem-[a-z0-9_-]+/i.test(serialized), selector: /selector\s*[=:]/i.test(serialized) };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // Process may already be gone.
  }
  await delay(350);
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows && child.pid) {
    await forceKillProcessTree(child.pid, { isWindows });
  }
}

async function main() {
  mkdirSync(configDir, { recursive: true });
  if (!(await isServerReady(devUrl))) {
    viteProcess = startVite();
    pipeProcessLogs(viteProcess, "vite");
  }
  await waitForServer(devUrl);
  debugPort = await allocateDebugPort(requestedDebugPort);
  electronProcess = startElectron();
  pipeProcessLogs(electronProcess, "electron");
  const target = await waitForDebugTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  let fatalError = "";
  try {
    await waitForExpression(client, `Boolean(document.querySelector('.ide-shell') && window.naimageAgent && window.__naimageDebugAgentState)`);
    await setWindowSize(client, target.id, 1280, 820);

    const toolsBefore = await evaluate(client, `window.naimageAgent.tools()`);
    check("tools schema is available before prompt edit", toolsBefore?.ok === true && Array.isArray(toolsBefore?.tools) && toolsBefore.tools.length > 0, toolsBefore);
    const toolsBeforeHash = hashJson(toolsBefore?.tools || []);

    await setWindowSize(client, target.id, 884, 720);
    await evaluate(client, `window.__naimageDebugOpenSurface?.('main')`);
    await clickAria(client, "设置");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer[data-ui-surface="settings"]'))`);
    await waitForExpression(client, `document.querySelector('.settings-drawer')?.getAttribute('aria-busy') !== 'true'`);
    await delay(240);
    const settingsSurface = await surfaceSnapshot(client, '.settings-drawer');
    check("settings drawer uses shared drawer semantics", settingsSurface?.surface === "settings" && settingsSurface?.role === "dialog" && settingsSurface?.ariaModal === "true", settingsSurface || {});
    check("settings drawer stays contained at 884x720", settingsSurface?.rect?.withinViewport === true && Math.abs(settingsSurface.rect.right - settingsSurface.viewport.width) <= 1 && settingsSurface?.header?.withinSurface === true && settingsSurface?.title?.text === "设置" && settingsSurface?.close?.withinHeader === true && settingsSurface?.close?.withinViewport === true && settingsSurface?.rect?.overflowX === false, settingsSurface || {});
    await clickButton(client, "模型", ".settings-drawer");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer .settings-model-section'))`);
    const settingsLayout = await evaluate(client, `(() => {
      const drawer = document.querySelector('.settings-drawer');
      const body = drawer?.querySelector(':scope > .settings-surface-body');
      const refresh = drawer?.querySelector('button[aria-label="获取模型"]');
      const configButtons = Array.from(drawer?.querySelectorAll('.settings-model-config-action') || []);
      const cards = Array.from(drawer?.querySelectorAll('.settings-model-card') || []);
      if (!drawer || !body || !refresh || configButtons.length !== 2 || cards.length !== 2) return null;
      const drawerRect = drawer.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const actionRects = [refresh, ...configButtons].map(rectOf);
      const cardRects = cards.map(rectOf);
      const contentTop = bodyRect.top - body.scrollTop;
      const contentBottom = contentTop + body.scrollHeight;
      return {
        body: { ...rectOf(body), scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowX: body.scrollWidth > body.clientWidth + 1 },
        refreshClass: refresh.className,
        configClasses: configButtons.map((button) => button.className),
        actionRects,
        cardRects,
        actionsInside: actionRects.every((rect) => rect.left >= drawerRect.left - 1 && rect.right <= drawerRect.right + 1 && rect.top >= contentTop - 1 && rect.bottom <= contentBottom + 1),
        cardsAligned: cardRects[0].left === cardRects[1].left && cardRects[0].right === cardRects[1].right && cardRects.every((rect) => rect.height >= 72)
      };
    })()`);
    await clickButton(client, "Agent", ".settings-drawer");
    await waitForExpression(client, `Array.from(document.querySelectorAll('.settings-drawer button')).some((button) => button.textContent?.trim() === '编辑提示词')`);
    const promptActionLayout = await evaluate(client, `(() => {
      const drawer = document.querySelector('.settings-drawer');
      const prompt = Array.from(drawer?.querySelectorAll('button') || []).find((button) => button.textContent?.trim() === '编辑提示词');
      if (!drawer || !prompt) return null;
      const drawerRect = drawer.getBoundingClientRect();
      const rect = prompt.getBoundingClientRect();
      return {
        className: prompt.className,
        inside: rect.left >= drawerRect.left - 1 && rect.right <= drawerRect.right + 1 && rect.top >= drawerRect.top - 1 && rect.bottom <= drawerRect.bottom + 1
      };
    })()`);
    check("settings drawer uses unified actions and aligned model cards", settingsLayout?.refreshClass.includes('ui-action-button') && promptActionLayout?.className.includes('ui-action-button') && promptActionLayout?.inside === true && settingsLayout?.configClasses.every((value) => value.includes('ui-icon-action')) && settingsLayout?.actionsInside === true && settingsLayout?.cardsAligned === true && settingsLayout?.body?.overflowX === false, { settingsLayout, promptActionLayout });
    const settingsTabTrap = await focusTrapProbe(client, '.settings-drawer');
    check("settings drawer traps forward Tab at its boundary", settingsTabTrap?.ok === true, settingsTabTrap || {});
    await captureScreenshot(client, "00-settings-drawer-884x720");
    await clickButton(client, "更新", ".settings-drawer");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer .settings-update-section'))`);
    await setWindowSize(client, target.id, 884, 640);
    const compactSettingsSurface = await surfaceSnapshot(client, '.settings-drawer');
    const compactSettingsLayout = await evaluate(client, `(() => {
      const drawer = document.querySelector('.settings-drawer');
      const body = drawer?.querySelector(':scope > .settings-surface-body');
      const footer = drawer?.querySelector(':scope > .settings-surface-footer');
      const updateSection = drawer?.querySelector('.settings-update-section');
      const updateAction = Array.from(updateSection?.querySelectorAll('button') || []).find((button) => /更新|下载|安装/.test(button.textContent || ''));
      const footerActions = Array.from(footer?.querySelectorAll('.ui-action-button') || []);
      if (!drawer || !body || !footer || !updateSection || !updateAction || footerActions.length < 3) return null;
      body.scrollTop = body.scrollHeight;
      const drawerRect = drawer.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const updateRect = updateAction.getBoundingClientRect();
      const actionRects = footerActions.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      const overlaps = actionRects.some((left, index) => actionRects.slice(index + 1).some((right) =>
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
      ));
      return {
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        drawerWithinViewport: drawerRect.left >= -1 && drawerRect.top >= -1 && drawerRect.right <= innerWidth + 1 && drawerRect.bottom <= innerHeight + 1,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        bodyContentFits: body.scrollHeight <= body.clientHeight + 1,
        bodyOverflowX: body.scrollWidth > body.clientWidth + 1,
        footerVisible: footerRect.top >= drawerRect.top && footerRect.bottom <= drawerRect.bottom + 1,
        footerOverflowX: footer.scrollWidth > footer.clientWidth + 1,
        footerActionsOverlap: overlaps,
        footerActionHeights: actionRects.map((rect) => Math.round(rect.height)),
        updateActionVisibleAfterScroll: updateRect.top >= bodyRect.top - 1 && updateRect.bottom <= bodyRect.bottom + 1
      };
    })()`);
    check(
      "settings drawer remains operable at minimum 884x640 height",
      compactSettingsSurface?.rect?.withinViewport === true &&
        compactSettingsSurface?.footer?.withinSurface === true &&
        compactSettingsLayout?.drawerWithinViewport === true &&
        (compactSettingsLayout?.bodyScrollable === true || compactSettingsLayout?.bodyContentFits === true) &&
        compactSettingsLayout?.bodyOverflowX === false &&
        compactSettingsLayout?.footerVisible === true &&
        compactSettingsLayout?.footerOverflowX === false &&
        compactSettingsLayout?.footerActionsOverlap === false &&
        compactSettingsLayout?.footerActionHeights?.every((height) => height >= 34) &&
        compactSettingsLayout?.updateActionVisibleAfterScroll === true,
      { surface: compactSettingsSurface, layout: compactSettingsLayout }
    );
    await captureScreenshot(client, "00-settings-drawer-884x640");
    await setWindowSize(client, target.id, 884, 720);
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.settings-drawer')`);
    await delay(120);
    check("settings drawer Escape restores invoking control focus", (await focusedControl(client)) === "设置", { focused: await focusedControl(client) });

    await clickAria(client, "账户");
    await waitForExpression(client, `Boolean(document.querySelector('.account-drawer[data-ui-surface="account"]'))`);
    await delay(240);
    const accountSurface884 = await surfaceSnapshot(client, '.account-drawer');
    check("account drawer uses shared drawer semantics", accountSurface884?.surface === "account" && accountSurface884?.role === "dialog" && accountSurface884?.ariaModal === "true", accountSurface884 || {});
    check("account drawer stays contained at 884x720", accountSurface884?.rect?.withinViewport === true && Math.abs(accountSurface884.rect.right - accountSurface884.viewport.width) <= 1 && accountSurface884?.header?.withinSurface === true && accountSurface884?.title?.text === "账户" && accountSurface884?.close?.withinHeader === true && accountSurface884?.close?.withinViewport === true && accountSurface884?.rect?.overflowX === false, accountSurface884 || {});
    const accountLayout884 = await evaluate(client, `(() => {
      const drawer = document.querySelector('.account-drawer');
      const body = drawer?.querySelector(':scope > .account-surface-body');
      const profile = drawer?.querySelector('.account-profile');
      const balance = drawer?.querySelector('.account-balance-grid');
      const balanceCells = Array.from(balance?.querySelectorAll(':scope > div') || []);
      const actions = Array.from(drawer?.querySelectorAll('.account-primary-actions .ui-action-button') || []);
      const refresh = drawer?.querySelector('button[aria-label="刷新账户"]');
      const logs = drawer?.querySelector('.account-usage-section');
      if (!drawer || !body || !profile || !balance || balanceCells.length !== 3 || actions.length !== 2 || !refresh || !logs) return null;
      const drawerRect = drawer.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const actionRects = actions.map(rectOf);
      const cellRects = balanceCells.map(rectOf);
      return {
        body: { ...rectOf(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowX: body.scrollWidth > body.clientWidth + 1 },
        profile: rectOf(profile),
        balance: rectOf(balance),
        cellRects,
        actionRects,
        refreshClass: refresh.className,
        actionsInside: actionRects.every((rect) => rect.left >= drawerRect.left - 1 && rect.right <= drawerRect.right + 1 && rect.top >= bodyRect.top - 1),
        balanceColumnsAligned: cellRects.every((rect) => rect.width >= 90) && Math.max(...cellRects.map((rect) => rect.height)) - Math.min(...cellRects.map((rect) => rect.height)) <= 1
      };
    })()`);
    check("account profile, three-column balance, actions, and logs are laid out", accountLayout884?.body?.overflowX === false && accountLayout884?.balanceColumnsAligned === true && accountLayout884?.actionsInside === true && accountLayout884?.refreshClass.includes('ui-icon-action') && accountLayout884?.actionRects.every((rect) => rect.height >= 30), accountLayout884 || {});
    const accountTabTrap = await focusTrapProbe(client, '.account-drawer');
    check("account drawer traps forward Tab at its boundary", accountTabTrap?.ok === true, accountTabTrap || {});
    await evaluate(client, `window.__naimageDebugSurfaceSaveDelayMs = 1200`);
    await clickAria(client, "刷新账户");
    await waitForExpression(client, `document.querySelector('.account-drawer')?.getAttribute('aria-busy') === 'true'`);
    await pressKey(client, "Escape");
    await delay(100);
    const accountBusyEscape = await evaluate(client, `({ present: Boolean(document.querySelector('.account-drawer')), trace: window.__naimageDebugLastSurfaceClose || null })`);
    check("busy account drawer rejects Escape close", accountBusyEscape?.present === true && accountBusyEscape?.trace?.surface === "account" && accountBusyEscape?.trace?.allowed === false && accountBusyEscape?.trace?.busy === true, accountBusyEscape || {});
    await pointerDownBackdrop(client, "account");
    await delay(100);
    const accountBusyBackdrop = await evaluate(client, `({ present: Boolean(document.querySelector('.account-drawer')), trace: window.__naimageDebugLastSurfaceClose || null })`);
    check("busy account drawer rejects backdrop close", accountBusyBackdrop?.present === true && accountBusyBackdrop?.trace?.surface === "account" && accountBusyBackdrop?.trace?.reason === "backdrop" && accountBusyBackdrop?.trace?.allowed === false, accountBusyBackdrop || {});
    await waitForExpression(client, `document.querySelector('.account-drawer')?.getAttribute('aria-busy') !== 'true'`, 7000);
    await evaluate(client, `window.__naimageDebugSurfaceSaveDelayMs = 0`);
    await captureScreenshot(client, "00a-account-drawer-884x720");
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.account-drawer')`);
    await delay(120);
    check("account drawer Escape restores invoking control focus", (await focusedControl(client)) === "账户", { focused: await focusedControl(client) });

    await setWindowSize(client, target.id, 1280, 820);
    await clickAria(client, "账户");
    await waitForExpression(client, `Boolean(document.querySelector('.account-drawer[data-ui-surface="account"]'))`);
    await delay(240);
    const accountSurface1280 = await surfaceSnapshot(client, '.account-drawer');
    check("account drawer stays contained at 1280x820", accountSurface1280?.rect?.withinViewport === true && Math.abs(accountSurface1280.rect.right - accountSurface1280.viewport.width) <= 1 && accountSurface1280?.header?.withinSurface === true && accountSurface1280?.close?.withinViewport === true && accountSurface1280?.rect?.overflowX === false, accountSurface1280 || {});
    await captureScreenshot(client, "00b-account-drawer-1280x820");
    await pointerDownBackdrop(client, "account");
    await waitForExpression(client, `!document.querySelector('.account-drawer')`);
    await delay(120);
    check("account drawer backdrop restores invoking control focus", (await focusedControl(client)) === "账户", { focused: await focusedControl(client) });

    await setWindowSize(client, target.id, 1280, 820);
    await openPromptEditor(client);
    const promptInitial = await editorSnapshot(client);
    const defaultPromptText = promptInitial?.editorText || "";
    check("prompt editor loads non-empty plain text", defaultPromptText.trim().length > 100, { length: defaultPromptText.length });
    checkEditorLayout("prompt 1280", promptInitial, 1280);

    const promptSentinel = `AIDEBUG_PROMPT_UI_${Date.now()}`;
    await setEditorText(client, `${defaultPromptText.trim()}\n\n${promptSentinel}`);
    await clickButton(client, "保存", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('提示词已保存')`);
    const savedPrompt = await evaluate(client, `window.naimageAgent.getMainPrompt()`);
    const promptMetadata = publicPayloadHasInternalMetadata(savedPrompt);
    check("prompt save roundtrip succeeds", savedPrompt?.ok === true && String(savedPrompt?.text || "").includes(promptSentinel), savedPrompt);
    check("prompt public response hides legacy metadata", promptMetadata.keys.length === 0 && !promptMetadata.fmemId && !promptMetadata.selector, promptMetadata);

    const toolsAfter = await evaluate(client, `window.naimageAgent.tools()`);
    const toolsAfterHash = hashJson(toolsAfter?.tools || []);
    check("prompt edit does not mutate tools schema", toolsBeforeHash === toolsAfterHash, { toolsBeforeHash, toolsAfterHash });
    await captureScreenshot(client, "01-prompt-editor-1280");

    const resizeDraftSentinel = `AIDEBUG_PROMPT_RESIZE_DRAFT_${Date.now()}`;
    const resizeDraft = `${String(savedPrompt?.text || defaultPromptText).trim()}\n\n${resizeDraftSentinel}`;
    await setEditorText(client, resizeDraft);
    const resizeIdentity = `prompt-resize-${Date.now()}`;
    await evaluate(client, `(() => {
      const textarea = document.querySelector('.agent-text-editor-dialog textarea');
      if (!textarea) return false;
      textarea.__naimagePromptResizeIdentity = ${JSON.stringify(resizeIdentity)};
      return true;
    })()`);
    await setWindowSize(client, target.id, 884, 720);
    await waitForExpression(client, `Boolean(document.querySelector('.agent-text-editor-dialog textarea'))`);
    await evaluate(client, `document.querySelector('.settings-drawer button[aria-label="关闭设置"]')?.click()`);
    await waitForExpression(client, `!document.querySelector('.settings-drawer') && Boolean(document.querySelector('.agent-text-editor-dialog textarea'))`);
    await clickAria(client, "设置");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer') && document.querySelector('.agent-text-editor-dialog textarea'))`);
    const promptNarrow = await editorSnapshot(client);
    const promptResizeContinuity = await evaluate(client, `(() => {
      const dialogs = Array.from(document.querySelectorAll('.agent-text-editor-dialog[aria-label="编辑 Agent 提示词"]'));
      const textarea = dialogs[0]?.querySelector('textarea');
      return {
        dialogCount: dialogs.length,
        settingsPresent: Boolean(document.querySelector('.settings-drawer')),
        identity: textarea?.__naimagePromptResizeIdentity || '',
        editorText: textarea?.value || ''
      };
    })()`);
    check(
      "prompt editor and unsaved draft survive narrow settings remount",
      promptResizeContinuity?.dialogCount === 1 &&
        promptResizeContinuity?.settingsPresent === true &&
        promptResizeContinuity?.identity === resizeIdentity &&
        promptResizeContinuity?.editorText === resizeDraft &&
        promptResizeContinuity?.editorText.includes(resizeDraftSentinel),
      promptResizeContinuity || {}
    );
    checkEditorLayout("prompt 884", promptNarrow, 884);
    const promptSurface = await surfaceSnapshot(client, '.agent-text-editor-dialog');
    check("prompt surface uses shared dialog semantics", promptSurface?.surface === "agent-prompt-editor" && promptSurface?.role === "dialog" && promptSurface?.ariaModal === "true", promptSurface || {});
    const promptTabTrap = await focusTrapProbe(client, '.agent-text-editor-dialog');
    check("prompt surface traps forward Tab at its boundary", promptTabTrap?.ok === true, promptTabTrap || {});
    await captureScreenshot(client, "02-prompt-editor-884");

    const longPrompt = `${defaultPromptText.trim()}\n\n${"LONG_PROMPT_LAYOUT_PROBE 东方电商视觉规范 ".repeat(1_600)}`;
    await setEditorText(client, longPrompt);
    await setWindowSize(client, target.id, 884, 640);
    const promptCompact = await editorSnapshot(client);
    checkEditorLayout("prompt 884x640 long", promptCompact, 884);
    const compactSurface = await surfaceSnapshot(client, '.agent-text-editor-dialog');
    check("long prompt compact surface stays vertically contained", compactSurface?.rect?.withinViewport === true && compactSurface?.footer?.withinSurface === true, compactSurface || {});
    check("long prompt marks surface dirty", compactSurface?.dirty === "true", compactSurface || {});
    await captureScreenshot(client, "02b-prompt-editor-884x640-long");

    await pressKey(client, "Escape");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('再次关闭')`);
    const dirtyEscapeState = await surfaceSnapshot(client, '.agent-text-editor-dialog');
    check("dirty Escape requires explicit second close", dirtyEscapeState?.dirty === "true", dirtyEscapeState || {});
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.agent-text-editor-dialog')`);
    await waitForExpression(client, `(() => {
      const active = document.activeElement;
      const label = active?.getAttribute?.('aria-label') || active?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      return ['编辑提示词', '接入', '设置'].includes(label);
    })()`, 5_000);
    const dirtyPromptCloseFocus = await focusedControl(client);
    check("dirty second Escape closes and restores nested drawer focus", ["编辑提示词", "接入", "设置"].includes(dirtyPromptCloseFocus), { focused: dirtyPromptCloseFocus });

    await openPromptEditor(client);
    const busySentinel = `AIDEBUG_BUSY_CLOSE_${Date.now()}`;
    await setEditorText(client, `${savedPrompt.text}\n${busySentinel}`);
    await evaluate(client, `window.__naimageDebugSurfaceSaveDelayMs = 2000`);
    await clickButton(client, "保存", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-dialog')?.getAttribute('aria-busy') === 'true'`);
    await pressKey(client, "Escape");
    await delay(100);
    const busyAfterEscape = await surfaceSnapshot(client, '.agent-text-editor-dialog');
    const busyEscapeTrace = await evaluate(client, `window.__naimageDebugLastSurfaceClose || null`);
    check("busy surface rejects Escape close", Boolean(busyAfterEscape) && busyEscapeTrace?.allowed === false && busyEscapeTrace?.busy === true, { surface: busyAfterEscape, trace: busyEscapeTrace });
    if (!busyAfterEscape) throw new Error(`Busy surface closed after Escape: ${JSON.stringify(busyEscapeTrace)}`);
    await pointerDownBackdrop(client, "agent-prompt-editor");
    await delay(100);
    const busyAfterBackdrop = await surfaceSnapshot(client, '.agent-text-editor-dialog');
    const busyBackdropTrace = await evaluate(client, `window.__naimageDebugLastSurfaceClose || null`);
    check("busy surface rejects backdrop close", Boolean(busyAfterBackdrop) && busyBackdropTrace?.allowed === false && busyBackdropTrace?.busy === true, { surface: busyAfterBackdrop, trace: busyBackdropTrace });
    if (!busyAfterBackdrop) throw new Error(`Busy surface closed after backdrop: ${JSON.stringify(busyBackdropTrace)}`);
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('提示词已保存')`, 7000);
    await evaluate(client, `window.__naimageDebugSurfaceSaveDelayMs = 0`);

    await setWindowSize(client, target.id, 1280, 820);
    await clickButton(client, "恢复默认", ".agent-text-editor-dialog");
    await clickButton(client, "确认恢复默认", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('已恢复默认提示词')`);
    const resetPrompt = await evaluate(client, `window.naimageAgent.getMainPrompt()`);
    check("prompt restore default succeeds", resetPrompt?.ok === true && resetPrompt?.isDefault === true && !String(resetPrompt?.text || "").includes(promptSentinel), resetPrompt);
    check("prompt restore matches original default", String(resetPrompt?.text || "") === defaultPromptText, { originalLength: defaultPromptText.length, resetLength: String(resetPrompt?.text || "").length });
    await pointerDownBackdrop(client, "agent-prompt-editor");
    await waitForExpression(client, `!document.querySelector('.agent-text-editor-dialog')`);
    await delay(120);
    check("clean backdrop close restores settings action focus", (await focusedControl(client)) === "编辑提示词", { focused: await focusedControl(client) });

    await setWindowSize(client, target.id, 884, 720);
    await clickButton(client, "模型", ".settings-drawer");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer .settings-model-section'))`);
    await clickAria(client, "配置对话模型");
    await waitForExpression(client, `Boolean(document.querySelector('.model-picker-dialog[data-ui-surface="model-picker-agent"]'))`);
    const modelSurface = await surfaceSnapshot(client, '.model-picker-dialog');
    check("model picker uses shared dialog semantics", modelSurface?.surface === "model-picker-agent" && modelSurface?.role === "dialog" && modelSurface?.ariaModal === "true", modelSurface || {});
    check("model picker stays contained at 884x720", modelSurface?.rect?.withinViewport === true && modelSurface?.header?.withinSurface === true && modelSurface?.title?.withinHeader === true && modelSurface?.title?.text === "配置对话模型" && modelSurface?.close?.withinHeader === true && modelSurface?.close?.withinViewport === true && modelSurface?.footer?.withinSurface === true && modelSurface?.rect?.overflowX === false, modelSurface || {});
    const modelTabTrap = await focusTrapProbe(client, '.model-picker-dialog');
    check("model picker traps forward Tab at its boundary", modelTabTrap?.ok === true, modelTabTrap || {});
    const modelSearchKeyboardProbe = await evaluate(client, `(() => {
      const dialog = document.querySelector('.model-picker-dialog');
      const search = dialog?.querySelector('.model-picker-search input');
      const options = Array.from(dialog?.querySelectorAll('.model-picker-option[role="option"]') || []);
      if (!dialog || !search || options.length < 2) return { ok: false, reason: 'controls-missing', optionCount: options.length };
      search.focus();
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      return { ok: true, optionCount: options.length };
    })()`);
    if (!modelSearchKeyboardProbe?.ok) throw new Error(`Model picker keyboard controls unavailable: ${JSON.stringify(modelSearchKeyboardProbe)}`);
    await delay(120);
    const modelKeyboardProbe = await evaluate(client, `(() => {
      const dialog = document.querySelector('.model-picker-dialog');
      const options = Array.from(dialog?.querySelectorAll('.model-picker-option[role="option"]') || []);
      if (!dialog || options.length < 2) return { ok: false, reason: 'controls-missing', optionCount: options.length };
      const afterSearch = document.activeElement;
      afterSearch?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      const afterEnd = document.activeElement;
      const tabStops = options.filter((option) => option.tabIndex === 0);
      return {
        ok: afterSearch?.getAttribute?.('role') === 'option' && afterEnd === options[options.length - 1] && tabStops.length === 1,
        optionCount: options.length,
        afterSearch: (afterSearch?.textContent || '').replace(/\s+/g, ' ').trim(),
        afterEnd: (afterEnd?.textContent || '').replace(/\s+/g, ' ').trim(),
        expectedEnd: (options[options.length - 1]?.textContent || '').replace(/\s+/g, ' ').trim(),
        tabStopCount: tabStops.length,
        tabStop: (tabStops[0]?.textContent || '').replace(/\s+/g, ' ').trim()
      };
    })()`);
    check("model picker uses one roving Tab stop with Arrow/Home/End navigation", modelKeyboardProbe?.ok === true, modelKeyboardProbe || {});
    await captureScreenshot(client, "02c-model-picker-884x720");
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.model-picker-dialog')`);
    await delay(120);
    check("nested model picker restores its settings trigger focus", (await focusedControl(client)) === "配置对话模型", { focused: await focusedControl(client) });

    await setWindowSize(client, target.id, 1280, 820);
    await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-timeline')`);
    await waitForExpression(client, `window.__naimageDebugAgentState?.().messageCount >= 2`);
    await clickAria(client, "新建会话");
    await waitForExpression(client, `Boolean(document.querySelector('.confirm-dialog[data-ui-surface="confirm"]'))`);
    const confirmSurface = await surfaceSnapshot(client, '.confirm-dialog');
    check("confirm uses shared dialog semantics", confirmSurface?.surface === "confirm" && confirmSurface?.role === "dialog" && confirmSurface?.ariaModal === "true", confirmSurface || {});
    check("confirm surface stays contained at 1280x820", confirmSurface?.rect?.withinViewport === true && confirmSurface?.header?.withinSurface === true && confirmSurface?.title?.withinHeader === true && confirmSurface?.close?.withinHeader === true && confirmSurface?.footer?.withinSurface === true, confirmSurface || {});
    const confirmTabTrap = await focusTrapProbe(client, '.confirm-dialog');
    check("confirm traps forward Tab at its boundary", confirmTabTrap?.ok === true, confirmTabTrap || {});
    await captureScreenshot(client, "02d-confirm-1280x820");
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.confirm-dialog')`);
    await delay(120);
    check("confirm Escape restores the invoking control focus", (await focusedControl(client)) === "新建会话", { focused: await focusedControl(client) });

    await openFastMemoryEditor(client);
    const firstScope = await evaluate(client, `window.__naimageDebugAgentState()`);
    const firstScopeInput = { projectId: firstScope.activeProjectId, conversationId: firstScope.activeConversationId };
    const memoryInitial = await editorSnapshot(client);
    check("current conversation memory starts empty", memoryInitial?.editorText === "", { editorText: memoryInitial?.editorText });
    const memorySentinelA = `AIDEBUG_MEMORY_SCOPE_A_${Date.now()}`;
    await setEditorText(client, `东方审美近景构图经验：主体占画面主要面积。\n${memorySentinelA}`);
    await clickButton(client, "保存", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('Agent 记忆已保存')`);
    const memoryA = await evaluate(client, `window.naimageAgent.getFastMemory(${JSON.stringify(firstScopeInput)})`);
    const memoryAMetadata = publicPayloadHasInternalMetadata(memoryA);
    check("FastMemory save roundtrip succeeds", memoryA?.ok === true && String(memoryA?.text || "").includes(memorySentinelA), memoryA);
    check("FastMemory public response hides internal metadata", memoryAMetadata.keys.length === 0 && !memoryAMetadata.fmemId && !memoryAMetadata.selector, memoryAMetadata);
    const memoryWide = await editorSnapshot(client);
    checkEditorLayout("memory 1280", memoryWide, 1280);
    await captureScreenshot(client, "03-fast-memory-editor-1280");

    await setWindowSize(client, target.id, 884, 720);
    const memoryNarrow = await editorSnapshot(client);
    checkEditorLayout("memory 884", memoryNarrow, 884);
    await captureScreenshot(client, "04-fast-memory-editor-884");
    await closeTextEditor(client);

    await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-timeline')`);
    await waitForExpression(client, `window.__naimageDebugAgentState?.().messageCount >= 2`);
    const conversationABeforeNew = await evaluate(client, `window.__naimageDebugAgentState?.().activeConversationId`);
    check("seeded conversation keeps original scope", conversationABeforeNew === firstScopeInput.conversationId, { conversationABeforeNew, firstScopeInput });
    await clickAria(client, "新建会话");
    await waitForExpression(client, `Boolean(document.querySelector('.confirm-dialog[aria-label="开始新的 Agent 会话？"]'))`);
    await clickButton(client, "新建会话", ".confirm-dialog");
    await waitForExpression(client, `window.__naimageDebugAgentState?.().activeConversationId !== ${JSON.stringify(firstScopeInput.conversationId)}`);
    const secondScope = await evaluate(client, `window.__naimageDebugAgentState()`);
    const secondScopeInput = { projectId: secondScope.activeProjectId, conversationId: secondScope.activeConversationId };
    check("new conversation receives a new identity", secondScopeInput.conversationId !== firstScopeInput.conversationId, { firstScopeInput, secondScopeInput });

    await openFastMemoryEditor(client);
    const newConversationMemory = await editorSnapshot(client);
    check("new conversation does not inherit FastMemory", newConversationMemory?.editorText === "", { editorText: newConversationMemory?.editorText });
    await captureScreenshot(client, "05-fast-memory-new-conversation-empty-884");
    const memorySentinelB = `AIDEBUG_MEMORY_SCOPE_B_${Date.now()}`;
    await setEditorText(client, `新会话独立经验。\n${memorySentinelB}`);
    await clickButton(client, "保存", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('Agent 记忆已保存')`);
    await closeTextEditor(client);

    await clickAria(client, "会话历史");
    await waitForExpression(client, `Boolean(document.querySelector('.project-agent-history'))`);
    const historyAria = await evaluate(client, `(() => {
      const toggle = document.querySelector('[aria-label="会话历史"]');
      const history = document.querySelector('.project-agent-history');
      return {
        expanded: toggle?.getAttribute('aria-expanded'),
        controls: toggle?.getAttribute('aria-controls'),
        historyId: history?.id || ''
      };
    })()`);
    check("conversation history exposes expanded and controlled-region semantics", historyAria?.expanded === 'true' && historyAria?.controls && historyAria.controls === historyAria.historyId, historyAria || {});
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.project-agent-history')`);
    await delay(60);
    const historyEscape = await evaluate(client, `(() => {
      const toggle = document.querySelector('[aria-label="会话历史"]');
      return { expanded: toggle?.getAttribute('aria-expanded'), focusRestored: document.activeElement === toggle };
    })()`);
    check("Escape closes conversation history and restores toggle focus", historyEscape?.expanded === 'false' && historyEscape?.focusRestored === true, historyEscape || {});
    await clickAria(client, "会话历史");
    await waitForExpression(client, `Boolean(document.querySelector('.project-agent-history'))`);
    await evaluate(client, `(() => {
      const textarea = document.querySelector('.project-agent-composer textarea');
      textarea?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
      textarea?.focus();
    })()`);
    await waitForExpression(client, `!document.querySelector('.project-agent-history')`);
    await delay(60);
    const historyOutside = await evaluate(client, `(() => ({
      expanded: document.querySelector('[aria-label="会话历史"]')?.getAttribute('aria-expanded'),
      outsideFocusPreserved: document.activeElement === document.querySelector('.project-agent-composer textarea')
    }))()`);
    check("outside pointer closes conversation history without stealing destination focus", historyOutside?.expanded === 'false' && historyOutside?.outsideFocusPreserved === true, historyOutside || {});
    await clickAria(client, "会话历史");
    await waitForExpression(client, `Boolean(document.querySelector('.project-agent-history'))`);
    const switched = await evaluate(client, `(() => {
      const button = document.querySelector('.project-agent-history button:not(.active)');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!switched) throw new Error("Historical conversation button is missing.");
    await waitForExpression(client, `window.__naimageDebugAgentState?.().activeConversationId === ${JSON.stringify(firstScopeInput.conversationId)}`);
    await openFastMemoryEditor(client);
    const restoredMemoryA = await editorSnapshot(client);
    check("switching back restores only conversation A memory", restoredMemoryA?.editorText.includes(memorySentinelA) && !restoredMemoryA?.editorText.includes(memorySentinelB), { editorText: restoredMemoryA?.editorText });
    await clickButton(client, "清空记忆", ".agent-text-editor-dialog");
    await clickButton(client, "确认清空记忆", ".agent-text-editor-dialog");
    await waitForExpression(client, `document.querySelector('.agent-text-editor-body [data-ui-status="true"]')?.textContent?.includes('已清空当前会话')`);
    const clearedMemoryA = await evaluate(client, `window.naimageAgent.getFastMemory(${JSON.stringify(firstScopeInput)})`);
    const preservedMemoryB = await evaluate(client, `window.naimageAgent.getFastMemory(${JSON.stringify(secondScopeInput)})`);
    check("UI clear empties only current conversation memory", clearedMemoryA?.ok === true && clearedMemoryA?.isEmpty === true && String(clearedMemoryA?.text || "") === "", clearedMemoryA);
    check("clearing conversation A preserves conversation B memory", preservedMemoryB?.ok === true && String(preservedMemoryB?.text || "").includes(memorySentinelB), preservedMemoryB);
    await captureScreenshot(client, "06-fast-memory-cleared-scope-a-884");
    await closeTextEditor(client);

    await setWindowSize(client, target.id, 1280, 820);
    check("CDP emulates reduced motion", await emulateReducedMotion(client, true), {});

    await openPromptEditor(client);
    const reducedPromptMotion = await motionSnapshot(client, [
      '.agent-text-editor-dialog',
      '[data-ui-surface-layer="agent-prompt-editor"] .ui-surface-backdrop',
      '.agent-text-editor-dialog .ui-action-button'
    ]);
    check("reduced prompt surface has no permanent animation", reducedPromptMotion.reduced === true && reducedPromptMotion.rows.every((row) => row.present && !row.permanentAnimation), reducedPromptMotion);
    check("reduced prompt surface disables entry motion and backdrop blur", reducedPromptMotion.rows[0]?.animationName === "none" && reducedPromptMotion.rows[1]?.animationName === "none" && reducedPromptMotion.rows[1]?.backdropFilter === "none", reducedPromptMotion);
    const reducedPromptLayout = await stableLayoutProbe(client, '.agent-text-editor-dialog', 240);
    check("reduced prompt final layout is stable", reducedPromptLayout?.ok === true, reducedPromptLayout || {});
    await captureScreenshot(client, "07-reduced-prompt-surface-1280");
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.agent-text-editor-dialog')`);

    await evaluate(client, `window.__naimageDebugOpenSurface?.('settings')`);
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer'))`);
    await clickButton(client, "模型", ".settings-drawer");
    await waitForExpression(client, `Boolean(document.querySelector('.settings-drawer .settings-model-section'))`);
    await clickAria(client, "配置对话模型");
    await waitForExpression(client, `Boolean(document.querySelector('.model-picker-dialog'))`);
    const reducedModelMotion = await motionSnapshot(client, ['.model-picker-dialog', '.model-picker-dialog .model-picker-list', '.model-picker-dialog .ui-action-button']);
    check("reduced model picker has no permanent animation", reducedModelMotion.rows.every((row) => row.present && !row.permanentAnimation), reducedModelMotion);
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.model-picker-dialog')`);

    await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-timeline')`);
    await waitForExpression(client, `window.__naimageDebugAgentState?.().messageCount >= 2`);
    await clickAria(client, "新建会话");
    await waitForExpression(client, `Boolean(document.querySelector('.confirm-dialog'))`);
    const reducedConfirmMotion = await motionSnapshot(client, ['.confirm-dialog', '.confirm-dialog .ui-surface-backdrop', '.confirm-dialog .ui-action-button']);
    check("reduced confirm has no permanent animation", reducedConfirmMotion.rows.filter((row) => row.present).every((row) => !row.permanentAnimation) && reducedConfirmMotion.rows[0]?.animationName === "none", reducedConfirmMotion);
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.confirm-dialog')`);

    await evaluate(client, `new Promise((resolve) => {
      window.__naimageDebugOpenSurface?.('main');
      window.__naimageDebugApplyAgentActions?.([
        { type: 'workflow.canvas.clear', mode: 'all' },
        { type: 'workflow.node.create', toolRunId: 'motion-node-a', node: { id: 'motion-node-a', title: 'Reduced Motion 节点 A', prompt: 'motion fixture', nodeType: 'image', status: 'review', imageState: 'empty', x: 120, y: 120, width: 260, height: 220 } },
        { type: 'workflow.node.create', toolRunId: 'motion-node-b', node: { id: 'motion-node-b', title: 'Reduced Motion 节点 B', prompt: 'motion fixture', nodeType: 'image', status: 'review', imageState: 'empty', x: 460, y: 220, width: 260, height: 220 } }
      ]);
      setTimeout(() => {
        window.__naimageDebugConnectNodes?.({ sourceId: 'motion-node-a', targetId: 'motion-node-b' });
        setTimeout(resolve, 180);
      }, 180);
    })`);
    await waitForExpression(client, `document.querySelectorAll('.flow-node').length >= 2`);
    await evaluate(client, `(() => {
      document.querySelector('.edge')?.classList.add('active');
      const fixture = document.createElement('div');
      fixture.id = 'motion-css-fixture';
      fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:220px;';
      fixture.innerHTML = '<style>@keyframes motion-fixture-pulse{from{opacity:.8;transform:translateY(0)}to{opacity:1;transform:translateY(-2px)}}.motion-dialog-fixture,.motion-card-fixture{animation:motion-fixture-pulse 1s ease-in-out infinite alternate}@media (prefers-reduced-motion:reduce){#motion-css-fixture .motion-dialog-fixture,#motion-css-fixture .motion-card-fixture{animation:none!important;transition:none!important;transform:none!important}}</style><div class="motion-dialog-fixture"><button class="motion-card-fixture">Motion fixture</button></div><svg width="20" height="20"><path class="edge active"></path><path class="spin motion-spin-fixture"></path></svg>';
      document.body.appendChild(fixture);
      return true;
    })()`);
    await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-image-running')`);
    await waitForExpression(client, `Boolean(document.querySelector('.agent-message.running') && document.querySelector('.agent-tool-trace'))`);
    await evaluate(client, `window.__naimageDebugApplyAgentActions?.([
      {
        type: 'workflow.node.create',
        toolRunId: 'status-unique-image-run',
        node: {
          id: 'status-unique-image-run',
          title: '批量图片成果',
          prompt: 'AIDebug 状态唯一性图片占位。',
          nodeType: 'image',
          status: 'working',
          imageState: 'generating',
          x: 160,
          y: 420,
          width: 540,
          height: 360,
          imageParams: { operation: 'generate', prompt: 'AIDebug 状态唯一性图片占位。', ratio: '4:5', resolution: '720P', count: 3, quality: 'auto', background: 'opaque' },
          imageProgress: { total: 3, completed: 0, failed: 0, message: '并行生成中，已完成 0/3 张' },
          imageCollection: {
            id: 'status-unique-image-collection',
            kind: 'batch',
            generationMode: 'parallel',
            createdAt: new Date().toISOString(),
            autoFit: true,
            items: [0, 1, 2].map((index) => ({ id: 'status-item-' + index, assetIndex: index + 1, prompt: 'AIDebug 占位 ' + (index + 1), status: 'pending' }))
          }
        }
      }
    ])`);
    await waitForExpression(client, `document.querySelectorAll('.flow-node[data-node-id="status-unique-image-run"] .node-image-pending-tile').length === 3`);
    const runtimeStatusUniqueness = await evaluate(client, `(() => {
      const node = document.querySelector('.flow-node[data-node-id="status-unique-image-run"]');
      const preview = node?.querySelector('.node-image-preview');
      const pending = node?.querySelector('.node-image-pending-tile');
      const canvas = document.querySelector('.workflow-canvas');
      const canvasFooter = document.querySelector('.canvas-footer');
      const agent = document.querySelector('.project-agent-panel');
      const timer = document.querySelector('.agent-tool-imagegen-timer');
      const composerFooter = document.querySelector('.project-agent-composer > footer');
      if (!node || !preview || !pending || !canvas || !canvasFooter || !agent || !timer || !composerFooter) return null;
      const forbidden = /生图中|生成中|正在生成|运行中|正在透明化并重组/g;
      const canvasText = [canvas.innerText || '', canvasFooter.innerText || ''].join(' ');
      const nodeStyle = getComputedStyle(node);
      const pendingStyle = getComputedStyle(pending);
      const previewAfter = getComputedStyle(preview, '::after');
      return {
        timerText: (timer.textContent || '').replace(/\\s+/g, ' ').trim(),
        agentText: (agent.innerText || '').replace(/\\s+/g, ' ').trim(),
        composerFooterText: (composerFooter.innerText || '').replace(/\\s+/g, ' ').trim(),
        canvasText: canvasText.replace(/\\s+/g, ' ').trim(),
        canvasForbiddenHits: canvasText.match(forbidden) || [],
        nodeState: (node.querySelector('.node-state')?.textContent || '').trim(),
        pendingCount: node.querySelectorAll('.node-image-pending-tile').length,
        progressBlockCount: node.querySelectorAll('.node-image-progress').length,
        previewAfterContent: previewAfter.content,
        pendingAnimationName: pendingStyle.animationName,
        nodeBorder: {
          leftWidth: nodeStyle.borderLeftWidth,
          rightWidth: nodeStyle.borderRightWidth,
          leftColor: nodeStyle.borderLeftColor,
          rightColor: nodeStyle.borderRightColor
        }
      };
    })()`);
    check("running Image Gen keeps its only dynamic status in the Agent timeline", /^Image Gen 正在绘图 \d+s$/.test(runtimeStatusUniqueness?.timerText || '') && runtimeStatusUniqueness?.agentText.includes(runtimeStatusUniqueness.timerText), runtimeStatusUniqueness || {});
    check("busy composer remains a static control surface", runtimeStatusUniqueness?.composerFooterText === 'Ctrl + Enter 发送 停止' && !/正在执行|正在生成|运行中/.test(runtimeStatusUniqueness?.composerFooterText || ''), runtimeStatusUniqueness || {});
    check("canvas image node uses static placeholders without duplicate running status", runtimeStatusUniqueness?.canvasForbiddenHits.length === 0 && runtimeStatusUniqueness?.nodeState === '图片组' && runtimeStatusUniqueness?.pendingCount === 3 && runtimeStatusUniqueness?.progressBlockCount === 0 && ['none', 'normal', ''].includes(String(runtimeStatusUniqueness?.previewAfterContent || '').replace(/[\"']/g, '')) && runtimeStatusUniqueness?.pendingAnimationName === 'none' && runtimeStatusUniqueness?.nodeBorder?.leftWidth === runtimeStatusUniqueness?.nodeBorder?.rightWidth && runtimeStatusUniqueness?.nodeBorder?.leftColor === runtimeStatusUniqueness?.nodeBorder?.rightColor, runtimeStatusUniqueness || {});
    const reducedRuntimeMotion = await motionSnapshot(client, [
      '.flow-node',
      '.edge.active',
      '.agent-message.running .agent-message-node',
      '.agent-tool-trace',
      '.motion-spin-fixture',
      '.canvas-particle-field',
      '#motion-css-fixture .motion-dialog-fixture',
      '#motion-css-fixture .motion-card-fixture'
    ]);
    check("reduced nodes, lines, tools, spinner, and style cards stop permanent motion", reducedRuntimeMotion.rows.every((row) => row.present && !row.permanentAnimation), reducedRuntimeMotion);
    const particleRow = reducedRuntimeMotion.rows.find((row) => row.selector === '.canvas-particle-field');
    const lineRow = reducedRuntimeMotion.rows.find((row) => row.selector === '.edge.active');
    const spinnerRow = reducedRuntimeMotion.rows.find((row) => row.selector === '.motion-spin-fixture');
    const motionFixtureRows = reducedRuntimeMotion.rows.filter((row) => row.selector.startsWith('#motion-css-fixture .motion-'));
    check("reduced particles are hidden while line and spinner retain static state", particleRow?.display === 'none' && lineRow?.animationName === 'none' && spinnerRow?.animationName === 'none', reducedRuntimeMotion);
    check("reduced dedicated motion fixtures disable animation", motionFixtureRows.length === 2 && motionFixtureRows.every((row) => row.animationName === 'none' && row.transform === 'none'), reducedRuntimeMotion);
    const reducedToolLayout = await stableLayoutProbe(client, '.agent-tool-trace', 260);
    check("reduced tool card final layout is stable", reducedToolLayout?.ok === true, reducedToolLayout || {});
    await captureScreenshot(client, "08-reduced-runtime-motion-1280");

    await evaluate(client, `(() => {
      document.querySelector('#motion-css-fixture')?.remove();
      window.__naimageDebugOpenSurface?.('main');
      return true;
    })()`);
    check("CDP restores normal motion preference", !(await emulateReducedMotion(client, false)), {});

    await evaluate(client, `window.__naimageDebugApplyAgentActions?.([
      { type: 'workflow.canvas.clear', mode: 'all' },
      { type: 'workflow.node.create', toolRunId: 'motion-normal-node', node: { id: 'motion-normal-node', title: 'Normal Motion 图片组', prompt: 'normal motion fixture', nodeType: 'image', status: 'review', imageState: 'empty', x: 180, y: 160, width: 300, height: 240, imageProgress: { total: 2, completed: 0, failed: 0, failedSlots: [], retryCount: 0, maxRetries: 0, stopped: false }, imageCollection: { id: 'motion-normal-group', kind: 'batch', generationMode: 'parallel', sourceNodeId: '', createdAt: new Date().toISOString(), items: [{ id: 'motion-item-1', requestIndex: 1, prompt: 'normal motion fixture A', status: 'pending' }, { id: 'motion-item-2', requestIndex: 2, prompt: 'normal motion fixture B', status: 'pending' }] } } }
    ])`);
    await waitForExpression(client, `Boolean(document.querySelector('.flow-node[data-image-container-kind="batch-result"]'))`);
    const normalNodeMotion = await motionSnapshot(client, ['.flow-node[data-image-container-kind="batch-result"]']);
    const normalNodeRow = normalNodeMotion.rows[0];
    check("normal grouped node uses finite settle feedback", normalNodeRow?.animationName.includes('image-layout-settle') && normalNodeRow?.animationIterationCount !== 'infinite' && !normalNodeRow?.permanentAnimation, normalNodeMotion);
    check("normal node positioning never transitions left or top", !String(normalNodeRow?.transitionProperty || '').split(',').map((value) => value.trim()).some((value) => value === 'left' || value === 'top'), normalNodeMotion);
    const normalNodeLayout = await stableLayoutProbe(client, '.flow-node[data-image-container-kind="batch-result"]', 280);
    check("normal grouped node feedback does not shift layout geometry", normalNodeLayout?.ok === true, normalNodeLayout || {});

    await openPromptEditor(client);
    const normalSurfaceMotion = await motionSnapshot(client, ['.agent-text-editor-dialog', '[data-ui-surface-layer="agent-prompt-editor"] .ui-surface-backdrop']);
    check("normal surface motion is finite transform-opacity feedback", normalSurfaceMotion.rows[0]?.animationName.includes('ui-surface-in') && !normalSurfaceMotion.rows[0]?.permanentAnimation && normalSurfaceMotion.rows[1]?.animationName.includes('ui-surface-backdrop-in') && !normalSurfaceMotion.rows[1]?.permanentAnimation, normalSurfaceMotion);
    const normalSurfaceLayout = await stableLayoutProbe(client, '.agent-text-editor-dialog', 280);
    check("normal surface entry does not shift layout geometry", normalSurfaceLayout?.ok === true, normalSurfaceLayout || {});
    await captureScreenshot(client, "09-normal-motion-surface-1280");
    await pressKey(client, "Escape");
    await waitForExpression(client, `!document.querySelector('.agent-text-editor-dialog')`);
    await evaluate(client, `window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }])`);
    await evaluate(client, `window.__naimageDebugOpenSurface?.('main')`);
    await waitForExpression(client, `Boolean(document.querySelector('.project-agent-panel') && !document.querySelector('.settings-drawer, .account-drawer, [role="dialog"]'))`);

    const requirementSeed = await evaluate(client, `window.__naimageAIDebug?.seedCanvas?.({ count: 1, fileBacked: true })`);
    const requirementSourceId = requirementSeed?.state?.nodes?.find((node) => node.type === 'image')?.id || '';
    check("requirement suite seeds one source image", requirementSeed?.ok === true && Boolean(requirementSourceId), requirementSeed || {});
    const requirementSourceMenu = await evaluate(client, `window.__naimageAIDebug?.openNodeMenu?.({ id: ${JSON.stringify(requirementSourceId)} })`);
    check(
      "source image opens its single-node requirement menu",
      requirementSourceMenu?.ok === true && requirementSourceMenu?.texts?.some((text) => text.includes("基于此成果提要求")),
      requirementSourceMenu || {}
    );
    if (!requirementSourceMenu?.ok || !requirementSourceMenu?.texts?.some((text) => text.includes("基于此成果提要求"))) {
      throw new Error(`Source node menu did not expose the requirement action: ${JSON.stringify(requirementSourceMenu)}`);
    }
    await clickButton(client, "基于此成果提要求", ".canvas-context-menu");
    await waitForExpression(client, `Boolean(document.querySelector('.requirement-editor-dialog textarea'))`);
    const requirementEditorLayout = await evaluate(client, `(() => {
      const dialog = document.querySelector('.requirement-editor-dialog');
      const body = dialog?.querySelector('.requirement-editor-body');
      const relation = dialog?.querySelector('.requirement-relation-preview');
      const textarea = dialog?.querySelector('textarea');
      if (!dialog || !body || !relation || !textarea) return null;
      const rect = dialog.getBoundingClientRect();
      const textRect = textarea.getBoundingClientRect();
      return {
        withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        relationSteps: relation.querySelectorAll(':scope > span').length,
        textareaWithin: textRect.left >= rect.left - 1 && textRect.right <= rect.right + 1,
        overflowX: dialog.scrollWidth > dialog.clientWidth + 1,
        actions: Array.from(dialog.querySelectorAll('footer button')).map((button) => (button.textContent || '').trim())
      };
    })()`);
    check("requirement editor uses the unified contained layout", requirementEditorLayout?.withinViewport === true && requirementEditorLayout?.relationSteps === 3 && requirementEditorLayout?.textareaWithin === true && requirementEditorLayout?.overflowX === false && requirementEditorLayout?.actions.includes('仅创建') && requirementEditorLayout?.actions.includes('创建并执行'), requirementEditorLayout || {});
    await setWindowSize(client, target.id, 884, 720);
    await waitForExpression(client, `Boolean(document.querySelector('.requirement-editor-dialog textarea'))`, 5_000);
    const compactRequirementEditorLayout = await evaluate(client, `(() => {
      const dialog = document.querySelector('.requirement-editor-dialog');
      const body = dialog?.querySelector('.requirement-editor-body');
      const relation = dialog?.querySelector('.requirement-relation-preview');
      const footer = dialog?.querySelector('footer');
      const surfaceSnapshot = {
        layers: Array.from(document.querySelectorAll('[data-ui-surface-layer]')).map((item) => item.getAttribute('data-ui-surface-layer') || ''),
        surfaces: Array.from(document.querySelectorAll('[data-ui-surface]')).map((item) => item.getAttribute('data-ui-surface') || ''),
        settingsOpen: Boolean(document.querySelector('.settings-drawer')),
        requirementOpen: Boolean(dialog),
        activeElement: document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 80) || document.activeElement?.tagName || ''
      };
      if (!dialog || !body || !relation || !footer) return {
        viewport: { width: innerWidth, height: innerHeight },
        missing: {
          dialog: !dialog,
          body: !body,
          relation: !relation,
          footer: !footer
        },
        surfaceSnapshot
      };
      const rect = dialog.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        overflowX: dialog.scrollWidth > dialog.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1,
        relationSteps: relation.querySelectorAll(':scope > span').length,
        footerWithin: footerRect.left >= rect.left && footerRect.right <= rect.right + 1 && footerRect.bottom <= rect.bottom + 1,
        actions: Array.from(footer.querySelectorAll('button')).map((button) => (button.textContent || '').trim()),
        surfaceSnapshot
      };
    })()`);
    check("requirement editor remains contained and actionable at the minimum workbench width", compactRequirementEditorLayout?.viewport?.width === 884 && compactRequirementEditorLayout?.withinViewport === true && compactRequirementEditorLayout?.overflowX === false && compactRequirementEditorLayout?.relationSteps === 3 && compactRequirementEditorLayout?.footerWithin === true && compactRequirementEditorLayout?.actions?.length === 3, compactRequirementEditorLayout || {});
    await captureScreenshot(client, "09a-requirement-editor-884x720");
    await setWindowSize(client, target.id, 1280, 820);
    await waitForExpression(client, `Boolean(document.querySelector('.requirement-editor-dialog textarea'))`, 5_000);
    const requirementText = "请基于来源图片生成一张更明亮、更现代的测试变体图并同步到画布。";
    await evaluate(client, `(() => {
      const textarea = document.querySelector('.requirement-editor-dialog textarea');
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, ${JSON.stringify(requirementText)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(client, `document.querySelector('.requirement-editor-dialog textarea')?.value === ${JSON.stringify(requirementText)}`);
    await clickButton(client, "仅创建", ".requirement-editor-dialog");
    await waitForExpression(client, `Boolean(document.querySelector('.flow-node.requirement-node')) && !document.querySelector('.requirement-editor-dialog')`);
    const createdRequirement = await evaluate(client, `(() => {
      const state = window.__naimageDebugAgentState?.();
      const node = state?.nodes?.find((item) => item.type === 'requirement');
      const element = node ? document.querySelector('.flow-node.requirement-node[data-node-id="' + CSS.escape(node.id) + '"]') : null;
      return { node, selected: element?.classList.contains('selected') || false, text: element?.textContent || '', canvasStatus: document.querySelector('.canvas-live-progress')?.textContent?.replace(/\s+/g, ' ').trim() || '' };
    })()`);
    const requirementNodeId = createdRequirement?.node?.id || '';
    check("source creates one persistent selected requirement node", createdRequirement?.node?.parentId === requirementSourceId && createdRequirement?.node?.relationType === 'referenced' && createdRequirement?.node?.requirement?.text === requirementText && createdRequirement?.node?.requirement?.revision === 1 && createdRequirement?.selected === true, createdRequirement || {});
    check("canvas footer distinguishes image成果 from reusable requirements", createdRequirement?.canvasStatus?.includes('1 个图片成果') && createdRequirement?.canvasStatus?.includes('1 个可复用需求'), createdRequirement || {});
    await captureScreenshot(client, "09a-requirement-node-created-1280");

    await evaluate(client, `document.querySelector('.flow-node.requirement-node')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`);
    await waitForExpression(client, `Boolean(document.querySelector('.requirement-editor-dialog textarea'))`);
    const revisedRequirementText = `${requirementText} 保持主体身份一致。`;
    await evaluate(client, `(() => {
      const textarea = document.querySelector('.requirement-editor-dialog textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!textarea || !setter) return false;
      setter.call(textarea, ${JSON.stringify(revisedRequirementText)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await clickButton(client, "保存", ".requirement-editor-dialog");
    await waitForExpression(client, `!document.querySelector('.requirement-editor-dialog') && window.__naimageDebugAgentState?.()?.nodes?.some((node) => node.id === ${JSON.stringify(requirementNodeId)} && node.requirement?.revision === 2)`);
    const revisedRequirement = await evaluate(client, `window.__naimageDebugAgentState?.()?.nodes?.find((node) => node.id === ${JSON.stringify(requirementNodeId)})`);
    check("editing a requirement increments its revision and resets the duplicate guard", revisedRequirement?.requirement?.text === revisedRequirementText && revisedRequirement?.requirement?.revision === 2 && !revisedRequirement?.requirement?.lastSourceSignature, revisedRequirement || {});

    await evaluate(client, `window.__naimageAIDebug?.openNodeMenu?.({ id: ${JSON.stringify(requirementNodeId)} })`);
    await waitForExpression(client, `Array.from(document.querySelectorAll('.canvas-context-menu button')).some((button) => (button.textContent || '').includes('断开全部输入素材'))`);
    await clickButton(client, "断开全部输入素材", ".canvas-context-menu");
    await waitForExpression(client, `(() => {
      const node = window.__naimageDebugAgentState?.()?.nodes?.find((item) => item.id === ${JSON.stringify(requirementNodeId)});
      return !node?.parentId && !(node?.requirement?.inputBindings?.length);
    })()`);
    const reconnected = await evaluate(client, `window.__naimageDebugConnectNodes?.({ sourceId: ${JSON.stringify(requirementSourceId)}, targetId: ${JSON.stringify(requirementNodeId)} })`);
    check("requirement input can be disconnected and reconnected to a source", reconnected === true, { reconnected });
    const requirementPreRunState = await evaluate(client, `window.__naimageDebugAgentState?.()`);
    check("requirement execution starts from an idle Agent", requirementPreRunState?.agentExecutionBusy === false, {
      agentStatus: requirementPreRunState?.agentStatus,
      executionReservation: requirementPreRunState?.executionReservation,
      activeRunId: requirementPreRunState?.activeRunId,
      activeImageRunIds: requirementPreRunState?.activeImageRunIds
    });
    if (requirementPreRunState?.agentExecutionBusy) {
      throw new Error(`Requirement pre-run Agent is unexpectedly busy: ${JSON.stringify({
        agentStatus: requirementPreRunState?.agentStatus,
        executionReservation: requirementPreRunState?.executionReservation,
        activeRunId: requirementPreRunState?.activeRunId,
        activeImageRunIds: requirementPreRunState?.activeImageRunIds
      })}`);
    }

    const requirementRunClick = await evaluate(client, `(() => {
      const button = document.querySelector('.flow-node.requirement-node[data-node-id="' + CSS.escape(${JSON.stringify(requirementNodeId)}) + '"] .requirement-node-run');
      if (!button) return { clicked: false, reason: 'button-missing' };
      if (button.disabled) return { clicked: false, reason: 'button-disabled' };
      button.click();
      return { clicked: true };
    })()`);
    check("requirement run button accepts the click", requirementRunClick?.clicked === true, requirementRunClick || {});
    await waitForExpression(client, `(() => {
      const state = window.__naimageDebugAgentState?.();
      return state?.agentStatus === 'thinking' || state?.agentStatus === 'editing' || state?.messages?.some((message) => message.role === 'user' && message.content === ${JSON.stringify(revisedRequirementText)});
    })()`, 7000);
    await waitForExpression(client, `(() => {
      const state = window.__naimageDebugAgentState?.();
      return state?.agentStatus === 'idle' && state.nodes?.some((node) => node.type === 'image' && node.parentId === ${JSON.stringify(requirementNodeId)} && node.imageState !== 'error' && (node.assets?.length || 0) > 0);
    })()`, 30000);
    const executedRequirement = await evaluate(client, `(() => {
      const state = window.__naimageDebugAgentState?.();
      const requirement = state?.nodes?.find((node) => node.id === ${JSON.stringify(requirementNodeId)});
      const outputs = state?.nodes?.filter((node) => node.type === 'image' && node.parentId === ${JSON.stringify(requirementNodeId)} && node.imageState !== 'error' && (node.assets?.length || 0) > 0) || [];
      const user = [...(state?.messages || [])].reverse().find((message) => message.role === 'user' && message.content === ${JSON.stringify(revisedRequirementText)});
      return { requirement, outputs, user };
    })()`);
    check("executing a requirement produces requirement-parented image output with SOURCE scope", executedRequirement?.outputs?.length >= 1 && executedRequirement?.requirement?.requirement?.lastRunCount === 1 && Boolean(executedRequirement?.requirement?.requirement?.lastSourceSignature) && executedRequirement?.user?.attachments?.sourceAssets?.every((asset) => asset.role === 'source' && asset.nodeId === requirementSourceId), executedRequirement || {});
    await captureScreenshot(client, "09b-requirement-executed-1280");

    await evaluate(client, `document.querySelector('.flow-node.requirement-node .requirement-node-run')?.click()`);
    await waitForExpression(client, `Boolean(document.querySelector('.confirm-dialog')) && document.querySelector('.confirm-dialog')?.textContent?.includes('来源没有变化')`);
    check("unchanged requirement source requires confirmation before rerun", true, {});
    await clickButton(client, "取消", ".confirm-dialog");

    const requirementSelectionPrompt = "只确认当前可复用需求已选中，不要执行图片任务。";
    await evaluate(client, `window.__naimageAIDebug?.selectNodes?.({ ids: [${JSON.stringify(requirementNodeId)}], primaryId: ${JSON.stringify(requirementNodeId)} })`);
    await evaluate(client, `window.__naimageDebugSendAgentPrompt?.(${JSON.stringify(requirementSelectionPrompt)})`);
    await waitForExpression(client, `window.__naimageDebugAgentState?.()?.agentStatus === 'idle' && window.__naimageDebugAgentState?.()?.messages?.some((message) => message.role === 'user' && message.content === ${JSON.stringify(requirementSelectionPrompt)})`, 15000);
    const requirementSelectionMessage = await evaluate(client, `(() => {
      const state = window.__naimageDebugAgentState?.();
      return [...(state?.messages || [])].reverse().find((message) => message.role === 'user' && message.content === ${JSON.stringify(requirementSelectionPrompt)}) || null;
    })()`);
    const selectedRequirementSources = requirementSelectionMessage?.attachments?.sourceAssets || [];
    check(
      "selecting a requirement resolves its connected image SOURCE without exposing the requirement itself",
      selectedRequirementSources.length >= 1 &&
        selectedRequirementSources.every((asset) => asset.role === 'source' && asset.nodeId === requirementSourceId && asset.nodeId !== requirementNodeId),
      requirementSelectionMessage || {}
    );
    await evaluate(client, `window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }])`);

    const followSeeded = await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: 'follow-assistant-' + index,
        role: 'assistant',
        content: '历史消息 ' + (index + 1) + '：' + '用于验证阅读位置不会被实时更新打断。'.repeat(8),
        status: index === 59 ? 'running' : 'done'
      })),
      append: false,
      maxMessages: 60
    })`);
    await waitForExpression(client, `document.querySelectorAll('.project-agent-feed .agent-message').length === 60`);
    await delay(100);
    const followBefore = await evaluate(client, `(async () => {
      const feed = document.querySelector('.project-agent-feed');
      if (!feed) return null;
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { scrollTop: feed.scrollTop, overflowed: feed.scrollHeight > feed.clientHeight };
    })()`);
    await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({ streamDelta: { id: 'follow-assistant-59', delta: '\\n实时增量不会抢走阅读位置。', status: 'running' } })`);
    await waitForExpression(client, `document.querySelector('.project-agent-feed')?.textContent?.includes('实时增量不会抢走阅读位置')`);
    const followAfterProgress = await evaluate(client, `(() => {
      const feed = document.querySelector('.project-agent-feed');
      return feed ? { scrollTop: feed.scrollTop, bottomGap: feed.scrollHeight - feed.clientHeight - feed.scrollTop } : null;
    })()`);
    check("Agent progress keeps the reader's historical scroll position", followSeeded === true && followBefore?.overflowed === true && Math.abs((followAfterProgress?.scrollTop ?? 999) - (followBefore?.scrollTop ?? 0)) <= 2 && (followAfterProgress?.bottomGap ?? 0) > 72, { followBefore, followAfterProgress });
    await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({
      messages: [{ id: 'follow-user-new-task', role: 'user', content: '这是本人刚发起的新任务。', status: 'done' }],
      append: true,
      maxMessages: 1
    })`);
    await waitForExpression(client, `document.querySelector('.project-agent-feed')?.textContent?.includes('这是本人刚发起的新任务')`);
    await waitForExpression(client, `(() => {
      const feed = document.querySelector('.project-agent-feed');
      return Boolean(feed) && Math.max(0, feed.scrollHeight - feed.clientHeight - feed.scrollTop) <= 72;
    })()`, 5_000);
    const followAfterUser = await evaluate(client, `(() => {
      const feed = document.querySelector('.project-agent-feed');
      return feed ? { bottomGap: Math.max(0, feed.scrollHeight - feed.clientHeight - feed.scrollTop) } : null;
    })()`);
    check("a fresh user task resumes Agent feed following", (followAfterUser?.bottomGap ?? 999) <= 72, followAfterUser || {});
    await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({ clear: true })`);

    const markdownSeeded = await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({
      messages: [
        { id: 'md-heading-list', role: 'assistant', content: '## 工作摘要\\n\\n- 原图已识别\\n- 参考图已隔离' },
        { id: 'md-emphasis', role: 'assistant', content: '**重要结果** 与 *补充说明*' },
        { id: 'md-link-quote', role: 'assistant', content: '[查看项目](https://example.com/project)\\n\\n> 保持画布与对话同步。' },
        { id: 'md-code', role: 'assistant', content: '内联 \\u0060assetId\\u0060\\n\\n\\u0060\\u0060\\u0060json\\n{"role":"source"}\\n\\u0060\\u0060\\u0060' }
      ],
      append: false,
      maxMessages: 4
    })`);
    await waitForExpression(client, `document.querySelectorAll('.project-agent-feed .agent-message').length === 4`);
    await waitForExpression(client, `Boolean(
      document.querySelector('.project-agent-feed .agent-message h2') &&
      document.querySelector('.project-agent-feed .agent-message ul li') &&
      document.querySelector('.project-agent-feed .agent-message strong') &&
      document.querySelector('.project-agent-feed .agent-message em') &&
      document.querySelector('.project-agent-feed .agent-message a[href="https://example.com/project"]') &&
      document.querySelector('.project-agent-feed .agent-message blockquote') &&
      document.querySelector('.project-agent-feed .agent-message pre code')
    )`);
    const markdownCommonMark = await evaluate(client, `(() => {
      const messages = Array.from(document.querySelectorAll('.project-agent-feed .agent-message'));
      const feed = document.querySelector('.project-agent-feed');
      const codeBlock = messages[3]?.querySelector('pre');
      const codeRect = codeBlock?.getBoundingClientRect();
      const messageRect = messages[3]?.getBoundingClientRect();
      return {
        messageCount: messages.length,
        heading: messages[0]?.querySelector('h2')?.textContent || '',
        listItems: messages[0]?.querySelectorAll('ul li').length || 0,
        strong: messages[1]?.querySelector('strong')?.textContent || '',
        emphasis: messages[1]?.querySelector('em')?.textContent || '',
        link: messages[2]?.querySelector('a')?.getAttribute('href') || '',
        quote: messages[2]?.querySelector('blockquote')?.textContent?.trim() || '',
        inlineCode: messages[3]?.querySelector('p code')?.textContent || '',
        fencedCode: messages[3]?.querySelector('pre code')?.textContent?.trim() || '',
        proprietaryNodes: document.querySelectorAll('.project-agent-feed table, .project-agent-feed del, .project-agent-feed .task-list-item, .project-agent-feed [data-footnote-ref]').length,
        codeContained: Boolean(codeRect && messageRect && codeRect.left >= messageRect.left - 1 && codeRect.right <= messageRect.right + 1),
        feedOverflowX: feed ? feed.scrollWidth > feed.clientWidth + 1 : true
      };
    })()`);
    check("standard Markdown renders headings, lists, emphasis, links, quotes, and code", markdownSeeded === true && markdownCommonMark?.messageCount === 4 && markdownCommonMark?.heading === '工作摘要' && markdownCommonMark?.listItems === 2 && markdownCommonMark?.strong === '重要结果' && markdownCommonMark?.emphasis === '补充说明' && markdownCommonMark?.link === 'https://example.com/project' && markdownCommonMark?.quote.includes('保持画布与对话同步') && markdownCommonMark?.inlineCode === 'assetId' && markdownCommonMark?.fencedCode.includes('"role":"source"'), markdownCommonMark || {});
    check("standard Markdown stays contained without private GFM extensions", markdownCommonMark?.proprietaryNodes === 0 && markdownCommonMark?.codeContained === true && markdownCommonMark?.feedOverflowX === false, markdownCommonMark || {});
    await captureScreenshot(client, "09b-agent-markdown-1280");
    await evaluate(client, `window.__naimageDebugSeedAgentMessages?.({ clear: true })`);

    await evaluate(client, `window.__naimageDebugOpenSurface?.('main')`);
    await clickAria(client, "账户");
    await waitForExpression(client, `Boolean(document.querySelector('.account-drawer[data-ui-surface="account"]'))`);
    await clickButton(client, "退出登录", ".account-drawer");
    await waitForExpression(client, `Boolean(document.querySelector('.auth-shell .auth-card[aria-label="naimage 访问配置"]'))`, 7000);
    const logoutAuthLayout = await evaluate(client, `(() => {
      const shell = document.querySelector('.auth-shell');
      const card = shell?.querySelector('.auth-card[aria-label="naimage 访问配置"]');
      const form = card?.querySelector('.auth-gate-form');
      const inputs = Array.from(form?.querySelectorAll('input') || []);
      const submit = form?.querySelector('button[type="submit"]');
      if (!shell || !card || !form || inputs.length !== 2 || !submit) return null;
      const shellRect = shell.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const inputStyles = inputs.map((input) => {
        const style = getComputedStyle(input);
        const rect = input.getBoundingClientRect();
        return { display: style.display, borderStyle: style.borderStyle, backgroundColor: style.backgroundColor, width: Math.round(rect.width), height: Math.round(rect.height) };
      });
      const submitStyle = getComputedStyle(submit);
      const submitRect = submit.getBoundingClientRect();
      return {
        authShellCount: document.querySelectorAll('.auth-shell').length,
        authCardCount: document.querySelectorAll('.auth-card[aria-label="naimage 访问配置"]').length,
        ideShellCount: document.querySelectorAll('.ide-shell').length,
        drawerCount: document.querySelectorAll('.account-drawer, .settings-drawer').length,
        shellWithinViewport: shellRect.left >= -1 && shellRect.top >= -1 && shellRect.right <= window.innerWidth + 1 && shellRect.bottom <= window.innerHeight + 1,
        cardWithinViewport: cardRect.left >= -1 && cardRect.top >= -1 && cardRect.right <= window.innerWidth + 1 && cardRect.bottom <= window.innerHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
        inputStyles,
        submit: { display: submitStyle.display, borderStyle: submitStyle.borderStyle, backgroundColor: submitStyle.backgroundColor, width: Math.round(submitRect.width), height: Math.round(submitRect.height) }
      };
    })()`);
    check("logout returns to the single canonical styled login gate", logoutAuthLayout?.authShellCount === 1 && logoutAuthLayout?.authCardCount === 1 && logoutAuthLayout?.ideShellCount === 0 && logoutAuthLayout?.drawerCount === 0 && logoutAuthLayout?.shellWithinViewport === true && logoutAuthLayout?.cardWithinViewport === true && logoutAuthLayout?.horizontalOverflow === false && logoutAuthLayout?.inputStyles.every((item) => item.display !== 'none' && item.borderStyle !== 'none' && item.width >= 260 && item.height >= 34) && logoutAuthLayout?.submit?.display.includes('flex') && logoutAuthLayout?.submit?.borderStyle !== 'none' && logoutAuthLayout?.submit?.height >= 34, logoutAuthLayout || {});
    await captureScreenshot(client, "10-logout-login-gate-1280x820");

    await clickButton(client, "注册", ".auth-card");
    await waitForExpression(client, `document.querySelectorAll('.auth-gate-form input').length === 3`);
    const registerGate = await evaluate(client, `({ title: document.querySelector('.auth-card h1')?.textContent?.trim() || '', inputCount: document.querySelectorAll('.auth-gate-form input').length, activeTab: document.querySelector('.auth-switch[aria-label="登录注册切换"] button[aria-pressed="true"]')?.textContent?.trim() || '' })`);
    check("logout gate preserves the styled login/register switch", registerGate?.title === "选择使用方式" && registerGate?.inputCount === 3 && registerGate?.activeTab === "注册", registerGate || {});
    await captureScreenshot(client, "11-logout-register-gate-1280x820");

    await clickButton(client, "登录", ".auth-card");
    await waitForExpression(client, `document.querySelectorAll('.auth-gate-form input').length === 2`);
    const invalidLoginValuesSet = await evaluate(client, `(() => {
      const username = document.querySelector('.auth-gate-form input[autocomplete="username"]');
      const password = document.querySelector('.auth-gate-form input[type="password"]');
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      inputSetter?.call(username, 'wrong-user');
      username?.dispatchEvent(new Event('input', { bubbles: true }));
      username?.dispatchEvent(new Event('change', { bubbles: true }));
      inputSetter?.call(password, 'wrong-pass');
      password?.dispatchEvent(new Event('input', { bubbles: true }));
      password?.dispatchEvent(new Event('change', { bubbles: true }));
      return username?.value === 'wrong-user' && password?.value === 'wrong-pass';
    })()`);
    check("invalid login credentials are entered", invalidLoginValuesSet === true, { invalidLoginValuesSet });
    await delay(120);
    const invalidLoginSubmitted = await evaluate(client, `(() => {
      const form = document.querySelector('.auth-gate-form');
      if (!(form instanceof HTMLFormElement)) return false;
      form.requestSubmit();
      return true;
    })()`);
    check("invalid login form is submitted after React state settles", invalidLoginSubmitted === true, { invalidLoginSubmitted });
    await waitForExpression(client, `Boolean(document.querySelector('.auth-message[data-ui-tone="danger"][role="alert"]'))`, 7000);
    const loginError = await evaluate(client, `({ text: document.querySelector('.auth-message[data-ui-tone="danger"]')?.textContent?.trim() || '', visible: Boolean(document.querySelector('.auth-message[data-ui-tone="danger"]')?.getClientRects().length) })`);
    check("canonical login gate renders authentication errors", loginError?.visible === true && loginError?.text.length > 0, loginError || {});
    await captureScreenshot(client, "12-logout-login-error-1280x820");
  } catch (error) {
    fatalError = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
    check("end-to-end script completed", false, { error: fatalError });
  } finally {
    client.close();
  }

  const failures = checks.filter((item) => !item.ok);
  const report = {
    ok: failures.length === 0 && !fatalError,
    mode: "agent-text-ui-aidebug",
    runDir,
    configDir,
    debugPort,
    screenshots,
    checks,
    failures,
    fatalError
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, runDir, reportPath, screenshots, failures, fatalError }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

try {
  await main();
} finally {
  await stopProcess(electronProcess);
  await stopProcess(viteProcess);
}
