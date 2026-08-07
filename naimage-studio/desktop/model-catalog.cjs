"use strict";

const MODEL_ID_KEYS = ["id", "name", "model", "modelName", "model_name", "modelId", "model_id", "Model", "value"];
const MODEL_LIST_KEYS = ["data", "items", "Items", "models", "Models", "modelList", "model_list", "availableModels", "available_models", "result", "results", "rows", "list"];
const MODEL_META_KEYS = new Set(["success", "ok", "message", "msg", "error", "code", "total", "count", "page", "limit", "object", "created", "owned_by", "permission", "permissions", "capabilities", "type", "label", "description", "desc", "price", "quota"]);
const MODEL_ENDPOINT_KEYS = ["supported_endpoint_types", "supportedEndpointTypes", "endpoint_types", "endpointTypes", "endpoints"];
const CHAT_ENDPOINT_TYPES = new Set(["openai", "openai-response", "openai-response-compact", "anthropic", "gemini"]);
const IMAGE_ENDPOINT_TYPE = "image-generation";
const VIDEO_ENDPOINT_TYPE = "openai-video";
const MODEL_PROVIDER_VALUES = new Set(["agent", "image", "video"]);
const MODEL_COMPATIBILITY_EVIDENCE_RANK = Object.freeze({
  "name-inferred": 1,
  "upstream-declared": 2,
  "runtime-verified": 3
});

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
    /^(gpt|chatgpt|claude|gemini|imagen|image|flux|dall|midjourney|mj|stable|sd|sora|veo|kling|runway|qwen|glm|deepseek|llama|mistral|recraft|ideogram|seedream|doubao|hunyuan|minimax|ernie|baichuan|moonshot|pixverse|hailuo|wanx|wanxiang|hidream|grok|xai)/i.test(clean)
  );
}

function isExplicitImageModelId(value) {
  const clean = String(value || "").trim();
  if (!clean) return false;
  return /(?:^|[\/:._+-])(?:image|images|imagen|flux|dall(?:[._+-]?e)?|midjourney|mj|stable[._+-]?diffusion|sdxl|sd3|recraft|ideogram|seedream|cogview|kolors|hidream|nano[._+-]?banana|grok[._+-]?imagine|wanx|wanxiang|jimeng)(?=$|[\/:._+-]|\d)/i.test(clean);
}

function isExplicitVideoModelId(value) {
  const clean = String(value || "").trim();
  if (!clean) return false;
  return /(?:^|[\/:._+-])(?:video|seedance|sora|veo|kling|runway|pixverse|hailuo|wan[._+-]?video|luma[._+-]?dream|pika)(?=$|[\/:._+-]|\d)/i.test(clean);
}

function isExplicitChatModelId(value) {
  const clean = String(value || "").trim();
  if (!clean || isExplicitImageModelId(clean) || isExplicitVideoModelId(clean)) return false;
  return /(?:^|[\/:._+-])(?:gpt|chatgpt|claude|gemini|grok|xai|deepseek|qwen|qwq|glm|llama|meta[._+-]?llama|mistral|mixtral|gemma|moonshot|kimi|ernie|baichuan|command[._+-]?r|cohere|doubao|hunyuan|minimax|codex|o[134])(?=$|[\/:._+-]|\d)/i.test(clean);
}

function configuredVideoModelIds(settings = {}) {
  return uniqueModelIds([
    settings.videoModel,
    ...(Array.isArray(settings.videoModelPool) ? settings.videoModelPool : [])
  ]);
}

function configuredImageModelIds(settings = {}) {
  return uniqueModelIds([
    settings.imageModel,
    ...(Array.isArray(settings.imageModelPool) ? settings.imageModelPool : []),
    ...(Array.isArray(settings.imageModelBindings)
      ? settings.imageModelBindings.map((binding) => binding && typeof binding === "object" ? binding.model : "")
      : [])
  ]).filter((model) => !isExplicitChatModelId(model));
}

