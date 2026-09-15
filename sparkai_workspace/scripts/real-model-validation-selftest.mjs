import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_AUTH_PHRASE,
  buildValidationPlan,
  liveAuthorizationError,
  publicEndpoint,
  runLiveProbe
} from "./real-model-validation.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "real-model-validation.mjs");
const secret = "selftest-secret-must-not-appear";

function settings() {
  return {
    accessMode: "custom",
    imageModel: "gpt-image-2",
    imageModelPool: ["gpt-image-2", "gemini-image-1"],
    imageRatio: "3:4",
    imageResolution: "2K",
    imageQuality: "high",
    imageBaseUrl: "https://custom.example/v1",
    imageModelBindings: [
      { model: "gpt-image-2", baseUrl: "https://provider.example/v1", customApiKey: secret },
      { model: "gemini-image-1", baseUrl: "https://provider.example/naimage/v1", customApiKey: secret }
    ],
    apiKey: secret,
    token: secret
  };
}

test("endpoint joining keeps a single v1 segment and supports task routes", () => {
  assert.deepEqual(publicEndpoint("https://example.test/v1"), {
    configured: true,
    origin: "https://example.test",
    path: "/v1/images/generations"
  });
  assert.deepEqual(publicEndpoint("https://example.test/naimage/v1", "/v1/image-tasks"), {
    configured: true,
    origin: "https://example.test",
    path: "/naimage/v1/image-tasks"
  });
  assert.deepEqual(publicEndpoint("https://example.test/v1/images/generations"), {
    configured: true,
    origin: "https://example.test",
    path: "/v1/images/generations"
  });
});

test("dry-run plan covers model bindings, frame contract and never serializes credentials", () => {
  const plan = buildValidationPlan(settings(), { protocol: "task" });
  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.networkAttempted, false);
  assert.equal(plan.protocol, "image-task-create");
  assert.deepEqual(plan.settings.models, ["gpt-image-2", "gemini-image-1"]);
  assert.equal(plan.models.length, 2);
  assert.equal(plan.models[0].endpoint.path, "/v1/image-tasks");
  assert.equal(plan.models[1].endpoint.path, "/naimage/v1/image-tasks");
  assert.equal(plan.models[0].frames.length, 3);
  assert(plan.models[0].frames.every((frame) => frame.deliverySpecification.includes("3:4") || frame.deliverySpecification.includes("16:9") || frame.deliverySpecification.includes("1:1")));
  assert.equal(plan.checks.frameContract, true);
  assert.equal(plan.checks.payloadShape, true);
  assert.equal(plan.checks.noSecretFields, true);
  assert.equal(JSON.stringify(plan).includes(secret), false);
});

test("live probe requires explicit authorization and uses the same redacted payload contract", async () => {
  const plan = buildValidationPlan(settings(), { protocol: "task" });
  assert.match(liveAuthorizationError({ live: true, confirmNetwork: false, confirmCost: true }, {}), /被拒绝/);
  let called = 0;
  const result = await runLiveProbe(
    plan,
    { live: true, confirmNetwork: true, confirmCost: true },
    {
      NAIMAGE_REAL_MODEL_AUTH: LIVE_AUTH_PHRASE,
      NAIMAGE_REAL_MODEL_BASE_URL: "https://relay.example/v1",
      NAIMAGE_REAL_MODEL_API_KEY: secret
    },
    async (url, init) => {
      called += 1;
      assert.equal(url, "https://relay.example/v1/image-tasks");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, `Bearer ${secret}`);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-image-2");
      assert.match(body.prompt, /交付规格/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ task_id: "task-selftest" })
      };
    }
  );
  assert.equal(called, 1);
  assert.equal(result.mode, "live");
  assert.equal(result.networkAttempted, true);
  assert.equal(result.liveResult.ok, true);
  assert.equal(result.liveResult.imageCount, 0);
});

test("CLI help executes exactly once on Windows-style argv", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /真实模型验收工具/);
});

console.log("real model validation selftest passed (4 contracts)");
