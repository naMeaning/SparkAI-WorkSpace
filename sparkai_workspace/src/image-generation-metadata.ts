import type {
  ImageAsset,
  ImageAssetGenerationMetadata,
  ImageGenerationParameterSnapshot,
  ImageGenerationResponseSnapshot,
  ImageTaskDraft
} from "./core";

const supportedOutputFormats = new Set(["png", "jpeg", "webp"]);

function cleanText(value: unknown, maximum = 180) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maximum) : undefined;
}

function normalizeOutputFormat(value: unknown): ImageGenerationParameterSnapshot["outputFormat"] {
  const normalized = cleanText(value, 24)?.toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return normalized && supportedOutputFormats.has(normalized)
    ? normalized as ImageGenerationParameterSnapshot["outputFormat"]
    : undefined;
}

function normalizeTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function sanitizeParameters(value: unknown): ImageGenerationParameterSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const outputCompression = Number(source.outputCompression ?? source.output_compression);
  const outputFormat = normalizeOutputFormat(source.outputFormat ?? source.output_format ?? source.format);
  return {
    model: cleanText(source.model),
    ratio: cleanText(source.ratio ?? source.aspectRatio ?? source.aspect_ratio, 80),
    resolution: cleanText(source.resolution, 80),
    size: cleanText(source.size, 80),
    quality: cleanText(source.quality, 80),
    outputFormat,
    outputCompression: Number.isFinite(outputCompression) ? Math.max(0, Math.min(100, Math.round(outputCompression))) : undefined,
    background: cleanText(source.background, 80),
    moderation: cleanText(source.moderation, 80),
    inputFidelity: cleanText(source.inputFidelity ?? source.input_fidelity, 80)
  };
}

