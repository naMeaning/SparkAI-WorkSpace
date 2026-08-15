#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  appendImageDeliverySpecification,
  imageDeliverySpecification,
  normalizeImageToolFrame,
  parseImageSizeValue,
  validateImageFrameFields
} = require("../runtime/image-frame.cjs");

const REPORT_VERSION = 1;
const LIVE_AUTH_PHRASE = "I_UNDERSTAND_REAL_MODEL_COST";
const SAFE_MODEL = /^[a-z0-9._:/-]{1,160}$/i;
const SAFE_BASE_URL = /^https?:\/\//i;
const DEFAULT_CASES = [
  { ratio: "1:1", resolution: "1K", quality: "auto" },
  { ratio: "3:4", resolution: "2K", quality: "high" },
  { ratio: "16:9", resolution: "4K", quality: "high" }
];

function cleanText(value, limit = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => cleanText(value, 160)).filter(Boolean))];
}

function normalizedBaseUrl(value) {
  const text = cleanText(value, 2048);
  if (!text || !SAFE_BASE_URL.test(text)) return "";
  try {
    const url = new URL(text);
    if (url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function publicEndpoint(value, fallbackPath = "/v1/images/generations") {
  const base = normalizedBaseUrl(value);
  if (!base) return { configured: false, origin: "", path: fallbackPath };
  try {
    const url = new URL(base);
    const basePath = url.pathname.replace(/\/+$/, "");
    const endpointPath = String(fallbackPath || "/").startsWith("/") ? String(fallbackPath || "/") : `/${fallbackPath}`;
    const pathLower = basePath.toLowerCase();
    const endpointLower = endpointPath.toLowerCase();
    const joinedPath = pathLower.endsWith("/v1") && endpointLower.startsWith("/v1/")
      ? `${basePath}${endpointPath.slice(3)}`
      : pathLower.endsWith(endpointLower)
        ? basePath
        : `${basePath}${endpointPath}`;
    return { configured: true, origin: url.origin, path: joinedPath || endpointPath };
  } catch {
    return { configured: false, origin: "", path: fallbackPath };
  }
}

function settingsFromJson(value) {
  const source = value && typeof value === "object" ? value : {};
  const bindings = Array.isArray(source.imageModelBindings) ? source.imageModelBindings : [];
  const models = uniqueStrings([
    source.imageModel,
    ...(Array.isArray(source.imageModelPool) ? source.imageModelPool : []),
    ...bindings.map((binding) => binding?.model)
  ]).filter((model) => SAFE_MODEL.test(model));
  const bindingByModel = new Map();
  for (const binding of bindings) {
    const model = cleanText(binding?.model, 160);
    if (!model || !SAFE_MODEL.test(model)) continue;
    const current = bindingByModel.get(model) || [];
    current.push({
      mode: cleanText(binding?.mode, 32) || "inherit",
      endpoint: publicEndpoint(binding?.baseUrl)
    });
    bindingByModel.set(model, current);
  }
  return {
    accessMode: cleanText(source.accessMode, 32) || "account",
    imageModel: cleanText(source.imageModel, 160),
    imageRatio: cleanText(source.imageRatio, 32) || "1:1",
    imageResolution: cleanText(source.imageResolution, 32) || "1K",
    imageSize: cleanText(source.imageSize, 64),
    imageQuality: cleanText(source.imageQuality, 32) || "auto",
    imageBaseUrl: normalizedBaseUrl(source.imageBaseUrl),
    accountBaseUrl: normalizedBaseUrl(source.accountBaseUrl),
    relayBaseUrl: normalizedBaseUrl(source.relayBaseUrl),
    imageTaskBaseUrl: normalizedBaseUrl(source.imageTaskBaseUrl),
    models,
    bindingByModel
  };
}

function endpointForSettings(settings, model, protocol = "images") {
  const binding = settings.bindingByModel.get(model)?.find((item) => item.endpoint.configured);
  const bindingBase = binding?.endpoint.origin
    ? `${binding.endpoint.origin}${binding.endpoint.path.replace(/\/images\/generations$/i, "")}`
    : settings.accessMode === "custom"
      ? settings.imageBaseUrl
      : settings.relayBaseUrl || settings.accountBaseUrl;
  const base = bindingBase || (settings.accessMode === "custom" ? settings.imageBaseUrl : settings.relayBaseUrl || settings.accountBaseUrl);
  const suffix = protocol === "task" ? "/v1/image-tasks" : "/v1/images/generations";
  return publicEndpoint(base, suffix);
}

function redactedSettingsSummary(settings, sourcePath = "") {
  return {
    source: sourcePath ? path.basename(sourcePath) : "inline",
    accessMode: settings.accessMode,
    modelCount: settings.models.length,
    models: settings.models,
    configuredEndpoints: {
      image: Boolean(settings.imageBaseUrl),
      account: Boolean(settings.accountBaseUrl),
      relay: Boolean(settings.relayBaseUrl),
      task: Boolean(settings.imageTaskBaseUrl)
    }
  };
}

function buildValidationPlan(rawSettings, options = {}) {
  const settings = settingsFromJson(rawSettings);
  const cases = Array.isArray(options.cases) && options.cases.length ? options.cases : DEFAULT_CASES;
  const models = settings.models.length ? settings.models : [settings.imageModel || "gpt-image-2"];
  const findings = [];
  const checks = {
    frameContract: true,
    payloadShape: true,
    noSecretFields: true,
    endpointSafety: true
  };
  const modelPlans = [];
  for (const model of models) {
    const endpoint = endpointForSettings(settings, model, options.protocol === "task" ? "task" : "images");
    const frames = [];
    for (const frameCase of cases) {
      const args = {
        model,
        ratio: frameCase.ratio,
        resolution: frameCase.resolution,
        quality: frameCase.quality,
        count: 1
      };
      try {
        validateImageFrameFields(args, "real-model-validation");
        const frame = normalizeImageToolFrame(args, {
          imageModel: model,
          imageRatio: settings.imageRatio,
          imageResolution: settings.imageResolution,
          imageSize: settings.imageSize
        });
        const prompt = appendImageDeliverySpecification(
          "A minimal validation image with one centered geometric product silhouette on a plain background.",
          frame
        );
        const payload = {
          model,
          prompt,
          size: frame.requestSize || frame.size,
          quality: frameCase.quality,
          n: 1
        };
        const serialized = JSON.stringify(payload);
        const forbidden = /(?:api[_-]?key|authorization|bearer|cookie|token|secret|password)/i.test(serialized);
        const parsedSize = parseImageSizeValue(payload.size);
        if (!parsedSize || !payload.model || !payload.prompt || forbidden) {
          checks.payloadShape = false;
          if (forbidden) checks.noSecretFields = false;
        }
        frames.push({
          ratio: frame.ratio,
          resolution: frame.resolution,
          quality: frameCase.quality,
          requestSize: frame.requestSize || frame.size,
          deliverySpecification: imageDeliverySpecification(frame),
          payloadSha256: createHash("sha256").update(serialized).digest("hex"),
          payloadKeys: Object.keys(payload).sort()
        });
      } catch (error) {
        checks.frameContract = false;
        findings.push({ level: "error", code: "FRAME_CONTRACT_INVALID", message: cleanText(error?.message || error) });
      }
    }
    if (!endpoint.configured) findings.push({ level: "warning", code: "ENDPOINT_NOT_CONFIGURED", model });
    modelPlans.push({ model, endpoint, frames });
  }
  if (!modelPlans.length) findings.push({ level: "error", code: "NO_IMAGE_MODELS", message: "没有可验证的图片模型。" });
  return {
    schemaVersion: REPORT_VERSION,
    mode: "dry-run",
    networkAttempted: false,
    authorizationRequired: true,
    settings: redactedSettingsSummary(settings, options.sourcePath),
    protocol: options.protocol === "task" ? "image-task-create" : "images-generations",
    models: modelPlans,
    checks,
    findings,
    nextAction: "如需真实请求，必须同时提供 --live、--confirm-network、--confirm-cost，并设置 NAIMAGE_REAL_MODEL_AUTH=I_UNDERSTAND_REAL_MODEL_COST。"
  };
}

function parseArgs(argv) {
  const options = { protocol: "images", live: false, confirmNetwork: false, confirmCost: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") options.live = true;
    else if (arg === "--confirm-network") options.confirmNetwork = true;
    else if (arg === "--confirm-cost") options.confirmCost = true;
    else if (arg === "--task") options.protocol = "task";
    else if (arg === "--settings") options.settingsPath = argv[++index];
    else if (arg === "--output") options.outputPath = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

function liveAuthorizationError(options, env = process.env) {
  if (!options.live) return "默认是 dry-run；未发起网络请求。";
  if (!options.confirmNetwork || !options.confirmCost || env.NAIMAGE_REAL_MODEL_AUTH !== LIVE_AUTH_PHRASE) {
    return "真实模型请求被拒绝：需要 --live、--confirm-network、--confirm-cost 以及 NAIMAGE_REAL_MODEL_AUTH 精确授权。";
  }
  return "";
}

async function runLiveProbe(plan, options, env = process.env, fetchImpl = globalThis.fetch) {
  const authorizationError = liveAuthorizationError(options, env);
  if (authorizationError) return { ...plan, authorizationRequired: true, error: authorizationError };
  if (typeof fetchImpl !== "function") return { ...plan, error: "当前运行时没有 fetch。" };
  const firstModel = plan.models[0];
  const firstFrame = firstModel?.frames?.[0];
  if (!firstModel || !firstFrame || !firstModel.endpoint.configured) {
    return { ...plan, error: "没有配置可用于真实探测的图片模型端点。" };
  }
  const baseUrl = env.NAIMAGE_REAL_MODEL_BASE_URL || "";
  const apiKey = env.NAIMAGE_REAL_MODEL_API_KEY || "";
  if (!normalizedBaseUrl(baseUrl) || !apiKey.trim()) {
    return { ...plan, error: "真实探测需要通过环境变量提供 NAIMAGE_REAL_MODEL_BASE_URL 和 NAIMAGE_REAL_MODEL_API_KEY；不会读取或打印桌面端密钥存储。" };
  }
  const endpoint = publicEndpoint(baseUrl, plan.protocol === "image-task-create" ? "/v1/image-tasks" : "/v1/images/generations");
  const url = `${endpoint.origin}${endpoint.path}`;
  const firstFrameSpec = plan.models[0].frames[0];
  const body = {
    model: firstModel.model,
    prompt: appendImageDeliverySpecification(
      "A minimal validation image with one centered geometric product silhouette on a plain background.",
      firstFrameSpec
    ),
    size: firstFrame.requestSize,
    quality: firstFrame.quality,
    n: 1
  };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const result = {
      ...plan,
      mode: "live",
      networkAttempted: true,
      authorizationRequired: false,
      liveResult: {
        status: response.status,
        ok: response.ok,
        elapsedMs: Date.now() - startedAt,
        responseKeys: parsed && typeof parsed === "object" ? Object.keys(parsed).sort() : [],
        imageCount: Array.isArray(parsed?.data) ? parsed.data.length : 0,
        responseBytes: Buffer.byteLength(text, "utf8")
      }
    };
    return result;
  } catch (error) {
    return { ...plan, mode: "live", networkAttempted: true, authorizationRequired: false, liveResult: { ok: false, elapsedMs: Date.now() - startedAt, error: cleanText(error?.message || error) } };
  } finally {
    clearTimeout(timeout);
  }
}

function printHelp() {
  process.stdout.write([
    "SparkAI WorkSpace 真实模型验收工具",
    "用法：node scripts/real-model-validation.mjs [--settings path] [--task] [--output path]",
    "默认只生成脱敏 dry-run 计划，不访问网络、不读取密钥 sidecar。",
    "真实探测需额外提供 --live --confirm-network --confirm-cost 和环境变量授权。"
  ].join("\n") + "\n");
}

export {
  DEFAULT_CASES,
  LIVE_AUTH_PHRASE,
  buildValidationPlan,
  endpointForSettings,
  liveAuthorizationError,
  parseArgs,
  publicEndpoint,
  runLiveProbe,
  settingsFromJson
};

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  const settingsPath = options.settingsPath
    ? path.resolve(options.settingsPath)
    : path.resolve(process.env.NAIMAGE_CONFIG_DIR || "config", "app-settings.json");
  let rawSettings = {};
  if (existsSync(settingsPath)) {
    try { rawSettings = JSON.parse(readFileSync(settingsPath, "utf8")); }
    catch (error) {
      process.stderr.write(`设置文件无法解析：${cleanText(error?.message || error)}\n`);
      process.exit(1);
    }
  }
  let report = buildValidationPlan(rawSettings, { ...options, sourcePath: settingsPath });
  if (options.live) report = await runLiveProbe(report, options);
  if (options.outputPath) writeFileSync(path.resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.error || report.checks?.frameContract === false || report.checks?.payloadShape === false) process.exitCode = 1;
}
