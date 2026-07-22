import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { removeConnectedBorderBackgroundPixels } = require("../background-removal.cjs");

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return Array.from(data.slice(offset, offset + 4));
}

const width = 48;
const height = 48;
const data = new Uint8ClampedArray(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  const offset = index * 4;
  data[offset] = 255;
  data[offset + 1] = 0;
  data[offset + 2] = 255;
  data[offset + 3] = 255;
}

for (let y = 10; y < 38; y += 1) {
  for (let x = 11; x < 37; x += 1) {
    const offset = (y * width + x) * 4;
    const edge = x === 11 || x === 36 || y === 10 || y === 37;
    data[offset] = edge ? 222 : 28;
    data[offset + 1] = edge ? 70 : 104;
    data[offset + 2] = edge ? 218 : 184;
    data[offset + 3] = 255;
  }
}

// A fully enclosed key-colour island reproduces the real Image 2 failure that
// border-only flood fill could not remove.
for (let y = 20; y < 25; y += 1) {
  for (let x = 21; x < 27; x += 1) {
    const offset = (y * width + x) * 4;
    data[offset] = 247;
    data[offset + 1] = 18;
    data[offset + 2] = 244;
  }
}

// Gold detail is intentionally warm but not magenta and must survive.
for (let y = 28; y < 33; y += 1) {
  for (let x = 20; x < 29; x += 1) {
    const offset = (y * width + x) * 4;
    data[offset] = 228;
    data[offset + 1] = 174;
    data[offset + 2] = 54;
  }
}

const report = removeConnectedBorderBackgroundPixels(data, width, height);
assert.equal(report.usedExistingAlpha, false);
assert(report.transparentRatio > 0.62, `expected transparent background, got ${report.transparentRatio}`);
assert(report.remainingChromaRatio <= 0.002, `expected no visible chroma residue, got ${report.remainingChromaRatio}`);
assert.equal(pixel(data, width, 2, 2)[3], 0, "outer key background should be transparent");
assert.equal(pixel(data, width, 23, 22)[3], 0, "enclosed key island should be transparent");
assert(pixel(data, width, 15, 15)[3] > 180, "blue subject should remain visible");
assert(pixel(data, width, 24, 30)[3] > 240, "gold detail should remain opaque");

const alphaData = new Uint8ClampedArray(20 * 20 * 4);
for (let y = 7; y < 13; y += 1) {
  for (let x = 7; x < 13; x += 1) {
    const offset = (y * 20 + x) * 4;
    alphaData[offset] = 22;
    alphaData[offset + 1] = 118;
    alphaData[offset + 2] = 202;
    alphaData[offset + 3] = 255;
  }
}
const alphaReport = removeConnectedBorderBackgroundPixels(alphaData, 20, 20);
assert.equal(alphaReport.usedExistingAlpha, true, "native alpha should be preserved without chroma processing");
assert.equal(pixel(alphaData, 20, 9, 9)[3], 255);

// Image2 can bake a transparency checkerboard into an opaque PNG.  The old
// single-median flood treated pale skin and white merchandise as background.
// This fixture deliberately places both colours close to the checker palette
// and across opposite squares so spatial continuity must protect them.
const checkerWidth = 160;
const checkerHeight = 160;
const checkerCell = 16;
const checkerData = new Uint8ClampedArray(checkerWidth * checkerHeight * 4);
for (let y = 0; y < checkerHeight; y += 1) {
  for (let x = 0; x < checkerWidth; x += 1) {
    const offset = (y * checkerWidth + x) * 4;
    const dark = (Math.floor(x / checkerCell) + Math.floor(y / checkerCell)) % 2 === 0;
    const transition = (x > 0 && x % checkerCell === 0) || (y > 0 && y % checkerCell === 0);
    const value = transition ? 245 : dark ? 236 : 254;
    checkerData[offset] = value;
    checkerData[offset + 1] = value;
    checkerData[offset + 2] = value;
    checkerData[offset + 3] = 255;
  }
}

for (let y = 34; y < 132; y += 1) {
  for (let x = 38; x < 102; x += 1) {
    const offset = (y * checkerWidth + x) * 4;
    checkerData[offset] = 228;
    checkerData[offset + 1] = 207;
    checkerData[offset + 2] = 196;
  }
}
for (let y = 54; y < 90; y += 1) {
  for (let x = 54; x < 92; x += 1) {
    const offset = (y * checkerWidth + x) * 4;
    checkerData[offset] = 238;
    checkerData[offset + 1] = 234;
    checkerData[offset + 2] = 232;
  }
}
for (let y = 50; y < 102; y += 1) {
  for (let x = 106; x < 144; x += 1) {
    const ellipse = ((x - 125) / 19) ** 2 + ((y - 76) / 26) ** 2;
    if (ellipse > 1) continue;
    const offset = (y * checkerWidth + x) * 4;
    checkerData[offset] = 253;
    checkerData[offset + 1] = 252;
    checkerData[offset + 2] = 250;
  }
}
const checkerReport = removeConnectedBorderBackgroundPixels(checkerData, checkerWidth, checkerHeight);
assert.equal(checkerReport.checkerboardDetected, true, "opaque checker plate should be detected");
assert(Math.abs(Number(checkerReport.checkerboardCellWidth) - checkerCell) <= 1);
assert(Math.abs(Number(checkerReport.checkerboardCellHeight) - checkerCell) <= 1);
assert(checkerReport.checkerboardConfidence! >= 0.9, `checker confidence too low: ${checkerReport.checkerboardConfidence}`);
assert.equal(checkerReport.checkerboardSuspiciousRemovedPixels, 0, "non-checker colours must never be removed");
assert(checkerReport.checkerboardProtectedPixels > 0, "foreground continuity guard should be exercised");
assert.equal(pixel(checkerData, checkerWidth, 8, 8)[3], 0, "dark checker square should be transparent");
assert.equal(pixel(checkerData, checkerWidth, 24, 8)[3], 0, "light checker square should be transparent");
assert.equal(pixel(checkerData, checkerWidth, 16, 8)[3], 0, "compressed checker boundary should be transparent");
assert(pixel(checkerData, checkerWidth, 70, 70)[3] > 245, "pale skin highlight must remain opaque");
assert(pixel(checkerData, checkerWidth, 125, 76)[3] > 245, "white flower must remain opaque");

console.log(JSON.stringify({ ok: true, chroma: report, nativeAlpha: alphaReport, checkerboard: checkerReport }, null, 2));
