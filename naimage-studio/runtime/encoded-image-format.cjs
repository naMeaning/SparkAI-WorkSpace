"use strict";

const IMAGE_FORMATS = Object.freeze({
  png: Object.freeze({ format: "png", extension: ".png", mimeType: "image/png" }),
  jpeg: Object.freeze({ format: "jpeg", extension: ".jpg", mimeType: "image/jpeg" }),
  webp: Object.freeze({ format: "webp", extension: ".webp", mimeType: "image/webp" })
});

function normalizeEncodedImageFormat(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "jpg" ? "jpeg" : normalized;
  if (Object.prototype.hasOwnProperty.call(IMAGE_FORMATS, alias)) return alias;
  const normalizedFallback = String(fallback || "").trim().toLowerCase().replace(/^\./, "");
  const fallbackAlias = normalizedFallback === "jpg" ? "jpeg" : normalizedFallback;
  return Object.prototype.hasOwnProperty.call(IMAGE_FORMATS, fallbackAlias) ? fallbackAlias : "";
}

function detectEncodedImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return IMAGE_FORMATS.png;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return IMAGE_FORMATS.jpeg;
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return IMAGE_FORMATS.webp;
  }
  return null;
}

function encodedImageFormatError(message, code, details = {}) {
  const error = new Error(String(message || "The generated image format is invalid."));
  error.code = code;
  error.failureKind = "validation";
  Object.assign(error, details);
  return error;
}

function requireEncodedImageFormat(buffer, expectedFormat = "") {
  const detected = detectEncodedImageFormat(buffer);
  if (!detected) {
    throw encodedImageFormatError(
      "The image provider returned bytes that are not PNG, JPEG, or WebP.",
      "NAIMAGE_IMAGE_OUTPUT_FORMAT_INVALID"
    );
  }
  const rawExpected = String(expectedFormat || "").trim();
  const expected = normalizeEncodedImageFormat(expectedFormat);
  if (rawExpected && !expected) {
    throw encodedImageFormatError(
      `The requested image output format is not supported: ${rawExpected}.`,
      "NAIMAGE_IMAGE_OUTPUT_FORMAT_UNSUPPORTED",
      { expectedFormat: rawExpected }
    );
  }
  if (expected && detected.format !== expected) {
    throw encodedImageFormatError(
      `The image provider returned ${detected.format}, but ${expected} was requested.`,
      "NAIMAGE_IMAGE_OUTPUT_FORMAT_MISMATCH",
      { expectedFormat: expected, actualFormat: detected.format }
    );
  }
  return detected;
}

module.exports = {
  IMAGE_FORMATS,
  detectEncodedImageFormat,
  normalizeEncodedImageFormat,
  requireEncodedImageFormat
};
