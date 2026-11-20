"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { normalizeWorkflow, workflowBindings, workflowIssues, workflowStepPrompt, workflowAssetIdentity } = require("../runtime/sequential-workflow.mjs");
const { reusableRequirementText, REQUIREMENT_TEMPLATE_LIMITS } = require("../runtime/requirement-template-contract.mjs");

const emptyWorkflow = () => ({ version: 1, title: "未命名工作流", inputs: [], steps: [] });
const rejectedCodes = new Set([400, 401, 402, 403, 404, 422, 429]);
const terminalCodes = new Set([
  "NEW_API_IMAGE_TASK_FAILED",
  "SUB2API_IMAGE_TASK_FAILED",
  "IMAGE_OPERATION_TERMINAL",
  "COMFYUI_EXECUTION_FAILED",
  "COMFYUI_EXECUTION_INTERRUPTED",
  "COMFYUI_PROMPT_REJECTED"
]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = message => { throw new Error(message); };
const hasOperationOutput = operation => Boolean(
  operation && (
    ["saved", "partial", "delivery-failed", "response"].includes(operation.state)
    || operation.assets?.length
    || operation.slots?.length
    || operation.resultCount
  )
);
const isTerminalOperation = operation => Boolean(
  operation && !hasOperationOutput(operation)
  && (["failed", "canceled"].includes(operation.state) || (operation.provider === "comfyui" && operation.state === "rejected"))
);

function readStore(file, defaults) {
  if (!existsSync(file)) return { version: 1, ...defaults };
  const result = JSON.parse(readFileSync(file, "utf8"));
  if (result.version !== 1) fail("工作流记录版本无法读取。");
  return result;
}

function migrateTemplate(entry) {
  const template = entry.template;
  if (!template || entry.skill || entry.socialPlan || entry.scientificPlan || template.acceptance || template.scenario || template.materialNotes || template.styleNotes) return null;
  const variables = Array.isArray(template.variables) ? template.variables : [];
  const images = variables.filter(variable => variable.type === "image");
  if (images.length > 1 || images.some(variable => variable.role !== "source" || variable.required === false)) return null;
  if (variables.some(variable => !["image", "text"].includes(variable.type))) return null;
  if (variables.some(variable => variable.type === "text" && variable.maxLength !== undefined && variable.maxLength !== REQUIREMENT_TEMPLATE_LIMITS.value)) return null;
  // Only explicit single-image generation/editing templates can preserve their intent here.
  const kind = images.length === 1 && /^(编辑|修改)\b|^(编辑|修改)[：:]/u.test(entry.text) ? "edit"
    : !images.length && /^(生成图片|文生图)[：:]/u.test(entry.text) ? "generate" : null;
  if (!kind || images.some(image => entry.text.includes(`{{${image.key}}}`))) return null;
  const definition = normalizeWorkflow({ version: 1, title: entry.title,
    inputs: variables.map(variable => ({ id: variable.key, label: variable.label, type: variable.type, required: variable.required, defaultValue: variable.default })),
    steps: [{ id: "image", kind, prompt: entry.text, source: images.length ? { type: "input", id: images[0].key } : null }] });
  return workflowIssues(definition).length ? null : definition;
}

function createSequentialWorkflows({ projectFor, metaDir, libraryFile, write, listTemplates, storedCanvasAssets, resolveAsset, freezeConfig, generate, findOperation, recover, draftWithAgent, onChange, onError }) {
  const active = new Map();
  function fileFor(projectId) {
    const project = projectFor(projectId);
    if (!project?.path) fail("项目已移除，请重新选择项目。");
    return path.join(project.path, metaDir, "workflows.json");
  }
  function readProject(projectId) {
    return readStore(fileFor(projectId), { draft: { revision: 0, definition: emptyWorkflow(), bindings: {} }, runs: [] });
  }
  function patchRun(projectId, runId, update) {
    const state = readProject(projectId);
    const run = state.runs.find(item => item.id === runId);
    update(run);
    write(fileFor(projectId), state);
    onChange(projectId);
    return run;
  }
  function updateDraft(projectId, state, input, definition = normalizeWorkflow(input.definition)) {
    if (state.draft.revision !== input.expectedRevision) fail("草稿已更新，请重新打开后再编辑。");
    state.draft = { revision: state.draft.revision + 1, definition, bindings: workflowBindings(definition, input.bindings),
      ...(input.libraryId ? { libraryId: input.libraryId } : {}) };
    write(fileFor(projectId), state);
    onChange(projectId);
    return state.draft;
  }
  function readLibrary() {
    const library = readStore(libraryFile, { entries: [], migrations: {} });
    let changed = false;
    for (const template of listTemplates()) {
      if (Object.hasOwn(library.migrations, template.id)) continue;
      let definition;
      try { definition = migrateTemplate(template); } catch { /* The template remains available in the original library. */ }
      if (definition) library.entries.push({ id: `legacy-${template.id}`, revision: 1, legacyId: template.id, definition });
      library.migrations[template.id] = definition ? "imported" : "legacy";
      changed = true;
    }
    if (changed) write(libraryFile, library);
    return library;
  }
  function saveLibrary(draft) {
    const definition = normalizeWorkflow({ ...draft.definition, title: reusableRequirementText(draft.definition.title, 120),
      inputs: draft.definition.inputs.map(input => ({ ...input, label: reusableRequirementText(input.label, 120),
        ...(input.type === "text" ? { defaultValue: reusableRequirementText(input.defaultValue, 2000) } : {}) })),
      steps: draft.definition.steps.map(step => ({ ...step, prompt: reusableRequirementText(step.prompt) })) });
    if (workflowIssues(definition).length) fail("请修正步骤后再保存到我的工作流。");
    const library = readLibrary();
    const previous = library.entries.find(item => item.id === draft.libraryId);
    const entry = { ...previous, id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, definition };
    library.entries = [...library.entries.filter(item => item.id !== entry.id), entry];
    write(libraryFile, library);
    return entry;
  }
  function classify(run, index, error) {
    const step = run.steps[index];
    const operation = step.operationId ? findOperation(run.projectId, step.operationId) : null;
    if (error?.generationCompleted === true || hasOperationOutput(operation)) return "uncertain";
    if (isTerminalOperation(operation) || terminalCodes.has(error?.code)) return "failed";
    if (step.state === "recovering") return "uncertain";
    if (error?.unsafeToRetry || error?.ambiguous) return "uncertain";
    if (operation && (operation.state !== "rejected" || !rejectedCodes.has(Number(error?.status)))) return "uncertain";
    return "failed";
  }
  async function execute(projectId, initial, resume) {
    let run = initial;
    for (let index = 0; index < run.steps.length; index++) {
      const step = run.steps[index];
      if (step.state === "done") continue;
      if (!resume && !["queued", "done"].includes(step.state)) return;
      const definition = run.definition.steps[index];
      const sourceStep = definition.source?.type === "step" ? run.steps.find(item => item.id === definition.source.id) : null;
      const frozenSource = definition.source?.type === "input" ? run.bindings[definition.source.id] : sourceStep?.output;
      const operation = step.operationId ? findOperation(projectId, step.operationId) : null;
      const canRetryWithoutRecover = !hasOperationOutput(operation) && (
        step.state === "failed"
        || step.state === "queued"
        || (step.state === "running" && (!operation || isTerminalOperation(operation)))
      );
      const recovering = !canRetryWithoutRecover;
      if (recovering && !operation) {
        patchRun(projectId, run.id, next => { next.state = "uncertain"; next.steps[index].state = "uncertain"; next.steps[index].error = "找不到原请求回执。请核对渠道记录。"; });
        return;
      }
      const attempt = (step.attempt || 0) + (recovering ? 0 : 1);
      const operationId = recovering ? step.operationId : `${run.id}-${index + 1}-${attempt}`;
      run = patchRun(projectId, run.id, next => {
        next.state = "running";
        next.steps[index] = { id: step.id, state: recovering ? "recovering" : "running", operationId, attempt };
      });
      try {
        const artifacts = recovering ? await recover(projectId, operation.key) : await generate({ run, step: definition, index, operationId,
          source: frozenSource ? resolveAsset(projectId, frozenSource, sourceStep?.output) : null, prompt: workflowStepPrompt(definition, run.bindings) });
        const identity = workflowAssetIdentity(artifacts?.[0]);
        if (!identity) throw Object.assign(new Error("图片结果尚未保存，请恢复原请求。"), { unsafeToRetry: true, ...(artifacts?.length ? { generationCompleted: true } : {}) });
        run = patchRun(projectId, run.id, next => {
          next.steps[index] = { ...next.steps[index], state: "done", output: { ...artifacts[0], ...identity } };
          if (index === next.steps.length - 1) next.state = "done";
        });
      } catch (error) {
        const state = classify(run, index, error);
        patchRun(projectId, run.id, next => {
          next.state = state;
          next.steps[index] = { ...next.steps[index], state, error: state === "uncertain"
            ? "原请求尚未确认。可查询原结果。" : "步骤未完成。检查图片配置和输入后重试。" };
        });
        return;
      }
    }
    if (run.state !== "done" && run.steps.every(item => item.state === "done")) {
      patchRun(projectId, run.id, next => { next.state = "done"; });
    }
  }
  function launch(projectId, run, resume) {
    if (active.has(projectId)) fail("本项目已有工作流正在运行。");
    const task = Promise.resolve().then(() => execute(projectId, run, resume));
    active.set(projectId, task);
    void task.catch(onError).finally(() => { active.delete(projectId); onChange(projectId); });
  }
  function snapshot(projectId) {
    const state = readProject(projectId);
    const running = active.has(projectId);
    return { ...state, running, runs: state.runs.map(run => !running && run.state === "running" ? { ...run, state: "interrupted" } : run) };
  }
  async function command(input = {}) {
    const projectId = input.projectId;
    const state = readProject(projectId);
    if (input.action === "state") return snapshot(projectId);
    if (input.action === "published") {
      const published = new Set(Array.isArray(input.assetIds) ? input.assetIds : []);
      const stored = typeof storedCanvasAssets === "function" ? storedCanvasAssets(projectId) : null;
      const persisted = typeof storedCanvasAssets === "function"
        ? (stored instanceof Set ? stored : new Set(Array.isArray(stored) ? stored : []))
        : null;
      let changed = false;
      const assetIds = [];
      for (const run of state.runs) for (const step of run.steps) {
        const assetId = step.output?.assetId;
        if (!step.published && assetId && published.has(assetId) && (!persisted || persisted.has(assetId))) {
          step.published = true; changed = true; assetIds.push(assetId);
        }
      }
      if (changed) write(fileFor(projectId), state);
      return { assetIds };
    }
    if (input.action === "edit") return { draft: updateDraft(projectId, state, input) };
    if (input.action === "library") return readLibrary();
    if (input.action === "open") {
      const item = readLibrary().entries.find(entry => entry.id === input.libraryId);
      if (!item) fail("该工作流已不存在。");
      return { draft: updateDraft(projectId, state, { ...input, bindings: {} }, item.definition) };
    }
    if (input.action === "save") {
      if (input.expectedRevision !== state.draft.revision) fail("草稿已更新，请重试。");
      const entry = saveLibrary(state.draft);
      return { entry, draft: updateDraft(projectId, state, { ...input, libraryId: entry.id, bindings: state.draft.bindings }, state.draft.definition) };
    }
    if (input.action === "suggest") {
      const description = typeof input.description === "string" ? input.description.trim().slice(0, 8000) : "";
      if (input.confirm !== true || !description) fail("请输入工作流描述并确认使用 Agent。");
      if (input.expectedRevision !== state.draft.revision) fail("草稿已更新，请重试。");
      const definition = normalizeWorkflow(await draftWithAgent(projectId, description, state.draft.definition));
      if (workflowIssues(definition).length) fail("Agent 返回的步骤依赖无效，请调整描述后重试。");
      return { draft: updateDraft(projectId, readProject(projectId), { ...input, bindings: state.draft.bindings, libraryId: state.draft.libraryId }, definition) };
    }
    if (input.action === "start") {
      if (input.definition !== undefined || input.bindings !== undefined) fail("开始运行前请先保存草稿，不能在 start 中直接传入 definition 或 bindings。");
      if (input.confirm !== true || !/^wf-[a-f0-9-]{36}$/i.test(input.runId)) fail("开始运行需要确认和稳定运行 ID。");
      const prior = state.runs.find(run => run.id === input.runId);
      if (prior) return { runId: prior.id, state: prior.state };
      if (active.has(projectId)) fail("本项目已有工作流正在运行。");
      const draft = state.draft;
      if (input.expectedRevision !== draft.revision) fail("草稿已更新，请重新预检。");
      const issues = workflowIssues(draft.definition, draft.bindings);
      if (issues.length) fail(issues.map(issue => issue.message).join(" "));
      const used = new Set(draft.definition.steps.filter(step => step.source?.type === "input").map(step => step.source.id));
      const sourceNodes = Object.fromEntries([...used].map(id => [id, resolveAsset(projectId, draft.bindings[id]).canvasNodeId || ""]));
      const run = { id: input.runId, projectId, conversationId: String(input.conversationId || ""), state: "running", startedAt: new Date().toISOString(),
        definitionHash: digest(draft.definition), definition: draft.definition, draftRevision: draft.revision, libraryId: draft.libraryId,
        bindings: draft.bindings, sourceNodes, imageConfig: freezeConfig(projectId, input.conversationId), steps: draft.definition.steps.map(step => ({ id: step.id, state: "queued" })) };
      state.runs.unshift(run);
      write(fileFor(projectId), state);
      launch(projectId, run, false);
      return { runId: run.id, state: run.state };
    }
    if (input.action === "resume") {
      const run = state.runs.find(item => item.id === input.runId);
      if (input.confirm !== true || !run || run.state === "done") fail("请选择需要继续的运行并确认。");
      launch(projectId, run, true);
      return { runId: run.id, state: "running" };
    }
    return fail("不支持的工作流操作。");
  }
  return { command, isRunning: () => active.size > 0, isProjectRunning: projectId => Boolean(projectId) && active.has(projectId) };
}

module.exports = { createSequentialWorkflows };
