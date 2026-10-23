export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const fail = (code, message) => Object.assign(new Error(message), { code });

// These are the only sampler controls that can cross the desktop/runtime
// boundary.  A template still has to expose a mapping for a control before
// it can be changed; keeping the range here gives GUI, IPC and runtime one
// source of truth.
export const COMFYUI_SAMPLING_FIELDS = Object.freeze(["steps", "cfg", "sampler", "scheduler", "denoise"]);
export const COMFYUI_PARAMETER_RANGES = Object.freeze({
  steps: Object.freeze({ min: 1, max: 150, step: 1 }),
  cfg: Object.freeze({ min: 0, max: 30, step: 0.1 }),
  denoise: Object.freeze({ min: 0, max: 1, step: 0.01 })
});
const SHORT_VALUE_RE = /^[A-Za-z0-9_. -]{1,100}$/;
const PRIVATE_LABEL_RE = /bearer|api[ _-]?key|authorization|password|secret|token|cookie/i;
const CONNECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const COMFYUI_WORKFLOW_CAPABILITIES = Object.freeze(["generate", "img2img", "inpaint", "cutout"]);
const WORKFLOW_ID_RE = /^[a-z0-9_.-]{1,120}$/i;

export function normalizeComfyUiConnectionReference(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("COMFYUI_CONNECTION_PROFILE_INVALID", "ComfyUI 连接标识无效。");
  const references = [];
  for (const field of ["connectionId", "profileId"]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !CONNECTION_ID_RE.test(input[field])) throw fail("COMFYUI_CONNECTION_PROFILE_INVALID", "ComfyUI 连接标识无效。");
    references.push(input[field]);
  }
  if (references.length > 1 && references[0] !== references[1]) throw fail("COMFYUI_CONNECTION_PROFILE_INVALID", "connectionId 与 profileId 必须指向同一 ComfyUI 连接。");
  return references[0];
}

export function normalizeComfyUiWorkflowReference(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("COMFYUI_TEMPLATE_CHANGED", "ComfyUI 工作流标识无效。");
  const refs = [];
  for (const field of ["templateId", "workflowId"]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !WORKFLOW_ID_RE.test(input[field])) throw fail("COMFYUI_TEMPLATE_CHANGED", "ComfyUI 工作流标识无效。");
    refs.push(input[field]);
  }
  if (refs.length > 1 && refs[0] !== refs[1]) throw fail("COMFYUI_TEMPLATE_CHANGED", "workflowId 与 templateId 必须指向同一工作流。");
  return refs[0];
}

function materialReference(value, mask = false) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["assetId", "occurrenceId", "contentHash", ...(mask ? ["revision"] : [])].includes(key)) ||
    !["assetId", "occurrenceId"].every(key => typeof value[key] === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value[key])) || !/^[a-f0-9]{64}$/.test(value.contentHash || "")) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 素材必须使用稳定的项目身份。");
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 1)) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 蒙版版本无效。");
  return { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash, ...(value.revision === undefined ? {} : { revision: value.revision }) };
}

export function isComfyUiSamplingChoice(value) {
  return typeof value === "string" && value.length <= 100 && SHORT_VALUE_RE.test(value.trim()) && !PRIVATE_LABEL_RE.test(value);
}

export function isComfyUiModelName(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\u0000-\u001f\u007f:%?#=]/.test(value) || /^[\\/]/.test(value) || PRIVATE_LABEL_RE.test(value)) return false;
  return value.split(/[\\/]/).every(part => part && part !== "." && part !== ".." && !/[.\s]$/.test(part));
}

export function localBaseUrl(value) {
  const text = value === undefined || value === "" ? "http://127.0.0.1:8188" : value;
  if (typeof text !== "string" || text.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(text)) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。");
  let parsed;
  try { parsed = new URL(text); } catch { throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。"); }
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) throw fail("COMFYUI_LOCAL_ONLY", "ComfyUI 首期只允许本机 localhost 服务。");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址不能包含凭据、参数或代理路径。");
  return parsed.origin;
}

// Main resolves and authorizes LAN/remote profiles before this normalizer is
// called.  Runtime still rejects URL credentials, queries and fragments so a
// profile reference can never smuggle an alternate target across the boundary.
export function profileBaseUrl(value, hasConnection = false) {
  if (!hasConnection) return localBaseUrl(value);
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。");
  let parsed;
  try { parsed = new URL(value); } catch { throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。"); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址不能包含凭据、参数或片段。");
  if (parsed.pathname !== "/" && parsed.pathname.split("/").some(part => part === "." || part === "..")) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址路径无效。");
  return parsed.origin + (parsed.pathname === "/" ? "" : `/${parsed.pathname.replace(/^\/+|\/+$/g, "")}/`);
}

