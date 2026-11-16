"use strict";

const assert = require("node:assert/strict");
const { sealSkillManifest } = require("../runtime/skill-contract.cjs");
const { sealToolManifest } = require("../runtime/tool-contract.cjs");
const {
  parseRecipeDocument,
  normalizeRecipeDocument,
  recipeContentHash,
  sealRecipeDocument,
} = require("../runtime/recipe-contract.cjs");
const { validateRecipeGraph, topologicalRecipeSteps } = require("../runtime/recipe-graph.cjs");
const {
  sealRecipeRun,
  parseRecipeRun,
  normalizeRecipeRun,
  recipeRunScopeHash,
  canTransitionRecipeRunStatus,
  recipeStepRetryDisposition,
  canRetryRecipeStep,
  validateRecipeRunAgainstRecipe,
  outputKindMatchesSlotType,
} = require("../runtime/recipe-run-contract.cjs");

const checks = [];
function check(name, operation) {
  operation();
  checks.push(name);
  console.log(`ok ${checks.length} ${name}`);
}

const skill = sealSkillManifest({
  schemaVersion: 1,
  id: "skill.sparkvas.product-hero",
  name: "商品主图导演",
  description: "规划商品主图与场景步骤。",
  version: "1.0.0",
  minAppVersion: "1.0.9",
  license: "CC-BY-4.0",
  instructions: "保留商品外形与品牌标识。",
  inputSlots: [{ slotId: "product", label: "商品图", dataType: "image", required: true }],
  parameters: [],
  examples: [],
  limitations: [],
  tags: ["commerce"],
});
const tool = sealToolManifest({
  schemaVersion: 1,
  id: "tool.sparkvas.image-generation",
  name: "内置图片生成",
  description: "调用受管图片执行链。",
  version: "1.0.0",
  minAppVersion: "1.0.9",
  license: "UNLICENSED",
  distribution: "builtin",
  adapter: "image-generation",
  inputSlots: [
    { portId: "source", label: "来源图片", dataType: "image", required: true },
    { portId: "prompt", label: "要求", dataType: "text", required: true },
  ],
  outputSlots: [{ portId: "result", label: "图片", dataType: "image" }],
  permissions: {
    network: ["public"],
    filesystem: ["managed-read", "managed-write"],
    process: ["none"],
    models: ["image-generation"],
    mcp: ["none"],
  },
  limitations: [],
  tags: ["builtin"],
});
assert.ok(skill && tool);

function recipeDraft() {
  return {
    schemaVersion: 1,
    id: "recipe.sparkvas.beauty-crossborder-set",
    name: "跨境美妆套图",
    description: "从一张商品图开始，生成可审阅的商品主图。",
    version: "1.0.0",
    minAppVersion: "1.0.9",
    license: "CC-BY-4.0",
    dependencies: [
      { kind: "skill", id: skill.id, version: skill.version, contentHash: skill.contentHash },
      { kind: "tool", id: tool.id, version: tool.version, contentHash: tool.contentHash },
    ],
    inputSlots: [{ slotId: "product", label: "商品图", dataType: "image", required: true }],
    outputContract: {
      schemaVersion: 1,
      outputs: [{ slotId: "result", label: "商品主图", dataType: "image", required: true }],
    },
    nodes: [
      {
        stepId: "step.input",
        type: "Input",
        title: "商品图",
        inputPorts: [],
        outputPorts: [{ portId: "product", label: "商品图", dataType: "image" }],
      },
      {
        stepId: "step.brief",
        type: "Brief",
        title: "创作说明",
        inputPorts: [],
        outputPorts: [
          { portId: "brief", label: "说明", dataType: "brief" },
          { portId: "prompt", label: "生成要求", dataType: "text" },
        ],
      },
      {
        stepId: "step.hero",
        type: "Skill",
        title: "商品主图导演",
        ref: { kind: "skill", id: skill.id, version: skill.version, contentHash: skill.contentHash },
        inputPorts: [
          { portId: "product", label: "商品图", dataType: "image", required: true },
          { portId: "brief", label: "说明", dataType: "brief", required: true },
        ],
        outputPorts: [{ portId: "result", label: "构图", dataType: "image" }],
      },
      {
        stepId: "step.render",
        type: "Tool",
        title: "生成图片",
        ref: { kind: "tool", id: tool.id, version: tool.version, contentHash: tool.contentHash },
        inputPorts: [
          { portId: "source", label: "来源", dataType: "image", required: true },
          { portId: "prompt", label: "要求", dataType: "text", required: true },
        ],
        outputPorts: [{ portId: "result", label: "成果", dataType: "image" }],
      },
      {
        stepId: "step.review",
        type: "Review",
        title: "审阅",
        inputPorts: [{ portId: "image", label: "成果", dataType: "image", required: true }],
        outputPorts: [{ portId: "approved", label: "通过", dataType: "image" }],
      },
      {
        stepId: "step.output",
        type: "Output",
        title: "交付",
        inputPorts: [{ portId: "result", label: "商品主图", dataType: "image", required: true }],
        outputPorts: [],
      },
    ],
    edges: [
      { edgeId: "edge.input-hero", fromStepId: "step.input", fromPortId: "product", toStepId: "step.hero", toPortId: "product" },
      { edgeId: "edge.brief-hero", fromStepId: "step.brief", fromPortId: "brief", toStepId: "step.hero", toPortId: "brief" },
      { edgeId: "edge.brief-render", fromStepId: "step.brief", fromPortId: "prompt", toStepId: "step.render", toPortId: "prompt" },
      { edgeId: "edge.hero-render", fromStepId: "step.hero", fromPortId: "result", toStepId: "step.render", toPortId: "source" },
      { edgeId: "edge.render-review", fromStepId: "step.render", fromPortId: "result", toStepId: "step.review", toPortId: "image" },
      { edgeId: "edge.review-output", fromStepId: "step.review", fromPortId: "approved", toStepId: "step.output", toPortId: "result" },
    ],
    tags: ["beauty", "commerce"],
  };
}

