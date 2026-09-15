export async function captureUiSurfaceSuite({ client, targetId, captureState, openSurfaceExpression, workbenchMinWidth }) {
  const captures = [];
  const manualExpected = {
    settingsOpen: false,
    accountOpen: false,
    modalOpen: true,
    imageTaskOpen: true,
    manualImageTaskControlsOk: true,
    manualImageTaskLayoutOk: true,
    dialogLayoutKind: "manual-image-task",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true,
    modalWithinViewport: true
  };
  captures.push(await captureState(client, targetId, "ui-manual-image-task-1280", openSurfaceExpression("image-task"), { width: 1280, height: 820 }, manualExpected));
  captures.push(await captureState(client, targetId, "ui-manual-image-task-min-884", openSurfaceExpression("image-task"), { width: workbenchMinWidth, height: 720 }, { ...manualExpected, imageNodeViewportOk: true }));

  const referenceExpression = openSurfaceExpression("image-task", `
    document.querySelector(".manual-image-reference-button")?.click();
    const deadline = Date.now() + 2400;
    while (Date.now() < deadline && !document.querySelector('[data-ui-surface="reference-picker"]')) await delay(40);
  `);
  const referenceExpected = {
    settingsOpen: false,
    accountOpen: false,
    modalOpen: true,
    imageTaskOpen: true,
    referencePickerOpen: true,
    dialogLayoutKind: "reference-picker",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true,
    modalWithinViewport: true
  };
  captures.push(await captureState(client, targetId, "ui-reference-picker-1280", referenceExpression, { width: 1280, height: 820 }, referenceExpected));
  captures.push(await captureState(client, targetId, "ui-reference-picker-min-884", referenceExpression, { width: workbenchMinWidth, height: 720 }, { ...referenceExpected, imageNodeViewportOk: true }));

  const filledReferenceExpression = openSurfaceExpression("agent-running-references", `
    const triggerDeadline = Date.now() + 2400;
    while (Date.now() < triggerDeadline && !document.querySelector(".project-agent-materials-trigger")) await delay(40);
    document.querySelector(".project-agent-materials-trigger")?.click();
    const menuDeadline = Date.now() + 1800;
    while (Date.now() < menuDeadline && !document.querySelector(".project-agent-materials-menu")) await delay(40);
    const referenceItem = Array.from(document.querySelectorAll(".project-agent-materials-menu [role=menuitem]"))
      .find((item) => String(item.textContent || "").includes("参考图"));
    referenceItem?.click();
    const pickerDeadline = Date.now() + 2400;
    while (Date.now() < pickerDeadline && !document.querySelector('[data-ui-surface="reference-picker"] .reference-slot.filled')) await delay(40);
  `);
  const filledReferenceExpected = {
    ...referenceExpected,
    imageTaskOpen: false
  };
  captures.push(await captureState(client, targetId, "ui-reference-picker-filled-1280", filledReferenceExpression, { width: 1280, height: 820 }, filledReferenceExpected));
  captures.push(await captureState(client, targetId, "ui-reference-picker-filled-min-884", filledReferenceExpression, { width: workbenchMinWidth, height: 720 }, { ...filledReferenceExpected, imageNodeViewportOk: true }));

  const manualSubmitExpression = `new Promise((resolve) => {
    const delay = (ms) => new Promise((done) => setTimeout(done, ms));
    const setNativeValue = (node, value) => {
      if (!node) return false;
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(node, value);
      node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      return true;
    };
    (async () => {
      window.__naimageDebugOpenSurface?.("main");
      await delay(120);
      const beforeState = window.__naimageDebugAgentState?.() || {};
      const beforeIds = new Set((beforeState.nodes || []).map((node) => node.id));
      const beforeMessageIds = new Set((beforeState.messages || []).map((message) => message.id));
      window.__naimageDebugOpenSurface?.("image-task");
      const openDeadline = Date.now() + 2400;
      while (Date.now() < openDeadline && !document.querySelector(".manual-image-task-dialog")) await delay(40);
      const dialog = document.querySelector(".manual-image-task-dialog");
      const prompt = dialog?.querySelector("textarea");
      const selects = Array.from(dialog?.querySelectorAll("select") || []);
      const ratio = selects[0];
      const resolution = selects[1];
      const quality = selects[2];
      const count = selects[3];
      const promptText = "AIDebug 手动生图闭环：生成两张简洁的东方配色商品视觉测试图。";
      const promptSet = setNativeValue(prompt, promptText);
      const ratioSet = setNativeValue(ratio, "3:4");
      const qualitySet = setNativeValue(quality, "high");
      const countSet = setNativeValue(count, "2");
      await delay(120);
      const submit = Array.from(dialog?.querySelectorAll("button") || []).find((button) => String(button.textContent || "").replace(/\s+/g, "").includes("生成图片"));
      submit?.click();
      submit?.click();
      const resultDeadline = Date.now() + 12000;
      let afterState = window.__naimageDebugAgentState?.() || {};
      let newNodes = [];
      let producedAssets = 0;
      let collectionNodes = [];
      while (Date.now() < resultDeadline) {
        afterState = window.__naimageDebugAgentState?.() || {};
        newNodes = (afterState.nodes || []).filter((node) => !beforeIds.has(node.id) && node.type === "image");
        producedAssets = newNodes.reduce((total, node) => total + Math.max(0, Number(node.assetCount || 0)), 0);
        collectionNodes = newNodes.filter((node) => node.imageCollection?.kind === "batch" && node.imageCollection?.generationMode === "parallel");
        if (!document.querySelector(".manual-image-task-dialog") && producedAssets >= 2 && collectionNodes.some((node) => node.imageCollection.items.length >= 2)) break;
        await delay(80);
      }
      const timelineMessages = (Array.isArray(afterState.messages) ? afterState.messages : [])
        .filter((message) => !beforeMessageIds.has(message.id));
      const timelineUsers = timelineMessages.filter((message) => message.role === "user" && String(message.content || "").includes(promptText));
      const startCards = timelineMessages.filter((message) => message.toolTrace?.name === "image_gen" && message.toolTrace?.stage === "start" &&
        message.toolTrace?.prompts?.some((item) => String(item.prompt || "").includes(promptText)));
      const operationId = String(startCards[0]?.toolTrace?.operationId || "");
      const operationCards = timelineMessages.filter((message) => message.toolTrace?.name === "image_gen" &&
        String(message.toolTrace?.operationId || "") === operationId);
      const resultCards = operationCards.filter((message) => message.toolTrace?.stage === "result");
      const timelineIdentityOk = Boolean(operationId) && startCards.length === 1 && resultCards.length === 1 && operationCards.length === 2;
      const timelineParams = String(startCards[0]?.toolTrace?.params || "");
      const timelineParamsOk = /3:4/.test(timelineParams) && /720P|1K|2K|4K/.test(timelineParams) && /精细/.test(timelineParams) && /2 张/.test(timelineParams);
      window.__naimageManualTaskProbe = {
        // Manual image tasks are intentionally independent of the Agent
        // timeline. Keep the observable task/result checks here and let the
        // Agent timeline contract cover Agent-originated image runs.
        ok: Boolean(dialog && promptSet && ratioSet && qualitySet && countSet && submit && !document.querySelector(".manual-image-task-dialog") && newNodes.length === 1 && producedAssets >= 2 && collectionNodes.length === 1 && collectionNodes[0]?.imageCollection.items.length >= 2),
        promptSet,
        ratioSet,
        qualitySet,
        countSet,
        submitFound: Boolean(submit),
        dialogClosed: !document.querySelector(".manual-image-task-dialog"),
        newNodeIds: newNodes.map((node) => node.id),
        newNodeCount: newNodes.length,
        producedAssets,
        collectionCount: collectionNodes.length,
        collectionItemCounts: collectionNodes.map((node) => node.imageCollection.items.length),
        timelineUserVisible: timelineUsers.length === 1,
        timelineUserCount: timelineUsers.length,
        timelineIdentityOk,
        timelineParams,
        timelineParamsOk,
        timelineToolCardCount: operationCards.length,
        resolution: String(resolution?.value || "")
      };
      resolve(true);
    })();
  })`;
  captures.push(await captureState(client, targetId, "ui-manual-image-task-submit-1280", manualSubmitExpression, { width: 1280, height: 820 }, {
    settingsOpen: false,
    accountOpen: false,
    modalOpen: false,
    imageTaskOpen: false,
    manualImageTaskSubmitOk: true,
    imageNodeViewportOk: true
  }, 20000));

  const promptExpression = openSurfaceExpression("settings", `
    const agentTab = Array.from(document.querySelectorAll(".settings-section-tab"))
      .find((button) => String(button.textContent || "").trim() === "Agent");
    agentTab?.click();
    const agentDeadline = Date.now() + 1800;
    while (Date.now() < agentDeadline && !document.querySelector(".settings-prompt-action")) await delay(40);
    document.querySelector(".settings-prompt-action")?.click();
    const deadline = Date.now() + 2400;
    while (Date.now() < deadline && !document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 提示词"]')) await delay(40);
  `);
  const promptExpected = {
    settingsOpen: true,
    accountOpen: false,
    agentTextEditorOpen: true,
    agentTextEditorKind: "编辑 Agent 提示词",
    dialogLayoutKind: "agent-prompt",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true
  };
  captures.push(await captureState(client, targetId, "ui-agent-prompt-editor-1280", promptExpression, { width: 1280, height: 820 }, promptExpected));
  captures.push(await captureState(client, targetId, "ui-agent-prompt-editor-min-884", promptExpression, { width: workbenchMinWidth, height: 720 }, { ...promptExpected, imageNodeViewportOk: true }));

  const memoryExpression = openSurfaceExpression("main", `
    document.querySelector('.project-agent-header-actions button[aria-label="编辑 Agent 记忆"]')?.click();
    const deadline = Date.now() + 2400;
    while (Date.now() < deadline && !document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 记忆"]')) await delay(40);
  `);
  const memoryExpected = {
    settingsOpen: false,
    accountOpen: false,
    agentTextEditorOpen: true,
    agentTextEditorKind: "编辑 Agent 记忆",
    dialogLayoutKind: "fast-memory",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true
  };
  captures.push(await captureState(client, targetId, "ui-fast-memory-editor-1280", memoryExpression, { width: 1280, height: 820 }, memoryExpected));
  captures.push(await captureState(client, targetId, "ui-fast-memory-editor-min-884", memoryExpression, { width: workbenchMinWidth, height: 720 }, { ...memoryExpected, imageNodeViewportOk: true }));

  const exportCenterExpression = openSurfaceExpression("main", `
    document.querySelector(".file-command-menu > button")?.click();
    const menuDeadline = Date.now() + 2400;
    while (Date.now() < menuDeadline && !document.querySelector(".file-command-popover")) await delay(40);
    const exportButton = Array.from(document.querySelectorAll(".file-command-list button"))
      .find((button) => String(button.textContent || "").replace(/\s+/g, "").includes("导出中心"));
    exportButton?.click();
    const dialogDeadline = Date.now() + 3600;
    while (Date.now() < dialogDeadline && !document.querySelector(".export-center-dialog")) await delay(40);
  `);
  const exportCenterExpected = {
    settingsOpen: false,
    accountOpen: false,
    modalOpen: true,
    exportCenterOpen: true,
    exportCenterControlsOk: true,
    exportCenterLayoutOk: true,
    dialogLayoutKind: "export-center",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true,
    modalWithinViewport: true
  };
  captures.push(await captureState(client, targetId, "ui-export-center-1280", exportCenterExpression, { width: 1280, height: 820 }, exportCenterExpected));
  captures.push(await captureState(client, targetId, "ui-export-center-min-884", exportCenterExpression, { width: workbenchMinWidth, height: 720 }, { ...exportCenterExpected, imageNodeViewportOk: true }));

  const exportCenterFlowExpression = openSurfaceExpression("main", `
    const setNativeValue = (node, value) => {
      if (!node) return false;
      const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(node, value);
      node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      return true;
    };
    const mark = (phase, details = {}) => {
      window.__naimageExportCenterProbe = { phase, ...details };
      console.info("[AIDebug export-center]", phase, details);
    };
    const waitFor = async (predicate, timeout = 3000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await delay(40);
      }
      return predicate();
    };
    mark("seed-start");
    const seed = await window.__naimageAIDebug?.seedCanvas?.({ count: 2, fileBacked: true });
    mark("seed-done", { seedOk: seed?.ok === true });
    document.querySelector(".file-command-menu > button")?.click();
    await waitFor(() => document.querySelector(".file-command-popover"), 2400);
    const exportButton = Array.from(document.querySelectorAll(".file-command-list button"))
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "").includes("导出中心"));
    exportButton?.click();
    const currentDialog = () => document.querySelector(".export-center-dialog");
    const dialogOpened = Boolean(await waitFor(currentDialog, 3600));
    // seedCanvas commits through the normal runtime action path. The dialog can
    // mount before that commit reaches its source props, so wait for the real
    // source rows instead of treating the initial empty render as a failure.
    const sourceRowsReady = Boolean(await waitFor(
      () => currentDialog()?.querySelectorAll(".export-center-source-row").length === 2,
      10000
    ));
    mark("dialog-open", {
      dialog: dialogOpened,
      sourceRows: currentDialog()?.querySelectorAll(".export-center-source-row").length || 0,
      sourceRowsReady
    });
    const targetButton = (label) => Array.from(currentDialog()?.querySelectorAll(".export-center-targets button") || [])
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "").startsWith(label));
    const viewButton = (label) => Array.from(currentDialog()?.querySelectorAll(".export-center-view-tabs button") || [])
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "").startsWith(label));
    targetButton("图片")?.click();
    await delay(80);
    const selectAll = Array.from(currentDialog()?.querySelectorAll("button") || [])
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "") === "全选");
    selectAll?.click();
    const selectAllApplied = Boolean(await waitFor(
      () => currentDialog()?.querySelectorAll(".export-center-source-row input:checked").length === 2,
      3000
    ));
    const selectedImages = currentDialog()?.querySelectorAll(".export-center-source-row input:checked").length || 0;
    mark("image-selected", { selectAllFound: Boolean(selectAll), selectAllApplied, selectedImages });
    targetButton("PSD")?.click();
    await delay(300);
    const psdMapped = currentDialog()?.querySelectorAll(".export-center-source-row input:checked").length === 2;
    mark("psd-mapped", { psdMapped, checked: currentDialog()?.querySelectorAll(".export-center-source-row input:checked").length || 0 });
    targetButton("图片")?.click();
    await delay(80);
    const presetName = "AIDebug 图片交付预设";
    const presetInput = currentDialog()?.querySelector('.export-center-preset-row input');
    const presetNameSet = setNativeValue(presetInput, presetName);
    currentDialog()?.querySelector('button[aria-label="保存预设"]')?.click();
    const presetSaved = Boolean(await waitFor(() => Array.from(currentDialog()?.querySelectorAll(".export-center-preset-row option") || [])
      .some((option) => String(option.textContent || "").trim() === presetName)));
    mark("preset-saved", { presetNameSet, presetSaved });
    const previewButton = Array.from(currentDialog()?.querySelectorAll(".export-center-preview button") || [])
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "").includes("预检"));
    previewButton?.click();
    const previewReady = Boolean(await waitFor(() => String(currentDialog()?.querySelector(".export-center-global-notice")?.textContent || "").includes("预检完成"), 3000));
    mark("preview-done", { previewReady });
    const enqueueButton = Array.from(currentDialog()?.querySelectorAll("button") || [])
      .find((button) => String(button.textContent || "").replace(/\\s+/g, "").includes("加入导出队列"));
    enqueueButton?.click();
    mark("queue-start", { enqueueFound: Boolean(enqueueButton) });
    const succeededJob = await waitFor(() => currentDialog()?.querySelector('.export-center-job-row[data-job-status="succeeded"]'), 45000);
    mark("queue-done", { succeeded: Boolean(succeededJob) });
    viewButton("历史")?.click();
    const historyRow = await waitFor(() => currentDialog()?.querySelector('.export-center-history-row[data-history-status="succeeded"]'), 10000);
    const historyText = String(historyRow?.textContent || "").replace(/\\s+/g, " ").trim();
    const relativePathVisible = historyText.includes("exports/images/") && !/[A-Za-z]:[\\\\/]/.test(historyText);
    window.__naimageExportCenterProbe = {
      ok: Boolean(seed?.ok && dialogOpened && exportButton && sourceRowsReady && selectAll && selectAllApplied && selectedImages === 2 && psdMapped && presetNameSet && presetSaved && previewReady && enqueueButton && succeededJob && historyRow && relativePathVisible),
      seedOk: seed?.ok === true,
      sourceCount: currentDialog()?.querySelectorAll(".export-center-source-row").length || 0,
      sourceRowsReady,
      selectAllFound: Boolean(selectAll),
      selectAllApplied,
      selectedImages,
      psdMapped,
      presetNameSet,
      presetSaved,
      previewReady,
      jobStatus: succeededJob?.getAttribute("data-job-status") || "",
      historyStatus: historyRow?.getAttribute("data-history-status") || "",
      relativePathVisible,
      historyText
    };
  `);
  captures.push(await captureState(client, targetId, "ui-export-center-flow-1280", exportCenterFlowExpression, { width: 1280, height: 820 }, {
    settingsOpen: false,
    accountOpen: false,
    modalOpen: true,
    exportCenterOpen: true,
    exportCenterLayoutOk: true,
    dialogLayoutKind: "export-center",
    dialogLayoutMiddleFillOk: true,
    dialogLayoutNestedScrollOk: true,
    modalWithinViewport: true,
    exportCenterFlowOk: true,
    imageNodeViewportOk: true
  }, 100000));
  return captures;
}
