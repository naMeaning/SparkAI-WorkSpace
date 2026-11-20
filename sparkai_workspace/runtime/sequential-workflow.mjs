export const workflowStepNames = Object.freeze({
  generate: "生成图片",
  edit: "参考图编辑",
  cutout: "抠图",
  background: "换背景"
});

const identifier = /^[a-z][a-z0-9_-]{0,63}$/i;
const token = /\{\{([a-z][a-z0-9_-]{0,63})\}\}/gi;
const record = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, limit) => typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, limit) : "";

function uniqueIds(items) {
  return items.every(item => record(item) && identifier.test(item.id)) && new Set(items.map(item => item.id)).size === items.length;
}

export function normalizeWorkflow(value) {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.steps) || value.steps.length > 24 || !uniqueIds(value.steps) ||
    !Array.isArray(value.inputs) || value.inputs.length > 24 || !uniqueIds(value.inputs)) {
    throw new Error("工作流格式无效。最多支持 24 个输入和 24 个步骤，标识必须唯一。");
  }
  return {
    version: 1,
    title: text(value.title, 120) || "未命名工作流",
    inputs: value.inputs.map(input => {
      const label = text(input.label, 120) || input.id;
      if (input.type === "image") return { id: input.id, label, type: "image" };
      if (input.type !== "text") throw new Error(`输入“${label}”的类型无效。`);
      return { id: input.id, label, type: "text", defaultValue: text(input.defaultValue, 2000), required: input.required === true };
    }),
    steps: value.steps.map(step => {
      if (!Object.hasOwn(workflowStepNames, step.kind)) throw new Error("工作流包含未支持的步骤。");
      return { id: step.id, kind: step.kind, prompt: text(step.prompt, 24000),
        source: step.source && ["input", "step"].includes(step.source.type) && identifier.test(step.source.id)
          ? { type: step.source.type, id: step.source.id } : null };
    })
  };
}

export function workflowAssetIdentity(value) {
  if (!record(value) || !identifier.test(value.assetId) || !identifier.test(value.occurrenceId) || !/^[a-f0-9]{64}$/i.test(value.contentHash)) return null;
  return { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash.toLowerCase() };
}

export function workflowBindings(definition, value) {
  return Object.fromEntries(definition.inputs.map(input => {
    const binding = record(value) && Object.hasOwn(value, input.id) ? value[input.id] : undefined;
    return [input.id, input.type === "text" ? typeof binding === "string" ? text(binding, 2000) : input.defaultValue : workflowAssetIdentity(binding)];
  }));
}

export function workflowIssues(definition, bindings) {
  const issues = [];
  if (!definition.steps.length) issues.push({ message: "请添加至少一个步骤。" });
  const inputs = new Map(definition.inputs.map(input => [input.id, input]));
  const earlier = new Set();
  for (const step of definition.steps) {
    const issue = (message) => issues.push({ stepId: step.id, message });
    if (step.kind !== "cutout" && !step.prompt) issue(step.kind === "background" ? "请填写背景描述。" : "请填写图片描述。");
    if (step.kind !== "generate") {
      if (!step.source) issue("请选择输入图片或前一步的结果。");
      else if (step.source.type === "step" && !earlier.has(step.source.id)) issue("来源必须是排在本步骤之前的结果。");
      else if (step.source.type === "input" && inputs.get(step.source.id)?.type !== "image") issue("图片输入槽已不存在。");
      else if (bindings && step.source.type === "input" && !bindings[step.source.id]) issue("请绑定项目中的图片。" );
    } else if (step.source) issue("生成图片步骤不接收来源。请使用参考图编辑步骤。");
    for (const match of step.prompt.matchAll(token)) {
      const input = inputs.get(match[1]);
      if (input?.type !== "text") issue(`未知文字参数 ${match[1]}。`);
      else if (bindings && input.required && !bindings[input.id]) issue(`请填写“${input.label}”。`);
    }
    earlier.add(step.id);
  }
  return issues;
}

export function workflowStepPrompt(step, bindings) {
  const prompt = step.prompt.replace(token, (_match, id) => bindings[id] || "");
  if (step.kind === "cutout") return `保留源图主体、位置和比例，彻底删除背景，输出真实透明 PNG。${prompt ? ` 主体说明：${prompt}` : ""}`;
  if (step.kind === "background") return `只替换源图背景为：${prompt}。完整保留主体外观、细节及位置。`;
  return prompt;
}
