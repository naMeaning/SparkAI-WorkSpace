/** Declarative reusable Requirement templates. This module performs no IO or execution. */
export const REQUIREMENT_TEMPLATE_LIMITS = Object.freeze({ variables: 24, text: 24000, value: 2000, options: 24, slots: 200, criteria: 400 });
const keyPattern = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const error = (code, message, field) => Object.assign(new Error(message), { code, ...(field ? { details: { field } } : {}) });
const fail = (message, field) => { throw error("INVALID_TEMPLATE", message, field); };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** Remove instance material even when it was embedded in human-readable instructions. */
export function reusableRequirementText(value, maximum = REQUIREMENT_TEMPLATE_LIMITS.text) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n")
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "[凭据已移除]")
    .replace(/\b(?:sk|rk|sess|session|token)-[A-Za-z0-9_-]{12,}\b/g, "[凭据已移除]")
    .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|session[_-]?cookie|cookie|secret|password|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}\n]+)/gi, "$1[凭据已移除]")
    .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已移除]")
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n<>"'|]*/gi, "[请绑定当前项目素材]")
    .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace|data|projects?|output|assets)\/[^\s<>"']+/gi, "[请绑定当前项目素材]")
    .replace(/\b(?:task|run|image|asset|occ|operation|requirement|revision|social-workflow|scientific-workflow|scientific-task|scientific-data|fmem|mask)-[a-f0-9]{8}(?:[a-f0-9-]{8,})\b/gi, "[实例引用已移除]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[实例引用已移除]")
    .replace(/^\s*(?:WORKFLOW_ID|PLAN_HASH|TASK_ID|RUN_ID|SOURCE_PATH|SOURCE_ASSET_ID|SOURCE_OCCURRENCE_ID)\s*:.*$/gim, "")
    .trim().slice(0, maximum);
}