function configuredAgentModelIds(settings = {}) {
  return uniqueModelIds([
    settings.agentModel,
    ...(Array.isArray(settings.agentModelPool) ? settings.agentModelPool : [])
  ]).filter((model) => !isExplicitImageModelId(model));
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

function endpointTypesFromValue(value) {
  if (typeof value === "string") {
    const clean = value.trim();
    if ((clean.startsWith("[") && clean.endsWith("]")) || (clean.startsWith("{") && clean.endsWith("}"))) {
      try {
        return endpointTypesFromValue(JSON.parse(clean));
      } catch {
        // Fall through to the tolerant delimiter parser used by older forks.
      }
    }
  }
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,|]+/)
      : value && typeof value === "object"
        ? Object.entries(value)
          .filter(([, enabled]) => enabled !== false && enabled !== 0 && enabled !== "0" && enabled !== "false" && enabled != null)
          .map(([key]) => key)
        : [];
  return uniqueModelIds(source.map((item) => String(item || "").trim().toLowerCase()));
}

function mergeModelCapability(output, modelId, endpointTypes) {
  const id = String(modelId || "").trim();
  const types = endpointTypesFromValue(endpointTypes);
  if (!id || !types.length) return;
  const key = id.toLowerCase();
  const current = output[key];
  output[key] = {
    id: current?.id || id,
    endpointTypes: uniqueModelIds([...(current?.endpointTypes || []), ...types])
  };
}

function collectModelCapabilitiesFromValue(value, output, depth = 0) {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectModelCapabilitiesFromValue(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const modelId = MODEL_ID_KEYS.map((key) => value[key]).find((item) => typeof item === "string");
  const endpointTypes = MODEL_ENDPOINT_KEYS.map((key) => value[key]).find((item) => item != null);
  if (modelId && endpointTypes != null) mergeModelCapability(output, modelId, endpointTypes);

  for (const key of MODEL_LIST_KEYS) {
    if (key in value) collectModelCapabilitiesFromValue(value[key], output, depth + 1);
  }
  if (!modelId) {
    for (const [key, nested] of Object.entries(value)) {
      if (!nested || typeof nested !== "object" || Array.isArray(nested) || !looksLikeModelId(key)) continue;
      const nestedEndpointTypes = MODEL_ENDPOINT_KEYS.map((endpointKey) => nested[endpointKey]).find((item) => item != null);
      if (nestedEndpointTypes != null) mergeModelCapability(output, key, nestedEndpointTypes);
    }
  }
}

function modelCapabilitiesFromResponse(payload) {
  const output = {};
  collectModelCapabilitiesFromValue(payload, output);
  return output;
}

function mergeModelCapabilities(...sources) {
  const output = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (!value || typeof value !== "object") continue;
      mergeModelCapability(output, value.id || key, value.endpointTypes || value.supportedEndpointTypes || value.supported_endpoint_types);
    }
  }
  return output;
}

function normalizedModelProviders(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || "").trim().toLowerCase()).filter((item) => MODEL_PROVIDER_VALUES.has(item)))];
}

function inferredEndpointTypesForModel(modelId) {
  if (isExplicitVideoModelId(modelId)) return [VIDEO_ENDPOINT_TYPE];
  if (isExplicitImageModelId(modelId)) return [IMAGE_ENDPOINT_TYPE];
  if (isExplicitChatModelId(modelId)) return ["openai"];
  return [];
}

function sanitizedAccessBaseUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return source.replace(/[?#].*$/, "").slice(0, 2_048);
  }
}

