import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BasicCdpClient, evaluateRuntime, pollForDebugTarget } from "./aidebug/harness/cdp.mjs";
import { capturePngScreenshot } from "./aidebug/harness/screenshot.mjs";

const TASK_SCOPE_VALUES = [
  "auto",
  "keep",
  "replace-source",
  "merge-source",
  "replace-reference",
  "merge-reference",
  "clear-attachments"
];

function captureHealthy(capture) {
  return Boolean(
    capture &&
    capture.stateIssues.length === 0 &&
    capture.captureIssues.length === 0 &&
    !capture.overflow.documentOverflowX &&
    !capture.overflow.bodyOverflowX &&
    capture.overflow.elementOverflowX.length === 0
  );
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function waitForAutomationEndpoint(configDir, timeoutMs = 12_000) {
  const endpointPath = join(configDir, "automation", "endpoint.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const endpoint = JSON.parse(readFileSync(endpointPath, "utf8"));
      if (endpoint?.host === "127.0.0.1" && Number(endpoint?.port) > 0 && String(endpoint?.token || "")) {
        return endpoint;
      }
    } catch {
      // The desktop process creates this file before the renderer announces readiness.
    }
    await delay(100);
  }
  throw new Error(`Automation endpoint did not appear below ${configDir}`);
}

async function executeAutomation(endpoint, command, args = {}) {
  const response = await fetch(`http://${endpoint.host}:${endpoint.port}/v1/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ command, args, timeoutMs: 20_000 })
  });
  const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  return {
    ok: response.ok && payload?.ok === true,
    status: response.status,
    result: payload?.result,
    error: String(payload?.error || "")
  };
}

async function clickPoint(client, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  return true;
}

async function pointForSelector(evaluate, client, selector, text = "") {
  return evaluate(client, `(() => {
    const selector = ${JSON.stringify(selector)};
    const expectedText = ${JSON.stringify(text)};
    const candidates = Array.from(document.querySelectorAll(selector));
    const element = expectedText
      ? candidates.find((item) => String(item.textContent || "").replace(/\\s+/g, " ").trim().includes(expectedText))
      : candidates[0];
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function clickSelector(evaluate, client, selector, text = "") {
  return clickPoint(client, await pointForSelector(evaluate, client, selector, text));
}

async function pressKey(client, key, code = key, modifiers = 0) {
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

async function selectAllWithKeyboard(client) {
  const control = {
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17
  };
  const keyA = {
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65
  };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 2, ...control });
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 2, ...keyA });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, ...keyA });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, ...control });
}

async function selectOptionWithKeyboard(evaluate, client, selector, targetValue) {
  const optionState = await evaluate(client, `(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!(select instanceof HTMLSelectElement)) return null;
    return {
      value: select.value,
      options: Array.from(select.options).map((option) => ({ value: option.value, text: option.textContent || "" })),
      disabled: select.disabled
    };
  })()`);
  const targetIndex = optionState?.options?.findIndex((item) => item.value === targetValue) ?? -1;
  if (targetIndex < 0 || optionState?.disabled) return { ok: false, targetValue, before: optionState };
  const clicked = await clickSelector(evaluate, client, selector);
  if (!clicked) return { ok: false, targetValue, before: optionState, clicked: false };
  await pressKey(client, "Home", "Home");
  for (let index = 0; index < targetIndex; index += 1) await pressKey(client, "ArrowDown", "ArrowDown");
  await pressKey(client, "Enter", "Enter");
  await delay(120);
  const after = await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.value || ""`);
  return { ok: after === targetValue, targetValue, before: optionState, after, clicked: true };
}

async function replaceTextWithKeyboard(evaluate, client, selector, value) {
  const clicked = await clickSelector(evaluate, client, selector);
  if (!clicked) return { ok: false, value: "", clicked: false };
  const before = await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.value || ""`);
  await selectAllWithKeyboard(client);
  const selection = await evaluate(client, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    return input && typeof input.selectionStart === "number"
      ? { start: input.selectionStart, end: input.selectionEnd, length: String(input.value || "").length }
      : null;
  })()`);
  await client.send("Input.insertText", { text: value });
  await delay(100);
  const after = await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.value || ""`);
  return { ok: after === value, before, value: after, selection, clicked: true };
}

