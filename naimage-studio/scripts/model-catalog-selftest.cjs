"use strict";

const assert = require("node:assert/strict");
const {
  cachedModelSettings,
  createModelAccessProfile,
  createModelCacheKey,
  markModelAccessProfilesVerified,
  mergeModelCapabilities,
  mergeModelAccessProfiles,
  modelCapabilitiesFromResponse,
  modelGroupsFromResponse,
  modelIdsFromResponse,
  isExplicitVideoModelId,
  preferredAgentModelFromList,
  preferredImageModelFromList,
  preferredVideoModelFromList,
  preserveRuntimeVerifiedModelAccessProfiles,
  splitModelSettings,
  uniqueModelIds
} = require("../desktop/model-catalog.cjs");

assert.deepEqual(
  uniqueModelIds([" gpt-5.6-sol ", "GPT-5.6-SOL", "", null, "gpt-image-2"]),
  ["gpt-5.6-sol", "gpt-image-2"]
);

assert.deepEqual(
  modelIdsFromResponse({
    success: true,
    data: [
      { id: "gpt-5.6-sol" },
      { model_name: "gpt-image-2" },
      { name: "GPT-5.6-SOL", owned_by: "fixture" }
    ]
  }),
  ["gpt-5.6-sol", "gpt-image-2"]
);

assert.deepEqual(
  modelIdsFromResponse({
    result: {
      models: {
        "claude-4.5-sonnet": { enabled: true },
        "gemini-2.5-pro": 1,
        message: "not a model",
        total: 2
      }
    }
  }),
  ["claude-4.5-sonnet", "gemini-2.5-pro"]
);

assert.deepEqual(
  modelIdsFromResponse({ data: { grok: true, xai: true } }),
  ["grok", "xai"]
);

assert.deepEqual(
  modelIdsFromResponse({
    rows: [
      "flux-1.1-pro",
      { modelId: "deepseek-v3" },
      { description: "ignored metadata", nested: { id: "not-recursed" } }
    ]
  }),
  ["flux-1.1-pro", "deepseek-v3"]
);

const responseCapabilities = modelCapabilitiesFromResponse({
  success: true,
  data: [
    { id: "opaque-chat-v2", supported_endpoint_types: ["openai-response"] },
    { id: "opaque-image-v2", supported_endpoint_types: "[\"image-generation\"]" },
    { id: "opaque-video-v2", supportedEndpointTypes: { "openai-video": true, openai: false } },
    { id: "doubao-seedance-2-0-260128", supported_endpoint_types: ["openai"] }
  ]
});
assert.deepEqual(responseCapabilities["opaque-chat-v2"], {
  id: "opaque-chat-v2",
  endpointTypes: ["openai-response"]
});
assert.deepEqual(responseCapabilities["opaque-image-v2"], {
  id: "opaque-image-v2",
  endpointTypes: ["image-generation"]
});
assert.deepEqual(responseCapabilities["opaque-video-v2"], {
  id: "opaque-video-v2",
  endpointTypes: ["openai-video"]
});
assert.deepEqual(
  mergeModelCapabilities(
    responseCapabilities,
    { "opaque-chat-v2": { id: "OPAQUE-CHAT-V2", endpointTypes: ["anthropic"] } }
  )["opaque-chat-v2"].endpointTypes,
  ["openai-response", "anthropic"]
);