function normalizedCompatibilityCapability(value, fallbackModel = "") {
  const source = value && typeof value === "object" ? value : {};
  const model = String(source.model || source.id || fallbackModel || "").trim();
  if (!model) return null;
  const endpointTypes = endpointTypesFromValue(source.endpointTypes || source.supportedEndpointTypes || source.supported_endpoint_types);
  const evidence = Object.prototype.hasOwnProperty.call(MODEL_COMPATIBILITY_EVIDENCE_RANK, source.evidence)
    ? source.evidence
    : endpointTypes.length
      ? "upstream-declared"
      : "name-inferred";
  const lastCheckedAt = String(source.lastCheckedAt || "").trim();
  const lastVerifiedAt = String(source.lastVerifiedAt || "").trim();
  return {
    model,
    endpointTypes,
    evidence,
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(lastVerifiedAt ? { lastVerifiedAt } : {})
  };
}

function normalizeModelAccessProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const id = String(source.id || "").trim().slice(0, 160);
  if (!id) return null;
  const providers = normalizedModelProviders(source.providers);
  const capabilities = {};
  const inputCapabilities = source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {};
  for (const [key, raw] of Object.entries(inputCapabilities)) {
    const capability = normalizedCompatibilityCapability(raw, key);
    if (!capability) continue;
    capabilities[capability.model.toLowerCase()] = capability;
  }
  const lastCheckedAt = String(source.lastCheckedAt || "").trim();
  const error = String(source.error || "").trim().slice(0, 1_000);
  return {
    id,
    label: String(source.label || "模型接入").trim().slice(0, 160) || "模型接入",
    baseUrl: sanitizedAccessBaseUrl(source.baseUrl),
    credentialLabel: String(source.credentialLabel || "").trim().slice(0, 160),
    providers,
    capabilities,
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(error ? { error } : {})
  };
}

function createModelAccessProfile({
  id,
  label,
  baseUrl,
  credentialLabel,
  providers,
  modelIds = [],
  modelCapabilities = {},
  lastCheckedAt = new Date().toISOString(),
  error = ""
} = {}) {
  const declared = mergeModelCapabilities(modelCapabilities);
  const capabilities = {};
  for (const model of uniqueModelIds([
    ...modelIds,
    ...Object.values(declared).map((entry) => entry.id)
  ])) {
    const declaredTypes = declared[model.toLowerCase()]?.endpointTypes || [];
    const endpointTypes = declaredTypes.length ? declaredTypes : inferredEndpointTypesForModel(model);
    capabilities[model.toLowerCase()] = {
      model,
      endpointTypes,
      evidence: declaredTypes.length ? "upstream-declared" : "name-inferred",
      lastCheckedAt
    };
  }
  return normalizeModelAccessProfile({
    id,
    label,
    baseUrl,
    credentialLabel,
    providers,
    capabilities,
    lastCheckedAt,
    error
  });
}

function mergeCompatibilityCapability(leftValue, rightValue) {
  const left = normalizedCompatibilityCapability(leftValue);
  const right = normalizedCompatibilityCapability(rightValue, left?.model);
  if (!left) return right;
  if (!right) return left;
  const leftRank = MODEL_COMPATIBILITY_EVIDENCE_RANK[left.evidence] || 0;
  const rightRank = MODEL_COMPATIBILITY_EVIDENCE_RANK[right.evidence] || 0;
  const preferred = rightRank >= leftRank ? right : left;
  const lastCheckedAt = [left.lastCheckedAt, right.lastCheckedAt].filter(Boolean).sort().at(-1);
  const lastVerifiedAt = [left.lastVerifiedAt, right.lastVerifiedAt].filter(Boolean).sort().at(-1);
  return {
    ...preferred,
    endpointTypes: uniqueModelIds([...(left.endpointTypes || []), ...(right.endpointTypes || [])]),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(lastVerifiedAt ? { lastVerifiedAt } : {})
  };
}