let sealedRecipe;
check("seals a complete semantic Recipe v1 DAG and verifies its hash", () => {
  sealedRecipe = sealRecipeDocument(recipeDraft());
  if (!sealedRecipe) {
    const diagnostic = parseRecipeDocument({ ...recipeDraft(), contentHash: `sha256:${"0".repeat(64)}` });
    assert.fail(JSON.stringify(diagnostic.errors));
  }
  assert.match(sealedRecipe.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalizeRecipeDocument(sealedRecipe), sealedRecipe);
  assert.equal(recipeContentHash({ ...sealedRecipe, nodes: [...sealedRecipe.nodes] }), sealedRecipe.contentHash);
  assert.deepEqual(topologicalRecipeSteps(sealedRecipe), [
    "step.input", "step.brief", "step.hero", "step.render", "step.review", "step.output",
  ]);
  assert.equal(validateRecipeGraph(sealedRecipe).ok, true);
});

check("rejects cycles, unsupported node types and duplicate step IDs", () => {
  const cycle = recipeDraft();
  cycle.edges.push({ edgeId: "edge.review-hero", fromStepId: "step.review", fromPortId: "approved", toStepId: "step.hero", toPortId: "product" });
  const cycleGraph = validateRecipeGraph(cycle, { requireComplete: false });
  assert.ok(cycleGraph.errors.some(error => error.code === "RECIPE_GRAPH_CYCLE"));
  const unknown = recipeDraft();
  unknown.nodes[2].type = "ComfyNode";
  const graph = validateRecipeGraph(unknown, { requireComplete: false });
  assert.ok(graph.errors.some(error => error.code === "RECIPE_NODE_TYPE_INVALID"));
  const duplicate = recipeDraft();
  duplicate.nodes[1].stepId = "step.input";
  const duplicateGraph = validateRecipeGraph(duplicate, { requireComplete: false });
  assert.ok(duplicateGraph.errors.some(error => error.code === "RECIPE_STEP_DUPLICATE"));
});

