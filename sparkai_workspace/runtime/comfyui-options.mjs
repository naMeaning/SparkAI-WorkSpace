export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const fail = (code, message) => Object.assign(new Error(message), { code });

export function localBaseUrl(value) {
  const text = value === undefined || value === "" ? "http://127.0.0.1:8188" : value;
  if (typeof text !== "string" || text.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(text)) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。");
  let parsed;
  try { parsed = new URL(text); } catch { throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址无效。"); }
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) throw fail("COMFYUI_LOCAL_ONLY", "ComfyUI 首期只允许本机 localhost 服务。");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw fail("COMFYUI_URL_INVALID", "ComfyUI 地址不能包含凭据、参数或代理路径。");
  return parsed.origin;
}

export function normalizeComfyUiTaskOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["templateId", "templateHash", "baseUrl", "checkpoint", "seed", "width", "height", "negativePrompt"].includes(key))) throw fail("COMFYUI_REQUEST_INVALID", "本地生图只接受模板与已审核输入。");
  if (typeof input.templateId !== "string" || !/^[a-z0-9_.-]{1,120}$/i.test(input.templateId) || !/^[a-f0-9]{64}$/.test(input.templateHash || "")) throw fail("COMFYUI_TEMPLATE_CHANGED", "模板标识无效，请重新选择后提交。");
  if (typeof input.checkpoint !== "string" || !input.checkpoint.trim() || input.checkpoint.length > 1024 || /[\u0000-\u001f]/.test(input.checkpoint)) throw fail("COMFYUI_MODEL_REQUIRED", "请先检查本机环境并选择模型。");
  const seed = input.seed ?? -1, width = input.width ?? 1024, height = input.height ?? 1024;
  if (!Number.isSafeInteger(seed) || seed < -1 || ![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 8 === 0)) throw fail("COMFYUI_PARAMETERS_INVALID", "种子或画幅无效，尺寸须为 64–4096 的 8 倍数。");
  const negativePrompt = input.negativePrompt ?? "";
  if (typeof negativePrompt !== "string" || negativePrompt.length > 16_384 || negativePrompt.includes("\0")) throw fail("COMFYUI_PARAMETERS_INVALID", "负面提示词无效。");
  return { templateId: input.templateId, templateHash: input.templateHash, baseUrl: localBaseUrl(input.baseUrl), checkpoint: input.checkpoint, seed, width, height, negativePrompt };
}

export function normalizeComfyUiGenerationMetadata(value) {
  if (!value || typeof value !== "object" || value.protocol !== "comfyui") return {};
  const result = { protocol: "comfyui" };
  for (const field of ["seed", "steps", "cfg", "denoise"]) {
    const numeric = value[field];
    if (Number.isFinite(numeric) && numeric >= 0 && (field !== "seed" || Number.isSafeInteger(numeric))) result[field] = numeric;
  }
  for (const field of ["sampler", "scheduler", "templateId"]) if (typeof value[field] === "string" && /^[a-z0-9_.-]{1,120}$/i.test(value[field])) result[field] = value[field];
  if (Number.isSafeInteger(value.templateVersion) && value.templateVersion > 0) result.templateVersion = value.templateVersion;
  for (const field of ["templateHash", "workflowHash"]) if (/^[a-f0-9]{64}$/.test(value[field] || "")) result[field] = value[field];
  if (Array.isArray(value.sourceHashes)) result.sourceHashes = value.sourceHashes.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)).slice(0, 4);
  return result;
}
