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
    serverAccessToken: "account-access-secret",
    serverSessionCookie: "new_api_refresh=refresh-secret",
    serverAuthSessionId: "auth-session-secret",
    agentModelBindings: [
      { model: "gpt-private", customBaseUrl: "https://agent.example.test", customApiKey: "agent-binding-secret-value" }
    ],
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
  assert.equal(ordinaryJson.includes("agent-binding-secret-value"), false, "ordinary settings JSON must not contain Agent model binding keys");
  assert.equal(ordinaryJson.includes("account-access-secret"), false, "ordinary settings JSON must not contain account access tokens");
  assert.equal(ordinaryJson.includes("refresh-secret"), false, "ordinary settings JSON must not contain account refresh cookies");
  assert.equal(ordinaryJson.includes("auth-session-secret"), false, "ordinary settings JSON must not contain account auth session IDs");
  assert.equal(existsSync(secretsPath), true, "encrypted sidecar should be created");

  const sidecarText = readFileSync(secretsPath, "utf8");
  assert.equal(sidecarText.includes("agent-secret-value"), false, "encrypted sidecar must not expose plaintext secrets");
  assert.equal(sidecarText.includes("image-secret-value"), false, "encrypted sidecar must not expose plaintext secrets");
  assert.equal(sidecarText.includes("binding-secret-value"), false, "encrypted sidecar must not expose plaintext binding keys");
  assert.equal(sidecarText.includes("agent-binding-secret-value"), false, "encrypted sidecar must not expose plaintext Agent binding keys");
  assert.equal(sidecarText.includes("account-access-secret"), false, "encrypted sidecar must not expose plaintext account access tokens");
  assert.equal(sidecarText.includes("refresh-secret"), false, "encrypted sidecar must not expose plaintext refresh cookies");
  assert.equal(sidecarText.includes("auth-session-secret"), false, "encrypted sidecar must not expose plaintext auth session IDs");

  const hydrated = store.hydrate(persisted);
  assert.equal(hydrated.agentApiKey, "agent-secret-value");
  assert.equal(hydrated.imageApiKey, "image-secret-value");
  assert.equal(hydrated.serverAccessToken, "account-access-secret");
  assert.equal(hydrated.serverSessionCookie, "new_api_refresh=refresh-secret");
  assert.equal(hydrated.serverAuthSessionId, "auth-session-secret");
  assert.equal(hydrated.agentModelBindings[0].customApiKey, "agent-binding-secret-value");
  assert.equal(hydrated.agentModelBindings[0].customBaseUrl, "https://agent.example.test");
  assert.equal(hydrated.imageModelBindings[0].customApiKey, "binding-secret-value");
  assert.equal(hydrated.imageModelBindings[0].customBaseUrl, "https://example.test");

  const rendererSettings = store.publicSettings(hydrated);
  assert.equal(rendererSettings.agentApiKey, SETTINGS_SECRET_PLACEHOLDER);
  assert.equal(rendererSettings.imageApiKey, SETTINGS_SECRET_PLACEHOLDER);
  assert.equal(rendererSettings.serverAccessToken, "");
  assert.equal(rendererSettings.serverSessionCookie, "");
  assert.equal(rendererSettings.serverAuthSessionId, "");
  assert.equal(rendererSettings.agentModelBindings[0].customApiKey, SETTINGS_SECRET_PLACEHOLDER);
  assert.equal(rendererSettings.imageModelBindings[0].customApiKey, SETTINGS_SECRET_PLACEHOLDER);

  const placeholderSave = store.restorePlaceholders(rendererSettings, hydrated);
  store.persist(placeholderSave);
  const restoredAfterPlaceholderSave = store.hydrate(persisted);
  assert.equal(restoredAfterPlaceholderSave.agentApiKey, "agent-secret-value", "placeholder saves must keep the current Agent API Key");
  assert.equal(restoredAfterPlaceholderSave.imageApiKey, "image-secret-value", "placeholder saves must keep the current image API Key");
  assert.equal(restoredAfterPlaceholderSave.serverAccessToken, "account-access-secret", "Renderer settings saves must keep the Main-owned account access token");
  assert.equal(restoredAfterPlaceholderSave.serverSessionCookie, "new_api_refresh=refresh-secret", "Renderer settings saves must keep the Main-owned refresh cookie");
  assert.equal(restoredAfterPlaceholderSave.serverAuthSessionId, "auth-session-secret", "Renderer settings saves must keep the Main-owned auth session ID");
  assert.equal(restoredAfterPlaceholderSave.agentModelBindings[0].customApiKey, "agent-binding-secret-value", "placeholder saves must keep Agent model binding keys");
  assert.equal(restoredAfterPlaceholderSave.imageModelBindings[0].customApiKey, "binding-secret-value", "placeholder saves must keep model binding keys");

  const sidecarBeforeRecovery = readFileSync(secretsPath, "utf8");
  writeFileSync(settingsPath, "{ damaged settings", "utf8");
  const recovery = store.recover({
    agentModel: "gpt-private",
    agentModelBindings: persisted.agentModelBindings,
    imageModel: "gpt-image-2",
    imageModelBindings: persisted.imageModelBindings
  });
  writeFileSync(settingsPath, `${JSON.stringify(recovery.persisted, null, 2)}\n`, "utf8");
  assert.equal(readFileSync(secretsPath, "utf8"), sidecarBeforeRecovery, "recovering a damaged ordinary settings file must not rewrite or delete the secret sidecar");
  assert.equal(recovery.settings.agentApiKey, "agent-secret-value", "recovery should hydrate retained global secrets");
  assert.equal(recovery.settings.serverAccessToken, "account-access-secret", "recovery should hydrate the retained account access token");
  assert.equal(recovery.settings.serverSessionCookie, "new_api_refresh=refresh-secret", "recovery should hydrate the retained refresh cookie");
  assert.equal(recovery.settings.serverAuthSessionId, "auth-session-secret", "recovery should hydrate the retained auth session ID");
  assert.equal(recovery.settings.agentModelBindings[0].customApiKey, "agent-binding-secret-value", "recovery should hydrate retained Agent binding secrets");
  assert.equal(recovery.settings.imageModelBindings[0].customApiKey, "binding-secret-value", "recovery should hydrate retained binding secrets");

  const cleared = {
    ...rendererSettings,
    agentApiKey: "",
    imageApiKey: "",
    agentModelBindings: rendererSettings.agentModelBindings.map((binding) => ({ ...binding, customApiKey: "" })),
    imageModelBindings: rendererSettings.imageModelBindings.map((binding) => ({ ...binding, customApiKey: "" }))
  };
  store.persist(cleared);
  assert.equal(existsSync(secretsPath), false, "explicitly clearing all keys should remove the secret sidecar");

  console.log("settings secret store selftest passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