check("rejects missing ports, incompatible types, fan-in and missing dependencies", () => {
  const missing = recipeDraft();
  missing.edges = missing.edges.filter(edge => edge.edgeId !== "edge.hero-render");
  const missingGraph = validateRecipeGraph(missing);
  assert.ok(missingGraph.errors.some(error => error.code === "RECIPE_REQUIRED_PORT_UNCONNECTED"));
  const mismatch = recipeDraft();
  mismatch.edges.find(edge => edge.edgeId === "edge.input-hero").toPortId = "brief";
  const mismatchGraph = validateRecipeGraph(mismatch, { requireComplete: false });
  assert.ok(mismatchGraph.errors.some(error => error.code === "RECIPE_EDGE_TYPE_MISMATCH"));
  const fanIn = recipeDraft();
  fanIn.edges.push({ edgeId: "edge.input-render", fromStepId: "step.input", fromPortId: "product", toStepId: "step.render", toPortId: "source" });
  const fanInGraph = validateRecipeGraph(fanIn, { requireComplete: false });
  assert.ok(fanInGraph.errors.some(error => error.code === "RECIPE_EDGE_FAN_IN"));
  const missingDependency = recipeDraft();
  missingDependency.dependencies = missingDependency.dependencies.filter(dependency => dependency.kind !== "tool");
  assert.equal(sealRecipeDocument(missingDependency), undefined);
  const unused = recipeDraft();
  unused.dependencies.push({ kind: "skill", id: "skill.sparkvas.unused", version: "1.0.0", contentHash: skill.contentHash });
  assert.equal(sealRecipeDocument(unused), undefined);
  const omittedRequired = recipeDraft();
  omittedRequired.edges = omittedRequired.edges.filter(edge => edge.edgeId !== "edge.hero-render");
  delete omittedRequired.nodes.find(node => node.stepId === "step.render").inputPorts[0].required;
  const omittedRequiredGraph = validateRecipeGraph(omittedRequired);
  assert.ok(omittedRequiredGraph.errors.some(error => error.code === "RECIPE_REQUIRED_PORT_UNCONNECTED"));
});

check("enforces declared input/output slots and public-only node config", () => {
  const undeclared = recipeDraft();
  undeclared.nodes[0].outputPorts.push({ portId: "extra", label: "额外", dataType: "image" });
  const undeclaredGraph = validateRecipeGraph(undeclared);
  assert.ok(undeclaredGraph.errors.some(error => error.code === "RECIPE_INPUT_PORT_UNDECLARED"));
  const pathConfig = recipeDraft();
  pathConfig.nodes[2].config = { outputPath: "C:\\Users\\owner\\result.png" };
  assert.equal(sealRecipeDocument(pathConfig), undefined);
  const secretConfig = recipeDraft();
  secretConfig.nodes[2].config = { apiKey: "sk-private" };
  assert.equal(sealRecipeDocument(secretConfig), undefined);
  const sensitiveConfigs = [
    ["providerApiKey", { providerApiKey: "secret" }],
    ["internalEntryId", { internalEntryId: "entry-private" }],
    ["POSIX nested path", { source: "/data/customer/secret.png" }],
    ["POSIX rootless nested path", { source: "/data/customer" }],
    ["POSIX path with spaces", { source: "/data/My Folder/secret.png" }],
    ["POSIX single segment directory", { source: "/data" }],
    ["POSIX single segment file", { source: "/secret" }],
    ["POSIX root", { source: "/" }],
    ["POSIX root path", { source: "/secret.png" }],
    ["version-like descendant file", { source: "/v1.0/secret.png" }],
    ["numeric version descendant file", { source: "/1.2.3/file.png" }],
    ["file URL", { source: "file:/C:/Users/owner/secret.png" }],
  ];
  for (const [label, config] of sensitiveConfigs) {
    const candidate = recipeDraft();
    candidate.nodes[2].config = config;
    assert.equal(sealRecipeDocument(candidate), undefined, label);
  }
  const versionConfig = recipeDraft();
  versionConfig.nodes[2].config = { endpoint: "/v1.0", collection: "/v1.0/", docs: "/v1.0#docs" };
  assert.ok(sealRecipeDocument(versionConfig), "version-like slash token is not a filesystem path");
  const unknownOutputContract = recipeDraft();
  unknownOutputContract.outputContract.downloadUrl = "https://example.test/result.png?token=private";
  assert.equal(sealRecipeDocument(unknownOutputContract), undefined);
  const trailingStep = recipeDraft();
  trailingStep.nodes[2].stepId = "step.hero-";
  assert.ok(validateRecipeGraph(trailingStep, { requireComplete: false }).errors.some(error => error.code === "RECIPE_STEP_ID_INVALID"));
});

check("detects Recipe hash tampering and incomplete required connections", () => {
  const tampered = { ...sealedRecipe, description: "被静默修改的配方" };
  const parsed = parseRecipeDocument(tampered);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === "RECIPE_HASH_MISMATCH"));
  const incomplete = recipeDraft();
  incomplete.edges = incomplete.edges.filter(edge => edge.edgeId !== "edge.review-output");
  assert.equal(sealRecipeDocument(incomplete), undefined);
  assert.equal(sealRecipeDocument(incomplete, { requireComplete: false }).contentHash.length > 0, true);
});

