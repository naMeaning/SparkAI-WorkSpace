import { resolve } from "node:path";

function integer(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function requiredSecret(value, label) {
  const secret = String(value || "").trim();
  if (secret.length < 32) throw new Error(`${label} must contain at least 32 characters.`);
  return secret;
}

function upstreamUrl(value) {
  const parsed = new URL(String(value || ""));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("SPARKAI_NEW_API_UPSTREAM must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new Error("SPARKAI_NEW_API_UPSTREAM must not contain credentials.");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  return Object.freeze({
    host: String(env.SPARKAI_EXTENSION_HOST || "127.0.0.1").trim(),
    port: integer(env.SPARKAI_EXTENSION_PORT, 17910, 1, 65535, "SPARKAI_EXTENSION_PORT"),
    dataDir: resolve(cwd, String(env.SPARKAI_EXTENSION_DATA_DIR || "data")),
    adminToken: requiredSecret(env.SPARKAI_EXTENSION_ADMIN_TOKEN, "SPARKAI_EXTENSION_ADMIN_TOKEN"),
    hashSecret: requiredSecret(env.SPARKAI_EXTENSION_HASH_SECRET, "SPARKAI_EXTENSION_HASH_SECRET"),
    newApiUpstream: upstreamUrl(env.SPARKAI_NEW_API_UPSTREAM),
    imageConcurrency: integer(env.SPARKAI_IMAGE_CONCURRENCY, 2, 1, 10, "SPARKAI_IMAGE_CONCURRENCY"),
    imageTimeoutMs: integer(env.SPARKAI_IMAGE_TIMEOUT_MS, 10 * 60_000, 30_000, 30 * 60_000, "SPARKAI_IMAGE_TIMEOUT_MS"),
    maxRequestBytes: integer(env.SPARKAI_MAX_REQUEST_BYTES, 2 * 1024 * 1024, 1_024, 16 * 1024 * 1024, "SPARKAI_MAX_REQUEST_BYTES"),
    maxResultBytes: integer(env.SPARKAI_MAX_RESULT_BYTES, 96 * 1024 * 1024, 1_024, 256 * 1024 * 1024, "SPARKAI_MAX_RESULT_BYTES"),
    taskRetentionHours: integer(env.SPARKAI_TASK_RETENTION_HOURS, 24, 1, 24 * 30, "SPARKAI_TASK_RETENTION_HOURS"),
    trustProxy: String(env.SPARKAI_TRUST_PROXY || "").trim() === "1"
  });
}

export function upstreamImagesUrl(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  return /\/v1$/i.test(clean) ? `${clean}/images/generations` : `${clean}/v1/images/generations`;
}
