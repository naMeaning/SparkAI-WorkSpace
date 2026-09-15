"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } = require("node:fs");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const { inspectVideoSource, MAX_VIDEO_BYTES } = require("./video-import.cjs");
const {
  createVideoTaskRequest,
  normalizeVideoTaskResponse,
  videoTaskEndpoints
} = require("./video-task-adapter.cjs");
const { normalizeSocialContentMetadata } = require("../runtime/social-content-plan.cjs");

const JOURNAL_VERSION = 1;
const MAX_TASKS_PER_PROJECT = 500;
const ACTIVE_TASK_STATES = new Set(["queued", "running", "succeeded"]);

class VideoTaskError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VideoTaskError";
    this.code = code;
    this.details = details;
  }
}

function cleanText(value, maximum = 4_096) {
  return String(value || "").trim().slice(0, maximum);
}

function safeBaseUrl(value) {
  const source = cleanText(value, 2_048);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return source.replace(/[?#].*$/, "");
  }
}

function defaultJournal() {
  return { version: JOURNAL_VERSION, revision: 0, updatedAt: "", tasks: [] };
}

function cleanPlacement(value) {
  const source = value && typeof value === "object" ? value : {};
  const x = Number(source.x);
  const y = Number(source.y);
  return {
    x: Number.isFinite(x) ? Math.round(x) : 240,
    y: Number.isFinite(y) ? Math.round(y) : 180
  };
}

function normalizeVideoTask(value) {
  const source = value && typeof value === "object" ? value : {};
  const taskId = cleanText(source.taskId, 180);
  const projectId = cleanText(source.projectId, 180);
  const model = cleanText(source.model, 240);
  if (!taskId || !projectId || !model) return null;
  const validStates = new Set(["prepared", "creating", "create-unknown", "queued", "running", "succeeded", "ready", "failed", "cancelled"]);
  const state = validStates.has(source.state) ? source.state : "failed";
  const credentialSource = source.credentialRef && typeof source.credentialRef === "object" ? source.credentialRef : {};
  const outputSource = source.output && typeof source.output === "object" ? source.output : null;
  const outputPath = cleanText(outputSource?.path, 8_192);
  const outputRelativePath = cleanText(outputSource?.relativePath, 8_192).replace(/\\/g, "/");
  const outputAssetUrl = cleanText(outputSource?.assetUrl, 16_384);
  const socialContent = normalizeSocialContentMetadata(source.socialContent);
  const output = outputSource && (outputPath || outputRelativePath) ? {
    assetId: cleanText(outputSource.assetId, 180),
    occurrenceId: cleanText(outputSource.occurrenceId, 180),
    contentHash: cleanText(outputSource.contentHash, 180),
    type: "file",
    ...(outputPath ? { path: outputPath } : {}),
    ...(outputRelativePath ? { relativePath: outputRelativePath } : {}),
    ...(outputAssetUrl ? { assetUrl: outputAssetUrl } : {}),
    originalName: cleanText(outputSource.originalName, 260),
    mimeType: ["video/mp4", "video/webm", "video/quicktime"].includes(outputSource.mimeType) ? outputSource.mimeType : "video/mp4",
    width: Number.isFinite(Number(outputSource.width)) ? Number(outputSource.width) : undefined,
    height: Number.isFinite(Number(outputSource.height)) ? Number(outputSource.height) : undefined,
    durationMs: Number.isFinite(Number(outputSource.durationMs)) ? Number(outputSource.durationMs) : undefined
  } : undefined;
  return {
    version: JOURNAL_VERSION,
    taskId,
    projectId,
    nodeId: cleanText(source.nodeId, 180),
    idempotencyKey: cleanText(source.idempotencyKey, 240),
    endpointFamily: source.endpointFamily === "videos" ? "videos" : "video-generations",
    model,
    prompt: cleanText(source.prompt, 20_000),
    seconds: Math.max(1, Math.min(60, Math.floor(Number(source.seconds) || 5))),
    aspectRatio: cleanText(source.aspectRatio, 32) || "16:9",
    resolution: cleanText(source.resolution, 32) || "720p",
    placement: cleanPlacement(source.placement),
    state,
    createState: ["not-started", "started", "confirmed", "rejected", "unknown"].includes(source.createState) ? source.createState : "not-started",
    remoteTaskId: cleanText(source.remoteTaskId, 512),
    resultUrl: cleanText(source.resultUrl, 16_384),
    progress: Number.isFinite(Number(source.progress)) ? Math.max(0, Math.min(100, Math.round(Number(source.progress)))) : undefined,
    createAttempts: Math.max(0, Math.floor(Number(source.createAttempts) || 0)),
    pollAttempts: Math.max(0, Math.floor(Number(source.pollAttempts) || 0)),
    pollFailures: Math.max(0, Math.floor(Number(source.pollFailures) || 0)),
    createdAt: cleanText(source.createdAt, 80) || new Date().toISOString(),
    updatedAt: cleanText(source.updatedAt, 80) || new Date().toISOString(),
    lastPolledAt: cleanText(source.lastPolledAt, 80),
    error: cleanText(source.error, 2_000),
    pollError: cleanText(source.pollError, 2_000),
    downloadError: cleanText(source.downloadError, 2_000),
    credentialRef: {
      mode: credentialSource.mode === "account" ? "account" : "custom",
      baseUrl: safeBaseUrl(credentialSource.baseUrl),
      tokenId: cleanText(credentialSource.tokenId, 180),
      label: cleanText(credentialSource.label, 180),
      fingerprint: /^[a-f0-9]{64}$/i.test(cleanText(credentialSource.fingerprint, 64))
        ? cleanText(credentialSource.fingerprint, 64).toLowerCase()
        : ""
    },
    ...(socialContent ? { socialContent } : {}),
    ...(output ? { output } : {})
  };
}

function normalizeJournal(value, projectId) {
  const source = value && typeof value === "object" ? value : {};
  const tasks = (Array.isArray(source.tasks) ? source.tasks : [])
    .map(normalizeVideoTask)
    .filter((task) => task && task.projectId === projectId)
    .slice(-MAX_TASKS_PER_PROJECT);
  return {
    version: JOURNAL_VERSION,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    updatedAt: cleanText(source.updatedAt, 80),
    tasks
  };
}

function publicVideoTask(task) {
  if (!task) return null;
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    nodeId: task.nodeId,
    endpointFamily: task.endpointFamily,
    model: task.model,
    prompt: task.prompt,
    seconds: task.seconds,
    aspectRatio: task.aspectRatio,
    resolution: task.resolution,
    placement: { ...task.placement },
    state: task.state,
    createState: task.createState,
    remoteTaskId: task.remoteTaskId,
    progress: task.progress,
    createAttempts: task.createAttempts,
    pollAttempts: task.pollAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastPolledAt: task.lastPolledAt,
    error: task.error,
    pollError: task.pollError,
    downloadError: task.downloadError,
    credentialLabel: task.credentialRef?.label || "",
    credentialBaseUrl: task.credentialRef?.baseUrl || "",
    socialContent: task.socialContent ? { ...task.socialContent } : undefined,
    output: task.output ? { ...task.output } : undefined
  };
}