const capabilitySplit = splitModelSettings(
  {
    imageModel: "opaque-chat-v2",
    imageModelPool: ["opaque-chat-v2", "opaque-image-v2"],
    agentModel: "opaque-chat-v2",
    agentModelPool: ["opaque-chat-v2", "opaque-video-v2"],
    videoModel: "doubao-seedance-2-0-260128",
    videoModelPool: ["doubao-seedance-2-0-260128"]
  },
  ["opaque-chat-v2", "opaque-image-v2", "opaque-video-v2", "doubao-seedance-2-0-260128", "opaque-unknown-v2"],
  [],
  responseCapabilities
);
assert.deepEqual(capabilitySplit.imageModels, ["opaque-image-v2", "opaque-unknown-v2"]);
assert.equal(capabilitySplit.imageModel, "opaque-image-v2", "A capability-known chat model must not remain the selected image model");
assert.deepEqual(capabilitySplit.agentModels, ["opaque-chat-v2", "opaque-unknown-v2"]);
assert.deepEqual(capabilitySplit.videoModels, ["opaque-video-v2", "doubao-seedance-2-0-260128"]);
assert.deepEqual(capabilitySplit.modelCapabilities, responseCapabilities);

const checkedAt = "2026-08-01T10:00:00.000Z";
const declaredProfile = createModelAccessProfile({
  id: "model-access-fixture",
  label: "所选账户 Token",
  baseUrl: "https://user:password@example.com/v1?secret=1#fragment",
  credentialLabel: "Default token",
  providers: ["agent", "image", "video"],
  modelIds: ["opaque-image-v2", "doubao-seedance-2-0-260128"],
  modelCapabilities: responseCapabilities,
  lastCheckedAt: checkedAt
});
assert.equal(declaredProfile.baseUrl, "https://example.com/v1", "Access profiles must never retain URL credentials, queries, or fragments");
assert.equal(declaredProfile.capabilities["opaque-image-v2"].evidence, "upstream-declared");
assert.equal(declaredProfile.capabilities["doubao-seedance-2-0-260128"].evidence, "upstream-declared");
const verifiedProfiles = markModelAccessProfilesVerified([declaredProfile], {
  provider: "video",
  model: "doubao-seedance-2-0-260128",
  endpointType: "openai-video",
  verifiedAt: "2026-08-01T10:05:00.000Z"
});
assert.equal(verifiedProfiles[0].capabilities["doubao-seedance-2-0-260128"].evidence, "runtime-verified");
assert.deepEqual(verifiedProfiles[0].capabilities["doubao-seedance-2-0-260128"].endpointTypes, ["openai", "openai-video"]);
const failedRefreshProfile = createModelAccessProfile({
  id: "model-access-fixture",
  label: "所选账户 Token",
  baseUrl: "https://example.com/v1",
  credentialLabel: "Default token",
  providers: ["agent", "image", "video"],
  lastCheckedAt: "2026-08-01T10:10:00.000Z",
  error: "Token lookup failed"
});
const mergedFailureProfile = mergeModelAccessProfiles(verifiedProfiles, [failedRefreshProfile])[0];
assert.equal(mergedFailureProfile.error, "Token lookup failed");
assert.equal(mergedFailureProfile.capabilities["doubao-seedance-2-0-260128"].evidence, "runtime-verified");
assert.equal(
  preserveRuntimeVerifiedModelAccessProfiles([failedRefreshProfile], verifiedProfiles)[0]
    .capabilities["doubao-seedance-2-0-260128"].evidence,
  "runtime-verified"
);

assert.deepEqual(
  modelGroupsFromResponse({
    success: true,
    data: {
      vip: { ratio: 2, desc: "高级模型" },
      default: { ratio: 1, desc: "默认分组" },
      auto: { ratio: "自动", desc: "自动选择" }
    }
  }),
  [
    { id: "default", label: "default", description: "默认分组", ratio: 1 },
    { id: "auto", label: "auto", description: "自动选择", ratio: "自动" },
    { id: "vip", label: "vip", description: "高级模型", ratio: 2 }
  ]
);