function mergeModelAccessProfiles(...sources) {
  const merged = new Map();
  for (const source of sources) {
    for (const raw of Array.isArray(source) ? source : []) {
      const profile = normalizeModelAccessProfile(raw);
      if (!profile) continue;
      const current = merged.get(profile.id);
      if (!current) {
        merged.set(profile.id, profile);
        continue;
      }
      const capabilities = { ...current.capabilities };
      for (const [key, capability] of Object.entries(profile.capabilities)) {
        capabilities[key] = mergeCompatibilityCapability(capabilities[key], capability);
      }
      const lastCheckedAt = [current.lastCheckedAt, profile.lastCheckedAt].filter(Boolean).sort().at(-1);
      merged.set(profile.id, {
        ...current,
        ...profile,
        providers: normalizedModelProviders([...current.providers, ...profile.providers]),
        capabilities,
        ...(lastCheckedAt ? { lastCheckedAt } : {})
      });
    }
  }
  return [...merged.values()];
}

function preserveRuntimeVerifiedModelAccessProfiles(freshValue, cachedValue) {
  const fresh = mergeModelAccessProfiles(freshValue);
  const cached = mergeModelAccessProfiles(cachedValue);
  const verifiedOnly = cached.map((profile) => ({
    ...profile,
    capabilities: Object.fromEntries(Object.entries(profile.capabilities).filter(([, capability]) => capability.evidence === "runtime-verified" || capability.lastVerifiedAt))
  })).filter((profile) => Object.keys(profile.capabilities).length > 0);
  return mergeModelAccessProfiles(fresh, verifiedOnly);
}

function markModelAccessProfilesVerified(profilesValue, { provider, model, endpointType, verifiedAt = new Date().toISOString() } = {}) {
  const targetProvider = String(provider || "").trim().toLowerCase();
  const targetModel = String(model || "").trim();
  const targetEndpoint = String(endpointType || "").trim().toLowerCase();
  if (!MODEL_PROVIDER_VALUES.has(targetProvider) || !targetModel || !targetEndpoint) return mergeModelAccessProfiles(profilesValue);
  let changed = false;
  const profiles = mergeModelAccessProfiles(profilesValue).map((profile) => {
    if (!profile.providers.includes(targetProvider)) return profile;
    const key = targetModel.toLowerCase();
    const current = profile.capabilities[key] || {
      model: targetModel,
      endpointTypes: inferredEndpointTypesForModel(targetModel),
      evidence: "name-inferred",
      lastCheckedAt: profile.lastCheckedAt || verifiedAt
    };
    changed = true;
    return {
      ...profile,
      capabilities: {
        ...profile.capabilities,
        [key]: {
          ...current,
          endpointTypes: uniqueModelIds([...(current.endpointTypes || []), targetEndpoint]),
          evidence: "runtime-verified",
          lastVerifiedAt: verifiedAt
        }
      }
    };
  });
  return changed ? profiles : mergeModelAccessProfiles(profilesValue);
}

