import { writeFileSync } from "node:fs";
import { join } from "node:path";

function captureHealthy(capture) {
  return capture && capture.stateIssues.length === 0 && capture.captureIssues.length === 0 &&
    !capture.overflow.documentOverflowX && !capture.overflow.bodyOverflowX && capture.overflow.elementOverflowX.length === 0;
}

export async function captureAskUserContinuationSuite(context) {
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
  const phase = (label, detail = {}) => setProbePhase(`ask-user:${label}`, detail);
  phase("wait-for-bridge");
  await waitForExpression(
    client,
    "Boolean(window.__naimageAIDebug?.chat && window.__naimageAIDebug?.newConversation && window.__naimageAIDebug?.addReferencePickerPaths && window.__naimageDebugAgentState)",
    10000
  );
  const results = [];
  const checks = {};
  const marker = `AIDEBUG_ASK_CONTINUATION_${Date.now()}`;

  phase("clean-start", { marker });
  const cleanStart = await evaluate(client, `(async () => {
    const conversation = await window.__naimageAIDebug.newConversation();
    await window.__naimageAIDebug.runTool({ name: "workflow", input: { operation: "clear_canvas", brief: "清理 AskUser continuation 专项画布。" } });
    await window.__naimageAIDebug.seedCanvas({ count: 1, fileBacked: true });
    return { conversation, state: window.__naimageDebugAgentState?.() };
  })()`);
  const requirementSourceId = String(cleanStart?.state?.nodes?.find((node) => node.type === "image")?.id || "");

  phase("create-requirement", { requirementSourceId });
  const requirementCreated = requirementSourceId ? await evaluate(client, `(async () => {
    await window.__naimageAIDebug.openRequirementForSource({ id: ${JSON.stringify(requirementSourceId)} });
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline && !window.__naimageDebugAgentState?.().requirementEditorOpen) await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector(".requirement-editor-dialog");
    const textarea = dialog?.querySelector(".requirement-text-field textarea");
    if (!textarea) return { ok: false, error: "requirement editor unavailable", state: window.__naimageDebugAgentState?.() };
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      ${JSON.stringify("AIDEBUG_ASK_CLARIFY 请先确认版式，然后基于当前 SOURCE 生成一张 3:4 蓝金电商主视觉。")}
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    Array.from(dialog.querySelectorAll("footer button")).find((item) => String(item.textContent || "").trim() === "仅创建")?.click();
    const createdDeadline = performance.now() + 4000;
    while (performance.now() < createdDeadline) {
      const requirement = window.__naimageDebugAgentState?.().nodes?.find((node) => node.type === "requirement" && node.parentId === ${JSON.stringify(requirementSourceId)});
      if (requirement) return { ok: true, requirement, state: window.__naimageDebugAgentState?.() };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ok: false, error: "requirement creation timed out", state: window.__naimageDebugAgentState?.() };
  })()`) : { ok: false, error: "seed source unavailable", state: cleanStart?.state };
  const requirementId = String(requirementCreated?.requirement?.id || "");
  phase("request-clarification", { requirementId });
  const requirementAsk = requirementId ? await evaluate(client, `(async () => {
    const accepted = await window.__naimageAIDebug.executeRequirement({ id: ${JSON.stringify(requirementId)} });
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.();
      if (state?.askUserOpen && state?.pendingAgentExecution?.kind === "clarify") return { ok: true, accepted, state };
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return { ok: false, accepted, state: window.__naimageDebugAgentState?.() };
  })()`, 40000) : { ok: false, error: "requirement unavailable" };
  phase("capture-clarification", { open: Boolean(requirementAsk?.ok) });
  results.push(await captureState(client, targetId, "ask-user-requirement-clarify", "undefined", { width: 884, height: 720 }, {
    modalOpen: true,
    askUserOpen: true,
    modalWithinViewport: true,
    verticalOverflowFree: true
  }));

  phase("resume-after-clarification", { requirementId });
  const requirementResume = requirementId ? await evaluate(client, `(async () => {
    const before = window.__naimageDebugAgentState?.() || {};
    const beforeIds = new Set((before.nodes || []).map((node) => node.id));
    const textarea = document.querySelector(".ask-user-dialog textarea");
    if (!textarea) return { ok: false, error: "clarify textarea unavailable", before };
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      "采用 3:4 竖版、蓝金克制留白，请直接基于原任务和当前 SOURCE 生成图片。"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    Array.from(document.querySelectorAll(".ask-user-dialog footer button"))
      .find((item) => /发送给 Agent/.test(String(item.textContent || "")))?.click();
    const deadline = performance.now() + 50000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.() || {};
      const output = (state.nodes || []).find((node) => !beforeIds.has(node.id) && node.type === "image" && node.parentId === ${JSON.stringify(requirementId)} && node.imageState === "done" && Number(node.assetCount || 0) > 0);
      const requirement = (state.nodes || []).find((node) => node.id === ${JSON.stringify(requirementId)});
      if (!state.pendingAgentExecution && !state.askUserOpen && state.agentStatus === "idle" && output && Number(requirement?.requirement?.lastRunCount || 0) >= 1) {
        return { ok: true, output, requirement, state };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, state: window.__naimageDebugAgentState?.() };
  })()`, 60000) : { ok: false, error: "requirement unavailable" };
  checks.requirementClarify = Boolean(cleanStart?.conversation?.ok && requirementCreated?.ok && requirementAsk?.ok && requirementResume?.ok);

  const runPickerContinuation = async (kind, fixturePath) => {
    phase(`picker-${kind}-request`, { fixturePath });
    const prompt = kind === "source_images"
      ? `AIDEBUG_ASK_SOURCE ${marker} 缺少待处理原图，请先让我上传 SOURCE。`
      : `AIDEBUG_ASK_REFERENCE ${marker} 缺少风格参考图，请先让我上传 REFERENCE。`;
    const started = await evaluate(client, `window.__naimageAIDebug.chat(${JSON.stringify(prompt)}, { timeoutMs: 30000 })`, 40000);
    const expectedRole = kind === "source_images" ? "source" : "reference";
    phase(`picker-${kind}-verify-open`, { expectedRole });
    const opened = await evaluate(client, `(() => {
      const state = window.__naimageDebugAgentState?.() || {};
      return {
        ok: Boolean(state.referencePickerOpen && state.referencePickerRole === ${JSON.stringify(expectedRole)} && state.pendingAgentExecution?.kind === ${JSON.stringify(kind)}),
        state
      };
    })()`);
    phase(`picker-${kind}-add-file`, { expectedRole });
    const added = await evaluate(client, `window.__naimageAIDebug.addReferencePickerPaths({ paths: [${JSON.stringify(fixturePath)}] })`, 20000);
    phase(`picker-${kind}-resume`, { expectedRole, added: Number(added?.imageCount || 0) });
    const resumed = await evaluate(client, `(async () => {
      const before = window.__naimageDebugAgentState?.() || {};
      const beforeImageIds = new Set((before.nodes || []).filter((node) => node.type === "image").map((node) => node.id));
      Array.from(document.querySelectorAll(".reference-picker-dialog footer button"))
        .find((item) => String(item.textContent || "").trim() === "保存")?.click();
      const deadline = performance.now() + 50000;
      while (performance.now() < deadline) {
        const state = window.__naimageDebugAgentState?.() || {};
        const latestUser = [...(state.messages || [])].reverse().find((message) => message.role === "user");
        const roleCount = ${JSON.stringify(expectedRole)} === "source"
          ? Number(latestUser?.attachments?.sourceAssets?.length || 0)
          : Number(latestUser?.attachments?.referenceAssets?.length || 0);
        const output = (state.nodes || []).find((node) => node.type === "image" && !beforeImageIds.has(node.id) && node.imageState === "done" && Number(node.assetCount || 0) > 0);
        if (!state.pendingAgentExecution && !state.referencePickerOpen && state.agentStatus === "idle" && roleCount >= 1 && output) {
          return { ok: true, roleCount, output, latestUser, state };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { ok: false, state: window.__naimageDebugAgentState?.() };
    })()`, 60000);
    return { ok: Boolean(started?.ok && opened?.ok && added?.ok && added?.imageCount >= 1 && resumed?.ok), started, opened, added, resumed };
  };

  const sourceContinuation = await runPickerContinuation("source_images", fixturePaths[0]);
  checks.sourceImages = sourceContinuation.ok;
  phase("capture-source-resumed", { ok: sourceContinuation.ok });
  results.push(await captureState(client, targetId, "ask-user-source-resumed", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    askUserOpen: false,
    referencePickerOpen: false,
    agentIdle: true,
    imageNodeViewportOk: true
  }));

  const referenceContinuation = await runPickerContinuation("reference_images", fixturePaths[1]);
  checks.referenceImages = referenceContinuation.ok;

  phase("structured-confirm-options");
  const structuredConfirm = await evaluate(client, `(async () => {
    const ask = await window.__naimageAIDebug.chat("AIDEBUG_ASK_CONFIRM ${marker} 验证结构化批量策略选项。", { timeoutMs: 30000 });
    const openDeadline = performance.now() + 4000;
    while (performance.now() < openDeadline && !document.querySelector(".ask-user-dialog")) await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector(".ask-user-dialog");
    const options = Array.from(dialog?.querySelectorAll(".ask-user-option") || []);
    const labels = options.map((item) => String(item.textContent || "").replace(/\s+/g, " ").trim());
    const recommendedCount = options.filter((item) => item.querySelector("em")?.textContent?.trim() === "建议").length;
    const staged = options.find((item) => String(item.textContent || "").includes("阶段性批量"));
    staged?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const textarea = dialog?.querySelector("textarea");
    const state = window.__naimageDebugAgentState?.() || {};
    return {
      ok: Boolean(
        ask?.ok && dialog && options.length === 3 && recommendedCount === 1 && staged &&
        staged.getAttribute("aria-checked") === "true" &&
        String(textarea?.value || "").includes("按阶段分批生成") &&
        state.pendingAgentExecution?.options?.length === 3
      ),
      labels,
      recommendedCount,
      selectedAnswer: String(textarea?.value || ""),
      pendingOptions: state.pendingAgentExecution?.options || [],
      state
    };
  })()`, 40000);
  checks.structuredConfirmOptions = Boolean(structuredConfirm?.ok);
  results.push(await captureState(client, targetId, "ask-user-structured-options", "undefined", { width: 884, height: 720 }, {
    modalOpen: true,
    askUserOpen: true,
    modalWithinViewport: true,
    verticalOverflowFree: true
  }));
  const structuredConfirmClosed = await evaluate(client, `(async () => {
    const cancel = Array.from(document.querySelectorAll(".ask-user-dialog footer button"))
      .find((item) => String(item.textContent || "").trim() === "取消");
    cancel?.click();
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const current = window.__naimageDebugAgentState?.() || {};
      if (!current.pendingAgentExecution && !current.askUserOpen && !document.querySelector(".ask-user-dialog")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const state = window.__naimageDebugAgentState?.() || {};
    return { ok: Boolean(cancel && !state.pendingAgentExecution && !state.askUserOpen), state };
  })()`);
  checks.structuredConfirmClosed = Boolean(structuredConfirmClosed?.ok);

  phase("cancel-pending-then-run-fresh");
  const cancellation = await evaluate(client, `(async () => {
    const ask = await window.__naimageAIDebug.chat("AIDEBUG_ASK_CONFIRM ${marker} 请先确认这次测试任务。", { timeoutMs: 30000 });
    const openDeadline = performance.now() + 3000;
    while (performance.now() < openDeadline && !document.querySelector(".ask-user-dialog")) await new Promise((resolve) => setTimeout(resolve, 50));
    const cancel = Array.from(document.querySelectorAll(".ask-user-dialog footer button"))
      .find((item) => String(item.textContent || "").trim() === "取消");
    cancel?.click();
    const closeDeadline = performance.now() + 4000;
    while (performance.now() < closeDeadline && window.__naimageDebugAgentState?.().pendingAgentExecution) await new Promise((resolve) => setTimeout(resolve, 50));
    const before = window.__naimageDebugAgentState?.() || {};
    const beforeIds = new Set((before.nodes || []).filter((node) => node.type === "image").map((node) => node.id));
    const fresh = await window.__naimageAIDebug.chat("取消旧任务后，这是一条新的独立请求：请生成一张 1:1 极简蓝白测试图。", { timeoutMs: 40000 });
    const state = window.__naimageDebugAgentState?.() || {};
    const output = (state.nodes || []).find((node) => node.type === "image" && !beforeIds.has(node.id) && node.imageState === "done" && Number(node.assetCount || 0) > 0);
    return { ok: Boolean(ask?.ok && cancel && !state.pendingAgentExecution && !state.askUserOpen && fresh?.ok && output), ask, fresh, output, state };
  })()`, 90000);
  checks.cancelThenFreshTask = Boolean(cancellation?.ok);

  phase("new-conversation-isolation");
  const conversationIsolation = await evaluate(client, `(async () => {
    const ask = await window.__naimageAIDebug.chat("AIDEBUG_ASK_CLARIFY ${marker} 新会话隔离前的旧任务。", { timeoutMs: 30000 });
    const before = window.__naimageDebugAgentState?.() || {};
    const created = await window.__naimageAIDebug.newConversation();
    const after = window.__naimageDebugAgentState?.() || {};
    return {
      ok: Boolean(ask?.ok && before.pendingAgentExecution && created?.ok && created.conversationId !== before.activeConversationId && !after.pendingAgentExecution && !after.askUserOpen && after.messageCount === 0),
      ask,
      before,
      created,
      after
    };
  })()`, 70000);
  checks.newConversationIsolation = Boolean(conversationIsolation?.ok);

  phase("persist-pending-before-reload");
  const persistenceStarted = await evaluate(client, `window.__naimageAIDebug.chat("AIDEBUG_ASK_SOURCE ${marker} 请保存并在界面重载后恢复这个 SOURCE 请求。", { timeoutMs: 30000 })`, 40000);
  await waitForExpression(client, "Boolean(window.__naimageDebugAgentState?.().pendingAgentExecution?.kind === 'source_images' && window.__naimageDebugAgentState?.().referencePickerOpen)", 6000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  phase("reload-renderer-with-pending-request");
  await client.send("Page.reload", { ignoreCache: true });
  await waitForExpression(client, "Boolean(window.__naimageAIDebug?.addReferencePickerPaths && window.__naimageDebugAgentState)", 15000);
  await waitForExpression(
    client,
    "Boolean(window.__naimageDebugAgentState?.().pendingAgentExecution?.kind === 'source_images' && document.querySelector('[data-ui-surface=\"reference-picker\"]') && Array.from(document.querySelectorAll('[data-ui-surface=\"reference-picker\"] [aria-label]')).some((item) => item.getAttribute('aria-label') === '添加原图'))",
    10000
  );
  phase("verify-restored-after-reload");
  const restoredAfterReload = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    const picker = document.querySelector('[data-ui-surface="reference-picker"]');
    const sourceSlots = Array.from(picker?.querySelectorAll("[aria-label]") || [])
      .filter((item) => String(item.getAttribute("aria-label") || "") === "添加原图").length;
    return {
      ok: Boolean(state.pendingAgentExecution?.kind === "source_images" && picker && sourceSlots > 0),
      sourceSlots,
      state
    };
  })()`);
  checks.reloadPersistence = Boolean(persistenceStarted?.ok && restoredAfterReload?.ok);
  phase("capture-restored-picker", { ok: checks.reloadPersistence });
  results.push(await captureState(client, targetId, "ask-user-source-restored-after-reload", "undefined", { width: 884, height: 720 }, {
    modalOpen: true,
    referencePickerOpen: true,
    modalWithinViewport: true,
    verticalOverflowFree: true
  }));
  await evaluate(client, `(() => {
    const cancel = Array.from(document.querySelectorAll(".reference-picker-dialog footer button"))
      .find((item) => String(item.textContent || "").trim() === "取消");
    cancel?.click();
    return Boolean(cancel);
  })()`);
  await waitForExpression(client, "!window.__naimageDebugAgentState?.().pendingAgentExecution && !window.__naimageDebugAgentState?.().referencePickerOpen", 5000);

  phase("staged-multi-source-result-layout");
  const stagedTaskResult = await evaluate(client, `(async () => {
    await window.__naimageAIDebug.newConversation();
    const seeded = await window.__naimageAIDebug.seedCanvas({ count: 2, fileBacked: true });
    const sourceIds = (seeded?.state?.nodes || []).filter((node) => node.type === "image").map((node) => node.id).slice(-2);
    await window.__naimageAIDebug.selectNodes({ ids: sourceIds, primaryId: sourceIds[0] });
    const before = window.__naimageDebugAgentState?.() || {};
    const beforeIds = new Set((before.nodes || []).map((node) => node.id));
    const ask = await window.__naimageAIDebug.chat(
      "AIDEBUG_ASK_CONFIRM ${marker} 请基于当前两个 SOURCE 分别生成一张 1:1 蓝金商品测试图。",
      { timeoutMs: 30000 }
    );
    const openDeadline = performance.now() + 5000;
    while (performance.now() < openDeadline && !document.querySelector(".ask-user-dialog")) await new Promise((resolve) => setTimeout(resolve, 50));
    const pending = window.__naimageDebugAgentState?.().pendingAgentExecution;
    const staged = Array.from(document.querySelectorAll(".ask-user-dialog .ask-user-option"))
      .find((item) => String(item.textContent || "").includes("阶段性批量"));
    staged?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const submit = Array.from(document.querySelectorAll(".ask-user-dialog footer button"))
      .find((item) => /发送给 Agent/.test(String(item.textContent || "")));
    submit?.click();
    const deadline = performance.now() + 70000;
    while (performance.now() < deadline) {
      const state = window.__naimageDebugAgentState?.() || {};
      const outputs = (state.nodes || []).filter((node) => (
        !beforeIds.has(node.id) && node.type === "image" && node.imageState === "done" &&
        Number(node.assetCount || 0) > 0 && node.taskProvenance?.taskScopeSnapshotHash
      ));
      if (!state.pendingAgentExecution && !state.askUserOpen && state.agentStatus === "idle" && outputs.length >= 2) {
        const dispatched = state.lastDispatchedTaskScope || {};
        const hashes = [...new Set(outputs.map((node) => node.taskProvenance?.taskScopeSnapshotHash).filter(Boolean))];
        const bindings = outputs.map((node) => node.taskProvenance?.sourceBindingId).filter(Boolean).sort();
        const expectedBindings = [...(dispatched.sourceBindingIds || [])].sort();
        const containerKinds = outputs.map((node) => node.imageContainerSpec?.kind || "");
        return {
          ok: Boolean(
            seeded?.ok && sourceIds.length === 2 && ask?.ok && pending?.taskScope?.sourceAssetCount === 2 && staged && submit &&
            dispatched.confirmationPolicy === "staged" && dispatched.sourceAssetCount === 2 &&
            hashes.length === 1 && hashes[0] === dispatched.snapshotHash &&
            bindings.length === 2 && JSON.stringify(bindings) === JSON.stringify(expectedBindings) &&
            containerKinds.every((kind) => kind === "batch-result")
          ),
          pendingHash: pending?.taskScope?.snapshotHash,
          pendingPolicy: pending?.taskScope?.confirmationPolicy,
          sourceIds,
          dispatched,
          hashes,
          bindings,
          expectedBindings,
          containerKinds,
          outputIds: outputs.map((node) => node.id),
          state
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, ask, pending, state: window.__naimageDebugAgentState?.() };
  })()`, 110000);
  checks.stagedMultiSourceResultLayout = Boolean(stagedTaskResult?.ok);

  phase("capture-final");
  const finalCapture = await captureState(client, targetId, "ask-user-continuation-final", "window.__naimageAIDebug?.fitCanvas?.()", { width: 1280, height: 820 }, {
    modalOpen: false,
    askUserOpen: false,
    referencePickerOpen: false,
    agentIdle: true,
    imageNodeViewportOk: true
  });
  const suite = {
    ok: Boolean(Object.values(checks).every(Boolean) && results.every(captureHealthy) && captureHealthy(finalCapture)),
    marker,
    fixtureIds: { requirementSourceId, requirementId },
    checks,
    cleanStart,
    requirementCreated,
    requirementAsk,
    requirementResume,
    sourceContinuation,
    referenceContinuation,
    structuredConfirm,
    structuredConfirmClosed,
    cancellation,
    conversationIsolation,
    persistenceStarted,
    restoredAfterReload,
    stagedTaskResult
  };
  finalCapture.suite = suite;
  if (!suite.ok) finalCapture.stateIssues.push({ key: "askUserContinuationSuite", expected: true, actual: suite });
  results.push(finalCapture);
  const suitePath = join(runDir, "ask-user-continuation-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  recordObservation(suite.ok ? "info" : "issue", suite.ok ? "ask-user-continuation-suite-success" : "ask-user-continuation-suite-failed", { suitePath, checks });
  return results;
}
