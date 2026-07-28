import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `agent-panel-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
let viteProcess;
let electronProcess;
let client;

function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function mouseClick(rect) {
  const { x, y } = rectCenter(rect);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function elementRect(selector) {
  const rect = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  })()`);
  assert(rect, `Missing element: ${selector}`);
  return rect;
}

async function placementButtonRect(label) {
  const rect = await evaluate(client, `(() => {
    const expected = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll('.agent-placement-menu button')).find((item) => item.textContent?.replace(/\s+/g, ' ').trim() === expected);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  assert(rect, `Missing placement button: ${label}`);
  return rect;
}

async function openPlacementMenu() {
  const opened = await evaluate(client, `(() => {
    const button = document.querySelector('button[aria-label="调整对话框位置"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert.equal(opened, true, "Placement toggle must be available");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.agent-placement-menu'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
}

async function choosePlacement(label, placement) {
  await openPlacementMenu();
  await mouseClick(await placementButtonRect(label));
  await waitForRuntimeExpression(client, `document.querySelector('.ide-main')?.classList.contains(${JSON.stringify(`agent-placement-${placement}`)})`, { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  await delay(80);
}

async function main() {
  mkdirSync(runDir, { recursive: true });
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");
  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false
  });
  await waitForHttpServer(devUrl, { attempts: 120, intervalMs: 100, errorMessage: "Targeted Agent panel Vite server did not start." });

  electronProcess = spawn(process.execPath, [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
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

  const target = await pollForDebugTarget({
    port: debugPort,
    attempts: 160,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Targeted Agent panel Electron renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-panel') && window.__naimageAIDebug)", { evaluate, timeoutMs: 15_000, intervalMs: 100 });

  const initialFit = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-agent-panel')?.getBoundingClientRect();
    const canvas = document.querySelector('.canvas-panel')?.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      panelInside: Boolean(panel && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight),
      canvasVisible: Boolean(canvas && canvas.width > 200 && canvas.height > 200)
    };
  })()`);
  assert.equal(initialFit.documentOverflowX, false);
  assert.equal(initialFit.panelInside, true);
  assert.equal(initialFit.canvasVisible, true);

  await choosePlacement("停靠上方", "top");
  const topLayout = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-agent-panel')?.getBoundingClientRect();
    const canvas = document.querySelector('.canvas-panel')?.getBoundingClientRect();
    const handle = document.querySelector('.agent-panel-resize-handle.resize-top')?.getBoundingClientRect();
    return { panelBottom: panel?.bottom, canvasTop: canvas?.top, panelHeight: panel?.height, handleWidth: handle?.width, handleHeight: handle?.height };
  })()`);
  assert(Math.abs(topLayout.panelBottom - topLayout.canvasTop) <= 1, "Top-docked panel must sit above the canvas");
  assert(topLayout.handleWidth > topLayout.handleHeight * 10, "Top resize handle must be horizontal");

  await choosePlacement("停靠下方", "bottom");
  const bottomLayout = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-agent-panel')?.getBoundingClientRect();
    const canvas = document.querySelector('.canvas-panel')?.getBoundingClientRect();
    return { panelTop: panel?.top, canvasBottom: canvas?.bottom };
  })()`);
  assert(Math.abs(bottomLayout.panelTop - bottomLayout.canvasBottom) <= 1, "Bottom-docked panel must sit below the canvas");

  await choosePlacement("停靠右侧", "right");
  const handleRect = await elementRect(".agent-panel-resize-handle.resize-right");
  const widthBefore = (await elementRect(".project-agent-panel")).width;
  // Let the placement-setting round trip finish so its single expected App
  // commit is not attributed to the pointer-move performance measurement.
  await delay(500);
  await evaluate(client, "window.__naimageAIDebug.resetRenderCommits()");
  const handlePoint = rectCenter(handleRect);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: handlePoint.x, y: handlePoint.y, button: "left", clickCount: 1 });
  for (let index = 1; index <= 12; index += 1) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: handlePoint.x - index * 8,
      y: handlePoint.y,
      button: "left",
      buttons: 1
    });
  }
  await delay(80);
  const dragPreview = await evaluate(client, `({
    commits: window.__naimageAIDebug.renderCommits(),
    previewWidth: getComputedStyle(document.querySelector('.ide-main')).getPropertyValue('--agent-panel-preview-width').trim(),
    interacting: document.querySelector('.ide-main').classList.contains('agent-panel-interacting')
  })`);
  assert.equal(dragPreview.commits.app, 0, "Pointer moves must not re-render the whole App");
  assert.equal(dragPreview.commits.canvas, 0, "Pointer moves must not re-render the canvas");
  assert.equal(dragPreview.interacting, true);
  assert.match(dragPreview.previewWidth, /px$/);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: handlePoint.x - 96, y: handlePoint.y, button: "left", clickCount: 1 });
  await delay(120);
  const widthAfter = (await elementRect(".project-agent-panel")).width;
  assert(
    widthAfter >= widthBefore + 80,
    `Right panel width should commit after pointer release (before=${widthBefore}, preview=${dragPreview.previewWidth}, after=${widthAfter})`
  );
  assert.equal(await evaluate(client, "document.querySelector('.ide-main').classList.contains('agent-panel-interacting')"), false);

  const longPrompt = Array.from({ length: 48 }, (_item, index) => `第 ${index + 1} 行商品图提示词：保持商品身份、材质、标签、构图与光线一致。`).join("\n");
  const seeded = await evaluate(client, `window.__naimageDebugSeedAgentMessages({ messages: [{
    id: 'agent-panel-prompt-layout',
    role: 'assistant',
    content: '',
    status: 'done',
    toolTrace: {
      stage: 'start',
      label: 'Image Gen 绘图请求',
      name: 'image_gen',
      operation: 'generate',
      params: '1:1 · 1080P',
      brief: '生成商品图。',
      prompts: [{ title: '商品图提示词', prompt: ${JSON.stringify(longPrompt)} }]
    }
  }], maxMessages: 4 })`);
  assert.equal(seeded, true);
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.agent-tool-prompt-block summary'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  await mouseClick(await elementRect(".agent-tool-prompt-block summary"));
  await waitForRuntimeExpression(client, "document.querySelector('.agent-tool-prompt-block')?.open === true", { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  const promptLayout = await evaluate(client, `(() => {
    const copy = document.querySelector('.agent-tool-prompt-copy')?.getBoundingClientRect();
    const pre = document.querySelector('.agent-tool-prompt-block pre');
    const preRect = pre?.getBoundingClientRect();
    return {
      copyAboveScrollRegion: Boolean(copy && preRect && copy.bottom <= preRect.top + 1),
      copyIntersectsPre: Boolean(copy && preRect && copy.left < preRect.right && copy.right > preRect.left && copy.top < preRect.bottom && copy.bottom > preRect.top),
      scrollable: Boolean(pre && pre.scrollHeight > pre.clientHeight),
      scrollbarGutter: pre ? getComputedStyle(pre).scrollbarGutter : ''
    };
  })()`);
  assert.equal(promptLayout.copyAboveScrollRegion, true);
  assert.equal(promptLayout.copyIntersectsPre, false);
  assert.equal(promptLayout.scrollable, true);
  assert.match(promptLayout.scrollbarGutter, /stable/);

  await mouseClick(await elementRect(".agent-tool-prompt-copy"));
  await waitForRuntimeExpression(client, "document.querySelector('.agent-tool-prompt-copy')?.getAttribute('title') === '已复制'", { evaluate, timeoutMs: 2_000, intervalMs: 60 });

  const screenshotPath = join(runDir, "agent-prompt-copy-layout.png");
  await capturePngScreenshotToFile(client, screenshotPath, { captureBeyondViewport: false }, 15_000);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 17,
    initialFit,
    topLayout,
    bottomLayout,
    dragPreview,
    promptLayout,
    screenshotPath
  })}\n`);
}

try {
  await main();
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