function text(value, field, maximum, required = false) {
  if (typeof value !== "string" || value.length > maximum) fail(`${field} 必须是不超过 ${maximum} 字的文本。`, field);
  const clean = reusableRequirementText(value, maximum);
  if (required && !clean) fail(`${field} 不能为空。`, field);
  return clean;
}
function keys(value, allowed, field) {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${field} 含有不支持的字段。`, field);
}
function key(value, field) {
  if (typeof value !== "string" || !keyPattern.test(value) || unsafeKeys.has(value)) fail(`${field} 必须是以英文字母开头的有限变量名。`, field);
  return value;
}
function variableValue(variable, value, field) {
  if (variable.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < variable.min || value > variable.max) fail(`${variable.label} 必须是 ${variable.min} 到 ${variable.max} 的数值。`, field);
    if (variable.step !== undefined) {
      const count = (value - variable.min) / variable.step;
      if (Math.abs(count - Math.round(count)) > 1e-7) fail(`${variable.label} 不符合数值步长。`, field);
    }
    return value;
  }
  const clean = text(value, field, variable.type === "text" ? variable.maxLength : REQUIREMENT_TEMPLATE_LIMITS.value, variable.required);
  if (variable.type === "enum" && !variable.options.includes(clean)) fail(`${variable.label} 必须使用声明的选项。`, field);
  return clean;
}
function normalizeVariable(value, index) {
  const field = `variables.${index}`;
  if (!isRecord(value) || !["text", "enum", "number", "image"].includes(value.type)) fail("变量类型只支持 text、enum、number 或 image。", field);
  const extra = { text: ["maxLength"], enum: ["options"], number: ["min", "max", "step"], image: ["role"] }[value.type];
  keys(value, ["key", "type", "label", "required", ...(value.type === "image" ? [] : ["default"]), ...extra], field);
  const result = { key: key(value.key, `${field}.key`), type: value.type, label: text(value.label || value.key, `${field}.label`, 120, true), required: value.required !== false };
  if (value.required !== undefined && typeof value.required !== "boolean") fail("变量 required 必须为布尔值。", field);
  if (value.type === "image") {
    if (value.role !== undefined && !["source", "reference"].includes(value.role)) fail("图片变量 role 必须是 source 或 reference。", field);
    return { ...result, role: value.role || "source" };
  }
  if (value.type === "text") {
    const maximum = value.maxLength ?? REQUIREMENT_TEMPLATE_LIMITS.value;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > REQUIREMENT_TEMPLATE_LIMITS.value) fail("文本变量长度范围为 1 到 2000。", field);
    result.maxLength = maximum;
  } else if (value.type === "enum") {
    if (!Array.isArray(value.options) || !value.options.length || value.options.length > REQUIREMENT_TEMPLATE_LIMITS.options) fail("枚举变量需要 1 到 24 个选项。", field);
    result.options = value.options.map((option, n) => text(option, `${field}.options.${n}`, REQUIREMENT_TEMPLATE_LIMITS.value, true));
    if (new Set(result.options).size !== result.options.length) fail("枚举选项不能重复。", field);
  } else {
    result.min = value.min ?? -1_000_000_000; result.max = value.max ?? 1_000_000_000;
    if (![result.min, result.max].every(number => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 1_000_000_000) || result.min > result.max) fail("数值变量范围无效。", field);
    if (value.step !== undefined) {
      if (typeof value.step !== "number" || !Number.isFinite(value.step) || value.step <= 0 || value.step > 1_000_000_000) fail("数值步长必须是有限正数。", field);
      result.step = value.step;
    }
  }
  if (value.default !== undefined) result.default = variableValue(result, value.default, `${field}.default`);
  return result;
}

const fact = (value, field, maximum = 4000) => {
  const source = typeof value === "string" ? { text: value, source: "user" } : value;
  if (!isRecord(source) || (source.source !== undefined && !["user", "assumption"].includes(source.source))) fail("创作要求需要文本及明确的来源。", field);
  return { text: text(source.text, `${field}.text`, maximum, true), source: source.source || "user" };
};

/** Rebase reusable checks onto local template keys; source identities become image declarations. */
function normalizeAcceptance(value, variables) {
  if (!isRecord(value)) fail("acceptance 必须是创作要求对象。", "acceptance");
  const result = {}, ids = new Map(), sourceKeys = new Map();
  if (value.goal !== undefined) result.goal = fact(value.goal, "acceptance.goal", 4000);
  if (value.usage !== undefined) result.usage = fact(value.usage, "acceptance.usage", 4000);
  const slots = value.slots ?? [];
  if (!Array.isArray(slots) || slots.length > REQUIREMENT_TEMPLATE_LIMITS.slots) fail("模板交付项最多 200 个。", "acceptance.slots");
  result.slots = slots.map((slot, index) => {
    if (!isRecord(slot)) fail("模板交付项无效。", "acceptance.slots");
    const local = `template-slot-${index + 1}`;
    if (slot.slotId) { if (ids.has(slot.slotId)) fail("模板交付项不能重复。", "acceptance.slots"); ids.set(slot.slotId, local); }
    ids.set(local, local);
    return { slotId: local, label: text(slot.label, "acceptance.slots.label", 120, true), source: slot.source === "assumption" ? "assumption" : "user" };
  });
  let criterionCount = 0;
  function imageKey(target) {
    const identity = JSON.stringify([target?.assetId, target?.occurrenceId, target?.contentHash]);
    if (!target?.assetId || !target?.occurrenceId || !/^[a-f0-9]{64}$/i.test(target?.contentHash || "")) fail("来源一致性条件缺少完整来源身份。", "acceptance.sourceTargets");
    if (sourceKeys.has(identity)) return sourceKeys.get(identity);
    let name = `source_${sourceKeys.size + 1}`, suffix = 0;
    while (variables.some(variable => variable.key === name && variable.type !== "image")) name = `source_${sourceKeys.size + 1}_${++suffix}`;
    if (!variables.some(variable => variable.key === name)) variables.push(normalizeVariable({ key: name, label: `原图 ${sourceKeys.size + 1}（请重新绑定）`, type: "image", role: "source" }, variables.length));
    sourceKeys.set(identity, name); return name;
  }
  for (const group of ["preserve", "adjustable", "conditions"]) {
    const values = value[group] ?? [];
    if (!Array.isArray(values) || values.length > 200) fail("每类模板条件最多 200 条。", `acceptance.${group}`);
    result[group] = values.map((criterion, index) => {
      const current = fact(criterion, `acceptance.${group}.${index}`), source = typeof criterion === "string" ? {} : criterion;
      if (++criterionCount > REQUIREMENT_TEMPLATE_LIMITS.criteria) fail("模板验收条件合计最多 400 条。", "acceptance");
      if (source.kind !== undefined && !["visual", "source_consistency"].includes(source.kind)) fail("模板验收条件类型无效。", "acceptance.kind");
      const selected = source.slotIds ?? [];
      if (!Array.isArray(selected) || selected.some(id => !ids.has(id))) fail("模板条件引用了不存在的交付项。", "acceptance.slotIds");
      const slotIds = [...new Set(selected.map(id => ids.get(id)))];
      let references = source.sourceVariables ?? [];
      if (!Array.isArray(references)) fail("来源变量必须是变量名称列表。", "acceptance.sourceVariables");
      if (source.kind === "source_consistency" && !references.length) references = (source.sourceTargets || []).map(imageKey);
      if (references.some(name => !variables.some(variable => variable.key === name && variable.type === "image"))) fail("来源一致性条件必须引用已声明的图片变量。", "acceptance.sourceVariables");
      if (source.kind === "source_consistency" && !references.length) fail("来源一致性条件需要待绑定图片变量。", "acceptance.sourceVariables");
      return { criterionId: `template-${group}-${index + 1}`, ...current, kind: source.kind || "visual", ...(slotIds.length ? { slotIds } : {}), ...(source.kind === "source_consistency" ? { sourceVariables: [...new Set(references)] } : {}) };
    });
  }
  if (value.fileRules !== undefined) {
    keys(value.fileRules, ["formats", "width", "height", "minWidth", "minHeight", "alpha"], "acceptance.fileRules");
    const rules = {};
    for (const field of ["width", "height", "minWidth", "minHeight"]) if (value.fileRules[field] !== undefined) {
      if (!Number.isSafeInteger(value.fileRules[field]) || value.fileRules[field] < 1 || value.fileRules[field] > 65535) fail("模板文件尺寸必须是 1 到 65535 的整数。", `acceptance.fileRules.${field}`);
      rules[field] = value.fileRules[field];
    }
    if (value.fileRules.formats !== undefined) {
      if (!Array.isArray(value.fileRules.formats) || value.fileRules.formats.length > 5 || value.fileRules.formats.some(format => !["png", "jpeg", "webp", "avif", "tiff"].includes(format))) fail("模板文件格式无效。", "acceptance.fileRules.formats");
      rules.formats = [...new Set(value.fileRules.formats)];
    }
    if (value.fileRules.alpha !== undefined) {
      if (!["any", "required", "forbidden"].includes(value.fileRules.alpha)) fail("模板透明通道条件无效。", "acceptance.fileRules.alpha");
      rules.alpha = value.fileRules.alpha;
    }
    result.fileRules = rules;
  }
  return result;
}

function validateTokens(value, variables) {
  const known = new Set(variables.map(variable => variable.key));
  const visit = entry => {
    if (typeof entry === "string") {
      const remaining = entry.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,39})\}\}/g, (_, name) => {
        if (!known.has(name)) fail(`模板引用了未声明的变量 ${name}。`, "text"); return "";
      });
      if (/\{\{|\}\}/.test(remaining)) fail("模板只允许 {{变量名}} 占位，不支持表达式或模板代码。", "text");
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (isRecord(entry)) Object.values(entry).forEach(visit);
  };
  visit(value);
}

export function normalizeRequirementTemplate(value, body = "") {
  if (!isRecord(value) || value.version !== 2) fail("可复用模板需要 version=2。", "template.version");
  if (value.variables !== undefined && (!Array.isArray(value.variables) || value.variables.length > REQUIREMENT_TEMPLATE_LIMITS.variables)) fail("模板最多支持 24 个变量。", "template.variables");
  const variables = (value.variables || []).map(normalizeVariable);
  if (new Set(variables.map(variable => variable.key)).size !== variables.length) fail("模板变量名不能重复。", "template.variables");
  const result = { version: 2, variables };
  for (const field of ["scenario", "materialNotes", "styleNotes"]) if (value[field] !== undefined) result[field] = text(value[field], `template.${field}`, 2000);
  if (value.acceptance !== undefined) result.acceptance = normalizeAcceptance(value.acceptance, variables);
  if (variables.length > REQUIREMENT_TEMPLATE_LIMITS.variables) fail("来源声明后模板变量超过 24 个。", "template.variables");
  validateTokens([body, result], variables);
  return result;
}

export function requirementTemplateFingerprint(value) {
  const canonical = entry => Array.isArray(entry) ? `[${entry.map(canonical).join(",")}]` : isRecord(entry) ? `{${Object.keys(entry).sort().map(name => `${JSON.stringify(name)}:${canonical(entry[name])}`).join(",")}}` : JSON.stringify(entry);
  const material = canonical(value), words = [2166136261, 2246822507, 3266489909, 668265263];
  for (let index = 0; index < material.length; index++) {
    const code = material.charCodeAt(index);
    words[0] = Math.imul(words[0] ^ code, 16777619); words[1] = Math.imul(words[1] ^ (code + index), 2246822519);
    words[2] = Math.imul(words[2] ^ (code + words[0]), 3266489917); words[3] = Math.imul(words[3] ^ (code + words[1]), 668265263);
  }
  return `template-${words.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

/** Only the small immutable reference/expanded-value projection belongs in TaskScope. */
export function normalizeRequirementTemplateSnapshot(value) {
  if (!isRecord(value) || !/^reqtpl-[a-f0-9]{32}$/.test(value.templateId || "") || !Number.isSafeInteger(value.revision) || value.revision < 1 || !/^template-[a-f0-9]{32}$/.test(value.fingerprint || "") || !isRecord(value.variableValues || {})) return undefined;
  const entries = Object.entries(value.variableValues || {});
  if (entries.length > REQUIREMENT_TEMPLATE_LIMITS.variables) return undefined;
  const values = {};
  for (const [name, candidate] of entries) {
    if (!keyPattern.test(name) || unsafeKeys.has(name)) return undefined;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Math.abs(candidate) > 1_000_000_000) return undefined;
      values[name] = candidate;
    } else if (typeof candidate === "string" && candidate.length <= REQUIREMENT_TEMPLATE_LIMITS.value) values[name] = reusableRequirementText(candidate, REQUIREMENT_TEMPLATE_LIMITS.value);
    else return undefined;
  }
  return { templateId: value.templateId, revision: value.revision, fingerprint: value.fingerprint, variableValues: values };
}

