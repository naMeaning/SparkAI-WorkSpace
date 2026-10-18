"use strict";
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const text = (value, max = 160) => String(value || "").replace(/[\u0000-\u001f]/g, " ").slice(0, max);
function imageInputManifest(editImage, references = [], snapshotHash = "", buffers) {
  const inputs = [...(editImage ? [editImage] : []), ...references];
  const entries = inputs.map((input, order) => {
    const bytes = buffers?.[order] || (input.path ? readFileSync(input.path) : null);
    const actualHash = bytes ? createHash("sha256").update(bytes).digest("hex") : text(input.contentHash, 128);
    const frozenHash = String(input.contentHash || "").toLowerCase();
    if (bytes && /^[a-f0-9]{64}$/.test(frozenHash) && frozenHash !== actualHash) {
      throw Object.assign(new Error("冻结素材的内容已经改变，尚未发送生图请求。请重新选择并确认素材。"), { code: "IMAGE_INPUT_CHANGED", errorCategory: "invalid_input" });
    }
    return { order, displayCode: text(input.displayCode, 40), assetId: text(input.assetId), nodeId: text(input.nodeId),
      assetIndex: Number.isInteger(input.assetIndex) ? input.assetIndex : null,
      contentHash: actualHash,
      role: editImage && order === 0 ? "source" : "reference", referenceRole: text(input.referenceRole || input.role, 80), purpose: text(input.purpose, 320) };
  });
  const manifest = { snapshotHash: /^scope-[a-f0-9]+$/.test(snapshotHash) ? snapshotHash : "", entries };
  return { ...manifest, hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}
module.exports = { imageInputManifest };
