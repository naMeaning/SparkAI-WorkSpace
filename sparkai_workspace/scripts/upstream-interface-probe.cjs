"use strict";

// Explicitly invoked local probe. Credentials are decrypted in Electron Main only.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createSettingsSecretStore } = require("../desktop/settings-secret-store.cjs");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");
const { createNewApiTransport } = require("../desktop/new-api-transport.cjs");
const { createAccountTokenService } = require("../desktop/account-token-service.cjs");
const { createNewApiAccountService, safeAccountText } = require("../desktop/new-api-account.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");

// Electron's OS crypt key is tied to the existing userData profile.
app.setName("naimage");
app.setPath("userData", path.join(process.env.APPDATA, "naimage"));

const liveImages = process.argv.includes("--live-images");
const imagesOnly = process.argv.includes("--images-only");
const editSource = process.argv.find(value => value.startsWith("--edit-source="))?.slice("--edit-source=".length);
const withMask = !editSource || process.argv.includes("--with-mask");
const outputDir = path.resolve(__dirname, "../.diagnostics", `upstream-probe-${new Date().toISOString().replaceAll(":", "-")}`);
const report = { ok: false, liveImages, calls: [], images: [] };
let transport;
let secrets = [];
function safeError(error) {
  let message = String(error?.message || "接口请求失败");
  for (const secret of secrets) if (secret) message = message.split(secret).join("[敏感信息已隐藏]");
  return { message: safeAccountText(message), code: safeAccountText(error?.code, 80), status: Number(error?.status) || undefined, ambiguous: error?.ambiguous === true || error?.unsafeToRetry === true };
}