const split = splitModelSettings(
  {
    imageModel: "opaque-renderer-v9",
    imageModelPool: ["opaque-renderer-v9", "gpt-5.6-sol"],
    imageModelBindings: [
      { model: "grok-image-latest", customApiKey: "fixture" },
      { model: "claude-4.5-sonnet", customApiKey: "ignored" }
    ],
    agentModel: "gpt-5.6-sol",
    agentModelPool: ["gpt-5.6-sol", "claude-4.5-sonnet"],
    videoModel: "doubao-seedance-2-0-260128",
    videoModelPool: ["doubao-seedance-2-0-260128"],
    modelGroup: "vip",
    accountBaseUrl: "https://sparkapi.org"
  },
  [
    "gpt-5.6-sol",
    "gpt-image-2",
    "GPT-IMAGE-2",
    "doubao-seedance-2-0-260128",
    "sora-2",
    "claude-4.5-sonnet",
    "gemini-2.5-pro",
    "gemini-2.5-flash-image-preview",
    "grok-3",
    "xai/grok-2-image-1212",
    "imagen-3",
    "flux-1.1-pro",
    "vendor/custom-model-v2"
  ],
  { vip: { desc: "高级模型" } }
);
assert.deepEqual(split.models, [
  "gpt-5.6-sol",
  "gpt-image-2",
  "doubao-seedance-2-0-260128",
  "sora-2",
  "claude-4.5-sonnet",
  "gemini-2.5-pro",
  "gemini-2.5-flash-image-preview",
  "grok-3",
  "xai/grok-2-image-1212",
  "imagen-3",
  "flux-1.1-pro",
  "vendor/custom-model-v2"
]);
assert.deepEqual(split.imageModels, [
  "gpt-image-2",
  "gemini-2.5-flash-image-preview",
  "xai/grok-2-image-1212",
  "imagen-3",
  "flux-1.1-pro",
  "vendor/custom-model-v2",
  "opaque-renderer-v9",
  "grok-image-latest"
]);
assert.deepEqual(split.agentModels, [
  "gpt-5.6-sol",
  "claude-4.5-sonnet",
  "gemini-2.5-pro",
  "grok-3",
  "vendor/custom-model-v2"
]);
assert.deepEqual(split.videoModels, ["doubao-seedance-2-0-260128", "sora-2"]);
assert.equal(split.imageModel, "opaque-renderer-v9");
assert.equal(split.videoModel, "doubao-seedance-2-0-260128");
assert.equal(split.modelGroup, "vip");
assert.deepEqual(split.modelGroups, [{ id: "vip", label: "vip", description: "高级模型", ratio: undefined }]);
assert.equal(split.channelName, "SparkAPI");
assert.equal(split.serviceReady, true);
assert.equal(split.keyManaged, true);

assert.equal(preferredAgentModelFromList(["claude-4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol-pro", "gpt-5.6-terra"]), "gpt-5.6-terra");
assert.equal(preferredAgentModelFromList(["claude-4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol-pro"]), "gpt-5.6-sol-pro");
assert.equal(preferredAgentModelFromList(["claude-4", "gpt-5.5-latest"]), "gpt-5.5-latest");
assert.equal(preferredAgentModelFromList(["claude-4"]), "claude-4");
assert.equal(preferredImageModelFromList(["flux-1", "gpt-image-2", "gpt-image-1"]), "gpt-image-2");
assert.equal(preferredImageModelFromList(["flux-1"]), "flux-1");
assert.equal(isExplicitVideoModelId("doubao-seedance-2-0-260128"), true);
assert.equal(isExplicitVideoModelId("gpt-image-2"), false);
assert.equal(preferredVideoModelFromList(["sora-2", "doubao-seedance-2-0-260128"]), "doubao-seedance-2-0-260128");
assert.equal(preferredVideoModelFromList(["sora-2"]), "sora-2");

const invalidSavedImage = splitModelSettings(
  {
    imageModel: "gpt-5.6-sol",
    imageModelPool: ["gpt-5.6-sol", "private-render-v2"],
    imageModelBindings: [],
    agentModel: "gpt-5.6-sol",
    agentModelPool: ["gpt-5.6-sol"],
    accountBaseUrl: "https://example.com"
  },
  ["gpt-5.6-sol", "gpt-image-2"]
);
assert.equal(invalidSavedImage.imageModel, "private-render-v2");
assert.deepEqual(invalidSavedImage.imageModels, ["gpt-image-2", "private-render-v2"]);

