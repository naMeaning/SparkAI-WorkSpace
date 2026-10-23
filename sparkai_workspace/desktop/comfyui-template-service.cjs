"use strict";

const { readFileSync, statSync } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { normalizeWorkflow, inspectWorkflowGraph, templateHashFor, localBaseUrl, stableHash, normalizeCapabilities, templateSamplingMetadata } = require("../runtime/image-generation/comfyui-executor.cjs");
const { normalizeComfyUiTaskOptions, normalizeComfyUiConnectionReference, normalizeComfyUiWorkflowReference } = require("../runtime/comfyui-options.mjs");
const { CORE_NODES, MAPPING_PORTS, IMAGE_MAPPING_KINDS, TEMPLATE_SCHEMA_VERSION, TEMPLATE_POLICY_VERSION, CAPABILITY_SCHEMA_VERSION, CAPABILITY_POLICY_VERSION, WORKFLOW_CAPABILITIES } = require("../runtime/image-generation/comfyui-template-registry.cjs");

const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const clean = value => String(value || "").replace(/[\u0000-\u001f]/g, "").slice(0, 100);

function builtIn(kind) {
  if (kind === "cutout") return { id: "stock-cutout", label: "蒙版抠图（标记移除区）", version: 1, builtIn: true, capability: "cutout", schemaVersion: CAPABILITY_SCHEMA_VERSION, policyVersion: CAPABILITY_POLICY_VERSION,
    workflow: { "10": { class_type: "LoadImage", inputs: { image: "source.png" } }, "11": { class_type: "LoadImageMask", inputs: { image: "mask.png", channel: "alpha" } },
      "12": { class_type: "JoinImageWithAlpha", inputs: { image: ["10", 0], alpha: ["11", 0] } }, "9": { class_type: "SaveImage", inputs: { images: ["12", 0], filename_prefix: "SparkAI" } } },
    inputMappings: [{ nodeId: "10", inputName: "image", kind: "sourceImage" }, { nodeId: "11", inputName: "image", kind: "maskImage" }], outputNodeId: "9" };
  const workflow = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "3": { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0], seed: -1, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: kind === "img2img" ? 0.65 : kind === "inpaint" ? 0.75 : 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "SparkAI" } }
  };
  const inputMappings = [
    { nodeId: "6", inputName: "text", kind: "prompt" }, { nodeId: "7", inputName: "text", kind: "negative" },
    { nodeId: "4", inputName: "ckpt_name", kind: "model" }, { nodeId: "3", inputName: "seed", kind: "seed" },
    { nodeId: "3", inputName: "steps", kind: "steps" }, { nodeId: "3", inputName: "cfg", kind: "cfg" },
    { nodeId: "3", inputName: "sampler_name", kind: "sampler" }, { nodeId: "3", inputName: "scheduler", kind: "scheduler" },
    { nodeId: "3", inputName: "denoise", kind: "denoise" }
  ];
  if (kind === "inpaint") {
    workflow["10"] = { class_type: "LoadImage", inputs: { image: "source.png" } };
    workflow["11"] = { class_type: "LoadImageMask", inputs: { image: "mask.png", channel: "alpha" } };
    workflow["5"] = { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["10", 0], vae: ["4", 2], mask: ["11", 0], grow_mask_by: 6 } };
    inputMappings.push({ nodeId: "10", inputName: "image", kind: "sourceImage" }, { nodeId: "11", inputName: "image", kind: "maskImage" });
  } else if (kind === "img2img") {
    workflow["10"] = { class_type: "LoadImage", inputs: { image: "input.png" } };
    workflow["5"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } };
    inputMappings.push({ nodeId: "10", inputName: "image", kind: "image", index: 0 });
  } else {
    workflow["5"] = { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } };
    inputMappings.push({ nodeId: "5", inputName: "width", kind: "width" }, { nodeId: "5", inputName: "height", kind: "height" });
  }
  return { id: `stock-${kind}`, label: kind === "img2img" ? "基础图生图" : kind === "inpaint" ? "蒙版局部重绘" : "基础文生图", version: 1, workflow, inputMappings, outputNodeId: "9", builtIn: true, capability: kind,
    schemaVersion: kind === "inpaint" ? CAPABILITY_SCHEMA_VERSION : TEMPLATE_SCHEMA_VERSION, modelFamily: "checkpoint", policyVersion: kind === "inpaint" ? CAPABILITY_POLICY_VERSION : TEMPLATE_POLICY_VERSION };
}

