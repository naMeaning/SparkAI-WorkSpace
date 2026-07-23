import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultEvidenceDir = path.join(
  repoRoot,
  ".diagnostics",
  `production-image-edit-${new Date().toISOString().replaceAll(":", "-")}`,
);
const evidenceDir = path.resolve(process.env.NAIMAGE_EDIT_E2E_OUTPUT || defaultEvidenceDir);
const settingsPath = path.resolve(
  process.env.NAIMAGE_SETTINGS_PATH || path.join(repoRoot, "config", "app-settings.json"),
);
const sourcePath = path.resolve(
  process.env.NAIMAGE_EDIT_SOURCE
    || path.join(
      repoRoot,
      ".diagnostics",
      "production-e2e-20260720T0315Z",
      "managed-image-generation.png",
    ),
);

const timeoutMs = Number(process.env.NAIMAGE_EDIT_TIMEOUT_MS || 300_000);
const basePrompt = process.env.NAIMAGE_EDIT_PROMPT || [
  "编辑这张竖版东方审美成年女性近景主视觉，严格保留人物身份、脸部结构、极近景构图和黑金高级质感。",
  "只将主视觉中的金色能量光弧调整为克制的翡翠青绿色，并增加一枚很小的朱红色东方印章作为视觉平衡。",
  "不要改变人物年龄、五官、姿态和画面比例，不要增加文字、水印、兽耳或杂乱装饰。",
].join("");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少 ${name}，无法执行生产图片编辑 E2E。`);
  }
  return value.trim();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "non_json_response", message: text.slice(0, 240) } };
  }
}

function errorCode(payload) {
  return payload?.error?.code || payload?.code || payload?.error_code || null;
}

function responseImageBuffer(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (typeof first?.b64_json === "string" && first.b64_json.length > 0) {
    return Buffer.from(first.b64_json, "base64");
  }
  return null;
}

function responseReplayIdentity(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  return JSON.stringify({
    created: payload?.created ?? null,
    usage: payload?.usage ?? null,
    b64Sha256: typeof first?.b64_json === "string"
      ? sha256(Buffer.from(first.b64_json, "base64"))
      : null,
    url: typeof first?.url === "string" ? first.url : null,
    revisedPrompt: first?.revised_prompt ?? null,
  });
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const accountBaseUrl = requiredString(settings.accountBaseUrl || settings.serverUrl, "accountBaseUrl").replace(/\/+$/, "");
  const relayBaseUrl = String(settings.relayBaseUrl || accountBaseUrl).trim().replace(/\/+$/, "");
  const sessionCookie = requiredString(settings.serverSessionCookie, "serverSessionCookie");
  const userId = requiredString(String(settings.serverUserId || ""), "serverUserId");
  const model = requiredString(settings.imageModel || "gpt-image-2", "imageModel");
  const source = await readFile(sourcePath);
  const sourceName = path.basename(sourcePath);
  const endpoint = `${relayBaseUrl}/naimage/v1/images/edits`;
  const idempotencyKey = `naimage-production-edit-${Date.now()}-${randomUUID()}`;
  const requestHeaders = {
    Cookie: sessionCookie,
    "New-Api-User": userId,
    "Idempotency-Key": idempotencyKey,
  };

  const buildForm = (prompt) => {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", "1024x1536");
    form.set("quality", "high");
    form.set("n", "1");
    form.set("output_format", "png");
    form.set("input_fidelity", "high");
    form.append("image[]", new Blob([source], { type: "image/png" }), sourceName);
    return form;
  };

  const request = async (prompt) => {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: buildForm(prompt),
    });
    const text = await response.text();
    return {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      payload: safeJson(text),
    };
  };

  const first = await request(basePrompt);
  if (first.status !== 200) {
    throw new Error(`生产图片编辑首次请求失败：HTTP ${first.status} / ${errorCode(first.payload) || "unknown"}`);
  }

  const replay = await request(basePrompt);
  const conflict = await request(`${basePrompt} 将翡翠青绿色改为宝石蓝色。`);
  const firstImage = responseImageBuffer(first.payload);
  if (!firstImage?.length) {
    throw new Error("生产图片编辑响应未包含可落盘的 b64_json 成果。");
  }

  const replayExact = responseReplayIdentity(first.payload) === responseReplayIdentity(replay.payload);
  const conflictCode = errorCode(conflict.payload);
  if (replay.status !== 200 || !replayExact) {
    throw new Error(`生产图片编辑幂等重放失败：HTTP ${replay.status} / exact=${replayExact}`);
  }
  if (conflict.status !== 409 || conflictCode !== "idempotency_payload_mismatch") {
    throw new Error(`生产图片编辑幂等冲突未正确拒绝：HTTP ${conflict.status} / ${conflictCode || "unknown"}`);
  }

  await mkdir(evidenceDir, { recursive: true });
  const imagePath = path.join(evidenceDir, "managed-image-edit.png");
  const summaryPath = path.join(evidenceDir, "summary.json");
  await writeFile(imagePath, firstImage);
  const summary = {
    ok: true,
    endpoint: new URL(endpoint).pathname,
    model,
    sourcePath,
    sourceBytes: source.length,
    sourceSha256: sha256(source),
    firstStatus: first.status,
    firstElapsedMs: first.elapsedMs,
    replayStatus: replay.status,
    replayElapsedMs: replay.elapsedMs,
    replayExact,
    conflictStatus: conflict.status,
    conflictCode,
    imagePath,
    imageBytes: firstImage.length,
    imageSha256: sha256(firstImage),
    completedAt: new Date().toISOString(),
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
