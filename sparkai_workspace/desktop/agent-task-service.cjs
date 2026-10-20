"use strict";
const { projectKnowledgeReceipt, normalizeProjectKnowledgeReceipt } = require("../runtime/project-knowledge-contract.mjs");
const { normalizeRequirementTemplateSnapshot } = require("../runtime/requirement-template-contract.mjs");

const path = require("node:path");
const fs = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { normalizeImageConfigSnapshot } = require("../runtime/image-config-snapshot.mjs");
const { redactText, validateSchemaValue } = require("./debug-command-service.cjs");
const { normalizeCreationReference, normalizeCreationTarget } = require("./project-creation-service.cjs");
const definitions = new Map(require("../integrations/naimage-control/references/commands.schema.json").sections.flatMap(section => section.commands).map(command => [command.name, command]));

const COMMANDS = ["agent.task.start", "agent.task.get", "agent.task.wait", "agent.task.answer"];
const ACTIVE = new Set(["preparing", "accepted", "running", "resuming", "waiting"]);
const fail = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const id = value => String(value || "").trim();
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value, limit = 500) => redactText(String(value || ""))
  .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]")
  .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace)\/[^\s<>"']+/g, "[路径已隐藏]")
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, limit);
const requiredId = (value, name) => {
  const result = id(value);
  if (!/^[\p{L}\p{N}_.:@-]{1,180}$/u.test(result)) throw fail("TASK_ARGUMENT_INVALID", `${name} 需要有效的明确身份。`);
  return result;
};
const safeProjection = value => typeof value === "string" ? text(value, 180) : Array.isArray(value)
  ? value.map(safeProjection) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeProjection(item)])) : value;

function canonicalRequest(input) {
  const prompt = String(input.prompt || "").replace(/\r\n?/g, "\n").trim();
  if (!prompt || prompt.length > 200_000) throw fail("TASK_ARGUMENT_INVALID", "任务要求不能为空且不能超过 200000 字符。");
  const ids = input.sourceNodeIds ?? [];
  if (!Array.isArray(ids) || ids.length > 200) throw fail("TASK_ARGUMENT_INVALID", "sourceNodeIds 必须为最多 200 个明确素材身份。");
  return { prompt, sourceNodeIds: [...new Set(ids.map(value => requiredId(value, "sourceNodeId")))],
    ...(input.projectKnowledge ? { projectKnowledge: projectKnowledgeReceipt(input.projectKnowledge) || normalizeProjectKnowledgeReceipt(input.projectKnowledge) } : {}),
    ...(input.template ? { template: normalizeRequirementTemplateSnapshot(input.template) } : {}),
    ratio: id(input.ratio) || null, resolution: id(input.resolution).toUpperCase() || null, title: String(input.title || "").trim(),
    ...(input.creation ? { creation: { ...normalizeCreationReference(input.creation),
      ...(input.creation.revisionPlan ? { revisionId: input.creation.revisionPlan.revisionId,
        targets: input.creation.revisionPlan.targets?.map(value => ({ assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash,
          ...(value.mask ? { mask: normalizeCreationTarget(value.mask) } : {}) })) } : {}) } } : {}) };
}

function scopeProjection(scope) {
  if (!scope || !id(scope.snapshotHash)) throw fail("TASK_SCOPE_REQUIRED", "任务尚未冻结素材范围。");
  if (scope.maskAssets !== undefined && (!Array.isArray(scope.maskAssets) || scope.maskAssets.length > 1)) throw fail("TASK_SCOPE_CONFLICT", "区域修改只能冻结一个明确蒙版。");
  // Never persist renderer paths, URLs, arbitrary tool arguments or settings.
  const assets = values => (Array.isArray(values) ? values : []).slice(0, 240).map(item => ({
    assetId: text(item.assetId, 180), nodeId: text(item.nodeId || item.ownerNodeId, 180),
    ...(item.occurrenceId ? { occurrenceId: text(item.occurrenceId, 180) } : {}), role: item.role === "reference" ? "reference" : "source"
    , ...(item.contentHash ? { contentHash: text(item.contentHash, 128) } : {})
  }));
  return { snapshotHash: text(scope.snapshotHash, 180), origin: text(scope.origin, 30), scopeType: text(scope.scopeType, 30),
    sourceNodeIds: (scope.sourceNodeIds || []).map(value => text(value, 180)).slice(0, 200),
    sourceAssets: assets(scope.sourceAssets), referenceAssets: assets(scope.referenceAssets),
    ...(scope.maskAssets?.length ? { maskAssets: scope.maskAssets.map(item => ({ ...normalizeCreationTarget(item), target: normalizeCreationTarget(item.target) })) } : {}),
    imageConfig: safeProjection(normalizeImageConfigSnapshot(scope.imageConfig)),
    ...(projectKnowledgeReceipt(scope.projectKnowledge) ? { projectKnowledge: projectKnowledgeReceipt(scope.projectKnowledge) } : {}),
    ...(scope.template ? { template: normalizeRequirementTemplateSnapshot(scope.template) } : {}),
    ...(normalizeCreationReference(scope.creation) ? { creation: normalizeCreationReference(scope.creation) } : {}) };
}