function normalizedModelServiceStatuses(value) {
  const source = value && typeof value === "object" ? value : {};
  const output = {};
  for (const provider of MODEL_PROVIDER_VALUES) {
    const status = source[provider] && typeof source[provider] === "object" ? source[provider] : {};
    const state = ["ready", "catalog-only", "unavailable"].includes(status.state) ? status.state : "unavailable";
    const error = String(status.error || "").trim().slice(0, 1_000);
    const lastCheckedAt = String(status.lastCheckedAt || "").trim();
    output[provider] = {
      state,
      profileIds: Array.isArray(status.profileIds) ? [...new Set(status.profileIds.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 16) : [],
      ...(error ? { error } : {}),
      ...(lastCheckedAt ? { lastCheckedAt } : {})
    };
  }
  return output;
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

function splitModelSettings(settings = {}, modelIds = [], modelGroups = [], modelCapabilities = {}, metadata = {}) {
  const normalizedCapabilities = mergeModelCapabilities(modelCapabilities);
  const unique = uniqueModelIds([
    ...modelIds,
    ...Object.values(normalizedCapabilities).map((capability) => capability.id)
  ]);
  const configuredImageModels = configuredImageModelIds(settings);
  const configuredAgentModels = configuredAgentModelIds(settings);
  const configuredVideoModels = configuredVideoModelIds(settings);
  const endpointTypesForModel = (model) => normalizedCapabilities[String(model || "").trim().toLowerCase()]?.endpointTypes || [];
  const capabilityKnown = (model) => endpointTypesForModel(model).length > 0;
  const supportsImage = (model) => endpointTypesForModel(model).includes(IMAGE_ENDPOINT_TYPE);
  const supportsVideo = (model) => endpointTypesForModel(model).includes(VIDEO_ENDPOINT_TYPE);
  const supportsChat = (model) => endpointTypesForModel(model).some((type) => CHAT_ENDPOINT_TYPES.has(type));
  // Most model APIs omit capability metadata, so unknown custom IDs stay visible in both catalogs.
  // Only an explicit opposite-purpose family is filtered out.
  const imageModels = uniqueModelIds([
    ...unique,
    ...configuredImageModels
  ]).filter((model) => (
    !isExplicitVideoModelId(model) &&
    !supportsVideo(model) &&
    (
      isExplicitImageModelId(model) ||
      supportsImage(model) ||
      (!capabilityKnown(model) && !isExplicitChatModelId(model) && !isExplicitVideoModelId(model))
    )
  ));
  const agentModels = uniqueModelIds([
    ...unique,
    ...configuredAgentModels
  ]).filter((model) => (
      !isExplicitImageModelId(model) &&
      !isExplicitVideoModelId(model) &&
      !supportsImage(model) &&
      !supportsVideo(model) &&
      (supportsChat(model) || !capabilityKnown(model))
  ));
  const videoModels = uniqueModelIds([
    ...unique.filter((model) => isExplicitVideoModelId(model) || supportsVideo(model)),
    ...configuredVideoModels
  ]);
  const imageModelKeys = new Set(imageModels.map((model) => model.toLowerCase()));
  const configuredImageModel = configuredImageModels.find((model) => imageModelKeys.has(model.toLowerCase())) || "";
  const videoModelKeys = new Set(videoModels.map((model) => model.toLowerCase()));
  const configuredVideoModel = configuredVideoModels.find((model) => videoModelKeys.has(model.toLowerCase())) || "";
  const normalizedGroups = modelGroupsFromResponse(modelGroups);
  return {
    imageCostCents: 0,
    imageCostYuan: 0,
    trialImages: 0,
    models: unique,
    imageModel: configuredImageModel || imageModels[0] || "",
    imageModels,
    agentModels,
    videoModel: configuredVideoModel || videoModels[0] || "",
    videoModels,
    modelCapabilities: normalizedCapabilities,
    modelAccessProfiles: mergeModelAccessProfiles(metadata.modelAccessProfiles),
    serviceStatuses: normalizedModelServiceStatuses(metadata.serviceStatuses),
    modelGroup: String(settings.modelGroup || "").trim(),
    modelGroups: normalizedGroups,
    channelName: /(?:^|\.)sparkapi\.org$/i.test(String(settings.accountBaseUrl || "").replace(/^https?:\/\//i, "").split("/")[0]) ? "SparkAPI" : "New API",
    serviceReady: true,
    keyManaged: true
  };
}

function preferredAgentModelFromList(models = []) {
  return models.find((model) => /^gpt-5\.6-terra(?:[-.:]|$)/i.test(String(model || ""))) ||
    models.find((model) => /^gpt-5\.6-sol(?:[-.:]|$)/i.test(String(model || ""))) ||
    models.find((model) => /^gpt-5\.6(?:[-.:]|$)/i.test(String(model || ""))) ||
    models.find((model) => /^gpt-5\.5(?:[-.:]|$)/i.test(String(model || ""))) ||
    models[0] || "";
}

function preferredImageModelFromList(models = []) {
  return models.find((model) => /^gpt-image-2\b/i.test(String(model || ""))) || models[0] || "";
}

function preferredVideoModelFromList(models = []) {
  return models.find((model) => /^doubao-seedance-2-0-260128$/i.test(String(model || ""))) ||
    models.find((model) => isExplicitVideoModelId(model)) ||
    models[0] || "";
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
    ...(Array.isArray(source.agentModels) ? source.agentModels : []),
    ...(Array.isArray(source.videoModels) ? source.videoModels : [])
  ]);
  const normalized = splitModelSettings({
    ...settings,
    imageModel: source.imageModel || settings.imageModel,
    imageModelPool: uniqueModelIds([
      ...(Array.isArray(source.imageModels) ? source.imageModels : []),
      ...(Array.isArray(settings.imageModelPool) ? settings.imageModelPool : [])
    ]),
    videoModel: source.videoModel || settings.videoModel,
    videoModelPool: uniqueModelIds([
      ...(Array.isArray(source.videoModels) ? source.videoModels : []),
      ...(Array.isArray(settings.videoModelPool) ? settings.videoModelPool : [])
    ])
  }, models, source.modelGroups, source.modelCapabilities, {
    modelAccessProfiles: source.modelAccessProfiles,
    serviceStatuses: source.serviceStatuses
  });
  const imageModels = Array.isArray(source.imageModels) && source.imageModels.length
    ? uniqueModelIds([...source.imageModels, ...configuredImageModelIds(settings)])
    : normalized.imageModels;
  const agentModels = Array.isArray(source.agentModels) && source.agentModels.length
    ? uniqueModelIds([...source.agentModels, ...configuredAgentModelIds(settings)])
    : normalized.agentModels;
  const videoModels = Array.isArray(source.videoModels) && source.videoModels.length
    ? uniqueModelIds([...source.videoModels, ...configuredVideoModelIds(settings)])
    : normalized.videoModels;
  const imageModelKeys = new Set(imageModels.map((model) => model.toLowerCase()));
  const agentModelKeys = new Set(agentModels.map((model) => model.toLowerCase()));
  const videoModelKeys = new Set(videoModels.map((model) => model.toLowerCase()));
  return {
    ...normalized,
    imageCostCents: Number.isFinite(Number(source.imageCostCents)) ? Number(source.imageCostCents) : normalized.imageCostCents,
    imageCostYuan: Number.isFinite(Number(source.imageCostYuan)) ? Number(source.imageCostYuan) : normalized.imageCostYuan,
    trialImages: Number.isFinite(Number(source.trialImages)) ? Number(source.trialImages) : normalized.trialImages,
    imageModel: imageModelKeys.has(String(source.imageModel || normalized.imageModel).toLowerCase())
      ? source.imageModel || normalized.imageModel
      : imageModels[0] || "",
    imageModels,
    agentModels,
    agentModel: agentModelKeys.has(String(source.agentModel || settings.agentModel || "").toLowerCase())
      ? source.agentModel || settings.agentModel
      : agentModels[0] || "",
    videoModel: videoModelKeys.has(String(source.videoModel || normalized.videoModel).toLowerCase())
      ? source.videoModel || normalized.videoModel
      : videoModels[0] || "",
    videoModels,
    modelGroup: String(source.modelGroup ?? normalized.modelGroup ?? ""),
    modelGroups: normalized.modelGroups,
    modelAccessProfiles: normalized.modelAccessProfiles,
    serviceStatuses: normalized.serviceStatuses,
    channelName: String(source.channelName || normalized.channelName || "New API"),
    serviceReady: source.serviceReady !== false,
    keyManaged: source.keyManaged !== false
  };
}

module.exports = {
  cachedModelSettings,
  createModelAccessProfile,
  createModelCacheKey,
  markModelAccessProfilesVerified,
  mergeModelCapabilities,
  mergeModelAccessProfiles,
  modelCapabilitiesFromResponse,
  modelGroupsFromResponse,
  modelIdsFromResponse,
  preferredAgentModelFromList,
  preferredImageModelFromList,
  preferredVideoModelFromList,
  preserveRuntimeVerifiedModelAccessProfiles,
  isExplicitVideoModelId,
  splitModelSettings,
  uniqueModelIds
};
