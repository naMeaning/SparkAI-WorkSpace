"use strict";

// Credential-free policy shared by the single runtime and Main providers.
// Main alone issues bindings; this module never resolves an endpoint or key.
const fail = (code, message) => Object.assign(new Error(message), { code, retriable: false });
const KINDS = new Set(["cloud", "local-openai-compatible", "managed-local"]);

function agentExecutionForSettings(settings = {}) {
  const value = settings.agentExecution;
  if (value === undefined) return null; // Existing cloud settings remain readable.
  if (!value || !KINDS.has(value.providerKind) || typeof value.modelId !== "string" || !value.modelId.trim()
    || typeof value.strictOffline !== "boolean" || typeof value.capabilities?.tools !== "boolean"
    || typeof value.capabilities?.vision !== "boolean") throw fail("AGENT_PROVIDER_INVALID", "Agent 执行配置无效，请重新选择连接。");
  if (value.providerKind !== "cloud" && value.networkScope !== "local") throw fail("AGENT_PROVIDER_INVALID", "本地 Agent 只允许本机连接。");
  if (value.strictOffline && value.providerKind === "cloud") throw fail("AGENT_OFFLINE_BLOCKED", "严格离线模式不能使用云端 Agent。");
  return value;
}

function localImageConfigured(settings = {}) {
  return settings.imageProvider === "comfyui" && typeof settings.comfyui?.connectionId === "string"
    && Boolean(settings.comfyui.connectionId) && Boolean(settings.comfyui.workflowId || settings.comfyui.templateId);
}

function assertAgentToolAllowed(settings = {}, name, input = {}) {
  const execution = agentExecutionForSettings(settings);
  if (!execution) return;
  if (!execution.capabilities.tools) throw fail("AGENT_TOOLS_UNAVAILABLE", "当前本地模型未声明工具调用能力。");
  if (!execution.capabilities.vision && name === "view_image") throw fail("AGENT_VISION_UNAVAILABLE", "当前模型没有视觉能力，无法读取图片像素。");
  if (name === "web_search" && (execution.providerKind !== "cloud" || execution.strictOffline)) throw fail("AGENT_OFFLINE_BLOCKED", "当前 Agent 连接不支持联网搜索。");
  if (execution.strictOffline && name === "shell_command") throw fail("AGENT_OFFLINE_BLOCKED", "严格离线模式禁用可启动网络程序的 Shell 工具。");
  if (name === "image_gen") {
    if (execution.strictOffline && !localImageConfigured(settings)) throw fail("AGENT_OFFLINE_IMAGE_UNCONFIGURED", "严格离线生图需要显式选择本机 ComfyUI 连接与审核工作流。");
    if (!execution.capabilities.vision && String(input.operation || input.mode || "") === "layers") throw fail("AGENT_VISION_UNAVAILABLE", "当前模型没有视觉能力，无法执行分层视觉验证。");
    if (settings.imageProvider === "comfyui") {
      if (String(input.operation || "") === "layers") throw fail("AGENT_LOCAL_IMAGE_UNSUPPORTED", "所选 ComfyUI 工作流没有声明分层能力。");
      const frozenFields = ["ratio", "resolution", "quality", "model", "size", "width", "height", "outputFormat", "outputCompression", "background", "inputFidelity", "moderation"];
      if ([input, ...(Array.isArray(input.items) ? input.items : [])].some(item => item && frozenFields.some(key => item[key] !== undefined))) throw fail("AGENT_LOCAL_IMAGE_PARAMETERS", "ComfyUI 的工作流、模型和画幅由用户配置，请只提交提示词与受管素材选择。");
    }
  }
}

function filterAgentTools(settings = {}, tools = []) {
  return tools.filter(tool => {
    try { assertAgentToolAllowed(settings, tool.function?.name || tool.name || tool.type); return true; }
    catch { return false; }
  });
}

function hasImageParts(value) {
  if (!value || typeof value !== "object") return false;
  if (["input_image", "image_url", "image"].includes(value.type)) return true;
  return Array.isArray(value) ? value.some(hasImageParts) : Object.values(value).some(hasImageParts);
}

function assertAgentModelRequest(settings = {}, request = {}) {
  const execution = agentExecutionForSettings(settings);
  if (!execution) return;
  if (execution.providerKind !== "cloud" && String(request.model || "") !== execution.modelId) throw fail("AGENT_MODEL_CONFLICT", "本轮 Agent 模型已冻结，不能替换模型或回退到云端。");
  if (!execution.capabilities.vision && hasImageParts(request.messages)) throw fail("AGENT_VISION_UNAVAILABLE", "当前模型没有视觉能力，图片像素请求已拒绝。");
  for (const tool of request.tools || []) assertAgentToolAllowed(settings, tool.function?.name || tool.name || tool.type);
}

// Durable task receipts contain identity and capability only, never the live
// binding, endpoint, credential, settings or paths owned by Main.
function agentExecutionReceipt(value) {
  const execution = agentExecutionForSettings({ agentExecution: value });
  if (!execution) throw fail("AGENT_PROVIDER_RECOVERY_INVALID", "任务缺少有效的 Agent 身份记录。");
  const identifier = key => {
    const pattern = key === "modelId" ? /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,159}$/ : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
    if (typeof execution[key] !== "string" || !pattern.test(execution[key]) || execution[key].includes("://")) throw fail("AGENT_PROVIDER_RECOVERY_INVALID", "任务 Agent 身份记录无效。");
    return execution[key];
  };
  const hash = key => {
    if (typeof execution[key] !== "string" || !/^[a-f0-9]{64}$/.test(execution[key])) throw fail("AGENT_PROVIDER_RECOVERY_INVALID", "任务 Agent 指纹记录无效。");
    return execution[key];
  };
  const caps = execution.capabilities;
  if (!Number.isSafeInteger(caps.contextWindowTokens) || caps.contextWindowTokens < 512 || caps.contextWindowTokens > 2_000_000 ||
    !Number.isSafeInteger(caps.maxOutputTokens) || caps.maxOutputTokens < 1 || caps.maxOutputTokens >= caps.contextWindowTokens ||
    typeof execution.strictOffline !== "boolean") throw fail("AGENT_PROVIDER_RECOVERY_INVALID", "任务 Agent 能力记录无效。");
  return { providerKind: execution.providerKind, profileId: identifier("profileId"), profileHash: hash("profileHash"), modelId: identifier("modelId"),
    strictOffline: execution.strictOffline, networkScope: execution.networkScope,
    capabilities: { tools: caps.tools, vision: caps.vision, contextWindowTokens: caps.contextWindowTokens, maxOutputTokens: caps.maxOutputTokens },
    ...(execution.providerKind === "managed-local" ? { managedRevisionId: identifier("managedRevisionId"), managedBindingHash: hash("managedBindingHash") } : {}) };
}

module.exports = { agentExecutionForSettings, agentExecutionReceipt, assertAgentToolAllowed, assertAgentModelRequest, filterAgentTools, hasImageParts, localImageConfigured };
