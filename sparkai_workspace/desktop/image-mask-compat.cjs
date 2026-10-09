"use strict";

const sharp = require("sharp");
const { createHash } = require("node:crypto");

function unsupportedMaskError(error) {
  return [400, 422].includes(Number(error?.status)) && !error?.taskId && !error?.task_id
    && !error?.ambiguous && !error?.unsafeToRetry
    && /mask.*(?:compositing is disabled|not supported|unsupported|does not support)|(?:不支持|未支持).*蒙[版板]/i.test(String(error?.message || ""));
}

function maskCapabilityKey(settings, config) {
  return createHash("sha256").update(JSON.stringify([
    config.baseUrl || settings.imageBaseUrl || settings.relayBaseUrl || settings.accountBaseUrl,
    config.model, settings.serverUserId, config.accountTokenId || settings.selectedAccountTokenId,
    config.apiKey || settings.imageApiKey || settings.agentApiKey
  ])).digest("hex");
}

function bufferFor(input) {
  return input?.buffer || Buffer.from(input?.base64 || "", "base64");
}

async function validateMaskInputs(inputs) {
  const source = bufferFor(inputs.editImages[0]);
  const mask = bufferFor(inputs.mask);
  if (!source.length || !mask.length || mask.length >= 4 * 1024 * 1024) throw Object.assign(new Error("蒙版必须为小于 4MB 的 PNG，并有对应来源图片。"), { code: "IMAGE_INVALID_INPUT" });
  const [sourceMeta, maskMeta] = await Promise.all([sharp(source).metadata(), sharp(mask).metadata()]);
  if (maskMeta.format !== "png" || !maskMeta.hasAlpha || maskMeta.width !== sourceMeta.width || maskMeta.height !== sourceMeta.height) {
    throw Object.assign(new Error("蒙版必须带透明通道，并与第一张来源图片尺寸一致。"), { code: "IMAGE_INVALID_INPUT" });
  }
  if (sourceMeta.width * sourceMeta.height > 32_000_000) throw Object.assign(new Error("蒙版编辑来源超过客户端像素上限。"), { code: "IMAGE_INVALID_INPUT" });
  return { width: sourceMeta.width, height: sourceMeta.height };
}

async function applyClientMask(result, inputs, downloadImage, signal) {
  const source = bufferFor(inputs.editImages[0]);
  const mask = await sharp(bufferFor(inputs.mask)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = mask.info;
  const original = await sharp(source).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  const images = [];
  for (const image of result.images) {
    signal?.throwIfAborted();
    const bytes = image.type === "base64" ? Buffer.from(image.value, "base64") : await downloadImage(image.value, signal);
    signal?.throwIfAborted();
    const edited = await sharp(bytes).resize(width, height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      const keep = mask.data[index * mask.info.channels + mask.info.channels - 1] / 255;
      if (keep === 1) { original.copy(edited.data, offset, offset, offset + 4); continue; }
      const oldAlpha = original[offset + 3] / 255 * keep;
      const newAlpha = edited.data[offset + 3] / 255 * (1 - keep);
      const alpha = oldAlpha + newAlpha;
      for (let channel = 0; channel < 3; channel++) edited.data[offset + channel] = alpha ? Math.round((original[offset + channel] * oldAlpha + edited.data[offset + channel] * newAlpha) / alpha) : 0;
      edited.data[offset + 3] = Math.round(alpha * 255);
    }
    const combined = await sharp(edited.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    signal?.throwIfAborted();
    images.push({ ...image, type: "base64", value: combined.toString("base64"), mimeType: "image/png", actualParams: { ...image.actualParams, outputFormat: "png" } });
  }
  // Rebuild legacy data too: it must not expose the unmasked provider image.
  return { ...result, images, data: images.map(image => ({ b64_json: image.value, mime_type: image.mimeType, actualParams: image.actualParams })), maskStrategy: "client-composite" };
}

module.exports = { applyClientMask, maskCapabilityKey, unsupportedMaskError, validateMaskInputs };
