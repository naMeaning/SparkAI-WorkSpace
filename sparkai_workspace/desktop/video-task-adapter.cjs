"use strict";

const SEEDANCE_MODEL_PATTERN = /(?:^|[/:._+-])seedance(?:$|[/:._+-]|\d)/i;
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

function cleanText(value, maximum = 4_096) {
  return String(value || "").trim().slice(0, maximum);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function videoEndpointFamilyForModel(model) {
  return SEEDANCE_MODEL_PATTERN.test(cleanText(model, 240)) ? "video-generations" : "videos";
}

function videoTaskEndpoints(model, remoteTaskId = "", familyValue = "") {
  const family = familyValue === "video-generations" || familyValue === "videos"
    ? familyValue
    : videoEndpointFamilyForModel(model);
  const root = family === "video-generations" ? "/v1/video/generations" : "/v1/videos";
  const id = encodeURIComponent(cleanText(remoteTaskId, 512));
  return {
    family,
    create: root,
    poll: id ? `${root}/${id}` : "",
    content: family === "videos" && id ? `${root}/${id}/content` : ""
  };
}

function normalizedVideoSeconds(value) {
  const number = Math.floor(Number(value) || 5);
  return Math.max(1, Math.min(60, number));
}

function normalizedVideoRatio(value) {
  const ratio = cleanText(value, 32);
  return ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio) ? ratio : "16:9";
}

function normalizedVideoResolution(value) {
  const resolution = cleanText(value, 32).toLowerCase();
  return ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p";
}

function createVideoTaskRequest(input = {}, familyValue = "") {
  const model = cleanText(input.model, 240);
  const prompt = cleanText(input.prompt, 20_000);
  if (!model) throw new Error("视频模型尚未配置。");
  if (!prompt) throw new Error("请填写视频画面要求。");
  const family = familyValue || videoEndpointFamilyForModel(model);
  const seconds = normalizedVideoSeconds(input.seconds ?? input.duration);
  const aspectRatio = normalizedVideoRatio(input.aspectRatio ?? input.aspect_ratio);
  const resolution = normalizedVideoResolution(input.resolution);
  const body = family === "video-generations"
    ? {
        model,
        prompt,
        seconds: String(seconds),
        duration: seconds,
        metadata: {
          resolution,
          ratio: aspectRatio
        }
      }
    : {
        model,
        prompt,
        seconds,
        duration: seconds,
        aspect_ratio: aspectRatio,
        resolution
      };
  const sourceImageUrl = cleanText(input.sourceImageUrl ?? input.source_image_url, 8_192);
  if (sourceImageUrl) {
    if (family === "video-generations") body.image = sourceImageUrl;
    else body.image_url = sourceImageUrl;
  }
  const seed = Number(input.seed);
  if (Number.isSafeInteger(seed)) body.seed = seed;
  return { family, body, model, prompt, seconds, aspectRatio, resolution };
}

function nestedCandidates(payload) {
  const output = [];
  const queue = [{ value: objectValue(payload), depth: 0 }];
  const seen = new Set();
  while (queue.length && output.length < 32) {
    const { value, depth } = queue.shift();
    if (!value || !Object.keys(value).length || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
    if (depth >= 3) continue;
    for (const key of ["data", "task", "result", "output", "metadata"]) {
      const nested = objectValue(value[key]);
      if (Object.keys(nested).length) queue.push({ value: nested, depth: depth + 1 });
    }
  }
  return output;
}

function videoTaskIdFromResponse(payload) {
  for (const source of nestedCandidates(payload)) {
    for (const key of ["task_id", "taskId", "id", "video_id", "videoId"]) {
      const value = cleanText(source[key], 512);
      if (value) return value;
    }
  }
  return "";
}

function normalizedRawState(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s_-]+/g, "");
}

function videoTaskStateFromResponse(payload, fallback = "queued") {
  let raw = "";
  for (const source of nestedCandidates(payload)) {
    raw = normalizedRawState(source.status ?? source.state ?? source.task_status ?? source.taskStatus);
    if (raw) break;
  }
  if (["success", "succeeded", "completed", "complete", "done", "finished"].includes(raw)) return "succeeded";
  if (["failed", "failure", "error", "errored"].includes(raw)) return "failed";
  if (["cancelled", "canceled", "aborted"].includes(raw)) return "cancelled";
  if (["processing", "running", "inprogress", "generating", "rendering"].includes(raw)) return "running";
  if (["queued", "queue", "pending", "submitted", "created", "waiting"].includes(raw)) return "queued";
  return TERMINAL_STATES.has(fallback) || ["queued", "running"].includes(fallback) ? fallback : "queued";
}

function videoTaskProgressFromResponse(payload) {
  for (const source of nestedCandidates(payload)) {
    const raw = source.progress ?? source.percent ?? source.percentage;
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    return Math.max(0, Math.min(100, number <= 1 ? Math.round(number * 100) : Math.round(number)));
  }
  return undefined;
}

function urlFromValue(value) {
  const text = cleanText(value, 16_384);
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
  return "";
}

function videoTaskResultUrl(payload) {
  const directKeys = ["url", "video_url", "videoUrl", "output_url", "outputUrl", "download_url", "downloadUrl"];
  for (const source of nestedCandidates(payload)) {
    for (const key of directKeys) {
      const value = urlFromValue(source[key]);
      if (value) return value;
    }
    for (const key of ["videos", "outputs", "files", "artifacts"]) {
      const values = Array.isArray(source[key]) ? source[key] : [];
      for (const item of values) {
        if (typeof item === "string") {
          const value = urlFromValue(item);
          if (value) return value;
        }
        const nested = objectValue(item);
        for (const directKey of directKeys) {
          const value = urlFromValue(nested[directKey]);
          if (value) return value;
        }
      }
    }
  }
  return "";
}

function videoTaskErrorFromResponse(payload, fallback = "") {
  for (const source of nestedCandidates(payload)) {
    const error = source.error;
    const message = cleanText(
      objectValue(error).message || error || source.message || source.msg || source.reason || source.detail,
      2_000
    );
    if (message) return message;
  }
  return cleanText(fallback, 2_000);
}

function normalizeVideoTaskResponse(payload, options = {}) {
  const remoteTaskId = videoTaskIdFromResponse(payload) || cleanText(options.remoteTaskId, 512);
  const state = videoTaskStateFromResponse(payload, options.fallbackState || (remoteTaskId ? "queued" : "failed"));
  return {
    remoteTaskId,
    state,
    progress: videoTaskProgressFromResponse(payload),
    resultUrl: videoTaskResultUrl(payload),
    error: state === "failed" || state === "cancelled" ? videoTaskErrorFromResponse(payload, options.fallbackError) : ""
  };
}

function isTerminalVideoTaskState(value) {
  return TERMINAL_STATES.has(String(value || ""));
}

module.exports = {
  createVideoTaskRequest,
  isTerminalVideoTaskState,
  normalizeVideoTaskResponse,
  normalizedVideoRatio,
  normalizedVideoResolution,
  normalizedVideoSeconds,
  videoEndpointFamilyForModel,
  videoTaskEndpoints,
  videoTaskErrorFromResponse,
  videoTaskIdFromResponse,
  videoTaskProgressFromResponse,
  videoTaskResultUrl,
  videoTaskStateFromResponse
};
