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

function templateExposes(template, field) {
  if (!template || typeof template !== "object") return true;
  if (Array.isArray(template.inputMappings) && !template.inputMappings.some(mapping => mapping?.kind === field && !Object.prototype.hasOwnProperty.call(mapping, "value"))) return false;
  if (Array.isArray(template.exposedInputs)) return template.exposedInputs.includes(field);
  if (Array.isArray(template.inputMappings)) return true;
  return true;
}

function normalizeSamplingParameters(input, template) {
  const result = {};
  const defaults = template && typeof template.defaults === "object" && !Array.isArray(template.defaults) ? template.defaults : {};
  for (const field of COMFYUI_SAMPLING_FIELDS) {
    let value = input?.[field];
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
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["templateId", "templateHash", "baseUrl", "checkpoint", "seed", "width", "height", "negativePrompt", ...COMFYUI_SAMPLING_FIELDS].includes(key))) throw fail("COMFYUI_REQUEST_INVALID", "本地生图只接受模板与已审核输入。");
  if (typeof input.templateId !== "string" || !/^[a-z0-9_.-]{1,120}$/i.test(input.templateId) || !/^[a-f0-9]{64}$/.test(input.templateHash || "")) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板标识无效，请重新选择后提交。");
  if (!isComfyUiModelName(input.checkpoint)) throw fail("COMFYUI_MODEL_REQUIRED", "请选择本机模型目录中的 checkpoint 名称。");
  const seed = input.seed ?? -1, width = input.width ?? 1024, height = input.height ?? 1024;
  if (!Number.isSafeInteger(seed) || seed < -1 || ![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 8 === 0)) throw fail("COMFYUI_PARAMETERS_INVALID", "种子或画幅无效，尺寸须为 64–4096 的 8 倍数。");
  const negativePrompt = input.negativePrompt ?? "";
  if (typeof negativePrompt !== "string" || negativePrompt.length > 16_384 || negativePrompt.includes("\0")) throw fail("COMFYUI_PARAMETERS_INVALID", "负面提示词无效。");
  return { templateId: input.templateId, templateHash: input.templateHash, baseUrl: localBaseUrl(input.baseUrl), checkpoint: input.checkpoint, seed, width, height, negativePrompt,
    ...normalizeSamplingParameters(input, template) };
}

export function normalizeComfyUiGenerationMetadata(value) {
  if (!value || typeof value !== "object" || value.protocol !== "comfyui") return {};
  const result = { protocol: "comfyui" };
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
  if (Number.isSafeInteger(value.templateVersion) && value.templateVersion > 0) result.templateVersion = value.templateVersion;
  for (const field of ["templateHash", "workflowHash"]) if (/^[a-f0-9]{64}$/.test(value[field] || "")) result[field] = value[field];
  if (Array.isArray(value.sourceHashes)) result.sourceHashes = value.sourceHashes.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)).slice(0, 4);
  return result;
}
