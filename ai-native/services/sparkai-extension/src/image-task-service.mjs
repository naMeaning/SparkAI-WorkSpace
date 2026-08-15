import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serviceError } from "./errors.mjs";
import { createImageTaskId, secretDigest } from "./secrets.mjs";
import { upstreamImagesUrl } from "./config.mjs";

function cleanBearerToken(value) {
  const token = String(value || "").trim();
  if (!token || token.length > 8_192) throw serviceError(401, "image_task_unauthorized", "缺少有效的模型 API Key。");
  return token;
}

function cleanIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length > 240) throw serviceError(400, "idempotency_key_invalid", "Idempotency-Key 过长。");
  return key;
}

function cleanRequestBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw serviceError(400, "image_request_invalid", "图片请求必须是 JSON 对象。");
  const body = structuredClone(value);
  const model = String(body.model || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!model || model.length > 256) throw serviceError(400, "image_model_invalid", "图片模型名称无效。");
  if (!prompt || prompt.length > 100_000) throw serviceError(400, "image_prompt_invalid", "图片提示词无效。");
  if (body.n !== undefined) {
    const count = Number(body.n);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw serviceError(400, "image_count_invalid", "单个任务只能请求 1 到 10 张图片。");
  }
  delete body.group;
  delete body.stream;
  delete body.partial_images;
  return body;
}

function safeUpstreamMessage(payload, status, secrets = []) {
  const message = payload?.error?.message || payload?.message || `图片上游返回 HTTP ${status || 500}。`;
  return redactMessage(message, secrets) || "图片上游请求失败。";
}

function redactMessage(value, secrets = []) {
  let message = String(value || "");
  for (const secret of secrets) {
    const cleanSecret = String(secret || "");
    if (cleanSecret) message = message.split(cleanSecret).join("[redacted]");
  }
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]")
    .replace(/\blic_[A-Za-z0-9_-]{8,}\b/g, "lic_[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 600);
}