const runBase = () => ({
  schemaVersion: 1,
  runId: "run.00000000-0000-4000-8000-000000000001",
  recipeId: sealedRecipe.id,
  recipeVersion: sealedRecipe.version,
  recipeHash: sealedRecipe.contentHash,
  projectId: "project-001",
  requestedBy: "user",
  status: "succeeded",
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:05.000Z",
  inputAssetIdentity: [{
    slotId: "product",
    assetId: "asset-001",
    occurrenceId: "occurrence-001",
    contentHash: `sha256:${"a".repeat(64)}`,
  }],
  permissionSnapshot: {
    schemaVersion: 1,
    approvedBy: "user",
    approvedAt: "2026-11-16T00:00:02.000Z",
    tools: [{
      toolId: tool.id,
      version: tool.version,
      contentHash: tool.contentHash,
      permissions: tool.permissions,
    }],
  },
  steps: [
    {
      stepId: "step.hero",
      status: "succeeded",
      submissionState: "accepted",
      attempt: 1,
      startedAt: "2026-11-16T00:00:02.000Z",
      finishedAt: "2026-11-16T00:00:03.000Z",
      operationId: "operation-001",
      outputs: [],
    },
    {
      stepId: "step.render",
      status: "succeeded",
      submissionState: "accepted",
      attempt: 1,
      startedAt: "2026-11-16T00:00:03.000Z",
      finishedAt: "2026-11-16T00:00:04.000Z",
      operationId: "operation-002",
      outputs: [],
    },
    {
      stepId: "step.review",
      status: "succeeded",
      submissionState: "accepted",
      attempt: 1,
      startedAt: "2026-11-16T00:00:04.000Z",
      finishedAt: "2026-11-16T00:00:05.000Z",
      operationId: "operation-003",
      outputs: [],
    },
  ],
  outputs: [{
    slotId: "result",
    assetId: "asset-002",
    occurrenceId: "occurrence-002",
    contentHash: `sha256:${"b".repeat(64)}`,
    kind: "image",
    mimeType: "image/png",
    width: 2048,
    height: 2048,
  }],
});

check("seals a Recipe Run with frozen scope and idempotency hashes", () => {
  const sealed = sealRecipeRun(runBase());
  assert.ok(sealed);
  assert.match(sealed.scopeHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(sealed.idempotencyKey, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalizeRecipeRun(sealed), sealed);
  assert.equal(normalizeRecipeRun({ ...sealed, outputs: [] }), undefined, "Succeeded runs require outputs");
  const changed = { ...sealed, inputAssetIdentity: [{ ...sealed.inputAssetIdentity[0], contentHash: `sha256:${"c".repeat(64)}` }] };
  const parsed = parseRecipeRun(changed);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === "RUN_SCOPE_HASH_MISMATCH"));
});

check("keeps unknown or disconnected submissions out of the retry path", () => {
  const failedUnknown = runBase();
  failedUnknown.status = "failed";
  failedUnknown.steps = [{ stepId: "step.render", status: "failed", submissionState: "unknown", attempt: 1, outputs: [] }];
  failedUnknown.outputs = [];
  failedUnknown.error = { code: "SUBMISSION_UNKNOWN", category: "network", message: "创建结果无法确认；需要先核对。", retryable: false, at: "2026-11-16T00:00:04.000Z" };
  const sealed = sealRecipeRun(failedUnknown);
  assert.ok(sealed);
  assert.equal(recipeStepRetryDisposition(sealed.steps[0]), "blocked");
  assert.equal(canRetryRecipeStep(sealed.steps[0]), false);
  assert.equal(recipeStepRetryDisposition({ status: "failed", submissionState: "submitted" }), "reconcile");
  assert.equal(recipeStepRetryDisposition({ status: "failed", submissionState: "accepted" }), "reconcile");
  assert.equal(recipeStepRetryDisposition({ status: "failed", submissionState: "not_submitted" }), "allowed");
  assert.equal(canRetryRecipeStep({ status: "failed", submissionState: "prepared" }), true);
  assert.equal(recipeStepRetryDisposition({ status: "succeeded", submissionState: "accepted" }), "not_retryable");
  const contradictory = failedUnknown;
  contradictory.steps[0].error = { code: "SUBMISSION_UNKNOWN", category: "network", message: "未知提交需核对。", retryable: true, at: "2026-11-16T00:00:04.000Z" };
  assert.equal(sealRecipeRun(contradictory), undefined);
});

