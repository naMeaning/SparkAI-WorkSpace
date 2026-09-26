"use strict";

const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { adapterFor } = require("../runtime/image-generation/adapters.cjs");
const {
  cleanString,
  normalizeImageGenerationRequest,
  normalizeImageInput,
  resolveImageModelConfig,
  validateImageGenerationRequest
} = require("../runtime/image-generation/types.cjs");
const { normalizeImageGenerationResponse } = require("../runtime/image-generation/normalize-response.cjs");
const { normalizeImageGenerationError } = require("../runtime/image-generation/errors.cjs");

const MAX_INPUT_BYTES = 32 * 1024 * 1024;

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

function readInputBuffer(input) {
  const normalized = normalizeImageInput(input);
  if (!normalized) throw new Error("图片输入为空。 ");
  const data = parseDataUrl(normalized.dataUrl);
  if (data) return { ...data, name: normalized.name };
  if (normalized.path) {
    const info = statSync(normalized.path);
    if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new Error(`图片 ${normalized.name} 超过输入大小限制。`);
    const buffer = readFileSync(normalized.path);
    return { buffer, base64: buffer.toString("base64"), mimeType: normalized.mimeType || "image/png", name: normalized.name };
  }
  throw Object.assign(new Error("当前协议需要本地图片文件或 data URL，暂不接受远程图片 URL。"), { code: "IMAGE_INPUT_UNSUPPORTED" });
}

function formDataFor(prepared, request) {
  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw Object.assign(new Error("当前运行时不支持 multipart 图片请求。"), { code: "IMAGE_MULTIPART_UNAVAILABLE" });
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(prepared.fields || {})) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, String(value));
  }
  for (const part of prepared.parts || []) {
    const input = part.input;
    const buffer = input.buffer || Buffer.from(input.base64, "base64");
    form.append(part.field, new Blob([buffer], { type: input.mimeType || "image/png" }), input.name || "image.png");
  }
  return form;
}

function legacyResponse(result) {
  const data = result.data || result.images.map((image) => image.type === "base64"
    ? { b64_json: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt }
    : { url: image.value, mime_type: image.mimeType, revised_prompt: image.revisedPrompt });
  return {
    ok: result.ok !== false,
    created: result.created,
    model: result.model,
    provider: result.provider,
    protocol: result.protocol,
    gateway: result.gateway,
    usage: result.usage,
    data,
    images: result.images,
    normalizedImages: result.images,
    imageGeneration: {
      model: result.model,
      provider: result.provider,
      protocol: result.protocol,
      gateway: result.gateway,
      images: result.images.length
    }
  };
}

