"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const { createProjectAssetRepository } = require("../desktop/project-asset-repository.cjs");
const { createProjectPackageService } = require("../desktop/project-package-service.cjs");
const {
  sanitizeSession,
  sessionAssetContentHash
} = require("../desktop/project-session-normalizer.cjs");
const {
  importVideoFiles,
  inspectVideoSource
} = require("../desktop/video-import.cjs");
const {
  createVideoTaskRequest,
  normalizeVideoTaskResponse,
  videoTaskEndpoints
} = require("../desktop/video-task-adapter.cjs");
const {
  createVideoTaskService,
  explicitVideoCreateRejection
} = require("../desktop/video-task-service.cjs");

function mp4Fixture() {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  buffer.writeUInt32BE(0x200, 12);
  buffer.write("isomiso2mp41", 16, "ascii");
  return buffer;
}

function webmFixture() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);
}

function comparable(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(filePath, rootPath) {
  const file = comparable(filePath);
  const root = comparable(rootPath);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function realPathIfPresent(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function main() {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-video-node-"));
  try {
    const sourceRoot = path.join(testRoot, "authorized-sources");
    const projectPath = path.join(testRoot, "project");
    const outputDir = path.join(projectPath, "output", "video", "imports");
    mkdirSync(sourceRoot, { recursive: true });

    const sourceMp4 = path.join(sourceRoot, "hero.mp4");
    const duplicateMp4 = path.join(sourceRoot, "hero-copy.mp4");
    const sourceWebm = path.join(sourceRoot, "detail.webm");
    const invalidMp4 = path.join(sourceRoot, "broken.mp4");
    const unsupported = path.join(sourceRoot, "unsupported.avi");
    writeFileSync(sourceMp4, mp4Fixture());
    writeFileSync(duplicateMp4, mp4Fixture());
    writeFileSync(sourceWebm, webmFixture());
    writeFileSync(invalidMp4, Buffer.from("not-an-mp4"));
    writeFileSync(unsupported, mp4Fixture());

    assert.equal(inspectVideoSource(sourceMp4).mimeType, "video/mp4");
    assert.equal(inspectVideoSource(sourceWebm).mimeType, "video/webm");
    assert.throws(
      () => inspectVideoSource(invalidMp4),
      (error) => error?.code === "VIDEO_FORMAT_MISMATCH"
    );
    assert.throws(
      () => inspectVideoSource(unsupported),
      (error) => error?.code === "VIDEO_FORMAT_UNSUPPORTED"
    );

    const imported = await importVideoFiles({
      inputPaths: [sourceMp4, duplicateMp4, sourceWebm, invalidMp4, unsupported],
      outputDir
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.selectedCount, 5);
    assert.equal(imported.importedCount, 3);
    assert.equal(imported.skippedCount, 2);
    assert.equal(imported.reusedCount, 1);
    assert.equal(imported.assets[0].path, imported.assets[1].path, "Duplicate video bytes must reuse one managed file");
    assert.notEqual(imported.assets[0].occurrenceId, imported.assets[1].occurrenceId, "Duplicate selections remain distinct canvas occurrences");
    assert.equal(imported.assets[2].mimeType, "video/webm");
    assert.ok(imported.assets.every((asset) => isInside(asset.path, outputDir)));
    assert.ok(imported.assets.every((asset) => existsSync(asset.path)));
    assert.equal(
      createHash("sha256").update(readFileSync(imported.assets[0].path)).digest("hex"),
      imported.assets[0].contentHash
    );
    assert.equal(JSON.stringify(imported.errors).includes(sourceRoot), false, "Import errors must not expose source directories");

    const interrupted = sanitizeSession({
      nodes: [{
        id: "V-INTERRUPTED",
        type: "video",
        status: "working",
        videoState: "generating",
        videoModel: "doubao-seedance-2-0-260128",
        x: 10,
        y: 20,
        assets: [{ path: "must-not-survive.png" }]
      }],
      messages: [],
      conversations: []
    }).nodes[0];
    assert.equal(interrupted.type, "video");
    assert.equal(interrupted.videoState, "error");
    assert.match(interrupted.videoError, /中断/);
    assert.equal(interrupted.assets, undefined);

    const projectRelativePath = (rootPath, filePath) => isInside(filePath, rootPath)
      ? path.relative(path.resolve(rootPath), path.resolve(filePath)).split(path.sep).join("/")
      : "";
    const resolveProjectRelativePath = (rootPath, relativePath) => {
      const resolved = path.resolve(rootPath, String(relativePath || ""));
      return isInside(resolved, rootPath) ? resolved : "";
    };
    const repository = createProjectAssetRepository({
      assetPathFromUrl: () => "",
      assetUrlFor: (filePath) => `naimage-asset://local/${projectRelativePath(projectPath, filePath)}`,
      boundedImageRead: readFileSync,
      comparablePath: comparable,
      isComparablePathInside: isInside,
      maxExportImageBytes: 32 * 1024 * 1024,
      projectMetaDirName: ".naimage",
      projectRelativePath,
      projectRoot: projectPath,
      realPathIfPresent,
      resolveProjectRelativePath,
      sanitizeSession,
      sessionAssetContentHash,
      sessionPath: path.join(projectPath, "session.json")
    });
    const project = { id: "video-project", path: projectPath, sessionPath: path.join(projectPath, "session.json") };
    const saved = repository.sessionForProjectSave({
      nodes: [{
        id: "V1",
        title: "Hero video",
        prompt: "Imported local video",
        type: "video",
        status: "done",
        outputs: 1,
        x: 100,
        y: 120,
        videoState: "ready",
        videoModel: "doubao-seedance-2-0-260128",
        videoAsset: {
          ...imported.assets[0],
          relativePath: projectRelativePath(projectPath, imported.assets[0].path),
          assetUrl: "naimage-asset://local/runtime-only"
        }
      }],
      messages: [],
      conversations: []
    }, project);
    const savedAsset = saved.nodes[0].videoAsset;
    assert.equal(savedAsset.path, undefined);
    assert.equal(savedAsset.assetUrl, undefined);
    assert.equal(savedAsset.url, undefined);
    assert.match(savedAsset.relativePath, /^output\/video\/imports\//);
    assert.equal(JSON.stringify(saved).includes(projectPath), false, "Persisted video sessions must not contain project absolute paths");
    assert.equal(JSON.stringify(saved).includes(sourceRoot), false, "Persisted video sessions must not contain source absolute paths");

    const restored = repository.sessionWithProjectAssets(saved, project);
    const restoredAsset = restored.nodes[0].videoAsset;
    assert.equal(comparable(restoredAsset.path), comparable(imported.assets[0].path));
    assert.match(restoredAsset.assetUrl, /^naimage-asset:/);
    assert.equal(restored.nodes[0].videoState, "ready");
    assert.equal(restored.nodes[0].status, "done");

    assert.equal(repository.videoAssetForProjectSave({
      type: "file",
      path: sourceMp4,
      mimeType: "video/mp4"
    }, projectPath), undefined, "External source paths must never be persisted as project video assets");

    const packageService = createProjectPackageService();
    assert.throws(
      () => packageService.validateProjectPackageData({
        format: "naimage-project-package",
        version: 1,
        session: saved,
        assets: []
      }),
      (error) => error?.code === "NAIMAGE_PROJECT_PACKAGE_VIDEO_UNSUPPORTED",
      "The image-only portable package path must reject video nodes explicitly"
    );

    const seedanceRequest = createVideoTaskRequest({
      model: "doubao-seedance-2-0-260128",
      prompt: "商品保持外观一致并缓慢转动",
      seconds: 5,
      aspectRatio: "9:16",
      resolution: "1080p"
    });
    assert.equal(seedanceRequest.family, "video-generations");
    assert.equal(seedanceRequest.body.seconds, "5");
    assert.equal(seedanceRequest.body.duration, 5);
    assert.deepEqual(seedanceRequest.body.metadata, { resolution: "1080p", ratio: "9:16" });
    assert.deepEqual(videoTaskEndpoints(seedanceRequest.model, "remote/task 1"), {
      family: "video-generations",
      create: "/v1/video/generations",
      poll: "/v1/video/generations/remote%2Ftask%201",
      content: ""
    });
    assert.deepEqual(normalizeVideoTaskResponse({
      data: { task: { task_id: "remote-1", status: "processing", progress: 0.25 } },
      metadata: { output: { video_url: "https://cdn.example/video.mp4" } }
    }), {
      remoteTaskId: "remote-1",
      state: "running",
      progress: 25,
      resultUrl: "https://cdn.example/video.mp4",
      error: ""
    });
    assert.equal(explicitVideoCreateRejection({ status: 400 }), true);
    assert.equal(explicitVideoCreateRejection({ status: 503, responseReceived: true }), false);
    assert.equal(explicitVideoCreateRejection({ explicitRejection: true, status: 200 }), true);

    const journalPath = path.join(projectPath, ".naimage", "video-task-journal.json");
    const readJson = (filePath, fallback) => {
      try {
        return JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        return structuredClone(fallback);
      }
    };
    const writeJson = (filePath, value) => {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    };
    const projectRelativePathForTask = (rootPath, filePath) => isInside(filePath, rootPath)
      ? path.relative(path.resolve(rootPath), path.resolve(filePath)).split(path.sep).join("/")
      : "";
    const resolveProjectRelativePathForTask = (rootPath, relativePath) => {
      const resolved = path.resolve(rootPath, String(relativePath || ""));
      return isInside(resolved, rootPath) ? resolved : "";
    };
    const credential = (apiKey = "fixture-video-key") => ({
      mode: "account",
      baseUrl: "https://relay.example",
      apiKey,
      tokenId: "token-1",
      label: "Fixture Token"
    });
    const serviceOptions = (overrides = {}) => ({
      assetUrlFor: (filePath) => `naimage-asset://local/${projectRelativePathForTask(projectPath, filePath)}`,
      fetchBinary: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "video/mp4" : null },
        body: Readable.from([mp4Fixture()])
      }),
      getProjectById: (projectId) => projectId === project.id ? project : null,
      projectRelativePath: projectRelativePathForTask,
      readJson,
      readProjectList: () => ({ projects: [project] }),
      requestJson: async () => ({ data: { task_id: "remote-default", status: "queued" } }),
      resolveCredentials: async () => credential(),
      resolveProjectRelativePath: resolveProjectRelativePathForTask,
      writeJson,
      ...overrides
    });

    const createCalls = [];
    const douyinSocialContent = {
      platform: "douyin",
      contentType: "video",
      workflowId: "social-workflow-0123456789abcdef0123456789abcdef",
      slot: "video",
      status: "draft"
    };
    const creatingService = createVideoTaskService(serviceOptions({
      requestJson: async (request) => {
        createCalls.push(request);
        assert.equal(request.method, "POST");
        assert.equal(request.retries, 0, "Video creation POST must never retry automatically");
        return { data: { data: { task: { task_id: "remote-resume-1", status: "queued" } } } };
      }
    }));
    const createdTask = await creatingService.createTask({
      expectedProjectId: project.id,
      nodeId: "video-generated-1",
      idempotencyKey: "fixture-video-idempotency-1",
      model: "doubao-seedance-2-0-260128",
      prompt: "生成一条最小测试视频",
      seconds: 5,
      aspectRatio: "16:9",
      resolution: "720p",
      placement: { x: 320, y: 240 },
      socialContent: douyinSocialContent,
      confirmed: true
    });
    assert.equal(createdTask.ok, true);
    assert.equal(createdTask.task.remoteTaskId, "remote-resume-1");
    assert.deepEqual(createdTask.task.socialContent, douyinSocialContent);
    assert.equal(createCalls.length, 1);
    const reusedCreatedTask = await creatingService.createTask({
      expectedProjectId: project.id,
      nodeId: "video-generated-duplicate",
      idempotencyKey: "fixture-video-idempotency-1",
      model: "doubao-seedance-2-0-260128",
      prompt: "这次调用必须复用已有社媒视频任务",
      seconds: 5,
      aspectRatio: "16:9",
      resolution: "720p",
      placement: { x: 420, y: 240 },
      socialContent: douyinSocialContent,
      confirmed: true
    });
    assert.equal(reusedCreatedTask.reused, true);
    assert.equal(reusedCreatedTask.task.taskId, createdTask.task.taskId);
    assert.deepEqual(reusedCreatedTask.task.socialContent, douyinSocialContent);
    assert.equal(createCalls.length, 1, "A stable social workflow idempotency key must never issue a second creation POST");
    creatingService.dispose();
    const journalAfterCreate = readFileSync(journalPath, "utf8");
    assert.equal(journalAfterCreate.includes("fixture-video-key"), false, "Video journal must not persist API keys");

    let changedCredentialRequests = 0;
    const changedCredentialService = createVideoTaskService(serviceOptions({
      requestJson: async () => {
        changedCredentialRequests += 1;
        return { data: { task_id: "must-not-be-called", status: "queued" } };
      },
      resolveCredentials: async () => credential("replacement-video-key")
    }));
    await changedCredentialService.pollTask(project.id, createdTask.task.taskId);
    const protectedTask = await changedCredentialService.getTask(project.id, createdTask.task.taskId);
    assert.equal(changedCredentialRequests, 0, "A changed token must block recovery before any upstream request");
    assert.match(protectedTask.pollError, /Token.*变化/);
    changedCredentialService.dispose();

    const resumedRequests = [];
    const resumedService = createVideoTaskService(serviceOptions({
      requestJson: async (request) => {
        resumedRequests.push(request);
        assert.equal(request.method, "GET", "Restart recovery must poll instead of recreating a billed task");
        return {
          data: {
            data: {
              task: {
                task_id: "remote-resume-1",
                status: "succeeded",
                output: { url: "https://cdn.example/generated.mp4" }
              }
            }
          }
        };
      }
    }));
    const resumed = await resumedService.resumeAll();
    assert.equal(resumed.resumed, 1);
    assert.equal(resumedRequests.length, 0, "Resume schedules polling and must not create a task eagerly");
    await resumedService.pollTask(project.id, createdTask.task.taskId);
    const readyTask = await resumedService.getTask(project.id, createdTask.task.taskId);
    assert.equal(readyTask.state, "ready");
    assert.deepEqual(readyTask.socialContent, douyinSocialContent, "Restart recovery must preserve social workflow identity");
    assert.match(readyTask.output.relativePath, /^output\/video\/generated\//);
    assert.ok(existsSync(readyTask.output.path));
    assert.equal(Object.hasOwn(readyTask, "resultUrl"), false, "Signed provider result URLs must remain Main-only");
    assert.equal(resumedRequests.every((request) => request.method === "GET"), true);
    resumedService.dispose();

    const persistedJournal = readFileSync(journalPath, "utf8");
    const persistedDocument = JSON.parse(persistedJournal);
    assert.deepEqual(
      persistedDocument.tasks.find((task) => task.taskId === createdTask.task.taskId)?.socialContent,
      douyinSocialContent,
      "Video journal must persist sanitized social workflow identity"
    );
    assert.equal(
      persistedDocument.tasks.some((task) => task.output && (Object.hasOwn(task.output, "path") || Object.hasOwn(task.output, "assetUrl"))),
      false,
      "Video journal outputs must persist relative paths only"
    );
    assert.equal(
      persistedDocument.tasks.some((task) => task.state === "ready" && Object.hasOwn(task, "resultUrl")),
      false,
      "A materialized video task must not retain a temporary signed result URL"
    );
    assert.match(persistedJournal, /output\/video\/generated\//);

    const readyWithoutOutput = persistedDocument.tasks.find((task) => task.taskId === createdTask.task.taskId);
    assert.ok(readyWithoutOutput);
    readyWithoutOutput.state = "ready";
    delete readyWithoutOutput.output;
    writeJson(journalPath, persistedDocument);
    const missingOutputService = createVideoTaskService(serviceOptions());
    const recoveredMissingOutput = await missingOutputService.getTask(project.id, createdTask.task.taskId);
    assert.equal(recoveredMissingOutput.state, "succeeded", "A ready task without a managed file must resume download recovery");
    missingOutputService.dispose();

    const fallbackDownloadSources = [];
    const contentFallbackService = createVideoTaskService(serviceOptions({
      requestJson: async (request) => {
        assert.equal(request.method, "POST");
        return { data: { id: "remote-content-fallback-1", status: "succeeded", url: "https://cdn.example/fallback.mp4" } };
      },
      fetchBinary: async ({ endpointOrUrl }) => {
        fallbackDownloadSources.push(endpointOrUrl);
        if (String(endpointOrUrl).startsWith("/v1/videos/")) {
          return {
            ok: false,
            status: 404,
            headers: { get: () => null },
            body: Readable.from([])
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "video/mp4" : null },
          body: Readable.from([mp4Fixture()])
        };
      }
    }));
    const contentFallback = await contentFallbackService.createTask({
      expectedProjectId: project.id,
      idempotencyKey: "fixture-video-content-fallback",
      endpointFamily: "videos",
      model: "sora-2",
      prompt: "下载回退测试",
      confirmed: true
    });
    assert.equal(contentFallback.ok, true);
    assert.equal(contentFallback.task.state, "ready");
    assert.deepEqual(fallbackDownloadSources, [
      "/v1/videos/remote-content-fallback-1/content",
      "https://cdn.example/fallback.mp4"
    ]);
    contentFallbackService.dispose();

    let ambiguousPostCount = 0;
    const ambiguousService = createVideoTaskService(serviceOptions({
      requestJson: async () => {
        ambiguousPostCount += 1;
        const error = new Error("upstream unavailable");
        error.status = 503;
        error.responseReceived = true;
        throw error;
      }
    }));
    const ambiguous = await ambiguousService.createTask({
      expectedProjectId: project.id,
      idempotencyKey: "fixture-video-idempotency-ambiguous",
      model: "doubao-seedance-2-0-260128",
      prompt: "创建结果不明测试",
      confirmed: true
    });
    assert.equal(ambiguous.ambiguous, true);
    assert.equal(ambiguous.task.state, "create-unknown");
    assert.equal(ambiguousPostCount, 1, "Ambiguous creation must never be retried automatically");
    ambiguousService.dispose();

    let rejectedPostCount = 0;
    const rejectedService = createVideoTaskService(serviceOptions({
      requestJson: async () => {
        rejectedPostCount += 1;
        const error = new Error("invalid request");
        error.status = 400;
        error.responseReceived = true;
        throw error;
      }
    }));
    const rejected = await rejectedService.createTask({
      expectedProjectId: project.id,
      idempotencyKey: "fixture-video-idempotency-rejected",
      model: "doubao-seedance-2-0-260128",
      prompt: "明确拒绝测试",
      confirmed: true
    });
    assert.equal(rejected.ambiguous, false);
    assert.equal(rejected.task.state, "failed");
    const rejectedReuse = await rejectedService.createTask({
      expectedProjectId: project.id,
      idempotencyKey: "fixture-video-idempotency-rejected",
      model: "doubao-seedance-2-0-260128",
      prompt: "明确拒绝测试",
      confirmed: true
    });
    assert.equal(rejectedReuse.reused, true);
    assert.equal(rejectedReuse.ok, false, "Reusing a failed idempotency key must not report success");
    assert.equal(rejectedPostCount, 1, "Reusing a terminal idempotency key must not issue another POST");
    rejectedService.dispose();

    rmSync(imported.assets[0].path, { force: true });
    const missing = repository.sessionWithProjectAssets(saved, project).nodes[0];
    assert.equal(missing.videoState, "error");
    assert.match(missing.videoError, /不存在|受管目录/);

    process.stdout.write(`${JSON.stringify({ ok: true, imported: imported.importedCount, skipped: imported.skippedCount, reused: imported.reusedCount, persistedRelativeOnly: true, restartRecovery: true })}\n`);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
