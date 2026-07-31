"use strict";

const assert = require("node:assert/strict");
const {
  cachedModelSettings,
  createModelCacheKey,
  modelGroupsFromResponse,
  modelIdsFromResponse,
  preferredAgentModelFromList,
  preferredImageModelFromList,
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
    modelGroup: "vip",
    accountBaseUrl: "https://sparkapi.org"
  },
  [
    "gpt-5.6-sol",
    "gpt-image-2",
    "GPT-IMAGE-2",
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
assert.equal(split.imageModel, "opaque-renderer-v9");
assert.equal(split.modelGroup, "vip");
assert.deepEqual(split.modelGroups, [{ id: "vip", label: "vip", description: "高级模型", ratio: undefined }]);
assert.equal(split.channelName, "SparkAPI");
assert.equal(split.serviceReady, true);
assert.equal(split.keyManaged, true);

assert.equal(preferredAgentModelFromList(["claude-4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol-pro"]), "gpt-5.6-sol-pro");
assert.equal(preferredAgentModelFromList(["claude-4", "gpt-5.5-latest"]), "gpt-5.5-latest");
assert.equal(preferredAgentModelFromList(["claude-4"]), "claude-4");
assert.equal(preferredImageModelFromList(["flux-1", "gpt-image-2", "gpt-image-1"]), "gpt-image-2");
assert.equal(preferredImageModelFromList(["flux-1"]), "flux-1");

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
    imageModels: ["gpt-image-2"],
    agentModels: ["GPT-5.6-SOL", "claude-4.5-sonnet"],
    imageCostCents: "12",
    imageCostYuan: 0.12,
    trialImages: "3",
    imageModel: "cached-image",
    modelGroup: "vip",
    modelGroups: { vip: { desc: "高级模型", ratio: 2 } },
    channelName: "Managed New API",
    serviceReady: false,
    keyManaged: false
  }
);
assert.deepEqual(cached.models, ["gpt-5.6-sol", "gpt-image-2", "claude-4.5-sonnet"]);
assert.deepEqual(cached.imageModels, ["gpt-image-2", "cached-image"]);
assert.deepEqual(cached.agentModels, ["gpt-5.6-sol", "claude-4.5-sonnet"]);
assert.equal(cached.imageCostCents, 12);
assert.equal(cached.imageCostYuan, 0.12);
assert.equal(cached.trialImages, 3);
assert.equal(cached.imageModel, "cached-image");
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