async function skillNodeMetrics(evaluate, client, id, expected) {
  return evaluate(client, `(() => {
    const id = ${JSON.stringify(id)};
    const expected = ${JSON.stringify(expected)};
    const node = document.querySelector('.flow-node.skill-node[data-node-id="' + CSS.escape(id) + '"]');
    const canvas = document.querySelector('.workflow-canvas');
    const plainRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const visibleRatio = (rect, boundary) => {
      if (!rect || !boundary) return 0;
      const width = Math.max(0, Math.min(rect.right, boundary.right) - Math.max(rect.left, boundary.left));
      const height = Math.max(0, Math.min(rect.bottom, boundary.bottom) - Math.max(rect.top, boundary.top));
      return width * height / Math.max(1, rect.width * rect.height);
    };
    const overlapArea = (left, right) => left && right
      ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
        Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
      : 0;
    const item = (selector, index = 0) => {
      const element = node?.querySelectorAll(selector)?.[index] || null;
      const rect = plainRect(element);
      const style = element ? getComputedStyle(element) : null;
      return {
        found: Boolean(element),
        text: String(element?.textContent || "").replace(/\\s+/g, " ").trim(),
        rect,
        visible: Boolean(element && rect && rect.width >= 8 && rect.height >= 8 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) > 0.05)
      };
    };
    const nodeRect = plainRect(node);
    const canvasRect = plainRect(canvas);
    const kicker = item('.requirement-node-kicker');
    const description = item('.requirement-node-body p');
    const source = item('.requirement-node-meta span', 1);
    const run = item('.requirement-node-run');
    const items = [kicker, description, source, run];
    const overlapAreas = [];
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) overlapAreas.push(overlapArea(items[left].rect, items[right].rect));
    }
    const nodeStyle = node ? getComputedStyle(node) : null;
    const contentOk = kicker.text.includes(expected.name) && description.text === expected.description && source.text === expected.sourceName && /Skill/i.test(run.text);
    const visibleOk = items.every((entry) => entry.visible) && visibleRatio(nodeRect, canvasRect) >= 0.98;
    const childBoundsOk = items.every((entry) => entry.rect && nodeRect && entry.rect.left >= nodeRect.left - 1 && entry.rect.right <= nodeRect.right + 1 && entry.rect.top >= nodeRect.top - 1 && entry.rect.bottom <= nodeRect.bottom + 1);
    const overlapOk = overlapAreas.every((area) => area <= 1);
    return {
      ok: Boolean(node && canvas && node.classList.contains('selected') && contentOk && visibleOk && childBoundsOk && overlapOk),
      count: document.querySelectorAll('.flow-node.skill-node').length,
      selected: Boolean(node?.classList.contains('selected')),
      contentOk,
      visibleOk,
      childBoundsOk,
      overlapOk,
      overlapAreas,
      nodeRect,
      canvasRect,
      nodeVisibleRatio: visibleRatio(nodeRect, canvasRect),
      nodeStyle: nodeStyle ? { display: nodeStyle.display, visibility: nodeStyle.visibility, opacity: nodeStyle.opacity } : null,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight
      },
      kicker,
      description,
      source,
      run
    };
  })()`);
}

function mergeCaptureDetail(capture, key, detail, ok) {
  capture.state = { ...capture.state, [key]: detail };
  if (!ok) capture.stateIssues.push({ key, expected: true, actual: detail });
  try {
    const onDisk = JSON.parse(readFileSync(capture.jsonPath, "utf8"));
    onDisk.state = { ...onDisk.state, [key]: detail };
    onDisk.stateIssues = capture.stateIssues;
    writeFileSync(capture.jsonPath, JSON.stringify(onDisk, null, 2));
  } catch {
    // The aggregate report still owns the authoritative in-memory result.
  }
  return capture;
}