assert.equal(
  createModelCacheKey(" HTTPS://ACCOUNT.EXAMPLE.COM ", " https://relay.example.com ", " user-7 "),
  "https://account.example.com::https://relay.example.com::user-7::account-default"
);
assert.equal(
  createModelCacheKey("http://127.0.0.1:3000", "http://127.0.0.1:3000", ""),
  "http://127.0.0.1:3000::http://127.0.0.1:3000::anonymous::account-default"
);
assert.notEqual(
  createModelCacheKey("https://account.example", "https://relay-a.example", "7"),
  createModelCacheKey("https://account.example", "https://relay-b.example", "7")
);
assert.notEqual(
  createModelCacheKey("https://account.example", "https://relay.example", "7", "default"),
  createModelCacheKey("https://account.example", "https://relay.example", "7", "vip")
);

const cached = cachedModelSettings(
  { imageModel: "settings-image", modelGroup: "default" },
  {
    models: ["gpt-5.6-sol"],
    imageModels: ["gpt-image-2", "cached-image"],
    agentModels: ["GPT-5.6-SOL", "claude-4.5-sonnet"],
    videoModels: ["doubao-seedance-2-0-260128"],
    imageCostCents: "12",
    imageCostYuan: 0.12,
    trialImages: "3",
    imageModel: "cached-image",
    videoModel: "doubao-seedance-2-0-260128",
    modelCapabilities: {
      "gpt-5.6-sol": { id: "gpt-5.6-sol", endpointTypes: ["openai-response"] },
      "gpt-image-2": { id: "gpt-image-2", endpointTypes: ["image-generation", "openai"] },
      "doubao-seedance-2-0-260128": { id: "doubao-seedance-2-0-260128", endpointTypes: ["openai"] }
    },
    modelGroup: "vip",
    modelGroups: { vip: { desc: "高级模型", ratio: 2 } },
    channelName: "Managed New API",
    serviceReady: false,
    keyManaged: false
  }
);
assert.deepEqual(cached.models, ["gpt-5.6-sol", "gpt-image-2", "cached-image", "claude-4.5-sonnet", "doubao-seedance-2-0-260128"]);
assert.deepEqual(cached.imageModels, ["gpt-image-2", "cached-image", "settings-image"]);
assert.deepEqual(cached.agentModels, ["GPT-5.6-SOL", "claude-4.5-sonnet"]);
assert.deepEqual(cached.videoModels, ["doubao-seedance-2-0-260128"]);
assert.equal(cached.imageCostCents, 12);
assert.equal(cached.imageCostYuan, 0.12);
assert.equal(cached.trialImages, 3);
assert.equal(cached.imageModel, "cached-image");
assert.equal(cached.videoModel, "doubao-seedance-2-0-260128");
assert.deepEqual(cached.modelCapabilities["gpt-image-2"].endpointTypes, ["image-generation", "openai"]);
assert.equal(cached.modelGroup, "vip");
assert.deepEqual(cached.modelGroups, [{ id: "vip", label: "vip", description: "高级模型", ratio: 2 }]);
assert.equal(cached.channelName, "Managed New API");
assert.equal(cached.serviceReady, false);
assert.equal(cached.keyManaged, false);

const cacheDefaults = cachedModelSettings({ imageModel: "settings-image" }, null);
assert.equal(cacheDefaults.imageModel, "settings-image");
assert.deepEqual(cacheDefaults.imageModels, ["settings-image"]);
assert.equal(cacheDefaults.channelName, "New API");
assert.equal(cacheDefaults.serviceReady, true);
assert.equal(cacheDefaults.keyManaged, true);

process.stdout.write("model catalog selftest passed\n");
