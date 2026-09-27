"use strict";

const { cleanString } = require("./types.cjs");

const MAX_DEPTH = 12;
const MAX_NODES = 2_000;

function dataUrlFromBase64(value, mimeType = "image/png") {
  const encoded = cleanString(value, 96 * 1024 * 1024).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return encoded ? `data:${mimeType || "image/png"};base64,${encoded}` : "";
}

function imageValueFor(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const inline = entry.inlineData || entry.inline_data;
  const b64 = entry.b64_json || entry.image_base64 || entry.base64 || inline?.data;
  if (b64) return { type: "base64", value: b64, mimeType: entry.mime_type || entry.mimeType || inline?.mimeType || inline?.mime_type };
  const imageUrl = entry.image_url;
  const url = entry.url || (typeof imageUrl === "string" ? imageUrl : imageUrl?.url) || entry.uri;
  if (url) return { type: "url", value: url, mimeType: entry.mime_type || entry.mimeType || inline?.mimeType };
  return null;
}

function pushImage(images, seen, entry, inherited = {}) {
  const candidate = imageValueFor(entry);
  if (!candidate) return;
  const value = cleanString(candidate.value, candidate.type === "base64" ? 96 * 1024 * 1024 : 16_384);
  if (!value) return;
  const key = `${candidate.type}:${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  const mimeType = cleanString(candidate.mimeType || inherited.mimeType || "image/png", 120) || "image/png";
  const revisedPrompt = cleanString(
    entry.revised_prompt || entry.revisedPrompt || entry.revised || inherited.revisedPrompt,
    20_000
  );
  const requestIndex = entry.request_index ?? entry.requestIndex ?? inherited.requestIndex;
  images.push({
    type: candidate.type,
    value,
    ...(candidate.type === "base64" ? { dataUrl: dataUrlFromBase64(value, mimeType) } : {}),
    mimeType,
    ...(revisedPrompt ? { revisedPrompt } : {}),
    ...(requestIndex === undefined || requestIndex === null || requestIndex === "" ? {} : { requestIndex })
  });
}

function inheritedMetadata(entry, inherited) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return inherited;
  return {
    ...inherited,
    ...(entry.revised_prompt || entry.revisedPrompt || entry.revised
      ? { revisedPrompt: entry.revised_prompt || entry.revisedPrompt || entry.revised }
      : {}),
    ...(entry.request_index !== undefined || entry.requestIndex !== undefined
      ? { requestIndex: entry.request_index ?? entry.requestIndex }
      : {}),
    ...(entry.mime_type || entry.mimeType ? { mimeType: entry.mime_type || entry.mimeType } : {})
  };
}

function normalizeImageGenerationResponse(payload, context = {}) {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const images = [];
  const seen = new Set();
  let visited = 0;

  function walk(value, inherited = {}, depth = 0) {
    if (visited >= MAX_NODES || depth > MAX_DEPTH || value === null || value === undefined) return;
    visited += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, inherited, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const next = inheritedMetadata(value, inherited);
    pushImage(images, seen, value, inherited);
    for (const [key, child] of Object.entries(value)) {
      if (key === "raw" || key === "usage" || key === "metadata") continue;
      if (child && typeof child === "object") walk(child, next, depth + 1);
    }
  }

  walk(data);

  const model = cleanString(data.model || data.result?.model || context.model, 180) || undefined;
  const result = {
    ok: images.length > 0,
    images,
    model,
    provider: cleanString(context.provider, 80) || undefined,
    protocol: cleanString(context.protocol, 80) || undefined,
    gateway: cleanString(context.gateway, 80) || undefined,
    usage: data.usage && typeof data.usage === "object" ? data.usage : undefined,
    created: Number.isFinite(Number(data.created || data.created_at)) ? Number(data.created || data.created_at) : undefined,
    raw: data
  };
  if (!images.length) {
    result.ok = false;
    result.error = "图片接口返回成功，但没有可识别的图片。";
  }
  // Keep a small OpenAI-shaped compatibility view for existing project code.
  result.data = images.map((image) => image.type === "base64"
    ? { b64_json: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt, request_index: image.requestIndex }
    : { url: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt, request_index: image.requestIndex });
  return result;
}

module.exports = { dataUrlFromBase64, normalizeImageGenerationResponse };