function compactParameters<T extends ImageGenerationParameterSnapshot>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function sanitizeImageAssetGenerationMetadata(value: unknown): ImageAssetGenerationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const request = compactParameters(sanitizeParameters(source.request));
  const responseBase = compactParameters(sanitizeParameters(source.response));
  const responseCreatedAt = source.response && typeof source.response === "object" && !Array.isArray(source.response)
    ? normalizeTimestamp((source.response as Record<string, unknown>).createdAt ?? (source.response as Record<string, unknown>).created_at ?? (source.response as Record<string, unknown>).created)
    : undefined;
  const response: ImageGenerationResponseSnapshot = {
    ...responseBase,
    ...(responseCreatedAt ? { createdAt: responseCreatedAt } : {})
  };
  const startedAt = normalizeTimestamp(source.startedAt);
  const completedAt = normalizeTimestamp(source.completedAt);
  const numericDuration = Number(source.durationMs);
  const durationMs = Number.isFinite(numericDuration) && numericDuration >= 0
    ? Math.min(Math.round(numericDuration), 86_400_000)
    : undefined;
  if (!Object.keys(request).length && !Object.keys(response).length && !startedAt && !completedAt && durationMs === undefined) return undefined;
  return {
    version: 1,
    ...(Object.keys(request).length ? { request } : {}),
    ...(Object.keys(response).length ? { response } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs === undefined ? {} : { durationMs })
  };
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function actualImageAspectRatio(width?: number, height?: number) {
  const safeWidth = Math.round(Number(width));
  const safeHeight = Math.round(Number(height));
  if (safeWidth <= 0 || safeHeight <= 0) return undefined;
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  const reducedWidth = safeWidth / divisor;
  const reducedHeight = safeHeight / divisor;
  if (reducedWidth <= 50 && reducedHeight <= 50) return `${reducedWidth}:${reducedHeight}`;
  const ratio = safeWidth / safeHeight;
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

export function imageAssetOutputFormat(asset: Pick<ImageAsset, "outputFormat" | "mimeType" | "path" | "relativePath" | "originalName">) {
  const explicit = normalizeOutputFormat(asset.outputFormat);
  if (explicit) return explicit;
  const mime = cleanText(asset.mimeType, 80)?.toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/webp") return "webp";
  const locator = String(asset.relativePath || asset.path || asset.originalName || "").toLowerCase().split(/[?#]/, 1)[0];
  if (/\.png$/.test(locator)) return "png";
  if (/\.jpe?g$/.test(locator)) return "jpeg";
  if (/\.webp$/.test(locator)) return "webp";
  return undefined;
}

export type ImageGenerationDisplayRow = {
  key: string;
  label: string;
  requested?: string;
  actual?: string;
  actualSource?: "api" | "asset" | "runtime";
};

function valueLabel(key: string, value: unknown) {
  const text = cleanText(String(value ?? ""), 180);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (key === "quality") return ({ auto: "自动", low: "低", medium: "标准", high: "高" } as Record<string, string>)[normalized] || text;
  if (key === "background") return ({ auto: "自动", transparent: "透明", opaque: "不透明" } as Record<string, string>)[normalized] || text;
  if (key === "moderation") return ({ auto: "自动", low: "低限制" } as Record<string, string>)[normalized] || text;
  if (key === "inputFidelity") return ({ low: "低", high: "高" } as Record<string, string>)[normalized] || text;
  if (key === "outputFormat") return normalizeOutputFormat(text)?.toUpperCase() || text.toUpperCase();
  if (key === "size") return text.replace(/[x×]/gi, "×");
  if (key === "outputCompression") return `${Math.round(Number(text))}%`;
  return text;
}

function pairedRow(
  key: string,
  label: string,
  requestedValue: unknown,
  actualValue: unknown,
  actualSource: ImageGenerationDisplayRow["actualSource"] = "api"
): ImageGenerationDisplayRow | undefined {
  const requested = valueLabel(key, requestedValue);
  const actual = valueLabel(key, actualValue);
  if (!requested && !actual) return undefined;
  if (actual && requested && actual.toLowerCase() === requested.toLowerCase()) {
    return { key, label, actual, actualSource };
  }
  return { key, label, requested, actual, ...(actual ? { actualSource } : {}) };
}

function requestSnapshotFromDraft(draft?: ImageTaskDraft): ImageGenerationParameterSnapshot {
  if (!draft) return {};
  return compactParameters({
    model: cleanText(draft.model),
    ratio: cleanText(draft.ratio, 80),
    resolution: cleanText(draft.resolution, 80),
    size: cleanText(draft.size, 80),
    quality: cleanText(draft.quality, 80),
    outputFormat: normalizeOutputFormat(draft.outputFormat),
    outputCompression: Number.isFinite(Number(draft.outputCompression)) ? Number(draft.outputCompression) : undefined,
    background: cleanText(draft.background, 80),
    moderation: cleanText(draft.moderation, 80),
    inputFidelity: cleanText(draft.inputFidelity, 80)
  });
}

export function imageAssetIsLocalImport(asset: ImageAsset) {
  return Boolean(
    asset.importBatchId ||
    asset.importRootId ||
    asset.sourceRelativePath ||
    asset.sourceRootKind ||
    String(asset.runId || "").toLowerCase().startsWith("import-")
  );
}

function formatDuration(durationMs?: number) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function formatCompletedAt(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function imageGenerationDisplayRows(
  asset: ImageAsset,
  fallbackRequest?: ImageTaskDraft,
  assetIndex = 0,
  assetCount = 1
) {
  const useFallbackRequest = Boolean(asset.generation) || !imageAssetIsLocalImport(asset);
  const request = {
    ...(useFallbackRequest ? requestSnapshotFromDraft(fallbackRequest) : {}),
    ...(asset.generation?.request ?? {})
  };
  const response = asset.generation?.response ?? {};
  const width = Math.round(Number(asset.width));
  const height = Math.round(Number(asset.height));
  const ratio = actualImageAspectRatio(width, height);
  const fileFormat = imageAssetOutputFormat(asset);
  const rows = [
    pairedRow("model", "模型", request.model, response.model),
    pairedRow("ratio", "比例", request.ratio, ratio, "asset"),
    pairedRow("resolution", "清晰度", request.resolution, response.resolution),
    pairedRow("size", "请求尺寸", request.size, response.size),
    width > 0 && height > 0 ? { key: "pixels", label: "像素尺寸", actual: `${width}×${height}`, actualSource: "asset" } satisfies ImageGenerationDisplayRow : undefined,
    pairedRow("quality", "质量", request.quality, response.quality),
    pairedRow("outputFormat", "输出格式", request.outputFormat, response.outputFormat),
    fileFormat ? { key: "fileFormat", label: "文件格式", actual: fileFormat.toUpperCase(), actualSource: "asset" } satisfies ImageGenerationDisplayRow : undefined,
    pairedRow("outputCompression", "压缩率", request.outputCompression, response.outputCompression),
    pairedRow("background", "背景", request.background, response.background),
    pairedRow("moderation", "审核", request.moderation, response.moderation),
    pairedRow("inputFidelity", "输入保真度", request.inputFidelity, response.inputFidelity),
    assetCount > 1 ? { key: "slot", label: "图片槽位", actual: `${assetIndex + 1} / ${assetCount}`, actualSource: "asset" } satisfies ImageGenerationDisplayRow : undefined,
    formatDuration(asset.generation?.durationMs) ? { key: "duration", label: "耗时", actual: formatDuration(asset.generation?.durationMs), actualSource: "runtime" } satisfies ImageGenerationDisplayRow : undefined,
    formatCompletedAt(asset.generation?.completedAt || response.createdAt) ? {
      key: "completedAt",
      label: "完成时间",
      actual: formatCompletedAt(asset.generation?.completedAt || response.createdAt),
      actualSource: "runtime"
    } satisfies ImageGenerationDisplayRow : undefined
  ];
  return rows.filter((row): row is ImageGenerationDisplayRow => Boolean(row));
}

export function imageGenerationSourceLabel(asset: ImageAsset, fallbackRequest?: ImageTaskDraft) {
  if (asset.generation?.response && Object.keys(asset.generation.response).length) return "服务器响应";
  if (!asset.generation && imageAssetIsLocalImport(asset)) return "本地导入";
  if (asset.generation?.request || fallbackRequest) return "请求记录";
  return "本地导入";
}
