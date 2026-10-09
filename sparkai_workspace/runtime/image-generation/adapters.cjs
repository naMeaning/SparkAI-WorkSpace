"use strict";

const { cleanString } = require("./types.cjs");
const { normalizeImageGenerationResponse } = require("./normalize-response.cjs");

function outputFormatFor(request) {
  const value = String(request.outputFormat || "png").toLowerCase();
  return value === "jpg" ? "jpeg" : ["png", "jpeg", "webp"].includes(value) ? value : "png";
}

function sizeFor(request) {
  if (request.size) return request.size;
  if (request.width && request.height) return `${request.width}x${request.height}`;
  const ratio = request.aspectRatio || "1:1";
  if (ratio === "16:9") return "1536x864";
  if (ratio === "9:16") return "864x1536";
  if (ratio === "4:3") return "1365x1024";
  if (ratio === "3:4") return "1024x1365";
  return "1024x1024";
}

function qualityFor(request) {
  const value = String(request.quality || "auto").trim();
  return value || "auto";
}

function commonOpenAiBody(request, config) {
  const body = {
    model: config.model,
    prompt: request.prompt,
    n: request.n,
    size: sizeFor(request),
    quality: qualityFor(request)
  };
  if (request.background && config.capabilities.transparentBackground) body.background = request.background;
  if (request.outputFormat) body.output_format = outputFormatFor(request);
  if (request.outputCompression !== undefined && body.output_format && body.output_format !== "png") {
    body.output_compression = request.outputCompression;
  }
  if (request.responseFormat) body.response_format = request.responseFormat;
  if (request.moderation && /^(?:gpt-image|chatgpt-image)/i.test(config.model)) body.moderation = request.moderation;
  return body;
}

function multipartParts(request, config, preparedInputs) {
  const imageField = config.capabilities.multiReferenceImages ? "image[]" : "image";
  const parts = [];
  for (const input of preparedInputs.editImages || []) {
    parts.push({ field: imageField, input });
  }
  if (request.mask && preparedInputs.mask) parts.push({ field: "mask", input: preparedInputs.mask });
  return parts;
}

async function buildOpenAiRequest(request, config, preparedInputs) {
  if (request.mode === "edit") {
    const fields = commonOpenAiBody(request, config);
    if (request.inputFidelity && /^gpt-image-(?:1|1\.5)(?:$|-)/i.test(config.model) && !/^gpt-image-1-mini/i.test(config.model)) fields.input_fidelity = request.inputFidelity;
    fields.n = request.n;
    if (!config.capabilities.multipleOutputs) fields.n = 1;
    if (!config.capabilities.outputFormats?.includes(outputFormatFor(request))) delete fields.output_format;
    return {
      protocol: "openai-images",
      method: "POST",
      endpoint: "/v1/images/edits",
      kind: "multipart",
      fields,
      parts: multipartParts(request, config, preparedInputs)
    };
  }
  return {
    protocol: "openai-images",
    method: "POST",
    endpoint: "/v1/images/generations",
    kind: "json",
    body: commonOpenAiBody(request, config)
  };
}

function xaiResolution(request) {
  const value = String(request.resolution || "1K").trim().toUpperCase();
  return value === "2K" ? "2k" : "1k";
}

function xaiAspectRatio(request) {
  if (request.aspectRatio) return request.aspectRatio;
  const size = sizeFor(request);
  const match = String(size).match(/^(\d+)x(\d+)$/);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(ratio - 4 / 3) < 0.08) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.08) return "3:4";
  return "1:1";
}

async function buildXaiRequest(request, config, preparedInputs) {
  const body = {
    model: config.model,
    prompt: request.prompt,
    n: request.n,
    aspect_ratio: xaiAspectRatio(request),
    resolution: xaiResolution(request)
  };
  const quality = qualityFor(request);
  if (["low", "medium"].includes(quality)) body.quality = quality;
  else if (["standard", "high"].includes(quality)) body.quality = "medium";
  // xAI defaults to a temporary CDN URL. Inline output avoids a second network
  // dependency after the provider has already generated (and may have billed) it.
  body.response_format = request.responseFormat || "b64_json";
  if (request.mode === "edit") {
    const images = (preparedInputs.editImages || []).map((input) => ({
      type: "image_url",
      url: input.url || `data:${input.mimeType || "image/png"};base64,${input.base64 || input.buffer?.toString("base64") || ""}`
    }));
    if (images.length === 1) body.image = images[0];
    else body.images = images;
    return {
      protocol: "xai-images",
      method: "POST",
      endpoint: "/v1/images/edits",
      kind: "json",
      body
    };
  }
  return { protocol: "xai-images", method: "POST", endpoint: "/v1/images/generations", kind: "json", body };
}

function geminiImageConfig(request, modelConfig) {
  const imageConfig = {};
  if (request.aspectRatio) imageConfig.aspectRatio = request.aspectRatio;
  if (request.resolution && !(modelConfig.capabilities.supportedResolutions.length === 1 && modelConfig.capabilities.supportedResolutions[0] === "1K")) {
    imageConfig.imageSize = String(request.resolution).toUpperCase();
  }
  return imageConfig;
}

async function buildGeminiRequest(request, config, preparedInputs) {
  const parts = [{ text: request.prompt }];
  for (const input of preparedInputs.editImages || []) {
    if (input.base64) parts.push({ inlineData: { mimeType: input.mimeType, data: input.base64 } });
  }
  if (preparedInputs.mask?.base64) {
    parts.push({ inlineData: { mimeType: preparedInputs.mask.mimeType, data: preparedInputs.mask.base64 } });
  }
  const body = {
    __imageModel: config.model,
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };
  const imageConfig = geminiImageConfig(request, config);
  if (Object.keys(imageConfig).length) body.generationConfig.imageConfig = imageConfig;
  return {
    protocol: "gemini-native",
    method: "POST",
    endpoint: `/v1beta/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:generateContent`,
    kind: "json",
    body
  };
}

const ADAPTERS = Object.freeze({
  "openai-images": { buildRequest: buildOpenAiRequest, normalizeResponse: normalizeImageGenerationResponse },
  "xai-images": { buildRequest: buildXaiRequest, normalizeResponse: normalizeImageGenerationResponse },
  "gemini-native": { buildRequest: buildGeminiRequest, normalizeResponse: normalizeImageGenerationResponse }
});

function adapterFor(protocol) {
  const adapter = ADAPTERS[String(protocol || "").trim().toLowerCase()];
  if (!adapter) throw Object.assign(new Error(`不支持的图片协议：${String(protocol || "")}`), { code: "IMAGE_PROTOCOL_UNSUPPORTED" });
  return adapter;
}

module.exports = {
  ADAPTERS,
  adapterFor,
  buildGeminiRequest,
  buildOpenAiRequest,
  buildXaiRequest,
  outputFormatFor,
  sizeFor
};