function validated(value) {
  const info = normalizeWorkflow(value.workflow, { inputMappings: value.inputMappings, outputNodeId: value.outputNodeId, ...(value.capability === undefined ? {} : { capability: value.capability }) });
  const imageInputs = new Set(info.inputMappings.filter(mapping => IMAGE_MAPPING_KINDS.includes(mapping.kind)).map(mapping => `${mapping.kind}:${mapping.index ?? 0}`)).size;
  const operation = info.capability;
  const sourceSchema = Number(value.schemaVersion) || 1;
  const typed = sourceSchema >= CAPABILITY_SCHEMA_VERSION || info.inputMappings.some(mapping => ["sourceImage", "maskImage", "referenceImages"].includes(mapping.kind));
  const { defaults, exposedInputs, parameterRanges } = templateSamplingMetadata(info);
  const policyVersion = typeof value.policyVersion === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value.policyVersion) ? value.policyVersion : typed ? CAPABILITY_POLICY_VERSION : TEMPLATE_POLICY_VERSION;
  // Retain a verified v1 alias when a later import rewrites the template store.
  const legacyMappings = value.builtIn === true
    ? info.inputMappings.filter(mapping => !["steps", "cfg", "sampler", "scheduler", "denoise"].includes(mapping.kind))
    : info.inputMappings;
  const legacyHash = stableHash({ workflow: info.workflow, inputMappings: legacyMappings, outputNodeId: info.outputNodeId });
  const legacyTemplateHash = !typed && policyVersion === TEMPLATE_POLICY_VERSION && (sourceSchema < TEMPLATE_SCHEMA_VERSION || value.builtIn === true || value.legacyTemplateHash === legacyHash)
    ? legacyHash : undefined;
  return { id: String(value.id), label: clean(value.label) || "本地模板", version: Number(value.version) || 1, builtIn: value.builtIn === true,
    workflowId: String(value.id), schemaVersion: typed ? CAPABILITY_SCHEMA_VERSION : TEMPLATE_SCHEMA_VERSION, modelFamily: info.requiresCheckpoint ? "checkpoint" : "none", exposedInputs, defaults, parameterRanges, policyVersion,
    workflow: info.workflow, inputMappings: info.inputMappings, outputNodeId: info.outputNodeId, operation, imageInputs,
    capability: info.capability, inputRoles: info.inputRoles, requiresCheckpoint: info.requiresCheckpoint, alphaRequired: info.alphaRequired,
    ...(legacyTemplateHash ? { legacyTemplateHash } : {}), templateHash: templateHashFor(info, policyVersion) };
}

