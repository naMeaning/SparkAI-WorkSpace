"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const { createRecipeStore, builtinToolManifest } = require("../desktop/recipe-store.cjs");
const { createRecipeRunService } = require("../desktop/recipe-run-service.cjs");
const { sealRecipeRun, validateRecipeRunAgainstRecipe } = require("../runtime/recipe-run-contract.cjs");

const root = path.join(__dirname, "..");
const runDir = path.join(root, ".diagnostics", `recipe-run-${Date.now().toString(36)}`);
const projectDir = path.join(runDir, "project");
const sourcePath = path.join(projectDir, "output", "source", "product.png");
mkdirSync(path.dirname(sourcePath), { recursive: true });
const inputBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1x8AAAAASUVORK5CYII=",
  "base64",
);
writeFileSync(sourcePath, inputBytes);
const inputHash = createHash("sha256").update(inputBytes).digest("hex");

const checks = [];
function check(name, operation) {
  return Promise.resolve(operation()).then(() => {
    checks.push(name);
  });
}

function atomicWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const { renameSync } = require("node:fs");
  renameSync(temp, filePath);
}

function projectFor(id) {
  return id === "recipe-run-project" ? {
    id,
    name: "Recipe Run Fixture",
    path: projectDir,
  } : null;
}

const recipeStore = createRecipeStore({
  projectFor,
  metaDir: ".naimage",
  writeJson: atomicWrite,
});

const inputIdentity = {
  assetId: "asset-source",
  occurrenceId: "occ-source",
  contentHash: inputHash,
};

function resolveInputAsset(projectId, identity) {
  assert.equal(projectId, "recipe-run-project");
  assert.equal(identity.assetId, inputIdentity.assetId);
  assert.equal(identity.contentHash, `sha256:${inputHash}`);
  return {
    assetId: inputIdentity.assetId,
    occurrenceId: inputIdentity.occurrenceId,
    contentHash: inputHash,
    path: sourcePath,
    relativePath: "output/source/product.png",
    displayCode: "SOURCE1",
    originalName: "product.png",
    mimeType: "image/png",
    width: 512,
    height: 512,
    canvasNodeId: "node-source",
    canvasAssetIndex: 0,
  };
}

function outputAsset(slotId) {
  const hash = createHash("sha256").update(`output:${slotId}`).digest("hex");
  return {
    assetId: `asset-${slotId}`,
    occurrenceId: `occ-${hash.slice(0, 24)}`,
    contentHash: hash,
    relativePath: `output/imagegen/recipe-${slotId}.png`,
    assetUrl: `naimage-asset://local/output/imagegen/recipe-${slotId}.png`,
    originalName: `recipe-${slotId}.png`,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    prompt: `prompt ${slotId}`,
    revisedPrompt: `revised ${slotId}`,
  };
}

function serviceFor(executeImage, recoverImage) {
  return createRecipeRunService({
    projectFor,
    recipeStore,
    resolveInputAsset,
    executeImage,
    recoverImage,
    metaDir: ".naimage",
    writeJson: atomicWrite,
  });
}

function preparation(service) {
  return service.prepare({
    projectId: "recipe-run-project",
    conversationId: "conversation-recipe",
    recipeId: "recipe.sparkvas.beauty-product-hero",
    input: inputIdentity,
    options: {
      sceneBrief: "Soft premium studio light with faithful packaging.",
      language: "en-US",
      slotDirections: {},
      ratio: "1:1",
      resolution: "1K",
      quality: "high",
    },
  });
}

async function waitTerminal(service, runId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = service.get({ projectId: "recipe-run-project", runId });
    if (["succeeded", "failed", "cancelled"].includes(result.run.status)) return result;
    await delay(20);
  }
  throw new Error(`Recipe Run did not settle: ${runId}`);
}

