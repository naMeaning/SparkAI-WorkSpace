"use strict";

const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { assertEditRegionBounds, verifyProtectedPixels } = require("../runtime/image-generation/edit-capabilities.cjs");

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
  const [sourceMeta, maskMeta] = await Promise.all([sharp(source, { failOn: "error", limitInputPixels: 32_000_000 }).metadata(), sharp(mask, { failOn: "error", limitInputPixels: 32_000_000 }).metadata()]);
  if (maskMeta.format !== "png" || !maskMeta.hasAlpha || maskMeta.width !== sourceMeta.width || maskMeta.height !== sourceMeta.height) {
    throw Object.assign(new Error("蒙版必须带透明通道，并与第一张来源图片尺寸一致。"), { code: "IMAGE_INVALID_INPUT" });
  }
  if (sourceMeta.width * sourceMeta.height > 32_000_000) throw Object.assign(new Error("蒙版编辑来源超过客户端像素上限。"), { code: "IMAGE_INVALID_INPUT" });
  // Metadata alone cannot prove that the PNG's compressed pixel data is valid.
  await Promise.all([sharp(source, { failOn: "error", limitInputPixels: 32_000_000 }).raw().toBuffer(), sharp(mask, { failOn: "error", limitInputPixels: 32_000_000 }).raw().toBuffer()]);
  return { width: sourceMeta.width, height: sourceMeta.height };
}

async function prepareRegionMask(inputs, regions = []) {
  if (!regions.length) return inputs;
  const source = bufferFor(inputs.editImages[0]);
  if (!source.length) throw Object.assign(new Error("AI 编辑选区需要对应来源图片。"), { code: "IMAGE_INVALID_INPUT" });
  const metadata = await sharp(source, { failOn: "error", limitInputPixels: 32_000_000 }).metadata();
  const { width, height } = metadata;
  assertEditRegionBounds(regions, width, height);
  const selections = regions.filter(region => region.role !== "annotation");
  if (!selections.length) return inputs;
  let data;
  if (inputs.mask) {
    await validateMaskInputs(inputs);
    data = await sharp(bufferFor(inputs.mask)).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  } else {
    // A modify selection protects everything outside it; a preserve-only
    // selection permits editing everywhere else.
    data = Buffer.alloc(width * height * 4, selections.some(region => region.role === "modify") ? 255 : 0);
  }
  for (const role of ["modify", "preserve"]) for (const region of selections.filter(value => value.role === role)) {
    for (let y = Math.floor(region.y); y < Math.ceil(region.y + region.height); y++) for (let x = Math.floor(region.x); x < Math.ceil(region.x + region.width); x++) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = role === "preserve" ? 255 : 0;
    }
  }
  const buffer = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { ...inputs, mask: { buffer, base64: buffer.toString("base64"), mimeType: "image/png", name: "edit-regions.png" }, regions };
}

async function applyClientMask(result, inputs, downloadImage, signal) {
  await validateMaskInputs(inputs);
  const source = bufferFor(inputs.editImages[0]);
  const mask = await sharp(bufferFor(inputs.mask)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = mask.info;
  const original = await sharp(source).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  const images = [];
  for (const image of result.images) {
    signal?.throwIfAborted();
    const bytes = image.type === "base64" ? Buffer.from(image.value, "base64") : await downloadImage(image.value, signal);
    signal?.throwIfAborted();
    const edited = await sharp(bytes, { failOn: "error", limitInputPixels: 32_000_000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (edited.info.width !== width || edited.info.height !== height) throw Object.assign(new Error("图片结果与原图尺寸不同，无法保证保护区像素一致；已停止本地合成。"), { code: "IMAGE_EDIT_DIMENSION_MISMATCH" });
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
    const protection = await verifyProtectedPixels(source, combined, inputs.regions || [], { mask: bufferFor(inputs.mask), sharp });
    if (!protection.ok) throw Object.assign(new Error("本地合成后的保护区域像素校验失败。"), { code: "IMAGE_EDIT_PROTECTION_FAILED" });
    signal?.throwIfAborted();
    const value = combined.toString("base64");
    images.push({ ...image, type: "base64", value, dataUrl: `data:image/png;base64,${value}`, mimeType: "image/png",
      localProcessing: { ...image.localProcessing, maskComposite: { width, height, protectedPixelCount: protection.protectedPixelCount, changedPixels: protection.changedPixels, verified: true }, outputFormat: "png" } });
  }
  // Rebuild legacy data too: it must not expose the unmasked provider image.
  return { ...result, images, data: images.map(image => ({ b64_json: image.value, mime_type: image.mimeType, actualParams: image.actualParams, localProcessing: image.localProcessing })), maskStrategy: "client-composite" };
}

module.exports = { applyClientMask, prepareRegionMask, maskCapabilityKey, unsupportedMaskError, validateMaskInputs };