/** Durable receipts only. Renderer executes; run control cancels; image journal recovers. */
function createAgentTaskService({ projectFor, readSession, runSnapshot = () => ({ runs: [] }), locateOwner, dispatch,
  operations = () => [], freezeProjectKnowledge = () => undefined, validateProjectKnowledge = () => {}, creationRequirements = () => null, validateCreationScope = () => {}, metaDir = ".naimage", onChange = () => {}, maxTasks = 2000 }) {
  const instance = randomUUID(), inflight = new Map(), knownProjects = new Set();
  function location(projectId) {
    const project = projectFor(projectId);
    if (!project?.path) throw fail("PROJECT_NOT_FOUND", "任务所属项目不存在，请重新打开原项目。");
    knownProjects.add(projectId);
    return path.join(project.path, metaDir, "agent", "tasks.json");
  }
  function save(projectId, ledger) {
    const file = location(projectId); fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`, descriptor = fs.openSync(temporary, "w", 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(ledger)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
    onChange(projectId);
  }
  function pendingFor(task) {
    const pending = readSession(task.projectId)?.pendingAgentExecution;
    return pending?.projectId === task.projectId && pending?.conversationId === task.conversationId &&
      pending?.taskId === task.taskId ? pending : null;
  }
  function read(projectId) {
    const file = location(projectId);
    if (!fs.existsSync(file)) return { schemaVersion: 1, tasks: [] };
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw fail("TASK_LEDGER_INVALID", "任务记录无法读取，已停止派发；请保留原项目恢复记录。"); }
    if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger.tasks) || ledger.tasks.some(task => !task.taskId || !task.requestHash || !task.submissionKey || !Number.isSafeInteger(task.version))) {
      throw fail("TASK_LEDGER_INVALID", "任务记录格式无效，已停止派发。");
    }
    let changed = false;
    for (const task of ledger.tasks) {
      if (task.instance === instance) continue;
      task.instance = instance; task.ownerId = "";
      if (ACTIVE.has(task.phase)) {
        const pending = task.phase === "waiting" && pendingFor(task);
        if (!pending || pending.requestId !== task.question?.requestId) {
          task.phase = "interrupted"; task.question = null;
          task.error = { code: "TASK_INTERRUPTED", message: "原执行已中断。可恢复原图片结果，不能自动重新执行。" };
        }
        task.version++; task.updatedAt = new Date().toISOString(); changed = true;
      }
    }
    if (changed) save(projectId, ledger);
    return ledger;
  }
  const target = input => ({ projectId: requiredId(input.expectedProjectId || input.projectId, "expectedProjectId"), conversationId: requiredId(input.conversationId, "conversationId") });
  function lookup(input, ledger) {
    const scope = target(input); ledger ||= read(scope.projectId);
    const task = input.taskId ? ledger.tasks.find(task => task.taskId === input.taskId && task.conversationId === scope.conversationId)
      : input.submissionId ? ledger.tasks.find(task => task.submissionKey === submissionKey(scope, input.submissionId))
      : ledger.tasks.filter(task => task.conversationId === scope.conversationId).at(-1);
    if (!task) throw fail("TASK_NOT_FOUND", "该项目/会话中没有对应任务。");
    return task;
  }
  function submissionKey(scope, submissionId) { return digest([scope.projectId, scope.conversationId, requiredId(submissionId, "submissionId")]); }
  function change(task, ledger, values) {
    Object.assign(task, values, { version: task.version + 1, updatedAt: new Date().toISOString() });
    save(task.projectId, ledger); return task;
  }
  function busy(scope, ledger, except = "") {
    if (ledger.tasks.some(task => task.taskId !== except && task.conversationId === scope.conversationId && ACTIVE.has(task.phase)) ||
      runSnapshot().runs?.some(run => run.projectId === scope.projectId && run.conversationId === scope.conversationId)) {
      throw fail("TASK_BUSY", "原项目会话已有任务，请等待、回答或结束后再启动新任务。");
    }
  }
  function assertStartAvailable(input) {
    const scope = target(input), ledger = read(scope.projectId), key = submissionKey(scope, input.submissionId);
    const previous = ledger.tasks.find(task => task.submissionKey === key);
    if (previous) return { available: true, duplicate: true, taskId: previous.taskId, revisionId: previous.revisionId || null };
    busy(scope, ledger);
    const pending = readSession(scope.projectId)?.pendingAgentExecution;
    const pendingTask = pending?.taskId && ledger.tasks.find(task => task.taskId === pending.taskId && task.conversationId === scope.conversationId);
    if (pending?.conversationId === scope.conversationId && (!pendingTask || !["completed", "partial", "failed", "stopped", "interrupted"].includes(pendingTask.phase))) {
      throw fail("TASK_BUSY", "该会话仍有待回答任务。");
    }
    if (ledger.tasks.length >= maxTasks) throw fail("TASK_LEDGER_FULL", "任务记录已满；未改变创作要求或启动新任务。");
    return { available: true, duplicate: false };
  }
  function revisionContext(input) {
    const scope = target(input), ledger = read(scope.projectId), session = readSession(scope.projectId);
    const targets = (Array.isArray(input.targets) ? input.targets : []).map(normalizeCreationTarget);
    if (!targets.length || targets.length > 200) throw fail("CREATION_REVISION_INVALID", "定向修订需要明确的成果目标。");
    const candidates = ledger.tasks.filter(task => task.conversationId === scope.conversationId);
    const materials = (session?.nodes || []).flatMap(node => (node.assets || []).map(asset => ({ node, asset })));
    const hashOf = asset => String(asset?.contentHash || asset?.sha256 || "").toLowerCase();
    const sameIdentity = (asset, target) => asset.assetId === target.assetId && asset.occurrenceId === target.occurrenceId;
    const projectOperations = operations(scope.projectId);
    const evidence = candidates.map(task => {
      const linked = projectOperations.filter(operation => operation.agentTaskId === task.taskId || task.runIds.includes(operation.runId));
      return { task, linked, results: publicTask(task, { session, linked }).results };
    });
    const originalTasks = new Map();
    let missingHistory = false;
    for (const result of targets) {
      const found = materials.find(value => sameIdentity(value.asset, result) && hashOf(value.asset) === result.contentHash);
      if (!found) throw fail("CREATION_TARGET_STALE", "所选成果身份或内容已变化，请重新选择后修改。");
      const runId = id(found.asset.runId);
      const byRun = runId ? evidence.filter(value => value.task.runIds.includes(runId) || value.linked.some(operation => operation.runId === runId)).map(value => value.task) : [];
      const byResult = evidence.filter(value => value.results.some(asset => sameIdentity(asset, result) && asset.contentHash === result.contentHash)).map(value => value.task);
      const matched = byRun.length ? byRun : byResult;
      const frozen = matched.filter(task => normalizeImageConfigSnapshot(task.scope?.imageConfig));
      if (!frozen.length) { missingHistory = true; continue; }
      for (const task of frozen) originalTasks.set(task.taskId, task);
    }
    // Old projects can have outputs without task receipts. Do not attribute the
    // current configuration to a historical task whose evidence does not exist.
    if (!originalTasks.size) return null;
    if (missingHistory) throw fail("CREATION_REVISION_CONFIG_CONFLICT", "所选成果的原任务记录不完整，请按相同原配置分别修改。");
    const configs = [...originalTasks.values()].map(task => safeProjection(normalizeImageConfigSnapshot({ ...task.scope.imageConfig, count: 1 })));
    if (configs.some(config => digest(config) !== digest(configs[0]))) {
      throw fail("CREATION_REVISION_CONFIG_CONFLICT", "所选成果使用了不同的原图片配置，请分别修改。");
    }
    const referenceAssets = new Map();
    for (const task of originalTasks.values()) for (const reference of task.scope.referenceAssets || []) {
      const contentHash = hashOf(reference);
      const matches = materials.filter(value => value.asset.assetId === reference.assetId &&
        (!reference.occurrenceId || value.asset.occurrenceId === reference.occurrenceId) && /^[a-f0-9]{64}$/.test(contentHash) && hashOf(value.asset) === contentHash);
      const identities = new Set(matches.map(value => value.asset.occurrenceId));
      if (!matches.length || identities.size !== 1) throw fail("CREATION_REVISION_REFERENCE_STALE", "原任务参考图已缺失、内容变化或身份不明确，请恢复后修改。");
      const found = matches.find(value => value.node.id === reference.nodeId) || matches[0];
      const value = { ...normalizeCreationTarget(found.asset), nodeId: requiredId(found.node.id, "referenceNodeId"), role: "reference" };
      referenceAssets.set(JSON.stringify([value.assetId, value.occurrenceId, value.contentHash]), value);
    }
    const references = [...referenceAssets.values()];
    return { imageConfig: configs[0], parentTaskIds: [...originalTasks.keys()].map(value => requiredId(value, "parentTaskId")),
      referenceAssets: references, referenceNodeIds: [...new Set(references.map(value => value.nodeId))] };
  }
  function reserve(input) {
    const scope = target(input), ledger = read(scope.projectId), key = submissionKey(scope, input.submissionId);
    const previous = ledger.tasks.find(task => task.submissionKey === key);
    const explicitRequirements = input.creation || input.requirementId || input.expectedRequirementsRevision !== undefined;
    const frozenRequirements = () => normalizeCreationReference(input.creation) || normalizeCreationReference(creationRequirements({ ...input, projectId: scope.projectId, conversationId: scope.conversationId }));
    let requirementRef, request, hash;
    let projectKnowledge = input.projectKnowledge || input.taskScope?.projectKnowledge;
    const template = input.template || input.taskScope?.template;
    if (previous) {
      requirementRef = explicitRequirements ? frozenRequirements() : previous.initialRequirementRef || previous.requirementRef;
      const creation = input.creation || requirementRef;
      projectKnowledge = projectKnowledge || previous.projectKnowledge;
      request = canonicalRequest({ ...input, projectKnowledge, template: template || previous.template, ...(creation ? { creation } : {}) }); hash = digest(request);
      if (previous.requestHash !== hash) throw fail("TASK_SUBMISSION_CONFLICT", "同一提交标识已用于不同请求；没有新增派发。", { taskId: previous.taskId });
      return { task: previous, duplicate: true };
    }
    const session = readSession(scope.projectId);
    const pending = session?.pendingAgentExecution;
    const pendingTask = pending?.taskId && ledger.tasks.find(item => item.taskId === pending.taskId && item.conversationId === scope.conversationId);
    // A failed session write can retain a question whose durable receipt has
    // already consumed/stopped it. That stale snapshot cannot resurrect work.
    const pendingIsTerminal = pendingTask && ["completed", "partial", "failed", "stopped", "interrupted"].includes(pendingTask.phase);
    if (pending?.conversationId === scope.conversationId && !pendingIsTerminal) throw fail("TASK_BUSY", "该会话仍有待回答任务。");
    busy(scope, ledger);
    if (ledger.tasks.length >= maxTasks) throw fail("TASK_LEDGER_FULL", "任务记录已满；保留旧提交标识以避免重复执行，未启动新任务。");
    requirementRef = frozenRequirements();
    projectKnowledge = projectKnowledge || freezeProjectKnowledge({ ...input, expectedProjectId: scope.projectId });
    if (projectKnowledge) validateProjectKnowledge({ ...input, expectedProjectId: scope.projectId, snapshot: projectKnowledge });
    request = canonicalRequest({ ...input, projectKnowledge, template, ...(input.creation || requirementRef ? { creation: input.creation || requirementRef } : {}) }); hash = digest(request);
    const now = new Date().toISOString();
    const task = { taskId: `task-${randomUUID()}`, ...scope, submissionKey: key, requestHash: hash,
      title: text(request.title || request.prompt.split("\n")[0], 80), phase: "preparing", accepted: false,
      version: 1, instance, runIds: [], claimedRunIds: [], ownerId: "", scope: null, question: null, error: null,
      createdAt: now, updatedAt: now };
    if (projectKnowledge) task.projectKnowledge = projectKnowledgeReceipt(projectKnowledge);
    if (template) task.template = normalizeRequirementTemplateSnapshot(template);
    if (requirementRef) { task.requirementRef = requirementRef; task.initialRequirementRef = requirementRef; }
    if (input.creation?.revisionPlan?.revisionId) task.revisionId = requiredId(input.creation.revisionPlan.revisionId, "revisionId");
    if (input.parentTaskIds !== undefined) {
      if (!Array.isArray(input.parentTaskIds) || input.parentTaskIds.length > 200) throw fail("TASK_ARGUMENT_INVALID", "父任务身份无效。");
      task.parentTaskIds = [...new Set(input.parentTaskIds.map(value => requiredId(value, "parentTaskId")))];
    }
    ledger.tasks.push(task); save(scope.projectId, ledger);
    return { task, duplicate: false, projectKnowledge };
  }
  function publicTask(task, projection = {}) {
    const session = projection.session || readSession(task.projectId), nodes = session?.nodes || [];
    const linked = projection.linked || operations(task.projectId).filter(operation => operation.agentTaskId === task.taskId || task.runIds.includes(operation.runId));
    const assets = new Map();
    for (const operation of linked) for (const asset of operation.assets || []) {
      if (!asset.assetId || !asset.path || !fs.existsSync(asset.path)) continue;
      const matches = value => value.assetId === asset.assetId && (!asset.occurrenceId || value.occurrenceId === asset.occurrenceId);
      const found = nodes.flatMap(node => (node.assets || []).filter(matches).map(current => ({ node, current })));
      const { node, current } = found.length && (asset.occurrenceId || found.length === 1) ? found[0] : {};
      const contentHash = String(asset.contentHash || asset.sha256 || current?.contentHash || current?.sha256 || "").toLowerCase();
      assets.set(asset.occurrenceId || asset.assetId, { assetId: text(asset.assetId, 180), occurrenceId: text(asset.occurrenceId || current?.occurrenceId, 180),
        ...(node ? { nodeId: text(node.id, 180) } : {}), ...(/^[a-f0-9]{64}$/.test(contentHash) ? { contentHash } : {}), saved: true, inProject: Boolean(node) });
    }
    const result = [...assets.values()];
    const imageOperations = linked.map(operation => ({ key: text(operation.key, 180), operationId: text(operation.operationId, 180), requestIndex: operation.requestIndex,
      state: operation.state === "submitted" ? "uncertain" : text(operation.state, 40), stage: text(operation.stage, 180),
      taskIdPresent: Boolean(operation.taskId), savedCount: (operation.assets || []).filter(asset => asset.path && fs.existsSync(asset.path)).length,
      canRecover: operation.state === "saved" || Boolean(operation.taskId || operation.slots?.length) }));
    const run = runSnapshot().runs?.find(run => run.runId === task.runIds.at(-1));
    return { taskId: task.taskId, projectId: task.projectId, conversationId: task.conversationId, title: task.title,
      accepted: task.accepted, phase: task.phase, stage: task.stage || null, version: task.version, cursor: task.version,
      paused: Boolean(run?.paused),
      scope: task.scope, runIds: [...task.runIds], currentRunId: task.runIds.at(-1) || null,
      projectKnowledge: task.projectKnowledge || null, ...(task.template ? { template: task.template } : {}),
      requirementRef: task.requirementRef || null, ...(task.revisionId ? { revisionId: task.revisionId } : {}),
      ...(task.parentTaskIds?.length ? { parentTaskIds: [...task.parentTaskIds] } : {}),
      question: task.question, results: result, savedCount: result.filter(asset => asset.inProject).length,
      imageOperations, error: task.error, createdAt: task.createdAt, updatedAt: task.updatedAt,
      nextAction: task.question ? "answer" : imageOperations.some(operation => operation.canRecover && (operation.state !== "saved" || result.some(asset => !asset.inProject)))
        ? "recover-original-results" : task.phase === "save-failed" ? "save-project" : ACTIVE.has(task.phase) ? "wait" : "none" };
  }
  function get(input) {
    const ledger = read(target(input).projectId), task = lookup(input, ledger), projection = publicTask(task);
    if (task.phase === "save-failed" && task.executionOutcome && task.executionOutcome !== "save-failed" &&
      !projection.results.some(asset => !asset.inProject) &&
      (projection.results.length > 0 || Number(readSession(task.projectId)?.sessionRevision || 0) > Number(task.settledSessionRevision || 0))) {
      const phase = projectedOutcome(task.executionOutcome, projection);
      const question = phase === "waiting" ? questionFor(task) : null;
      if (phase !== "waiting" || question) change(task, ledger, { phase, question,
        error: ["completed", "waiting"].includes(phase) ? null : { code: `TASK_${phase.toUpperCase()}`, message: "原执行未全部完成，已保存的成果保留。" } });
    }
    // The authoritative image/session projection participates in the same cursor.
    const projectionHash = digest([projection.results, projection.imageOperations, projection.paused]);
    if (task.projectionHash !== projectionHash) change(task, ledger, { projectionHash });
    return { task: publicTask(task) };
  }
  function admit(input, ownerId) {
    let task = input.taskId ? lookup(input) : reserve(input).task;
    const ledger = read(task.projectId); task = lookup({ ...input, taskId: task.taskId }, ledger);
    try {
      const runId = requiredId(input.runId, "runId");
      const session = readSession(task.projectId);
      if (session?.activeConversationId !== task.conversationId && !session?.conversations?.some(item => item.id === task.conversationId)) throw fail("CONVERSATION_NOT_FOUND", "目标会话未保存或不存在。");
      const continuation = task.phase === "resuming" && task.runIds.at(-1) === runId;
      if (task.phase !== "preparing" && !continuation) throw fail("TASK_DISPATCH_CONFLICT", "该任务已派发或中断，不能重复执行。");
      if (task.ownerId && task.ownerId !== String(ownerId)) throw fail("TASK_OWNER_CONFLICT", "任务属于另一个窗口。");
      // Check the producer again after asynchronous IPC/preparation.
      if (!continuation) busy(target(input), ledger, task.taskId);
      const frozen = scopeProjection(input.taskScope);
      if (digest(task.projectKnowledge || null) !== digest(frozen.projectKnowledge || null)) throw fail("TASK_KNOWLEDGE_CONFLICT", "任务知识与受理时冻结版本不同，未启动执行。");
      if (input.taskScope.projectKnowledge) validateProjectKnowledge({ expectedProjectId: task.projectId, conversationId: task.conversationId, taskId: task.taskId, snapshot: input.taskScope.projectKnowledge, taskScope: input.taskScope });
      if (digest(task.template || null) !== digest(frozen.template || null)) throw fail("TASK_TEMPLATE_CONFLICT", "模板展开与受理版本不同，未启动执行。");
      if (task.requirementRef && digest(task.requirementRef) !== digest(frozen.creation)) throw fail("TASK_CREATION_CONFLICT", "任务创作要求未按权威版本冻结，未启动执行。");
      if (task.requirementRef) validateCreationScope({ projectId: task.projectId, conversationId: task.conversationId, taskId: task.taskId, taskScope: input.taskScope });
      if (task.revisionId && input.taskScope.creation?.revisionPlan?.revisionId !== task.revisionId) throw fail("TASK_CREATION_CONFLICT", "定向修改没有冻结对应的权威修订计划。");
      const lockIds = new Set([...(input.taskScope.sourceNodeIds || []), ...(input.taskScope.sourceContainerIds || [])]);
      if (runSnapshot().runs?.some(run => run.projectId === task.projectId && run.runId !== runId && run.nodeIds?.some(nodeId => lockIds.has(nodeId)))) {
        throw fail("TASK_SCOPE_BUSY", "素材正被另一个任务处理，未受理新任务。");
      }
      change(task, ledger, { accepted: true, phase: "accepted", ownerId: String(ownerId), scope: frozen,
        runIds: continuation ? task.runIds : [...task.runIds, runId], error: null });
      return { accepted: true, task: publicTask(task) };
    } catch (error) {
      // GUI admission has no outer start() to close a failed preparation.
      // Re-read disk: a failed atomic write may have mutated only this copy.
      const currentLedger = read(task.projectId), current = lookup({ ...input, taskId: task.taskId }, currentLedger);
      if (!current.accepted && current.phase === "preparing") {
        change(current, currentLedger, { phase: "interrupted", error: { code: text(error?.code || "TASK_NOT_ACCEPTED", 100), message: text(error?.message || "任务准备中断，未启动执行。") } });
      }
      throw error;
    }
  }
  function claimRun(input, ownerId) {
    const ledger = read(target(input).projectId), task = lookup(input, ledger), runId = id(input.runId);
    if (task.ownerId !== String(ownerId) || task.phase !== "accepted" || task.runIds.at(-1) !== runId || task.claimedRunIds.includes(runId)) {
      throw fail("TASK_RUN_ALREADY_CLAIMED", "原任务没有可重复派发的执行；请查询或恢复原图片结果。");
    }
    change(task, ledger, { phase: "running", claimedRunIds: [...task.claimedRunIds, runId] });
    return task.taskId;
  }
  function settle(input, ownerId) {
    const ledger = read(target(input).projectId), task = lookup(input, ledger);
    const restoredQuestion = task.phase === "waiting" && !task.ownerId;
    if ((!restoredQuestion && task.ownerId !== String(ownerId)) || task.runIds.at(-1) !== input.runId) throw fail("TASK_OWNER_CONFLICT", "旧窗口或旧运行不能改写当前任务。");
    if (!ACTIVE.has(task.phase)) return get(input);
    const question = input.outcome === "waiting" ? questionFor(task) : null;
    const phases = { waiting: question ? "waiting" : "interrupted", completed: "completed", partial: "partial", failed: "failed", stopped: "stopped", "save-failed": "save-failed" };
    const phase = projectedOutcome(phases[input.outcome] || "interrupted", publicTask(task));
    change(task, ledger, { phase, question, ownerId: String(ownerId), executionOutcome: input.executionOutcome === "waiting" ? "waiting" : phases[input.executionOutcome] || phases[input.outcome] || "interrupted",
      settledSessionRevision: Number(readSession(task.projectId)?.sessionRevision || 0),
      error: ["completed", "waiting"].includes(phase) ? null : {
      code: text(input.errorCode || (phase === "interrupted" ? "TASK_INTERRUPTED" : `TASK_${phase.toUpperCase().replace(/-/g, "_")}`), 100),
      message: text(input.error || ({ partial: "已有部分成果，执行未全部完成。", "save-failed": "项目保存未完成，原结果已保留，请保存或恢复原结果。", stopped: "任务已结束；在途图片按原恢复规则保留。" }[phase] || "执行未完成；请查询原图片操作。")) } });
    return { task: publicTask(task) };
  }
  function questionFor(task) {
    const pending = pendingFor(task);
    return pending ? { requestId: text(pending.requestId, 180), kind: text(pending.kind, 40),
      title: text(pending.title, 120), question: text(pending.question, 4000), detail: text(pending.detail, 2000), allowCustomAnswer: true,
      options: (pending.options || []).slice(0, 8).map(option => ({ id: text(option.id, 80), label: text(option.label, 80),
        description: text(option.description, 260), recommended: option.recommended === true })) } : null;
  }
  function projectedOutcome(phase, projection) {
    if (phase === "completed") {
      if (projection.results.some(asset => !asset.inProject)) phase = "save-failed";
      else if (projection.imageOperations.some(operation => operation.state !== "saved")) phase = projection.savedCount ? "partial" : "failed";
    }
    if (phase === "failed" && projection.savedCount) phase = "partial";
    return phase;
  }
  function claimAnswer(input, ownerId) {
    const ledger = read(target(input).projectId), task = lookup(input, ledger), pending = pendingFor(task);
    if (task.phase !== "waiting" || task.version !== input.expectedVersion || task.question?.requestId !== input.questionId ||
      !pending || pending.requestId !== input.questionId || pending.taskScope?.snapshotHash !== task.scope?.snapshotHash) {
      throw fail("TASK_ANSWER_STALE", "问题已被回答、已改变或无法安全续接；没有新增派发。");
    }
    if (task.ownerId && ownerId && task.ownerId !== String(ownerId)) throw fail("TASK_OWNER_CONFLICT", "请在原任务窗口回答。");
    const option = input.optionId ? pending.options?.find(option => option.id === input.optionId) : null;
    if (input.optionId && !option) throw fail("TASK_ANSWER_INVALID", "回答选项不属于当前问题。");
    const answer = String(input.answer || option?.answer || option?.label || "").trim();
    if (!answer || answer.length > 4000) throw fail("TASK_ANSWER_INVALID", "请提供有效选项或不超过 4000 字符的补充回答。");
    const runId = `run-${randomUUID()}`;
    change(task, ledger, { phase: "resuming", question: null, ownerId: String(ownerId || task.ownerId), runIds: [...task.runIds, runId], error: null });
    return { accepted: true, task: publicTask(task), runId, answer, optionId: option?.id };
  }
  async function start(input) {
    const reserved = reserve(input), task = reserved.task;
    if (inflight.has(task.taskId)) return inflight.get(task.taskId);
    if (reserved.duplicate) return { accepted: task.accepted, duplicate: true, ...get({ ...input, taskId: task.taskId }) };
    const promise = (async () => {
      try {
        const owner = await locateOwner(target(input));
        await dispatch("agent.task.dispatch", { ...input, ...(reserved.projectKnowledge ? { projectKnowledge: reserved.projectKnowledge } : {}), taskId: task.taskId }, owner);
      } catch (error) {
        const ledger = read(task.projectId), current = lookup({ ...input, taskId: task.taskId }, ledger);
        if (!current.accepted && current.phase === "preparing") change(current, ledger, { phase: "interrupted", error: { code: text(error?.code || "TASK_NOT_ACCEPTED", 100), message: text(error?.message || "任务未受理。") } });
        if (!current.accepted) throw fail("TASK_NOT_ACCEPTED", "任务未受理或准备已中断；使用原提交标识查询，不会自动重发。", { taskId: task.taskId });
      }
      const result = get({ ...input, taskId: task.taskId });
      return { accepted: result.task.accepted, ...result };
    })();
    inflight.set(task.taskId, promise);
    try { return await promise; } finally { inflight.delete(task.taskId); }
  }
  async function executeCommand(command, input = {}) {
    const definition = definitions.get(command);
    if (!COMMANDS.includes(command)) throw fail("TASK_COMMAND_UNKNOWN", "未知任务命令。");
    validateSchemaValue(command, definition.parameters, input);
    if (command === "agent.task.start") return start(input);
    if (command === "agent.task.get") return get(input);
    if (command === "agent.task.wait") {
      const timeout = input.timeoutMs ?? 25_000;
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 30_000 || !Number.isSafeInteger(input.afterVersion) || input.afterVersion < 0) throw fail("TASK_ARGUMENT_INVALID", "等待需要非负版本和 0–30000ms 有界超时。");
      const started = Date.now();
      let result = get(input);
      if (input.afterVersion > result.task.version) throw fail("TASK_CURSOR_EXPIRED", "状态游标超出当前记录；请 get 原任务并使用返回的 cursor。", { cursor: result.task.cursor });
      while (result.task.version === input.afterVersion && Date.now() - started < timeout) {
        await new Promise(resolve => setTimeout(resolve, Math.min(100, timeout - (Date.now() - started)))); result = get(input);
      }
      return { ...result, changed: result.task.version !== input.afterVersion, timedOut: result.task.version === input.afterVersion };
    }
    if (command === "agent.task.answer") {
      const scope = target(input), owner = await locateOwner(scope), claimed = claimAnswer(input, owner);
      try { await dispatch("agent.task.answer-dispatch", { ...input, ...claimed, taskId: claimed.task.taskId }, owner); }
      catch (error) { settle({ ...input, runId: claimed.runId, outcome: "interrupted", error: "回答已消费但续接中断；不会重发。" }, owner); }
      return { accepted: true, ...get({ ...input, taskId: claimed.task.taskId }) };
    }
    throw fail("TASK_COMMAND_UNKNOWN", "未知任务命令。");
  }
  async function execute(command, input = {}) {
    try { return await executeCommand(command, input); }
    catch (error) { throw fail(text(error?.code || "TASK_FAILED", 100), text(error?.message || "任务操作失败。"), safeProjection(error?.details)); }
  }
  function taskIdForRun(projectId, runId) { return read(projectId).tasks.find(task => task.runIds.includes(runId))?.taskId || ""; }
  function progress(projectId, runId, event) {
    if (!["model-request", "tool-start", "image-request", "tool-done", "tool-error"].includes(event?.phase)) return;
    const ledger = read(projectId), task = ledger.tasks.find(task => task.runIds.at(-1) === runId && ACTIVE.has(task.phase));
    if (!task) return;
    const stage = event.phase === "model-request" ? "model" : event.tool === "image_gen" || event.phase === "image-request" ? "image" : "tools";
    if (task.stage !== stage || event.phase === "image-request" && !task.imageDispatchLocked) change(task, ledger,
      { stage, ...(event.phase === "image-request" ? { imageDispatchLocked: true } : {}) });
  }
  function assertRequirementsMutable(input) {
    const ledger = read(input.projectId || input.expectedProjectId), task = lookup(input, ledger);
    const previousRef = normalizeCreationReference(input.previousRef);
    if (!previousRef || digest(task.requirementRef) !== digest(previousRef) || task.runIds.at(-1) !== input.runId ||
      !task.claimedRunIds.includes(input.runId) || !["accepted", "running", "resuming"].includes(task.phase)) {
      throw fail("TASK_CREATION_CONFLICT", "任务的活动运行或创作要求版本已变化，未更新冻结要求。");
    }
    if (task.imageDispatchLocked || operations(task.projectId).some(operation => operation.agentTaskId === task.taskId || task.runIds.includes(operation.runId))) {
      throw fail("TASK_CREATION_LOCKED", "任务已开始图片派发，不能改变该次执行的创作要求。");
    }
    return { ok: true };
  }
  function advanceRequirements(input) {
    assertRequirementsMutable(input);
    const ledger = read(input.projectId || input.expectedProjectId), task = lookup(input, ledger);
    const nextRef = normalizeCreationReference(input.requirementRef), previousRef = normalizeCreationReference(input.previousRef);
    if (!nextRef || !previousRef || digest(task.requirementRef) !== digest(previousRef) || task.runIds.at(-1) !== input.runId ||
      nextRef.requirementId !== previousRef.requirementId || nextRef.revision !== previousRef.revision && nextRef.revision !== previousRef.revision + 1 ||
      nextRef.revision === previousRef.revision && nextRef.fingerprint !== previousRef.fingerprint ||
      !task.claimedRunIds.includes(input.runId) || !["accepted", "running", "resuming"].includes(task.phase)) {
      throw fail("TASK_CREATION_CONFLICT", "任务的活动运行或创作要求版本已变化，未更新冻结要求。");
    }
    if (task.imageDispatchLocked || operations(task.projectId).some(operation => operation.agentTaskId === task.taskId || task.runIds.includes(operation.runId))) {
      throw fail("TASK_CREATION_LOCKED", "任务已开始图片派发，不能改变该次执行的创作要求。");
    }
    const frozen = scopeProjection(input.taskScope);
    validateCreationScope({ projectId: task.projectId, conversationId: task.conversationId, taskId: task.taskId, taskScope: input.taskScope });
    const materials = value => { const { snapshotHash, creation, ...rest } = value || {}; return rest; };
    if (digest(frozen.creation) !== digest(nextRef) || digest(materials(task.scope)) !== digest(materials(frozen))) throw fail("TASK_SCOPE_CONFLICT", "更新创作要求不能改变已冻结素材或图片配置。");
    if (digest(nextRef) === digest(previousRef)) return { ok: true, task: publicTask(task) };
    change(task, ledger, { requirementRef: nextRef, requirementRefHistory: [...(task.requirementRefHistory || []), task.requirementRef], scope: frozen });
    return { ok: true, task: publicTask(task) };
  }
  function advanceMaterials(input) {
    const ledger = read(input.projectId || input.expectedProjectId), task = lookup(input, ledger);
    if (task.runIds.at(-1) !== input.runId || !task.claimedRunIds.includes(input.runId) || !["accepted", "running", "resuming"].includes(task.phase) || task.imageDispatchLocked || operations(task.projectId).some(operation => operation.agentTaskId === task.taskId || task.runIds.includes(operation.runId))) throw fail("TASK_SCOPE_LOCKED", "已开始图片派发，不能扩展素材；请新建任务。");
    const frozen = scopeProjection(input.taskScope), prior = task.scope;
    if (prior.origin === "goal" || digest(prior.creation) !== digest(frozen.creation) || digest(prior.imageConfig) !== digest(frozen.imageConfig) || digest(prior.projectKnowledge) !== digest(frozen.projectKnowledge) || digest(prior.template) !== digest(frozen.template)) throw fail("TASK_SCOPE_CONFLICT", "明确使用搜索成果不能改变Goal、要求、知识或图片配置。");
    if (typeof input.validate !== "function") throw fail("TASK_SCOPE_CONFLICT", "素材使用必须经权威资产校验。");
    const identity = value => JSON.stringify([value.assetId, value.occurrenceId, value.contentHash, value.role]);
    const originals = [...prior.sourceAssets, ...prior.referenceAssets];
    const next = [...frozen.sourceAssets, ...frozen.referenceAssets];
    const allowed = new Set((input.targets || []).map(value => JSON.stringify([value.assetId, value.occurrenceId, value.contentHash])));
    if (originals.some(value => !next.some(item => identity(item) === identity(value))) || next.some(value => !originals.some(item => identity(item) === identity(value)) && !allowed.has(JSON.stringify([value.assetId, value.occurrenceId, value.contentHash])))) throw fail("TASK_SCOPE_CONFLICT", "搜索素材绑定不能移除原素材或夹带其他成果。");
    input.validate();
    change(task, ledger, { scope: frozen }); return { ok: true, task: publicTask(task) };
  }
  function ownerGone(ownerId) {
    for (const projectId of knownProjects) {
      const ledger = read(projectId);
      for (const task of ledger.tasks) if (task.ownerId === String(ownerId) && ACTIVE.has(task.phase)) {
        if (task.phase === "waiting") change(task, ledger, { ownerId: "" });
        else change(task, ledger, { phase: "interrupted", question: null, error: { code: "TASK_INTERRUPTED", message: "原执行窗口已关闭；可恢复原图片结果，不会重新提交。" } });
      }
    }
  }
  function stopScope(input, ownerId) {
    const scope = target(input), ledger = read(scope.projectId);
    for (const task of ledger.tasks) if (task.conversationId === scope.conversationId && (task.ownerId === String(ownerId) || task.phase === "waiting" && !task.ownerId) && ACTIVE.has(task.phase)) {
      change(task, ledger, { phase: "stopped", question: null, error: { code: "TASK_STOPPED", message: "任务已结束；原图片结果和在途任务保留恢复记录。" } });
    }
  }
  return { commands: COMMANDS, execute, startInternal: start, assertStartAvailable, revisionContext, get, admit, claimRun, settle, claimAnswer, assertRequirementsMutable, advanceRequirements, advanceMaterials, taskIdForRun, progress, ownerGone, stopScope,
    sanitizeError: error => text(error?.message || "任务操作失败。") };
}

module.exports = { createAgentTaskService, canonicalRequest };
