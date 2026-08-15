import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeActivationCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

export function secretDigest(secret, namespace, value) {
  return createHmac("sha256", secret).update(`${namespace}\0${String(value || "")}`).digest("hex");
}

export function safeSecretEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createActivationCode() {
  let randomPart = "";
  for (let index = 0; index < 16; index += 1) randomPart += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `NAI-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8, 12)}-${randomPart.slice(12)}`;
}

export function activationCodeHint(code) {
  const normalized = normalizeActivationCode(code);
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

export function createLicenseToken() {
  return `lic_${randomBytes(48).toString("base64url")}`;
}

export function createImageTaskId() {
  return `imgtask_${randomBytes(18).toString("hex")}`;
}
