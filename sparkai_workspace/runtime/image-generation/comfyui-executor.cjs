"use strict";

const { createHash, randomUUID, randomBytes } = require("node:crypto");
const { URL } = require("node:url");
const { CORE_NODES, MAPPING_PORTS, TEMPLATE_POLICY_VERSION, CAPABILITY_POLICY_VERSION, WORKFLOW_CAPABILITIES, IMAGE_MAPPING_KINDS } = require("./comfyui-template-registry.cjs");
const { LOCAL_HOSTS, localBaseUrl, COMFYUI_PARAMETER_RANGES, normalizeComfyUiSamplingParameters, normalizeComfyUiWorkflowReference, isComfyUiModelName, isComfyUiSamplingChoice } = require("../comfyui-options.mjs");

const LINK_TYPES = new Set(["MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "IMAGE", "MASK"]);
const imageMapping = mapping => IMAGE_MAPPING_KINDS.includes(mapping.kind);
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const plain = (value) => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });

function stableHash(value) {
  function canonical(item) {
    if (Array.isArray(item)) return item.map(canonical);
    if (plain(item)) return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
    return item;
  }
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex");
}

function connectionHash(profile) {
  return stableHash({ id: profile.id, baseUrl: profile.baseUrl, networkScope: profile.networkScope, credentialRef: profile.credentialRef, tls: profile.tls });
}

