import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { createAidebugReporting } from "./aidebug/harness/reporting.mjs";
import { captureStableCdpScene, createObservationLog } from "./aidebug/harness/standalone-gui-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `commerce-set-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectListPath = join(configDir, "project-list.json");
const fixtureProjectId = "aidebug-commerce-project";
const fixtureProjectPath = join(runDir, "project");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const commercePluginState = {
  id: "sparkai.commerce-toolkit",
  version: "1.0.0",
  enabled: true,
  grantedPermissions: ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]
};
const fallbackPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const observationLog = createObservationLog();
const { observations, recordObservation } = observationLog;

const qaInventory = [
  { id: "toolbar", claim: "跨境电商工具位于画布底部居中圆角 Dock，并按选区启用。", evidence: "00-toolbar-as-launched.png" },
  { id: "toolbar-modes", claim: "Dock 支持常驻展开、悬停/焦点展开和工具栏内固定切换。", evidence: "00a-toolbar-hover-collapsed.png, 00b-toolbar-hover-expanded.png" },
  { id: "shortcuts", claim: "工具快捷键可自定义，冲突不会覆盖，旧组合失效后新组合调用对应工具；Commerce 对话框打开时阻止背后画布快捷键。", evidence: "01-generate-two-sources-three-slots.png, 14a-tool-shortcut-conflict.png, 14-tool-settings.png, 15-hidden-tool-shortcut.png" },
  { id: "platform-templates", claim: "Amazon 与速卖通平台模板会载入各自完整槽位，之后仍可逐图修改。", evidence: "00c-aliexpress-platform-template.png, 01-generate-two-sources-three-slots.png" },
  { id: "matrix", claim: "多母图按槽位形成请求矩阵，逐张 Prompt 可编辑。", evidence: "01-generate-two-sources-three-slots.png" },
  { id: "translation-matrix", claim: "翻译模式支持图片 × 语言逐单元格要求，并在桌面与 900×640 窗口保持可操作。", evidence: "02a-translation-matrix-cells.png, 02b-translation-matrix-900x640.png" },
  { id: "mode-switch", claim: "生成对话框切换到翻译后，逐项矩阵随冻结计划进入真实派发。", evidence: "02-translate-mode-with-prompts.png, 03-translation-direct-dispatch.png" },
  { id: "direct-dispatch", claim: "用户点击执行即授权派发，不再出现第二个费用确认弹窗。", evidence: "03-translation-direct-dispatch.png" },
  { id: "requirement", claim: "确认派发后创建 Requirement，复用执行仍进入 Goal。", evidence: "04-requirement-node.png, 05-requirement-rerun-goal.png" },
  { id: "skill", claim: "确认派发后创建 Skill 节点。", evidence: "06-skill-node.png" },
  { id: "stale-source", claim: "配置期间母图变化会保守拒绝，不按过期范围派发。", evidence: "07-stale-source-rejected.png" },
  { id: "container-probe", claim: "单容器多母图的 Goal 明确探测不同母图代表项。", evidence: "08-container-two-assets-goal.png" },
  { id: "container-rounding", claim: "图片容器、预览和图片 tile 具有圆角且不裁切连接端口。", evidence: "08a-rounded-image-container.png" },
  { id: "limit", claim: "200 请求可执行，超过 200 被阻止；12 槽与 10 语言仍可检查。", evidence: "09-exact-200.png, 10-over-limit-240-top.png, 11-twelve-slots-reachable.png, 12-over-limit-warning.png" },
  { id: "small-window", claim: "900×640 最小发布窗口中关键操作区无横向裁切。", evidence: "13-small-window-900x640.png" },
  { id: "template-market", claim: "当前套图可保存到模板市场，内置/个人模板清晰分组并可从 900×640 窗口复用。", evidence: "13a-template-market-900x640.png, 13b-template-reuse-900x640.png" },
  { id: "ab-comparison", claim: "同槽位的两个真实受管结果并排比较，终选后保留两项并标记为已选定/未选。", evidence: "13c-ab-comparison-900x640.png, 13d-ab-winner-900x640.png" },
  { id: "tool-settings", claim: "设置可逐项控制底部工具栏可见性、保存 hover 模式并自定义快捷键；隐藏工具仍可由快捷键调用。", evidence: "14-tool-settings.png, 15-hidden-tool-shortcut.png" }
];

let viteProcess;
let electronProcess;
let client;
let target;
const screenshots = {};
const checks = {};
const evidenceResults = [];
let reporting;

function prepareProjectFixture() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(fixtureProjectPath, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(projectListPath, `${JSON.stringify({
    activeProjectId: fixtureProjectId,
    projects: [{
      id: fixtureProjectId,
      name: "AIDebug Commerce",
      path: fixtureProjectPath,
      sessionPath: join(fixtureProjectPath, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: true
    }]
  }, null, 2)}\n`, "utf8");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function jsonObjectAfterMarker(value, marker) {
  const text = String(value || "");
  const markerIndex = text.lastIndexOf(marker);
  const start = text.indexOf("{", markerIndex + marker.length);
  if (markerIndex < 0 || start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  return null;
}

async function waitFor(expression, timeoutMs = 12_000, intervalMs = 80) {
  return waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs });
}

