const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const SETTINGS_SECRET_PLACEHOLDER = "••••••••";
const MAX_SECRET_FILE_BYTES = 256 * 1024;
const MAX_SECRET_PAYLOAD_BYTES = 128 * 1024;
const MAX_API_KEY_LENGTH = 8_192;

function cleanSecret(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_API_KEY_LENGTH) : "";
}

function bindingSecretMap(bindings) {
  const result = {};
  if (!Array.isArray(bindings)) return result;
  for (const binding of bindings) {
    const model = typeof binding?.model === "string" ? binding.model.trim().slice(0, 160) : "";
    const secret = cleanSecret(binding?.customApiKey);
    if (model && secret && secret !== SETTINGS_SECRET_PLACEHOLDER) result[model.toLowerCase()] = secret;
  }
  return result;
}

function stripBindingSecrets(bindings) {
  return Array.isArray(bindings)
    ? bindings.map((binding) => {
        if (!binding || typeof binding !== "object") return binding;
        const { customApiKey: _customApiKey, ...rest } = binding;
        return rest;
      })
    : [];
}

function mergeBindingSecrets(bindings, bindingKeys) {
  const keys = bindingKeys && typeof bindingKeys === "object" ? bindingKeys : {};
  return Array.isArray(bindings)
    ? bindings.map((binding) => {
        if (!binding || typeof binding !== "object") return binding;
        const model = typeof binding.model === "string" ? binding.model.trim().toLowerCase() : "";
        const customApiKey = cleanSecret(keys[model]) || cleanSecret(binding.customApiKey);
        return customApiKey ? { ...binding, customApiKey } : { ...binding };
      })
    : [];
}

function publicBindingSettings(bindings) {
  return Array.isArray(bindings)
    ? bindings.map((binding) => {
        if (!binding || typeof binding !== "object") return binding;
        return cleanSecret(binding.customApiKey)
          ? { ...binding, customApiKey: SETTINGS_SECRET_PLACEHOLDER }
          : { ...binding };
      })
    : [];
}

function restoreBindingPlaceholders(bindings, currentBindings) {
  const currentBindingKeys = bindingSecretMap(currentBindings);
  return Array.isArray(bindings)
    ? bindings.map((binding) => {
        if (!binding || typeof binding !== "object" || binding.customApiKey !== SETTINGS_SECRET_PLACEHOLDER) return binding;
        const model = typeof binding.model === "string" ? binding.model.trim().toLowerCase() : "";
        const customApiKey = cleanSecret(currentBindingKeys[model]);
        const { customApiKey: _placeholder, ...rest } = binding;
        return customApiKey ? { ...rest, customApiKey } : rest;
      })
    : [];
}

function stripPlaintextSecrets(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    ...source,
    agentApiKey: "",
    imageApiKey: "",
    serverAccessToken: "",
    serverSessionCookie: "",
    serverAuthSessionId: "",
    agentModelBindings: stripBindingSecrets(source.agentModelBindings),
    imageModelBindings: stripBindingSecrets(source.imageModelBindings)
  };
}

function secretsFromSettings(settings) {
  return {
    version: 1,
    agentApiKey: cleanSecret(settings?.agentApiKey),
    imageApiKey: cleanSecret(settings?.imageApiKey),
    serverAccessToken: cleanSecret(settings?.serverAccessToken),
    serverSessionCookie: cleanSecret(settings?.serverSessionCookie),
    serverAuthSessionId: cleanSecret(settings?.serverAuthSessionId),
    agentModelBindingKeys: bindingSecretMap(settings?.agentModelBindings),
    imageModelBindingKeys: bindingSecretMap(settings?.imageModelBindings)
  };
}

function mergeSecrets(settings, secrets) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    ...source,
    agentApiKey: cleanSecret(secrets?.agentApiKey) || cleanSecret(source.agentApiKey),
    imageApiKey: cleanSecret(secrets?.imageApiKey) || cleanSecret(source.imageApiKey),
    serverAccessToken: cleanSecret(secrets?.serverAccessToken) || cleanSecret(source.serverAccessToken),
    serverSessionCookie: cleanSecret(secrets?.serverSessionCookie) || cleanSecret(source.serverSessionCookie),
    serverAuthSessionId: cleanSecret(secrets?.serverAuthSessionId) || cleanSecret(source.serverAuthSessionId),
    agentModelBindings: mergeBindingSecrets(source.agentModelBindings, secrets?.agentModelBindingKeys),
    imageModelBindings: mergeBindingSecrets(source.imageModelBindings, secrets?.imageModelBindingKeys)
  };
}

function hasSecrets(secrets) {
  return Boolean(
    cleanSecret(secrets?.agentApiKey)
    || cleanSecret(secrets?.imageApiKey)
    || cleanSecret(secrets?.serverAccessToken)
    || cleanSecret(secrets?.serverSessionCookie)
    || cleanSecret(secrets?.serverAuthSessionId)
    || Object.keys(secrets?.agentModelBindingKeys || {}).length
    || Object.keys(secrets?.imageModelBindingKeys || {}).length
  );
}