function endpoint(base, path, query) {
  const url = new URL(path.replace(/^\/+/, ""), `${base.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  return url;
}

function relativeFile(value, { basename = false, empty = false } = {}) {
  if (typeof value !== "string" || value.length > 1024 || (!value && !empty) || /[\u0000-\u001f\u007f\\:%?#]/.test(value)) return false;
  if (!value) return true;
  const parts = value.split("/");
  return (!basename || parts.length === 1) && parts.every((part) => !!part && part !== "." && part !== ".." && !/[. ]$/.test(part));
}

function assertLiteral(kind, value) {
  let valid = false;
  if (kind === "text") valid = typeof value === "string" && value.length <= 16_384 && !value.includes("\0");
  if (kind === "file") valid = isComfyUiModelName(value);
  if (kind === "prefix") valid = relativeFile(value, { basename: true }) && value.length <= 180;
  if (kind === "choice") valid = isComfyUiSamplingChoice(value);
  if (kind === "dimension") valid = Number.isInteger(value) && value >= 64 && value <= 4096 && value % 8 === 0;
  if (kind === "batch") valid = Number.isInteger(value) && value >= 1 && value <= 4;
  if (kind === "seed") valid = Number.isSafeInteger(value) && value >= -1;
  if (kind === "steps") valid = Number.isInteger(value) && value >= 1 && value <= 150;
  if (kind === "cfg") valid = Number.isFinite(value) && value >= 0 && value <= 30;
  if (kind === "denoise") valid = Number.isFinite(value) && value >= 0 && value <= 1;
  if (kind === "channel") valid = ["alpha", "red", "green", "blue"].includes(value);
  if (kind === "boolean") valid = typeof value === "boolean";
  if (kind === "offset") valid = Number.isInteger(value) && value >= 0 && value <= 4096;
  if (kind === "grow") valid = Number.isInteger(value) && value >= 0 && value <= 64;
  if (!valid) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 模板端口值未通过校验。");
}

function normalizeMappings(workflow, values) {
  if (!Array.isArray(values) || values.length > 64) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 模板需要明确的输入映射数组。");
  const seen = new Set();
  const mappings = values.map((mapping) => {
    if (!plain(mapping) || Object.keys(mapping).some((key) => !["nodeId", "inputName", "kind", "index", "value"].includes(key))) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 输入映射无效。");
    const { nodeId, inputName, kind = "value" } = mapping;
    const node = workflow[nodeId], port = CORE_NODES[node?.class_type]?.inputs?.[inputName];
    if (!node || !port || LINK_TYPES.has(port) || seen.has(`${nodeId}.${inputName}`) || (kind !== "value" && !MAPPING_PORTS[kind]?.includes(`${node.class_type}.${inputName}`))) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 输入映射与审核端口不符。");
    seen.add(`${nodeId}.${inputName}`);
    if (kind === "image" || kind === "referenceImages") {
      if (!Number.isInteger(mapping.index) || mapping.index < 0 || mapping.index > 3 || own(mapping, "value")) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 图片映射需要明确的素材序号。");
    } else if (kind === "sourceImage" || kind === "maskImage") {
      if (mapping.index !== undefined || own(mapping, "value")) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 来源与蒙版映射不能携带素材序号或常量。");
      if (kind === "maskImage" && node.inputs.channel !== "alpha") throw fail("COMFYUI_NODE_MAPPING_INVALID", "受管蒙版必须读取 PNG 透明通道。");
    } else if (own(mapping, "value")) assertLiteral(port, mapping.value);
    return clone({ ...mapping, kind });
  });
  if (mappings.some(mapping => mapping.kind === "image") && mappings.some(mapping => ["sourceImage", "maskImage", "referenceImages"].includes(mapping.kind))) throw fail("COMFYUI_NODE_MAPPING_INVALID", "旧素材序号与显式素材角色不能混用。");
  for (const [id, node] of Object.entries(workflow)) if (["LoadImage", "LoadImageMask"].includes(node.class_type) && !mappings.some((mapping) => imageMapping(mapping) && mapping.nodeId === id && mapping.inputName === "image")) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 图片与蒙版输入必须映射至本任务上传素材。");
  return mappings;
}

function inspectWorkflowGraph(workflow) {
  if (!plain(workflow)) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 工作流必须是 API Format JSON 对象。");
  let raw;
  try { raw = JSON.stringify(workflow); } catch { throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 工作流必须是 JSON。"); }
  if (Buffer.byteLength(raw) > MAX_WORKFLOW_BYTES) throw fail("COMFYUI_WORKFLOW_TOO_LARGE", "ComfyUI 工作流超过大小限制。");
  const nodeIds = Object.keys(workflow);
  if (!nodeIds.length || nodeIds.length > 64 || nodeIds.some((id) => !ID_RE.test(id) || ["constructor", "prototype", "__proto__"].includes(id))) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 工作流节点数量或标识无效。");
  const nodes = [];
  for (const id of nodeIds) {
    const node = workflow[id];
    if (!plain(node) || Object.keys(node).some((key) => !["class_type", "inputs", "_meta"].includes(key)) || !plain(node.inputs)) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI API Format 节点无效。");
    const spec = own(CORE_NODES, node.class_type) ? CORE_NODES[node.class_type] : undefined;
    if (!spec) throw fail("COMFYUI_NODE_UNAPPROVED", "ComfyUI 模板包含首期未审核的节点。");
    if (Object.keys(node.inputs).length !== Object.keys(spec.inputs).length || Object.keys(node.inputs).some((key) => !own(spec.inputs, key))) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 模板包含未审核或缺失的输入端口。");
    for (const [name, kind] of Object.entries(spec.inputs)) {
      const value = node.inputs[name];
      if (LINK_TYPES.has(kind)) {
        const source = Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && own(workflow, value[0]) ? workflow[value[0]] : undefined;
        if (!source || !Number.isInteger(value[1]) || value[1] < 0 || CORE_NODES[source?.class_type]?.outputs?.[value[1]] !== kind) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 模板的节点连线类型无效。");
      } else assertLiteral(kind, value);
    }
    nodes.push({ id, classType: node.class_type });
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 模板不允许循环连线。");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const [name, kind] of Object.entries(CORE_NODES[workflow[id].class_type].inputs)) if (LINK_TYPES.has(kind)) visit(workflow[id].inputs[name][0]);
    visiting.delete(id); visited.add(id);
  }
  nodeIds.forEach(visit);
  const normalized = Object.fromEntries(nodeIds.map((id) => [id, { class_type: workflow[id].class_type, inputs: clone(workflow[id].inputs) }]));
  return { workflow: normalized, nodes, workflowHash: stableHash(normalized) };
}

function normalizeWorkflow(workflow, options = {}) {
  const graph = inspectWorkflowGraph(workflow);
  workflow = graph.workflow;
  const { nodes } = graph;
  const outputNodeId = options.outputNodeId;
  if (typeof outputNodeId !== "string" || !own(workflow, outputNodeId) || workflow[outputNodeId].class_type !== "SaveImage") throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 需要明确映射一个 SaveImage 成果节点。");
  const inputNodeId = options.inputNodeId;
  if (inputNodeId !== undefined && (!own(workflow, inputNodeId) || !["LoadImage", "LoadImageMask", "CLIPTextEncode"].includes(workflow[inputNodeId].class_type))) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 输入节点映射无效。");
  const inputMappings = normalizeMappings(workflow, options.inputMappings);
  const samplerCount = nodes.filter(node => node.classType === "KSampler").length, checkpointCount = nodes.filter(node => node.classType === "CheckpointLoaderSimple").length;
  const sourceMappings = inputMappings.filter(mapping => mapping.kind === "sourceImage" || mapping.kind === "image");
  const masks = inputMappings.filter(mapping => mapping.kind === "maskImage");
  const references = inputMappings.filter(mapping => mapping.kind === "referenceImages");
  const inferred = masks.length ? (samplerCount ? "inpaint" : "cutout") : sourceMappings.length ? "img2img" : "generate";
  const capability = options.capability === undefined ? inferred : options.capability;
  if (!WORKFLOW_CAPABILITIES.includes(capability)) throw fail("COMFYUI_CAPABILITY_INVALID", "ComfyUI 工作流能力无效。");
  if (capability === "cutout") {
    if (samplerCount || checkpointCount || !sourceMappings.length || !masks.length || !nodes.some(node => node.classType === "JoinImageWithAlpha")) throw fail("COMFYUI_CAPABILITY_INVALID", "蒙版抠图需要来源、受管蒙版与真实 alpha 输出节点，不运行采样模型。");
  } else if (samplerCount !== 1 || checkpointCount !== 1) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 生成模板需要一个采样器和一个基础模型。");
  if ((capability === "inpaint" && (!sourceMappings.length || !masks.length)) || (capability === "img2img" && !sourceMappings.length) || (!["inpaint", "cutout"].includes(capability) && masks.length) || (capability === "generate" && sourceMappings.length)) throw fail("COMFYUI_CAPABILITY_INVALID", "ComfyUI 素材角色与声明能力不匹配。");
  const ancestors = new Set();
  function collect(id) {
    if (ancestors.has(id)) return;
    ancestors.add(id);
    for (const [name, kind] of Object.entries(CORE_NODES[workflow[id].class_type].inputs)) if (LINK_TYPES.has(kind)) collect(workflow[id].inputs[name][0]);
  }
  collect(outputNodeId);
  if (nodes.some((node) => ["KSampler", "LoadImage", "LoadImageMask"].includes(node.classType) && !ancestors.has(node.id))) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 成果必须来自本任务采样器和已映射素材。");
  if (capability === "cutout" && !nodes.some(node => node.classType === "JoinImageWithAlpha" && ancestors.has(node.id))) throw fail("COMFYUI_CAPABILITY_INVALID", "抠图成果必须来自声明的 alpha 合成路径。");
  if (capability === "inpaint") {
    function branch(id, found = new Set()) {
      if (found.has(id)) return found;
      found.add(id);
      for (const [name, kind] of Object.entries(CORE_NODES[workflow[id].class_type].inputs)) if (LINK_TYPES.has(kind)) branch(workflow[id].inputs[name][0], found);
      return found;
    }
    const samplerId = nodes.find(node => node.classType === "KSampler").id;
    const latentBranch = branch(workflow[samplerId].inputs.latent_image[0]);
    const maskedSource = nodes.some(node => {
      if (!latentBranch.has(node.id) || !["VAEEncodeForInpaint", "SetLatentNoiseMask"].includes(node.classType)) return false;
      const inputs = workflow[node.id].inputs, maskBranch = branch(inputs.mask[0]), sourceBranch = branch((inputs.pixels || inputs.samples)[0]);
      return masks.some(mapping => maskBranch.has(mapping.nodeId)) && sourceMappings.some(mapping => sourceBranch.has(mapping.nodeId));
    });
    if (!maskedSource) throw fail("COMFYUI_CAPABILITY_INVALID", "局部重绘必须将来源与受管蒙版接入采样器的噪声区域。");
  }
  const legacyCount = new Set(inputMappings.filter(mapping => mapping.kind === "image").map(mapping => mapping.index)).size;
  const referenceSlots = [...new Set(references.map(mapping => mapping.index))].sort((a, b) => a - b);
  if (referenceSlots.some((slot, index) => slot !== index)) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 参考素材槽位必须从 0 连续映射，不能省略中间素材。");
  const referenceCount = Math.max(referenceSlots.length, legacyCount - 1);
  const inputRoles = {
    ...(sourceMappings.length ? { sourceImage: { required: true, maxCount: 1 } } : {}),
    ...(masks.length ? { maskImage: { required: true, maxCount: 1, managed: true } } : {}),
    ...(referenceCount > 0 ? { referenceImages: { required: true, minCount: referenceCount, maxCount: referenceCount } } : {})
  };
  return { ...graph, inputNodeId, outputNodeId, inputMappings, capability, inputRoles, requiresCheckpoint: capability !== "cutout", alphaRequired: capability === "cutout" };
}

function validateDependencies(info, objectInfo) {
  if (!plain(objectInfo)) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 未返回有效节点依赖目录。");
  for (const { id, classType } of info.nodes) {
    const available = objectInfo[classType], spec = CORE_NODES[classType];
    if (!own(objectInfo, classType) || !plain(available) || !plain(available.input?.required) || !Array.isArray(available.output) || (spec.modules ? !spec.modules.includes(available.python_module) : available.python_module && available.python_module !== "nodes")) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 缺少审核模板的核心节点依赖。");
    if (spec.outputs.some((type, index) => available.output[index] !== type) || (spec.outputNode && available.output_node !== true)) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 核心节点输出与模板不兼容。");
    const ports = { ...available.input.required, ...available.input.optional };
    if (Object.keys(available.input.required).some((key) => !own(info.workflow[id].inputs, key))) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 节点需要模板未声明的必需端口。");
    for (const [name, kind] of Object.entries(spec.inputs)) {
      const descriptor = ports[name], value = info.workflow[id].inputs[name];
      if (!Array.isArray(descriptor)) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 节点输入目录不兼容。");
      const [type, limits] = descriptor;
      if (LINK_TYPES.has(kind)) {
        if (type !== kind) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 节点连线依赖不兼容。");
      } else if (Array.isArray(type)) {
        // A LoadImage list predates this task's upload. Other choices must be
        // available now, including checkpoint weights and sampler/scheduler.
        if (!(["LoadImage", "LoadImageMask"].includes(classType) && name === "image") && !type.includes(value)) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 缺少模板选择的模型或采样依赖。");
      } else if (typeof value === "boolean") {
        if (type !== "BOOLEAN") throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 节点布尔端口不兼容。");
      } else if (typeof value === "number") {
        if (!["INT", "FLOAT"].includes(type) || (type === "INT" && !Number.isInteger(value)) || (Number.isFinite(limits?.min) && value < limits.min) || (Number.isFinite(limits?.max) && value > limits.max)) throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 模板参数超出本机节点能力。");
      } else if (type !== "STRING") throw fail("COMFYUI_DEPENDENCY_MISSING", "ComfyUI 节点输入类型不兼容。");
    }
  }
}

const SAFE_CAPABILITY_NODES = Object.freeze(Object.keys(CORE_NODES));

function descriptorChoices(descriptor, modelNames = false) {
  const values = Array.isArray(descriptor) && Array.isArray(descriptor[0]) ? descriptor[0] : [];
  return [...new Set(values.filter(value => modelNames ? isComfyUiModelName(value) : isComfyUiSamplingChoice(value)))].slice(0, 500);
}

function capabilityRange(field, descriptor) {
  if (!Array.isArray(descriptor) || !["INT", "FLOAT"].includes(descriptor[0])) return undefined;
  const safe = COMFYUI_PARAMETER_RANGES[field], limits = Array.isArray(descriptor) && descriptor[1] && typeof descriptor[1] === "object" ? descriptor[1] : {};
  let min = Number.isFinite(limits.min) ? Math.max(safe.min, limits.min) : safe.min;
  let max = Number.isFinite(limits.max) ? Math.min(safe.max, limits.max) : safe.max;
  if (field === "steps" || descriptor[0] === "INT") { min = Math.ceil(min); max = Math.floor(max); }
  return min <= max ? { min, max, step: descriptor[0] === "INT" ? 1 : safe.step } : undefined;
}

function safeDeviceSummary(device) {
  const rawName = typeof device?.name === "string" ? device.name : "";
  const name = rawName.length <= 120 && /^[\p{L}\p{N} ._()+,\[\]-]{1,120}$/u.test(rawName) && !/bearer|api[ _-]?key|authorization|password|secret|token|cookie/i.test(rawName) ? rawName : "";
  const rawType = typeof device?.type === "string" ? device.type.toLowerCase() : "";
  const type = ["cpu", "cuda", "mps", "xpu", "directml", "vulkan", "hip", "rocm", "privateuseone"].includes(rawType) ? rawType : "";
  return { name, type };
}

/**
 * Build a bounded, diagnostic-only projection of /object_info and
 * /system_stats.  The raw responses stay inside the executor for dependency
 * validation; callers receive only finite lists, ranges and device labels.
 */
function normalizeCapabilities(objectInfo, systemStats) {
  const rawInfo = plain(objectInfo) ? objectInfo : {};
  const info = Object.fromEntries(SAFE_CAPABILITY_NODES.filter(name => plain(rawInfo[name]) && (CORE_NODES[name].modules ? CORE_NODES[name].modules.includes(rawInfo[name].python_module) : !rawInfo[name].python_module || rawInfo[name].python_module === "nodes")).map(name => [name, rawInfo[name]]));
  const sampler = info.KSampler?.input?.required || {};
  const parameterRanges = Object.fromEntries(["steps", "cfg", "denoise"].map(field => [field, capabilityRange(field, sampler[field])]).filter(([, range]) => range));
  const capabilities = {
    checkpoints: descriptorChoices(info.CheckpointLoaderSimple?.input?.required?.ckpt_name, true),
    samplers: descriptorChoices(sampler.sampler_name),
    schedulers: descriptorChoices(sampler.scheduler),
    parameterRanges,
    coreNodes: Object.keys(info).filter(name => SAFE_CAPABILITY_NODES.includes(name)).slice(0, SAFE_CAPABILITY_NODES.length),
    devices: (Array.isArray(systemStats?.devices) ? systemStats.devices : []).slice(0, 16).map(safeDeviceSummary).filter(device => device.name || device.type)
  };
  capabilities.capabilitiesHash = stableHash(capabilities);
  return capabilities;
}

function templateSamplingMetadata(info) {
  const samplerId = info.nodes.find(node => node.classType === "KSampler")?.id;
  const sampler = info.workflow[samplerId]?.inputs || {};
  const ports = { steps: "steps", cfg: "cfg", sampler: "sampler_name", scheduler: "scheduler", denoise: "denoise" };
  const defaults = Object.fromEntries(Object.entries(ports).map(([field, port]) => {
    const mapping = info.inputMappings.find(item => item.nodeId === samplerId && item.inputName === port && own(item, "value"));
    return [field, mapping ? mapping.value : sampler[port]];
  }).filter(([, value]) => value !== undefined));
  const exposedInputs = [...new Set(info.inputMappings.filter(mapping => mapping.kind !== "value" && !own(mapping, "value")).map(mapping => mapping.kind))];
  const parameterRanges = Object.fromEntries(["steps", "cfg", "denoise"].filter(field => exposedInputs.includes(field)).map(field => [field, { ...COMFYUI_PARAMETER_RANGES[field] }]));
  return { defaults, exposedInputs, parameterRanges, inputMappings: info.inputMappings };
}

function templateHashFor(info, policyVersion = TEMPLATE_POLICY_VERSION) {
  return stableHash({ workflow: info.workflow, inputMappings: info.inputMappings, outputNodeId: info.outputNodeId, policyVersion, ...(policyVersion === CAPABILITY_POLICY_VERSION ? { capability: info.capability } : {}) });
}

function validateTemplateIdentity(info, input) {
  if (input?.templateHash === undefined) return;
  if (typeof input.templateHash !== "string" || !/^[a-f0-9]{64}$/.test(input.templateHash)) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板标识无效，请重新选择后提交。");
  const policyVersion = input.policyVersion === undefined ? TEMPLATE_POLICY_VERSION : input.policyVersion;
  if (typeof policyVersion !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(policyVersion) || templateHashFor(info, policyVersion) !== input.templateHash) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板版本或审核策略已改变，请重新选择后提交。");
}

function imageBytes(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.isBuffer(input?.buffer) ? input.buffer : typeof input?.base64 === "string" ? Buffer.from(input.base64, "base64") : null;
  if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) throw fail("COMFYUI_IMAGE_INVALID", "ComfyUI 素材为空或超过大小限制。");
  return Buffer.from(bytes);
}

function imageInfo(bytes) {
  let mimeType, width, height;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR") {
    mimeType = "image/png"; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    mimeType = "image/webp";
    const type = bytes.toString("ascii", 12, 16);
    if (type === "VP8X" && bytes.length >= 30) { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    if (type === "VP8 " && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    if (type === "VP8L" && bytes.length >= 25 && bytes[20] === 47) { const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mimeType = "image/jpeg";
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += length + 2;
    }
  }
  if (!mimeType || !width || !height || width > 16_384 || height > 16_384 || width * height > 64 * 1024 * 1024) throw fail("COMFYUI_IMAGE_INVALID", "ComfyUI 图片格式或尺寸无效。");
  return { mimeType, width, height };
}

function mappingInputIndex(mapping, metadata) {
  if (mapping.kind === "image") return mapping.index;
  return metadata.findIndex(item => item.role === mapping.kind && (mapping.kind !== "referenceImages" || item.index === mapping.index));
}

function normalizeInputs(info, input) {
  const originals = Array.isArray(input.inputs) ? input.inputs : [];
  const typed = info.inputMappings.some(mapping => ["sourceImage", "maskImage", "referenceImages"].includes(mapping.kind));
  if (originals.length > (typed ? 6 : 4)) throw fail("COMFYUI_IMAGE_INVALID", "ComfyUI 素材数量超过审核模板限制。");
  const roles = { sourceImage: 0, maskImage: 0, referenceImages: 0 }, roleKeys = new Set();
  const inputs = originals.map(imageBytes);
  const metadata = inputs.map((bytes, index) => {
    const original = originals[index], dimensions = imageInfo(bytes), sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = { ...dimensions, sha256, bytes: bytes.length };
    if (typed && (!plain(original) || !["sourceImage", "maskImage", "referenceImages"].includes(original.role))) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 素材需要明确的来源、蒙版或参考角色。");
    if (original?.role !== undefined) {
      if (!["sourceImage", "maskImage", "referenceImages"].includes(original.role)) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 素材角色无效。");
      const roleIndex = original.role === "referenceImages" ? (original.index ?? roles.referenceImages) : 0;
      if (!Number.isInteger(roleIndex) || roleIndex < 0 || roleIndex > 3 || (original.role !== "referenceImages" && original.index !== undefined && original.index !== 0) || roleKeys.has(`${original.role}:${roleIndex}`)) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 素材角色重复或序号无效。");
      roleKeys.add(`${original.role}:${roleIndex}`); roles[original.role]++;
      result.role = original.role; if (original.role === "referenceImages") result.index = roleIndex;
    }
    if (original?.contentHash !== undefined && original.contentHash !== sha256) throw fail("COMFYUI_INPUT_STALE", "ComfyUI 素材字节与冻结身份不一致。");
    for (const field of ["width", "height"]) if (original?.[field] !== undefined && original[field] !== dimensions[field]) throw fail("COMFYUI_INPUT_STALE", "ComfyUI 素材尺寸与冻结身份不一致。");
    if (original?.mimeType !== undefined && original.mimeType !== dimensions.mimeType) throw fail("COMFYUI_INPUT_STALE", "ComfyUI 素材格式与冻结身份不一致。");
    if (typed || ["assetId", "occurrenceId"].some(field => original?.[field] !== undefined)) {
      if (!["assetId", "occurrenceId"].every(field => typeof original[field] === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(original[field])) || original.contentHash !== sha256) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 素材稳定身份无效。");
      Object.assign(result, { assetId: original.assetId, occurrenceId: original.occurrenceId, contentHash: sha256 });
    }
    return result;
  });
  const consumed = new Set(info.inputMappings.filter(imageMapping).map(mapping => mappingInputIndex(mapping, metadata)));
  if (consumed.has(-1) || consumed.size !== inputs.length || [...consumed].some(index => index >= inputs.length)) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 映射必须与本任务素材逐一对应，不能忽略或交换素材。");
  let maskBindings;
  if (["inpaint", "cutout"].includes(info.capability)) {
    const source = metadata.find(item => item.role === "sourceImage"), mask = metadata.find(item => item.role === "maskImage"), binding = input.maskBindings;
    if (!source || !mask || mask.mimeType !== "image/png" || !plain(binding) || Object.keys(binding).some(key => !["sourceHash", "maskHash", "width", "height", "revision"].includes(key)) ||
      binding.sourceHash !== source.sha256 || binding.maskHash !== mask.sha256 || !Number.isSafeInteger(binding.revision) || binding.revision < 1 ||
      binding.width !== source.width || binding.height !== source.height || mask.width !== source.width || mask.height !== source.height) throw fail("COMFYUI_MASK_BINDING_INVALID", "ComfyUI 蒙版必须由 Main 绑定源图哈希、尺寸与有效版本。");
    maskBindings = clone(binding);
  } else if (input.maskBindings !== undefined || roles.maskImage) throw fail("COMFYUI_MASK_BINDING_INVALID", "当前 ComfyUI 能力没有受管蒙版输入。");
  return { inputs, metadata, maskBindings };
}

async function defaultRequest(url, options = {}) {
  const timeout = AbortSignal.timeout(30_000), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { ...options, signal, redirect: "manual", credentials: "omit" });
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    throw fail(response.status >= 300 && response.status < 400 ? "COMFYUI_REDIRECT_FORBIDDEN" : "COMFYUI_HTTP_ERROR", `ComfyUI 请求失败（${response.status}）。`, { status: response.status });
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > (options.maxBytes || MAX_WORKFLOW_BYTES * 4)) throw fail("COMFYUI_RESPONSE_TOO_LARGE", "ComfyUI 响应超过大小限制。");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks), contentType = String(response.headers.get("content-type") || "").toLowerCase();
  let body;
  if (contentType.includes("json")) { try { body = JSON.parse(bytes.toString("utf8")); } catch { throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 返回了无效 JSON。"); } }
  return { status: response.status, body, bytes, contentType };
}

function actualParameters(info, inputMetadata) {
  const nodes = info.workflow;
  if (!info.requiresCheckpoint) {
    const source = inputMetadata.find(item => item.role === "sourceImage");
    if (!source) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 抠图需要可冻结的来源尺寸。");
    return { model: "comfyui-mask", width: source.width, height: source.height, batchSize: 1 };
  }
  const samplerId = info.nodes.find((node) => node.classType === "KSampler")?.id;
  const modelId = info.nodes.find((node) => node.classType === "CheckpointLoaderSimple")?.id;
  const sampler = nodes[samplerId].inputs, latent = nodes[sampler.latent_image[0]];
  function dimensions(id) {
    const node = nodes[id];
    if (!node) return undefined;
    if (node.class_type === "EmptyLatentImage") return node.inputs;
    if (["LoadImage", "LoadImageMask"].includes(node.class_type)) {
      const mapping = info.inputMappings.find(item => imageMapping(item) && item.nodeId === id);
      return mapping ? inputMetadata[mappingInputIndex(mapping, inputMetadata)] : undefined;
    }
    if (["VAEEncode", "VAEEncodeForInpaint"].includes(node.class_type)) return dimensions(node.inputs.pixels[0]);
    if (node.class_type === "SetLatentNoiseMask") return dimensions(node.inputs.samples[0]);
    if (node.class_type === "ImageCompositeMasked") return dimensions(node.inputs.destination[0]);
    if (["JoinImageWithAlpha", "ImageToMask"].includes(node.class_type)) return dimensions(node.inputs.image[0]);
    if (["MaskToImage", "InvertMask"].includes(node.class_type)) return dimensions(node.inputs.mask[0]);
    return undefined;
  }
  const size = dimensions(sampler.latent_image[0]);
  if (!size || !size.width || !size.height) throw fail("COMFYUI_NODE_MAPPING_INVALID", "ComfyUI 首期模板需要可冻结的图片尺寸来源。");
  assertLiteral("dimension", size.width); assertLiteral("dimension", size.height);
  return { model: nodes[modelId].inputs.ckpt_name, seed: sampler.seed, width: size.width, height: size.height, batchSize: size.batch_size || 1, steps: sampler.steps, cfg: sampler.cfg, sampler: sampler.sampler_name, scheduler: sampler.scheduler, denoise: sampler.denoise };
}

function historyState(body, promptId) {
  if (!plain(body)) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 历史响应无效。", { promptId, unsafeToRetry: true });
  if (!own(body, promptId)) return { state: "unknown" };
  const record = body[promptId];
  if (!plain(record)) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 任务历史无效。", { promptId, unsafeToRetry: true });
  const status = record.status;
  const failed = ["error", "failed", "interrupted"].includes(status?.status_str) || (Array.isArray(status?.messages) && status.messages.some((item) => Array.isArray(item) && ["execution_error", "execution_interrupted"].includes(item[0])));
  if (failed) return { state: "failed", code: status?.status_str === "interrupted" ? "COMFYUI_EXECUTION_INTERRUPTED" : "COMFYUI_EXECUTION_FAILED", record };
  if (status?.completed === true || status?.status_str === "success" || (!status && plain(record.outputs))) return { state: "succeeded", record };
  return { state: "unknown", record };
}

function queueState(body, promptId, clientId) {
  if (!plain(body) || !Array.isArray(body.queue_pending) || !Array.isArray(body.queue_running)) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 队列响应无效。", { promptId, unsafeToRetry: true });
  const pending = body.queue_pending.filter((entry) => Array.isArray(entry) && entry[1] === promptId), running = body.queue_running.filter((entry) => Array.isArray(entry) && entry[1] === promptId);
  if (pending.length + running.length > 1) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 队列任务身份不唯一。", { promptId, unsafeToRetry: true });
  const entry = pending[0] || running[0];
  if (entry && clientId && entry[3]?.client_id !== clientId) throw fail("COMFYUI_TASK_OWNERSHIP_MISMATCH", "ComfyUI 任务连接身份与已冻结回执不一致。", { promptId, unsafeToRetry: true });
  return { state: running.length ? "running" : pending.length ? "queued" : "unknown", entry };
}

function verifyPromptTuple(tuple, snapshot, promptId) {
  if (!Array.isArray(tuple) || !plain(tuple[2]) || tuple[1] !== promptId || (snapshot.clientId && tuple[3]?.client_id !== snapshot.clientId) || (snapshot.workflowHash && stableHash(tuple[2]) !== snapshot.workflowHash)) throw fail("COMFYUI_TASK_OWNERSHIP_MISMATCH", "ComfyUI 任务历史与已冻结提交不一致。", { promptId, unsafeToRetry: true });
}

function createComfyUiExecutor(options = {}) {
  const transport = options.request || defaultRequest;
  const submissions = new Map(), receipts = new Map(), active = new Map();
  function connectionFor(value = {}) {
    const service = options.connectionService;
    if (!service) return null;
    if (value?.connection && value.connection.networkScope) return value.connection;
    if (value?.connectionProfile && value.connectionProfile.networkScope) return value.connectionProfile;
    return service.resolve(value?.connectionId || value?.profileId ? { connectionId: value.connectionId || value.profileId, baseUrl: value.baseUrl } : { baseUrl: value.baseUrl });
  }
  async function authorizeRequest(url, config = {}) {
    const service = options.connectionService;
    const connection = config.connection || (config.connectionId || config.baseUrl ? connectionFor(config) : null);
    if (!connection || !service) { localBaseUrl(new URL(url).origin); return { connection: null, headers: config.headers || {}, tls: undefined }; }
    const policy = service.requestPolicy(connection);
    policy.authorizeUrl(url, { kind: config.kind === "ws" ? "ws" : "http", redirect: config.redirect === true });
    const credentials = service.credentialHeaders(connection);
    return { connection, headers: { ...credentials.headers, ...(config.headers || {}) }, tls: credentials.tls };
  }
  async function request(url, config = {}) {
    const authorized = await authorizeRequest(url, config);
    const response = await transport(url, { ...config, connection: authorized.connection, headers: authorized.headers, redirect: "manual", credentials: "omit", ...(authorized.tls ? { tls: authorized.tls } : {}) });
    if (Number.isFinite(response?.status) && (response.status < 200 || response.status >= 300)) throw fail(response.status >= 300 && response.status < 400 ? "COMFYUI_REDIRECT_FORBIDDEN" : "COMFYUI_HTTP_ERROR", `ComfyUI 请求失败（${response.status}）。`, { status: response.status });
    return response || {};
  }
  async function inspectInternal(baseUrl, config = {}) {
    const connection = config.connection || connectionFor({ ...config, baseUrl });
    const base = connection?.baseUrl || localBaseUrl(baseUrl);
    const [stats, objects] = await Promise.all([request(endpoint(base, "/system_stats"), { signal: config.signal, connection }), request(endpoint(base, "/object_info"), { signal: config.signal, connection })]);
    if (!plain(stats.body) || !plain(objects.body)) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 未返回有效的本机服务信息。");
    const capabilities = normalizeCapabilities(objects.body, stats.body);
    return { baseUrl: base, objectInfo: objects.body, capabilities, ...capabilities };
  }
  async function inspect(baseUrl, config = {}) {
    const inspected = await inspectInternal(baseUrl, config);
    return { baseUrl: inspected.baseUrl, capabilities: inspected.capabilities, ...inspected.capabilities };
  }

  function progressSocket(base, clientId, onStatus, signal, connection) {
    const factory = options.wsFactory || (typeof WebSocket === "function" ? (url) => new WebSocket(url) : undefined);
    if (!factory || typeof onStatus !== "function") return { bind() {}, close() {} };
    let ws, promptId, closed = false;
    const pending = [];
    const close = () => { if (closed) return; closed = true; signal?.removeEventListener("abort", close); try { ws?.close?.(); } catch {} };
    function handle(event) {
      if (closed) return;
      let message = event?.data ?? event;
      if (typeof message !== "string") return; // Binary previews are never final assets.
      try { message = JSON.parse(message); } catch { return; }
      if (!plain(message) || !plain(message.data)) return;
      if (!promptId) { if (pending.length < 64) pending.push(message); return; }
      deliver(message);
    }
    function deliver(message) {
      const payload = message.data;
      // Global/old progress lacking prompt_id cannot be safely attributed.
      if (payload.prompt_id !== promptId || !["execution_start", "executing", "execution_cached", "progress", "execution_success", "execution_error", "execution_interrupted"].includes(message.type)) return;
      const status = { type: message.type, promptId };
      if (typeof payload.node === "string" && ID_RE.test(payload.node)) status.node = payload.node;
      if (message.type === "progress") {
        if (!Number.isFinite(payload.value) || !Number.isFinite(payload.max) || payload.value < 0 || payload.max <= 0 || payload.value > payload.max) return;
        status.progress = payload.value; status.max = payload.max;
      }
      try { onStatus(status); } catch {}
    }
    try {
      const url = endpoint(base.replace(/^http/, "ws"), "/ws", { clientId });
      let wsOptions = { followRedirects: false };
      if (connection && options.connectionService) {
        const policy = options.connectionService.requestPolicy(connection);
        policy.authorizeUrl(url, { kind: "ws" });
        const credentials = options.connectionService.credentialHeaders(connection);
        wsOptions = { ...wsOptions, connection, headers: credentials.headers, ...(credentials.tls || {}) };
      }
      ws = factory(url.toString(), wsOptions);
      if (typeof ws.addEventListener === "function") { ws.addEventListener("message", handle); ws.addEventListener("error", () => {}); }
      else if (typeof ws.on === "function") { ws.on("message", (data, binary) => { if (!binary) handle({ data: data.toString() }); }); ws.on("error", () => {}); }
      else { ws.onmessage = handle; ws.onerror = () => {}; }
      signal?.addEventListener("abort", close, { once: true });
    } catch { close(); }
    return { bind(id) { promptId = id; for (const message of pending.splice(0)) deliver(message); }, close };
  }

  async function download(state, snapshot, signal) {
    const images = state.record?.outputs?.[snapshot.outputNodeId]?.images;
    if (!Array.isArray(images) || !images.length || images.length > 4) throw fail("COMFYUI_OUTPUT_INVALID", "ComfyUI 指定成果节点没有有效图片。", { promptId: snapshot.promptId, unsafeToRetry: true });
    const descriptors = images.map((image) => {
      if (!plain(image) || !relativeFile(image.filename, { basename: true }) || !relativeFile(image.subfolder ?? "", { empty: true }) || image.type !== "output") throw fail("COMFYUI_OUTPUT_INVALID", "ComfyUI 指定成果节点返回了无效文件身份。", { promptId: snapshot.promptId, unsafeToRetry: true });
      return { filename: image.filename, subfolder: image.subfolder || "", type: "output" };
    });
    const output = []; let total = 0;
    for (const descriptor of descriptors) {
      const response = await request(endpoint(snapshot.baseUrl, "/view", descriptor), { ...snapshot, signal, maxBytes: MAX_IMAGE_BYTES }), bytes = response.bytes;
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES || (total += bytes.length) > MAX_IMAGE_BYTES * 2) throw fail("COMFYUI_OUTPUT_INVALID", "ComfyUI 输出图片为空或超过大小限制。", { promptId: snapshot.promptId, unsafeToRetry: true });
      let dimensions;
      try { dimensions = imageInfo(bytes); } catch { throw fail("COMFYUI_OUTPUT_INVALID", "ComfyUI 输出不是有效图片。", { promptId: snapshot.promptId, unsafeToRetry: true }); }
      if (snapshot.actualParams && (dimensions.width !== snapshot.actualParams.width || dimensions.height !== snapshot.actualParams.height)) throw fail("COMFYUI_OUTPUT_INVALID", "ComfyUI 输出尺寸与冻结任务不一致。", { promptId: snapshot.promptId, unsafeToRetry: true });
      output.push({ type: "base64", value: bytes.toString("base64"), ...dimensions, filename: descriptor.filename, subfolder: descriptor.subfolder });
    }
    const actualParams = snapshot.actualParams ? { ...snapshot.actualParams, protocol: "comfyui", connectionId: snapshot.connectionId, networkScope: snapshot.networkScope || "local", size: `${snapshot.actualParams.width}x${snapshot.actualParams.height}` } : undefined;
    return { ok: true, state: "succeeded", provider: "comfyui", protocol: "comfyui", model: snapshot.actualParams?.model || "comfyui-local", promptId: snapshot.promptId, workflowHash: snapshot.workflowHash,
      ...(snapshot.capability ? { capability: snapshot.capability, alphaRequired: snapshot.capability === "cutout" || snapshot.alphaRequired === true } : {}), actualParams, images: output, data: output.map((image) => ({ b64_json: image.value, mime_type: image.mimeType })) };
  }

  function recoverySnapshot(input) {
    const saved = input.accepted || receipts.get(input.promptId) || {};
    const connection = connectionFor({ ...saved, ...input, connectionId: input.connectionId || saved.connectionId });
    const baseUrl = connection?.baseUrl || localBaseUrl(input.baseUrl || saved.baseUrl), promptId = input.promptId || saved.promptId;
    if (saved.connectionHash && (!connection || saved.connectionHash !== connectionHash(connection))) throw fail("COMFYUI_TASK_OWNERSHIP_MISMATCH", "ComfyUI 连接配置与原任务不一致。", { unsafeToRetry: true });
    if ((promptId !== undefined && (typeof promptId !== "string" || !ID_RE.test(promptId))) || (!promptId && (!ID_RE.test(saved.submissionId || "") || !saved.clientId || !/^[a-f0-9]{64}$/.test(saved.workflowHash || "")))) throw fail("COMFYUI_PROMPT_ID_REQUIRED", "缺少有效的 ComfyUI 回执或未知提交快照。");
    if ((saved.promptId && saved.promptId !== promptId) || (saved.baseUrl && saved.baseUrl !== baseUrl) || (saved.connectionId && connection?.id !== saved.connectionId) || (input.outputNodeId && saved.outputNodeId && input.outputNodeId !== saved.outputNodeId) || (input.clientId && saved.clientId && input.clientId !== saved.clientId)) throw fail("COMFYUI_TASK_OWNERSHIP_MISMATCH", "ComfyUI 恢复身份与已冻结回执不一致。", { promptId, unsafeToRetry: true });
    const outputNodeId = saved.outputNodeId || input.outputNodeId;
    if (typeof outputNodeId !== "string" || !ID_RE.test(outputNodeId)) throw fail("COMFYUI_NODE_MAPPING_INVALID", "恢复 ComfyUI 任务需要原成果节点映射。", { promptId, unsafeToRetry: true });
    // Legacy receipts keep their original URL identity when persisting a
    // recovered acknowledgement; introducing an ID here would invalidate the
    // historical journal's model-access identity on its next recovery.
    return { ...clone(saved), baseUrl, ...(connection?.id && (saved.connectionId || !saved.baseUrl) ? { connectionId: connection.id, networkScope: connection.networkScope } : {}), promptId, outputNodeId, clientId: saved.clientId || input.clientId, actualParams: saved.actualParams || input.actualParams, workflowHash: saved.workflowHash || input.workflowHash };
  }

  async function recoverInternal(input = {}) {
    const snapshot = recoverySnapshot(input);
    if (!snapshot.promptId) {
      // An acknowledgement can be lost after enqueueing. The per-submission
      // client id plus exact submitted workflow hash is the only lookup key;
      // neither a prompt POST nor a fuzzy text/model match is permitted here.
      const queue = await request(endpoint(snapshot.baseUrl, "/queue"), { ...snapshot, signal: input.signal });
      queueState(queue.body, "", ""); // Validate the response before scanning.
      let candidates = [...queue.body.queue_pending, ...queue.body.queue_running].filter((entry) => Array.isArray(entry) && entry[3]?.client_id === snapshot.clientId);
      if (!candidates.length) {
        const all = await request(endpoint(snapshot.baseUrl, "/history", { max_items: 500 }), { ...snapshot, signal: input.signal });
        if (!plain(all.body) || Object.keys(all.body).length > 500) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 恢复历史响应无效。", { unsafeToRetry: true });
        candidates = Object.values(all.body).map((record) => record?.prompt).filter((entry) => Array.isArray(entry) && entry[3]?.client_id === snapshot.clientId);
      }
      if (!candidates.length) return { ok: false, state: "unknown", pending: false, unknown: true, unsafeToRetry: true, images: [] };
      if (candidates.length !== 1) throw fail("COMFYUI_AMBIGUOUS_RECOVERY", "ComfyUI 恢复匹配不唯一；未重新提交。", { unsafeToRetry: true });
      const promptId = candidates[0][1];
      if (typeof promptId !== "string" || !ID_RE.test(promptId)) throw fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 恢复任务标识无效。", { unsafeToRetry: true });
      verifyPromptTuple(candidates[0], snapshot, promptId);
      const persistAccepted = input.persistAccepted || options.persistAccepted;
      if (typeof persistAccepted !== "function") throw fail("COMFYUI_PERSISTENCE_REQUIRED", "找回 ComfyUI 任务需要 Main 持久化回执。", { promptId, unsafeToRetry: true });
      Object.assign(snapshot, { promptId, acceptedAt: new Date().toISOString(), recovered: true });
      receipts.set(promptId, clone(snapshot));
      try { await persistAccepted(clone(snapshot)); } catch (cause) { throw fail("COMFYUI_ACCEPTED_PERSIST_FAILED", "ComfyUI 找回任务，但回执保存失败。", { promptId, accepted: clone(snapshot), cause, unsafeToRetry: true }); }
    }
    const history = await request(endpoint(snapshot.baseUrl, `/history/${encodeURIComponent(snapshot.promptId)}`), { ...snapshot, signal: input.signal }), state = historyState(history.body, snapshot.promptId);
    if (state.record && snapshot.clientId) verifyPromptTuple(state.record.prompt, snapshot, snapshot.promptId);
    if (state.state === "failed") return { ok: false, state: "failed", failed: true, promptId: snapshot.promptId, code: state.code, unsafeToRetry: true, images: [] };
    if (state.state === "succeeded") return download(state, snapshot, input.signal);
    const queue = await request(endpoint(snapshot.baseUrl, "/queue"), { ...snapshot, signal: input.signal }), queued = queueState(queue.body, snapshot.promptId, snapshot.clientId);
    return { ok: false, state: queued.state, pending: queued.state !== "unknown", unknown: queued.state === "unknown", promptId: snapshot.promptId, unsafeToRetry: true, images: [] };
  }

  async function recover(input = {}) {
    try { return await recoverInternal(input); } catch (cause) {
      const promptId = input.promptId || input.accepted?.promptId;
      if (typeof cause?.code === "string" && /^COMFYUI_/.test(cause.code)) throw Object.assign(cause, { unsafeToRetry: true, ...(promptId ? { promptId } : {}) });
      throw fail(input.signal?.aborted ? "ABORT_ERR" : "COMFYUI_QUERY_FAILED", input.signal?.aborted ? "ComfyUI 等待已取消；原任务保留供恢复。" : "ComfyUI 原任务查询暂未完成；不会重新提交。", { promptId, unsafeToRetry: true, cause });
    }
  }

  async function execute(input, info, sampling, inputs, inputMetadata, submissionId, base) {
    const signal = input.signal;
    const connection = connectionFor(input);
    if (signal?.aborted) throw fail("ABORT_ERR", "ComfyUI 操作已取消。", { ambiguous: false, unsafeToRetry: false });
    const persistAccepted = input.persistAccepted || options.persistAccepted;
    const persistPrepared = input.persistPrepared || options.persistPrepared;
    if (typeof persistAccepted !== "function" || typeof persistPrepared !== "function") throw fail("COMFYUI_PERSISTENCE_REQUIRED", "ComfyUI 提交必须连接 Main 持久化准备记录与回执。");
    // run() froze these reviewed controls before starting any asynchronous
    // work. Unmapped and fixed-value ports keep their canonical template value.
    const workflow = info.workflow, fields = { prompt: input.prompt, negative: input.negativePrompt, model: input.checkpoint, seed: input.seed, width: input.width, height: input.height,
      ...sampling };
    for (const mapping of info.inputMappings) {
      if (imageMapping(mapping)) continue;
      const value = own(mapping, "value") ? mapping.value : fields[mapping.kind];
      if (value !== undefined) workflow[mapping.nodeId].inputs[mapping.inputName] = value;
    }
    for (const node of Object.values(workflow)) if (node.class_type === "KSampler" && node.inputs.seed === -1) node.inputs.seed = randomBytes(6).readUIntBE(0, 6);
    const materialized = normalizeWorkflow(workflow, info), actualParams = actualParameters(materialized, inputMetadata);
    const inspected = await inspectInternal(base, { signal, connection });
    validateDependencies(materialized, inspected.objectInfo);
    const uploaded = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const extension = inputMetadata[index].mimeType === "image/jpeg" ? "jpg" : inputMetadata[index].mimeType.split("/")[1], form = new FormData();
      form.append("image", new Blob([inputs[index]], { type: inputMetadata[index].mimeType }), `sparkai-${submissionId}-${index}.${extension}`);
      form.append("overwrite", "false"); form.append("type", "input");
      const response = await request(endpoint(base, "/upload/image"), { method: "POST", body: form, signal, connection }), result = response.body;
      if (!plain(result) || !relativeFile(result.name, { basename: true }) || !relativeFile(result.subfolder ?? "", { empty: true }) || result.type !== "input") throw fail("COMFYUI_UPLOAD_INVALID", "ComfyUI 上传未返回有效输入文件身份。");
      uploaded.push({ name: result.name, subfolder: result.subfolder || "", type: "input" });
    }
    for (const mapping of materialized.inputMappings.filter(imageMapping)) {
      const item = uploaded[mappingInputIndex(mapping, inputMetadata)]; workflow[mapping.nodeId].inputs[mapping.inputName] = item.subfolder ? `${item.subfolder}/${item.name}` : item.name;
    }
    const snapshot = { schemaVersion: ["inpaint", "cutout"].includes(info.capability) ? 3 : 2, submissionId, baseUrl: base, ...(connection?.id ? { connectionId: connection.id, networkScope: connection.networkScope, connectionHash: connectionHash(connection) } : {}), clientId: `sparkai-${randomUUID()}`, outputNodeId: info.outputNodeId, inputNodeId: info.inputNodeId, inputMappings: clone(info.inputMappings), workflowHash: stableHash(workflow), actualParams,
      capability: info.capability, alphaRequired: info.alphaRequired, requiresCheckpoint: info.requiresCheckpoint, ...(input.maskBindings ? { maskBindings: clone(input.maskBindings) } : {}),
      ...(input.templateId ? { templateId: input.templateId, templateVersion: input.templateVersion, templateHash: input.templateHash, policyVersion: input.policyVersion } : {}),
      ...(inspected.capabilitiesHash ? { capabilitiesHash: inspected.capabilitiesHash } : {}), inputs: inputMetadata.map((item, index) => ({ ...item, uploaded: uploaded[index] })), preparedAt: new Date().toISOString() };
    await persistPrepared(clone(snapshot));
    if (signal?.aborted) throw fail("ABORT_ERR", "ComfyUI 操作已取消。", { ambiguous: false, unsafeToRetry: false });
    const socket = progressSocket(base, snapshot.clientId, input.onStatus, signal, connection);
    let response;
    try {
      response = await request(endpoint(base, "/prompt"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: snapshot.clientId }), signal, connection });
    } catch (cause) {
      socket.close();
      const rejected = Number.isInteger(cause?.status) && cause.status >= 400 && cause.status < 500 && cause.status !== 408;
      throw fail(rejected ? "COMFYUI_PROMPT_REJECTED" : "COMFYUI_SUBMISSION_UNKNOWN", rejected ? "ComfyUI 明确拒绝了本次提交。" : "ComfyUI 提交结果未知；不会自动重发。", { status: cause?.status, ambiguous: !rejected, unsafeToRetry: !rejected, snapshot: clone(snapshot), cause });
    }
    const promptId = response.body?.prompt_id;
    if (typeof promptId !== "string" || !ID_RE.test(promptId)) {
      socket.close();
      throw fail("COMFYUI_SUBMISSION_UNKNOWN", "ComfyUI 没有返回有效回执；不会自动重发。", { ambiguous: true, unsafeToRetry: true, snapshot: clone(snapshot) });
    }
    const accepted = { ...snapshot, promptId, acceptedAt: new Date().toISOString() };
    receipts.set(promptId, clone(accepted));
    try { await persistAccepted(clone(accepted)); } catch (cause) {
      socket.close();
      throw fail("COMFYUI_ACCEPTED_PERSIST_FAILED", "ComfyUI 已接受任务，但回执保存失败；不会重新提交。", { promptId, unsafeToRetry: true, accepted: clone(accepted), cause });
    }
    socket.bind(promptId);
    try { input.onAccepted?.({ taskId: promptId, promptId, workflowHash: accepted.workflowHash, actualParams: clone(actualParams), accepted: clone(accepted) }); } catch {}
    active.set(promptId, { baseUrl: base, clientId: accepted.clientId, outputNodeId: accepted.outputNodeId });
    try {
      const deadline = Date.now() + Math.max(50, Math.min(30 * 60_000, Number(input.maxWaitMs) || 10 * 60_000));
      while (Date.now() < deadline) {
        if (signal?.aborted) throw fail("ABORT_ERR", "ComfyUI 等待已取消；原任务保留供恢复。", { promptId, unsafeToRetry: true });
        const result = await recover({ accepted, signal });
        if (result.ok) return result;
        if (result.state === "failed") throw fail(result.code, "ComfyUI 已记录本任务执行失败。", { promptId, unsafeToRetry: true });
        const interval = Math.max(10, Math.min(5000, Number(input.pollIntervalMs) || 500));
        await new Promise((resolve) => {
          const timer = setTimeout(done, Math.min(interval, Math.max(1, deadline - Date.now())));
          function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
          signal?.addEventListener("abort", done, { once: true });
        });
      }
      throw fail("COMFYUI_TIMEOUT", "ComfyUI 等待超时；请恢复原任务，不要重新提交。", { promptId, unsafeToRetry: true });
    } finally { socket.close(); active.delete(promptId); }
  }

  function run(input = {}) {
    try {
      const connection = connectionFor(input);
      const base = connection?.baseUrl || localBaseUrl(input.baseUrl), submissionId = input.submissionId || input.operationId;
      if (typeof submissionId !== "string" || !ID_RE.test(submissionId)) throw fail("COMFYUI_SUBMISSION_ID_REQUIRED", "ComfyUI 提交需要稳定的操作标识。");
      if (own(input, "extraPrompt")) throw fail("COMFYUI_WORKFLOW_INVALID", "ComfyUI 首期不接受未审核的附加执行参数。");
      const templateId = normalizeComfyUiWorkflowReference(input);
      const info = normalizeWorkflow(input.workflow, input);
      validateTemplateIdentity(info, input);
      const normalizedInputs = normalizeInputs(info, input), inputs = normalizedInputs.inputs, inputMetadata = normalizedInputs.metadata;
      const metadata = templateSamplingMetadata(info);
      const sampling = Object.freeze(normalizeComfyUiSamplingParameters(input, metadata));
      const signature = stableHash({ base, ...(connection ? { connectionHash: connectionHash(connection) } : {}), workflow: info.workflow, inputMappings: info.inputMappings, outputNodeId: info.outputNodeId, inputMetadata,
        templateHash: input.templateHash, policyVersion: input.policyVersion, capability: info.capability, ...(normalizedInputs.maskBindings ? { maskBindings: normalizedInputs.maskBindings } : {}),
        fields: { prompt: input.prompt, negativePrompt: input.negativePrompt, checkpoint: input.checkpoint, seed: input.seed, width: input.width, height: input.height, ...sampling } });
      const existing = submissions.get(submissionId);
      if (existing) {
        if (existing.signature !== signature) throw fail("COMFYUI_SUBMISSION_CONFLICT", "相同 ComfyUI 操作标识不能提交不同内容。");
        return existing.promise;
      }
      if (submissions.size >= 500) throw fail("COMFYUI_CAPACITY", "ComfyUI 本地提交回执已达容量上限。");
      const frozenInput = Object.freeze({ ...input, ...(templateId ? { templateId, workflowId: templateId } : {}), ...(normalizedInputs.maskBindings ? { maskBindings: Object.freeze(normalizedInputs.maskBindings) } : {}), ...(connection ? { connection } : {}), ...sampling,
        defaults: Object.freeze({ ...metadata.defaults }), exposedInputs: Object.freeze([...metadata.exposedInputs]) });
      const promise = execute(frozenInput, info, sampling, inputs, inputMetadata, submissionId, base);
      submissions.set(submissionId, { signature, promise });
      return promise;
    } catch (error) { return Promise.reject(error); }
  }

  async function cancel(input = {}) {
    const snapshot = recoverySnapshot(input), { baseUrl, promptId, clientId } = snapshot;
    if (!promptId) throw fail("COMFYUI_PROMPT_ID_REQUIRED", "取消 ComfyUI 任务需要先找回原任务回执。", { unsafeToRetry: true });
    if (typeof clientId !== "string" || !clientId) throw fail("COMFYUI_TASK_OWNERSHIP_MISMATCH", "取消 ComfyUI 任务需要原客户端回执。", { promptId, unsafeToRetry: true });
    const before = await request(endpoint(baseUrl, "/queue"), { ...snapshot, signal: input.signal }), state = queueState(before.body, promptId, clientId);
    if (state.state === "running") throw fail("COMFYUI_CANCEL_UNSUPPORTED", "当前 ComfyUI 未提供经验证的定向运行中断；不会调用全局中断。", { promptId, unsafeToRetry: true });
    if (state.state !== "queued") throw fail("COMFYUI_CANCEL_NOT_QUEUED", "未在 ComfyUI 队列中确认本任务；未执行删除。", { promptId, unsafeToRetry: true });
    await request(endpoint(baseUrl, "/queue"), { ...snapshot, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [promptId] }), signal: input.signal });
    const after = await request(endpoint(baseUrl, "/queue"), { ...snapshot, signal: input.signal }), observed = queueState(after.body, promptId, clientId);
    if (observed.state !== "unknown") throw fail("COMFYUI_CANCEL_NOT_CONFIRMED", observed.state === "running" ? "本任务已开始运行；排队删除未能取消它。" : "ComfyUI 未确认本任务已离开队列。", { promptId, state: observed.state, unsafeToRetry: true });
    const history = await request(endpoint(baseUrl, `/history/${encodeURIComponent(promptId)}`), { ...snapshot, signal: input.signal }), finished = historyState(history.body, promptId);
    if (finished.state !== "unknown") return { ok: false, canceled: false, state: finished.state, promptId };
    return { ok: true, canceled: true, state: "canceled", phase: "queued", promptId };
  }

  return { inspect, normalizeWorkflow, run, recover, cancel, localBaseUrl, active };
}

module.exports = { CORE_NODES, LOCAL_HOSTS, createComfyUiExecutor, inspectWorkflowGraph, normalizeWorkflow, validateDependencies, normalizeCapabilities, templateSamplingMetadata, templateHashFor, localBaseUrl, stableHash, connectionHash };