async function readResponseText(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw serviceError(502, "upstream_result_too_large", "图片上游结果超过扩展服务限制。");
  if (!response.body) return "";
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maximumBytes) throw serviceError(502, "upstream_result_too_large", "图片上游结果超过扩展服务限制。");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export class ImageTaskService {
  constructor({
    database,
    hashSecret,
    resultsDir,
    upstreamBaseUrl,
    concurrency = 2,
    timeoutMs = 10 * 60_000,
    maxResultBytes = 96 * 1024 * 1024,
    retentionHours = 24,
    fetchImpl = fetch,
    now = () => Math.floor(Date.now() / 1000),
    logger = console
  }) {
    this.database = database;
    this.hashSecret = hashSecret;
    this.resultsDir = resultsDir;
    this.upstreamUrl = upstreamImagesUrl(upstreamBaseUrl);
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.maxResultBytes = maxResultBytes;
    this.retentionSeconds = retentionHours * 60 * 60;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.queue = [];
    this.active = new Map();
    this.pumpScheduled = false;
    this.shuttingDown = false;
    this.cleanupTimer = null;
    this.cleanupPromise = null;
  }

  async initialize() {
    await mkdir(this.resultsDir, { recursive: true });
    const now = this.now();
    this.database.prepare(`
      UPDATE image_tasks
      SET status = 'failed', error_code = 'service_restarted',
          error_message = '扩展服务已重启，未完成任务不会自动重放。', updated_at = ?, completed_at = ?
      WHERE status IN ('queued', 'running')
    `).run(now, now);
    await this.cleanupExpired();
    this.startCleanupTimer();
  }

  ownerHash(token) {
    return secretDigest(this.hashSecret, "image-owner", cleanBearerToken(token));
  }

  resultPath(taskId) {
    return join(this.resultsDir, `${taskId}.json`);
  }

  async create({ token, idempotencyKey, body }) {
    if (this.shuttingDown) throw serviceError(503, "service_shutting_down", "扩展服务正在停止，暂不接受新任务。");
    const cleanToken = cleanBearerToken(token);
    const requestBody = cleanRequestBody(body);
    const cleanKey = cleanIdempotencyKey(idempotencyKey);
    const ownerHash = this.ownerHash(cleanToken);
    const idempotencyHash = cleanKey
      ? secretDigest(this.hashSecret, "image-idempotency", `${ownerHash}\0${cleanKey}`)
      : null;
    const taskId = createImageTaskId();
    const now = this.now();
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO image_tasks
        (id, owner_hash, idempotency_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(taskId, ownerHash, idempotencyHash, now, now);

    if (inserted.changes !== 1) {
      const existing = this.database.prepare(`
        SELECT id, status FROM image_tasks WHERE owner_hash = ? AND idempotency_hash = ?
      `).get(ownerHash, idempotencyHash);
      if (!existing) throw serviceError(409, "image_task_conflict", "图片任务幂等记录冲突。");
      return { taskId: existing.id, status: existing.status, created: false };
    }

    this.queue.push({ taskId, token: cleanToken, idempotencyKey: cleanKey, body: requestBody });
    this.schedulePump();
    return { taskId, status: "queued", created: true };
  }

  async get({ taskId, token }) {
    const id = String(taskId || "").trim();
    if (!/^imgtask_[a-f0-9]{36}$/.test(id)) throw serviceError(404, "image_task_not_found", "图片任务不存在。");
    const ownerHash = this.ownerHash(token);
    const task = this.database.prepare(`
      SELECT id, status, error_code, error_message, created_at, updated_at, started_at, completed_at
      FROM image_tasks WHERE id = ? AND owner_hash = ?
    `).get(id, ownerHash);
    if (!task) throw serviceError(404, "image_task_not_found", "图片任务不存在。");
    const response = {
      task_id: task.id,
      status: task.status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      started_at: task.started_at || undefined,
      completed_at: task.completed_at || undefined
    };
    if (task.status === "failed") {
      response.error = {
        code: task.error_code || "image_task_failed",
        message: task.error_message || "图片生成任务失败。"
      };
    }
    if (task.status === "succeeded") {
      try {
        response.result = JSON.parse(await readFile(this.resultPath(id), "utf8"));
      } catch (error) {
        this.failTask(id, "task_result_missing", "图片任务结果文件不可用。");
        throw serviceError(500, "task_result_missing", "图片任务结果文件不可用。", { cause: error });
      }
    }
    return response;
  }

  schedulePump() {
    if (this.pumpScheduled || this.shuttingDown) return;
    this.pumpScheduled = true;
    setImmediate(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  async pump() {
    while (!this.shuttingDown && this.active.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      const entry = { controller: new AbortController(), promise: null };
      this.active.set(job.taskId, entry);
      entry.promise = this.run(job, entry.controller).finally(() => {
        this.active.delete(job.taskId);
        this.schedulePump();
      });
    }
  }

  async run(job, controller) {
    const startedAt = this.now();
    this.database.prepare(`
      UPDATE image_tasks SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'
    `).run(startedAt, startedAt, job.taskId);
    const timeout = setTimeout(() => controller.abort(new Error("image upstream timeout")), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${job.token}`,
          ...(job.idempotencyKey ? { "idempotency-key": job.idempotencyKey } : {}),
          "user-agent": "sparkai-extension/0.1"
        },
        body: JSON.stringify(job.body),
        signal: controller.signal
      });
      const text = await readResponseText(response, this.maxResultBytes);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw serviceError(502, "upstream_invalid_json", "图片上游没有返回有效 JSON。");
      }
      if (!response.ok || payload?.error || payload?.success === false || payload?.ok === false) {
        throw serviceError(502, "upstream_image_failed", safeUpstreamMessage(payload, response.status, [job.token]));
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw serviceError(502, "upstream_result_invalid", "图片上游结果格式无效。");
      }
      const target = this.resultPath(job.taskId);
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(payload), { encoding: "utf8", flag: "wx" });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      const completedAt = this.now();
      this.database.prepare(`
        UPDATE image_tasks SET status = 'succeeded', error_code = '', error_message = '', updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(completedAt, completedAt, job.taskId);
    } catch (error) {
      const aborted = controller.signal.aborted;
      const code = aborted ? (this.shuttingDown ? "service_shutdown" : "upstream_timeout") : String(error?.code || "image_task_failed");
      const message = aborted
        ? (this.shuttingDown ? "扩展服务已停止，图片任务未重放。" : "图片上游处理超时。")
        : redactMessage(error?.message || "图片生成任务失败。", [job.token]);
      this.failTask(job.taskId, code, message);
      this.logger.warn?.(`image task failed task=${job.taskId} code=${code}`);
    } finally {
      clearTimeout(timeout);
      job.token = "";
    }
  }

  failTask(taskId, code, message) {
    const completedAt = this.now();
    this.database.prepare(`
      UPDATE image_tasks SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(String(code || "image_task_failed").slice(0, 80), String(message || "图片生成任务失败。").slice(0, 600), completedAt, completedAt, taskId);
  }

  async cleanupExpired() {
    const cutoff = this.now() - this.retentionSeconds;
    const expired = this.database.prepare(`
      SELECT id FROM image_tasks WHERE updated_at < ? AND status IN ('succeeded', 'failed') LIMIT 1000
    `).all(cutoff);
    for (const task of expired) await rm(this.resultPath(task.id), { force: true });
    if (expired.length > 0) {
      const placeholders = expired.map(() => "?").join(",");
      this.database.prepare(`DELETE FROM image_tasks WHERE id IN (${placeholders})`).run(...expired.map((task) => task.id));
    }
    return expired.length;
  }

  startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      if (this.shuttingDown || this.cleanupPromise) return;
      this.cleanupPromise = this.cleanupExpired()
        .catch((error) => this.logger.warn?.(`image task cleanup failed code=${String(error?.code || "cleanup_failed")}`))
        .finally(() => {
          this.cleanupPromise = null;
        });
    }, 15 * 60_000);
    this.cleanupTimer.unref?.();
  }

  async shutdown() {
    this.shuttingDown = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    for (const job of this.queue.splice(0)) this.failTask(job.taskId, "service_shutdown", "扩展服务已停止，图片任务未重放。");
    for (const entry of this.active.values()) entry.controller.abort(new Error("service shutdown"));
    await Promise.allSettled(Array.from(this.active.values(), (entry) => entry.promise).filter(Boolean));
    if (this.cleanupPromise) await this.cleanupPromise.catch(() => undefined);
  }

  stats() {
    return { queued: this.queue.length, running: this.active.size, concurrency: this.concurrency };
  }
}