async function pointForSelector(selector, text = "") {
  return evaluate(client, `(() => {
    const selector = ${JSON.stringify(selector)};
    const expected = ${JSON.stringify(text)};
    const candidates = Array.from(document.querySelectorAll(selector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    const element = expected
      ? candidates.find((candidate) => String(candidate.textContent || "").replace(/\\s+/g, " ").trim().includes(expected))
      : candidates[0];
    if (!element) return null;
    if (!element.closest('.canvas-plugin-toolbar')) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function clickPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await delay(110);
  return true;
}

async function movePointer(point) {
  assert(point && Number.isFinite(point.x) && Number.isFinite(point.y), "Pointer target is unavailable");
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await delay(220);
}

async function dispatchCanvasToolShortcut(digit, modifiers = 10) {
  const numeric = Math.max(1, Math.min(9, Math.round(Number(digit))));
  const payload = {
    key: String(numeric),
    code: `Digit${numeric}`,
    windowsVirtualKeyCode: 48 + numeric,
    nativeVirtualKeyCode: 48 + numeric,
    modifiers
  };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...payload });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await delay(180);
}

async function clickSelector(selector, text = "") {
  return clickPoint(await pointForSelector(selector, text));
}

async function selectAllWithKeyboard() {
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 2
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 0
  });
}

async function replaceText(selector, value) {
  assert.equal(await clickSelector(selector), true, `Input unavailable: ${selector}`);
  await selectAllWithKeyboard();
  await client.send("Input.insertText", { text: String(value) });
  await delay(140);
  const actual = await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
  assert.equal(actual, String(value), `Input value mismatch: ${selector}`);
  return actual;
}

async function setWindowSize(width, height) {
  const attempts = [];
  try {
    const ipc = await evaluate(client, `(async () => await window.naimageConfig?.debugWindowBounds?.(${JSON.stringify({ width, height })}))()`, 5000);
    if (!ipc?.ok) throw new Error(ipc?.error || "debugWindowBounds unavailable");
    attempts.push({ method: "debugWindowBounds", ok: true, bounds: ipc.bounds, contentBounds: ipc.contentBounds });
  } catch (error) {
    attempts.push({ method: "debugWindowBounds", ok: false, error: error instanceof Error ? error.message : String(error) });
    try {
      const windowInfo = await client.send("Browser.getWindowForTarget", { targetId: target.id }, 5000);
      await client.send("Browser.setWindowBounds", { windowId: windowInfo.windowId, bounds: { width, height, windowState: "normal" } }, 5000);
      attempts.push({ method: "Browser.setWindowBounds", ok: true });
    } catch (browserError) {
      attempts.push({ method: "Browser.setWindowBounds", ok: false, error: browserError instanceof Error ? browserError.message : String(browserError) });
      await evaluate(client, `window.resizeTo(${Number(width)}, ${Number(height)}); undefined`, 5000);
    }
  }
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  }, 5000).catch(() => null);
  await client.send("Emulation.setVisibleSize", { width, height }, 5000).catch(() => null);
  await delay(260);
  await evaluate(client, "window.dispatchEvent(new Event('resize')); undefined", 3000).catch(() => null);
  await delay(260);
  const metrics = await evaluate(client, `({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight
  })`);
  return { requested: { width, height }, attempts, metrics };
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
  screenshots[label] = { path: result.screenshotPath, sha256: result.screenshotEvidence.sha256 };
  if (!result.visualReliability.ok) {
    throw new Error(`Commerce visual evidence failed for ${label}: ${result.visualReliability.failureReasons.join(", ")} ${JSON.stringify({
      stateIssues: result.stateIssues,
      overflow: result.overflow,
      captureIssues: result.captureIssues
    })}`);
  }
  return result.screenshotPath;
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
        left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom),
        width: Math.round(box.width), height: Math.round(box.height)
      };
    };
    const text = (element) => String(element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const commerce = document.querySelector('.commerce-set-dialog');
    const templateMarket = document.querySelector('.commerce-template-dialog');
    const abComparison = document.querySelector('.commerce-ab-dialog');
    const goal = document.querySelector('.goal-confirmation-dialog');
    const toolbar = document.querySelector('.canvas-plugin-toolbar');
    const settingsDrawer = document.querySelector('.settings-drawer');
    const commerceFooter = commerce?.querySelector('.ui-surface-footer');
    const templateFooter = templateMarket?.querySelector('.ui-surface-footer');
    const abFooter = abComparison?.querySelector('.ui-surface-footer');
    const goalFooter = goal?.querySelector('.ui-surface-footer');
    const required = [commerce, templateMarket, abComparison, goal, commerceFooter, templateFooter, abFooter, goalFooter, toolbar, settingsDrawer].filter(visible);
    const clipped = required.flatMap((element) => {
      const box = rect(element);
      return box && (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1)
        ? [{ selector: element.className, rect: box, viewport: { width: innerWidth, height: innerHeight } }]
        : [];
    });
    const overflowCandidates = Array.from(document.querySelectorAll('.commerce-set-dialog, .commerce-template-dialog, .commerce-ab-dialog, .goal-confirmation-dialog, .settings-drawer, .ui-surface-footer, .canvas-plugin-toolbar, .project-agent-panel'))
      .filter(visible)
      .flatMap((element) => {
        const box = rect(element);
        const overflow = element.scrollWidth > element.clientWidth + 1 || box.left < -1 || box.right > innerWidth + 1;
        return overflow ? [{ selector: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, rect: box }] : [];
      });
    const summary = commerce ? Object.fromEntries(Array.from(commerce.querySelectorAll('.commerce-set-summary > span')).map((item) => [
      text(item.querySelector('small')),
      text(item.querySelector('strong'))
    ])) : null;
    const state = {
      viewport: { width: innerWidth, height: innerHeight },
      commerce: commerce ? {
        title: text(commerce.querySelector('.ui-surface-heading h2')),
        summary,
        slotCount: commerce.querySelectorAll('.commerce-set-slot-card').length,
        selectedLanguages: commerce.querySelectorAll('.commerce-language-option input:checked').length,
        selectedSaveTarget: text(commerce.querySelector('.commerce-set-save-control [aria-pressed="true"]')),
        submit: text(commerce.querySelector('.commerce-set-submit')),
        submitDisabled: commerce.querySelector('.commerce-set-submit')?.disabled === true,
        scrollTop: Math.round(commerce.querySelector('.commerce-set-body')?.scrollTop || 0),
        rect: rect(commerce),
        footerRect: rect(commerceFooter)
      } : null,
      templateMarket: templateMarket ? {
        builtInCount: templateMarket.querySelectorAll('.commerce-template-row[data-source="built-in"]').length,
        personalCount: templateMarket.querySelectorAll('.commerce-template-row[data-source="personal"]').length,
        rect: rect(templateMarket),
        footerRect: rect(templateFooter)
      } : null,
      abComparison: abComparison ? {
        groupCount: abComparison.querySelectorAll('.commerce-ab-groups > button').length,
        candidateCount: abComparison.querySelectorAll('.commerce-ab-candidate').length,
        rect: rect(abComparison),
        footerRect: rect(abFooter)
      } : null,
      goal: goal ? {
        scope: text(goal.querySelector('.goal-confirmation-scope')),
        policies: Array.from(goal.querySelectorAll('.goal-confirmation-policy li')).map(text),
        rect: rect(goal),
        footerRect: rect(goalFooter)
      } : null,
      toolbar: toolbar ? {
        mode: toolbar.getAttribute('data-toolbar-mode') || '',
        expanded: toolbar.getAttribute('data-expanded') === 'true',
        rect: rect(toolbar),
        buttons: Array.from(toolbar.querySelectorAll('[data-plugin-command]')).map((button) => ({
          command: button.getAttribute('data-plugin-command') || '',
          text: text(button.querySelector(':scope > span')),
          disabled: button.disabled === true
        }))
      } : null,
      settings: settingsDrawer ? {
        activeTab: text(settingsDrawer.querySelector('.settings-section-tab.active')),
        mode: text(settingsDrawer.querySelector('.settings-canvas-tool-mode [aria-pressed="true"]')),
        disabledTools: Array.from(settingsDrawer.querySelectorAll('.settings-canvas-tool-row input:not(:checked)')).map((input) => input.closest('[data-canvas-tool-command]')?.getAttribute('data-canvas-tool-command') || ''),
        rect: rect(settingsDrawer)
      } : null,
      nodes: Array.from(document.querySelectorAll('.flow-node[data-node-id]')).map((node) => ({
        id: node.getAttribute('data-node-id') || '',
        title: text(node.querySelector('.node-title')),
        requirement: node.classList.contains('requirement-node'),
        skill: node.classList.contains('skill-node')
      }))
    };
    return {
      viewport: state.viewport,
      surfaceOk: Boolean(document.body && (commerce || templateMarket || abComparison || goal || settingsDrawer || document.querySelector('.canvas-plugin-toolbar'))),
      state,
      stateIssues: clipped.map((item) => ({ key: 'required-surface-clipped', expected: 'inside viewport', actual: item })),
      overflow: {
        documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
        elementOverflowX: overflowCandidates
      }
    };
  })()`);
}

async function readToolbar() {
  return evaluate(client, `(() => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const overlapArea = (left, right) => {
      if (!left || !right) return 0;
      return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    };
    const toolbar = document.querySelector('.canvas-plugin-toolbar');
    const workflow = document.querySelector('.workflow-canvas');
    const footer = document.querySelector('.canvas-footer');
    const actions = toolbar?.querySelector('.canvas-plugin-toolbar-actions');
    const toolbarRect = rect(toolbar);
    const workflowRect = rect(workflow);
    const footerRect = rect(footer);
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
    const actionsStyle = actions ? getComputedStyle(actions) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mode: toolbar?.getAttribute('data-toolbar-mode') || '',
      expanded: toolbar?.getAttribute('data-expanded') === 'true',
      toolbarRect,
      workflowRect,
      footerRect,
      centerDelta: toolbarRect && workflowRect ? Math.abs((toolbarRect.left + toolbarRect.right) / 2 - (workflowRect.left + workflowRect.right) / 2) : null,
      bottomGap: toolbarRect && workflowRect ? workflowRect.bottom - toolbarRect.bottom : null,
      footerOverlapArea: overlapArea(toolbarRect, footerRect),
      borderRadius: Number.parseFloat(toolbarStyle?.borderRadius || '0'),
      position: toolbarStyle?.position || '',
      actionsVisible: Boolean(actionsStyle && actionsStyle.visibility !== 'hidden' && Number(actionsStyle.opacity) > 0.9 && actions.clientWidth > 0),
      triggerPresent: toolbar?.querySelector('.canvas-plugin-toolbar-trigger') instanceof HTMLButtonElement,
      pinPresent: toolbar?.querySelector('.canvas-plugin-toolbar-pin') instanceof HTMLButtonElement,
      buttons: Array.from(document.querySelectorAll('.canvas-plugin-toolbar [data-plugin-command]')).map((button) => ({
        command: button.getAttribute('data-plugin-command') || '',
        text: String(button.querySelector(':scope > span')?.textContent || '').replace(/\\s+/g, ' ').trim(),
        disabled: button.disabled,
        title: button.title,
        ariaKeyShortcuts: button.getAttribute('aria-keyshortcuts') || '',
        tabIndex: button.tabIndex
      }))
    };
  })()`);
}

async function readImageContainerRounding(nodeId) {
  return evaluate(client, `(() => {
    const node = document.querySelector('.flow-node:not(.canvas-node-overview)[data-node-id="' + CSS.escape(${JSON.stringify(nodeId)}) + '"]');
    const preview = node?.querySelector('.node-image-preview');
    const tile = preview?.querySelector('.node-image-tile');
    const image = tile?.querySelector('img');
    const radius = (element) => Number.parseFloat(element ? getComputedStyle(element).borderRadius : '0');
    const nodeStyle = node ? getComputedStyle(node) : null;
    return {
      nodePresent: Boolean(node),
      previewPresent: Boolean(preview),
      tilePresent: Boolean(tile),
      imagePresent: Boolean(image),
      nodeRadius: radius(node),
      previewRadius: radius(preview),
      tileRadius: radius(tile),
      imageRadius: radius(image),
      nodeOverflow: nodeStyle?.overflow || ''
    };
  })()`);
}

