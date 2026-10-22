"use strict";

const { createHash } = require("node:crypto");
const { imageEditModeOperation } = require("../image-edit-modes.mjs");
const AI_EDIT_OPERATIONS = Object.freeze(["edit", "replace", "redraw", "cutout", "variants"]);
const AI_EDIT_LABELS = Object.freeze({ edit: "整图修改", replace: "替换背景", redraw: "局部修改", cutout: "AI 抠图", variants: "生成变体" });
const REGION_ROLES = new Set(["modify", "preserve", "annotation"]);
const failure = (code, message) => Object.assign(new Error(message), { code, errorCategory: "invalid_input" });

function normalizeAiEditOperation(value) {
  const operation = String(value || "edit").trim().toLowerCase();
  if (["expand", "outpaint", "outpainting"].includes(operation)) throw failure("IMAGE_EDIT_EXPAND_UNAVAILABLE", "扩图尚未开放：当前没有完整画幅合同。");
  const normalized = imageEditModeOperation(operation) || operation;
  if (!AI_EDIT_OPERATIONS.includes(normalized)) throw failure("IMAGE_EDIT_OPERATION_UNSUPPORTED", `不支持的 AI 编辑操作：${operation}`);
  return normalized;
}

function normalizeEditRegions(input = {}) {
  if (input.regions !== undefined && !Array.isArray(input.regions)) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区必须为数组。");
  const regions = input.regions || [];
  if (regions.length > 64) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区最多支持 64 个。");
  const ids = new Set();
  return regions.map((region) => {
    const x = Number(region?.x), y = Number(region?.y), width = Number(region?.width), height = Number(region?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > 100_000 || y + height > 100_000) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区坐标无效。");
    const role = region?.role === undefined ? "modify" : region.role;
    if (!REGION_ROLES.has(role)) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区用途无效。");
    const label = String(region?.label || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 320);
    const suppliedId = region?.regionId ?? region?.id;
    if (suppliedId !== undefined && (typeof suppliedId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(suppliedId))) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区身份无效。");
    const regionId = suppliedId || `region-${createHash("sha256").update(JSON.stringify([x, y, width, height, role, label])).digest("hex").slice(0, 24)}`;
    if (ids.has(regionId)) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区身份重复。");
    ids.add(regionId);
    return { regionId, x, y, width, height, role, ...(label ? { label } : {}) };
  });
}

function assertEditRegionBounds(regions, width, height) {
  if (regions.some(region => region.x + region.width > width || region.y + region.height > height)) throw failure("IMAGE_EDIT_REGION_INVALID", "AI 编辑选区超出原图尺寸；尚未发送图片请求。");
}

async function rgbaFor(value, sharp) {
  return sharp(value, { failOn: "error", limitInputPixels: 32_000_000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function verifyProtectedPixels(sourcePath, resultPath, regions = [], options = {}) {
  const sharp = options.sharp || require("sharp");
  const [source, result] = await Promise.all([rgbaFor(sourcePath, sharp), rgbaFor(resultPath, sharp)]);
  if (source.info.width !== result.info.width || source.info.height !== result.info.height) return { ok: false, code: "IMAGE_EDIT_DIMENSION_MISMATCH", changedPixels: -1 };
  const { width, height } = source.info;
  const preserve = normalizeEditRegions({ regions }).filter(region => region.role === "preserve");
  assertEditRegionBounds(preserve, width, height);
  const protectedPixels = new Uint8Array(width * height);
  if (options.mask) {
    const mask = await rgbaFor(options.mask, sharp);
    if (mask.info.width !== width || mask.info.height !== height) return { ok: false, code: "IMAGE_EDIT_DIMENSION_MISMATCH", changedPixels: -1 };
    for (let i = 0; i < protectedPixels.length; i++) if (mask.data[i * 4 + 3] === 255) protectedPixels[i] = 1;
  }
  for (const region of preserve) {
    for (let y = Math.floor(region.y); y < Math.ceil(region.y + region.height); y++) for (let x = Math.floor(region.x); x < Math.ceil(region.x + region.width); x++) protectedPixels[y * width + x] = 1;
  }
  let changedPixels = 0, protectedPixelCount = 0;
  for (let i = 0; i < protectedPixels.length; i++) {
    if (!protectedPixels[i]) continue;
    protectedPixelCount++;
    const offset = i * 4;
    for (let channel = 0; channel < 4; channel++) if (source.data[offset + channel] !== result.data[offset + channel]) { changedPixels++; break; }
  }
  return { ok: changedPixels === 0, changedPixels, protectedPixelCount, protectedRegionCount: preserve.length };
}

async function verifyAlphaSubject(value, options = {}) {
  const sharp = options.sharp || require("sharp");
  const decoded = await rgbaFor(value, sharp);
  const pixelCount = decoded.info.width * decoded.info.height;
  let transparentPixels = 0, visiblePixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const alpha = decoded.data[i * 4 + 3];
    if (alpha <= 8) transparentPixels++;
    if (alpha > 16) visiblePixels++;
  }
  const transparentRatio = transparentPixels / pixelCount, visibleRatio = visiblePixels / pixelCount;
  return { ok: transparentRatio >= (options.minTransparentRatio ?? 0.025) && visibleRatio >= (options.minVisibleRatio ?? 0.005), width: decoded.info.width, height: decoded.info.height, transparentPixels, visiblePixels, transparentRatio, visibleRatio };
}

module.exports = { AI_EDIT_LABELS, AI_EDIT_OPERATIONS, normalizeAiEditOperation, normalizeEditRegions, assertEditRegionBounds, verifyProtectedPixels, verifyAlphaSubject };
