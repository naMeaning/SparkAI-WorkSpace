"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SETTINGS_SECRET_PLACEHOLDER,
  createSettingsSecretStore
} = require("../desktop/settings-secret-store.cjs");

function xorBuffer(value) {
  return Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-settings-secrets-"));
const secretsPath = path.join(tempRoot, "app-settings.secrets.json");
const settingsPath = path.join(tempRoot, "app-settings.json");
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: xorBuffer,
  decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString("utf8")
};

try {
  const store = createSettingsSecretStore({ safeStorage, secretsPath });
  const input = {
    agentApiKey: "agent-secret-value",
    imageApiKey: "image-secret-value",
    imageModelBindings: [
      { model: "gpt-image-2", customBaseUrl: "https://example.test", customApiKey: "binding-secret-value" }
    ],
    imageModel: "gpt-image-2"
  };

  const persisted = store.persist(input);
  const ordinaryJson = JSON.stringify(persisted);
  assert.equal(ordinaryJson.includes("agent-secret-value"), false, "ordinary settings JSON must not contain the Agent API Key");
  assert.equal(ordinaryJson.includes("image-secret-value"), false, "ordinary settings JSON must not contain the image API Key");
  assert.equal(ordinaryJson.includes("binding-secret-value"), false, "ordinary settings JSON must not contain model binding keys");
  assert.equal(existsSync(secretsPath), true, "encrypted sidecar should be created");

  const sidecarText = readFileSync(secretsPath, "utf8");
  assert.equal(sidecarText.includes("agent-secret-value"), false, "encrypted sidecar must not expose plaintext secrets");
  assert.equal(sidecarText.includes("image-secret-value"), false, "encrypted sidecar must not expose plaintext secrets");
  assert.equal(sidecarText.includes("binding-secret-value"), false, "encrypted sidecar must not expose plaintext binding keys");

  const hydrated = store.hydrate(persisted);
  assert.equal(hydrated.agentApiKey, "agent-secret-value");
  assert.equal(hydrated.imageApiKey, "image-secret-value");
  assert.equal(hydrated.imageModelBindings[0].customApiKey, "binding-secret-value");
  assert.equal(hydrated.imageModelBindings[0].customBaseUrl, "https://example.test");

  const rendererSettings = store.publicSettings(hydrated);
  assert.equal(rendererSettings.agentApiKey, SETTINGS_SECRET_PLACEHOLDER);
  assert.equal(rendererSettings.imageApiKey, SETTINGS_SECRET_PLACEHOLDER);
  assert.equal(rendererSettings.imageModelBindings[0].customApiKey, SETTINGS_SECRET_PLACEHOLDER);

  const placeholderSave = store.restorePlaceholders(rendererSettings, hydrated);
  store.persist(placeholderSave);
  const restoredAfterPlaceholderSave = store.hydrate(persisted);
  assert.equal(restoredAfterPlaceholderSave.agentApiKey, "agent-secret-value", "placeholder saves must keep the current Agent API Key");
  assert.equal(restoredAfterPlaceholderSave.imageApiKey, "image-secret-value", "placeholder saves must keep the current image API Key");
  assert.equal(restoredAfterPlaceholderSave.imageModelBindings[0].customApiKey, "binding-secret-value", "placeholder saves must keep model binding keys");

  const sidecarBeforeRecovery = readFileSync(secretsPath, "utf8");
  writeFileSync(settingsPath, "{ damaged settings", "utf8");
  const recovery = store.recover({ imageModel: "gpt-image-2", imageModelBindings: persisted.imageModelBindings });
  writeFileSync(settingsPath, `${JSON.stringify(recovery.persisted, null, 2)}\n`, "utf8");
  assert.equal(readFileSync(secretsPath, "utf8"), sidecarBeforeRecovery, "recovering a damaged ordinary settings file must not rewrite or delete the secret sidecar");
  assert.equal(recovery.settings.agentApiKey, "agent-secret-value", "recovery should hydrate retained global secrets");
  assert.equal(recovery.settings.imageModelBindings[0].customApiKey, "binding-secret-value", "recovery should hydrate retained binding secrets");

  const cleared = {
    ...rendererSettings,
    agentApiKey: "",
    imageApiKey: "",
    imageModelBindings: rendererSettings.imageModelBindings.map((binding) => ({ ...binding, customApiKey: "" }))
  };
  store.persist(cleared);
  assert.equal(existsSync(secretsPath), false, "explicitly clearing all keys should remove the secret sidecar");

  console.log("settings secret store selftest passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