check("uses a strict Run state machine and rejects private output paths", () => {
  assert.equal(canTransitionRecipeRunStatus("queued", "running"), true);
  assert.equal(canTransitionRecipeRunStatus("running", "succeeded"), true);
  assert.equal(canTransitionRecipeRunStatus("succeeded", "running"), false);
  assert.equal(canTransitionRecipeRunStatus("interrupted", "running"), true);
  assert.equal(canTransitionRecipeRunStatus("failed", "running"), false);
  const privateOutput = runBase();
  privateOutput.outputs[0].path = "C:\\Users\\owner\\result.png";
  assert.equal(sealRecipeRun(privateOutput), undefined);
  const posixOutput = runBase();
  posixOutput.status = "failed";
  posixOutput.steps = [{ stepId: "step.render", status: "failed", submissionState: "not_submitted", attempt: 1, outputs: [] }];
  posixOutput.outputs = [];
  posixOutput.error = { code: "INPUT_READ_FAILED", category: "input", message: "读取 /home/owner/result.png 失败", retryable: false, at: "2026-11-16T00:00:04.000Z" };
  assert.equal(sealRecipeRun(posixOutput), undefined);
  const badStep = runBase();
  badStep.steps[0].status = "teleported";
  assert.equal(sealRecipeRun(badStep), undefined);
});

check("derives a stable scope hash independent of input and permission ordering", () => {
  const base = runBase();
  const secondAsset = {
    slotId: "reference",
    assetId: "asset-reference",
    occurrenceId: "occurrence-reference",
    contentHash: `sha256:${"d".repeat(64)}`,
  };
  const secondTool = {
    toolId: "tool.sparkvas.second-adapter",
    version: "1.0.0",
    contentHash: `sha256:${"e".repeat(64)}`,
    permissions: { ...tool.permissions, network: ["public", "loopback"] },
  };
  const forward = recipeRunScopeHash({
    ...base,
    inputAssetIdentity: [base.inputAssetIdentity[0], secondAsset],
    permissionSnapshot: { ...base.permissionSnapshot, tools: [base.permissionSnapshot.tools[0], secondTool] },
  });
  const reversed = recipeRunScopeHash({
    ...base,
    inputAssetIdentity: [secondAsset, base.inputAssetIdentity[0]],
    permissionSnapshot: { ...base.permissionSnapshot, tools: [secondTool, base.permissionSnapshot.tools[0]] },
  });
  assert.equal(forward, reversed);
});