async function taskScopeMetrics(evaluate, client, selector, expectedValue) {
  return evaluate(client, `(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    const field = select?.closest('label');
    const textarea = document.querySelector('.project-agent-composer textarea, #agent-prompt');
    const submit = document.querySelector('.project-agent-steer, #send-button');
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const inside = (box) => Boolean(box && box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1);
    const selectRect = rect(select);
    const fieldRect = rect(field);
    const textareaRect = rect(textarea);
    const submitRect = rect(submit);
    const options = select instanceof HTMLSelectElement
      ? Array.from(select.options).map((option) => ({ value: option.value, text: String(option.textContent || '').trim() }))
      : [];
    const values = options.map((option) => option.value);
    const expectedValues = ${JSON.stringify(TASK_SCOPE_VALUES)};
    const optionsOk = JSON.stringify(values) === JSON.stringify(expectedValues) && options.every((option) => option.text.length > 0);
    const layoutOk = [selectRect, fieldRect, textareaRect, submitRect].every(inside) &&
      selectRect?.width >= 140 && selectRect?.height >= 24 &&
      textareaRect?.width >= 180 && textareaRect?.height >= 56 &&
      submitRect?.width >= 54 && submitRect?.height >= 28;
    return {
      ok: Boolean(select && !select.disabled && select.value === ${JSON.stringify(expectedValue)} && optionsOk && layoutOk),
      value: select?.value || '',
      disabled: Boolean(select?.disabled),
      options,
      optionsOk,
      layoutOk,
      fieldText: String(field?.textContent || '').replace(/\\s+/g, ' ').trim(),
      selectRect,
      fieldRect,
      textareaRect,
      submitRect,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
      overflow: {
        documentX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        documentY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        bodyX: document.body.scrollWidth > document.body.clientWidth
      }
    };
  })()`);
}

async function captureStandaloneWindow(client, runDir, label) {
  const first = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12_000);
  await delay(180);
  const final = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12_000);
  const firstFramePath = join(runDir, `${label}-frame-a.png`);
  const screenshotPath = join(runDir, `${label}.png`);
  writeFileSync(firstFramePath, first);
  writeFileSync(screenshotPath, final);
  const dimensions = pngDimensions(final);
  return {
    ok: dimensions.width >= 320 && dimensions.height >= 240,
    screenshotPath,
    firstFramePath,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: final.length,
    sha256: createHash("sha256").update(final).digest("hex"),
    firstFrameSha256: createHash("sha256").update(first).digest("hex")
  };
}

