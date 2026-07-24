"use strict";

const MODEL_ID_KEYS = ["id", "name", "model", "modelName", "model_name", "modelId", "model_id", "Model", "value"];
const MODEL_LIST_KEYS = ["data", "items", "Items", "models", "Models", "modelList", "model_list", "availableModels", "available_models", "result", "results", "rows", "list"];
const MODEL_META_KEYS = new Set(["success", "ok", "message", "msg", "error", "code", "total", "count", "page", "limit", "object", "created", "owned_by", "permission", "permissions", "capabilities", "type", "label", "description", "desc", "price", "quota"]);

function uniqueModelIds(modelIds = []) {
  const seen = new Set();
  const output = [];
  for (const modelId of modelIds) {
    const clean = String(modelId || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function looksLikeModelId(value) {
  const clean = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:/+-]{1,}$/i.test(clean) && (
    /[0-9.\/:+-]/.test(clean) ||
    /^(gpt|chatgpt|claude|gemini|imagen|image|flux|dall|midjourney|mj|stable|sd|sora|veo|kling|runway|qwen|glm|deepseek|llama|mistral|recraft|ideogram|seedream|doubao|hunyuan|minimax|ernie|baichuan|moonshot|pixverse|hailuo|wanx|wanxiang|hidream)/i.test(clean)
  );
}

function isModelMapEntry(key, value, depth) {
  const clean = String(key || "").trim();
  if (depth <= 0 || MODEL_META_KEYS.has(clean) || /\s/.test(clean) || clean.length < 2) return false;
  if (!(value === true || typeof value === "number" || typeof value === "string" || (value && typeof value === "object"))) return false;
  return looksLikeModelId(clean);
}

function collectModelIdsFromValue(value, output, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelIdsFromValue(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const hasDirectModelId = MODEL_ID_KEYS.some((key) => {
    const modelId = value[key];
    return typeof modelId === "string";
  });
  for (const key of MODEL_ID_KEYS) {
    const modelId = value[key];
    if (typeof modelId === "string") {
      output.push(modelId);
      break;
    }
  }

  for (const key of MODEL_LIST_KEYS) {
    if (key in value) collectModelIdsFromValue(value[key], output, depth + 1);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (hasDirectModelId || MODEL_LIST_KEYS.includes(key) || MODEL_ID_KEYS.includes(key)) continue;
    if (Array.isArray(nested)) {
      collectModelIdsFromValue(nested, output, depth + 1);
      continue;
    }
    if (isModelMapEntry(key, nested, depth)) {
      output.push(key);
    }
  }
}

function modelIdsFromResponse(payload) {
  const modelIds = [];
  collectModelIdsFromValue(payload, modelIds);
  return uniqueModelIds(modelIds);
}

function modelGroupsFromResponse(payload) {
  const source = payload?.data ?? payload;
  const entries = Array.isArray(source)
    ? source.map((item) => typeof item === "string" ? [item, {}] : [item?.id || item?.name || item?.value, item])
    : source && typeof source === "object"
      ? Object.entries(source)
      : [];
  const seen = new Set();
  const groups = [];
  for (const [rawId, rawInfo] of entries) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const info = rawInfo && typeof rawInfo === "object" ? rawInfo : {};
    groups.push({
      id,
      label: String(info.label || info.name || id).trim() || id,
      description: String(info.desc || info.description || "").trim(),
      ratio: info.ratio
    });
  }
  return groups.sort((left, right) => {
    const priority = (value) => value === "default" ? 0 : value === "auto" ? 1 : 2;
    return priority(left.id) - priority(right.id) || left.label.localeCompare(right.label, "zh-CN");
  });
}

function splitModelSettings(settings = {}, modelIds = [], modelGroups = []) {
  const unique = uniqueModelIds(modelIds);
  const imageModels = unique;
  const agentModels = unique;
  const normalizedGroups = modelGroupsFromResponse(modelGroups);
  return {
    imageCostCents: 0,
    imageCostYuan: 0,
    trialImages: 0,
    models: unique,
    imageModel: settings.imageModel || imageModels[0] || "",
    imageModels,
    agentModels,
    modelGroup: String(settings.modelGroup || "").trim(),
    modelGroups: normalizedGroups,
    channelName: /(?:^|\.)sparkapi\.org$/i.test(String(settings.accountBaseUrl || "").replace(/^https?:\/\//i, "").split("/")[0]) ? "SparkAPI" : "New API",
    serviceReady: true,
    keyManaged: true
  };
}

function preferredAgentModelFromList(models = []) {
  return models.find((model) => /^gpt-5\.6-sol(?:[-.:]|$)/i.test(String(model || ""))) ||
    models.find((model) => /^gpt-5\.6(?:[-.:]|$)/i.test(String(model || ""))) ||
    models.find((model) => /^gpt-5\.5(?:[-.:]|$)/i.test(String(model || ""))) ||
    models[0] || "";
}

function preferredImageModelFromList(models = []) {
  return models.find((model) => /^gpt-image-2\b/i.test(String(model || ""))) || models[0] || "";
}

function createModelCacheKey(accountBaseUrl, relayBaseUrl, serverUserId, modelGroup = "") {
  return [accountBaseUrl, relayBaseUrl]
    .map((value) => String(value || "").trim().toLowerCase())
    .concat(String(serverUserId || "anonymous").trim() || "anonymous", String(modelGroup || "account-default").trim().toLowerCase() || "account-default")
    .join("::");
}

function cachedModelSettings(settings = {}, value) {
  const source = value && typeof value === "object" ? value : {};
  const models = uniqueModelIds([
    ...(Array.isArray(source.models) ? source.models : []),
    ...(Array.isArray(source.imageModels) ? source.imageModels : []),
    ...(Array.isArray(source.agentModels) ? source.agentModels : [])
  ]);
  const normalized = splitModelSettings(settings, models, source.modelGroups);
  return {
    ...normalized,
    imageCostCents: Number.isFinite(Number(source.imageCostCents)) ? Number(source.imageCostCents) : normalized.imageCostCents,
    imageCostYuan: Number.isFinite(Number(source.imageCostYuan)) ? Number(source.imageCostYuan) : normalized.imageCostYuan,
    trialImages: Number.isFinite(Number(source.trialImages)) ? Number(source.trialImages) : normalized.trialImages,
    imageModel: String(source.imageModel || normalized.imageModel || ""),
    modelGroup: String(source.modelGroup ?? normalized.modelGroup ?? ""),
    modelGroups: normalized.modelGroups,
    channelName: String(source.channelName || normalized.channelName || "New API"),
    serviceReady: source.serviceReady !== false,
    keyManaged: source.keyManaged !== false
  };
}

module.exports = {
  cachedModelSettings,
  createModelCacheKey,
  modelGroupsFromResponse,
  modelIdsFromResponse,
  preferredAgentModelFromList,
  preferredImageModelFromList,
  splitModelSettings,
  uniqueModelIds
};
