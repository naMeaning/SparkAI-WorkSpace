import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export async function captureGoalModeSuite(context) {
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
  const phase = (label, detail = {}) => setProbePhase(`goal-mode:${label}`, detail);
  const results = [];
  const startedAt = new Date().toISOString();

  phase("wait-for-bridge");
  await waitForExpression(
    client,
    "Boolean(window.__naimageAIDebug?.runTool && window.__naimageAIDebug?.fitCanvas && window.__naimageDebugCreateImageContainer && window.__naimageDebugImportPathsToCanvas && window.__naimageDebugAgentState)",
    10_000
  );

  phase("setup-canvas", { eligibleContainers: 5, eligibleAssets: 10, skippedContainers: 2 });
  const setup = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await window.__naimageAIDebug.runTool({
      name: "workflow",
      input: { operation: "clear_canvas", brief: "Reset the Goal mode GUI fixture canvas." }
    });
    await delay(120);
    const fixturePaths = ${JSON.stringify(fixturePaths)};
    const sourceIds = [];
    const imports = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await window.__naimageDebugCreateImageContainer({
        worldX: 100 + (index % 3) * 440,
        worldY: 100 + Math.floor(index / 3) * 360,
        role: "source"
      });
      sourceIds.push(created.id);
      imports.push(await window.__naimageDebugImportPathsToCanvas({
        paths: fixturePaths,
        targetContainerId: created.id
      }));
      await delay(80);
    }
    const reference = await window.__naimageDebugCreateImageContainer({ worldX: 1420, worldY: 100, role: "reference" });
    const referenceImport = await window.__naimageDebugImportPathsToCanvas({
      paths: fixturePaths,
      targetContainerId: reference.id
    });
    await delay(140);
    const empty = await window.__naimageDebugCreateImageContainer({ worldX: 1420, worldY: 460, role: "source" });
    await delay(240);
    await window.__naimageAIDebug.selectNodes?.({ ids: [] });
    await window.__naimageAIDebug.fitCanvas();
    window.__naimageDebugOpenSurface?.("agent-timeline");
    await delay(320);
    const state = window.__naimageDebugAgentState() || {};
    const nodes = state.nodes || [];
    const sourceNodes = sourceIds.map((id) => nodes.find((node) => node.id === id));
    const referenceNode = nodes.find((node) => node.id === reference.id);
    const emptyNode = nodes.find((node) => node.id === empty.id);
    return {
      ok: Boolean(
        sourceIds.length === 5 &&
        sourceNodes.every((node) => node?.imageContainer && node?.imageContainerRole === "source" && Number(node?.assetCount || 0) === 2) &&
        referenceNode?.imageContainerRole === "reference" && Number(referenceNode?.assetCount || 0) === 2 &&
        emptyNode?.imageContainerRole === "source" && Number(emptyNode?.assetCount || 0) === 0
      ),
      sourceIds,
      referenceId: reference.id,
      emptyId: empty.id,
      sourceAssetCounts: sourceNodes.map((node) => Number(node?.assetCount || 0)),
      referenceAssetCount: Number(referenceNode?.assetCount || 0),
      emptyAssetCount: Number(emptyNode?.assetCount || 0),
      importCount: imports.length,
      referenceImport: Boolean(referenceImport),
      nodeCount: Number(state.nodeCount || nodes.length)
    };
  })()`, 60_000);

  await waitForExpression(
    client,
    "Boolean(document.querySelector('.project-agent-mode-picker') && document.querySelector('.project-agent-mode-option.goal:not(:disabled)'))",
    10_000
  );

  phase("select-goal-mode", { setupOk: Boolean(setup?.ok) });
  const selected = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trigger = document.querySelector(".project-agent-mode-trigger");
    trigger?.click();
    await delay(80);
    const buttons = Array.from(document.querySelectorAll(".project-agent-mode-option"));
    const goal = document.querySelector(".project-agent-mode-option.goal");
    goal?.click();
    await delay(180);
    const context = document.querySelector(".project-agent-goal-context");
    const modeTexts = buttons.map((button) => String(button.textContent || "").replace(/\\s+/g, " ").trim());
    const triggerText = String(document.querySelector(".project-agent-mode-trigger")?.textContent || "").replace(/\\s+/g, " ").trim();
    const scopeTitle = String(goal?.getAttribute("title") || "");
    const contextText = String(context?.textContent || "").replace(/\\s+/g, " ").trim();
    return {
      ok: Boolean(
        buttons.length === 2 &&
        modeTexts.some((text) => text === "普通") &&
        modeTexts.some((text) => text === "Goal") &&
        goal && !goal.disabled && goal.getAttribute("aria-checked") === "true" &&
        triggerText.includes("Goal") &&
        scopeTitle.includes("5 个容器") && scopeTitle.includes("10 张图") &&
        contextText.includes("全部图片容器") && contextText.includes("5 个容器") && contextText.includes("10 张图")
      ),
      modeTexts,
      goalDisabled: Boolean(goal?.disabled),
      goalChecked: goal?.getAttribute("aria-checked") || "",
      triggerText,
      scopeTitle,
      contextText
    };
  })()`);
  const selectedCapture = await captureState(
    client,
    targetId,
    "goal-mode-selected-1280",
    "window.__naimageAIDebug?.fitCanvas?.()",
    { width: 1280, height: 820 },
    { modalOpen: false, agentPanelVisible: true },
    30_000,
    "overview"
  );
  results.push(mergeCaptureDetail(selectedCapture, "goalModeSelected", { setup, selected }, setup?.ok === true && selected?.ok === true));

  phase("open-confirmation");
  const prompted = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textarea = document.querySelector(".project-agent-composer textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) return { ok: false, error: "composer textarea unavailable" };
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      "统一优化全部图片容器的构图、光线和商品主体清晰度。"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(160);
    const send = document.querySelector(".project-agent-send");
    send?.click();
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline && !document.querySelector(".goal-confirmation-dialog")) await delay(50);
    return { ok: Boolean(send && document.querySelector(".goal-confirmation-dialog")), sendDisabled: Boolean(send?.disabled) };
  })()`);
  await waitForExpression(client, "Boolean(document.querySelector('.goal-confirmation-dialog'))", 8_000);

  const confirmation = await evaluate(client, `(() => {
    const dialog = document.querySelector(".goal-confirmation-dialog");
    const text = String(dialog?.textContent || "").replace(/\\s+/g, " ").trim();
    const scope = String(dialog?.querySelector(".goal-confirmation-scope strong")?.textContent || "").replace(/\\s+/g, " ").trim();
    const snapshotHash = String(dialog?.querySelector(".goal-confirmation-scope code")?.textContent || "").trim();
    const policies = Array.from(dialog?.querySelectorAll(".goal-confirmation-policy li") || [])
      .map((item) => String(item.textContent || "").replace(/\\s+/g, " ").trim());
    const cost = String(dialog?.querySelector(".goal-confirmation-cost")?.textContent || "").replace(/\\s+/g, " ").trim();
    const skipped = String(dialog?.querySelector(".goal-confirmation-skipped")?.textContent || "").replace(/\\s+/g, " ").trim();
    return {
      ok: Boolean(
        dialog && scope === "5 个来源边界 · 10 张母图" &&
        /^scope-[0-9a-f]+$/i.test(snapshotHash) &&
        policies.length === 3 &&
        policies[0].includes("先串行探测 2 个不同母图代表项") && policies[0].includes("暂停其他 Goal 新放量") &&
        policies[1].includes("技术校验通过") && policies[1].includes("最高 3 路") && policies[1].includes("保护性失败") &&
        policies[2].includes("仍可能计费") && policies[2].includes("不能追回已产生费用") &&
        cost.includes("预计计费上限 ¥0.60") && cost.includes("试用抵扣 8 张") && cost.includes("预计付费 2 张") &&
        skipped.includes("2 个容器不会执行") && skipped.includes("仅包含参考图") && skipped.includes("空容器") &&
        text.includes("最多 10 次图片请求")
      ),
      scope,
      snapshotHash,
      policies,
      cost,
      skipped,
      text
    };
  })()`);
  const confirmationCapture = await captureState(
    client,
    targetId,
    "goal-mode-confirmation-1280",
    "undefined",
    { width: 1280, height: 820 },
    { modalOpen: true, modalWithinViewport: true },
    30_000,
    "overview"
  );
  results.push(mergeCaptureDetail(
    confirmationCapture,
    "goalModeConfirmation",
    { prompted, confirmation },
    prompted?.ok === true && confirmation?.ok === true
  ));

  phase("capture-production-minimum", { width: 900, height: 640 });
  const minimumCapture = await captureState(
    client,
    targetId,
    "goal-mode-confirmation-min-900x640",
    "undefined",
    { width: 900, height: 640 },
    {
      modalOpen: true,
      modalWithinViewport: true,
      verticalOverflowFree: true,
      workbenchMinWidthOk: true
    },
    30_000,
    "overview"
  );
  const productionMinimum = await evaluate(client, `(() => {
    const dialog = document.querySelector(".goal-confirmation-dialog");
    const body = dialog?.querySelector(".goal-confirmation-body");
    const header = dialog?.querySelector(":scope > header");
    const footer = dialog?.querySelector(":scope > footer");
    const actions = Array.from(footer?.querySelectorAll("button") || []);
    const plainRect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left * 1000) / 1000,
        top: Math.round(box.top * 1000) / 1000,
        right: Math.round(box.right * 1000) / 1000,
        bottom: Math.round(box.bottom * 1000) / 1000,
        width: Math.round(box.width * 1000) / 1000,
        height: Math.round(box.height * 1000) / 1000
      };
    };
    const withinViewport = (box, inset = 1) => Boolean(
      box &&
      box.left >= -inset && box.top >= -inset &&
      box.right <= window.innerWidth + inset && box.bottom <= window.innerHeight + inset
    );
    const dialogRect = plainRect(dialog);
    const bodyRect = plainRect(body);
    const headerRect = plainRect(header);
    const footerRect = plainRect(footer);
    const actionRects = actions.map(plainRect);
    const overflow = {
      documentX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyX: document.body.scrollWidth > document.body.clientWidth + 1,
      dialogX: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1),
      bodyContentX: Boolean(body && body.scrollWidth > body.clientWidth + 1),
      footerX: Boolean(footer && footer.scrollWidth > footer.clientWidth + 1)
    };
    const sections = [
      dialog?.querySelector(".goal-confirmation-scope"),
      dialog?.querySelector(".goal-confirmation-policy"),
      dialog?.querySelector(".goal-confirmation-cost"),
      dialog?.querySelector(".goal-confirmation-skipped")
    ];
    const sectionRects = sections.map(plainRect);
    const sectionWidthFits = sectionRects.every((box) => Boolean(
      box && bodyRect && box.left >= bodyRect.left - 1 && box.right <= bodyRect.right + 1
    ));
    return {
      ok: Boolean(
        dialog && body && header && footer &&
        window.innerWidth === 900 && window.innerHeight === 640 &&
        [dialogRect, bodyRect, headerRect, footerRect, ...actionRects].every((box) => withinViewport(box)) &&
        actionRects.length === 2 && actionRects.every((box) => box.width >= 80 && box.height >= 30) &&
        sectionWidthFits && Object.values(overflow).every((value) => value === false)
      ),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dialogRect,
      headerRect,
      bodyRect,
      footerRect,
      actionRects,
      sectionRects,
      sectionWidthFits,
      overflow
    };
  })()`);
  results.push(mergeCaptureDetail(
    minimumCapture,
    "goalModeProductionMinimum",
    productionMinimum,
    productionMinimum?.ok === true
  ));

  phase("mutate-confirmed-scope", { oldSnapshotHash: confirmation?.snapshotHash || "" });
  const mutation = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const created = await window.__naimageDebugCreateImageContainer({ worldX: 1860, worldY: 460, role: "source" });
    const imported = await window.__naimageDebugImportPathsToCanvas({
      paths: ${JSON.stringify(fixturePaths)},
      targetContainerId: created.id
    });
    await delay(260);
    const state = window.__naimageDebugAgentState() || {};
    const node = (state.nodes || []).find((item) => item.id === created.id);
    return {
      ok: Boolean(node?.imageContainer && Number(node?.assetCount || 0) === 2),
      id: created.id,
      imported: Boolean(imported),
      node: node ? {
        id: node.id,
        imageContainer: Boolean(node.imageContainer),
        imageContainerRole: node.imageContainerRole || "",
        assetCount: Number(node.assetCount || 0)
      } : null
    };
  })()`, 30_000);

  phase("reject-stale-confirmation", { mutationOk: Boolean(mutation?.ok) });
  const stale = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const oldSnapshotHash = ${JSON.stringify(confirmation?.snapshotHash || "")};
    const before = window.__naimageDebugAgentState() || {};
    const confirm = Array.from(document.querySelectorAll(".goal-confirmation-dialog footer button"))
      .find((button) => String(button.textContent || "").replace(/\\s+/g, " ").trim() === "冻结并执行");
    confirm?.click();
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      const dialog = document.querySelector(".goal-confirmation-dialog");
      const nextHash = String(dialog?.querySelector(".goal-confirmation-scope code")?.textContent || "").trim();
      if (dialog && nextHash && nextHash !== oldSnapshotHash) break;
      await delay(50);
    }
    const dialog = document.querySelector(".goal-confirmation-dialog");
    const text = String(dialog?.textContent || "").replace(/\\s+/g, " ").trim();
    const nextHash = String(dialog?.querySelector(".goal-confirmation-scope code")?.textContent || "").trim();
    const scope = String(dialog?.querySelector(".goal-confirmation-scope strong")?.textContent || "").replace(/\\s+/g, " ").trim();
    const after = window.__naimageDebugAgentState() || {};
    const dispatched = after.lastDispatchedTaskScope;
    const oldGoalDispatched = Boolean(dispatched?.origin === "goal");
    return {
      ok: Boolean(
        confirm && dialog && nextHash && nextHash !== oldSnapshotHash &&
        scope === "6 个来源边界 · 12 张母图" &&
        text.includes("画布范围或费用报价在确认前发生变化") && text.includes("新的确认值") && text.includes("重新") &&
        !oldGoalDispatched && after.agentExecutionBusy === false && after.messageCount === before.messageCount
      ),
      oldSnapshotHash,
      nextHash,
      scope,
      refreshMessageVisible: text.includes("画布范围或费用报价在确认前发生变化") && text.includes("新的确认值") && text.includes("重新"),
      dialogOpen: Boolean(dialog),
      oldGoalDispatched,
      busy: Boolean(after.agentExecutionBusy),
      messageCountBefore: before.messageCount,
      messageCountAfter: after.messageCount,
      lastDispatchedTaskScope: dispatched || null,
      text
    };
  })()`, 15_000);
  const staleCapture = await captureState(
    client,
    targetId,
    "goal-mode-stale-confirmation-rejected-1280",
    "undefined",
    { width: 1280, height: 820 },
    { modalOpen: true, modalWithinViewport: true },
    30_000,
    "overview"
  );
  results.push(mergeCaptureDetail(
    staleCapture,
    "goalModeStaleConfirmation",
    { mutation, stale },
    mutation?.ok === true && stale?.ok === true
  ));

  const checks = {
    fixtureCanvas: setup?.ok === true,
    segmentedModeAndCounts: selected?.ok === true,
    confirmationOpened: prompted?.ok === true,
    probeBeforeScalePolicy: Boolean(confirmation?.policies?.[0]?.includes("先串行探测 2 个不同母图代表项")),
    gradualConcurrencyPolicy: Boolean(confirmation?.policies?.[1]?.includes("最高 3 路")),
    dispatchedCostWarning: Boolean(confirmation?.policies?.[2]?.includes("仍可能计费")),
    quotaAndCostEstimate: Boolean(confirmation?.cost?.includes("¥0.60") && confirmation?.cost?.includes("8 张") && confirmation?.cost?.includes("2 张")),
    snapshotHashPresent: Boolean(confirmation?.snapshotHash?.startsWith("scope-")),
    productionMinimumViewportFit: productionMinimum?.ok === true,
    staleSnapshotRejected: stale?.ok === true,
    capturesHealthy: results.every(captureHealthy)
  };
  const suite = {
    ok: Object.values(checks).every(Boolean),
    startedAt,
    finishedAt: new Date().toISOString(),
    fixturePaths,
    setup,
    selected,
    confirmation,
    productionMinimum,
    mutation,
    stale,
    checks,
    captures: results.map((item) => ({ label: item.label, screenshotPath: item.screenshotPath, jsonPath: item.jsonPath }))
  };
  const suitePath = join(runDir, "goal-mode-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  for (const result of results) result.suitePath = suitePath;
  if (results.length) results[results.length - 1].suite = suite;
  if (!suite.ok) {
    recordObservation("issue", "goal-mode-suite-failed", { checks, setup, selected, confirmation, mutation, stale, suitePath });
  } else {
    recordObservation("info", "goal-mode-suite-complete", { checks, suitePath });
  }
  return results;
}