function runningRunFromPlan(plan, options = {}) {
  const submissionState = options.submissionState || "submitted";
  const recipe = recipeStore.get(plan.projectId, plan.recipeId);
  const tool = builtinToolManifest();
  const createdAt = new Date().toISOString();
  const executable = recipe.nodes.filter(node => ["Skill", "Transform", "Tool", "Review"].includes(node.type));
  const steps = executable.map(node => node.type === "Skill" ? {
    stepId: node.stepId,
    status: "succeeded",
    submissionState: "accepted",
    attempt: 1,
    startedAt: createdAt,
    finishedAt: createdAt,
    outputs: [],
  } : {
    stepId: node.stepId,
    status: node.stepId === "step.render-hero" ? "running" : "pending",
    submissionState: node.stepId === "step.render-hero" ? submissionState : "not_submitted",
    attempt: node.stepId === "step.render-hero" ? 1 : 0,
    ...(node.stepId === "step.render-hero" ? { startedAt: createdAt, operationId: `${plan.runId}:hero` } : {}),
    outputs: [],
  });
  const run = sealRecipeRun({
    schemaVersion: 1,
    runId: plan.runId,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    recipeHash: recipe.contentHash,
    projectId: plan.projectId,
    conversationId: plan.conversationId,
    requestedBy: "user",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    inputAssetIdentity: [{
      slotId: "product",
      assetId: inputIdentity.assetId,
      occurrenceId: inputIdentity.occurrenceId,
      contentHash: `sha256:${inputIdentity.contentHash}`,
    }],
    permissionSnapshot: {
      schemaVersion: 1,
      approvedBy: "user",
      approvedAt: createdAt,
      tools: [{
        toolId: tool.id,
        version: tool.version,
        contentHash: tool.contentHash,
        permissions: tool.permissions,
      }],
    },
    steps,
    outputs: [],
  });
  assert.ok(run);
  assert.equal(validateRecipeRunAgainstRecipe(run, recipe).ok, true);
  atomicWrite(path.join(projectDir, ".naimage", "recipe-runs", `${plan.runId}.json`), run);
  return run;
}