async function readCommerceDialog() {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.commerce-set-dialog');
    if (!dialog) return null;
    const body = dialog.querySelector('.commerce-set-body');
    const footer = dialog.querySelector('.ui-surface-footer');
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const summary = Object.fromEntries(Array.from(dialog.querySelectorAll('.commerce-set-summary > span')).map((item) => [
      String(item.querySelector('small')?.textContent || '').trim(),
      String(item.querySelector('strong')?.textContent || '').trim()
    ]));
    const submit = dialog.querySelector('.commerce-set-submit');
    const submitStyle = submit ? getComputedStyle(submit) : null;
    return {
      title: String(dialog.querySelector('.ui-surface-heading h2')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      summary,
      modeButtons: Array.from(dialog.querySelectorAll('.commerce-set-mode-control button')).map((button) => ({
        text: String(button.textContent || '').replace(/\\s+/g, ' ').trim(),
        active: button.getAttribute('aria-pressed') === 'true'
      })),
      platformButtons: Array.from(dialog.querySelectorAll('.commerce-set-platform-control button')).map((button) => ({
        text: String(button.textContent || '').replace(/\\s+/g, ' ').trim(),
        active: button.getAttribute('aria-pressed') === 'true'
      })),
      platformSummary: String(dialog.querySelector('.commerce-set-platform-summary')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      saveButtons: Array.from(dialog.querySelectorAll('.commerce-set-save-control button')).map((button) => ({
        text: String(button.textContent || '').replace(/\\s+/g, ' ').trim(),
        active: button.getAttribute('aria-pressed') === 'true'
      })),
      slotCount: dialog.querySelectorAll('.commerce-set-slot-card').length,
      slotPrompts: Array.from(dialog.querySelectorAll('.commerce-set-slot-card textarea')).map((input) => input.value),
      selectedLanguages: Array.from(dialog.querySelectorAll('.commerce-language-option input:checked')).map((input) => input.closest('label')?.textContent?.replace(/\\s+/g, ' ').trim() || ''),
      disabledLanguages: dialog.querySelectorAll('.commerce-language-option input:disabled').length,
      languagePromptCount: dialog.querySelectorAll('.commerce-language-prompts textarea').length,
      translationMatrix: (() => {
        const section = dialog.querySelector('.commerce-translation-matrix-section');
        const scroller = dialog.querySelector('.commerce-translation-matrix-scroll');
        const editor = dialog.querySelector('.commerce-translation-cell-editor');
        if (!section) return null;
        return {
          sourceRows: section.querySelectorAll('tbody tr').length,
          localeCodes: Array.from(section.querySelectorAll('thead th:not(:first-child) small')).map((item) => String(item.textContent || '').trim()),
          customizedCount: Number(String(section.querySelector('.commerce-translation-matrix-heading > span')?.textContent || '').match(/\\d+/)?.[0] || 0),
          cells: Array.from(section.querySelectorAll('.commerce-translation-cell')).map((button) => ({
            label: button.getAttribute('aria-label') || '',
            text: String(button.textContent || '').replace(/\s+/g, ' ').trim(),
            active: button.getAttribute('aria-pressed') === 'true',
            custom: button.classList.contains('custom')
          })),
          editor: editor ? {
            text: String(editor.textContent || '').replace(/\s+/g, ' ').trim(),
            value: editor.querySelector('textarea')?.value || ''
          } : null,
          scroll: scroller ? {
            clientWidth: scroller.clientWidth,
            scrollWidth: scroller.scrollWidth,
            clientHeight: scroller.clientHeight,
            scrollHeight: scroller.scrollHeight
          } : null,
          sectionRect: rect(section),
          scrollerRect: rect(scroller)
        };
      })(),
      notices: Array.from(dialog.querySelectorAll('.ui-inline-notice')).map((notice) => ({
        tone: notice.getAttribute('data-ui-tone') || '',
        text: String(notice.textContent || '').replace(/\\s+/g, ' ').trim()
      })),
      submit: submit ? {
        text: String(submit.textContent || '').replace(/\\s+/g, ' ').trim(),
        disabled: submit.disabled,
        selectorStable: submit.matches('.commerce-set-submit'),
        backgroundColor: submitStyle?.backgroundColor || '',
        borderColor: submitStyle?.borderColor || '',
        color: submitStyle?.color || '',
        cursor: submitStyle?.cursor || '',
        opacity: submitStyle?.opacity || ''
      } : null,
      viewport: { width: innerWidth, height: innerHeight },
      dialogRect: rect(dialog),
      bodyRect: rect(body),
      footerRect: rect(footer),
      bodyScroll: body ? { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowX: body.scrollWidth > body.clientWidth + 1 } : null,
      dialogOverflowX: dialog.scrollWidth > dialog.clientWidth + 1,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1
    };
  })()`);
}

async function readGoalDialog() {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.goal-confirmation-dialog');
    if (!dialog) return null;
    const footer = dialog.querySelector('.ui-surface-footer');
    const box = dialog.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    return {
      text: String(dialog.textContent || '').replace(/\\s+/g, ' ').trim(),
      scope: String(dialog.querySelector('.goal-confirmation-scope strong')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      requests: String(dialog.querySelector('.goal-confirmation-scope span')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      policies: Array.from(dialog.querySelectorAll('.goal-confirmation-policy li')).map((item) => String(item.textContent || '').replace(/\\s+/g, ' ').trim()),
      dialogRect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      footerRect: footerBox ? { left: footerBox.left, top: footerBox.top, right: footerBox.right, bottom: footerBox.bottom, width: footerBox.width, height: footerBox.height } : null,
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  })()`);
}

async function readPendingCommercePlan() {
  const pending = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.();
    const confirmation = state?.goalConfirmation;
    const taskScope = confirmation?.taskScope || state?.lastDispatchedTaskScope;
    const prompt = confirmation?.prompt || state?.lastDispatchedPrompt || '';
    if (!prompt || !taskScope) return null;
    return {
      phase: confirmation ? 'confirmation' : 'dispatched',
      prompt,
      targetNodeIds: confirmation?.targetNodeIds || taskScope.sourceNodeIds || [],
      operationsPerAsset: confirmation?.operationsPerAsset || taskScope.goal?.operationsPerAsset || 0,
      requestCount: confirmation?.requestCount || taskScope.goal?.requestCount || 0,
      taskScope,
      taskScopeGoal: taskScope.goal || null
    };
  })()`);
  if (!pending) return null;
  return {
    ...pending,
    promptPlan: jsonObjectAfterMarker(pending.prompt, "COMMERCE_SET_PLAN_JSON:")
  };
}

async function scrollCommerceBody(position) {
  await evaluate(client, `(() => {
    const body = document.querySelector('.commerce-set-body');
    if (!body) return false;
    if (${JSON.stringify(position)} === 'top') body.scrollTop = 0;
    else if (${JSON.stringify(position)} === 'bottom') body.scrollTop = body.scrollHeight;
    else document.querySelector(${JSON.stringify(position)})?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  await delay(180);
}

async function seedAndSelect(count) {
  const result = await evaluate(client, `(async () => {
    const seeded = await window.__naimageAIDebug.seedCanvas({ count: ${Number(count)}, fileBacked: true });
    const ids = (seeded?.state?.nodes || []).filter((node) => node.type === 'image').slice(-${Number(count)}).map((node) => node.id);
    await window.__naimageAIDebug.selectNodes({ ids, primaryId: ids[0] });
    await window.__naimageAIDebug.fitCanvas();
    return { ids, state: window.__naimageDebugAgentState() };
  })()`, 30_000);
  assert.equal(result?.ids?.length, count, `Expected ${count} seeded sources`);
  await waitFor(`document.querySelector('[data-plugin-command="sparkai.commerce-toolkit.generate-listing-set"]')?.disabled === false`);
  return result;
}

async function openCommerce(command) {
  const selector = `[data-plugin-command="${command}"]`;
  assert.equal(await clickSelector(selector), true, `Toolbar command unavailable: ${command}`);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog'))", 12_000);
  return readCommerceDialog();
}

async function closeCommerce() {
  if (!(await evaluate(client, "Boolean(document.querySelector('.commerce-set-dialog'))"))) return;
  assert.equal(await clickSelector(".commerce-set-dialog .ui-surface-footer button", "取消"), true);
  await waitFor("!document.querySelector('.commerce-set-dialog')");
}

async function cancelGoal() {
  assert.equal(await clickSelector(".goal-confirmation-dialog .ui-surface-footer button", "取消"), true);
  await waitFor("!document.querySelector('.goal-confirmation-dialog')");
}

async function submitCommerceToGoal() {
  const previousSnapshotHash = await evaluate(client, "window.__naimageDebugAgentState?.().lastDispatchedTaskScope?.snapshotHash || ''");
  assert.equal(await clickSelector(".commerce-set-submit"), true);
  await waitFor(`!document.querySelector('.commerce-set-dialog')
    && window.__naimageDebugAgentState?.().lastDispatchedTaskScope?.origin === 'goal'
    && window.__naimageDebugAgentState?.().lastDispatchedTaskScope?.snapshotHash !== ${JSON.stringify(previousSnapshotHash)}
    && window.__naimageDebugAgentState?.().lastDispatchedPrompt?.includes('[NAIMAGE_COMMERCE_SET_V1]')`, 20_000);
  await delay(260);
  return readPendingCommercePlan();
}

async function confirmGoal() {
  assert.equal(await clickSelector(".goal-confirmation-dialog .ui-surface-footer button", "冻结并执行"), true);
  await waitFor("!document.querySelector('.goal-confirmation-dialog')", 12_000);
}

async function ensureAgentIdle() {
  const idleSoon = await (async () => {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      if (await evaluate(client, "window.__naimageDebugAgentState?.().agentExecutionBusy !== true")) return true;
      await delay(120);
    }
    return false;
  })();
  if (idleSoon) return true;
  const stopPresent = await evaluate(client, "document.querySelector('.project-agent-stop') instanceof HTMLButtonElement && !document.querySelector('.project-agent-stop').disabled");
  if (stopPresent) {
    await clickSelector(".project-agent-stop");
    await waitFor("Boolean(document.querySelector('.confirm-dialog'))", 5_000);
    await clickSelector(".confirm-dialog button", "确认结束");
  }
  await waitFor("window.__naimageDebugAgentState?.().agentExecutionBusy !== true", 20_000, 120);
  return true;
}

