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
    while (Date.now() < triggerDeadline && !document.querySelector(".project-agent-references")) await delay(40);
    document.querySelector(".project-agent-references")?.click();
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
        ok: Boolean(dialog && promptSet && ratioSet && qualitySet && countSet && submit && !document.querySelector(".manual-image-task-dialog") && newNodes.length === 1 && producedAssets >= 2 && collectionNodes.length === 1 && collectionNodes[0]?.imageCollection.items.length >= 2 && timelineUsers.length === 1 && timelineIdentityOk && timelineParamsOk),
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
  return captures;
}