function templateExposes(template, field) {
  if (!template || typeof template !== "object") return true;
  if (Array.isArray(template.inputMappings) && !template.inputMappings.some(mapping => mapping?.kind === field && !Object.prototype.hasOwnProperty.call(mapping, "value"))) return false;
  if (Array.isArray(template.exposedInputs)) return template.exposedInputs.includes(field);
  if (Array.isArray(template.inputMappings)) return true;
  return true;
}

function normalizeSamplingParameters(input, template) {
  if (input.strength !== undefined && input.denoise !== undefined && input.strength !== input.denoise) throw fail("COMFYUI_PARAMETERS_INVALID", "strength 与 denoise 不能设置为不同值。");
  const controls = input.strength === undefined ? input : { ...input, denoise: input.strength };
  const result = {};
  const defaults = template && typeof template.defaults === "object" && !Array.isArray(template.defaults) ? template.defaults : {};
  for (const field of COMFYUI_SAMPLING_FIELDS) {
    let value = controls?.[field];
    if (value === undefined && templateExposes(template, field) && defaults[field] !== undefined) value = defaults[field];
    if (value === undefined) continue;
    if (!templateExposes(template, field)) throw fail("COMFYUI_PARAMETER_UNSUPPORTED", `当前 ComfyUI 模板不支持参数 ${field}。`);
    if (field === "steps") {
      if (!Number.isInteger(value) || value < COMFYUI_PARAMETER_RANGES.steps.min || value > COMFYUI_PARAMETER_RANGES.steps.max) throw fail("COMFYUI_PARAMETERS_INVALID", "采样步数须为 1–150 的整数。");
    } else if (field === "cfg") {
      if (!Number.isFinite(value) || value < COMFYUI_PARAMETER_RANGES.cfg.min || value > COMFYUI_PARAMETER_RANGES.cfg.max) throw fail("COMFYUI_PARAMETERS_INVALID", "CFG 须为 0–30 的数字。");
    } else if (field === "denoise") {
      if (!Number.isFinite(value) || value < COMFYUI_PARAMETER_RANGES.denoise.min || value > COMFYUI_PARAMETER_RANGES.denoise.max) throw fail("COMFYUI_PARAMETERS_INVALID", "去噪强度须为 0–1。");
    } else {
      if (!isComfyUiSamplingChoice(value)) throw fail("COMFYUI_PARAMETERS_INVALID", `${field} 参数无效。`);
      value = value.trim();
    }
    result[field] = value;
  }
  return result;
}

export function normalizeComfyUiSamplingParameters(input, template) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("COMFYUI_PARAMETERS_INVALID", "ComfyUI 采样参数无效。");
  return normalizeSamplingParameters(input, template);
}