check("validates Run identity, slots, steps and permissions against its Recipe", () => {
  const sealedRun = sealRecipeRun(runBase());
  assert.ok(sealedRun);
  const conforming = validateRecipeRunAgainstRecipe(sealedRun, sealedRecipe);
  assert.equal(conforming.ok, true, JSON.stringify(conforming.errors));
  assert.deepEqual(conforming.value, sealedRun);

  const extraStep = runBase();
  extraStep.steps.push({
    stepId: "step.ghost",
    status: "succeeded",
    submissionState: "accepted",
    attempt: 1,
    outputs: [],
  });
  const extraStepResult = validateRecipeRunAgainstRecipe(sealRecipeRun(extraStep), sealedRecipe);
  assert.ok(extraStepResult.errors.some(error => error.code === "RUN_STEP_UNDECLARED"));

  const missingStep = runBase();
  missingStep.steps = missingStep.steps.filter(step => step.stepId !== "step.hero");
  const missingStepResult = validateRecipeRunAgainstRecipe(sealRecipeRun(missingStep), sealedRecipe);
  assert.ok(missingStepResult.errors.some(error => error.code === "RUN_EXECUTABLE_STEP_MISSING"));

  const extraInput = runBase();
  extraInput.inputAssetIdentity.push({
    slotId: "ghost",
    assetId: "asset-ghost",
    occurrenceId: "occurrence-ghost",
    contentHash: `sha256:${"f".repeat(64)}`,
  });
  const extraInputResult = validateRecipeRunAgainstRecipe(sealRecipeRun(extraInput), sealedRecipe);
  assert.ok(extraInputResult.errors.some(error => error.code === "RUN_INPUT_SLOT_UNDECLARED"));

  const missingPermission = runBase();
  missingPermission.permissionSnapshot.tools = [];
  const missingPermissionResult = validateRecipeRunAgainstRecipe(sealRecipeRun(missingPermission), sealedRecipe);
  assert.ok(missingPermissionResult.errors.some(error => error.code === "RUN_TOOL_PERMISSION_MISSING"));

  const wrongOutput = runBase();
  wrongOutput.outputs[0].slotId = "ghost";
  const wrongOutputResult = validateRecipeRunAgainstRecipe(sealRecipeRun(wrongOutput), sealedRecipe);
  assert.ok(wrongOutputResult.errors.some(error => error.code === "RUN_OUTPUT_SLOT_UNDECLARED"));
  assert.ok(wrongOutputResult.errors.some(error => error.code === "RUN_REQUIRED_OUTPUT_MISSING"));

  const wrongKind = runBase();
  wrongKind.outputs[0].kind = "video";
  wrongKind.outputs[0].mimeType = "video/mp4";
  const wrongKindResult = validateRecipeRunAgainstRecipe(sealRecipeRun(wrongKind), sealedRecipe);
  assert.ok(wrongKindResult.errors.some(error => error.code === "RUN_OUTPUT_TYPE_MISMATCH"));

  const wrongStepOutput = runBase();
  wrongStepOutput.steps[1].outputs = [{
    slotId: "result",
    assetId: "asset-step",
    occurrenceId: "occurrence-step",
    contentHash: `sha256:${"9".repeat(64)}`,
    kind: "video",
    mimeType: "video/mp4",
  }];
  const wrongStepOutputResult = validateRecipeRunAgainstRecipe(sealRecipeRun(wrongStepOutput), sealedRecipe);
  assert.ok(wrongStepOutputResult.errors.some(error => error.code === "RUN_STEP_OUTPUT_TYPE_MISMATCH"));

  const wrongVersion = runBase();
  wrongVersion.recipeVersion = "1.0.1";
  const wrongVersionResult = validateRecipeRunAgainstRecipe(sealRecipeRun(wrongVersion), sealedRecipe);
  assert.ok(wrongVersionResult.errors.some(error => error.code === "RUN_RECIPE_VERSION_MISMATCH"));
});

check("maps Run output kinds onto Recipe output slot types", () => {
  assert.equal(outputKindMatchesSlotType("image", "image"), true);
  assert.equal(outputKindMatchesSlotType("video", "video"), true);
  assert.equal(outputKindMatchesSlotType("bundle", "bundle"), true);
  assert.equal(outputKindMatchesSlotType("image", "asset"), true);
  assert.equal(outputKindMatchesSlotType("video", "asset"), true);
  assert.equal(outputKindMatchesSlotType("bundle", "asset"), true);
  assert.equal(outputKindMatchesSlotType("video", "image"), false);
  assert.equal(outputKindMatchesSlotType("image", "text"), false);
  assert.equal(outputKindMatchesSlotType("image", "any"), true);
  assert.equal(outputKindMatchesSlotType("video", "any"), true);
  assert.equal(outputKindMatchesSlotType("bundle", "any"), true);

  const anySlotRecipe = recipeDraft();
  anySlotRecipe.outputContract.outputs[0].dataType = "any";
  anySlotRecipe.nodes.find(node => node.stepId === "step.output").inputPorts[0].dataType = "any";
  const sealedAnySlotRecipe = sealRecipeDocument(anySlotRecipe);
  assert.ok(sealedAnySlotRecipe);
  for (const [kind, mimeType] of [["image", "image/png"], ["video", "video/mp4"], ["bundle", "application/zip"]]) {
    const run = runBase();
    run.recipeId = sealedAnySlotRecipe.id;
    run.recipeVersion = sealedAnySlotRecipe.version;
    run.recipeHash = sealedAnySlotRecipe.contentHash;
    run.outputs[0].kind = kind;
    run.outputs[0].mimeType = mimeType;
    const result = validateRecipeRunAgainstRecipe(sealRecipeRun(run), sealedAnySlotRecipe);
    assert.equal(result.ok, true, `${kind}: ${JSON.stringify(result.errors)}`);
  }
});

console.log(JSON.stringify({
  ok: true,
  checks: checks.length,
  manifests: ["RecipeDocument v1", "RecipeRun v1"],
  graph: "DAG/ports/cycles/topological-order",
  realModelRequests: 0,
}));
