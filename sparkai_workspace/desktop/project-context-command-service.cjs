"use strict";
const { validateSchemaValue, redactText } = require("./debug-command-service.cjs");
const { normalizeProjectKnowledgeSnapshot } = require("../runtime/project-knowledge-contract.mjs");
const { normalizeProjectTaskContexts } = require("../runtime/project-task-contexts.mjs");
const definitions = new Map(require("../integrations/naimage-control/references/commands.schema.json").sections.flatMap(section => section.commands).map(command => [command.name, command]));
const COMMANDS = ["project.knowledge.list", "project.knowledge.save", "project.knowledge.status", "project.knowledge.promote", "project.knowledge.history", "project.results.search", "project.results.use", "project.context.get"];

function createProjectContextCommandService({ knowledgeService, resultIndex, readSession, locateOwner, dispatch }) {
  const knowledgeMethods = { list: "list", save: "save", status: "setStatus", promote: "promote", history: "history" };
  async function execute(command, input = {}) {
    input = JSON.parse(JSON.stringify(input));
    if (!COMMANDS.includes(command)) throw new Error("不支持的项目上下文操作。");
    validateSchemaValue(command, definitions.get(command)?.parameters, input);
    if (command.startsWith("project.knowledge.")) return knowledgeService[knowledgeMethods[command.split(".").at(-1)]](input);
    if (command === "project.results.search") return resultIndex.search(input);
    if (command === "project.results.use") {
      const resolved = await resultIndex.resolveUse(input);
      const owner = await locateOwner({ projectId: input.expectedProjectId, conversationId: input.conversationId });
      // The renderer resolves the same stable identities again; no array index
      // from a stale search result can choose a different occurrence.
      return dispatch("project.results.bind", { ...input, targets: resolved.targets }, owner);
    }
    const knowledge = knowledgeService.list(input);
    const session = readSession(input.expectedProjectId);
    const contexts = normalizeProjectTaskContexts(session?.projectTaskContexts, { expectedProjectId: input.expectedProjectId });
    if (!contexts) throw new Error("项目任务上下文无法读取，原记录保留。");
    const used = contexts.filter(value => value.conversationId === input.conversationId).at(-1);
    return { ...knowledge, ...(used ? { usedKnowledge: used.projectKnowledge, usedTemplate: used.requirementTemplate } : {}) };
  }
  async function prepare(input) {
    const projectId = input.expectedProjectId;
    // Existing receipts predate project knowledge. A continuation keeps that
    // absence; admit still checks the durable receipt and rejects tampering.
    if (input.taskId && !input.taskScope?.projectKnowledge) return { ok: true, knowledgeMaterials: [] };
    const projectKnowledge = input.taskScope?.projectKnowledge
      ? knowledgeService.resolveFrozen({ ...input, snapshot: input.taskScope.projectKnowledge })
      : knowledgeService.freezeForTask(input);
    if (!normalizeProjectKnowledgeSnapshot(projectKnowledge, { expectedProjectId: projectId })) throw new Error("项目知识冻结失败。");
    const targets = [...new Map(projectKnowledge.entries.flatMap(entry => entry.assetRefs).map(target => [JSON.stringify(target), target])).values()];
    const scope = input.taskScope;
    const known = new Set([...(scope?.materials || []), ...(scope?.sourceAssets || []), ...(scope?.referenceAssets || [])].map(target => JSON.stringify([target.assetId, target.occurrenceId, target.contentHash])));
    const missing = targets.filter(target => !known.has(JSON.stringify([target.assetId, target.occurrenceId, target.contentHash])));
    if (scope?.origin === "goal" && missing.length) throw Object.assign(new Error("项目知识引用超出Goal冻结素材，请显式新建包含这些素材的Goal。"), { code: "GOAL_KNOWLEDGE_SCOPE_CONFLICT" });
    const resolved = missing.length ? await resultIndex.resolveUse({ expectedProjectId: projectId, targets: missing }) : { materials: [] };
    return { ok: true, projectKnowledge, knowledgeMaterials: resolved.materials };
  }
  async function invoke(command, input) {
    try { return { ok: true, ...await execute(command, input) }; }
    catch (error) { return failure(error); }
  }
  async function applyTemplate(input) {
    input = JSON.parse(JSON.stringify(input));
    const { conversationId, ...payload } = input;
    validateSchemaValue("requirement-library.use", definitions.get("requirement-library.use").parameters, payload);
    const owner = await locateOwner({ projectId: input.expectedProjectId, conversationId });
    return dispatch("requirement-library.use", payload, owner);
  }
  function failure(error) {
    return { ok: false, errorCode: error?.code || "PROJECT_CONTEXT_FAILED", error: redactText(error?.message || "项目上下文操作失败。")
      .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]").replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]") };
  }
  return { commands: COMMANDS, execute, invoke, prepare, applyTemplate, failure };
}
module.exports = { createProjectContextCommandService, PROJECT_CONTEXT_COMMANDS: COMMANDS };
