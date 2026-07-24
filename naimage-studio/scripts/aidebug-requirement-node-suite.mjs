import { writeFileSync } from "node:fs";
import { join } from "node:path";

function captureHealthy(capture) {
  return capture && capture.stateIssues.length === 0 && capture.captureIssues.length === 0 &&
    !capture.overflow.documentOverflowX && !capture.overflow.bodyOverflowX && capture.overflow.elementOverflowX.length === 0;
}

export async function captureRequirementNodeSuite(context) {
  const {
    client,
    targetId,
    waitForExpression,
    evaluate,
    captureState,
    runDir,
    fixturePaths,
    recordObservation,
    setProbePhase = () => undefined
  } = context;
  const phase = (label, detail = {}) => setProbePhase(`requirement-node:${label}`, detail);
  phase("wait-for-bridge");
  await waitForExpression(
    client,
    "Boolean(window.__naimageAIDebug?.openRequirementForSource && window.__naimageAIDebug?.openRequirementEditor && window.__naimageAIDebug?.executeRequirement && window.__naimageAIDebug?.disconnectNodeInput && window.__naimageDebugAgentState)",
    10000
  );
  const results = [];
  const dismissConfirmDialog = async () => {
    const dismissed = await evaluate(client, `(() => {
      const dialog = document.querySelector(".confirm-dialog");
      if (!dialog) return { found: false, dismissed: true };
      const cancel = Array.from(dialog.querySelectorAll("button"))
        .find((item) => /取消|关闭/.test(String(item.textContent || "")));
      cancel?.click();
      return { found: true, dismissed: Boolean(cancel) };
    })()`);
    if (dismissed?.found && dismissed?.dismissed) {
      await waitForExpression(client, "!document.querySelector('.confirm-dialog')", 3000);
    }
    return dismissed;
  };
  phase("setup-canvas");
  const setup = await evaluate(client, `(async () => {
    const debug = window.__naimageAIDebug;
    await debug.runTool({ name: "workflow", input: { operation: "clear_canvas", brief: "清理可复用需求节点专项画布。" } });
    await debug.seedCanvas({ count: 2, fileBacked: true, duplicateContent: true });
    let state = window.__naimageDebugAgentState?.() || {};
    const imageIds = (state.nodes || []).filter((node) => node.type === "image" && Number(node.assetCount || 0) > 0).map((node) => node.id).slice(-2);
    if (imageIds[0]) window.__naimageDebugMoveNode?.({ id: imageIds[0], x: 120, y: 120 });
    if (imageIds[1]) window.__naimageDebugMoveNode?.({ id: imageIds[1], x: 800, y: 520 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    await debug.fitCanvas();
    if (imageIds[0]) await debug.selectNodes({ ids: [imageIds[0]], primaryId: imageIds[0] });
    state = window.__naimageDebugAgentState?.() || {};
    return {
      ok: imageIds.length === 2 && state.selectedNodeIds?.length === 1 && state.selectedNodeId === imageIds[0],
      imageIds,
      selection: { selectedNodeId: state.selectedNodeId || "", selectedNodeIds: state.selectedNodeIds || [] },
      state
    };
  })()`);
  const [firstId, secondId] = setup?.imageIds || [];
  if (!setup?.ok || !firstId || !secondId) {
    const failed = await captureState(client, targetId, "requirement-node-setup-failed", "undefined", { width: 1280, height: 820 }, {});
    failed.suite = { ok: false, setup };
    failed.stateIssues.push({ key: "requirementNodeSetup", expected: true, actual: setup });
    return [failed];
  }

  phase("open-editor-from-context-menu", { firstId });
  const openFromContextMenu = await evaluate(client, `(async () => {
    const menu = await window.__naimageAIDebug.openNodeMenu({ id: ${JSON.stringify(firstId)} });
    const button = Array.from(document.querySelectorAll(".canvas-context-menu button"))
      .find((item) => String(item.textContent || "").replace(/\\s+/g, " ").trim() === "基于此成果提要求");
    button?.click();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline && !window.__naimageDebugAgentState?.().requirementEditorOpen) await new Promise((resolve) => setTimeout(resolve, 60));
    return {
      ok: Boolean(menu?.ok && button && window.__naimageDebugAgentState?.().requirementEditorOpen),
      menu,
      buttonFound: Boolean(button),
      state: window.__naimageDebugAgentState?.()
    };
  })()`);
  const editorExpected = {
    modalOpen: true,
    requirementEditorOpen: true,
    requirementEditorUiOk: true,
    modalWithinViewport: true,
    dialogLayoutKind: "requirement-editor",
    verticalOverflowFree: true
  };
  if (!openFromContextMenu?.ok) {
    phase("open-editor-failed", { openFromContextMenu });
    const failed = await captureState(client, targetId, "requirement-editor-open-failed", "undefined", { width: 1280, height: 820 }, editorExpected);
    failed.suite = { ok: false, setup, openFromContextMenu };
    failed.stateIssues.push({ key: "requirementEditorOpenFromContextMenu", expected: true, actual: openFromContextMenu });
    recordObservation("issue", "requirement-node-suite-precondition-failed", { stage: "open-editor-from-context-menu", setup, openFromContextMenu });
    return [failed];
  }

  phase("capture-editor-wide");
  results.push(await captureState(client, targetId, "requirement-editor-wide-1536", "undefined", { width: 1536, height: 816 }, editorExpected));
  phase("capture-editor-1280");
  results.push(await captureState(client, targetId, "requirement-editor-1280", "undefined", { width: 1280, height: 820 }, editorExpected));
  phase("capture-editor-620");
  results.push(await captureState(client, targetId, "requirement-editor-620", "window.__naimageAIDebug?.fitCanvas?.()", { width: 620, height: 720 }, { ...editorExpected, imageNodeViewportOk: true }));

  phase("create-requirement", { firstId });
  const createResult = await evaluate(client, `(async () => {
    const setValue = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    const dialog = document.querySelector(".requirement-editor-dialog");
    const titleOk = setValue(dialog?.querySelector(".requirement-title-field input"), "蓝金电商主图复用需求");
    const textOk = setValue(dialog?.querySelector(".requirement-text-field textarea"), "请直接调用 image_gen，基于当前来源生成 1 张蓝金配色的高品质电商主图；只调整商品主色与光影，严格保留主体结构、标签位置和版式关系。");
    const button = Array.from(dialog?.querySelectorAll("footer button") || []).find((item) => String(item.textContent || "").trim() === "仅创建");
    button?.click();
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.();
      if (!state?.requirementEditorOpen && state?.nodes?.some((node) => node.type === "requirement")) break;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const state = window.__naimageDebugAgentState?.();
    const requirement = state?.nodes?.find((node) => node.type === "requirement");
    return { ok: Boolean(titleOk && textOk && button && requirement?.parentId === ${JSON.stringify(firstId)}), requirement, state };
  })()`);
  const requirementId = String(createResult?.requirement?.id || "");
  phase("capture-created-requirement", { requirementId, createOk: Boolean(createResult?.ok) });
  results.push(await captureState(client, targetId, "requirement-node-created", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    requirementNodeCount: 1,
    requirementGraphValid: true,
    requirementConnectionPortsVisible: true,
    requirementEdgeCount: 1,
    provenanceArrowAbsent: true,
    selectedNodeHighlightVisibleOk: true,
    imageNodeViewportOk: true
  }));
  if (!createResult?.ok || !requirementId) {
    const failed = results[results.length - 1];
    failed.suite = { ok: false, setup, openFromContextMenu, createResult };
    failed.stateIssues.push({ key: "requirementNodeCreated", expected: true, actual: createResult });
    recordObservation("issue", "requirement-node-suite-precondition-failed", { stage: "create-requirement", createResult });
    return results;
  }

  phase("open-editor-by-double-click", { requirementId });
  const openedByDoubleClick = await evaluate(client, `(async () => {
    const node = document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}]');
    node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window, button: 0 }));
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline && !window.__naimageDebugAgentState?.().requirementEditorOpen) await new Promise((resolve) => setTimeout(resolve, 50));
    const state = window.__naimageDebugAgentState?.();
    return { ok: Boolean(node && state?.requirementEditorOpen && state?.requirementEditorNodeId === ${JSON.stringify(requirementId)}), state };
  })()`);
  phase("capture-editor-double-click", { opened: Boolean(openedByDoubleClick?.ok) });
  results.push(await captureState(client, targetId, "requirement-editor-double-click", "undefined", { width: 884, height: 720 }, editorExpected));

  phase("edit-requirement", { requirementId });
  const edited = await evaluate(client, `(async () => {
    const dialog = document.querySelector(".requirement-editor-dialog");
    const textarea = dialog?.querySelector(".requirement-text-field textarea");
    if (!textarea) return { ok: false, error: "requirement editor textarea unavailable", state: window.__naimageDebugAgentState?.() };
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "请直接调用 image_gen，基于当前来源生成 1 张蓝金配色的高品质电商主图；只调整商品主色与光影，严格保留主体结构、标签位置和版式关系，并增加克制的高级留白。");
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    const save = Array.from(dialog?.querySelectorAll("footer button") || []).find((item) => String(item.textContent || "").trim() === "保存");
    save?.click();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.();
      const requirement = state?.nodes?.find((node) => node.id === ${JSON.stringify(requirementId)});
      if (!state?.requirementEditorOpen && Number(requirement?.requirement?.revision || 0) >= 2) return { ok: true, requirement, state };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`);

  phase("execute-first-run", { requirementId });
  const firstExecution = await evaluate(client, `(async () => {
    const before = window.__naimageDebugAgentState?.() || {};
    const beforeIds = new Set((before.nodes || []).filter((node) => node.parentId === ${JSON.stringify(requirementId)}).map((node) => node.id));
    document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .requirement-node-run')?.click();
    const deadline = performance.now() + 45000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.() || {};
      const created = (state.nodes || []).find((node) => node.parentId === ${JSON.stringify(requirementId)} && !beforeIds.has(node.id) && node.type === "image" && node.imageState === "done" && Number(node.assetCount || 0) > 0);
      const requirement = (state.nodes || []).find((node) => node.id === ${JSON.stringify(requirementId)});
      if (created && Number(requirement?.requirement?.lastRunCount || 0) >= 1 && state.agentStatus === "idle") return { ok: true, created, requirement, state };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`, 60000);
  phase("capture-first-output", { ok: Boolean(firstExecution?.ok) });
  results.push(await captureState(client, targetId, "requirement-node-first-output", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    requirementNodeCount: 1,
    requirementGraphValid: true,
    requirementConnectionPortsVisible: true,
    provenanceArrowAbsent: true,
    imageNodeViewportOk: true
  }));

  phase("repeat-confirm", { requirementId });
  const repeatConfirm = await evaluate(client, `(async () => {
    document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .requirement-node-run')?.click();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline && !document.querySelector(".confirm-dialog")) await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector(".confirm-dialog");
    return { ok: Boolean(dialog && /来源没有变化/.test(String(dialog.textContent || ""))), text: String(dialog?.textContent || "").replace(/\\s+/g, " ").trim() };
  })()`);
  results.push(await captureState(client, targetId, "requirement-node-repeat-confirm", "undefined", { width: 884, height: 720 }, { modalOpen: true, modalWithinViewport: true }));
  const repeatConfirmDismissed = await dismissConfirmDialog();

  phase("disconnect-input", { requirementId });
  const disconnected = await evaluate(client, `(async () => {
    document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .node-port-in')?.click();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node && !node.parentId) return { ok: true, node };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`);
  phase("undo-disconnect", { requirementId });
  const disconnectUndo = await evaluate(client, `(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    const undoDeadline = performance.now() + 3000;
    while (performance.now() < undoDeadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node?.parentId === ${JSON.stringify(firstId)}) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const restored = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
    await new Promise((resolve) => setTimeout(resolve, 120));
    document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .node-port-in')?.click();
    const disconnectDeadline = performance.now() + 3000;
    while (performance.now() < disconnectDeadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node && !node.parentId) return { ok: restored?.parentId === ${JSON.stringify(firstId)}, restored, node };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, restored, state: window.__naimageDebugAgentState?.() };
  })()`);
  await evaluate(client, `window.__naimageAIDebug?.fitCanvas?.()`);
  phase("reconnect-same-content", { requirementId, secondId });
  const reconnectedSameContent = await evaluate(client, `(async () => {
    const source = document.querySelector('.flow-node[data-node-id=${JSON.stringify(secondId)}] .node-port-out');
    const target = document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .node-port-in');
    if (!source || !target) return { ok: false, error: "connection ports unavailable" };
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const pointerId = 71;
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const endX = to.left + to.width / 2;
    const endY = to.top + to.height / 2;
    source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 1, clientX: startX, clientY: startY }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 1, clientX: endX, clientY: endY }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 0, clientX: endX, clientY: endY }));
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node?.parentId === ${JSON.stringify(secondId)}) return { ok: true, node };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`);

  const sameContentReconnectConfirm = await evaluate(client, `(async () => {
    const accepted = await window.__naimageAIDebug.executeRequirement({ id: ${JSON.stringify(requirementId)} });
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline && !document.querySelector(".confirm-dialog")) await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector(".confirm-dialog");
    return {
      ok: Boolean(!accepted?.ok && dialog && /来源没有变化/.test(String(dialog.textContent || ""))),
      accepted,
      text: String(dialog?.textContent || "").replace(/\\s+/g, " ").trim()
    };
  })()`);
  const sameContentConfirmDismissed = await dismissConfirmDialog();

  phase("import-distinct-source");
  const distinctSourceImport = await evaluate(client, `(async () => {
    const canvas = document.querySelector(".workflow-canvas");
    const rect = canvas?.getBoundingClientRect();
    const imported = await window.__naimageDebugImportPathsToCanvas({
      paths: [${JSON.stringify(fixturePaths[0])}],
      clientX: (rect?.left || 0) + 340,
      clientY: (rect?.top || 0) + 300
    });
    return {
      ok: Boolean(imported?.ok && imported?.containerId),
      imported,
      sourceId: String(imported?.containerId || "")
    };
  })()`);
  const distinctSourceId = String(distinctSourceImport?.sourceId || "");
  if (distinctSourceId) {
    await waitForExpression(
      client,
      `Boolean(window.__naimageDebugAgentState?.().nodes?.some((node) => node.id === ${JSON.stringify(distinctSourceId)} && node.imageContainer))`,
      10000
    );
  }
  const reconnectedDistinctContent = distinctSourceId ? await evaluate(client, `(async () => {
    document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .node-port-in')?.click();
    const disconnectDeadline = performance.now() + 3000;
    while (performance.now() < disconnectDeadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node && !node.parentId) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await window.__naimageAIDebug?.fitCanvas?.();
    const source = document.querySelector('.flow-node[data-node-id=${JSON.stringify(distinctSourceId)}] .node-port-out');
    const target = document.querySelector('.flow-node[data-node-id=${JSON.stringify(requirementId)}] .node-port-in');
    if (!source || !target) return { ok: false, error: "distinct source connection ports unavailable" };
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const pointerId = 72;
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const endX = to.left + to.width / 2;
    const endY = to.top + to.height / 2;
    source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 1, clientX: startX, clientY: startY }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 1, clientX: endX, clientY: endY }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 0, clientX: endX, clientY: endY }));
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const node = window.__naimageDebugAgentState?.().nodes?.find((item) => item.id === ${JSON.stringify(requirementId)});
      if (node?.parentId === ${JSON.stringify(distinctSourceId)}) return { ok: true, node };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`) : { ok: false, error: "distinct source import failed", distinctSourceImport };

  phase("execute-distinct-source", { requirementId, distinctSourceId });
  const secondExecution = await evaluate(client, `(async () => {
    const before = window.__naimageDebugAgentState?.() || {};
    const beforeIds = new Set((before.nodes || []).filter((node) => node.parentId === ${JSON.stringify(requirementId)}).map((node) => node.id));
    const accepted = await window.__naimageAIDebug.executeRequirement({ id: ${JSON.stringify(requirementId)} });
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (document.querySelector(".confirm-dialog")) return { ok: false, error: "distinct source incorrectly requested confirmation", accepted };
    const deadline = performance.now() + 45000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.() || {};
      const created = (state.nodes || []).find((node) => node.parentId === ${JSON.stringify(requirementId)} && !beforeIds.has(node.id) && node.type === "image" && node.imageState === "done" && Number(node.assetCount || 0) > 0);
      const requirement = (state.nodes || []).find((node) => node.id === ${JSON.stringify(requirementId)});
      if (created && Number(requirement?.requirement?.lastRunCount || 0) >= 2 && state.agentStatus === "idle") return { ok: true, accepted, created, requirement, state };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, accepted, state: window.__naimageDebugAgentState?.() };
  })()`, 60000);
  results.push(await captureState(client, targetId, "requirement-node-reused-source", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    requirementNodeCount: 1,
    requirementGraphValid: true,
    requirementConnectionPortsVisible: true,
    provenanceArrowAbsent: true,
    imageNodeViewportOk: true
  }));

  const containerImport = distinctSourceImport;
  const containerId = distinctSourceId;
  if (containerId) {
    await waitForExpression(client, `Boolean(window.__naimageDebugAgentState?.().nodes?.some((node) => node.id === ${JSON.stringify(containerId)} && node.imageContainer))`, 10000);
    await evaluate(client, `window.__naimageAIDebug.openRequirementForSource({ id: ${JSON.stringify(containerId)} })`);
    await waitForExpression(client, "Boolean(window.__naimageDebugAgentState?.().requirementEditorOpen)", 4000);
  }
  phase("create-container-requirement", { containerId });
  const containerRequirement = containerId ? await evaluate(client, `(async () => {
    const textarea = document.querySelector(".requirement-editor-dialog .requirement-text-field textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "基于整个图片容器批量统一蓝金视觉风格，保持每张图主体和版式不变。");
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    Array.from(document.querySelectorAll(".requirement-editor-dialog footer button")).find((item) => String(item.textContent || "").trim() === "仅创建")?.click();
    const createdDeadline = performance.now() + 4000;
    while (performance.now() < createdDeadline) {
      const requirement = window.__naimageDebugAgentState?.().nodes?.find((node) => node.type === "requirement" && node.parentId === ${JSON.stringify(containerId)} && node.requirement?.createdFrom === "container");
      if (requirement) return { ok: true, containerId: ${JSON.stringify(containerId)}, requirement };
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { ok: false, containerId: ${JSON.stringify(containerId)}, import: ${JSON.stringify(containerImport)}, state: window.__naimageDebugAgentState?.() };
  })()`) : { ok: false, containerId, import: containerImport, error: "container import failed" };

  await dismissConfirmDialog();
  const runFullLayerRequirement = process.env.NAIMAGE_RELEASE_VERIFY === "1" ||
    process.env.NAIMAGE_AIDEBUG_FULL === "1" || process.argv.includes("--full-suite");
  let layerRequirement = {
    ok: true,
    skipped: true,
    mode: "fast",
    reason: "full layer requirement coverage is reserved for release verification"
  };
  if (runFullLayerRequirement) {
    phase("create-layer-requirement");
    await evaluate(client, `(() => {
    window.__naimageRequirementLayerProbe = { status: "running", result: null };
    Promise.resolve().then(async () => {
      const layers = await window.__naimageAIDebug.runLayerStackSuite({ agentDriven: false });
      const sourceId = String(layers?.subjectId || layers?.layerNodeIds?.[0] || "");
      const groupId = String(layers?.groupId || "");
      const layerNodeIds = Array.isArray(layers?.layerNodeIds) ? layers.layerNodeIds.map((id) => String(id || "")).filter(Boolean) : [];
      const fixtureReady = Boolean(sourceId && groupId && layerNodeIds.length === 6 && new Set(layerNodeIds).size === 6 && layerNodeIds.includes(sourceId));
      if (!fixtureReady) {
        window.__naimageRequirementLayerProbe = {
          status: "complete",
          result: { ok: false, sourceId, layers: { ok: Boolean(layers?.ok), fixtureReady, groupId, layerNodeIds } }
        };
        return;
      }
      await window.__naimageAIDebug.openRequirementForSource({ id: sourceId });
      const textarea = document.querySelector(".requirement-editor-dialog .requirement-text-field textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "仅基于当前分层 PNG 组修改文字层内容，保持背景层和主体层透明像素对齐。");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      Array.from(document.querySelectorAll(".requirement-editor-dialog footer button")).find((item) => String(item.textContent || "").trim() === "仅创建")?.click();
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        const requirement = window.__naimageDebugAgentState?.().nodes?.find((node) => node.type === "requirement" && node.parentId === sourceId && node.requirement?.createdFrom === "layer");
        if (requirement) {
          window.__naimageRequirementLayerProbe = {
            status: "complete",
            result: {
              ok: true,
              sourceId,
              requirement,
              layers: { ok: Boolean(layers?.ok), fixtureReady, groupId, layerNodeIds }
            }
          };
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.__naimageRequirementLayerProbe = {
        status: "complete",
        result: { ok: false, sourceId, layers: { ok: Boolean(layers?.ok), fixtureReady, groupId, layerNodeIds } }
      };
    }).catch((error) => {
      window.__naimageRequirementLayerProbe = {
        status: "failed",
        result: { ok: false, error: error instanceof Error ? error.message : String(error) }
      };
    });
    return true;
    })()`);
    await waitForExpression(client, "window.__naimageRequirementLayerProbe?.status !== 'running'", 120000);
    phase("capture-layer-requirement");
    layerRequirement = await evaluate(client, "window.__naimageRequirementLayerProbe?.result || { ok: false, error: 'layer requirement probe missing' }");
  } else {
    phase("skip-layer-requirement", { mode: "fast" });
  }

  phase("blank-requirement-role-scope");
  const round2Scope = await evaluate(client, `(async () => {
    const debug = window.__naimageAIDebug;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    await debug.runTool({ name: "workflow", input: { operation: "clear_canvas", brief: "准备空白需求与角色连线专项。" } });
    const sourceCreated = await window.__naimageDebugCreateImageContainer?.({ worldX: 100, worldY: 130, role: "source" });
    const referenceCreated = await window.__naimageDebugCreateImageContainer?.({ worldX: 100, worldY: 470, role: "reference" });
    const neutralCreated = await window.__naimageDebugCreateImageContainer?.({ worldX: 760, worldY: 470 });
    const sourceId = String(sourceCreated?.id || "");
    const referenceId = String(referenceCreated?.id || "");
    const neutralId = String(neutralCreated?.id || "");
    const sourceImport = await window.__naimageDebugImportPathsToCanvas?.({ paths: [${JSON.stringify(fixturePaths[0])}], targetContainerId: sourceId });
    const referenceImport = await window.__naimageDebugImportPathsToCanvas?.({ paths: [${JSON.stringify(fixturePaths[1] || fixturePaths[0])}], targetContainerId: referenceId });
    const neutralImport = await window.__naimageDebugImportPathsToCanvas?.({ paths: [${JSON.stringify(fixturePaths[2] || fixturePaths[0])}], targetContainerId: neutralId });
    const convertedReference = await debug.setContainerRole({ id: neutralId, role: "reference" });
    const convertedNeutral = await debug.setContainerRole({ id: neutralId });
    const neutralAfterConversion = window.__naimageDebugAgentState?.().nodes?.find((node) => node.id === neutralId);
    const roleConversionOk = Boolean(
      convertedReference?.ok && convertedReference?.state?.nodes?.find((node) => node.id === neutralId)?.imageContainerRole === "reference" &&
      convertedNeutral?.ok && !neutralAfterConversion?.imageContainerRole &&
      (neutralAfterConversion?.assets || []).every((asset) => !asset.taskRole)
    );
    await debug.openRequirementAt({ worldX: 560, worldY: 150 });
    const dialog = document.querySelector(".requirement-editor-dialog");
    const titleSet = setValue(dialog?.querySelector(".requirement-title-field input"), "原图与参考图作用域测试");
    const textSet = setValue(dialog?.querySelector(".requirement-text-field textarea"), "请调用 image_gen，只修改已连接的原图，参考已连接参考图的配色，生成 1 张高品质电商视觉；不要使用画布上未连接的素材。");
    const create = Array.from(dialog?.querySelectorAll("footer button") || []).find((button) => String(button.textContent || "").trim() === "仅创建");
    create?.click();
    const createDeadline = performance.now() + 4000;
    let requirementNode = null;
    while (performance.now() < createDeadline) {
      requirementNode = window.__naimageDebugAgentState?.().nodes?.find((node) => node.type === "requirement" && node.requirement?.createdFrom === "canvas");
      if (requirementNode && !window.__naimageDebugAgentState?.().requirementEditorOpen) break;
      await delay(60);
    }
    const requirementId = String(requirementNode?.id || "");
    const blankCreated = Boolean(requirementId && !requirementNode?.parentId && (requirementNode?.requirement?.inputBindings || []).length === 0);
    const sourceConnected = window.__naimageDebugConnectNodes?.({ sourceId, targetId: requirementId }) === true;
    const referenceConnected = window.__naimageDebugConnectNodes?.({ sourceId: referenceId, targetId: requirementId }) === true;
    await delay(240);
    requirementNode = window.__naimageDebugAgentState?.().nodes?.find((node) => node.id === requirementId);
    const bindings = requirementNode?.requirement?.inputBindings || [];
    const rolesOk = bindings.length === 2 &&
      bindings.some((binding) => binding.nodeId === sourceId && binding.role === "source") &&
      bindings.some((binding) => binding.nodeId === referenceId && binding.role === "reference") &&
      !bindings.some((binding) => binding.nodeId === neutralId) &&
      requirementNode?.parentId === sourceId;
    const accepted = await debug.executeRequirement({ id: requirementId });
    const scopeDeadline = performance.now() + 5000;
    let taskScope = null;
    while (performance.now() < scopeDeadline) {
      taskScope = window.__naimageDebugAgentState?.().lastDispatchedTaskScope || null;
      if (taskScope?.requirement?.nodeId === requirementId) break;
      await delay(60);
    }
    const scopeOk = Boolean(
      taskScope?.sourceNodeIds?.length === 1 && taskScope.sourceNodeIds[0] === sourceId &&
      taskScope?.sourceContainerIds?.includes(sourceId) &&
      taskScope?.referenceContainerIds?.includes(referenceId) &&
      !taskScope?.sourceContainerIds?.includes(neutralId) &&
      !taskScope?.referenceContainerIds?.includes(neutralId) &&
      taskScope?.sourceAssets?.every((asset) => asset.nodeId === sourceId && asset.role === "source") &&
      taskScope?.referenceAssets?.every((asset) => asset.nodeId === referenceId && asset.role === "reference")
    );
    const finishDeadline = performance.now() + 45000;
    while (performance.now() < finishDeadline && window.__naimageDebugAgentState?.().agentStatus !== "idle") await delay(120);
    const state = window.__naimageDebugAgentState?.() || {};
    const menuCanvas = document.querySelector(".workflow-canvas");
    const rect = menuCanvas?.getBoundingClientRect();
    menuCanvas?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: (rect?.left || 0) + 40, clientY: (rect?.top || 0) + 40 }));
    await delay(120);
    const menuLabels = Array.from(document.querySelectorAll(".canvas-context-menu button")).map((button) => String(button.textContent || "").replace(/\\s+/g, " ").trim());
    const menuOk = ["创建需求节点", "创建原图容器", "创建参考图容器", "创建图片容器"].every((label) => menuLabels.includes(label));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    return {
      ok: Boolean(sourceCreated?.ok && referenceCreated?.ok && neutralCreated?.ok && sourceImport?.ok && referenceImport?.ok && neutralImport?.ok && roleConversionOk && titleSet && textSet && create && blankCreated && sourceConnected && referenceConnected && rolesOk && accepted?.ok && scopeOk && menuOk),
      sourceId,
      referenceId,
      neutralId,
      roleConversionOk,
      requirementId,
      blankCreated,
      sourceConnected,
      referenceConnected,
      bindings,
      rolesOk,
      accepted,
      taskScope,
      scopeOk,
      menuLabels,
      menuOk,
      state
    };
  })()`, 70000);
  const finalCapture = await captureState(client, targetId, "requirement-node-role-scope", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    requirementNodeCount: 1,
    requirementGraphValid: true,
    requirementConnectionPortsVisible: true,
    requirementEdgeCount: 2,
    provenanceArrowAbsent: true,
    imageNodeViewportOk: true
  });

  const suite = {
    ok: Boolean(
      setup?.ok && openFromContextMenu?.ok && createResult?.ok && requirementId && openedByDoubleClick?.ok && edited?.ok &&
      firstExecution?.ok && repeatConfirm?.ok && repeatConfirmDismissed?.dismissed && disconnected?.ok && disconnectUndo?.ok &&
      reconnectedSameContent?.ok && sameContentReconnectConfirm?.ok && sameContentConfirmDismissed?.dismissed &&
      distinctSourceImport?.ok && reconnectedDistinctContent?.ok && secondExecution?.ok &&
      containerRequirement?.ok && layerRequirement?.ok && round2Scope?.ok && results.every(captureHealthy) && captureHealthy(finalCapture)
    ),
    setup,
    openFromContextMenu,
    createResult,
    openedByDoubleClick,
    edited,
    firstExecution,
    repeatConfirm,
    disconnected,
    disconnectUndo,
    repeatConfirmDismissed,
    reconnectedSameContent,
    sameContentReconnectConfirm,
    sameContentConfirmDismissed,
    distinctSourceImport,
    reconnectedDistinctContent,
    secondExecution,
    containerRequirement,
    layerRequirement,
    round2Scope
  };
  finalCapture.suite = suite;
  if (!suite.ok) finalCapture.stateIssues.push({ key: "requirementNodeSuite", expected: true, actual: suite });
  results.push(finalCapture);
  const suitePath = join(runDir, "requirement-node-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  recordObservation(suite.ok ? "info" : "issue", suite.ok ? "requirement-node-suite-success" : "requirement-node-suite-failed", { suitePath, suite });
  return results;
}
