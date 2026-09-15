"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAgentRuntime } = require("../agent-runtime.cjs");

function modelToolResponse() {
  return {
    choices: [{
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-compose-fixture",
          type: "function",
          function: {
            name: "image_gen",
            arguments: JSON.stringify({
              operation: "compose",
              prompt: "明亮自然光下的产品静物摄影，构图清晰，材质真实。",
              ratio: "1:1",
              resolution: "1K",
              quality: "auto",
              count: 1
            })
          }
        }]
      }
    }]
  };
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-agent-model-binding-"));
  const originalFetch = globalThis.fetch;
  const requests = [];
  let runtime;
  try {
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() { return modelToolResponse(); },
        async text() { return JSON.stringify(modelToolResponse()); }
      };
    };
    runtime = createAgentRuntime({
      projectRoot: tempRoot,
      configDir: path.join(tempRoot, "config"),
      imageRoots: [tempRoot]
    });

    const baseSettings = {
      accessMode: "custom",
      agentBaseUrl: "https://global-agent.example/v1",
      agentApiKey: "global-agent-key",
      agentModel: "bound-agent-model",
      agentModelBindings: [{
        model: "bound-agent-model",
        customBaseUrl: "https://bound-agent.example/custom/v1/",
        customApiKey: "bound-agent-key"
      }]
    };
    const compose = (settings) => runtime.composeImagePrompt({
      settings,
      request: "优化产品图提示词。",
      currentPrompt: "产品静物",
      currentRatio: "1:1",
      currentResolution: "1K",
      currentCount: 1,
      currentQuality: "auto"
    });

    assert.equal((await compose(baseSettings)).ok, true);
    assert.equal(requests.at(-1).url, "https://bound-agent.example/custom/v1/chat/completions");
    assert.equal(requests.at(-1).options.headers.Authorization, "Bearer bound-agent-key");
    assert.equal(JSON.parse(requests.at(-1).options.body).model, "bound-agent-model");

    assert.equal((await compose({ ...baseSettings, agentModel: "unbound-agent-model" })).ok, true);
    assert.equal(requests.at(-1).url, "https://global-agent.example/v1/chat/completions");
    assert.equal(requests.at(-1).options.headers.Authorization, "Bearer global-agent-key");

    assert.equal((await compose({
      ...baseSettings,
      agentModel: "key-only-agent-model",
      agentModelBindings: [{ model: "key-only-agent-model", customApiKey: "key-only-secret" }]
    })).ok, true);
    assert.equal(requests.at(-1).url, "https://global-agent.example/v1/chat/completions");
    assert.equal(requests.at(-1).options.headers.Authorization, "Bearer key-only-secret");

    assert.equal((await compose({ ...baseSettings, accessMode: "account" })).ok, true);
    assert.equal(requests.at(-1).url, "https://global-agent.example/v1/chat/completions");
    assert.equal(requests.at(-1).options.headers.Authorization, "Bearer global-agent-key");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 4,
      perModelCustomCredentials: true,
      unboundGlobalFallback: true,
      partialBindingInheritance: true,
      accountBindingResolvedByMainOnly: true
    })}\n`);
  } finally {
    runtime?.dispose?.();
    globalThis.fetch = originalFetch;
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
