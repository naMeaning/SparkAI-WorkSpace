"use strict";

const { cleanString } = require("./types.cjs");

function dataUrlFromBase64(value, mimeType = "image/png") {
  const encoded = cleanString(value, 96 * 1024 * 1024).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return encoded ? `data:${mimeType || "image/png"};base64,${encoded}` : "";
}

function pushImage(images, entry, inherited = {}) {
  if (!entry || typeof entry !== "object") return;
  const b64 = entry.b64_json || entry.image_base64 || entry.base64 || entry.inlineData?.data || entry.inline_data?.data;
  const url = entry.url || entry.image_url?.url || entry.image_url || entry.uri;
  const mimeType = cleanString(entry.mime_type || entry.mimeType || entry.inlineData?.mimeType || entry.inline_data?.mimeType || "image/png", 120) || "image/png";
  if (b64) {
    images.push({
      type: "base64",
      value: cleanString(b64, 96 * 1024 * 1024),
      dataUrl: dataUrlFromBase64(b64, mimeType),
      mimeType,
      revisedPrompt: cleanString(entry.revised_prompt || entry.revisedPrompt || inherited.revisedPrompt, 20_000),
      ...(inherited.requestIndex === undefined ? {} : { requestIndex: inherited.requestIndex })
    });
    return;
  }
  if (url) {
    images.push({
      type: "url",
      value: cleanString(url, 16_384),
      mimeType,
      revisedPrompt: cleanString(entry.revised_prompt || entry.revisedPrompt || inherited.revisedPrompt, 20_000),
      ...(inherited.requestIndex === undefined ? {} : { requestIndex: inherited.requestIndex })
    });
  }
}

function normalizeImageGenerationResponse(payload, context = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const images = [];
  const source = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.images)
      ? data.images
      : [];
  source.forEach((entry) => pushImage(images, entry));

  if (Array.isArray(data.output)) {
    data.output.forEach((entry) => {
      const content = Array.isArray(entry?.content) ? entry.content : [];
      content.forEach((part) => pushImage(images, part, entry));
    });
  }

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  candidates.forEach((candidate) => {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    parts.forEach((part) => pushImage(images, part, { revisedPrompt: candidate?.finishMessage }));
  });

  if (!images.length && Array.isArray(data.parts)) data.parts.forEach((part) => pushImage(images, part));

  const model = cleanString(data.model || context.model, 180) || undefined;
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
    ? { b64_json: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt }
    : { url: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt });
  return result;
}

module.exports = { dataUrlFromBase64, normalizeImageGenerationResponse };