export function normalizeRequirementTemplateDraft(value) {
  if (!isRecord(value)) return undefined;
  try {
    keys(value, ["creationRequirements", "imageBindings", "unboundImages"], "templateDraft");
    const unbound = value.unboundImages ?? [], bindings = value.imageBindings ?? [];
    if (!Array.isArray(unbound) || !Array.isArray(bindings) || unbound.length + bindings.length > REQUIREMENT_TEMPLATE_LIMITS.variables) return undefined;
    const variables = unbound.map(normalizeVariable);
    if (variables.some(variable => variable.type !== "image")) return undefined;
    const seen = new Set(variables.map(variable => variable.key)), normalizedBindings = [];
    if (seen.size !== variables.length) return undefined;
    for (const binding of bindings) {
      keys(binding, ["key", "nodeId", "role"], "templateDraft.imageBindings");
      key(binding.key, "templateDraft.imageBindings.key");
      if (seen.has(binding.key) || !["source", "reference"].includes(binding.role) || typeof binding.nodeId !== "string" || !/^[\p{L}\p{N}_.:@-]{1,160}$/u.test(binding.nodeId)) return undefined;
      seen.add(binding.key); normalizedBindings.push({ key: binding.key, nodeId: binding.nodeId, role: binding.role });
      variables.push(normalizeVariable({ key: binding.key, label: binding.key, type: "image", role: binding.role }, variables.length));
    }
    const creationRequirements = value.creationRequirements ? normalizeAcceptance(value.creationRequirements, variables) : undefined;
    if (variables.length !== seen.size) return undefined;
    return { ...(creationRequirements ? { creationRequirements } : {}), imageBindings: normalizedBindings, unboundImages: unbound.map(normalizeVariable) };
  } catch { return undefined; }
}