export function normalizeComfyUiTaskOptions(input, template) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["templateId", "workflowId", "templateHash", "baseUrl", "connectionId", "profileId", "networkScope", "checkpoint", "seed", "width", "height", "prompt", "negativePrompt", "strength", "sourceImage", "maskImage", "referenceImages", ...COMFYUI_SAMPLING_FIELDS].includes(key))) throw fail("COMFYUI_REQUEST_INVALID", "本地生图只接受模板与已审核输入。");
  const templateId = normalizeComfyUiWorkflowReference(input);
  if (!templateId || !/^[a-f0-9]{64}$/.test(input.templateHash || "")) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板标识无效，请重新选择后提交。");
  // Draft/session normalization has no authoritative template. Main supplies
  // the reviewed template before execution and enforces its model contract.
  const requiresCheckpoint = Boolean(template) && template.requiresCheckpoint !== false;
  if ((requiresCheckpoint || input.checkpoint !== undefined) && !isComfyUiModelName(input.checkpoint)) throw fail("COMFYUI_MODEL_REQUIRED", "请选择本机模型目录中的 checkpoint 名称。");
  const seed = input.seed ?? -1, width = input.width ?? 1024, height = input.height ?? 1024;
  const validDimensions = requiresCheckpoint ? [width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 8 === 0)
    : [width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 16384) && width * height <= 64 * 1024 * 1024;
  if (!Number.isSafeInteger(seed) || seed < -1 || !validDimensions) throw fail("COMFYUI_PARAMETERS_INVALID", "种子或画幅不符合当前工作流的安全范围。");
  const negativePrompt = input.negativePrompt ?? "";
  if (typeof negativePrompt !== "string" || negativePrompt.length > 16_384 || negativePrompt.includes("\0")) throw fail("COMFYUI_PARAMETERS_INVALID", "负面提示词无效。");
  if (input.prompt !== undefined && (typeof input.prompt !== "string" || input.prompt.length > 16_384 || input.prompt.includes("\0"))) throw fail("COMFYUI_PARAMETERS_INVALID", "提示词无效。");
  const materials = {};
  for (const role of ["sourceImage", "maskImage"]) if (input[role] !== undefined) materials[role] = materialReference(input[role], role === "maskImage");
  if (input.referenceImages !== undefined) {
    if (!Array.isArray(input.referenceImages) || input.referenceImages.length > 4) throw fail("COMFYUI_INPUT_INVALID", "ComfyUI 最多支持四张参考素材。");
    materials.referenceImages = input.referenceImages.map(value => materialReference(value));
  }
  // Legacy indexed templates receive materials through Main's historical
  // outer-input path. Typed mappings instead own an explicit, complete set
  // of reference slots in this public contract.
  const referenceMappings = Array.isArray(template?.inputMappings) ? template.inputMappings.filter(mapping => mapping?.kind === "referenceImages") : [];
  const referenceCount = new Set(referenceMappings.map(mapping => mapping.index)).size;
  if (referenceCount > 0 && materials.referenceImages?.length !== referenceCount) throw fail("COMFYUI_INPUT_INVALID", `当前 ComfyUI 工作流需要恰好 ${referenceCount} 张参考素材。`);
  const connectionId = normalizeComfyUiConnectionReference(input);
  if (input.networkScope !== undefined && !["local", "lan", "remote"].includes(input.networkScope)) throw fail("COMFYUI_CONNECTION_SCOPE_INVALID", "ComfyUI 连接网络范围无效。");
  return { templateId, workflowId: templateId, templateHash: input.templateHash, ...(connectionId ? { connectionId } : {}), ...(input.networkScope ? { networkScope: input.networkScope } : {}), ...(!connectionId || input.baseUrl !== undefined ? { baseUrl: profileBaseUrl(input.baseUrl, Boolean(connectionId)) } : {}), ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }), seed, width, height, negativePrompt,
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }), ...materials, ...normalizeSamplingParameters(input, template) };
}

export function normalizeComfyUiGenerationMetadata(value) {
  if (!value || typeof value !== "object" || value.protocol !== "comfyui") return {};
  const result = { protocol: "comfyui" };
  if (typeof value.connectionId === "string" && CONNECTION_ID_RE.test(value.connectionId)) result.connectionId = value.connectionId;
  result.networkScope = value.networkScope === undefined ? "local" : ["local", "lan", "remote"].includes(value.networkScope) ? value.networkScope : "unknown";
  for (const field of ["seed", "steps", "cfg", "denoise"]) {
    const numeric = value[field];
    const range = COMFYUI_PARAMETER_RANGES[field];
    const valid = field === "seed"
      ? Number.isSafeInteger(numeric) && numeric >= 0
      : Number.isFinite(numeric) && numeric >= range.min && numeric <= range.max && (field !== "steps" || Number.isInteger(numeric));
    if (valid) result[field] = numeric;
  }
  for (const field of ["sampler", "scheduler"]) if (isComfyUiSamplingChoice(value[field])) result[field] = value[field].trim();
  if (typeof value.templateId === "string" && /^[a-z0-9_.-]{1,120}$/i.test(value.templateId)) result.templateId = value.templateId;
  if (COMFYUI_WORKFLOW_CAPABILITIES.includes(value.capability)) result.capability = value.capability;
  if (Number.isSafeInteger(value.templateVersion) && value.templateVersion > 0) result.templateVersion = value.templateVersion;
  for (const field of ["templateHash", "workflowHash"]) if (/^[a-f0-9]{64}$/.test(value[field] || "")) result[field] = value[field];
  if (Array.isArray(value.sourceHashes)) result.sourceHashes = value.sourceHashes.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)).slice(0, 5);
  const binding = value.maskBindings;
  if (["inpaint", "cutout"].includes(result.capability) && binding && typeof binding === "object" && !Array.isArray(binding) &&
    Object.keys(binding).every(key => ["sourceHash", "maskHash", "width", "height", "revision"].includes(key)) &&
    [binding.sourceHash, binding.maskHash].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) &&
    [binding.width, binding.height].every(size => Number.isInteger(size) && size >= 1 && size <= 16384) && binding.width * binding.height <= 64 * 1024 * 1024 &&
    Number.isSafeInteger(binding.revision) && binding.revision >= 1) result.maskBindings = { sourceHash: binding.sourceHash, maskHash: binding.maskHash, width: binding.width, height: binding.height, revision: binding.revision };
  return result;
}
