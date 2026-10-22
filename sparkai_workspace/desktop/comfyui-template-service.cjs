"use strict";

const { readFileSync, statSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { normalizeWorkflow, localBaseUrl, stableHash, normalizeCapabilities, templateSamplingMetadata } = require("../runtime/image-generation/comfyui-executor.cjs");
const { normalizeComfyUiTaskOptions } = require("../runtime/comfyui-options.mjs");
const { TEMPLATE_SCHEMA_VERSION, TEMPLATE_POLICY_VERSION } = require("../runtime/image-generation/comfyui-template-registry.cjs");

const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const clean = value => String(value || "").replace(/[\u0000-\u001f]/g, "").slice(0, 100);

function builtIn(kind) {
  const workflow = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
    "3": { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0], seed: -1, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: kind === "img2img" ? 0.65 : 1 } },
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
  if (kind === "img2img") {
    workflow["10"] = { class_type: "LoadImage", inputs: { image: "input.png" } };
    workflow["5"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } };
    inputMappings.push({ nodeId: "10", inputName: "image", kind: "image", index: 0 });
  } else {
    workflow["5"] = { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } };
    inputMappings.push({ nodeId: "5", inputName: "width", kind: "width" }, { nodeId: "5", inputName: "height", kind: "height" });
  }
  return { id: `stock-${kind}`, label: kind === "img2img" ? "基础图生图" : "基础文生图", version: 1, workflow, inputMappings, outputNodeId: "9", builtIn: true,
    schemaVersion: TEMPLATE_SCHEMA_VERSION, modelFamily: "checkpoint", policyVersion: TEMPLATE_POLICY_VERSION };
}

function validated(value) {
  const info = normalizeWorkflow(value.workflow, { inputMappings: value.inputMappings, outputNodeId: value.outputNodeId });
  const imageInputs = info.inputMappings.filter(mapping => mapping.kind === "image").length;
  const operation = imageInputs ? "img2img" : "generate";
  const sourceSchema = Number(value.schemaVersion) || 1;
  const { defaults, exposedInputs, parameterRanges } = templateSamplingMetadata(info);
  const policyVersion = typeof value.policyVersion === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value.policyVersion) ? value.policyVersion : TEMPLATE_POLICY_VERSION;
  const hashInput = { workflow: info.workflow, inputMappings: info.inputMappings, outputNodeId: info.outputNodeId, policyVersion };
  // Retain a verified v1 alias when a later import rewrites the template store.
  const legacyMappings = value.builtIn === true
    ? info.inputMappings.filter(mapping => !["steps", "cfg", "sampler", "scheduler", "denoise"].includes(mapping.kind))
    : info.inputMappings;
  const legacyHash = stableHash({ workflow: info.workflow, inputMappings: legacyMappings, outputNodeId: info.outputNodeId });
  const legacyTemplateHash = policyVersion === TEMPLATE_POLICY_VERSION && (sourceSchema < TEMPLATE_SCHEMA_VERSION || value.builtIn === true || value.legacyTemplateHash === legacyHash)
    ? legacyHash : undefined;
  return { id: String(value.id), label: clean(value.label) || "本地模板", version: Number(value.version) || 1, builtIn: value.builtIn === true,
    schemaVersion: TEMPLATE_SCHEMA_VERSION, modelFamily: "checkpoint", exposedInputs, defaults, parameterRanges, policyVersion,
    workflow: info.workflow, inputMappings: info.inputMappings, outputNodeId: info.outputNodeId, operation, imageInputs,
    ...(legacyTemplateHash ? { legacyTemplateHash } : {}), templateHash: stableHash(hashInput) };
}