/** The caller supplies the selected successful task's authoritative text/requirements. */
export function reusableRequirementTemplateFromTask(value) {
  if (!isRecord(value)) fail("需要明确选择的任务内容。", "task");
  const requirements = value.creationRequirements || value.requirements;
  const body = reusableRequirementText(value.text || value.requirement?.text || requirements?.goal?.text || "");
  if (!body) fail("任务没有可复用的创作要求。", "text");
  const specification = { ...(isRecord(value.template) ? value.template : {}), version: 2,
    ...(requirements && !value.template?.acceptance ? { acceptance: requirements } : {}) };
  const template = normalizeRequirementTemplate(specification, body);
  const title = reusableRequirementText(value.title || body.split("\n")[0], 120) || "创作方法模板";
  return { title, text: body, template };
}

export function expandRequirementTemplate(entry, options = {}) {
  if (!isRecord(entry) || ![1, 2].includes(entry.version) || typeof entry.text !== "string" || !entry.text.trim()) fail("需求模板不存在或正文为空。", "entry");
  if (options.expectedTemplateRevision !== undefined && entry.revision !== options.expectedTemplateRevision) throw error("TEMPLATE_REVISION_CONFLICT", "模板版本已变化，请刷新后重试。");
  const body = reusableRequirementText(entry.text), template = entry.template ? normalizeRequirementTemplate(entry.template, body) : { version: 2, variables: [] };
  const values = options.variableValues ?? {}, bindings = options.imageBindings ?? [];
  if (!isRecord(values) || Object.keys(values).length > REQUIREMENT_TEMPLATE_LIMITS.variables || !Array.isArray(bindings) || bindings.length > REQUIREMENT_TEMPLATE_LIMITS.variables) fail("模板变量或图片绑定无效。", "variableValues");
  const byKey = new Map(template.variables.map(variable => [variable.key, variable])), bound = new Map(), resolved = {};
  for (const name of Object.keys(values)) if (!byKey.has(name) || byKey.get(name).type === "image") fail("值包含未声明的变量或图片身份。", `variableValues.${name}`);
  for (const binding of bindings) {
    keys(binding, ["key", "nodeId", "role"], "imageBindings");
    const variable = byKey.get(binding.key);
    if (!variable || variable.type !== "image" || bound.has(binding.key) || binding.role !== variable.role || typeof binding.nodeId !== "string" || !/^[\p{L}\p{N}_.:@-]{1,160}$/u.test(binding.nodeId)) fail("图片绑定须与声明对应，并来自当前项目的普通需求来源。", "imageBindings");
    bound.set(binding.key, { key: binding.key, nodeId: binding.nodeId, role: binding.role });
  }
  for (const variable of template.variables) if (variable.type !== "image") {
    const supplied = own(values, variable.key) ? values[variable.key] : variable.default;
    if (supplied === undefined) {
      if (variable.required) throw error("TEMPLATE_VARIABLE_REQUIRED", `请填写模板变量“${variable.label}”。`, variable.key);
      resolved[variable.key] = "";
    } else resolved[variable.key] = variableValue(variable, supplied, variable.key);
  }
  const expand = value => {
    if (typeof value === "string") return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,39})\}\}/g, (_, name) => byKey.get(name)?.type === "image" ? `${bound.has(name) ? "当前素材" : "待绑定图片"}：${byKey.get(name).label}` : String(resolved[name] ?? ""));
    if (Array.isArray(value)) return value.map(expand);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([name, candidate]) => [name, expand(candidate)]));
    return value;
  };
  const expandedText = entry.template ? expand(body) : body, creationRequirements = template.acceptance ? expand(clone(template.acceptance)) : undefined;
  if (!expandedText || expandedText.length > REQUIREMENT_TEMPLATE_LIMITS.text) fail("展开后的需求文本为空或超过 24000 字。", "text");
  const material = { templateId: entry.id || "", revision: entry.revision || 1, text: expandedText, variableValues: resolved, ...(creationRequirements ? { creationRequirements } : {}) };
  return { text: expandedText, ...(creationRequirements ? { creationRequirements } : {}), imageBindings: [...bound.values()],
    unboundImages: template.variables.filter(variable => variable.type === "image" && !bound.has(variable.key)).map(clone),
    templateSnapshot: { templateId: entry.id || "", revision: entry.revision || 1, fingerprint: requirementTemplateFingerprint(material), variableValues: clone(resolved) } };
}