/** Main owns reviewed templates; no scripts, dependency installs or file paths in public requests. */
function createComfyUiTemplateService({ configPath, readJson, writeJson, executor, dialog, connectionService }) {
  const defaults = WORKFLOW_CAPABILITIES.map(kind => validated(builtIn(kind)));
  const drafts = new Map();
  function resolveConnection(input = {}) {
    const connectionId = normalizeComfyUiConnectionReference(input);
    if (typeof connectionService?.resolve !== "function") return { baseUrl: localBaseUrl(input.baseUrl), id: "comfyui-local", networkScope: "local" };
    // A v1 task carries only baseUrl. Persisting this compatibility profile
    // gives the subsequent Main image path a resolvable connectionId while
    // preserving the original localhost operation without a new submission.
    if (!connectionId && input.baseUrl !== undefined && typeof connectionService.migrateLegacy === "function") {
      return connectionService.migrateLegacy({ baseUrl: input.baseUrl, networkScope: input.networkScope, persist: true });
    }
    return connectionService.resolve(input);
  }
  function customTemplates() {
    const store = readJson(configPath, { version: 1, templates: [] });
    if (store?.version !== 1 || !Array.isArray(store.templates) || store.templates.length > 32) throw fail("COMFYUI_TEMPLATE_STORE_INVALID", "本地模板记录无法读取。");
    return store.templates.map(template => validated({ ...template, builtIn: false }));
  }
  const all = () => [...defaults, ...customTemplates()];
  const publicTemplate = ({ workflow, legacyTemplateHash, ...value }) => clone({ ...value, inputMappings: value.inputMappings.map(({ value: literal, ...mapping }) => mapping) });
  function list() { return { ok: true, templates: all().map(publicTemplate), baseUrl: "http://127.0.0.1:8188", connections: typeof connectionService?.list === "function" ? connectionService.list() : [] }; }
  async function inspect(input = {}) {
    const connection = resolveConnection(input);
    const credentials = typeof connectionService?.credentialHeaders === "function" ? connectionService.credentialHeaders(connection) : { headers: {}, tls: { rejectUnauthorized: true } };
    const policy = typeof connectionService?.requestPolicy === "function" ? connectionService.requestPolicy(connection) : undefined;
    const inspected = await executor.inspect(connection.baseUrl, { connection, headers: credentials.headers, tls: credentials.tls, policy });
    const capabilities = inspected.capabilities || normalizeCapabilities(inspected.objectInfo, inspected.systemStats);
    const checkpoints = Array.isArray(capabilities.checkpoints) ? capabilities.checkpoints : [];
    return { ok: true, connectionId: connection.id, networkScope: connection.networkScope, baseUrl: inspected.baseUrl, checkpoints,
      samplers: Array.isArray(capabilities.samplers) ? capabilities.samplers : [],
      schedulers: Array.isArray(capabilities.schedulers) ? capabilities.schedulers : [],
      parameterRanges: capabilities.parameterRanges || {}, capabilitiesHash: capabilities.capabilitiesHash,
      coreNodes: Array.isArray(capabilities.coreNodes) ? capabilities.coreNodes : [],
      devices: Array.isArray(capabilities.devices) ? capabilities.devices : [] };
  }
  async function selectWorkflow() {
    if (!dialog?.showOpenDialog) throw fail("COMFYUI_TEMPLATE_IMPORT_UNAVAILABLE", "当前运行时不能打开模板文件。");
    const selection = await dialog.showOpenDialog({ title: "导入 ComfyUI API Format JSON", properties: ["openFile"], filters: [{ name: "API Format JSON", extensions: ["json"] }] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true };
    const file = selection.filePaths[0];
    if (!statSync(file).isFile() || statSync(file).size > 2 * 1024 * 1024) throw fail("COMFYUI_WORKFLOW_TOO_LARGE", "模板文件超过 2 MiB 或不是文件。");
    let workflow;
    try { workflow = JSON.parse(readFileSync(file, "utf8")); } catch { throw fail("COMFYUI_WORKFLOW_INVALID", "模板必须是 API Format JSON。"); }
    return { workflow };
  }
  function saveTemplate(template) {
    const existing = customTemplates();
    const previous = existing.find(value => value.id === template.id);
    if (previous) template.version = previous.version + 1;
    const templates = [...existing.filter(value => value.id !== template.id), template];
    if (templates.length > 32) throw fail("COMFYUI_TEMPLATE_CAPACITY", "最多保存 32 个导入模板。");
    writeJson(configPath, { version: 1, templates });
    return { ok: true, template: publicTemplate(template), ...list() };
  }
  async function importTemplate(input = {}) {
    const selected = await selectWorkflow(); if (selected.canceled) return selected;
    const { workflow } = selected;
    return saveTemplate(validated({ id: `import-${createHash("sha256").update(JSON.stringify(workflow)).digest("hex").slice(0, 20)}`, label: input.label, version: 1, workflow, outputNodeId: input.outputNodeId, inputMappings: input.inputMappings, ...(input.capability ? { capability: input.capability } : {}) }));
  }
  async function previewImport(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "label")) throw fail("COMFYUI_TEMPLATE_IMPORT_INVALID", "工作流预检只接受名称，由 Main 原生选择文件。");
    const selected = await selectWorkflow(); if (selected.canceled) return selected;
    const { workflow } = selected, issues = [], safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;
    const entries = workflow && typeof workflow === "object" && !Array.isArray(workflow) ? Object.entries(workflow).slice(0, 64) : [];
    const nodes = entries.map(([nodeId, node]) => {
      const classType = typeof node?.class_type === "string" && /^[A-Za-z0-9_]{1,80}$/.test(node.class_type) ? node.class_type : "unsupported";
      const spec = Object.prototype.hasOwnProperty.call(CORE_NODES, classType) ? CORE_NODES[classType] : undefined;
      if (!spec) issues.push({ code: "COMFYUI_NODE_UNAPPROVED", ...(safeId(nodeId) ? { nodeId } : {}), classType });
      return { nodeId: safeId(nodeId) || "unsupported", classType, approved: Boolean(spec), inputs: spec ? Object.entries(spec.inputs).map(([inputName, type]) => ({ inputName, type,
        allowedKinds: Object.entries(MAPPING_PORTS).filter(([kind, ports]) => kind !== "image" && ports.includes(`${classType}.${inputName}`)).map(([kind]) => kind) })) : [], outputTypes: spec ? [...spec.outputs] : [], outputNode: spec?.outputNode === true };
    });
    let graph;
    try { graph = inspectWorkflowGraph(workflow); } catch (error) { if (!issues.some(issue => issue.code === error.code)) issues.push({ code: typeof error.code === "string" && /^COMFYUI_/.test(error.code) ? error.code : "COMFYUI_WORKFLOW_INVALID" }); }
    const sampler = graph?.nodes.some(node => node.classType === "KSampler"), hasImage = graph?.nodes.some(node => node.classType === "LoadImage"), hasMask = graph?.nodes.some(node => node.classType === "LoadImageMask");
    const candidateCapabilities = issues.length ? [] : sampler ? [hasMask ? "inpaint" : hasImage ? "img2img" : "generate"] : hasImage && hasMask && graph?.nodes.some(node => node.classType === "JoinImageWithAlpha") ? ["cutout"] : [];
    if (!issues.length && !candidateCapabilities.length) issues.push({ code: "COMFYUI_CAPABILITY_INVALID" });
    for (const [id, draft] of drafts) if (Date.now() - draft.createdAt > 15 * 60_000) drafts.delete(id);
    if (drafts.size >= 8) throw fail("COMFYUI_TEMPLATE_DRAFT_CAPACITY", "待审核工作流已达上限，请先完成已有审核。");
    const draftId = `comfy-draft-${randomUUID()}`, blocked = issues.length > 0;
    drafts.set(draftId, { workflow: clone(workflow), label: clean(input.label), blocked, createdAt: Date.now(), candidateCapabilities });
    return { ok: true, draftId, blocked, issues, nodes, candidateCapabilities };
  }
  function approveImport(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["draftId", "label", "capability", "outputNodeId", "inputMappings"].includes(key))) throw fail("COMFYUI_TEMPLATE_IMPORT_INVALID", "工作流审核只能引用 Main 草稿与受控映射。");
    const draft = drafts.get(input.draftId);
    if (!draft || Date.now() - draft.createdAt > 15 * 60_000) throw fail("COMFYUI_TEMPLATE_DRAFT_UNAVAILABLE", "工作流草稿已失效，请重新选择文件。");
    if (draft.blocked) throw fail("COMFYUI_TEMPLATE_BLOCKED", "工作流包含未审核节点或无效输入，不能执行或批准。");
    if (!WORKFLOW_CAPABILITIES.includes(input.capability) || !draft.candidateCapabilities.includes(input.capability) || !Array.isArray(input.inputMappings) || input.inputMappings.some(mapping => !mapping || Object.prototype.hasOwnProperty.call(mapping, "value") || mapping.kind === "value" || mapping.kind === "image")) throw fail("COMFYUI_NODE_MAPPING_INVALID", "请选择候选能力并逐项设置受控输入映射。");
    const identity = { workflow: draft.workflow, capability: input.capability, outputNodeId: input.outputNodeId, inputMappings: input.inputMappings };
    const result = saveTemplate(validated({ ...identity, id: `import-${stableHash(identity).slice(0, 20)}`, label: input.label || draft.label, version: 1, schemaVersion: CAPABILITY_SCHEMA_VERSION, policyVersion: CAPABILITY_POLICY_VERSION }));
    drafts.delete(input.draftId); return result;
  }
  function resolve(input = {}) {
    const templateId = normalizeComfyUiWorkflowReference(input);
    const template = all().find(value => value.id === templateId);
    const connection = resolveConnection(input);
    const options = normalizeComfyUiTaskOptions({ ...input, connectionId: connection.id, baseUrl: connection.baseUrl, networkScope: connection.networkScope }, template);
    if (!template || ![template.templateHash, template.legacyTemplateHash].includes(options.templateHash)) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板版本已改变，请重新选择后提交。");
    return { workflow: clone(template.workflow), outputNodeId: template.outputNodeId, inputMappings: clone(template.inputMappings),
      ...options,
      connectionId: connection.id, networkScope: connection.networkScope, templateId: template.id, templateVersion: template.version, templateHash: template.templateHash, schemaVersion: template.schemaVersion,
      modelFamily: template.modelFamily, exposedInputs: clone(template.exposedInputs), defaults: clone(template.defaults), parameterRanges: clone(template.parameterRanges),
      policyVersion: template.policyVersion, operation: template.operation, imageInputs: template.imageInputs, capability: template.capability,
      inputRoles: clone(template.inputRoles), requiresCheckpoint: template.requiresCheckpoint, alphaRequired: template.alphaRequired };
  }
  return { list, inspect, importTemplate, previewImport, approveImport, resolve, connectionService };
}

module.exports = { createComfyUiTemplateService, builtIn };