function responseHeader(response, name) {
  const key = String(name || "").toLowerCase();
  const value = typeof response?.headers?.get === "function"
    ? response.headers.get(key)
    : response?.headers?.[key];
  return cleanText(Array.isArray(value) ? value[0] : value, 512).toLowerCase();
}

function outputFormat(response, sourceUrl) {
  const contentType = responseHeader(response, "content-type").split(";", 1)[0];
  if (contentType === "video/webm") return { extension: ".webm", mimeType: "video/webm" };
  if (contentType === "video/quicktime") return { extension: ".mov", mimeType: "video/quicktime" };
  try {
    const extension = path.extname(new URL(sourceUrl, "https://naimage.invalid").pathname).toLowerCase();
    if (extension === ".webm") return { extension, mimeType: "video/webm" };
    if (extension === ".mov") return { extension, mimeType: "video/quicktime" };
  } catch {}
  return { extension: ".mp4", mimeType: "video/mp4" };
}

function explicitVideoCreateRejection(error) {
  if (error?.explicitRejection === true) return true;
  const status = Number(error?.status);
  if (!Number.isInteger(status) || status < 400 || status >= 500) return false;
  return ![408, 409, 425].includes(status);
}

function createVideoTaskService(options = {}) {
  const {
    assetUrlFor = () => "",
    fetchBinary,
    getProjectById,
    journalFileName = "video-task-journal.json",
    log = () => {},
    markRuntimeVerified = () => {},
    onTaskChanged = () => {},
    projectMetaDirName = ".naimage",
    projectRelativePath = () => "",
    readJson,
    readProjectList,
    requestJson,
    resolveProjectRelativePath = (projectPath, relativePath) => {
      const root = path.resolve(projectPath);
      const resolved = path.resolve(root, String(relativePath || ""));
      const relation = path.relative(root, resolved);
      return relation && !relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation) ? resolved : "";
    },
    resolveCredentials,
    writeJson
  } = options;
  if (typeof getProjectById !== "function" || typeof readProjectList !== "function") throw new Error("Video task service requires project access.");
  if (typeof readJson !== "function" || typeof writeJson !== "function") throw new Error("Video task service requires journal IO.");
  if (typeof requestJson !== "function" || typeof fetchBinary !== "function" || typeof resolveCredentials !== "function") throw new Error("Video task service requires New API transport adapters.");

  const timers = new Map();
  const pollInFlight = new Set();
  const projectQueues = new Map();
  let disposed = false;

  function projectForId(projectIdValue) {
    const projectId = cleanText(projectIdValue, 180);
    const project = projectId ? getProjectById(projectId, readProjectList()) : null;
    if (!project?.path) throw new VideoTaskError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    return project;
  }

  function journalPath(project) {
    return path.join(path.resolve(project.path), projectMetaDirName, journalFileName);
  }

  function generatedVideoRelativePath(project, output) {
    const fromPath = output?.path ? projectRelativePath(project.path, output.path) : "";
    const relativePath = cleanText(fromPath || output?.relativePath, 8_192).replace(/\\/g, "/");
    if (!/^output\/video\/generated\/[a-z0-9._-]+$/i.test(relativePath)) return "";
    const resolved = resolveProjectRelativePath(project.path, relativePath);
    return resolved && projectRelativePath(project.path, resolved).replace(/\\/g, "/") === relativePath ? relativePath : "";
  }

  function journalTaskForWrite(project, task) {
    if (!task.output) return task;
    const relativePath = generatedVideoRelativePath(project, task.output);
    if (!relativePath) return { ...task, output: undefined };
    const output = { ...task.output, type: "file", relativePath };
    delete output.path;
    delete output.assetUrl;
    delete output.url;
    const persisted = { ...task, output };
    if (task.state === "ready") delete persisted.resultUrl;
    return persisted;
  }

  function journalTaskForRuntime(project, task) {
    if (!task.output) {
      return task.state === "ready"
        ? {
            ...task,
            state: "succeeded",
            downloadError: task.downloadError || "项目中的视频结果不存在，正在尝试重新下载。"
          }
        : task;
    }
    const relativePath = generatedVideoRelativePath(project, task.output);
    const resolvedPath = relativePath ? resolveProjectRelativePath(project.path, relativePath) : "";
    if (!resolvedPath || !existsSync(resolvedPath)) {
      return {
        ...task,
        state: task.state === "ready" ? "succeeded" : task.state,
        downloadError: task.downloadError || "项目中的视频结果不存在，正在尝试重新下载。",
        output: undefined
      };
    }
    return {
      ...task,
      output: {
        ...task.output,
        type: "file",
        path: resolvedPath,
        relativePath,
        assetUrl: assetUrlFor(resolvedPath)
      }
    };
  }

  function readJournal(project) {
    const journal = normalizeJournal(readJson(journalPath(project), defaultJournal()), project.id);
    return { ...journal, tasks: journal.tasks.map((task) => journalTaskForRuntime(project, task)) };
  }

  function writeJournal(project, journal) {
    const next = normalizeJournal({
      ...journal,
      revision: Math.max(0, Number(journal.revision) || 0) + 1,
      updatedAt: new Date().toISOString()
    }, project.id);
    writeJson(journalPath(project), {
      ...next,
      tasks: next.tasks.map((task) => journalTaskForWrite(project, task))
    });
    return next;
  }

  function enqueueProject(projectId, operation) {
    const previous = projectQueues.get(projectId) || Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    const tracked = task.finally(() => {
      if (projectQueues.get(projectId) === tracked) projectQueues.delete(projectId);
    });
    projectQueues.set(projectId, tracked);
    return task;
  }

  async function mutateTask(projectId, taskId, updater) {
    return enqueueProject(projectId, async () => {
      const project = projectForId(projectId);
      const journal = readJournal(project);
      const index = journal.tasks.findIndex((task) => task.taskId === taskId);
      if (index < 0) throw new VideoTaskError("VIDEO_TASK_NOT_FOUND", "视频任务不存在或已被移除。", { projectId, taskId });
      const updated = normalizeVideoTask(updater({ ...journal.tasks[index] }));
      if (!updated) throw new VideoTaskError("VIDEO_TASK_INVALID", "视频任务状态无效。", { projectId, taskId });
      journal.tasks[index] = updated;
      writeJournal(project, journal);
      const publicTask = publicVideoTask(updated);
      onTaskChanged(publicTask);
      return updated;
    });
  }

  async function insertTask(project, task) {
    return enqueueProject(project.id, async () => {
      const journal = readJournal(project);
      const duplicate = journal.tasks.find((item) => item.idempotencyKey && item.idempotencyKey === task.idempotencyKey);
      if (duplicate) return { task: duplicate, reused: true };
      journal.tasks.push(task);
      if (journal.tasks.length > MAX_TASKS_PER_PROJECT) journal.tasks = journal.tasks.slice(-MAX_TASKS_PER_PROJECT);
      writeJournal(project, journal);
      const publicTask = publicVideoTask(task);
      onTaskChanged(publicTask);
      return { task, reused: false };
    });
  }

  function timerKey(projectId, taskId) {
    return `${projectId}:${taskId}`;
  }

  function clearScheduled(projectId, taskId) {
    const key = timerKey(projectId, taskId);
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
  }

  function schedulePoll(task, delayMs = 5_000) {
    if (disposed || !task?.remoteTaskId || !ACTIVE_TASK_STATES.has(task.state)) return;
    const key = timerKey(task.projectId, task.taskId);
    if (timers.has(key)) return;
    const timer = setTimeout(() => {
      timers.delete(key);
      void pollTask(task.projectId, task.taskId);
    }, Math.max(1_000, Math.min(60_000, Math.floor(Number(delayMs) || 5_000))));
    timer.unref?.();
    timers.set(key, timer);
  }

  async function credentialsForTask(task) {
    const credentials = await resolveCredentials({
      model: task.model,
      credentialRef: task.credentialRef
    });
    const baseUrl = safeBaseUrl(credentials?.baseUrl);
    const expectedBaseUrl = safeBaseUrl(task.credentialRef?.baseUrl);
    if (!baseUrl || !cleanText(credentials?.apiKey, 16_384)) {
      throw new VideoTaskError("VIDEO_CREDENTIALS_UNAVAILABLE", "视频任务所需的模型凭证当前不可用。");
    }
    if (expectedBaseUrl && baseUrl.toLowerCase() !== expectedBaseUrl.toLowerCase()) {
      throw new VideoTaskError("VIDEO_CREDENTIALS_CHANGED", "视频任务原接入地址已变化；恢复原 Base URL/Token 后可继续轮询，软件不会重复创建任务。", {
        expectedBaseUrl,
        currentBaseUrl: baseUrl
      });
    }
    const fingerprint = createHash("sha256")
      .update(`${credentials?.mode === "account" ? "account" : "custom"}\n${baseUrl.toLowerCase()}\n${cleanText(credentials?.apiKey, 16_384)}`)
      .digest("hex");
    if (task.credentialRef?.fingerprint && task.credentialRef.fingerprint !== fingerprint) {
      throw new VideoTaskError("VIDEO_CREDENTIALS_CHANGED", "视频任务原 Token 已变化；恢复原 Base URL/Token 后可继续轮询，软件不会重复创建任务。", {
        expectedBaseUrl,
        currentBaseUrl: baseUrl
      });
    }
    return { ...credentials, baseUrl };
  }

  async function createTask(payload = {}) {
    if (disposed) throw new VideoTaskError("VIDEO_SERVICE_CLOSED", "视频任务服务正在关闭。");
    if (payload.confirmed !== true) throw new VideoTaskError("VIDEO_TASK_CONFIRMATION_REQUIRED", "视频任务必须由明确操作触发。", { confirmed: false });
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const request = createVideoTaskRequest(payload, payload.endpointFamily);
    const credentials = await resolveCredentials({ model: request.model, credentialRef: null });
    const baseUrl = safeBaseUrl(credentials?.baseUrl);
    const apiKey = cleanText(credentials?.apiKey, 16_384);
    if (!baseUrl || !apiKey) throw new VideoTaskError("VIDEO_CREDENTIALS_UNAVAILABLE", "视频模型 Base URL 或 API Key 尚未配置。");
    const now = new Date().toISOString();
    const idempotencyKey = cleanText(payload.idempotencyKey, 240) || `video-${randomBytes(24).toString("hex")}`;
    const taskId = `video-task-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
    const task = normalizeVideoTask({
      version: JOURNAL_VERSION,
      taskId,
      projectId: project.id,
      nodeId: cleanText(payload.nodeId, 180),
      idempotencyKey,
      endpointFamily: request.family,
      model: request.model,
      prompt: request.prompt,
      seconds: request.seconds,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      placement: cleanPlacement(payload.placement || payload),
      socialContent: payload.socialContent,
      state: "prepared",
      createState: "not-started",
      createdAt: now,
      updatedAt: now,
      credentialRef: {
        mode: credentials.mode === "account" ? "account" : "custom",
        baseUrl,
        tokenId: cleanText(credentials.tokenId, 180),
        label: cleanText(credentials.label, 180),
        fingerprint: createHash("sha256")
          .update(`${credentials.mode === "account" ? "account" : "custom"}\n${baseUrl.toLowerCase()}\n${apiKey}`)
          .digest("hex")
      }
    });
    const inserted = await insertTask(project, task);
    if (inserted.reused) {
      schedulePoll(inserted.task, 1_000);
      const reusedTask = publicVideoTask(inserted.task);
      const ambiguous = inserted.task.state === "create-unknown";
      const failed = ambiguous || inserted.task.state === "failed" || inserted.task.state === "cancelled";
      return {
        ok: !failed,
        reused: true,
        ...(ambiguous ? { ambiguous: true } : {}),
        task: reusedTask,
        ...(failed ? { error: inserted.task.error || "该幂等视频任务未成功创建。" } : {})
      };
    }
    await mutateTask(project.id, taskId, (current) => ({
      ...current,
      state: "creating",
      createState: "started",
      createAttempts: 1,
      updatedAt: new Date().toISOString()
    }));
    const endpoints = videoTaskEndpoints(task.model, "", task.endpointFamily);
    try {
      const result = await requestJson({
        credentials: { ...credentials, baseUrl },
        endpoint: endpoints.create,
        method: "POST",
        body: request.body,
        headers: {
          "Idempotency-Key": idempotencyKey,
          "X-Naimage-Task-Id": taskId
        },
        timeoutMs: 120_000,
        retries: 0
      });
      const normalized = normalizeVideoTaskResponse(result.data, { fallbackState: "queued" });
      if (!normalized.remoteTaskId) {
        const explicitlyRejected = normalized.state === "failed" || normalized.state === "cancelled";
        const unresolved = await mutateTask(project.id, taskId, (current) => ({
          ...current,
          state: explicitlyRejected ? normalized.state : "create-unknown",
          createState: explicitlyRejected ? "rejected" : "unknown",
          error: explicitlyRejected
            ? normalized.error || "上游明确拒绝了视频任务。"
            : "上游响应未包含视频任务 ID。为避免重复扣费，软件不会自动再次创建。",
          updatedAt: new Date().toISOString()
        }));
        return { ok: false, ambiguous: !explicitlyRejected, task: publicVideoTask(unresolved), error: unresolved.error };
      }
      const updated = await mutateTask(project.id, taskId, (current) => ({
        ...current,
        remoteTaskId: normalized.remoteTaskId,
        state: normalized.state,
        createState: normalized.state === "failed" || normalized.state === "cancelled" ? "rejected" : "confirmed",
        progress: normalized.progress,
        resultUrl: normalized.resultUrl,
        error: normalized.error,
        updatedAt: new Date().toISOString()
      }));
      if (updated.createState === "confirmed") markRuntimeVerified({ model: updated.model, endpointType: "openai-video" });
      if (updated.state === "succeeded") await materializeTaskOutput(updated.projectId, updated.taskId);
      else schedulePoll(updated, 3_000);
      const latest = await getTask(updated.projectId, updated.taskId);
      return {
        ok: Boolean(latest && !["failed", "cancelled", "create-unknown"].includes(latest.state)),
        task: latest,
        error: latest?.error || undefined
      };
    } catch (error) {
      const explicitResponse = explicitVideoCreateRejection(error);
      const message = cleanText(error?.message || error, 2_000) || "视频任务创建失败。";
      const updated = await mutateTask(project.id, taskId, (current) => ({
        ...current,
        state: explicitResponse ? "failed" : "create-unknown",
        createState: explicitResponse ? "rejected" : "unknown",
        error: explicitResponse
          ? message
          : `${message} 创建结果无法确认。为避免重复扣费，软件不会自动再次创建。`,
        updatedAt: new Date().toISOString()
      }));
      return {
        ok: false,
        ambiguous: !explicitResponse,
        task: publicVideoTask(updated),
        error: updated.error
      };
    }
  }

  async function readTask(projectId, taskId) {
    const project = projectForId(projectId);
    return readJournal(project).tasks.find((task) => task.taskId === taskId) || null;
  }

  async function getTask(projectId, taskId) {
    return publicVideoTask(await readTask(projectId, taskId));
  }

  async function listTasks(projectIdValue) {
    const project = projectForId(projectIdValue);
    const tasks = readJournal(project).tasks;
    for (const task of tasks) schedulePoll(task, 1_000);
    return tasks.map(publicVideoTask);
  }

  async function saveDownloadedResponse(task, project, response, sourceUrl) {
    if (!response?.ok || !response.body) {
      response?.body?.destroy?.();
      throw new VideoTaskError("VIDEO_DOWNLOAD_FAILED", `视频文件下载失败${response?.status ? `（HTTP ${response.status}）` : ""}。`);
    }
    const contentLength = Number(responseHeader(response, "content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
      response.body.destroy?.();
      throw new VideoTaskError("VIDEO_DOWNLOAD_TOO_LARGE", "视频文件超过 16GB 安全上限。");
    }
    const format = outputFormat(response, sourceUrl);
    const outputDir = path.join(path.resolve(project.path), "output", "video", "generated");
    mkdirSync(outputDir, { recursive: true });
    const temporaryPath = path.join(outputDir, `.naimage-video-task-${process.pid}-${randomBytes(8).toString("hex")}.tmp${format.extension}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_VIDEO_BYTES) {
          callback(new VideoTaskError("VIDEO_DOWNLOAD_TOO_LARGE", "视频文件超过 16GB 安全上限。"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    let targetPath = "";
    let createdTarget = false;
    try {
      await pipeline(response.body, guard, createWriteStream(temporaryPath, { flags: "wx" }));
      const contentHash = hash.digest("hex");
      targetPath = path.join(outputDir, `${contentHash.slice(0, 32)}${format.extension}`);
      if (existsSync(targetPath)) rmSync(temporaryPath, { force: true });
      else {
        renameSync(temporaryPath, targetPath);
        createdTarget = true;
      }
      const inspected = inspectVideoSource(targetPath);
      const originalName = `${task.model.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "video"}-${task.taskId.slice(-12)}${format.extension}`;
      return {
        assetId: `video-${contentHash.slice(0, 32)}`,
        occurrenceId: `occ-${createHash("sha256").update(`${task.taskId}:${contentHash}`).digest("hex").slice(0, 32)}`,
        contentHash,
        type: "file",
        path: targetPath,
        relativePath: projectRelativePath(project.path, targetPath),
        assetUrl: assetUrlFor(targetPath),
        originalName,
        mimeType: inspected.mimeType || format.mimeType,
        durationMs: task.seconds * 1_000
      };
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      if (createdTarget && targetPath) rmSync(targetPath, { force: true });
      throw error;
    }
  }

  async function materializeTaskOutput(projectId, taskId) {
    const task = await readTask(projectId, taskId);
    if (!task) throw new VideoTaskError("VIDEO_TASK_NOT_FOUND", "视频任务不存在。");
    if (task.output?.path && existsSync(task.output.path)) {
      if (task.state !== "ready") {
        await mutateTask(projectId, taskId, (current) => ({ ...current, state: "ready", downloadError: "", updatedAt: new Date().toISOString() }));
      }
      return publicVideoTask({ ...task, state: "ready" });
    }
    if (task.state !== "succeeded") return publicVideoTask(task);
    const project = projectForId(projectId);
    try {
      const credentials = await credentialsForTask(task);
      const endpoints = videoTaskEndpoints(task.model, task.remoteTaskId, task.endpointFamily);
      const sources = [...new Set([endpoints.content, task.resultUrl].filter(Boolean))];
      if (!sources.length) throw new VideoTaskError("VIDEO_OUTPUT_MISSING", "上游已完成视频任务，但未返回可下载的结果地址。");
      let output = null;
      let lastDownloadError = null;
      for (const source of sources) {
        try {
          const response = await fetchBinary({
            credentials,
            endpointOrUrl: source,
            timeoutMs: 5 * 60_000,
            maxResponseBytes: MAX_VIDEO_BYTES
          });
          output = await saveDownloadedResponse(task, project, response, source);
          break;
        } catch (error) {
          lastDownloadError = error;
        }
      }
      if (!output) throw lastDownloadError || new VideoTaskError("VIDEO_DOWNLOAD_FAILED", "视频结果下载失败。");
      const updated = await mutateTask(projectId, taskId, (current) => ({
        ...current,
        output,
        state: "ready",
        resultUrl: "",
        progress: 100,
        downloadError: "",
        updatedAt: new Date().toISOString()
      }));
      clearScheduled(projectId, taskId);
      return publicVideoTask(updated);
    } catch (error) {
      const message = cleanText(error?.message || error, 2_000) || "视频结果下载失败。";
      const updated = await mutateTask(projectId, taskId, (current) => ({
        ...current,
        resultUrl: current.endpointFamily === "video-generations" ? "" : current.resultUrl,
        downloadError: message,
        updatedAt: new Date().toISOString()
      }));
      schedulePoll(updated, 30_000);
      return publicVideoTask(updated);
    }
  }

  async function pollTask(projectId, taskId) {
    const key = timerKey(projectId, taskId);
    if (disposed || pollInFlight.has(key)) return;
    pollInFlight.add(key);
    clearScheduled(projectId, taskId);
    try {
      const task = await readTask(projectId, taskId);
      if (!task?.remoteTaskId || !ACTIVE_TASK_STATES.has(task.state)) return;
      if (task.state === "succeeded") {
        const endpoints = videoTaskEndpoints(task.model, task.remoteTaskId, task.endpointFamily);
        if (!task.downloadError && (endpoints.content || task.resultUrl)) {
          await materializeTaskOutput(projectId, taskId);
          return;
        }
      }
      const credentials = await credentialsForTask(task);
      const endpoints = videoTaskEndpoints(task.model, task.remoteTaskId, task.endpointFamily);
      const result = await requestJson({
        credentials,
        endpoint: endpoints.poll,
        method: "GET",
        timeoutMs: 30_000,
        retries: 2
      });
      const normalized = normalizeVideoTaskResponse(result.data, {
        remoteTaskId: task.remoteTaskId,
        fallbackState: task.state
      });
      const updated = await mutateTask(projectId, taskId, (current) => ({
        ...current,
        state: normalized.state,
        progress: normalized.progress ?? current.progress,
        resultUrl: normalized.resultUrl || current.resultUrl,
        error: normalized.error,
        pollError: "",
        pollAttempts: current.pollAttempts + 1,
        pollFailures: 0,
        lastPolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      if (updated.state === "succeeded") await materializeTaskOutput(projectId, taskId);
      else if (updated.state === "queued" || updated.state === "running") schedulePoll(updated, 5_000);
      else clearScheduled(projectId, taskId);
    } catch (error) {
      const message = cleanText(error?.message || error, 2_000) || "视频任务状态查询失败。";
      try {
        const updated = await mutateTask(projectId, taskId, (current) => ({
          ...current,
          pollError: message,
          pollAttempts: current.pollAttempts + 1,
          pollFailures: current.pollFailures + 1,
          lastPolledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));
        schedulePoll(updated, Math.min(60_000, 5_000 * 2 ** Math.min(4, updated.pollFailures)));
      } catch (mutationError) {
        log(`video task poll state write failed ${mutationError instanceof Error ? mutationError.message : String(mutationError)}`);
      }
    } finally {
      pollInFlight.delete(key);
    }
  }

  async function resumeAll() {
    if (disposed) return { projects: 0, resumed: 0, ambiguous: 0 };
    const list = readProjectList();
    let resumed = 0;
    let ambiguous = 0;
    for (const project of Array.isArray(list?.projects) ? list.projects : []) {
      const journal = readJournal(project);
      for (const task of journal.tasks) {
        if (task.state === "prepared") {
          await mutateTask(project.id, task.taskId, (current) => ({
            ...current,
            state: "failed",
            createState: "not-started",
            error: current.error || "软件上次退出前尚未发出视频创建请求，可由用户重新创建。",
            updatedAt: new Date().toISOString()
          }));
          continue;
        }
        if (task.state === "creating") {
          ambiguous += 1;
          await mutateTask(project.id, task.taskId, (current) => ({
            ...current,
            state: "create-unknown",
            createState: "unknown",
            error: current.error || "软件上次退出时创建请求尚未确认。为避免重复扣费，本次不会自动重建。",
            updatedAt: new Date().toISOString()
          }));
          continue;
        }
        if (task.remoteTaskId && ACTIVE_TASK_STATES.has(task.state)) {
          resumed += 1;
          schedulePoll(task, 1_000);
        }
      }
    }
    return { projects: Array.isArray(list?.projects) ? list.projects.length : 0, resumed, ambiguous };
  }

  async function retryDownload(projectId, taskId) {
    const task = await readTask(projectId, taskId);
    if (!task) throw new VideoTaskError("VIDEO_TASK_NOT_FOUND", "视频任务不存在。");
    if (task.state !== "succeeded" && task.state !== "ready") {
      throw new VideoTaskError("VIDEO_TASK_NOT_COMPLETE", "视频任务尚未完成，暂时没有可重新下载的结果。");
    }
    if (task.state === "ready" && task.output?.path && existsSync(task.output.path)) return publicVideoTask(task);
    const normalized = task.state === "ready"
      ? await mutateTask(projectId, taskId, (current) => ({ ...current, state: "succeeded", output: undefined, updatedAt: new Date().toISOString() }))
      : task;
    return materializeTaskOutput(normalized.projectId, normalized.taskId);
  }

  function dispose() {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return {
    createTask,
    dispose,
    getTask,
    journalPathForProject(projectId) {
      return journalPath(projectForId(projectId));
    },
    listTasks,
    pollTask,
    resumeAll,
    retryDownload
  };
}

module.exports = {
  ACTIVE_TASK_STATES,
  JOURNAL_VERSION,
  VideoTaskError,
  createVideoTaskService,
  defaultJournal,
  explicitVideoCreateRejection,
  normalizeJournal,
  normalizeVideoTask,
  publicVideoTask
};