async function requirementNodes() {
  return evaluate(client, `(() => Array.from(document.querySelectorAll('.flow-node.requirement-node')).map((node) => ({
    id: node.getAttribute('data-node-id') || '',
    title: String(node.querySelector('.node-title')?.textContent || node.textContent || '').replace(/\\s+/g, ' ').trim(),
    skill: node.classList.contains('skill-node'),
    text: String(node.textContent || '').replace(/\\s+/g, ' ').trim()
  })))()`);
}

async function chooseSaveTarget(target, name) {
  const label = target === "skill" ? "Skill 节点" : "需求节点";
  assert.equal(await clickSelector(".commerce-set-save-control button", label), true);
  const selector = ".commerce-set-section[aria-labelledby='commerce-set-save-title'] .ui-field input";
  await replaceText(selector, name);
}

async function selectFirstLanguages(count) {
  for (let index = 0; index < count; index += 1) {
    const selector = `.commerce-language-option:nth-child(${index + 1})`;
    const checked = await evaluate(client, `document.querySelector(${JSON.stringify(`${selector} input`)})?.checked === true`);
    if (!checked) assert.equal(await clickSelector(selector), true, `Language option ${index + 1} unavailable`);
  }
}

async function main() {
  prepareProjectFixture();
  recordObservation("info", "suite-checkpoint", { label: "bootstrap:prepare-run", runDir, mode: "commerce-set-suite" });
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
  writeFileSync(join(configDir, "app-settings.json"), `${JSON.stringify({
    theme: "light",
    themePalette: "anthropic",
    agentPanelPlacement: "right",
    agentPanelWidth: 360,
    imageBatchSize: 10,
    pluginStates: [commercePluginState]
  }, null, 2)}\n`, "utf8");

  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;
  const viteLog = createWriteStream(join(runDir, "vite.log"));
  const electronLog = createWriteStream(join(runDir, "electron-process.log"));

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  viteProcess.stdout?.pipe(viteLog);
  viteProcess.stderr?.pipe(viteLog);
  await waitForHttpServer(devUrl, { attempts: 160, intervalMs: 100, errorMessage: "Commerce AIDebug Vite server did not start." });

  electronProcess = spawn(
    process.execPath,
    [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"],
    {
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
        NAIMAGE_CONFIG_DIR: configDir,
        NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log")
      }
    }
  );
  electronProcess.stdout?.pipe(electronLog);
  electronProcess.stderr?.pipe(electronLog);

  target = await pollForDebugTarget({
    port: debugPort,
    attempts: 200,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Commerce AIDebug renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitFor(
    "Boolean(window.__naimageAIDebug?.seedCanvas && window.__naimageAIDebug?.selectNodes && document.querySelector('.canvas-plugin-toolbar'))",
    20_000,
    100
  );
  const initialViewport = await evaluate(client, "({ width: innerWidth, height: innerHeight })");

  const toolbar = await readToolbar();
  const commerceToolbarButtons = toolbar.buttons.filter((item) => item.command.startsWith("sparkai.commerce-toolkit"));
  assert.deepEqual(commerceToolbarButtons.map((item) => item.text), ["SKU 商品素材库", "平台导出中心", "套图模板市场", "A/B 方案比较", "一键生成套图", "一键多国语言"]);
  assert.deepEqual(commerceToolbarButtons.map((item) => item.disabled), [false, false, false, false, true, true]);
  assert.deepEqual(
    commerceToolbarButtons.map((item) => item.ariaKeyShortcuts),
    [
      "Control+Shift+5 Meta+Shift+5",
      "Control+Shift+6 Meta+Shift+6",
      "Control+Shift+7 Meta+Shift+7",
      "Control+Shift+8 Meta+Shift+8",
      "Control+Shift+1 Meta+Shift+1",
      "Control+Shift+2 Meta+Shift+2"
    ]
  );
  assert(commerceToolbarButtons.every((item) => item.title.includes("Ctrl/⌘ + Shift")));
  assert.equal(toolbar.mode, "expanded");
  assert.equal(toolbar.expanded, true);
  assert.equal(toolbar.actionsVisible, true);
  assert.equal(toolbar.position, "absolute");
  assert(toolbar.centerDelta <= 2);
  assert(toolbar.bottomGap >= 10 && toolbar.bottomGap <= 14);
  assert.equal(toolbar.footerOverlapArea, 0);
  assert(toolbar.borderRadius >= 10);
  assert.equal(toolbar.pinPresent, true);
  assert.equal(toolbar.bodyOverflowX, false);
  assert.equal(toolbar.documentOverflowX, false);
  checks.toolbarAsLaunched = { ok: true, toolbar };
  await capture("00-toolbar-as-launched");

  assert.equal(await clickSelector(".canvas-plugin-toolbar-pin"), true);
  await movePointer({ x: 2, y: 2 });
  await waitFor("document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-toolbar-mode') === 'hover' && document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'false' && getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).visibility === 'hidden'");
  const collapsedToolbar = await readToolbar();
  assert.equal(collapsedToolbar.actionsVisible, false);
  assert.equal(collapsedToolbar.triggerPresent, true);
  assert(collapsedToolbar.buttons.every((item) => item.tabIndex === -1));
  const storedHoverMode = await evaluate(client, "window.naimageConfig.loadSettings()");
  assert.equal(storedHoverMode?.settings?.canvasToolDockMode, "hover");
  checks.toolbarHoverCollapsed = { ok: true, collapsedToolbar, storedMode: storedHoverMode.settings.canvasToolDockMode };
  await capture("00a-toolbar-hover-collapsed");

  await movePointer(await pointForSelector(".canvas-plugin-toolbar-trigger"));
  await waitFor("document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'true' && getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).visibility === 'visible' && Number(getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).opacity) > 0.9 && document.querySelector('.canvas-plugin-toolbar-actions').clientWidth > 0");
  const hoverExpandedToolbar = await readToolbar();
  assert.equal(hoverExpandedToolbar.actionsVisible, true);
  await movePointer({ x: 2, y: 2 });
  await waitFor("document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'false' && getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).visibility === 'hidden'");
  await evaluate(client, "document.querySelector('.canvas-plugin-toolbar-trigger')?.focus(); undefined");
  await waitFor("document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'true' && getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).visibility === 'visible' && Number(getComputedStyle(document.querySelector('.canvas-plugin-toolbar-actions')).opacity) > 0.9 && document.querySelector('.canvas-plugin-toolbar-actions').clientWidth > 0");
  const focusExpandedToolbar = await readToolbar();
  assert.equal(focusExpandedToolbar.actionsVisible, true);
  assert(focusExpandedToolbar.buttons.every((item) => item.tabIndex === 0));
  checks.toolbarHoverAndFocusExpanded = { ok: true, hoverExpandedToolbar, focusExpandedToolbar };
  await capture("00b-toolbar-hover-expanded");
  assert.equal(await clickSelector(".canvas-plugin-toolbar-pin"), true);
  await waitFor("document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-toolbar-mode') === 'expanded' && document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'true'");

  const twoSources = await seedAndSelect(2);
  await dispatchCanvasToolShortcut(1);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog'))", 12_000);
  const shortcutGeneration = await readCommerceDialog();
  assert.equal(shortcutGeneration?.title, "跨境电商套图生成计划");
  await dispatchCanvasToolShortcut(2);
  const shortcutBlockedByDialog = await readCommerceDialog();
  assert.equal(shortcutBlockedByDialog?.title, "跨境电商套图生成计划");
  checks.toolbarShortcuts = { ok: true, shortcutGeneration: shortcutGeneration.title, dialogBlocker: shortcutBlockedByDialog.title };
  assert.equal(shortcutGeneration?.platformButtons.find((item) => item.active)?.text, "通用电商");
  assert.equal(await clickSelector(".commerce-set-platform-control button", "Amazon"), true);
  await waitFor("document.querySelectorAll('.commerce-set-slot-card').length === 7 && document.querySelector('.commerce-set-slot-card textarea')?.value.includes('纯白背景') === true");
  const amazonTemplate = await readCommerceDialog();
  assert.equal(amazonTemplate?.platformButtons.find((item) => item.active)?.text, "Amazon");
  assert.equal(amazonTemplate?.slotCount, 7);
  assert.match(amazonTemplate?.platformSummary || "", /7 张默认套图/);
  assert.equal(await clickSelector(".commerce-set-platform-control button", "速卖通"), true);
  await waitFor("document.querySelectorAll('.commerce-set-slot-card').length === 8 && document.querySelector('.commerce-set-slot-card input')?.value.includes('速卖通') === true");
  const aliexpressTemplate = await readCommerceDialog();
  assert.equal(aliexpressTemplate?.platformButtons.find((item) => item.active)?.text, "速卖通");
  assert.equal(aliexpressTemplate?.slotCount, 8);
  assert.match(aliexpressTemplate?.platformSummary || "", /8 张默认套图/);
  checks.platformTemplates = { ok: true, amazonTemplate, aliexpressTemplate };
  await scrollCommerceBody("top");
  await capture("00c-aliexpress-platform-template");
  assert.equal(await clickSelector(".commerce-set-platform-control button", "Amazon"), true);
  await waitFor("document.querySelectorAll('.commerce-set-slot-card').length === 7");
  await replaceText(".commerce-set-slot-heading input[type='number']", "3");
  await replaceText(".commerce-set-slot-card:nth-child(1) textarea", "主图：纯色背景，保留商品轮廓、Logo 与包装文字。");
  await replaceText(".commerce-set-slot-card:nth-child(2) textarea", "卖点图：只呈现来源可确认的三个核心特点。");
  await replaceText(".commerce-set-slot-card:nth-child(3) textarea", "细节图：展示真实材质、接口与工艺特写。");
  await scrollCommerceBody("top");
  const generation = await readCommerceDialog();
  assert.equal(generation.summary["母图数"], "2");
  assert.equal(generation.summary["每组张数"], "3");
  assert.equal(generation.summary["结果组"], "2");
  assert.equal(generation.summary["总请求"], "6");
  assert.equal(generation.slotCount, 3);
  assert.equal(generation.platformButtons.find((item) => item.active)?.text, "Amazon");
  assert.deepEqual(generation.slotPrompts, [
    "主图：纯色背景，保留商品轮廓、Logo 与包装文字。",
    "卖点图：只呈现来源可确认的三个核心特点。",
    "细节图：展示真实材质、接口与工艺特写。"
  ]);
  assert.equal(generation.submit?.selectorStable, true);
  assert.equal(generation.submit?.text, "确认并执行 6 个请求");
  assert.equal(generation.submit?.disabled, false);
  assert(generation.notices.some((notice) => notice.text.includes("先串行测试最多 2 个不同母图") && notice.text.includes("每波最多翻倍")));
  checks.twoSourceMatrix = { ok: true, sourceIds: twoSources.ids, generation };
  await capture("01-generate-two-sources-three-slots");
  assert.equal(await clickSelector(".commerce-set-dialog .ui-surface-footer button", "保存到模板市场"), true);
  await waitFor("Array.from(document.querySelectorAll('.commerce-set-dialog .ui-inline-notice')).some((notice) => notice.textContent?.includes('已保存到模板市场'))", 12_000);
  const savedTemplateNotice = await evaluate(client, `(() => String(Array.from(document.querySelectorAll('.commerce-set-dialog .ui-inline-notice')).find((notice) => notice.textContent?.includes('已保存到模板市场'))?.textContent || '').replace(/\\s+/g, ' ').trim())()`);
  assert.match(savedTemplateNotice, /已保存到模板市场/);
  checks.templateSavedFromWizard = { ok: true, notice: savedTemplateNotice, slotCount: generation.slotCount };

  assert.equal(await clickSelector(".commerce-set-mode-control button", "翻译现有套图"), true);
  await waitFor("document.querySelector('.commerce-set-dialog .ui-surface-heading h2')?.textContent?.includes('翻译计划') === true");
  await replaceText(".commerce-set-section[aria-labelledby='commerce-set-translate-title'] textarea", "仅翻译可见文案，品牌、SKU、数字与单位保持不变；阿拉伯语使用 RTL 排版。");
  assert.equal(await clickSelector(".commerce-language-prompts > summary"), true);
  await replaceText(".commerce-language-prompts .ui-field:first-child textarea", "采用自然美式电商英语，标题简洁，不能新增卖点。");
  const sourceOneCellPrompt = "第一张母图：只翻译顶部标题，底部尺寸单位保留英文。";
  const sourceTwoCellPrompt = "第二张母图：包装正面的技术参数保持原文，不新增角标。";
  assert.equal(await clickSelector(".commerce-translation-matrix tbody tr:nth-child(1) td:nth-of-type(1) button"), true);
  await waitFor("Boolean(document.querySelector('.commerce-translation-cell-editor textarea'))");
  await replaceText(".commerce-translation-cell-editor textarea", sourceOneCellPrompt);
  assert.equal(await clickSelector(".commerce-translation-matrix tbody tr:nth-child(2) td:nth-of-type(2) button"), true);
  await replaceText(".commerce-translation-cell-editor textarea", sourceTwoCellPrompt);
  await chooseSaveTarget("requirement", "五国语言商品图本地化");
  const translation = await readCommerceDialog();
  assert.equal(translation.title, "跨境电商套图翻译计划");
  assert.equal(translation.summary["母图数"], "2");
  assert.equal(translation.summary["每组张数"], "2");
  assert.equal(translation.summary["结果组"], "5");
  assert.equal(translation.summary["总请求"], "10");
  assert.equal(translation.selectedLanguages.length, 5);
  assert.equal(translation.languagePromptCount, 5);
  assert.equal(translation.translationMatrix?.sourceRows, 2);
  assert.equal(translation.translationMatrix?.localeCodes.length, 5);
  assert.equal(translation.translationMatrix?.customizedCount, 2);
  assert.equal(translation.translationMatrix?.cells.filter((cell) => cell.custom).length, 2);
  assert.equal(translation.translationMatrix?.cells.filter((cell) => cell.custom).every((cell) => cell.text.includes("有逐项要求")), true);
  checks.modeSwitchAndLanguagePrompts = { ok: true, translation };
  await capture("02-translate-mode-with-prompts");

  await scrollCommerceBody(".commerce-translation-matrix-section");
  const translationMatrixDesktop = await readCommerceDialog();
  assert.equal(translationMatrixDesktop.translationMatrix?.customizedCount, 2);
  checks.translationMatrixCells = { ok: true, translationMatrixDesktop };
  await capture("02a-translation-matrix-cells");

  const translationSmallWindow = await setWindowSize(900, 640);
  await scrollCommerceBody(".commerce-translation-matrix-section");
  const translationMatrixSmall = await readCommerceDialog();
  assert(Math.abs(translationMatrixSmall.viewport.width - 900) <= 2 && Math.abs(translationMatrixSmall.viewport.height - 640) <= 2);
  assert.equal(translationMatrixSmall.documentOverflowX, false);
  assert.equal(translationMatrixSmall.bodyOverflowX, false);
  assert.equal(translationMatrixSmall.dialogOverflowX, false);
  assert.equal(translationMatrixSmall.bodyScroll?.overflowX, false);
  assert(translationMatrixSmall.translationMatrix?.scrollerRect.left >= translationMatrixSmall.bodyRect.left - 1);
  assert(translationMatrixSmall.translationMatrix?.scrollerRect.right <= translationMatrixSmall.bodyRect.right + 1);
  checks.translationMatrixSmallWindow = { ok: true, translationSmallWindow, translationMatrixSmall };
  await capture("02b-translation-matrix-900x640");
  await setWindowSize(initialViewport.width, initialViewport.height);
  await scrollCommerceBody("top");

  const beforeTranslationNodes = await requirementNodes();
  const pendingTranslation = await submitCommerceToGoal();
  const expectedTranslationItems = [
    { sourceIndex: 0, localeCode: translation.translationMatrix.localeCodes[0], prompt: sourceOneCellPrompt },
    { sourceIndex: 1, localeCode: translation.translationMatrix.localeCodes[1], prompt: sourceTwoCellPrompt }
  ];
  assert.equal(pendingTranslation?.phase, "dispatched");
  assert.deepEqual(pendingTranslation?.promptPlan?.translationItems, expectedTranslationItems);
  assert.equal(pendingTranslation?.promptPlan?.sourceCount, 2);
  assert.equal(pendingTranslation?.promptPlan?.totalRequests, 10);
  assert.equal(pendingTranslation?.requestCount, 10);
  assert.equal(pendingTranslation?.operationsPerAsset, 5);
  assert.equal(pendingTranslation?.taskScopeGoal?.containerCount, 2);
  assert.equal(pendingTranslation?.taskScopeGoal?.bindingCount, 2);
  assert.equal(pendingTranslation?.taskScopeGoal?.probeContainerCount, 2);
  assert.equal(pendingTranslation?.taskScopeGoal?.commercePlanHash, pendingTranslation?.promptPlan?.planHash);
  checks.finalModeDrivesGoal = {
    ok: true,
    pendingPlan: {
      planHash: pendingTranslation.promptPlan.planHash,
      planMaterialHash: pendingTranslation.promptPlan.planMaterialHash,
      sourceCount: pendingTranslation.promptPlan.sourceCount,
      totalRequests: pendingTranslation.promptPlan.totalRequests,
      translationItems: pendingTranslation.promptPlan.translationItems,
      goalCommercePlanHash: pendingTranslation.taskScopeGoal.commercePlanHash
    }
  };
  await waitFor(`document.querySelectorAll('.flow-node.requirement-node:not(.skill-node)').length === ${beforeTranslationNodes.length + 1}`, 15_000, 100);
  assert.equal(await evaluate(client, "Boolean(document.querySelector('.goal-confirmation-dialog'))"), false);
  const afterTranslationNodes = await requirementNodes();
  checks.directDispatch = {
    ok: true,
    confirmationDialogOpen: false,
    requirementNodesBefore: beforeTranslationNodes.length,
    requirementNodesAfter: afterTranslationNodes.length
  };
  await capture("03-translation-direct-dispatch");
  await ensureAgentIdle();

  await evaluate(client, `(async () => {
    await window.__naimageAIDebug.selectNodes({ ids: ${JSON.stringify(twoSources.ids)}, primaryId: ${JSON.stringify(twoSources.ids[0])} });
    return true;
  })()`);
  await waitFor("document.querySelector('[data-plugin-command=\"sparkai.commerce-toolkit.translate-listing-set\"]')?.disabled === false");
  await dispatchCanvasToolShortcut(2);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog'))", 12_000);
  const directTranslation = await readCommerceDialog();
  assert.equal(directTranslation.title, "跨境电商套图翻译计划");
  assert(directTranslation.modeButtons.find((item) => item.text.includes("翻译现有套图"))?.active);
  checks.directTranslationToolbar = { ok: true, directTranslation };
  await closeCommerce();

  await seedAndSelect(1);
  await openCommerce("sparkai.commerce-toolkit.generate-listing-set");
  await replaceText(".commerce-set-slot-heading input[type='number']", "3");
  await chooseSaveTarget("requirement", "Amazon 三图商品套装");
  const requirementDispatch = await submitCommerceToGoal();
  assert.equal(requirementDispatch?.taskScopeGoal?.requestCount, 3);
  await waitFor("document.querySelectorAll('.flow-node.requirement-node:not(.skill-node)').length === 1", 15_000, 100);
  await evaluate(client, "window.__naimageAIDebug.fitCanvas(); undefined");
  await delay(400);
  const requirement = await requirementNodes();
  assert.equal(requirement.length, 1);
  assert.equal(requirement[0].skill, false);
  assert(requirement[0].text.includes("Amazon 三图商品套装"));
  checks.requirementCreatedAfterDispatch = { ok: true, requirement, planHash: requirementDispatch.promptPlan.planHash };
  await capture("04-requirement-node");
  await ensureAgentIdle();

  assert.equal(await clickSelector(`.flow-node.requirement-node[data-node-id="${requirement[0].id}"] button`, "执行需求"), true);
  await waitFor("Boolean(document.querySelector('.goal-confirmation-dialog'))", 12_000);
  await delay(260);
  const rerunGoal = await readGoalDialog();
  assert.equal(rerunGoal.requests, "最多 3 次图片请求");
  checks.reusableRerunUsesGoal = { ok: true, rerunGoal };
  await capture("05-requirement-rerun-goal");
  await cancelGoal();

  await seedAndSelect(1);
  await openCommerce("sparkai.commerce-toolkit.generate-listing-set");
  await replaceText(".commerce-set-slot-heading input[type='number']", "1");
  await chooseSaveTarget("skill", "跨境商品主图 Skill");
  const skillDispatch = await submitCommerceToGoal();
  assert.equal(skillDispatch?.taskScopeGoal?.requestCount, 1);
  await waitFor("document.querySelectorAll('.flow-node.requirement-node.skill-node').length === 1", 15_000, 100);
  await evaluate(client, "window.__naimageAIDebug.fitCanvas(); undefined");
  await delay(400);
  const skillNodes = await requirementNodes();
  assert.equal(skillNodes.length, 1);
  assert.equal(skillNodes[0].skill, true);
  assert(skillNodes[0].text.includes("跨境商品主图 Skill"));
  checks.skillCreatedAfterDispatch = { ok: true, skillNodes };
  await capture("06-skill-node");
  await ensureAgentIdle();

  await seedAndSelect(1);
  await openCommerce("sparkai.commerce-toolkit.generate-listing-set");
  const staleBefore = await requirementNodes();
  const deleted = await evaluate(client, "window.__naimageAIDebug.deleteSelectedNodes()");
  assert.equal(deleted?.ok, true);
  assert.equal(await clickSelector(".commerce-set-submit"), true);
  await delay(500);
  const stale = await evaluate(client, `(() => ({
    dialogOpen: Boolean(document.querySelector('.commerce-set-dialog')),
    goalOpen: Boolean(document.querySelector('.goal-confirmation-dialog')),
    busy: window.__naimageDebugAgentState?.().agentExecutionBusy === true,
    messageVisible: document.body.innerText.includes('套图配置期间母图范围已发生变化'),
    bodyText: document.body.innerText.slice(-1200)
  }))()`);
  assert.equal(stale.dialogOpen, true);
  assert.equal(stale.goalOpen, false);
  assert.equal(stale.busy, false);
  assert.equal(stale.messageVisible, true);
  const staleDialog = await readCommerceDialog();
  assert.equal(staleDialog?.submit?.disabled, true);
  assert.equal(staleDialog?.submit?.text, "来源已变化，请重新配置");
  assert.equal(staleDialog?.submit?.cursor, "not-allowed");
  assert.equal(staleDialog?.submit?.opacity, "1");
  assert.notEqual(staleDialog?.submit?.backgroundColor, generation.submit?.backgroundColor);
  assert.notEqual(staleDialog?.submit?.borderColor, generation.submit?.borderColor);
  assert.deepEqual(await requirementNodes(), staleBefore);
  checks.staleSourceRejected = { ok: true, stale, staleDialog };
  await capture("07-stale-source-rejected");
  await closeCommerce();

  const fileSeed = await seedAndSelect(2);
  const sourcePaths = fileSeed.state.nodes.filter((node) => node.type === "image").slice(-2).map((node) => node.assets?.[0]?.path).filter(Boolean);
  assert.equal(sourcePaths.length, 2);
  const container = await evaluate(client, `(async () => {
    const created = await window.__naimageDebugCreateImageContainer({ worldX: 1180, worldY: 180, role: 'source' });
    const imported = await window.__naimageDebugImportPathsToCanvas({ paths: ${JSON.stringify(sourcePaths)}, targetContainerId: created.id });
    await window.__naimageAIDebug.selectNodes({ ids: [created.id], primaryId: created.id });
    await window.__naimageAIDebug.fitCanvas();
    window.__naimageAIDebug.resumeLayoutRefocus();
    return { created, imported, state: window.__naimageDebugAgentState() };
  })()`, 30_000);
  assert.equal(container?.imported?.ok, true);
  await waitForRuntimeExpression(
    client,
    `Boolean(document.querySelector('.flow-node:not(.canvas-node-overview)[data-node-id="' + CSS.escape(${JSON.stringify(container.created.id)}) + '"] .node-image-preview'))`,
    { evaluate, timeoutMs: 4_000, intervalMs: 80 }
  );
  const containerRounding = await readImageContainerRounding(container.created.id);
  assert.equal(containerRounding.nodePresent, true);
  assert.equal(containerRounding.previewPresent, true);
  assert.equal(containerRounding.tilePresent, true);
  assert.equal(containerRounding.imagePresent, true);
  assert(containerRounding.nodeRadius >= 10);
  assert(containerRounding.previewRadius >= 8);
  assert(containerRounding.tileRadius >= 6);
  assert(containerRounding.imageRadius >= 6);
  assert.equal(containerRounding.nodeOverflow, "visible");
  checks.roundedImageContainer = { ok: true, containerId: container.created.id, containerRounding };
  await capture("08a-rounded-image-container");
  await openCommerce("sparkai.commerce-toolkit.generate-listing-set");
  await replaceText(".commerce-set-slot-heading input[type='number']", "1");
  const containerDialog = await readCommerceDialog();
  assert.equal(containerDialog.summary["母图数"], "2");
  const containerDispatch = await submitCommerceToGoal();
  assert.equal(containerDispatch?.taskScopeGoal?.containerCount, 1);
  assert.equal(containerDispatch?.taskScopeGoal?.bindingCount, 2);
  assert.equal(containerDispatch?.taskScopeGoal?.requestCount, 2);
  assert.equal(containerDispatch?.promptPlan?.executionPolicy?.probeSourceCount, 2);
  checks.singleContainerDifferentMotherProbe = { ok: true, containerId: container.created.id, containerDispatch };
  await capture("08-container-two-assets-goal");
  await ensureAgentIdle();

  await seedAndSelect(2);
  await openCommerce("sparkai.commerce-toolkit.generate-listing-set");
  await replaceText(".commerce-set-slot-heading input[type='number']", "10");
  await selectFirstLanguages(10);
  await scrollCommerceBody("top");
  const exact200 = await readCommerceDialog();
  assert.equal(exact200.summary["总请求"], "200");
  assert.equal(exact200.slotCount, 10);
  assert.equal(exact200.selectedLanguages.length, 10);
  assert.equal(exact200.disabledLanguages, 4);
  assert.equal(exact200.submit?.disabled, false);
  assert.equal(exact200.submit?.text, "确认并执行 200 个请求");
  assert(exact200.notices.some((notice) => notice.tone === "warning" && notice.text.includes("请求量较高")));
  checks.exact200Allowed = { ok: true, exact200 };
  await capture("09-exact-200");

  await replaceText(".commerce-set-slot-heading input[type='number']", "12");
  await scrollCommerceBody("top");
  const overLimit = await readCommerceDialog();
  assert.equal(overLimit.summary["总请求"], "240");
  assert.equal(overLimit.slotCount, 12);
  assert.equal(overLimit.submit?.disabled, true);
  assert.equal(overLimit.submit?.text, "超过 200 请求上限");
  assert.equal(overLimit.submit?.cursor, "not-allowed");
  assert.equal(overLimit.submit?.opacity, "1");
  assert.notEqual(overLimit.submit?.backgroundColor, exact200.submit?.backgroundColor);
  assert.notEqual(overLimit.submit?.borderColor, exact200.submit?.borderColor);
  assert(overLimit.notices.some((notice) => notice.tone === "danger" && notice.text.includes("超过单次 200 个")));
  checks.overLimitBlocked = { ok: true, overLimit };
  await capture("10-over-limit-240-top");

  await scrollCommerceBody(".commerce-set-slot-card:nth-child(12)");
  const lastSlot = await evaluate(client, `(() => {
    const card = document.querySelector('.commerce-set-slot-card:nth-child(12)');
    const body = document.querySelector('.commerce-set-body');
    if (!card || !body) return null;
    const cardRect = card.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      visible: cardRect.bottom > bodyRect.top && cardRect.top < bodyRect.bottom,
      cardRect: { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, width: cardRect.width, height: cardRect.height },
      bodyRect: { left: bodyRect.left, top: bodyRect.top, right: bodyRect.right, bottom: bodyRect.bottom, width: bodyRect.width, height: bodyRect.height },
      promptLength: card.querySelector('textarea')?.value.length || 0
    };
  })()`);
  assert.equal(lastSlot?.visible, true);
  assert(lastSlot.promptLength > 20);
  checks.twelveSlotsReachable = { ok: true, lastSlot };
  await capture("11-twelve-slots-reachable");

  await scrollCommerceBody("bottom");
  const bottomRisk = await readCommerceDialog();
  assert.equal(bottomRisk.submit?.disabled, true);
  assert.equal(bottomRisk.submit?.text, "超过 200 请求上限");
  assert.equal(bottomRisk.notices.filter((notice) => notice.tone === "danger").length, 1);
  await capture("12-over-limit-warning");

  const smallWindow = await setWindowSize(900, 640);
  await scrollCommerceBody("bottom");
  const small = await readCommerceDialog();
  const rectWithin = (rect, viewport) => Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1);
  assert(Math.abs(small.viewport.width - 900) <= 2 && Math.abs(small.viewport.height - 640) <= 2);
  assert.equal(rectWithin(small.dialogRect, small.viewport), true);
  assert.equal(rectWithin(small.footerRect, small.viewport), true);
  assert.equal(small.documentOverflowX, false);
  assert.equal(small.bodyOverflowX, false);
  assert.equal(small.dialogOverflowX, false);
  assert.equal(small.bodyScroll?.overflowX, false);
  assert.equal(small.submit?.disabled, true);
  assert.equal(small.submit?.text, "超过 200 请求上限");
  assert.equal(small.submit?.opacity, "1");
  checks.smallWindowFit = { ok: true, smallWindow, small };
  await capture("13-small-window-900x640");
  await closeCommerce();

  assert.equal(await clickSelector('[data-plugin-command="sparkai.commerce-toolkit.open-template-market"]'), true);
  await waitFor("document.querySelectorAll('.commerce-template-row').length >= 3", 12_000);
  const templateMarket = await evaluate(client, `(() => {
    const dialog = document.querySelector('.commerce-template-dialog');
    const body = dialog?.querySelector('.commerce-template-body');
    const footer = dialog?.querySelector('.ui-surface-footer');
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialogRect: rect(dialog),
      bodyRect: rect(body),
      footerRect: rect(footer),
      builtIn: Array.from(dialog?.querySelectorAll('.commerce-template-row[data-source="built-in"]') || []).map((row) => String(row.textContent || '').replace(/\\s+/g, ' ').trim()),
      personal: Array.from(dialog?.querySelectorAll('.commerce-template-row[data-source="personal"]') || []).map((row) => String(row.textContent || '').replace(/\\s+/g, ' ').trim()),
      builtInDeleteButtons: dialog?.querySelectorAll('.commerce-template-row[data-source="built-in"] [aria-label^="删除套图模板"]').length || 0,
      personalDeleteButtons: dialog?.querySelectorAll('.commerce-template-row[data-source="personal"] [aria-label^="删除套图模板"]').length || 0,
      useButtons: Array.from(dialog?.querySelectorAll('.commerce-template-row .ui-action-button') || []).map((button) => String(button.textContent || '').trim()),
      overflowX: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1),
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  })()`);
  const rectWithinViewport = (rect, viewport) => Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1);
  assert.equal(templateMarket.builtIn.length, 2);
  assert.equal(templateMarket.personal.length, 1);
  assert.equal(templateMarket.builtInDeleteButtons, 0);
  assert.equal(templateMarket.personalDeleteButtons, 1);
  assert.equal(templateMarket.useButtons.length, 3);
  assert.equal(rectWithinViewport(templateMarket.dialogRect, templateMarket.viewport), true);
  assert.equal(rectWithinViewport(templateMarket.footerRect, templateMarket.viewport), true);
  assert.equal(templateMarket.overflowX, false);
  assert.equal(templateMarket.documentOverflowX, false);
  checks.templateMarket = { ok: true, templateMarket };
  await capture("13a-template-market-900x640");
  assert.equal(await clickSelector('.commerce-template-row[data-source="personal"] .ui-action-button', "使用"), true);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog')) && !document.querySelector('.commerce-template-dialog')", 12_000);
  const reusedTemplate = await readCommerceDialog();
  assert.equal(reusedTemplate?.slotCount, 3);
  assert.equal(reusedTemplate?.platformButtons.find((item) => item.active)?.text, "Amazon");
  assert.equal(reusedTemplate?.documentOverflowX, false);
  assert.equal(reusedTemplate?.bodyOverflowX, false);
  checks.templateReuse = { ok: true, reusedTemplate };
  await capture("13b-template-reuse-900x640");
  await closeCommerce();

  const abSources = await seedAndSelect(2);
  await delay(1_100);
  const abFixture = await evaluate(client, `(async () => {
    const state = window.__naimageAIDebug.state();
    const projectId = state.activeProjectId;
    const catalog = await window.naimageConfig.listCommerceCatalog({ expectedProjectId: projectId });
    if (!catalog?.ok) return { stage: 'list', ...catalog };
    const created = await window.naimageConfig.saveCommerceCatalogProduct({
      expectedProjectId: projectId,
      expectedCatalogRevision: catalog.catalogRevision,
      title: 'AIDebug A/B 商品',
      productCode: 'AB-001',
      platforms: ['amazon'],
      variants: [],
      skus: []
    });
    if (!created?.ok) return { stage: 'create', ...created };
    const assigned = await window.naimageConfig.assignCommerceCatalogAssets({
      expectedProjectId: projectId,
      expectedCatalogRevision: created.catalogRevision,
      productId: created.product.productId,
      expectedProductRevision: created.product.revision,
      kind: 'result',
      ownerType: 'product',
      role: 'amazon-main',
      assets: ${JSON.stringify(abSources.ids.map((nodeId) => ({ nodeId, assetIndex: 0 })))}
    });
    if (!assigned?.ok) return { stage: 'assign', ...assigned };
    const comparisons = await window.naimageConfig.listCommerceCatalogComparisons({ expectedProjectId: projectId, productId: created.product.productId });
    return { stage: 'ready', projectId, created, assigned, comparisons };
  })()`, 30_000);
  assert.equal(abFixture?.stage, "ready", JSON.stringify(abFixture));
  assert.equal(abFixture.comparisons?.groups?.length, 1);
  assert.equal(abFixture.comparisons.groups[0].candidates.length, 2);
  assert.equal(await clickSelector('[data-plugin-command="sparkai.commerce-toolkit.open-ab-comparison"]'), true);
  await waitFor("document.querySelectorAll('.commerce-ab-candidate').length === 2", 12_000);
  const readAbDialog = () => evaluate(client, `(() => {
    const dialog = document.querySelector('.commerce-ab-dialog');
    const groupList = dialog?.querySelector('.commerce-ab-groups');
    const stage = dialog?.querySelector('.commerce-ab-stage');
    const footer = dialog?.querySelector('.ui-surface-footer');
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
    };
    const candidates = Array.from(dialog?.querySelectorAll('.commerce-ab-candidate') || []).map((card) => {
      const image = card.querySelector('img');
      const style = image ? getComputedStyle(image) : null;
      return {
        state: card.getAttribute('data-state') || '',
        selected: card.classList.contains('is-selected'),
        text: String(card.textContent || '').replace(/\\s+/g, ' ').trim(),
        rect: rect(card),
        imagePresent: image instanceof HTMLImageElement,
        objectFit: style?.objectFit || '',
        filter: style?.filter || ''
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialogRect: rect(dialog),
      groupListRect: rect(groupList),
      stageRect: rect(stage),
      footerRect: rect(footer),
      candidates,
      notice: String(dialog?.querySelector('.ui-inline-notice')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      overflowX: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1),
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  })()`);
  const abBefore = await readAbDialog();
  assert.equal(abBefore.candidates.length, 2);
  assert.equal(abBefore.candidates.every((candidate) => candidate.imagePresent), true);
  assert.equal(abBefore.candidates.every((candidate) => candidate.objectFit === "contain" && candidate.filter === "none"), true);
  assert.equal(abBefore.candidates[0].rect.top, abBefore.candidates[1].rect.top);
  assert(abBefore.candidates[0].rect.right <= abBefore.candidates[1].rect.left + 1);
  assert(abBefore.groupListRect.right <= abBefore.stageRect.left + 1);
  assert.equal(rectWithinViewport(abBefore.dialogRect, abBefore.viewport), true);
  assert.equal(rectWithinViewport(abBefore.footerRect, abBefore.viewport), true);
  assert.equal(abBefore.overflowX, false);
  assert.equal(abBefore.documentOverflowX, false);
  checks.abComparison = { ok: true, fixture: { projectId: abFixture.projectId, productId: abFixture.created.product.productId }, abBefore };
  await capture("13c-ab-comparison-900x640");
  assert.equal(await clickSelector('.commerce-ab-candidate:nth-child(2) > button'), true);
  assert.equal(await clickSelector('.commerce-ab-dialog .ui-surface-footer button', "设为最终成果"), true);
  await waitFor("document.querySelectorAll('.commerce-ab-candidate[data-state=" + JSON.stringify("approved") + "]').length === 1 && document.querySelectorAll('.commerce-ab-candidate[data-state=" + JSON.stringify("rejected") + "]').length === 1", 12_000);
  const abAfter = await readAbDialog();
  assert.equal(abAfter.candidates.length, 2);
  assert.deepEqual(abAfter.candidates.map((candidate) => candidate.state).sort(), ["approved", "rejected"]);
  assert.match(abAfter.notice, /最终成果已选定/);
  checks.abWinner = { ok: true, abAfter };
  await capture("13d-ab-winner-900x640");
  assert.equal(await clickSelector('.commerce-ab-dialog .ui-surface-footer button', "关闭"), true);
  await waitFor("!document.querySelector('.commerce-ab-dialog')");

  assert.equal(await clickSelector(".app-settings-button"), true);
  await waitFor("Boolean(document.querySelector('.settings-drawer'))", 12_000);
  assert.equal(await clickSelector(".settings-section-tab", "工具"), true);
  await waitFor("Boolean(document.querySelector('[data-canvas-tool-command=\"sparkai.commerce-toolkit.generate-listing-set\"] input'))");
  const settingsBefore = await evaluate(client, `(() => ({
    mode: String(document.querySelector('.settings-canvas-tool-mode [aria-pressed="true"]')?.textContent || '').trim(),
    generateChecked: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.generate-listing-set"] input')?.checked === true,
    translationChecked: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] input')?.checked === true,
    translationShortcut: String(document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] [data-shortcut-recorder] kbd')?.textContent || '').trim()
  }))()`);
  assert.equal(settingsBefore.mode, "一直展开");
  assert.equal(settingsBefore.generateChecked, true);
  assert.equal(settingsBefore.translationChecked, true);
  assert.equal(settingsBefore.translationShortcut, "Ctrl/⌘ + Shift + 2");
  assert.equal(await clickSelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] [data-shortcut-recorder]'), true);
  await dispatchCanvasToolShortcut(1);
  await waitFor("document.querySelector('[data-canvas-tool-command=\"sparkai.commerce-toolkit.translate-listing-set\"] .settings-canvas-tool-feedback')?.getAttribute('data-tone') === 'danger'");
  const shortcutConflict = await evaluate(client, `(() => ({
    feedback: String(document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] .settings-canvas-tool-feedback')?.textContent || '').trim(),
    recording: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] [data-shortcut-recorder]')?.getAttribute('aria-pressed') === 'true'
  }))()`);
  assert.match(shortcutConflict.feedback, /一键生成套图.*冲突/);
  assert.equal(shortcutConflict.recording, true);
  await capture("14a-tool-shortcut-conflict");
  await dispatchCanvasToolShortcut(9, 3);
  await waitFor("String(document.querySelector('[data-canvas-tool-command=\"sparkai.commerce-toolkit.translate-listing-set\"] [data-shortcut-recorder] kbd')?.textContent || '').trim() === 'Ctrl/⌘ + Alt + 9'");
  assert.equal(await clickSelector(".settings-canvas-tool-mode button", "悬停展开"), true);
  assert.equal(await clickSelector('[data-canvas-tool-command="sparkai.commerce-toolkit.generate-listing-set"] input'), true);
  const settingsDraft = await evaluate(client, `(() => ({
    mode: String(document.querySelector('.settings-canvas-tool-mode [aria-pressed="true"]')?.textContent || '').trim(),
    generateChecked: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.generate-listing-set"] input')?.checked === true,
    generateShortcutDisabled: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.generate-listing-set"] [data-shortcut-recorder]')?.disabled === true,
    translationChecked: document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] input')?.checked === true,
    translationShortcut: String(document.querySelector('[data-canvas-tool-command="sparkai.commerce-toolkit.translate-listing-set"] [data-shortcut-recorder] kbd')?.textContent || '').trim()
  }))()`);
  assert.equal(settingsDraft.mode, "悬停展开");
  assert.equal(settingsDraft.generateChecked, false);
  assert.equal(settingsDraft.generateShortcutDisabled, false);
  assert.equal(settingsDraft.translationChecked, true);
  assert.equal(settingsDraft.translationShortcut, "Ctrl/⌘ + Alt + 9");
  checks.canvasToolSettingsDraft = { ok: true, settingsBefore, shortcutConflict, settingsDraft };
  await capture("14-tool-settings");
  assert.equal(await clickSelector(".settings-surface-footer button", "保存设置"), true);
  await waitFor("document.querySelector('.settings-surface-footer .ui-action-primary')?.disabled === true", 12_000);
  const storedToolSettings = await evaluate(client, "window.naimageConfig.loadSettings()");
  assert.equal(storedToolSettings?.settings?.canvasToolDockMode, "hover");
  assert.deepEqual(storedToolSettings?.settings?.disabledCanvasToolCommands, ["sparkai.commerce-toolkit.generate-listing-set"]);
  assert.deepEqual(storedToolSettings?.settings?.canvasToolShortcuts, {
    "sparkai.commerce-toolkit.translate-listing-set": "Mod+Alt+9"
  });
  assert.equal(await clickSelector(".settings-surface-footer button", "关闭"), true);
  await waitFor("!document.querySelector('.settings-drawer')");
  await movePointer({ x: 2, y: 2 });
  await waitFor(`!document.querySelector('[data-plugin-command="sparkai.commerce-toolkit.generate-listing-set"]')
    && Boolean(document.querySelector('[data-plugin-command="sparkai.commerce-toolkit.translate-listing-set"]'))
    && document.querySelector('.canvas-plugin-toolbar')?.getAttribute('data-expanded') === 'false'`, 12_000);
  const filteredToolbar = await readToolbar();
  assert.deepEqual(
    filteredToolbar.buttons.filter((item) => item.command.startsWith("sparkai.commerce-toolkit")).map((item) => item.command),
    [
      "sparkai.commerce-toolkit.open-sku-library",
      "sparkai.commerce-toolkit.open-export-center",
      "sparkai.commerce-toolkit.open-template-market",
      "sparkai.commerce-toolkit.open-ab-comparison",
      "sparkai.commerce-toolkit.translate-listing-set"
    ]
  );
  const customizedToolbarItem = filteredToolbar.buttons.find((item) => item.command === "sparkai.commerce-toolkit.translate-listing-set");
  assert.equal(customizedToolbarItem?.ariaKeyShortcuts, "Control+Alt+9 Meta+Alt+9");
  assert.match(customizedToolbarItem?.title || "", /Ctrl\/⌘ \+ Alt \+ 9/);
  await dispatchCanvasToolShortcut(1);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog'))", 12_000);
  const hiddenShortcutDialog = await readCommerceDialog();
  assert.equal(hiddenShortcutDialog?.title, "跨境电商套图生成计划");
  await closeCommerce();
  await dispatchCanvasToolShortcut(2);
  assert.equal(await evaluate(client, "Boolean(document.querySelector('.commerce-set-dialog'))"), false);
  await dispatchCanvasToolShortcut(9, 3);
  await waitFor("Boolean(document.querySelector('.commerce-set-dialog'))", 12_000);
  const enabledShortcutDialog = await readCommerceDialog();
  assert.equal(enabledShortcutDialog?.title, "跨境电商套图翻译计划");
  checks.canvasToolSettingsPersisted = {
    ok: true,
    stored: {
      canvasToolDockMode: storedToolSettings.settings.canvasToolDockMode,
      disabledCanvasToolCommands: storedToolSettings.settings.disabledCanvasToolCommands,
      canvasToolShortcuts: storedToolSettings.settings.canvasToolShortcuts
    },
    filteredToolbar,
    hiddenShortcutTitle: hiddenShortcutDialog.title,
    previousShortcutOpened: false,
    enabledShortcutTitle: enabledShortcutDialog.title
  };
  await capture("15-hidden-tool-shortcut");
  await closeCommerce();

  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "commerce-set-suite",
      suite: "commerce-set-gui",
      agentMode: "mock-agent",
      networkUsed: false
    },
    reportAfterObservations: { qaInventory, checks, screenshots },
    consoleAfterSummary: { checks: Object.keys(checks).length, screenshots: Object.keys(screenshots).length }
  });
  if (!report.ok || !Object.values(checks).every((item) => item?.ok === true)) {
    throw new Error("Commerce AIDebug report contains failed checks or visual scenes.");
  }
}

try {
  await main();
} catch (error) {
  const failure = {
    ok: false,
    suite: "commerce-set-gui",
    error: error instanceof Error ? error.stack || error.message : String(error),
    checks,
    screenshots,
    qaInventory,
    runDir
  };
  mkdirSync(runDir, { recursive: true });
  if (client) {
    try {
      await capture("failure-state");
    } catch {
      // Preserve the original failure.
    }
  }
  writeFileSync(join(runDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  throw error;
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
