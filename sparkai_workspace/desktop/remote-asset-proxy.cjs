"use strict";

function proxyError(message, status, code) {
  const error = new Error(String(message || "Remote asset request failed."));
  error.status = status;
  error.code = code;
  return error;
}

function remoteUrlFromAssetProxy(value, maxEncodedLength = 16_384) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value || ""));
  } catch {
    throw proxyError("remote asset URL invalid", 400, "NAIMAGE_REMOTE_PROXY_URL_INVALID");
  }
  if (!/^(?:naimage|iiimage)-asset:$/.test(url.protocol) || url.hostname !== "remote") {
    throw proxyError("remote asset URL invalid", 400, "NAIMAGE_REMOTE_PROXY_URL_INVALID");
  }
  const encoded = url.pathname.replace(/^\/+/, "");
  if (!encoded || encoded.length > maxEncodedLength) {
    throw proxyError("remote asset URL invalid", 400, "NAIMAGE_REMOTE_PROXY_URL_INVALID");
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw proxyError("remote asset URL invalid", 400, "NAIMAGE_REMOTE_PROXY_URL_INVALID");
  }
}

async function loadRecordedRemoteAssetProxy(value, options = {}) {
  const remoteUrl = remoteUrlFromAssetProxy(value, options.maxEncodedLength);
  if (typeof options.isRecorded !== "function" || !await options.isRecorded(remoteUrl)) {
    throw proxyError("remote asset not recorded", 403, "NAIMAGE_REMOTE_PROXY_NOT_RECORDED");
  }
  if (typeof options.download !== "function") throw new TypeError("Remote asset proxy requires a download function.");
  const buffer = await options.download(remoteUrl);
  const format = typeof options.detectFormat === "function" ? options.detectFormat(buffer) : null;
  if (!format?.mimeType) {
    throw proxyError("remote asset format unsupported", 415, "NAIMAGE_REMOTE_PROXY_FORMAT_UNSUPPORTED");
  }
  await options.validateDimensions?.(buffer);
  if (typeof options.isDecodable === "function" && !await options.isDecodable(buffer)) {
    throw proxyError("remote asset decode failed", 422, "NAIMAGE_REMOTE_PROXY_DECODE_FAILED");
  }
  return { buffer, mimeType: format.mimeType, remoteUrl };
}

module.exports = {
  loadRecordedRemoteAssetProxy,
  remoteUrlFromAssetProxy
};
