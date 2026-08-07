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
const artifactRoot = process.env.NAIMAGE_TEST_ARTIFACT_DIR
  ? resolve(process.env.NAIMAGE_TEST_ARTIFACT_DIR)
  : join(repoRoot, ".diagnostics", "electron");
const runDir = join(artifactRoot, `agent-panel-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
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

async function materialsButtonRect(label) {
  const rect = await evaluate(client, `(() => {
    const expected = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll('.project-agent-materials-menu button')).find((item) => item.textContent?.includes(expected));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  assert(rect, `Missing materials button: ${label}`);
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
      panelInside: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      canvasVisible: Boolean(canvas && canvas.width > 200 && canvas.height > 200),
      panel: panel ? { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width, height: panel.height } : null,
      canvas: canvas ? { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom, width: canvas.width, height: canvas.height } : null
    };
  })()`);
  assert.equal(initialFit.documentOverflowX, false);
  assert.equal(initialFit.panelInside, true, `Agent panel must fit the startup viewport: ${JSON.stringify(initialFit)}`);
  assert.equal(initialFit.canvasVisible, true, `Canvas must remain usable beside the Agent panel: ${JSON.stringify(initialFit)}`);

  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-model-trigger'))", { evaluate, timeoutMs: 5_000, intervalMs: 60 });
  await waitForRuntimeExpression(client, `(() => {
    const trigger = document.querySelector('.project-agent-model-trigger');
    if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) return false;
    const rect = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === trigger || trigger.contains(hit)));
  })()`, { evaluate, timeoutMs: 5_000, intervalMs: 60 });
  const modelTriggerRect = await elementRect(".project-agent-model-trigger");
  const modelTriggerHit = await evaluate(client, `(() => {
    const trigger = document.querySelector('.project-agent-model-trigger');
    if (!(trigger instanceof HTMLButtonElement)) return null;
    const rect = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      disabled: trigger.disabled,
      hitTrigger: Boolean(hit && (hit === trigger || trigger.contains(hit))),
      hitClass: hit instanceof HTMLElement ? hit.className : '',
      ariaExpanded: trigger.getAttribute('aria-expanded')
    };
  })()`);
  assert.equal(modelTriggerHit?.disabled, false, `Model trigger must be enabled: ${JSON.stringify(modelTriggerHit)}`);
  assert.equal(modelTriggerHit?.hitTrigger, true, `Model trigger center must remain clickable: ${JSON.stringify(modelTriggerHit)}`);
  await mouseClick(modelTriggerRect);
  try {
    await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-model-menu'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  } catch (error) {
    const state = await evaluate(client, `(() => ({
      expanded: document.querySelector('.project-agent-model-trigger')?.getAttribute('aria-expanded') || '',
      pickerClass: document.querySelector('.project-agent-model-picker')?.className || '',
      activeClass: document.activeElement instanceof HTMLElement ? document.activeElement.className : ''
    }))()`);
    throw new Error(`Image model menu did not open after a real pointer click: ${JSON.stringify(state)}`, { cause: error });
  }
  const modelMenuLayout = await evaluate(client, `(() => {
    const trigger = document.querySelector('.project-agent-model-trigger');
    const menu = document.querySelector('.project-agent-model-menu');
    const menuRect = menu?.getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.project-agent-model-row'));
    return {
      triggerUsesButtonBase: Boolean(trigger?.classList.contains('ui-button-base')),
      triggerDefault: trigger?.querySelector('strong')?.textContent?.trim() || '',
      triggerTitle: trigger?.getAttribute('title') || '',
      menuInsideViewport: Boolean(menuRect && menuRect.left >= -1 && menuRect.right <= innerWidth + 1 && menuRect.top >= -1 && menuRect.bottom <= innerHeight + 1),
      menuWidth: menuRect?.width || 0,
      multiselectable: document.querySelector('.project-agent-model-options')?.getAttribute('aria-multiselectable') || '',
      models: options.map((row) => row.querySelector('.project-agent-model-option span')?.textContent?.trim() || '').filter(Boolean),
      checkedCount: document.querySelectorAll('.project-agent-model-option input:checked').length,
      defaultControlsUseButtonBase: options.every((row) => row.querySelector('.project-agent-model-default')?.classList.contains('ui-button-base'))
    };
  })()`);
  assert.equal(modelMenuLayout.triggerUsesButtonBase, true);
  assert.equal(modelMenuLayout.defaultControlsUseButtonBase, true);
  assert.equal(modelMenuLayout.multiselectable, "true");
  assert.equal(modelMenuLayout.menuInsideViewport, true, `Model menu must fit the viewport: ${JSON.stringify(modelMenuLayout)}`);
  assert(modelMenuLayout.menuWidth <= 362, `Model menu must remain compact: ${JSON.stringify(modelMenuLayout)}`);
  assert(modelMenuLayout.models.length >= 2, `Model menu must expose the upstream image catalog: ${JSON.stringify(modelMenuLayout)}`);
  assert(modelMenuLayout.checkedCount >= 2, `Model menu must expose the selected model pool: ${JSON.stringify(modelMenuLayout)}`);
  assert.match(modelMenuLayout.triggerTitle, new RegExp(`默认模型：${modelMenuLayout.triggerDefault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const searchedModel = modelMenuLayout.models.at(-1);
  assert(searchedModel);
  await evaluate(client, `(() => {
    const input = document.querySelector('.project-agent-model-search input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(searchedModel)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitForRuntimeExpression(client, "document.querySelectorAll('.project-agent-model-row').length === 1", { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  assert.equal(await evaluate(client, "document.querySelector('.project-agent-model-option span')?.textContent?.trim()"), searchedModel);
  await evaluate(client, `(() => {
    const input = document.querySelector('.project-agent-model-search input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitForRuntimeExpression(client, `document.querySelectorAll('.project-agent-model-row').length === ${modelMenuLayout.models.length}`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });

  const toggledModel = modelMenuLayout.models.at(-1);
  const checkedBeforeToggle = modelMenuLayout.checkedCount;
  const toggled = await evaluate(client, `(() => {
    const expected = ${JSON.stringify(toggledModel)};
    const row = Array.from(document.querySelectorAll('.project-agent-model-row')).find((item) => item.querySelector('.project-agent-model-option span')?.textContent?.trim() === expected);
    const input = row?.querySelector('.project-agent-model-option input');
    if (!(input instanceof HTMLInputElement) || input.disabled || !input.checked) return false;
    input.click();
    return true;
  })()`);
  assert.equal(toggled, true);
  await waitForRuntimeExpression(client, `document.querySelectorAll('.project-agent-model-option input:checked').length === ${checkedBeforeToggle - 1}`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  await evaluate(client, `(() => {
    const expected = ${JSON.stringify(toggledModel)};
    const row = Array.from(document.querySelectorAll('.project-agent-model-row')).find((item) => item.querySelector('.project-agent-model-option span')?.textContent?.trim() === expected);
    const input = row?.querySelector('.project-agent-model-option input');
    if (!(input instanceof HTMLInputElement) || input.disabled || input.checked) return false;
    input.click();
    return true;
  })()`);
  await waitForRuntimeExpression(client, `document.querySelectorAll('.project-agent-model-option input:checked').length === ${checkedBeforeToggle}`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });

  const nextDefaultModel = modelMenuLayout.models[1];
  await evaluate(client, `(() => {
    const expected = ${JSON.stringify(nextDefaultModel)};
    const row = Array.from(document.querySelectorAll('.project-agent-model-row')).find((item) => item.querySelector('.project-agent-model-option span')?.textContent?.trim() === expected);
    const button = row?.querySelector('.project-agent-model-default');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  await waitForRuntimeExpression(client, `document.querySelector('.project-agent-model-trigger strong')?.textContent?.trim() === ${JSON.stringify(nextDefaultModel)}`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  const modelPickerScreenshotPath = join(runDir, "image-model-menu.png");
  await capturePngScreenshotToFile(client, modelPickerScreenshotPath, { captureBeyondViewport: false }, 15_000);
  await evaluate(client, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitForRuntimeExpression(client, "!document.querySelector('.project-agent-model-menu')", { evaluate, timeoutMs: 2_000, intervalMs: 50 });

  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-mode-trigger') && document.querySelector('.project-agent-materials-trigger') && document.querySelectorAll('.project-agent-frame-trigger').length === 2)", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  const composerToolbar = await evaluate(client, `(() => {
    const toolbar = document.querySelector('.project-agent-composer-toolbar');
    const ratio = document.querySelector('.project-agent-frame-picker.ratio .project-agent-frame-trigger');
    const resolution = document.querySelector('.project-agent-frame-picker.resolution .project-agent-frame-trigger');
    const ratioRect = ratio?.getBoundingClientRect();
    const resolutionRect = resolution?.getBoundingClientRect();
    return {
      nativeFrameSelectCount: document.querySelectorAll('.project-agent-image-frame select').length,
      ratioText: ratio?.querySelector('strong')?.textContent?.trim() || '',
      resolutionText: resolution?.querySelector('strong')?.textContent?.trim() || '',
      adjacentFrameControls: Boolean(ratioRect && resolutionRect && Math.abs(ratioRect.top - resolutionRect.top) <= 1 && resolutionRect.left > ratioRect.right),
      ratioWidth: ratioRect?.width || 0,
      resolutionWidth: resolutionRect?.width || 0,
      toolbarOverflowX: Boolean(toolbar && toolbar.scrollWidth > toolbar.clientWidth + 1)
    };
  })()`);
  assert.equal(composerToolbar.nativeFrameSelectCount, 0, `Ratio and resolution must not use native white selects: ${JSON.stringify(composerToolbar)}`);
  assert.match(composerToolbar.ratioText, /^\d+(?::\d+)?$/);
  assert.match(composerToolbar.resolutionText, /^[124]K$/);
  assert.equal(composerToolbar.adjacentFrameControls, true, `Ratio and resolution must stay in one compact group: ${JSON.stringify(composerToolbar)}`);
  assert.equal(composerToolbar.toolbarOverflowX, false, `Composer toolbar must not overflow: ${JSON.stringify(composerToolbar)}`);

  await mouseClick(await elementRect('.project-agent-mode-trigger'));
  await waitForRuntimeExpression(client, `(() => {
    const fan = document.querySelector('.project-agent-mode-fan');
    return Boolean(fan && getComputedStyle(fan).opacity === '1' && getComputedStyle(fan).pointerEvents === 'auto');
  })()`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  const modeFan = await evaluate(client, `(() => {
    const fan = document.querySelector('.project-agent-mode-fan');
    const rect = fan?.getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.project-agent-mode-option'));
    return {
      role: fan?.getAttribute('role') || '',
      expanded: document.querySelector('.project-agent-mode-trigger')?.getAttribute('aria-expanded') || '',
      insideViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
      labels: options.map((option) => option.textContent?.trim() || ''),
      checkedCount: options.filter((option) => option.getAttribute('aria-checked') === 'true').length,
      clippedShapes: options.every((option) => getComputedStyle(option).clipPath !== 'none')
    };
  })()`);
  assert.equal(modeFan.role, 'menu');
  assert.equal(modeFan.expanded, 'true');
  assert.deepEqual(modeFan.labels, ['普通', 'Goal']);
  assert.equal(modeFan.checkedCount, 1);
  assert.equal(modeFan.clippedShapes, true);
  assert.equal(modeFan.insideViewport, true, `Mode fan must remain visible inside the viewport: ${JSON.stringify(modeFan)}`);
  await capturePngScreenshotToFile(client, join(runDir, 'composer-mode-fan.png'), { captureBeyondViewport: false }, 15_000);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, button: 'none' });
  await evaluate(client, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  await mouseClick(await elementRect('.project-agent-materials-trigger'));
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-materials-menu'))", { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  const materialsMenu = await evaluate(client, `(() => {
    const menu = document.querySelector('.project-agent-materials-menu');
    const rect = menu?.getBoundingClientRect();
    const style = menu ? getComputedStyle(menu) : null;
    return {
      labels: Array.from(menu?.querySelectorAll('button strong') || []).map((item) => item.textContent?.trim() || ''),
      width: rect?.width || 0,
      insideViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
      glass: Boolean(style && style.backdropFilter !== 'none' && style.backgroundColor !== 'rgb(255, 255, 255)')
    };
  })()`);
  assert.equal(materialsMenu.labels.length, 2);
  assert(materialsMenu.labels.some((label) => label.includes('原图')));
  assert(materialsMenu.labels.some((label) => label.includes('参考图')));
  assert(materialsMenu.width >= 190);
  assert.equal(materialsMenu.insideViewport, true);
  assert.equal(materialsMenu.glass, true, `Materials menu must use the glass surface: ${JSON.stringify(materialsMenu)}`);
  await capturePngScreenshotToFile(client, join(runDir, 'composer-materials-menu.png'), { captureBeyondViewport: false }, 15_000);
  await evaluate(client, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitForRuntimeExpression(client, "!document.querySelector('.project-agent-materials-menu')", { evaluate, timeoutMs: 2_000, intervalMs: 50 });

  async function verifyFrameMenu(kind) {
    const triggerSelector = `.project-agent-frame-picker.${kind} .project-agent-frame-trigger`;
    const before = await evaluate(client, `document.querySelector(${JSON.stringify(triggerSelector)})?.querySelector('strong')?.textContent?.trim() || ''`);
    await mouseClick(await elementRect(triggerSelector));
    await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-frame-menu'))", { evaluate, timeoutMs: 2_000, intervalMs: 50 });
    const snapshot = await evaluate(client, `(() => {
      const menu = document.querySelector('.project-agent-frame-menu');
      const rect = menu?.getBoundingClientRect();
      const style = menu ? getComputedStyle(menu) : null;
      const options = Array.from(menu?.querySelectorAll('button') || []);
      return {
        role: menu?.getAttribute('role') || '',
        optionCount: options.length,
        selectedCount: options.filter((option) => option.getAttribute('aria-selected') === 'true').length,
        width: rect?.width || 0,
        insideViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
        glass: Boolean(style && style.backdropFilter !== 'none' && style.backgroundColor !== 'rgb(255, 255, 255)')
      };
    })()`);
    assert.equal(snapshot.role, 'listbox');
    assert(snapshot.optionCount >= 2, `${kind} menu must offer more than one option: ${JSON.stringify(snapshot)}`);
    assert.equal(snapshot.selectedCount, 1);
    assert(snapshot.width >= 140, `${kind} menu must not be a thin native dropdown: ${JSON.stringify(snapshot)}`);
    assert.equal(snapshot.insideViewport, true);
    assert.equal(snapshot.glass, true, `${kind} menu must use transparent glass: ${JSON.stringify(snapshot)}`);
    await capturePngScreenshotToFile(client, join(runDir, `composer-${kind}-menu.png`), { captureBeyondViewport: false }, 15_000);
    const selected = await evaluate(client, `(() => {
      const option = Array.from(document.querySelectorAll('.project-agent-frame-menu button')).find((button) => !button.classList.contains('active'));
      if (!(option instanceof HTMLButtonElement)) return '';
      const value = option.querySelector('strong')?.textContent?.trim() || '';
      option.click();
      return value;
    })()`);
    assert(selected && selected !== before);
    await waitForRuntimeExpression(client, `!document.querySelector('.project-agent-frame-menu') && document.querySelector(${JSON.stringify(triggerSelector)})?.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(selected)}`, { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  }

  await verifyFrameMenu('ratio');
  await verifyFrameMenu('resolution');

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

  const referencePath = join(repoRoot, "public", "naimage.png");
  const referenceImport = await evaluate(client, `window.__naimageDebugImportPathsAsReferences?.({ paths: [${JSON.stringify(referencePath)}] })`);
  assert.equal(referenceImport?.ok, true, `Reference fixture import failed: ${JSON.stringify(referenceImport)}`);
  await mouseClick(await elementRect(".project-agent-materials-trigger"));
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-materials-menu'))", { evaluate, timeoutMs: 2_000, intervalMs: 50 });
  await mouseClick(await materialsButtonRect("参考图"));
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.reference-picker-dialog .reference-slot.filled'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  const pickerLayout = await evaluate(client, `(() => {
    const dialog = document.querySelector('.reference-picker-dialog');
    const grid = dialog?.querySelector('.reference-grid');
    const slot = grid?.querySelector('.reference-slot.filled');
    const image = slot?.querySelector('img');
    const caption = slot?.querySelector('figcaption');
    const dialogRect = dialog?.getBoundingClientRect();
    const slotRect = slot?.getBoundingClientRect();
    const glass = slot ? getComputedStyle(slot, '::after') : null;
    const captionStyle = caption ? getComputedStyle(caption) : null;
    return {
      dialogWidth: dialogRect?.width || 0,
      slotWidth: slotRect?.width || 0,
      slotHeight: slotRect?.height || 0,
      objectFit: image ? getComputedStyle(image).objectFit : '',
      imageFilter: image ? getComputedStyle(image).filter : '',
      glassContent: glass?.content || '',
      glassBackground: glass?.backgroundColor || '',
      glassShadow: glass?.boxShadow || '',
      glassFilter: glass?.backdropFilter || '',
      captionBackground: captionStyle?.backgroundColor || '',
      captionRight: captionStyle?.right || ''
    };
  })()`);
  assert(pickerLayout.dialogWidth <= 402, `Reference picker must remain compact: ${JSON.stringify(pickerLayout)}`);
  assert(pickerLayout.slotWidth >= 94 && pickerLayout.slotWidth <= 98, `Reference slot width must stay near 96px: ${JSON.stringify(pickerLayout)}`);
  assert(pickerLayout.slotHeight >= 94 && pickerLayout.slotHeight <= 98, `Reference slot height must stay near 96px: ${JSON.stringify(pickerLayout)}`);
  assert(Math.abs(pickerLayout.slotWidth - pickerLayout.slotHeight) <= 1, `Reference slot must remain square: ${JSON.stringify(pickerLayout)}`);
  assert.equal(pickerLayout.objectFit, "contain");
  assert.equal(pickerLayout.imageFilter, "none");
  assert.notEqual(pickerLayout.glassContent, "none");
  assert.notEqual(pickerLayout.glassBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(pickerLayout.glassShadow, "none");
  assert.notEqual(pickerLayout.glassFilter, "none");
  assert.notEqual(pickerLayout.captionBackground, "rgba(0, 0, 0, 0)");
  assert.equal(pickerLayout.captionRight, "6px");

  const pickerScreenshotPath = join(runDir, "reference-picker-glass.png");
  await capturePngScreenshotToFile(client, pickerScreenshotPath, { captureBeyondViewport: false }, 15_000);
  await mouseClick(await elementRect(".reference-picker-dialog .ui-surface-close"));
  await waitForRuntimeExpression(client, "!document.querySelector('.reference-picker-dialog')", { evaluate, timeoutMs: 2_000, intervalMs: 60 });

  const attachmentChat = await evaluate(client, `window.__naimageAIDebug.chat('请确认这张参考图，不要调用工具。', { skipAsk: true, timeoutMs: 30_000 })`);
  assert.equal(attachmentChat?.ok, true, `Attachment chat failed: ${JSON.stringify(attachmentChat)}`);
  await waitForRuntimeExpression(client, "Boolean(Array.from(document.querySelectorAll('.agent-message.user')).at(-1)?.querySelector('.agent-message-attachment-group > summary'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  const attachmentOpened = await evaluate(client, `(() => {
    const summary = Array.from(document.querySelectorAll('.agent-message.user')).at(-1)?.querySelector('.agent-message-attachment-group > summary');
    if (!(summary instanceof HTMLElement)) return false;
    summary.click();
    return true;
  })()`);
  assert.equal(attachmentOpened, true);
  await waitForRuntimeExpression(client, "Boolean(Array.from(document.querySelectorAll('.agent-message.user')).at(-1)?.querySelector('.agent-message-attachment-preview'))", { evaluate, timeoutMs: 2_000, intervalMs: 60 });
  const attachmentLayout = await evaluate(client, `(() => {
    const message = Array.from(document.querySelectorAll('.agent-message.user')).at(-1);
    const grid = message?.querySelector('.agent-message-attachment-grid');
    const preview = message?.querySelector('.agent-message-attachment-preview');
    const image = preview?.querySelector('img');
    const messageRect = message?.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();
    const glass = preview ? getComputedStyle(preview, '::after') : null;
    return {
      gridInsideMessage: Boolean(messageRect && gridRect && gridRect.left >= messageRect.left - 1 && gridRect.right <= messageRect.right + 1),
      previewWidth: previewRect?.width || 0,
      previewHeight: previewRect?.height || 0,
      objectFit: image ? getComputedStyle(image).objectFit : '',
      glassContent: glass?.content || '',
      glassBackground: glass?.backgroundColor || '',
      glassShadow: glass?.boxShadow || ''
    };
  })()`);
  assert.equal(attachmentLayout.gridInsideMessage, true, `Attachment grid must stay inside the message: ${JSON.stringify(attachmentLayout)}`);
  assert(attachmentLayout.previewWidth <= 94 && attachmentLayout.previewHeight <= 94, `Single reference preview must remain compact: ${JSON.stringify(attachmentLayout)}`);
  assert.equal(attachmentLayout.objectFit, "contain");
  assert.notEqual(attachmentLayout.glassContent, "none");
  assert.notEqual(attachmentLayout.glassBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(attachmentLayout.glassShadow, "none");

  const screenshotPath = join(runDir, "agent-reference-glass.png");
  await capturePngScreenshotToFile(client, screenshotPath, { captureBeyondViewport: false }, 15_000);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 50,
    initialFit,
    modelMenuLayout,
    topLayout,
    bottomLayout,
    dragPreview,
    promptLayout,
    pickerLayout,
    attachmentLayout,
    modelPickerScreenshotPath,
    pickerScreenshotPath,
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
