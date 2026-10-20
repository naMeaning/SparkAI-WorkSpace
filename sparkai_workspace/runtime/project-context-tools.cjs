"use strict";
const { bindProjectContextMaterials } = require("./project-context-scope.mjs");
const commands = require("../integrations/naimage-control/references/commands.schema.json").sections.flatMap(section => section.commands);
const operations = {
  get_context: "project.context.get", list_knowledge: "project.knowledge.list", save_knowledge: "project.knowledge.save",
  set_knowledge_status: "project.knowledge.status", promote_knowledge: "project.knowledge.promote", search_results: "project.results.search"
};
function projectContextToolSchema() {
  const properties = { operation: { type: "string", enum: [...Object.keys(operations), "use_results", "list_templates", "save_template", "apply_template"] } };
  for (const command of Object.values(operations)) for (const [name, schema] of Object.entries(commands.find(item => item.name === command).parameters.properties)) {
    if (!["expectedProjectId", "conversationId"].includes(name)) properties[name] = schema;
  }
  const use = commands.find(item => item.name === "project.results.use").parameters.properties;
  properties.targets = use.targets; properties.role = use.role;
  properties.templateId = { type: "string", maxLength: 180 };
  properties.expectedTemplateRevision = { type: "integer", minimum: 1 };
  properties.title = { type: "string", minLength: 1, maxLength: 120 };
  properties.text = { type: "string", minLength: 1, maxLength: 24000 };
  properties.variableValues = { type: "object", maxProperties: 24, additionalProperties: { type: ["string", "number"] } };
  properties.imageBindings = commands.find(item => item.name === "requirement-library.use").parameters.properties.imageBindings;
  return { type: "function", function: { name: "project_context", description: "查询当前项目长期知识、本地成果和既有需求模板。仅用户明确要求长期记住时save_knowledge source=user，推测用assumption建议，不把临时修改自动长期化。明确当前要求优先；与商品事实冲突时解释并ask_user。search_results零模型请求且不选素材；结果的observed才是有像素证据的观察，intended只是Prompt预期。用户明确要求沿用搜索结果时use_results复制稳定targets；只在首次图片派发前绑定，不扩展Goal。知识编辑影响未来任务，当前任务保留原冻结知识。save_template仅用户明确保存方法时用当前要求创建便携模板；apply_template形成普通需求草稿，零模型请求，不自动执行。", parameters: { type: "object", additionalProperties: false, properties, required: ["operation"] } } };
}
async function runProjectContextTool(args, context, { service, resultIndex, requirementLibrary, normalizeScope, onMaterials } = {}) {
  if (!context?.projectId || !context?.conversationId) throw new Error("项目上下文需要当前项目和会话。");
  const { operation, projectId, conversationId, ...input } = args;
  if (projectId && projectId !== context.projectId || conversationId && conversationId !== context.conversationId) throw new Error("不能跨项目使用上下文。");
  const base = { expectedProjectId: context.projectId, conversationId: context.conversationId };
  if (operations[operation]) {
    const command = operations[operation], properties = commands.find(item => item.name === command).parameters.properties;
    const payload = Object.fromEntries(Object.entries({ ...input, ...base }).filter(([key]) => key in properties));
    return { value: await service.execute(command, payload), actions: [] };
  }
  if (operation === "use_results") {
    if (!context.taskId || !onMaterials || !resultIndex || context.taskScope?.origin === "goal") throw new Error("当前任务不能扩展素材范围。");
    const resolved = await resultIndex.resolveUse({ expectedProjectId: context.projectId, targets: input.targets });
    const taskScope = normalizeScope(bindProjectContextMaterials(context.taskScope, resolved.materials, input.role));
    await onMaterials({ ...base, projectId: context.projectId, taskId: context.taskId, runId: context.runId, targets: resolved.targets, taskScope });
    return { value: { ok: true, targets: resolved.targets, role: input.role, summary: `已明确绑定 ${resolved.targets.length} 个项目成果；尚未生成图片。` }, actions: [], taskScope };
  }
  if (!requirementLibrary) throw new Error("当前运行时不支持需求模板。");
  if (operation === "list_templates") return { value: requirementLibrary.list({ includeText: false }), actions: [] };
  if (operation === "save_template") {
    const state = context.taskScope?.creation && await context.creationService?.getRequirements({ ...base, projectId: context.projectId, taskId: context.taskId, requirementId: context.taskScope.creation.requirementId });
    return { value: requirementLibrary.saveFromTask({ title: input.title, text: input.text || context.prompt, requirements: state?.requirements }), actions: [] };
  }
  if (operation === "apply_template") {
    if (!service?.applyTemplate) throw new Error("当前运行时不支持创建需求模板草稿。");
    const value = await service.applyTemplate({ ...base, templateId: input.templateId, expectedTemplateRevision: input.expectedTemplateRevision,
      variableValues: input.variableValues, imageBindings: input.imageBindings,
      inputBindings: (input.imageBindings || []).map(({ nodeId, role }) => ({ nodeId, role })) });
    if (value?.ok === false) throw Object.assign(new Error(value.error || "需求草稿未保存。"), { code: value.errorCode });
    return { value: { ...value, summary: "已通过原需求入口创建草稿；明确执行后才生成。" }, actions: [] };
  }
  throw new Error("不支持的项目上下文操作。");
}
module.exports = { projectContextToolSchema, runProjectContextTool };