async function main() {
  await check("requires an explicit paid-run confirmation", async () => {
    const service = serviceFor(async () => ({ asset: outputAsset("hero") }));
    const prepared = preparation(service);
    assert.throws(
      () => service.start({ projectId: "recipe-run-project", runId: prepared.runId, confirmed: false }),
      error => error.code === "RECIPE_CONFIRMATION_REQUIRED",
    );
  });

  await check("rejects invalid Studio options without creating a Run plan", async () => {
    const service = serviceFor(async () => ({ asset: outputAsset("hero") }));
    assert.throws(
      () => service.prepare({
        projectId: "recipe-run-project",
        recipeId: "recipe.sparkvas.beauty-product-hero",
        input: inputIdentity,
        options: {
          sceneBrief: "valid brief",
          language: "zh-CN",
          slotDirections: {},
          ratio: "square",
          resolution: "1K",
          quality: "high",
        },
      }),
      error => error.code === "RECIPE_OPTIONS_INVALID",
    );
  });

  await check("runs six selected image slots and returns a sealed provenance Run", async () => {
    const calls = [];
    const service = serviceFor(async payload => {
      calls.push(payload.slotId);
      return { asset: outputAsset(payload.slotId) };
    });
    const prepared = preparation(service);
    assert.equal(prepared.expectedOutputs.length, 6);
    assert.equal(prepared.tool.permissions.network.join(","), "public");
    const started = service.start({
      projectId: "recipe-run-project",
      runId: prepared.runId,
      confirmed: true,
    });
    assert.equal(started.run.status, "running");
    const settled = await waitTerminal(service, prepared.runId);
    assert.equal(settled.run.status, "succeeded");
    assert.equal(settled.run.outputs.length, 6);
    assert.equal(settled.assets.length, 6);
    assert.deepEqual(calls, ["hero", "lifestyle", "detail", "model", "packaging", "social"]);
    assert.equal(settled.run.recipeHash, prepared.recipe.contentHash);
    assert.equal(settled.run.recipeVersion, prepared.recipe.version);
    assert.match(settled.run.scopeHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(settled.run.idempotencyKey, /^sha256:[a-f0-9]{64}$/);
    assert.ok(settled.run.permissionSnapshot.approvedAt);
    assert.equal(settled.run.steps.filter(step => step.status === "succeeded").length, 7);

    const repeated = service.start({
      projectId: "recipe-run-project",
      runId: prepared.runId,
      confirmed: true,
    });
    assert.equal(repeated.run.status, "succeeded");
    await delay(50);
    assert.equal(calls.length, 6, "A repeated start must not dispatch another paid request");
  });

  await check("blocks automatic resend after an unknown image submission", async () => {
    let calls = 0;
    const service = serviceFor(async () => {
      calls += 1;
      throw Object.assign(new Error("network outcome unknown"), { ambiguous: true });
    });
    const prepared = preparation(service);
    service.start({ projectId: "recipe-run-project", runId: prepared.runId, confirmed: true });
    const settled = await waitTerminal(service, prepared.runId);
    assert.equal(settled.run.status, "failed");
    const failedStep = settled.run.steps.find(step => step.stepId === "step.render-hero");
    assert.equal(failedStep.submissionState, "unknown");
    assert.equal(failedStep.error.retryable, false);
    service.resume({ projectId: "recipe-run-project", runId: prepared.runId });
    await delay(80);
    assert.equal(calls, 1, "Unknown submissions must not be resent");
  });

  await check("cancels an in-flight run without starting another request", async () => {
    let calls = 0;
    const service = serviceFor(payload => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        payload.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        }, { once: true });
      });
    });
    const prepared = preparation(service);
    service.start({ projectId: "recipe-run-project", runId: prepared.runId, confirmed: true });
    for (let attempt = 0; attempt < 100 && calls === 0; attempt += 1) await delay(20);
    service.cancel({ projectId: "recipe-run-project", runId: prepared.runId });
    const settled = await waitTerminal(service, prepared.runId);
    assert.equal(settled.run.status, "cancelled");
    assert.equal(calls, 1);
    assert.equal(settled.run.error.retryable, false);
  });

  await check("recovers an already submitted slot and executes only the remaining slots", async () => {
    let calls = 0;
    const prepared = preparation(serviceFor(async () => ({ asset: outputAsset("unused") })));
    runningRunFromPlan(JSON.parse(readFileSync(
      path.join(projectDir, ".naimage", "recipe-runs", `${prepared.runId}.input.json`),
      "utf8",
    )));
    const recoveredAsset = outputAsset("hero");
    const service = serviceFor(async payload => {
      calls += 1;
      return { asset: outputAsset(payload.slotId) };
    }, async payload => {
      if (payload.requestIndex !== 1) return { exists: false };
      return { exists: true, assets: [recoveredAsset], pending: false, unknown: false, failed: false };
    });
    service.resume({ projectId: "recipe-run-project", runId: prepared.runId });
    const settled = await waitTerminal(service, prepared.runId);
    assert.equal(settled.run.status, "succeeded");
    assert.equal(calls, 5);
    assert.equal(settled.run.outputs.length, 6);
    assert.equal(settled.assets.length, 6);
    assert.ok(settled.run.steps.every(step => step.status === "succeeded"));
  });

  await check("does not resend a persisted prepared step after a restart", async () => {
    let calls = 0;
    const prepared = preparation(serviceFor(async () => ({ asset: outputAsset("unused") })));
    runningRunFromPlan(JSON.parse(readFileSync(
      path.join(projectDir, ".naimage", "recipe-runs", `${prepared.runId}.input.json`),
      "utf8",
    )), { submissionState: "prepared" });
    const service = serviceFor(async () => {
      calls += 1;
      return { asset: outputAsset("unexpected") };
    }, async () => ({ exists: false }));
    service.resume({ projectId: "recipe-run-project", runId: prepared.runId });
    const settled = await waitTerminal(service, prepared.runId);
    assert.equal(settled.run.status, "failed");
    assert.equal(calls, 0, "A prepared step without journal evidence must not be dispatched again");
    const failedStep = settled.run.steps.find(step => step.stepId === "step.render-hero");
    assert.equal(failedStep.submissionState, "prepared");
    assert.equal(failedStep.error.code, "RECIPE_RESTART_BEFORE_DISPATCH");
    assert.equal(failedStep.error.retryable, false);
  });

  await check("leaves durable run and output sidecars in the project", () => {
    assert.equal(existsSync(path.join(projectDir, ".naimage", "recipe-runs")), true);
    assert.equal(existsSync(path.join(projectDir, ".naimage", "recipes", "recipes.json")), true);
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: checks.length,
    finalRunDir: runDir,
  })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