/** Main owns reviewed templates; no scripts, dependency installs or file paths in public requests. */
function createComfyUiTemplateService({ configPath, readJson, writeJson, executor, dialog }) {
  const defaults = [validated(builtIn("generate")), validated(builtIn("img2img"))];
  function customTemplates() {
    const store = readJson(configPath, { version: 1, templates: [] });
    if (store?.version !== 1 || !Array.isArray(store.templates) || store.templates.length > 32) throw fail("COMFYUI_TEMPLATE_STORE_INVALID", "本地模板记录无法读取。");
    return store.templates.map(template => validated({ ...template, builtIn: false }));
  }
  const all = () => [...defaults, ...customTemplates()];
  const publicTemplate = ({ workflow, legacyTemplateHash, ...value }) => clone(value);
  function list() { return { ok: true, templates: all().map(publicTemplate), baseUrl: "http://127.0.0.1:8188" }; }
  async function inspect(input = {}) {
    const inspected = await executor.inspect(localBaseUrl(input.baseUrl));
    const capabilities = inspected.capabilities || normalizeCapabilities(inspected.objectInfo, inspected.systemStats);
    const checkpoints = Array.isArray(capabilities.checkpoints) ? capabilities.checkpoints : [];
    return { ok: true, baseUrl: inspected.baseUrl, checkpoints,
      samplers: Array.isArray(capabilities.samplers) ? capabilities.samplers : [],
      schedulers: Array.isArray(capabilities.schedulers) ? capabilities.schedulers : [],
      parameterRanges: capabilities.parameterRanges || {}, capabilitiesHash: capabilities.capabilitiesHash,
      coreNodes: Array.isArray(capabilities.coreNodes) ? capabilities.coreNodes : [],
      devices: Array.isArray(capabilities.devices) ? capabilities.devices : [] };
  }
  async function importTemplate(input = {}) {
    if (!dialog?.showOpenDialog) throw fail("COMFYUI_TEMPLATE_IMPORT_UNAVAILABLE", "当前运行时不能打开模板文件。");
    const selection = await dialog.showOpenDialog({ title: "导入 ComfyUI API Format JSON", properties: ["openFile"], filters: [{ name: "API Format JSON", extensions: ["json"] }] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true };
    const file = selection.filePaths[0];
    if (!statSync(file).isFile() || statSync(file).size > 2 * 1024 * 1024) throw fail("COMFYUI_WORKFLOW_TOO_LARGE", "模板文件超过 2 MiB 或不是文件。");
    let workflow;
    try { workflow = JSON.parse(readFileSync(file, "utf8")); } catch { throw fail("COMFYUI_WORKFLOW_INVALID", "模板必须是 API Format JSON。"); }
    const template = validated({ id: `import-${createHash("sha256").update(JSON.stringify(workflow)).digest("hex").slice(0, 20)}`, label: input.label, version: 1, workflow, outputNodeId: input.outputNodeId, inputMappings: input.inputMappings });
    const existing = customTemplates();
    const previous = existing.find(value => value.id === template.id);
    if (previous) template.version = previous.version + 1;
    const templates = [...existing.filter(value => value.id !== template.id), template];
    if (templates.length > 32) throw fail("COMFYUI_TEMPLATE_CAPACITY", "最多保存 32 个导入模板。");
    writeJson(configPath, { version: 1, templates });
    return { ok: true, template: publicTemplate(template), ...list() };
  }
  function resolve(input = {}) {
    const templateId = input && typeof input === "object" ? input.templateId : undefined;
    const template = all().find(value => value.id === templateId);
    const options = normalizeComfyUiTaskOptions(input, template);
    if (!template || ![template.templateHash, template.legacyTemplateHash].includes(options.templateHash)) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板版本已改变，请重新选择后提交。");
    return { workflow: clone(template.workflow), outputNodeId: template.outputNodeId, inputMappings: clone(template.inputMappings),
      ...options,
      templateId: template.id, templateVersion: template.version, templateHash: template.templateHash, schemaVersion: template.schemaVersion,
      modelFamily: template.modelFamily, exposedInputs: clone(template.exposedInputs), defaults: clone(template.defaults), parameterRanges: clone(template.parameterRanges),
      policyVersion: template.policyVersion, operation: template.operation, imageInputs: template.imageInputs };
  }
  return { list, inspect, importTemplate, resolve };
}

module.exports = { createComfyUiTemplateService, builtIn };