function createSettingsSecretStore({ safeStorage, secretsPath, log = () => undefined }) {
  if (!secretsPath) throw new TypeError("A settings secret sidecar path is required.");

  function encryptionAvailable() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  function readSecrets() {
    if (!existsSync(secretsPath) || !encryptionAvailable()) return null;
    try {
      const stats = require("node:fs").statSync(secretsPath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_SECRET_FILE_BYTES) throw new Error("secret sidecar size is invalid");
      const envelope = JSON.parse(readFileSync(secretsPath, "utf8"));
      if (Number(envelope?.version) !== 1 || envelope?.type !== "naimage-settings-secrets" || typeof envelope?.ciphertext !== "string") {
        throw new Error("secret sidecar schema is invalid");
      }
      const encrypted = Buffer.from(envelope.ciphertext, "base64");
      if (!encrypted.length || encrypted.length > MAX_SECRET_PAYLOAD_BYTES) throw new Error("encrypted secret payload is invalid");
      const decrypted = safeStorage.decryptString(encrypted);
      if (Buffer.byteLength(decrypted, "utf8") > MAX_SECRET_PAYLOAD_BYTES) throw new Error("decrypted secret payload is too large");
      const parsed = JSON.parse(decrypted);
      return {
        version: 1,
        agentApiKey: cleanSecret(parsed?.agentApiKey),
        imageApiKey: cleanSecret(parsed?.imageApiKey),
        serverAccessToken: cleanSecret(parsed?.serverAccessToken),
        serverSessionCookie: cleanSecret(parsed?.serverSessionCookie),
        serverAuthSessionId: cleanSecret(parsed?.serverAuthSessionId),
        agentModelBindingKeys: bindingSecretMap(Object.entries(parsed?.agentModelBindingKeys || {}).map(([model, customApiKey]) => ({ model, customApiKey }))),
        imageModelBindingKeys: bindingSecretMap(Object.entries(parsed?.imageModelBindingKeys || {}).map(([model, customApiKey]) => ({ model, customApiKey })))
      };
    } catch (error) {
      log(`settings secret read failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  function hydrate(settings) {
    const sidecarSecrets = readSecrets();
    return sidecarSecrets ? mergeSecrets(settings, sidecarSecrets) : settings;
  }

  function recover(settings) {
    const persisted = stripPlaintextSecrets(settings);
    return { persisted, settings: hydrate(persisted) };
  }

  function persist(settings) {
    const secrets = secretsFromSettings(settings);
    const sanitized = stripPlaintextSecrets(settings);
    if (!hasSecrets(secrets)) {
      try { rmSync(secretsPath, { force: true }); } catch { }
      return sanitized;
    }
    if (!encryptionAvailable()) {
      const error = new Error("操作系统安全存储当前不可用，API Key 未保存。请重新登录 Windows 后再试。");
      error.code = "NAIMAGE_SAFE_STORAGE_UNAVAILABLE";
      throw error;
    }
    const plaintext = JSON.stringify(secrets);
    if (Buffer.byteLength(plaintext, "utf8") > MAX_SECRET_PAYLOAD_BYTES) throw new Error("API Key 配置过大，无法安全保存。");
    const encrypted = safeStorage.encryptString(plaintext);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_SECRET_PAYLOAD_BYTES) {
      throw new Error("操作系统安全存储返回了无效结果。");
    }
    mkdirSync(path.dirname(secretsPath), { recursive: true });
    const tempPath = `${secretsPath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify({
      version: 1,
      type: "naimage-settings-secrets",
      ciphertext: encrypted.toString("base64")
    }, null, 2)}\n`, "utf8");
    renameSync(tempPath, secretsPath);
    return sanitized;
  }

  function publicSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      ...source,
      agentApiKey: cleanSecret(source.agentApiKey) ? SETTINGS_SECRET_PLACEHOLDER : "",
      imageApiKey: cleanSecret(source.imageApiKey) ? SETTINGS_SECRET_PLACEHOLDER : "",
      serverAccessToken: "",
      serverSessionCookie: "",
      serverAuthSessionId: "",
      agentModelBindings: publicBindingSettings(source.agentModelBindings),
      imageModelBindings: publicBindingSettings(source.imageModelBindings)
    };
  }

  function restorePlaceholders(incoming, current) {
    const source = incoming && typeof incoming === "object" ? incoming : {};
    return {
      ...source,
      agentApiKey: source.agentApiKey === SETTINGS_SECRET_PLACEHOLDER ? cleanSecret(current?.agentApiKey) : source.agentApiKey,
      imageApiKey: source.imageApiKey === SETTINGS_SECRET_PLACEHOLDER ? cleanSecret(current?.imageApiKey) : source.imageApiKey,
      serverAccessToken: cleanSecret(current?.serverAccessToken),
      serverSessionCookie: cleanSecret(current?.serverSessionCookie),
      serverAuthSessionId: cleanSecret(current?.serverAuthSessionId),
      agentModelBindings: restoreBindingPlaceholders(source.agentModelBindings, current?.agentModelBindings),
      imageModelBindings: restoreBindingPlaceholders(source.imageModelBindings, current?.imageModelBindings)
    };
  }

  return { hydrate, persist, publicSettings, recover, restorePlaceholders, sanitize: stripPlaintextSecrets };
}

module.exports = {
  SETTINGS_SECRET_PLACEHOLDER,
  createSettingsSecretStore,
  mergeSecrets,
  secretsFromSettings,
  stripPlaintextSecrets
};