export async function captureSkillNodeSuite(context) {
  const {
    client,
    targetId,
    waitForExpression,
    evaluate,
    captureState,
    runDir,
    aidebugConfigDir,
    debugPort,
    recordObservation,
    setProbePhase = () => undefined
  } = context;
  const phase = (label, detail = {}) => setProbePhase(`skill-node:${label}`, detail);
  const results = [];
  const expectedSkill = {
    name: "marketplace-product-refiner",
    description: "Preserve product identity while refining lighting, color hierarchy, label clarity, and restrained commercial spacing.",
    sourceName: "Product-Retouch-SKILL.md"
  };
  const markdown = [
    "---",
    `name: ${expectedSkill.name}`,
    `description: ${expectedSkill.description}`,
    "---",
    "",
    "Use the connected SOURCE as the product of record.",
    "Preserve geometry, labels, proportions, and recognizable identity.",
    "Use REFERENCE only for lighting and color direction, then execute through image_gen."
  ].join("\n");

  phase("wait-for-automation");
  await waitForExpression(client, "Boolean(window.naimageAutomation && window.__naimageDebugAgentState)", 10_000);
  const endpoint = await waitForAutomationEndpoint(aidebugConfigDir);
  const reset = await executeAutomation(endpoint, "canvas.clear", { mode: "all", confirmed: true });
  const emptyState = await executeAutomation(endpoint, "canvas.state");

  phase("import-valid-skill");
  const imported = await executeAutomation(endpoint, "canvas.import-skill", {
    markdown,
    sourceName: expectedSkill.sourceName,
    x: 240,
    y: 180
  });
  const importedId = String(imported?.result?.id || "");
  await executeAutomation(endpoint, "canvas.fit");
  await waitForExpression(client, `Boolean(document.querySelector('.flow-node.skill-node[data-node-id="' + CSS.escape(${JSON.stringify(importedId)}) + '"]'))`, 5_000);

  phase("capture-normal", { importedId });
  const normalCapture = await captureState(client, targetId, "skill-node-normal-1280", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    requirementNodeCount: 1,
    selectedNodeId: importedId,
    selectedNodeHighlightVisibleOk: true,
    requirementConnectionPortsVisible: true,
    provenanceArrowAbsent: true
  });
  const normalMetrics = await skillNodeMetrics(evaluate, client, importedId, expectedSkill);
  results.push(mergeCaptureDetail(normalCapture, "skillNodeUi", normalMetrics, normalMetrics?.ok === true));

  phase("duplicate-focus", { importedId });
  const selectionCleared = await executeAutomation(endpoint, "canvas.select", { ids: [] });
  const stateAfterClear = await executeAutomation(endpoint, "canvas.state");
  const beforeDuplicateCount = Array.isArray(stateAfterClear?.result?.nodes) ? stateAfterClear.result.nodes.length : -1;
  const duplicate = await executeAutomation(endpoint, "canvas.import-skill", {
    markdown,
    sourceName: expectedSkill.sourceName,
    x: 820,
    y: 560
  });
  const duplicateState = await executeAutomation(endpoint, "canvas.state");
  const afterDuplicateCount = Array.isArray(duplicateState?.result?.nodes) ? duplicateState.result.nodes.length : -1;
  const duplicateFocused = Boolean(
    selectionCleared.ok &&
    stateAfterClear?.result?.selection?.ids?.length === 0 &&
    duplicate.ok &&
    duplicate.result?.created === false &&
    duplicate.result?.id === importedId &&
    beforeDuplicateCount === afterDuplicateCount &&
    duplicateState?.result?.selection?.primaryId === importedId &&
    duplicateState?.result?.selection?.ids?.length === 1
  );
  const duplicateCapture = await captureState(client, targetId, "skill-node-duplicate-focused", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    requirementNodeCount: 1,
    selectedNodeId: importedId,
    selectedNodeHighlightVisibleOk: true
  }, 30_000, "overview");
  const duplicateMetrics = await skillNodeMetrics(evaluate, client, importedId, expectedSkill);
  results.push(mergeCaptureDetail(duplicateCapture, "skillDuplicateFocus", { ok: duplicateFocused, metrics: duplicateMetrics }, duplicateFocused && duplicateMetrics?.ok === true));

  phase("capture-minimum", { importedId });
  const minimumCapture = await captureState(client, targetId, "skill-node-minimum-884", "window.__naimageAIDebug?.fitCanvas?.()", { width: 884, height: 720 }, {
    requirementNodeCount: 1,
    selectedNodeId: importedId,
    selectedNodeHighlightVisibleOk: true,
    requirementConnectionPortsVisible: true,
    provenanceArrowAbsent: true
  });
  const minimumMetrics = await skillNodeMetrics(evaluate, client, importedId, expectedSkill);
  results.push(mergeCaptureDetail(minimumCapture, "skillNodeMinimumUi", minimumMetrics, minimumMetrics?.ok === true));

  phase("reject-invalid-frontmatter");
  const countBeforeInvalid = afterDuplicateCount;
  const invalid = await executeAutomation(endpoint, "canvas.import-skill", {
    markdown: "---\nname: broken-frontmatter\ndescription: \"unterminated\n---\n\nInstructions must never be imported.",
    sourceName: "Broken-SKILL.md",
    x: 400,
    y: 300
  });
  const stateAfterInvalid = await executeAutomation(endpoint, "canvas.state");
  const invalidCount = Array.isArray(stateAfterInvalid?.result?.nodes) ? stateAfterInvalid.result.nodes.length : -1;
  const invalidRejected = Boolean(
    invalid.ok === false &&
    invalid.status === 400 &&
    /frontmatter|quoted/i.test(invalid.error) &&
    invalidCount === countBeforeInvalid &&
    stateAfterInvalid?.result?.nodes?.every((node) => node.id === importedId)
  );
  const invalidCapture = await captureState(client, targetId, "skill-node-invalid-frontmatter-rejected", "window.__naimageAIDebug?.fitCanvas?.()", { width: 884, height: 720 }, {
    requirementNodeCount: 1,
    selectedNodeId: importedId,
    selectedNodeHighlightVisibleOk: true
  });
  results.push(mergeCaptureDetail(invalidCapture, "invalidSkillImport", {
    ok: invalidRejected,
    status: invalid.status,
    error: invalid.error,
    nodeCountBefore: countBeforeInvalid,
    nodeCountAfter: invalidCount
  }, invalidRejected));

  phase("main-task-scope-stage");
  await evaluate(client, `window.__naimageDebugOpenSurface?.("agent-running")`);
  await waitForExpression(client, "Boolean(document.querySelector('.project-agent-steer-mode select:not(:disabled)'))", 5_000);
  const mainModeSelection = await selectOptionWithKeyboard(evaluate, client, ".project-agent-steer-mode select", "merge-reference");
  const mainSelectedMetrics = await taskScopeMetrics(evaluate, client, ".project-agent-steer-mode select", "merge-reference");
  const mainSelectedCapture = await captureState(client, targetId, "task-scope-main-merge-reference", "undefined", { width: 1280, height: 820 }, {
    agentBusy: true
  });
  results.push(mergeCaptureDetail(mainSelectedCapture, "mainTaskScopeSelected", {
    gesture: mainModeSelection,
    metrics: mainSelectedMetrics
  }, mainModeSelection.ok && mainSelectedMetrics?.ok === true));

  phase("main-task-scope-reset");
  const mainPrompt = await replaceTextWithKeyboard(evaluate, client, ".project-agent-composer textarea", "AIDEBUG_TASK_SCOPE_MAIN_RESET");
  const mainSent = await clickSelector(evaluate, client, ".project-agent-steer");
  await delay(300);
  const mainResetMetrics = await taskScopeMetrics(evaluate, client, ".project-agent-steer-mode select", "auto");
  const mainResetCapture = await captureState(client, targetId, "task-scope-main-reset-auto", "undefined", { width: 1280, height: 820 }, {
    agentBusy: true
  });
  results.push(mergeCaptureDetail(mainResetCapture, "mainTaskScopeReset", {
    prompt: mainPrompt,
    sent: mainSent,
    metrics: mainResetMetrics
  }, mainPrompt.ok && mainSent && mainResetMetrics?.ok === true));

  phase("open-agent-window");
  const placementOpened = await clickSelector(evaluate, client, "#project-agent-placement-toggle");
  await waitForExpression(client, "Boolean(document.querySelector('.agent-placement-menu'))", 3_000);
  const independentWindowClicked = await clickSelector(evaluate, client, ".agent-placement-menu [role=menuitem]", "\u72ec\u7acb\u6d6e\u52a8\u7a97\u53e3");
  const agentTarget = await pollForDebugTarget({
    port: debugPort,
    attempts: 80,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && /agent-window\.html/i.test(String(item.url || ""))),
    notFoundMessage: "Independent Agent window debug target did not appear"
  });
  const agentClient = new BasicCdpClient(agentTarget.webSocketDebuggerUrl);
  let agentWindowEvidence = null;
  try {
    await agentClient.open();
    await agentClient.send("Page.enable");
    await agentClient.send("Runtime.enable");
    await waitForExpression(agentClient, "Boolean(document.querySelector('#steer-mode:not(:disabled)') && !document.querySelector('#steer-mode-field').hidden)", 6_000);
    phase("agent-window-task-scope-selected");
    const agentModeSelection = await selectOptionWithKeyboard(evaluateRuntime, agentClient, "#steer-mode", "clear-attachments");
    const agentSelectedMetrics = await taskScopeMetrics(evaluateRuntime, agentClient, "#steer-mode", "clear-attachments");
    const selectedScreenshot = await captureStandaloneWindow(agentClient, runDir, "task-scope-agent-window-clear-attachments");

    phase("agent-window-task-scope-reset");
    const agentPrompt = await replaceTextWithKeyboard(evaluateRuntime, agentClient, "#agent-prompt", "AIDEBUG_TASK_SCOPE_AGENT_WINDOW_RESET");
    const agentSent = await clickSelector(evaluateRuntime, agentClient, "#send-button");
    await delay(300);
    const agentResetMetrics = await taskScopeMetrics(evaluateRuntime, agentClient, "#steer-mode", "auto");
    const resetScreenshot = await captureStandaloneWindow(agentClient, runDir, "task-scope-agent-window-reset-auto");
    agentWindowEvidence = {
      ok: Boolean(
        placementOpened && independentWindowClicked && agentModeSelection.ok && agentSelectedMetrics?.ok &&
        agentPrompt.ok && agentSent && agentResetMetrics?.ok && selectedScreenshot.ok && resetScreenshot.ok
      ),
      openedByMainWindowGesture: Boolean(placementOpened && independentWindowClicked),
      modeSelection: agentModeSelection,
      selectedMetrics: agentSelectedMetrics,
      prompt: agentPrompt,
      sent: agentSent,
      resetMetrics: agentResetMetrics,
      selectedScreenshot,
      resetScreenshot
    };
  } finally {
    agentClient.close();
  }

  const importOk = Boolean(
    reset.ok &&
    emptyState.ok &&
    emptyState?.result?.nodes?.length === 0 &&
    imported.ok &&
    imported.result?.created === true &&
    importedId &&
    imported.result?.skill?.name === expectedSkill.name &&
    imported.result?.skill?.sourceName === expectedSkill.sourceName
  );
  const gestureOk = Boolean(mainModeSelection.ok && mainPrompt.ok && mainSent && agentWindowEvidence?.ok);
  const suite = {
    ok: Boolean(
      importOk &&
      normalMetrics?.ok &&
      duplicateFocused &&
      duplicateMetrics?.ok &&
      minimumMetrics?.ok &&
      invalidRejected &&
      mainSelectedMetrics?.ok &&
      mainResetMetrics?.ok &&
      agentWindowEvidence?.ok &&
      results.every(captureHealthy)
    ),
    gestureVerdict: { exercised: true, ok: gestureOk },
    qaInventory: {
      automationImport: importOk,
      skillNodeVisible: Boolean(normalMetrics?.ok),
      duplicateFocusWithoutGrowth: duplicateFocused,
      normalViewport: Boolean(normalMetrics?.ok),
      minimumViewport: Boolean(minimumMetrics?.ok),
      invalidFrontmatterRejected: invalidRejected,
      mainTaskScopeModesAndReset: Boolean(mainSelectedMetrics?.ok && mainResetMetrics?.ok),
      agentWindowTaskScopeModesAndReset: Boolean(agentWindowEvidence?.ok)
    },
    import: {
      ok: importOk,
      created: imported.result?.created === true,
      id: importedId,
      skill: imported.result?.skill || null
    },
    duplicate: {
      ok: duplicateFocused,
      created: duplicate.result?.created,
      id: duplicate.result?.id || "",
      beforeCount: beforeDuplicateCount,
      afterCount: afterDuplicateCount,
      selection: duplicateState?.result?.selection || null
    },
    invalidFrontmatter: {
      ok: invalidRejected,
      status: invalid.status,
      error: invalid.error,
      beforeCount: countBeforeInvalid,
      afterCount: invalidCount
    },
    mainTaskScope: {
      ok: Boolean(mainModeSelection.ok && mainSelectedMetrics?.ok && mainPrompt.ok && mainSent && mainResetMetrics?.ok),
      selection: mainModeSelection,
      selectedMetrics: mainSelectedMetrics,
      prompt: mainPrompt,
      sent: mainSent,
      resetMetrics: mainResetMetrics
    },
    agentWindow: agentWindowEvidence,
    issues: []
  };
  if (!suite.ok) {
    suite.issues.push({
      area: "skill-node-gui",
      message: "One or more Skill node or TaskScope GUI checks failed.",
      qaInventory: suite.qaInventory
    });
    mainResetCapture.stateIssues.push({ key: "skillNodeSuite", expected: true, actual: suite.qaInventory });
  }
  mainResetCapture.suite = suite;
  const suitePath = join(runDir, "skill-node-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  recordObservation(suite.ok ? "info" : "issue", suite.ok ? "skill-node-suite-success" : "skill-node-suite-failed", {
    suitePath,
    qaInventory: suite.qaInventory,
    agentWindowScreenshots: agentWindowEvidence
      ? [agentWindowEvidence.selectedScreenshot?.screenshotPath, agentWindowEvidence.resetScreenshot?.screenshotPath].filter(Boolean)
      : []
  });
  return results;
}