function createImageGenerationService(options = {}) {
  const {
    accessPolicy,
    log = () => {},
    newApiRelayJson,
    newApiRelayMultipart,
    newApiRelayAsyncImage
  } = options;
  if (typeof newApiRelayJson !== "function") throw new Error("ImageGenerationService requires newApiRelayJson.");

  async function prepareInputs(request) {
    const all = [];
    if (request.editImage) all.push(request.editImage);
    all.push(...request.images);
    const editImages = all.map((input) => readInputBuffer(input));
    const mask = request.mask ? readInputBuffer(request.mask) : null;
    return { editImages, mask };
  }

  async function send(settings, config, request, providerRequest, options = {}) {
    const configuredBinding = {
      model: config.model,
      ...(config.apiKey ? { customApiKey: config.apiKey } : {}),
      ...(config.baseUrl && accessPolicy?.customApiAccess !== false ? { customBaseUrl: config.baseUrl } : {}),
      ...(config.accountTokenId ? { accountTokenId: config.accountTokenId } : {})
    };
    const hasConfiguredBinding = Object.keys(configuredBinding).length > 1;
    const settingsForTransport = hasConfiguredBinding
      ? {
          ...settings,
          imageModelBindings: [
            ...(Array.isArray(settings?.imageModelBindings)
              ? settings.imageModelBindings.filter((binding) => String(binding?.model || "").toLowerCase() !== config.model.toLowerCase())
              : []),
            configuredBinding
          ]
        }
      : settings;
    const transportOptions = {
      provider: "image",
      model: config.model,
      signal: request.signal,
      headers: options.headers,
      headersTimeoutMs: options.headersTimeoutMs || 120_000,
      connectTimeoutMs: options.connectTimeoutMs || 60_000,
      maxRequestBytes: 96 * 1024 * 1024,
      maxResponseBytes: 96 * 1024 * 1024,
      ...(config.baseUrl && accessPolicy?.customApiAccess !== false ? { baseUrl: config.baseUrl } : {}),
      ...(config.apiKey && accessPolicy?.customApiAccess !== false ? { apiKey: config.apiKey } : {}),
      ...(config.protocol === "gemini-native" && config.gateway === "direct" ? { authHeader: "x-goog-api-key" } : {}),
      onPartialImage: request.onPartialImage,
      pollIntervalMs: config.pollIntervalMs,
      maxWaitMs: config.maxWaitMs
    };
    if (config.transportMode === "async") {
      if (typeof newApiRelayAsyncImage !== "function") {
        throw Object.assign(new Error("当前网关没有启用异步图片任务接口。"), { code: "IMAGE_ASYNC_UNSUPPORTED" });
      }
      return newApiRelayAsyncImage(settingsForTransport, providerRequest.endpoint, providerRequest.kind === "json"
        ? providerRequest.body
        : providerRequest.form, { ...transportOptions, model: config.model });
    }
    if (providerRequest.kind === "multipart") {
      if (typeof newApiRelayMultipart !== "function") {
        throw Object.assign(new Error("当前网关没有可用的 multipart 图片传输。"), { code: "IMAGE_MULTIPART_UNSUPPORTED" });
      }
      return newApiRelayMultipart(settingsForTransport, providerRequest.endpoint, providerRequest.form, transportOptions);
    }
    return newApiRelayJson(settingsForTransport, providerRequest.endpoint, providerRequest.body, transportOptions);
  }

  async function generate(settings = {}, payload = {}) {
    const config = resolveImageModelConfig(settings, payload.model || settings.imageModel);
    const request = normalizeImageGenerationRequest(payload, config);
    validateImageGenerationRequest(request, config);
    const adapter = adapterFor(config.protocol);
    try {
      const preparedInputs = await prepareInputs(request);
      const providerRequest = await adapter.buildRequest(request, config, preparedInputs);
      if (providerRequest.kind === "multipart") providerRequest.form = formDataFor(providerRequest, request);
      if (providerRequest.kind === "json" && providerRequest.body?.__imageModel) {
        // Internal routing metadata is consumed by new-api-client and never sent upstream.
        providerRequest.body = { ...providerRequest.body };
      }
      const raw = await send(settings, config, request, providerRequest, {
        headers: payload.headers
      });
      const normalized = normalizeImageGenerationResponse(raw, {
        model: config.model,
        provider: config.provider,
        protocol: config.protocol,
        gateway: config.gateway
      });
      if (!normalized.ok) {
        throw Object.assign(new Error(normalized.error || "图片接口没有返回图片。"), { code: "IMAGE_INVALID_RESPONSE" });
      }
      normalized.transportMode = config.transportMode;
      normalized.request = {
        model: config.model,
        mode: request.mode,
        n: request.n,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        outputFormat: request.outputFormat
      };
      log(`image generation protocol=${config.protocol} gateway=${config.gateway} model=${config.model} images=${normalized.images.length}`);
      return legacyResponse(normalized);
    } catch (error) {
      const normalizedError = normalizeImageGenerationError(error, {
        model: config.model,
        provider: config.provider,
        protocol: config.protocol,
        gateway: config.gateway
      });
      throw normalizedError;
    }
  }

  return { generate, resolveModelConfig: (settings, model) => resolveImageModelConfig(settings, model) };
}

module.exports = { createImageGenerationService };
