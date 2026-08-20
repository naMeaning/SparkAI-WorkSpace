import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_ENCRYPTION_VERSION = "v1";

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

function activationCodeEncryptionKey(secret) {
  // Derive a separate purpose-bound key from the stable service secret. This
  // keeps the HMAC identity namespace and encrypted admin material isolated.
  return createHmac("sha256", String(secret || ""))
    .update("sparkai-extension\0activation-code-encryption\0v1")
    .digest();
}

function encodePart(value) {
  return Buffer.from(value).toString("base64url");
}

function decodePart(value) {
  return Buffer.from(String(value || ""), "base64url");
}

export function encryptActivationCode(code, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", activationCodeEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizeActivationCode(code), "utf8"),
    cipher.final()
  ]);
  return [
    CODE_ENCRYPTION_VERSION,
    encodePart(iv),
    encodePart(cipher.getAuthTag()),
    encodePart(ciphertext)
  ].join(".");
}

export function decryptActivationCode(payload, secret) {
  const parts = String(payload || "").split(".");
  if (parts.length !== 4 || parts[0] !== CODE_ENCRYPTION_VERSION) {
    throw new Error("Unsupported activation code ciphertext.");
  }
  const iv = decodePart(parts[1]);
  const authTag = decodePart(parts[2]);
  const ciphertext = decodePart(parts[3]);
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid activation code ciphertext.");
  }
  const decipher = createDecipheriv("aes-256-gcm", activationCodeEncryptionKey(secret), iv);
  decipher.setAuthTag(authTag);
  return normalizeActivationCode(Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8"));
}

export function createLicenseToken() {
  return `lic_${randomBytes(48).toString("base64url")}`;
}

export function createImageTaskId() {
  return `imgtask_${randomBytes(18).toString("hex")}`;
}
