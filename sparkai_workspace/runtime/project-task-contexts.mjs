import { normalizeProjectKnowledgeSnapshot } from "./project-knowledge-contract.mjs";
import { normalizeRequirementTemplateSnapshot } from "./requirement-template-contract.mjs";

export const PROJECT_TASK_CONTEXT_LIMITS = Object.freeze({ entries: 512, characters: 8 * 1024 * 1024 });
const id = value => typeof value === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function normalizeProjectTaskContext(value, { expectedProjectId } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !id(value.projectId) || !id(value.conversationId) || !id(value.taskId)) return undefined;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
  const projectKnowledge = normalizeProjectKnowledgeSnapshot(value.projectKnowledge, { expectedProjectId: expectedProjectId || value.projectId });
  if (!projectKnowledge || projectKnowledge.projectId !== value.projectId || value.fingerprint !== projectKnowledge.fingerprint) return undefined;
  const requirementTemplate = value.requirementTemplate === undefined ? undefined : normalizeRequirementTemplateSnapshot(value.requirementTemplate);
  if (value.requirementTemplate !== undefined && !requirementTemplate) return undefined;
  return { version: 1, projectId: value.projectId, conversationId: value.conversationId, taskId: value.taskId,
    createdAt: new Date(value.createdAt).toISOString(), fingerprint: projectKnowledge.fingerprint, projectKnowledge,
    ...(requirementTemplate ? { requirementTemplate } : {}) };
}

export function normalizeProjectTaskContexts(value, options = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PROJECT_TASK_CONTEXT_LIMITS.entries) return undefined;
  const contexts = value.map(context => normalizeProjectTaskContext(context, options));
  if (contexts.some(context => !context) || new Set(contexts.map(context => `${context.projectId}|${context.taskId}`)).size !== contexts.length ||
    JSON.stringify(contexts).length > PROJECT_TASK_CONTEXT_LIMITS.characters) return undefined;
  return contexts.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.taskId.localeCompare(right.taskId) || left.fingerprint.localeCompare(right.fingerprint));
}

/** Session owns the complete immutable material; the task ledger owns refs. */
export function appendProjectTaskContext(value, candidate, options = {}) {
  const contexts = normalizeProjectTaskContexts(value, options), context = normalizeProjectTaskContext(candidate, options);
  if (!contexts || !context) fail("PROJECT_TASK_CONTEXT_INVALID", "任务的冻结项目上下文无效。");
  const previous = contexts.find(item => item.projectId === context.projectId && item.taskId === context.taskId);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(context)) fail("PROJECT_TASK_CONTEXT_CONFLICT", "原任务的冻结项目上下文不能被旧窗口或新规则改写。");
    return clone(contexts);
  }
  const next = normalizeProjectTaskContexts([...contexts, context], options);
  if (!next) fail("PROJECT_TASK_CONTEXT_FULL", "任务上下文历史已达本地容量上限，未淘汰旧任务。");
  return next;
}

export function mergeProjectTaskContexts(left, right, options = {}) {
  const existing = normalizeProjectTaskContexts(left, options), incoming = normalizeProjectTaskContexts(right, options);
  if (!existing || !incoming) fail("PROJECT_TASK_CONTEXT_INVALID", "任务的冻结项目上下文无法合并。");
  return incoming.reduce((contexts, context) => appendProjectTaskContext(contexts, context, options), existing);
}

export function findProjectTaskContext(value, { projectId, conversationId, taskId, fingerprint } = {}) {
  return normalizeProjectTaskContexts(value, { expectedProjectId: projectId })?.find(context => context.projectId === projectId &&
    (!conversationId || context.conversationId === conversationId) && context.taskId === taskId && (!fingerprint || context.fingerprint === fingerprint));
}
