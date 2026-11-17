"use strict";

const assert = require("node:assert/strict");

const { registerRecipeIpc } = require("../desktop/ipc/recipe-ipc.cjs");

const handlers = new Map();
const ipcMain = {
  handle(channel, handler) {
    assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
    handlers.set(channel, handler);
  },
};

const recipe = {
  id: "recipe.sparkvas.beauty-product-hero",
  name: "Beauty",
  version: "1.0.0",
  contentHash: `sha256:${"a".repeat(64)}`,
};
const store = {
  list(projectId) {
    assert.equal(projectId, "project-ipc");
    return { revision: 1, recipes: [recipe] };
  },
  get(projectId) {
    assert.equal(projectId, "project-ipc");
    return recipe;
  },
};
const calls = [];
const runService = {
  prepare(payload) {
    calls.push(["prepare", payload.runId]);
    return { runId: payload.runId, recipe };
  },
  start(payload) {
    calls.push(["start", payload.runId]);
    return { run: { runId: payload.runId, status: "running" }, assets: [], recipe };
  },
  get(payload) {
    if (!payload.projectId) throw Object.assign(new Error("project required"), { code: "PROJECT_REQUIRED" });
    return { run: { runId: payload.runId, status: "succeeded" }, assets: [], recipe };
  },
  listRuns() {
    return { runs: [] };
  },
  cancel(payload) {
    return { cancelling: true, run: { runId: payload.runId, status: "running" } };
  },
  resume(payload) {
    return { run: { runId: payload.runId, status: "running" }, assets: [], recipe };
  },
};

registerRecipeIpc({ ipcMain, recipeStore: store, recipeRunService: runService });

async function main() {
  assert.deepEqual([...handlers.keys()].sort(), [
    "naimage:recipe:cancel",
    "naimage:recipe:get",
    "naimage:recipe:list",
    "naimage:recipe:list-runs",
    "naimage:recipe:prepare",
    "naimage:recipe:resume",
    "naimage:recipe:start",
  ]);

  const listed = await handlers.get("naimage:recipe:list")({}, { projectId: "project-ipc" });
  assert.equal(listed.ok, true);
  assert.equal(listed.recipes.length, 1);

  const prepared = await handlers.get("naimage:recipe:prepare")({}, {
    projectId: "project-ipc",
    runId: "run.00000000-0000-4000-8000-000000000001",
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(calls.at(-1), ["prepare", "run.00000000-0000-4000-8000-000000000001"]);

  const blocked = await handlers.get("naimage:recipe:start")({}, {
    projectId: "project-ipc",
    runId: "run.00000000-0000-4000-8000-000000000001",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.errorCode, "RECIPE_CONFIRMATION_REQUIRED");
  assert.equal(calls.filter(item => item[0] === "start").length, 0);

  const started = await handlers.get("naimage:recipe:start")({}, {
    projectId: "project-ipc",
    runId: "run.00000000-0000-4000-8000-000000000001",
    confirmed: true,
  });
  assert.equal(started.ok, true);
  assert.equal(started.run.status, "running");

  const failed = await handlers.get("naimage:recipe:get")({}, {
    projectId: "",
    runId: "run.00000000-0000-4000-8000-000000000001",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "PROJECT_REQUIRED");

  process.stdout.write(`${JSON.stringify({ ok: true, checks: 6, channels: handlers.size })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