async function main() {
  await app.whenReady();
  fs.mkdirSync(outputDir, { recursive: true });
  const configDir = path.join(process.env.APPDATA, "naimage", "data");
  const settingsPath = path.join(configDir, "app-settings.json");
  const store = createSettingsSecretStore({ safeStorage, secretsPath: path.join(configDir, "app-settings.secrets.json"), log: (message) => { report.secretReadError = safeAccountText(message); } });
  let settings = store.hydrate(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  secrets = [settings.serverAccessToken, settings.serverSessionCookie, settings.serverAuthSessionId, settings.imageApiKey, settings.agentApiKey, ...(settings.imageModelBindings || []).map(value => value.customApiKey)].filter(Boolean);
  report.configuration = { accessMode: settings.accessMode, model: settings.imageModel, encryptedSecretsAvailable: safeStorage.isEncryptionAvailable(), hasAccountIdentity: Boolean(settings.serverUserId), imageBindingCount: settings.imageModelBindings?.length || 0 };
  report.configuration.hasSessionCookie = Boolean(settings.serverSessionCookie);
  report.configuration.hasAccessToken = Boolean(settings.serverAccessToken);
  report.configuration.hasModelKey = Boolean(settings.imageModelBindings?.some(value => value.customApiKey));
  // Selection remains in memory. Auth rotation must be saved using the existing
  // encrypted store, otherwise a successful refresh invalidates the user's cookie.
  const readJson = () => settings;
  const authFields = ["serverAccessToken", "serverAccessExpiresAt", "serverSessionCookie", "serverAuthSessionId", "serverAuthProtocol"];
  let persistedAuth = Object.fromEntries(authFields.map(field => [field, settings[field]]));
  const writeJson = (_target, value) => {
    secrets = [...new Set([...secrets, value.serverAccessToken, value.serverSessionCookie, value.serverAuthSessionId].filter(secret => typeof secret === "string" && secret))];
    if (authFields.some(field => value[field] !== persistedAuth[field])) {
      const current = store.hydrate(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
      if (current.serverUserId !== settings.serverUserId || authFields.some(field => current[field] !== persistedAuth[field])) {
        throw Object.assign(new Error("账户会话已变化，探针未覆盖新的登录。"), { code: "NEW_API_SESSION_CHANGED" });
      }
      const patch = Object.fromEntries(authFields.map(field => [field, value[field]]));
      const persisted = store.persist({ ...current, ...patch });
      fs.writeFileSync(settingsPath, `${JSON.stringify(persisted, null, 2)}\n`);
      persistedAuth = patch;
      report.authRotationSaved = true;
    }
    settings = value;
  };
  transport = createNewApiTransport({ app, windowsCurlPath: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe") });
  const trackedFetch = async (url, options = {}) => {
    const endpoint = new URL(url).pathname;
    // The installed application owns refresh-cookie rotation. A separate
    // diagnostic process must not invalidate its session while inspecting it.
    if (endpoint.replace(/\/+$/, "") === "/api/user/auth/refresh") {
      report.accountRefreshSkipped = true;
      throw Object.assign(new Error("只读探针不轮换登录凭据，请在软件中重新登录后再检查。"), { code: "NEW_API_PROBE_RELOGIN_REQUIRED" });
    }
    const call = { method: options.method || "GET", endpoint, startedAt: new Date().toISOString() };
    report.calls.push(call);
    try {
      const response = await transport.newApiTransportFetch(url, options);
      call.status = response.status;
      return response;
    } catch (error) { call.error = safeError(error); throw error; }
  };
  let tokens;
  const client = createNewApiClient({
    accessPolicy: { customApiAccess: true }, defaultSettings: settings, migrateSettings: (value) => value,
    ensureLocalServer: async () => {}, isLocalServerUrl: () => false,
    newApiTransportFetch: trackedFetch,
    normalizeServerUrl: (value, fallback) => String(value || fallback || "").trim().replace(/\/+$/, ""),
    readJson, writeJson, settingsPath,
    resolveAccountApiCredentials: (value, id) => tokens.credentials(value, id)
  });
  tokens = createAccountTokenService({ ...client, defaultSettings: settings, migrateSettings: (value) => value, readJson, writeJson, settingsPath });
  const account = createNewApiAccountService({ ...client, getNewApiAuthEpoch: () => 0 });
  if (!imagesOnly && settings.accessMode === "account" && settings.serverSessionCookie) {
    const self = await client.newApiRequest(settings, "/api/user/self", { userAuth: true, retries: 0 });
    const summary = await account.summary(settings, self.data);
    const listed = await tokens.list(settings);
    const logs = await account.logs(settings, { page: 1, pageSize: 5 });
    report.account = {
      profileOk: Boolean(summary.user.id), balanceDisplay: summary.wallet.balanceDisplay,
      quotaDisplayType: summary.wallet.quotaPolicy.displayType,
      tokenCount: listed.tokens?.length || 0,
      enabledTokens: listed.tokens?.filter(value => value.status === 1).length || 0,
      logCount: logs.total, logPageSize: logs.logs.length, paginationAvailable: logs.page === 1
    };
  }
  if (settings.accessMode === "account" && !settings.serverSessionCookie) {
    report.account = { profileOk: false, unavailable: "配置中没有有效登录会话；未发送账户请求。" };
    const binding = (settings.imageModelBindings || []).find(value => value.model === settings.imageModel && value.customApiKey && value.customBaseUrl);
    if (!binding) throw new Error("账户会话不可用，当前模型也未配置独立的 Base URL 与 API Key。");
    settings = { ...settings, accessMode: "custom", imageBaseUrl: binding.customBaseUrl, imageApiKey: binding.customApiKey };
    report.configuration.temporaryCustomBindingProbe = true;
  }
  const modelBinding = (settings.imageModelBindings || []).find(value => value.model === settings.imageModel && value.customApiKey);
  const credentials = settings.accessMode === "custom" ? client.customApiCredentials(settings, "image", settings.imageModel)
    : modelBinding ? { apiKey: modelBinding.customApiKey } : await tokens.credentials(settings);
  if (imagesOnly) report.account = { skipped: true, reason: "仅验证当前独立图片模型密钥，不访问账户或刷新会话。" };
  secrets.push(credentials.apiKey);
  report.configuration.imageCredentialAvailable = Boolean(credentials.apiKey);
  if (liveImages) {
    const sharp = require("sharp");
    const imageService = createImageGenerationService({ ...client, accessPolicy: { customApiAccess: true } });
    const saveImage = async (result, name) => {
      const image = result.images?.[0];
      let bytes;
      if (image?.type === "base64") bytes = Buffer.from(image.value, "base64");
      else if (image?.type === "url") {
        const response = await trackedFetch(image.value, { signal: AbortSignal.timeout(60_000), maxResponseBytes: 96 * 1024 * 1024 });
        if (!response.ok) throw new Error("图片下载失败");
        bytes = Buffer.from(await response.arrayBuffer());
      } else throw new Error("接口未返回可识别图片");
      const meta = await sharp(bytes).metadata();
      const target = path.join(outputDir, `${name}.${meta.format === "jpeg" ? "jpg" : meta.format || "png"}`);
      fs.writeFileSync(target, bytes);
      report.images.push({ name, file: path.basename(target), bytes: bytes.length, width: meta.width, height: meta.height, format: meta.format, sha256: createHash("sha256").update(bytes).digest("hex") });
      return { path: target, width: meta.width, height: meta.height };
    };
    let source;
    if (editSource) {
      const meta = await sharp(path.resolve(editSource)).metadata();
      source = { path: path.resolve(editSource), width: meta.width, height: meta.height };
    } else {
      const generated = await imageService.generate(settings, { model: settings.imageModel || "gpt-image-2", mode: "generate", prompt: "A single solid red circle centered on a plain light gray background. Flat simple geometric graphic, no text, no gradients.", size: "1024x1024", quality: "low", n: 1, outputFormat: "png", signal: AbortSignal.timeout(180_000) });
      source = await saveImage(generated, "generated");
    }
    const circle = Buffer.from(`<svg width="${source.width}" height="${source.height}"><circle cx="${source.width / 2}" cy="${source.height / 2}" r="${Math.min(source.width, source.height) * 0.35}" fill="white"/></svg>`);
    const mask = await sharp({ create: { width: source.width, height: source.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite([{ input: circle, blend: "dest-out" }]).png().toBuffer();
    const maskPath = path.join(outputDir, "mask.png");
    fs.writeFileSync(maskPath, mask);
    const edited = await imageService.generate(settings, { model: settings.imageModel || "gpt-image-2", mode: "edit", prompt: "Change the centered red circle to a solid blue circle. Preserve the flat style and light gray background.", editImage: { path: source.path, name: "source.png", mimeType: "image/png" }, ...(withMask ? { maskImage: { path: maskPath, name: "mask.png", mimeType: "image/png" } } : {}), size: "1024x1024", quality: "low", n: 1, outputFormat: "png", signal: AbortSignal.timeout(180_000) });
    await saveImage(edited, withMask ? "mask-edited" : "edited");
    report.maskStrategy = edited.maskStrategy;
  }
  report.ok = true;
}
main().catch((error) => { report.error = safeError(error); process.exitCode = 1; }).finally(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, report: reportPath })}\n`);
  await transport?.stopActiveNewApiCurlTransports();
  app.exit(report.ok ? 0 : 1);
});
