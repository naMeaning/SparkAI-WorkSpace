"use strict";

function registerAgentIpc({
  ipcMain,
  currentAgentSettings,
  getAgentRuntime,
  log,
  listAgentModels,
  emitAgentProgress,
  agentRunControl,
  aidebugMode
}) {
  const runScope = (payload = {}, runId = "") => ({
    runId,
    projectId: String(payload?.projectId || "default"),
    conversationId: String(payload?.conversationId || "default"),
    nodeIds: [...new Set([
      ...(Array.isArray(payload?.selectedNodeIds) ? payload.selectedNodeIds : []),
      ...(Array.isArray(payload?.taskScope?.sourceNodeIds) ? payload.taskScope.sourceNodeIds : []),
      ...(Array.isArray(payload?.taskScope?.sourceContainerIds) ? payload.taskScope.sourceContainerIds : []),
      payload?.selectedNodeId,
      payload?.taskScope?.requirement?.nodeId
    ].map((value) => String(value || "").trim()).filter(Boolean))]
  });

  const beginRun = (payload, runId) => agentRunControl?.begin(runScope(payload, runId)) || {
    signal: undefined,
    projectId: String(payload?.projectId || "default"),
    conversationId: String(payload?.conversationId || "default")
  };

  const finishRun = (runId) => agentRunControl?.finish({ runId });

  ipcMain.handle("naimage:agent:tools", () => {
    try {
      const settings = currentAgentSettings();
      return { ok: true, tools: getAgentRuntime().getToolSchemas(settings) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent tools failed ${message}`);
      return { ok: false, error: message, tools: [] };
    }
  });

  ipcMain.handle("naimage:agent:list-models", async (_event, payload = {}) => {
    const provider = payload?.provider === "image" ? "image" : "agent";
    try {
      return await listAgentModels(provider, payload?.settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent list models fallback ${message}`);
      try {
        return await getAgentRuntime().listModels({ ...(payload || {}), provider, settings: currentAgentSettings() });
      } catch (fallbackError) {
        return {
          ok: false,
          provider,
          models: [],
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        };
      }
    }
  });

  ipcMain.handle("naimage:agent:run-tool", async (event, payload = {}) => {
    const name = String(payload?.name || "").trim();
    const runId = String(payload?.runId || `agent-tool-${Date.now()}`);
    if (!name) return { envelope: { ok: false, summary: "缺少工具名称。", error: "missing tool name" }, actions: [] };
    if (name !== "image_gen" && !aidebugMode) {
      return {
        envelope: {
          ok: false,
          tool: name,
          summary: "当前工作台只允许执行图片生成与修改。",
          error: "unsupported public agent tool"
        },
        actions: []
      };
    }
    let controlledRun;
    try {
      controlledRun = beginRun(payload, runId);
      const settings = currentAgentSettings();
      const result = await getAgentRuntime().runTool(name, payload?.input ?? {}, {
        settings,
         nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
         selectedNodeId: payload?.selectedNodeId,
         selectedNodeIds: Array.isArray(payload?.selectedNodeIds) ? payload.selectedNodeIds : [],
         taskScope: payload?.taskScope && typeof payload.taskScope === "object" ? payload.taskScope : undefined,
         referenceImages: Array.isArray(payload?.referenceImages) ? payload.referenceImages : [],
        projectId: payload?.projectId,
        conversationId: payload?.conversationId,
        prompt: String(payload?.prompt || payload?.input?.prompt || ""),
        runId,
        operationId: runId,
        toolRunId: runId,
        signal: controlledRun.signal,
        waitUntilRunnable: (signal) => agentRunControl?.waitUntilRunnable(controlledRun, signal),
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent run tool failed ${name} ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "tool-error", tool: name, summary: message }, payload);
      return { envelope: { ok: false, tool: name, summary: message, error: message }, actions: [] };
    } finally {
      if (controlledRun) finishRun(runId);
    }
  });

  ipcMain.handle("naimage:agent:compose-image-prompt", async (event, payload = {}) => {
    const runId = String(payload?.runId || `agent-compose-${Date.now()}`);
    try {
      return await getAgentRuntime().composeImagePrompt({
        ...(payload || {}),
        settings: currentAgentSettings(),
        runId,
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent compose image prompt failed ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "runtime-error", tool: "image_gen", summary: message }, payload);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:agent:chat", async (event, payload = {}) => {
    const runId = String(payload?.runId || `agent-chat-${Date.now()}`);
    let controlledRun;
    try {
      controlledRun = beginRun(payload, runId);
      const result = await getAgentRuntime().chat({
        ...(payload || {}),
        settings: currentAgentSettings(),
        runId,
        signal: controlledRun.signal,
        waitUntilRunnable: (signal) => agentRunControl?.waitUntilRunnable(controlledRun, signal),
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent chat failed ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "runtime-error", summary: message }, payload);
      return { ok: false, error: message, content: "" };
    } finally {
      if (controlledRun) finishRun(runId);
    }
  });

  ipcMain.handle("naimage:agent:pause", (_event, payload = {}) => {
    try {
      return agentRunControl?.pause(payload) || { ok: false, error: "运行控制器不可用。" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:resume", (_event, payload = {}) => {
    try {
      return agentRunControl?.resume(payload) || { ok: false, error: "运行控制器不可用。" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:stop", (_event, payload = {}) => {
    try {
      return agentRunControl?.stop(payload) || { ok: false, error: "运行控制器不可用。" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:run-status", (_event, payload = {}) => {
    try {
      return agentRunControl?.snapshot(payload?.projectId) || { ok: false, error: "运行控制器不可用。" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:compact", (_event, payload = {}) => {
    try {
      return getAgentRuntime().compact(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:memory-check", (_event, payload = {}) => {
    try {
      return getAgentRuntime().memoryCheck(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:memory-read", (_event, payload = {}) => {
    try {
      return getAgentRuntime().memoryRead(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:main-prompt:get", () => {
    try {
      return getAgentRuntime().getMainPrompt();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:main-prompt:save", (_event, payload = {}) => {
    try {
      return getAgentRuntime().saveMainPrompt(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:main-prompt:reset", () => {
    try {
      return getAgentRuntime().resetMainPrompt();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:fast-memory:get", (_event, payload = {}) => {
    try {
      return getAgentRuntime().getFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:fast-memory:save", (_event, payload = {}) => {
    try {
      return getAgentRuntime().saveFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:fast-memory:reset", (_event, payload = {}) => {
    try {
      return getAgentRuntime().resetFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:clear-conversation", (_event, payload = {}) => {
    try {
      return getAgentRuntime().clearConversationState(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:smoke", () => {
    try {
      return getAgentRuntime().smokeTest();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:agent:cancel-pending-execution", (_event, payload = {}) => {
    try {
      return getAgentRuntime().cancelPendingExecutionState(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = {
  registerAgentIpc
};
