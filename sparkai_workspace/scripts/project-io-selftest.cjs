"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PROJECT_ASSET_REPOSITORY_OWNER } = require("../desktop/project-asset-repository.cjs");
const { mergeProjectSessions } = require("../desktop/project-session-merge.cjs");
const { createProjectCreationService } = require("../desktop/project-creation-service.cjs");
const { createAgentTaskService } = require("../desktop/agent-task-service.cjs");
const { projectKnowledgeEntryFingerprint, projectKnowledgeSnapshotFingerprint } = require("../runtime/project-knowledge-contract.mjs");
const {
  PROJECT_PACKAGE_SERVICE_OWNER,
  projectPackageMaximumAssetBytes,
  projectPackageMaximumAssets,
  projectPackageMaximumDecodedBytes,
  projectPackageMaximumFileBytes,
} = require("../desktop/project-package-service.cjs");

process.env.NAIMAGE_PROJECT_IO_SELFTEST = "1";
const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-project-io-selftest-"));
process.env.NAIMAGE_CONFIG_DIR = path.join(testRoot, "config");

const { app } = require("electron");
const projectIo = require("../electron-main.cjs");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fixturePng(marker) {
  return Buffer.concat([PNG_1X1, Buffer.from([Number(marker) & 0xff])]);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function projectRecord(id) {
  const projectPath = path.join(testRoot, id);
  return {
    id,
    name: id,
    path: projectPath,
    sessionPath: path.join(projectPath, "session.json"),
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    external: true,
  };
}

function imageNode(id, assets, extra = {}) {
  return {
    id,
    title: id,
    prompt: `${id} prompt`,
    type: "image",
    status: "done",
    imageState: "done",
    outputs: assets.length,
    x: 0,
    y: 0,
    assets,
    ...extra,
  };
}

async function run() {
  assert.equal(projectIo.applicationName, "SparkAI WorkSpace");
  assert.equal(projectIo.applicationId, "org.sparkai.naimage");
  const metadataProject = projectRecord("metadata-read-only");
  const missingMetadata = projectIo.projectSessionMetadataFromDisk(metadataProject);
  assert.deepEqual(missingMetadata.nodes, []);
  assert.equal(existsSync(metadataProject.path), false, "Metadata search must not create or migrate a missing project");
  mkdirSync(metadataProject.path, { recursive: true });
  writeFileSync(metadataProject.sessionPath, "{corrupt", "utf8");
  assert.throws(() => projectIo.projectSessionMetadataFromDisk(metadataProject), error => error.code === "PROJECT_CONTEXT_SESSION_UNREADABLE");
  assert.equal(readFileSync(metadataProject.sessionPath, "utf8"), "{corrupt", "Metadata read failure must preserve corrupt authoritative bytes");
  writeJson(metadataProject.sessionPath, { ...projectIo.defaultSession, sessionRevision: 9,
    nodes: [imageNode("META", [{ type: "file", path: "missing.png", relativePath: "assets/missing.png" }])] });
  const metadataBefore = readFileSync(metadataProject.sessionPath, "utf8");
  const metadataOnly = projectIo.projectSessionMetadataFromDisk(metadataProject);
  assert.equal(metadataOnly.sessionRevision, 9);
  assert.equal(metadataOnly.nodes[0].assets[0].path, "missing.png", "Metadata reads must not hydrate or replace asset locators");
  assert.equal(readFileSync(metadataProject.sessionPath, "utf8"), metadataBefore);
  for (const format of ["export", "manifest"]) for (const [index, invalid] of ["{corrupt", "[]", '{"version":1,"session":[]}', '{"version":1,"session":42}'].entries()) {
    const legacyMetadataProject = projectRecord(`metadata-legacy-${format}-${index}`);
    const legacyMetadataFile = path.join(legacyMetadataProject.path, format === "export" ? "start.iiimage" : ".iiimage/project.json");
    mkdirSync(path.dirname(legacyMetadataFile), { recursive: true }); writeFileSync(legacyMetadataFile, invalid, "utf8");
    assert.throws(() => projectIo.projectSessionMetadataFromDisk(legacyMetadataProject), error => {
      assert.equal(error.code, "PROJECT_CONTEXT_SESSION_UNREADABLE");
      assert.equal(error.message.includes(legacyMetadataProject.path), false, "Legacy metadata errors must not expose local paths");
      return true;
    }, `A malformed selected legacy ${format} must fail closed rather than masquerade as an empty project`);
    assert.equal(readFileSync(legacyMetadataFile, "utf8"), invalid, "Metadata failure must preserve the selected legacy source bytes");
    assert.equal(existsSync(legacyMetadataProject.sessionPath), false, "Metadata failure must not migrate a legacy project into session.json");
    assert.equal(existsSync(path.join(legacyMetadataProject.path, ".naimage")), false, "Metadata failure must not create canonical project metadata");
  }
  const creationProject = projectRecord("creation-contract");
  projectIo.ensureProjectFiles(creationProject, projectIo.defaultSession);
  const creationServiceOptions = { projectFor: id => id === creationProject.id ? creationProject : null,
    readSession: () => projectIo.projectSessionFromDisk(creationProject),
    projectRelativePath: (base, file) => path.relative(base, file || "").replace(/\\/g, "/"),
    resolveProjectRelativePath: (base, file) => path.resolve(base, file) };
  const creationService = createProjectCreationService(creationServiceOptions);
  const creationSaved = creationService.updateRequirements({ projectId: creationProject.id, conversationId: "creation-conversation", expectedRevision: 0,
    requirements: { goal: { text: "真实项目往返", source: "user" }, usage: { text: "项目持久化验收", source: "assumption" },
      slots: [{ slotId: "stable-hero", label: "主图", source: "user" }], preserve: [], adjustable: [], conditions: [] } });
  const creationFile = path.join(creationProject.path, "assets", "creation.png");
  mkdirSync(path.dirname(creationFile), { recursive: true }); writeFileSync(creationFile, PNG_1X1);
  const creationAsset = { assetId: "creation-asset", occurrenceId: `occ-${"c".repeat(32)}`, contentHash: createHash("sha256").update(PNG_1X1).digest("hex"),
    type: "file", path: creationFile, relativePath: "assets/creation.png", width: 1, height: 1 };
  const creationProvenance = { version: 1, taskScopeSnapshotHash: `scope-${"c".repeat(32)}`, resultPolicy: "single", creation: creationSaved.requirementRef,
    creationSlotId: "stable-hero", creationRevisionId: "revision-roundtrip", creationBaselineReviewIds: ["review-original"],
    creationPreserve: ["保留主体"], creationChanges: ["修改背景"], sourceAssetId: creationAsset.assetId,
    sourceOccurrenceId: creationAsset.occurrenceId, sourceContentHash: creationAsset.contentHash };
  const creationStored = projectIo.sessionForProjectSave({ ...projectIo.defaultSession, schemaVersion: 5,
    nodes: [imageNode("CREATION", [creationAsset], { taskProvenance: creationProvenance })] }, creationProject);
  writeJson(creationProject.sessionPath, creationStored); projectIo.writeProjectManifest(creationProject, creationStored);
  const creationReloaded = projectIo.projectSessionFromDisk(creationProject);
  assert.deepEqual(creationReloaded.nodes[0].taskProvenance.creation, creationSaved.requirementRef);
  assert.equal(creationReloaded.nodes[0].taskProvenance.creationSlotId, "stable-hero");
  assert.deepEqual(creationReloaded.nodes[0].taskProvenance.creationChanges, ["修改背景"]);
  assert.equal(creationReloaded.nodes[0].taskProvenance.sourceContentHash, creationAsset.contentHash);
  const creationRestarted = createProjectCreationService(creationServiceOptions);
  assert.equal(creationRestarted.getRequirements({ projectId: creationProject.id, conversationId: "creation-conversation" }).requirements.goal.text, "真实项目往返");
  const creationChecked = await creationRestarted.checkResults({ projectId: creationProject.id, conversationId: "creation-conversation", expectedRevision: 1, targets: [creationAsset] });
  assert.equal(creationChecked.results[0].fileCheck.status, "passed");
  assert.equal(creationChecked.results[0].saved, true);
  const legacyUserDataRoot = path.join(testRoot, "legacy-user-data");
  const canonicalUserDataRoot = path.join(testRoot, "canonical-user-data");
  mkdirSync(path.join(legacyUserDataRoot, "data"), { recursive: true });
  mkdirSync(path.join(legacyUserDataRoot, "workspace"), { recursive: true });
  mkdirSync(path.join(legacyUserDataRoot, "Local Storage", "leveldb"), { recursive: true });
  mkdirSync(path.join(legacyUserDataRoot, "Cache"), { recursive: true });
  mkdirSync(path.join(canonicalUserDataRoot, "data"), { recursive: true });
  writeFileSync(path.join(legacyUserDataRoot, "data", "legacy-only.json"), "LEGACY-ONLY");
  writeFileSync(path.join(legacyUserDataRoot, "data", "preserved.json"), "LEGACY-MUST-NOT-WIN");
  writeFileSync(path.join(canonicalUserDataRoot, "data", "preserved.json"), "CANONICAL-WINS");
  writeFileSync(path.join(legacyUserDataRoot, "workspace", "memory.db"), "LEGACY-MEMORY");
  writeFileSync(path.join(legacyUserDataRoot, "Local Storage", "leveldb", "000003.log"), "LEGACY-LOCAL-STORAGE");
  writeFileSync(path.join(legacyUserDataRoot, "Cache", "ignored.bin"), "UNOWNED");
  const migratedUserData = projectIo.migrateLegacyUserData({ targetRoot: canonicalUserDataRoot, legacyRoots: [legacyUserDataRoot] });
  assert.equal(migratedUserData.status, "migrated");
  assert.equal(readFileSync(path.join(canonicalUserDataRoot, "data", "preserved.json"), "utf8"), "CANONICAL-WINS");
  assert.equal(readFileSync(path.join(canonicalUserDataRoot, "data", "legacy-only.json"), "utf8"), "LEGACY-ONLY");
  assert.equal(readFileSync(path.join(canonicalUserDataRoot, "workspace", "memory.db"), "utf8"), "LEGACY-MEMORY");
  assert.equal(readFileSync(path.join(canonicalUserDataRoot, "Local Storage", "leveldb", "000003.log"), "utf8"), "LEGACY-LOCAL-STORAGE");
  assert.equal(existsSync(path.join(canonicalUserDataRoot, "Cache", "ignored.bin")), false);
  writeFileSync(path.join(legacyUserDataRoot, "data", "after-marker.json"), "MUST-NOT-COPY");
  assert.equal(projectIo.migrateLegacyUserData({ targetRoot: canonicalUserDataRoot, legacyRoots: [legacyUserDataRoot] }).status, "already-complete");
  assert.equal(existsSync(path.join(canonicalUserDataRoot, "data", "after-marker.json")), false);
  assert.equal(projectIo.projectAssetRepositoryOwner, PROJECT_ASSET_REPOSITORY_OWNER, "Project asset persistence must have one explicit desktop owner");
  assert.equal(projectIo.buildProjectAssetIndex, projectIo.projectAssetRepository.buildProjectAssetIndex, "Main must re-export the repository-owned asset index implementation without a duplicate wrapper");
  assert.equal(projectIo.sessionForProjectSave, projectIo.projectAssetRepository.sessionForProjectSave, "Main must re-export the repository-owned save normalizer without a duplicate implementation");
  assert.equal(projectIo.sessionWithProjectAssets, projectIo.projectAssetRepository.sessionWithProjectAssets, "Main must re-export the repository-owned hydration implementation without a duplicate implementation");
  assert.equal(projectIo.projectPackageServiceOwner, PROJECT_PACKAGE_SERVICE_OWNER, "Project package persistence must have one explicit desktop owner");
  assert.equal(projectIo.packageProject, projectIo.projectPackageService.packageProject, "Main must re-export the service-owned package implementation without a duplicate wrapper");
  assert.equal(projectIo.sessionFromPackage, projectIo.projectPackageService.sessionFromPackage, "Main must re-export the service-owned package restore implementation without a duplicate wrapper");
  assert.equal(projectIo.validateProjectPackageData, projectIo.projectPackageService.validateProjectPackageData, "Main must re-export the service-owned package validator without a duplicate wrapper");
  assert.equal(projectIo.projectPackageMaximumAssetBytes, projectPackageMaximumAssetBytes, "Main must re-export the service-owned per-asset package limit");
  assert.equal(projectIo.projectPackageMaximumAssets, projectPackageMaximumAssets, "Main must re-export the service-owned package asset-count limit");
  assert.equal(projectIo.projectPackageMaximumDecodedBytes, projectPackageMaximumDecodedBytes, "Main must re-export the service-owned decoded package limit");
  assert.equal(projectIo.projectPackageMaximumFileBytes, projectPackageMaximumFileBytes, "Main must re-export the service-owned package file limit");
  const externalParent = path.join(testRoot, "external-parent");
  mkdirSync(externalParent, { recursive: true });
  mkdirSync(path.join(externalParent, "画布 3"), { recursive: true });
  const occupiedExternal = projectRecord("occupied-external");
  occupiedExternal.path = path.join(externalParent, "画布 3 (2)");
  occupiedExternal.sessionPath = path.join(occupiedExternal.path, "session.json");
  const externalList = { activeProjectId: occupiedExternal.id, projects: [occupiedExternal] };
  assert.equal(
    projectIo.nextExternalProjectFolderPath(externalParent, "画布 3", externalList),
    path.join(externalParent, "画布 3 (3)"),
    "A new external project must be created below the selected parent instead of claiming the parent itself",
  );
  const explicitFolderProject = projectRecord("explicit-folder-project");
  assert.equal(
    projectIo.projectForFolderOpen({ activeProjectId: occupiedExternal.id, projects: [occupiedExternal, explicitFolderProject] }, explicitFolderProject.id).id,
    explicitFolderProject.id,
    "Opening a project folder must honor the renderer project id even if the active list changes",
  );

  const outputProjectA = projectRecord("output-a");
  const outputProjectB = projectRecord("output-b");
  writeJson(path.join(process.env.NAIMAGE_CONFIG_DIR, "project-list.json"), {
    activeProjectId: outputProjectA.id,
    projects: [outputProjectA, outputProjectB],
  });
  assert.equal(
    projectIo.outputBucketDirForProjectId(outputProjectB.id, "imagegen"),
    path.join(outputProjectB.path, "output", "imagegen"),
  );
  assert.throws(
    () => projectIo.outputBucketDirForProjectId("missing-project", "imagegen"),
    /输出目标项目不存在或已被移除/,
  );
  const videoProject = projectRecord("video-roundtrip");
  const videoPath = path.join(videoProject.path, "output", "video", "imports", "seedance.mp4");
  const videoBytes = Buffer.alloc(32);
  videoBytes.writeUInt32BE(24, 0);
  videoBytes.write("ftyp", 4, "ascii");
  videoBytes.write("isom", 8, "ascii");
  mkdirSync(path.dirname(videoPath), { recursive: true });
  writeFileSync(videoPath, videoBytes);
  const videoContentHash = createHash("sha256").update(videoBytes).digest("hex");
  const savedVideoSession = projectIo.sessionForProjectSave({
    nodes: [{
      id: "VIDEO-1",
      title: "Seedance video",
      prompt: "Imported video result",
      type: "video",
      status: "done",
      outputs: 1,
      x: 80,
      y: 120,
      videoState: "ready",
      videoModel: "doubao-seedance-2-0-260128",
      videoAsset: {
        assetId: `video-${videoContentHash.slice(0, 32)}`,
        occurrenceId: `occ-${"a".repeat(32)}`,
        contentHash: videoContentHash,
        type: "file",
        path: videoPath,
        originalName: "seedance.mp4",
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        durationMs: 3200,
      },
    }],
    messages: [],
    conversations: [],
  }, videoProject);
  const savedVideoAsset = savedVideoSession.nodes[0].videoAsset;
  assert.equal(savedVideoAsset.path, undefined, "Video session persistence must strip managed absolute paths");
  assert.equal(savedVideoAsset.assetUrl, undefined, "Runtime-only video URLs must not be persisted");
  assert.equal(savedVideoAsset.relativePath, "output/video/imports/seedance.mp4");
  assert.equal(JSON.stringify(savedVideoSession).includes(videoProject.path), false);
  writeJson(videoProject.sessionPath, savedVideoSession);
  projectIo.writeProjectManifest(videoProject, savedVideoSession);
  const videoManifest = projectIo.readProjectManifest(videoProject);
  assert.equal(videoManifest.videos.length, 1);
  assert.equal(videoManifest.videos[0].path, "output/video/imports/seedance.mp4");
  assert.equal(videoManifest.videos[0].model, "doubao-seedance-2-0-260128");
  const restoredVideoSession = projectIo.sessionWithProjectAssets(savedVideoSession, videoProject);
  assert.equal(path.resolve(restoredVideoSession.nodes[0].videoAsset.path), path.resolve(videoPath));
  assert.match(restoredVideoSession.nodes[0].videoAsset.assetUrl, /^naimage-asset:/);
  assert.equal(restoredVideoSession.nodes[0].videoState, "ready");
  assert.throws(
    () => projectIo.packageProject(videoProject),
    (error) => error?.code === "NAIMAGE_PROJECT_PACKAGE_VIDEO_UNSUPPORTED",
    "The image-only portable package path must reject video projects explicitly",
  );
  const activeAgentImageRoots = projectIo.agentImageRootsForContext({ projectId: outputProjectA.id });
  assert.deepEqual(
    new Set(activeAgentImageRoots.map((root) => path.resolve(root))),
    new Set([
      path.join(outputProjectA.path, "output"),
      path.join(outputProjectA.path, "assets"),
      path.join(outputProjectA.path, ".naimage", "assets"),
      path.join(outputProjectA.path, ".iiimage", "assets"),
    ].map((root) => path.resolve(root))),
    "The active external project must expose only its managed image roots to view_image",
  );
  assert.deepEqual(
    new Set(projectIo.projectAssetRepository.projectWritableAssetRoots(outputProjectA.path).map((root) => path.resolve(root))),
    new Set([
      path.join(outputProjectA.path, "output", "imagegen"),
      path.join(outputProjectA.path, "output", "video"),
      path.join(outputProjectA.path, "assets"),
      path.join(outputProjectA.path, ".naimage", "assets"),
    ].map((root) => path.resolve(root))),
    "New project writes must never target a legacy .iiimage asset root",
  );
  assert.deepEqual(
    projectIo.agentImageRootsForContext({ projectId: outputProjectB.id }),
    [],
    "A stale or different project id must not receive active-project image authorization",
  );
  assert.deepEqual(
    new Set(projectIo.agentImageRootsForContext().map((root) => path.resolve(root))),
    new Set(activeAgentImageRoots.map((root) => path.resolve(root))),
    "Requests without an explicit id may use the current active project only",
  );

  const validProject = projectRecord("valid-assets");
  const validAssetDir = path.join(validProject.path, "output", "imagegen");
  mkdirSync(validAssetDir, { recursive: true });
  const validAssets = Array.from({ length: 320 }, (_, index) => {
    const filePath = path.join(validAssetDir, `valid-${String(index).padStart(4, "0")}.png`);
    writeFileSync(filePath, fixturePng(index));
    return { index: index + 1, type: "file", path: filePath, fileName: path.basename(filePath), runId: `valid-${index}` };
  });
  validAssets.push({ index: validAssets.length + 1, type: "url", url: "https://example.com/recorded-image.png" });
  validAssets.push({ index: validAssets.length + 1, type: "url", assetUrl: "data:image/png;base64,iVBORw0KGgo=" });
  let validScanCount = 0;
  const validHydrated = projectIo.sessionWithProjectAssets(
    { sessionRevision: 4, nodes: [imageNode("valid-node", validAssets)], messages: [], selectedNodeId: "valid-node" },
    validProject,
    {
      buildAssetIndex() {
        validScanCount += 1;
        throw new Error("valid recorded assets must not trigger recursive scanning");
      },
    },
  );
  assert.equal(validScanCount, 0);
  assert.equal(validHydrated.nodes[0].assets.length, validAssets.length);
  assert.equal(validHydrated.sessionRevision, 4);
  const canonicalAssetUrl = projectIo.assetUrlFor(validAssets[0].path);
  assert.match(canonicalAssetUrl, /^naimage-asset:/);
  assert.equal(projectIo.decodeLocalAssetUrl(canonicalAssetUrl), path.resolve(validAssets[0].path));
  const legacyAssetUrl = canonicalAssetUrl.replace(/^naimage-asset:/, "iiimage-asset:");
  assert.equal(projectIo.decodeLocalAssetUrl(legacyAssetUrl), path.resolve(validAssets[0].path));
  const hydratedLegacyAssetUrl = projectIo.sessionWithProjectAssets({
    nodes: [imageNode("legacy-url-node", [{ index: 1, type: "file", assetUrl: legacyAssetUrl }])],
    messages: [],
  }, validProject);
  assert.equal(hydratedLegacyAssetUrl.nodes[0].assets[0].path, path.resolve(validAssets[0].path));
  assert.match(hydratedLegacyAssetUrl.nodes[0].assets[0].assetUrl, /^naimage-asset:/);

  const generatedReplayAsset = {
    ...validAssets[0], assetId: "generated-replay-asset", occurrenceId: `occ-${"c".repeat(32)}`,
    runId: "generated-replay-run", title: "用户标题", contentName: { source: "manual", displayName: "用户标题" }
  };
  const generatedReplayNode = imageNode("generated-replay", [generatedReplayAsset], {
    persistenceOriginId: "renderer:generated-replay", imageProgress: { total: 1, completed: 1, failed: 0 }
  });
  let generatedReplaySession = projectIo.sessionForProjectSave({ nodes: [generatedReplayNode], messages: [] }, validProject);
  assert.ok(generatedReplaySession.nodes[0].assets[0].relativePath);
  for (let replay = 0; replay < 3; replay += 1) {
    const runtimeReplayNode = { ...generatedReplayNode, assets: [{
      ...generatedReplayAsset, title: "旧自动标题", contentName: { source: "fallback", displayName: "旧自动标题" }
    }] };
    const mergedReplay = mergeProjectSessions(generatedReplaySession, { nodes: [runtimeReplayNode], messages: [] }).session;
    generatedReplaySession = projectIo.sessionForProjectSave(mergedReplay, validProject);
    writeJson(validProject.sessionPath, generatedReplaySession);
    const reopenedReplay = projectIo.sessionWithProjectAssets(readJson(validProject.sessionPath), validProject);
    assert.equal(reopenedReplay.nodes.length, 1);
    assert.equal(reopenedReplay.nodes[0].assets.length, 1, "Native result replays stay singular through Main merge, serialization, disk and reopen");
    assert.equal(reopenedReplay.nodes[0].outputs, 1);
    assert.equal(reopenedReplay.nodes[0].assets[0].occurrenceId, generatedReplayAsset.occurrenceId);
    assert.equal(reopenedReplay.nodes[0].assets[0].title, "用户标题");
    assert.equal(reopenedReplay.nodes[0].assets[0].path, path.resolve(generatedReplayAsset.path));
  }

  const groupedReplaySecond = {
    ...validAssets[1], assetId: "generated-replay-second", occurrenceId: `occ-${"d".repeat(32)}`,
    runId: generatedReplayAsset.runId, title: "第二张用户标题", contentName: { source: "manual", displayName: "第二张用户标题" }
  };
  const groupedReplayAssets = [generatedReplaySession.nodes[0].assets[0], generatedReplayAsset, groupedReplaySecond];
  const groupedReplayCollection = {
    id: "generated-replay-group", kind: "batch", generationMode: "parallel",
    items: groupedReplayAssets.map((asset, index) => ({ id: `group-item-${index + 1}`, requestIndex: index + 1, assetIndex: index + 1, assetId: asset.assetId, occurrenceId: asset.occurrenceId, title: asset.title, prompt: "prompt", status: "done" }))
  };
  let groupedReplaySession = { nodes: [imageNode("generated-group", groupedReplayAssets, {
    persistenceOriginId: "renderer:generated-group", imageProgress: { total: 3, completed: 3, failed: 0 },
    imageCollection: groupedReplayCollection,
    imageContainerSpec: {
      version: 1, kind: "batch-result", memberNodeIds: [], childContainerNodeIds: [], layoutOrigin: "generation", autoFit: true,
      collection: groupedReplayCollection,
      memberBindings: groupedReplayAssets.map((asset, index) => ({ bindingId: `group-binding-${index}`, nodeId: "generated-group", containerNodeId: "generated-group", assetIndex: index, assetId: asset.assetId, occurrenceId: asset.occurrenceId }))
    }
  })], messages: [] };
  for (let replay = 0; replay < 3; replay += 1) {
    const mergedGroup = mergeProjectSessions(groupedReplaySession, { nodes: [imageNode("generated-group", [groupedReplaySecond, generatedReplayAsset], { persistenceOriginId: "renderer:generated-group" })], messages: [] }).session;
    writeJson(validProject.sessionPath, projectIo.sessionForProjectSave(mergedGroup, validProject));
    groupedReplaySession = projectIo.sessionWithProjectAssets(readJson(validProject.sessionPath), validProject);
    const group = groupedReplaySession.nodes[0];
    assert.equal(group.assets.length, 2);
    assert.equal(group.outputs, 2);
    assert.deepEqual(group.imageCollection.items.map(item => [item.id, item.assetIndex, item.occurrenceId, item.title]), [
      ["group-item-1", 1, generatedReplayAsset.occurrenceId, "用户标题"],
      ["group-item-3", 2, groupedReplaySecond.occurrenceId, "第二张用户标题"]
    ], "Duplicate removal must keep collection names and occurrences on their own images through real disk reopen");
    assert.deepEqual(group.imageContainerSpec.collection, group.imageCollection);
    assert.deepEqual(group.imageContainerSpec.memberBindings.map(binding => binding.assetIndex), [0, 1]);
    assert.equal(group.imageProgress.completed, 2);
  }

  const independentProject = projectRecord("identical-generated-results");
  projectIo.ensureProjectFiles(independentProject, projectIo.defaultSession);
  const independentConversation = "independent-results";
  writeJson(independentProject.sessionPath, projectIo.sessionForProjectSave({ ...projectIo.defaultSession, activeConversationId: independentConversation,
    conversations: [{ id: independentConversation, messages: [] }], nodes: [] }, independentProject));
  const { reconcileImageAssetIdentityClaims: reconcileRendererAssetClaims } = await import("../src/asset-identity.ts");
  const independentPng = await require("sharp")(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="#f7e9da"/><circle cx="512" cy="512" r="240" fill="#d44761"/></svg>')).png().toBuffer();
  // Real journal identities from the failed first-phase GUI run. Exercise the
  // Renderer owner before Main, which the earlier persistence-only test missed.
  const independentAssets = [
    { assetId: "image-7fcc7b7466814d6e14d72bcad3e9130e-1", occurrenceId: "occ-7fcc7b7466814d6e14d72bcad3e9130e01", runId: "agent-1792470151287-1" },
    { assetId: "image-31081a96b35465f987310b4b23b5b510-1", occurrenceId: "occ-31081a96b35465f987310b4b23b5b51001", runId: "agent-1792470154875-1" }
  ].map(identity => {
    const relativePath = `output/imagegen/${identity.assetId}-01.png`, file = path.join(independentProject.path, relativePath);
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, independentPng);
    return { ...identity, type: "file", path: file, relativePath,
      contentHash: createHash("sha256").update(independentPng).digest("hex"), index: 1 };
  });
  const independentOperations = [];
  let independentTasks;
  independentTasks = createAgentTaskService({ projectFor: () => independentProject,
    readSession: () => projectIo.projectSessionFromDisk(independentProject), operations: () => independentOperations,
    locateOwner: async () => "independent-owner", dispatch: async (command, args) => {
      independentTasks.admit({ ...args, runId: "independent-parent-run", taskScope: { snapshotHash: "scope-independent", sourceNodeIds: [], sourceAssets: [], referenceAssets: [], imageConfig: { model: "mock" } } }, "independent-owner");
      independentTasks.claimRun({ ...args, runId: "independent-parent-run" }, "independent-owner");
    } });
  const independentInput = { expectedProjectId: independentProject.id, conversationId: independentConversation, submissionId: "independent-submission", prompt: "two independent results" };
  const independentTask = (await independentTasks.execute("agent.task.start", independentInput)).task;
  for (const [index, asset] of independentAssets.entries()) {
    independentOperations.push({ agentTaskId: independentTask.taskId, runId: asset.runId, key: `independent-op-${index}`, state: "saved", assets: [asset] });
    const stored = projectIo.projectSessionFromDisk(independentProject);
    const incoming = { ...stored, nodes: [...stored.nodes, imageNode(`independent-${index}`, [asset], { persistenceOriginId: `independent-origin-${index}` })] };
    const rendererRecords = incoming.nodes.flatMap(node => (node.assets || []).map((candidate, assetIndex) => ({ candidate, claim: { ...candidate, ownerId: node.id, assetIndex } })));
    reconcileRendererAssetClaims(rendererRecords.map(record => record.claim)).forEach((resolution, claimIndex) => {
      rendererRecords[claimIndex].candidate.assetId = resolution.assetId;
    });
    assert.deepEqual(incoming.nodes.map(node => node.assets[0].assetId), independentAssets.slice(0, index + 1).map(candidate => candidate.assetId),
      "Renderer reconciliation must preserve each journal identity before Main receives the session");
    const merged = mergeProjectSessions(stored, incoming).session;
    const saved = projectIo.sessionForProjectSave(merged, independentProject);
    writeJson(independentProject.sessionPath, saved); projectIo.writeProjectManifest(independentProject, saved);
  }
  const reopenedIndependent = projectIo.projectSessionFromDisk(independentProject);
  assert.deepEqual(reopenedIndependent.nodes.map(node => node.assets[0].assetId), independentAssets.map(asset => asset.assetId), "Actual Main merge/save/manifest/reopen must retain IDs for equal bytes from separate requests");
  assert.deepEqual(reopenedIndependent.nodes.map(node => node.assets[0].occurrenceId), independentAssets.map(asset => asset.occurrenceId));
  independentTasks.settle({ ...independentInput, taskId: independentTask.taskId, runId: independentTask.currentRunId, outcome: "completed" }, "independent-owner");
  const independentReceipt = independentTasks.get({ ...independentInput, taskId: independentTask.taskId }).task;
  assert.equal(independentReceipt.phase, "completed"); assert.equal(independentReceipt.savedCount, 2);
  assert.deepEqual(independentReceipt.results.map(asset => asset.assetId), independentAssets.map(asset => asset.assetId), "The original journal receipts must reconcile to both actual saved outputs");

  const emptySelectionProject = projectRecord("empty-selection");
  const emptySelectionSession = projectIo.sessionForProjectSave({
    nodes: [imageNode("unselected-node", [])],
    messages: [],
    selectedNodeId: "",
  }, emptySelectionProject);
  assert.equal(
    emptySelectionSession.selectedNodeId,
    "",
    "An explicit empty canvas selection must survive project persistence instead of selecting the first node",
  );
  const invalidSelectionSession = projectIo.sessionForProjectSave({
    nodes: [imageNode("remaining-node", [])],
    messages: [],
    selectedNodeId: "deleted-node",
  }, emptySelectionProject);
  assert.equal(
    invalidSelectionSession.selectedNodeId,
    "",
    "A deleted selection must normalize to no selection instead of silently selecting another node",
  );

  const missingProject = projectRecord("missing-assets");
  const missingAssetDir = path.join(missingProject.path, "assets");
  mkdirSync(missingAssetDir, { recursive: true });
  const stablePath = path.join(missingProject.path, "output", "imagegen", "stable.png");
  mkdirSync(path.dirname(stablePath), { recursive: true });
  writeFileSync(stablePath, Buffer.from("stable"));
  const recoveredPath = path.join(missingAssetDir, "recover-me.png");
  writeFileSync(recoveredPath, Buffer.from("recovered"));
  let missingScanCount = 0;
  const missingHydrated = projectIo.sessionWithProjectAssets(
    {
      nodes: [imageNode("missing-node", [
        { index: 1, type: "file", path: stablePath, fileName: "stable.png" },
        { index: 2, type: "file", path: path.join(missingProject.path, "gone", "recover-me.png"), fileName: "recover-me.png" },
      ])],
      messages: [],
    },
    missingProject,
    {
      buildAssetIndex(projectPath) {
        missingScanCount += 1;
        return projectIo.buildProjectAssetIndex(projectPath);
      },
    },
  );
  assert.equal(missingScanCount, 1);
  assert.equal(missingHydrated.nodes[0].assets.length, 2);
  assert.equal(missingHydrated.nodes[0].assets[0].path, stablePath);
  assert.equal(missingHydrated.nodes[0].assets[1].path, recoveredPath);

  const movedProject = projectRecord("moved-project");
  const movedPathA = path.join(movedProject.path, "assets", "a", "same.png");
  const movedPathB = path.join(movedProject.path, "assets", "b", "same.png");
  mkdirSync(path.dirname(movedPathA), { recursive: true });
  mkdirSync(path.dirname(movedPathB), { recursive: true });
  writeFileSync(movedPathA, Buffer.from("moved-a"));
  writeFileSync(movedPathB, Buffer.from("moved-b"));
  const movedHashA = createHash("sha256").update(readFileSync(movedPathA)).digest("hex");
  const movedHashB = createHash("sha256").update(readFileSync(movedPathB)).digest("hex");
  const staleRoot = "Z:\\old-iiimage-project";
  const movedAssetA = { assetId: "moved-a", contentHash: movedHashA, index: 1, type: "file", path: `${staleRoot}\\assets\\a\\same.png`, relativePath: "assets/a/same.png", fileName: "same.png" };
  const movedAssetB = { assetId: "moved-b", contentHash: movedHashB, index: 1, type: "file", path: `${staleRoot}\\assets\\b\\same.png`, relativePath: "assets/b/same.png", fileName: "same.png" };
  const movedRawSession = {
    sessionRevision: 5,
    nodes: [
      imageNode("moved-A", [movedAssetA], {
        imageParams: { prompt: "moved nested", referenceImages: [{ ...movedAssetB, name: "nested B" }] },
        layerGroup: { id: "moved-layer", groupNumber: 1, order: 1, total: 1, layerId: "subject", layerTitle: "主体", previewAsset: { ...movedAssetA }, mergedAsset: { ...movedAssetB } },
      }),
      imageNode("moved-B", [movedAssetB]),
    ],
    messages: [{
      id: "moved-message",
      role: "user",
      content: "MOVED_PROJECT_REFERENCES",
      attachments: {
        sourceAssets: [{ ...movedAssetA, role: "source", name: "A", nodeId: "moved-A", assetIndex: 0 }],
        referenceAssets: [{ ...movedAssetB, role: "reference", name: "B", nodeId: "moved-B", assetIndex: 0 }],
      },
    }],
    conversations: [],
    selectedNodeId: "moved-A",
  };
  writeJson(movedProject.sessionPath, movedRawSession);
  const movedSaved = projectIo.sessionForProjectSave(movedRawSession, movedProject);
  assert.equal(movedSaved.nodes[0].assets[0].relativePath, "assets/a/same.png", "Saving a moved project cannot erase its safe relative identity");
  assert.equal(movedSaved.nodes[1].assets[0].relativePath, "assets/b/same.png");
  const movedLoaded = projectIo.projectSessionFromDisk(movedProject);
  const movedLoadedA = movedLoaded.nodes.find((node) => node.id === "moved-A");
  const movedLoadedB = movedLoaded.nodes.find((node) => node.id === "moved-B");
  assert.equal(movedLoadedA?.assets?.[0]?.path, movedPathA);
  assert.equal(movedLoadedB?.assets?.[0]?.path, movedPathB);
  assert.equal(createHash("sha256").update(readFileSync(movedLoadedA.assets[0].path)).digest("hex"), movedHashA);
  assert.equal(createHash("sha256").update(readFileSync(movedLoadedB.assets[0].path)).digest("hex"), movedHashB);
  assert.equal(movedLoadedA?.imageParams?.referenceImages?.[0]?.path, movedPathB);
  assert.equal(movedLoadedA?.layerGroup?.previewAsset?.path, movedPathA);
  assert.equal(movedLoadedA?.layerGroup?.mergedAsset?.path, movedPathB);
  assert.equal(movedLoaded.messages[0].attachments.sourceAssets[0].path, movedPathA);
  assert.equal(movedLoaded.messages[0].attachments.referenceAssets[0].path, movedPathB);

  const gate = {};
  gate.promise = new Promise((resolve) => { gate.release = resolve; });
  const order = [];
  const coordinator = projectIo.createProjectSaveCoordinator({ initialRevision: () => 0 });
  const projectARevision2 = coordinator.enqueue("project-a", 2, async (revision) => {
    order.push(`a${revision}-start`);
    await gate.promise;
    order.push(`a${revision}-done`);
    return { applied: true };
  });
  let staleApplyCalled = false;
  const projectARevision1 = coordinator.enqueue("project-a", 1, async () => {
    staleApplyCalled = true;
    return { applied: true };
  });
  const projectBRevision1 = coordinator.enqueue("project-b", 1, async (revision) => {
    order.push(`b${revision}-done`);
    return { applied: true };
  });
  const projectBResult = await projectBRevision1;
  assert.equal(projectBResult.appliedRevision, 1);
  assert(order.includes("b1-done"));
  assert.equal(order.includes("a2-done"), false, "A blocked save must not block another project queue");
  gate.release();
  const [projectAResult, staleResult] = await Promise.all([projectARevision2, projectARevision1]);
  assert.equal(projectAResult.appliedRevision, 2);
  assert.equal(staleResult.skippedStale, true);
  assert.equal(staleResult.appliedRevision, 2);
  assert.equal(staleApplyCalled, false);
  const legacyResult = await coordinator.enqueue("project-a", null, async (revision) => ({ applied: true, observedRevision: revision }));
  assert.equal(legacyResult.appliedRevision, 3, "Legacy saves without revision must receive the next monotonic revision");
  assert.equal(legacyResult.observedRevision, 3);

  const v2Project = projectRecord("manifest-v2");
  const v2Session = { sessionRevision: 7, messages: [{ role: "user", content: "SESSION_JSON_AUTHORITY" }], nodes: [] };
  writeJson(v2Project.sessionPath, v2Session);
  writeJson(projectIo.projectManifestPath(v2Project), {
    format: "naimage-project",
    version: 2,
    sessionRevision: 7,
    project: { id: v2Project.id, name: v2Project.name },
    session: { messages: [{ role: "user", content: "V2_MANIFEST_SESSION_MUST_BE_IGNORED" }], nodes: [] },
    assets: [],
  });
  const loadedV2 = projectIo.projectSessionFromDisk(v2Project);
  assert.equal(loadedV2.messages[0].content, "SESSION_JSON_AUTHORITY");
  assert.equal(JSON.stringify(loadedV2).includes("V2_MANIFEST_SESSION_MUST_BE_IGNORED"), false);

  const v2MissingSessionProject = projectRecord("manifest-v2-missing-session");
  writeJson(projectIo.projectManifestPath(v2MissingSessionProject), {
    format: "naimage-project",
    version: 2,
    sessionRevision: 8,
    project: { id: v2MissingSessionProject.id, name: v2MissingSessionProject.name },
    assets: [],
  });
  const loadedV2MissingSession = projectIo.projectSessionFromDisk(v2MissingSessionProject);
  assert.equal(loadedV2MissingSession.sessionRevision, 8);
  assert.equal(readJson(v2MissingSessionProject.sessionPath).sessionRevision, 8);

  const v1AuthoritativeProject = projectRecord("manifest-v1-session-wins");
  writeJson(v1AuthoritativeProject.sessionPath, { messages: [{ role: "user", content: "NONEMPTY_SESSION_WINS" }], nodes: [] });
  writeJson(projectIo.projectManifestPath(v1AuthoritativeProject), {
    format: "naimage-project",
    version: 1,
    project: { id: v1AuthoritativeProject.id, name: v1AuthoritativeProject.name },
    session: { messages: [{ role: "user", content: "LEGACY_MANIFEST_IGNORED" }], nodes: [] },
    assets: [],
  });
  const loadedV1Authoritative = projectIo.projectSessionFromDisk(v1AuthoritativeProject);
  assert.equal(loadedV1Authoritative.messages[0].content, "NONEMPTY_SESSION_WINS");

  const v1MigrationProject = projectRecord("manifest-v1-migrate");
  const legacyV1ManifestPath = path.join(v1MigrationProject.path, ".iiimage", "project.json");
  writeJson(legacyV1ManifestPath, {
    format: "iiimage-project",
    version: 1,
    project: { id: v1MigrationProject.id, name: v1MigrationProject.name },
    session: { sessionRevision: 5, messages: [{ role: "user", content: "LEGACY_SESSION_MIGRATED" }], nodes: [] },
    assets: [],
  });
  assert.equal(existsSync(v1MigrationProject.sessionPath), false);
  assert.equal(existsSync(projectIo.projectManifestPath(v1MigrationProject)), false);
  const migratedV1 = projectIo.projectSessionFromDisk(v1MigrationProject);
  assert.equal(migratedV1.messages[0].content, "LEGACY_SESSION_MIGRATED");
  assert.equal(migratedV1.sessionRevision, 5);
  const migratedSessionDisk = readJson(v1MigrationProject.sessionPath);
  const migratedManifest = readJson(projectIo.projectManifestPath(v1MigrationProject));
  assert.equal(migratedSessionDisk.messages[0].content, "LEGACY_SESSION_MIGRATED");
  assert.equal(migratedManifest.version, 2);
  assert.equal(migratedManifest.sessionRevision, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(migratedManifest, "session"), false);
  assert.equal(readJson(legacyV1ManifestPath).format, "iiimage-project", "Legacy metadata must remain untouched after canonical migration");

  const v1EnsureMigrationProject = projectRecord("manifest-v1-ensure-migrate");
  const legacyEnsureManifestPath = path.join(v1EnsureMigrationProject.path, ".iiimage", "project.json");
  writeJson(legacyEnsureManifestPath, {
    format: "iiimage-project",
    version: 1,
    project: { id: v1EnsureMigrationProject.id, name: v1EnsureMigrationProject.name },
    session: { sessionRevision: 7, messages: [{ role: "user", content: "ENSURE_LEGACY_SESSION_MIGRATED" }], nodes: [] },
    assets: [],
  });
  projectIo.ensureProjectFiles(v1EnsureMigrationProject, { sessionRevision: 0, messages: [], nodes: [] });
  const ensuredLegacySession = projectIo.projectSessionFromDisk(v1EnsureMigrationProject);
  assert.equal(ensuredLegacySession.messages[0].content, "ENSURE_LEGACY_SESSION_MIGRATED");
  assert.equal(ensuredLegacySession.sessionRevision, 7);
  assert.equal(readJson(v1EnsureMigrationProject.sessionPath).messages[0].content, "ENSURE_LEGACY_SESSION_MIGRATED");
  assert.equal(readJson(projectIo.projectManifestPath(v1EnsureMigrationProject)).version, 2);
  assert.equal(readJson(legacyEnsureManifestPath).format, "iiimage-project", "Project initialization must leave legacy metadata untouched");

  const v1EmptyMigrationProject = projectRecord("manifest-v1-empty-migrate");
  writeJson(v1EmptyMigrationProject.sessionPath, { sessionRevision: 0, messages: [], nodes: [], selectedNodeId: "" });
  writeJson(projectIo.projectManifestPath(v1EmptyMigrationProject), {
    format: "naimage-project",
    version: 1,
    project: { id: v1EmptyMigrationProject.id, name: v1EmptyMigrationProject.name },
    session: { sessionRevision: 6, messages: [{ role: "user", content: "EMPTY_SESSION_LEGACY_MIGRATED" }], nodes: [] },
    assets: [],
  });
  const migratedEmptyV1 = projectIo.projectSessionFromDisk(v1EmptyMigrationProject);
  assert.equal(migratedEmptyV1.messages[0].content, "EMPTY_SESSION_LEGACY_MIGRATED");
  assert.equal(migratedEmptyV1.sessionRevision, 6);
  assert.equal(readJson(projectIo.projectManifestPath(v1EmptyMigrationProject)).version, 2);

  const legacyStartProject = projectRecord("legacy-start-session");
  writeJson(path.join(legacyStartProject.path, "start.iiimage"), {
    format: "iiimage-project-package",
    version: 1,
    session: { sessionRevision: 4, messages: [{ role: "user", content: "LEGACY_START_IMPORTED" }], nodes: [] },
  });
  assert.equal(projectIo.projectExportSessionPath(legacyStartProject), path.join(legacyStartProject.path, "start.naimage"));
  const legacyStartSession = projectIo.projectSessionFromDisk(legacyStartProject);
  assert.equal(legacyStartSession.messages[0].content, "LEGACY_START_IMPORTED");
  assert.equal(readJson(legacyStartProject.sessionPath).messages[0].content, "LEGACY_START_IMPORTED");
  assert.equal(readJson(projectIo.projectManifestPath(legacyStartProject)).format, "naimage-project");

  const manifestAssetProject = projectRecord("manifest-assets");
  const manifestAssetPath = path.join(manifestAssetProject.path, "output", "imagegen", "manifest.png");
  mkdirSync(path.dirname(manifestAssetPath), { recursive: true });
  writeFileSync(manifestAssetPath, Buffer.from("manifest"));
  projectIo.writeProjectManifest(manifestAssetProject, {
    sessionRevision: 9,
    messages: [],
    nodes: [imageNode("manifest-node", [{ index: 1, type: "file", path: manifestAssetPath, runId: "manifest-run" }])],
  });
  const manifestV2 = readJson(projectIo.projectManifestPath(manifestAssetProject));
  assert.equal(manifestV2.version, 2);
  assert.equal(manifestV2.sessionRevision, 9);
  assert.equal(manifestV2.assets.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(manifestV2, "session"), false);

  const duplicateIdentityProject = projectRecord("duplicate-node-identity");
  const duplicateIdentitySession = projectIo.sessionForProjectSave({
    nodeSequence: 4,
    messages: [],
    nodes: [
      imageNode("A", [], { displayCode: "A" }),
      imageNode("A", [], { displayCode: "A" }),
      imageNode("N27", [], { displayCode: "A" }),
      imageNode("N27", [], { displayCode: "N27" }),
    ],
  }, duplicateIdentityProject);
  assert.equal(new Set(duplicateIdentitySession.nodes.map((node) => node.id)).size, duplicateIdentitySession.nodes.length);
  assert.equal(new Set(duplicateIdentitySession.nodes.map((node) => node.displayCode)).size, duplicateIdentitySession.nodes.length);
  assert(duplicateIdentitySession.nodeSequence >= 27);

  const requirementProject = projectRecord("persistent-requirement-node");
  const requirementSession = projectIo.sessionForProjectSave({
    nodeSequence: 3,
    messages: [],
    selectedNodeId: "B",
    nodes: [
      imageNode("A", [], { displayCode: "A" }),
      {
        id: "B",
        displayCode: "B",
        title: "复用商品换色需求",
        prompt: "只替换商品主色，保留版式和文字。",
        type: "requirement",
        status: "done",
        parentId: "A",
        relationType: "referenced",
        x: 320,
        y: 0,
        requirement: {
          version: 1,
          text: "只替换商品主色，保留版式和文字。",
          revision: 2,
          createdFrom: "node",
          lastSourceSignature: "source-signature-a",
          lastRunAt: "2026-07-19T01:23:45.000Z",
          lastRunCount: 3,
        },
      },
      imageNode("C", [], { displayCode: "C", parentId: "B", relationType: "derived-from" }),
      { id: "legacy", type: "intent", title: "旧工作流", prompt: "应清理", x: 0, y: 0 },
    ],
  }, requirementProject);
  assert.deepEqual(requirementSession.nodes.map((node) => node.id), ["A", "B", "C"]);
  assert.equal(requirementSession.nodes[1].type, "requirement");
  assert.equal(requirementSession.nodes[1].parentId, "A");
  assert.equal(requirementSession.nodes[1].requirement.text, "只替换商品主色，保留版式和文字。");
  assert.equal(requirementSession.nodes[1].requirement.lastRunCount, 3);
  assert.equal(requirementSession.nodes[2].parentId, "B");
  assert.equal(requirementSession.selectedNodeId, "B");
  writeJson(requirementProject.sessionPath, requirementSession);
  const restoredRequirementSession = projectIo.projectSessionFromDisk(requirementProject);
  assert.equal(restoredRequirementSession.nodes.find((node) => node.id === "B")?.type, "requirement");
  assert.equal(restoredRequirementSession.nodes.find((node) => node.id === "C")?.parentId, "B");
  assert.equal(restoredRequirementSession.nodes.find((node) => node.id === "B")?.requirement?.lastSourceSignature, "source-signature-a");

  const pendingProject = projectRecord("pending-agent-execution");
  const pendingAssetPath = path.join(pendingProject.path, "assets", "source.png");
  const pendingScopedPath = path.join(pendingProject.path, "assets", "source  with  spaces.png");
  const pendingLongPath = path.join(pendingProject.path, "assets", ...Array.from({ length: 180 }, (_item, index) => `nested-${index + 1}`), "reference.png");
  assert.ok(pendingLongPath.length > 1000);
  mkdirSync(path.dirname(pendingAssetPath), { recursive: true });
  writeFileSync(pendingAssetPath, fixturePng(9));
  const pendingConversationId = "pending-conversation";
  const pendingSession = projectIo.sessionForProjectSave({
    schemaVersion: 3,
    canvasRevision: 41,
    messages: [{ id: "pending-user", role: "user", content: "替换商品颜色" }],
    conversations: [{
      id: pendingConversationId,
      title: "挂起任务",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
      messages: [{ id: "pending-history", role: "user", content: "替换商品颜色" }],
    }],
    activeConversationId: pendingConversationId,
    nodes: [imageNode("A", [{ assetId: "pending-source", index: 1, type: "file", path: pendingAssetPath }])],
    pendingAgentExecution: {
      version: 2,
      requestId: "ask-source-1",
      projectId: pendingProject.id,
      conversationId: pendingConversationId,
      originalPrompt: "替换商品颜色",
      imageRatio: "3:4",
      imageResolution: "2K",
      sourceNodeIds: ["A"],
      focusedNodeId: "A",
      taskOrigin: "requirement",
      taskScope: {
        version: 2,
        origin: "requirement",
        scopeType: "container",
        canvasRevision: 41,
        sourceNodeIds: ["A"],
        sourceContainerIds: ["A"],
        referenceContainerIds: ["REF"],
        sourceBindingIds: ["binding:A:A:pending-source:1"],
        referenceBindingIds: ["binding:REF:REF:pending-reference:1"],
        sourceAssets: [{
          bindingId: "binding:A:A:pending-source:1",
          assetId: "pending-source",
          displayCode: "A1",
          role: "source",
          name: "原图",
          nodeId: "A",
          ownerNodeId: "A",
          ownerAssetIndex: 0,
          containerSlot: 0,
          assetIndex: 0,
          sourceRelativePath: "C:\\private\\source.png",
          path: pendingScopedPath,
        }],
        referenceAssets: [{
          bindingId: "binding:REF:REF:pending-reference:1",
          assetId: "pending-reference",
          displayCode: "R1",
          role: "reference",
          name: "参考图",
          sourceRelativePath: "../private/reference.png",
          path: pendingLongPath,
        }],
        resultPolicy: "grouped-by-source",
        confirmationPolicy: "preview-3",
        requirement: { nodeId: "REQ", revision: 4, sourceSignature: "stable-signature" },
        snapshotHash: `scope-${"1".repeat(32)}`,
        sourceAssetCount: 1,
        referenceAssetCount: 1,
      },
      requirementNodeId: "REQ",
      requirementRevision: 4,
      requirementSourceNodeId: "A",
      requirementSourceSignature: "stable-signature",
      kind: "source_images",
      title: "添加原图",
      question: "请补充需要处理的原图。",
      options: [
        { id: "preview-3", label: "先做 3 版", description: "先核对方向再扩大批量。", answer: "先生成 3 版供我核对。", recommended: true },
        { id: "staged", label: "阶段性批量", description: "分批生成并逐步核对。", answer: "按阶段分批生成。" },
        { id: "direct", label: "直接批量", description: "立即处理全部素材。", answer: "我确认直接批量处理。" },
      ],
      maxImages: 40,
      createdAt: "2026-07-19T00:00:00.000Z",
    },
  }, pendingProject);
  assert.equal(pendingSession.schemaVersion, 3, "Electron must not downgrade renderer schema v3");
  assert.equal(pendingSession.canvasRevision, 41, "Canvas revision must survive the Electron persistence boundary");
  assert.equal(pendingSession.pendingAgentExecution?.requestId, "ask-source-1");
  assert.equal(pendingSession.pendingAgentExecution?.version, 2);
  assert.equal(pendingSession.pendingAgentExecution?.imageRatio, "3:4");
  assert.equal(pendingSession.pendingAgentExecution?.imageResolution, "2K");
  assert.equal(pendingSession.pendingAgentExecution?.requirementRevision, 4);
  assert.equal(pendingSession.pendingAgentExecution?.requirementSourceNodeId, "A");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.bindingId, "binding:A:A:pending-source:1");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.scopeType, "container");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.canvasRevision, 41);
  assert.deepEqual(pendingSession.pendingAgentExecution?.taskScope?.sourceContainerIds, ["A"]);
  assert.deepEqual(pendingSession.pendingAgentExecution?.taskScope?.referenceContainerIds, ["REF"]);
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.resultPolicy, "grouped-by-source");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.confirmationPolicy, "preview-3");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.requirement?.revision, 4);
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.snapshotHash, `scope-${"1".repeat(32)}`);
  assert.equal(pendingSession.pendingAgentExecution?.options?.length, 3);
  assert.equal(pendingSession.pendingAgentExecution?.options?.[0]?.recommended, true);
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.path, pendingScopedPath, "Pending SOURCE paths must preserve repeated spaces");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.referenceAssets?.[0]?.path, pendingLongPath, "Pending REFERENCE paths must not be truncated");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.sourceRelativePath, undefined, "Pending SOURCE metadata must reject absolute source paths");
  assert.equal(pendingSession.pendingAgentExecution?.taskScope?.referenceAssets?.[0]?.sourceRelativePath, undefined, "Pending REFERENCE metadata must reject traversal paths");
  const contextEntry = { knowledgeId: "portable-knowledge", revision: 1, type: "preference", title: "本项目长期偏好", content: "固定暖色与清晰标题", scope: { type: "project" }, source: "user", status: "active", authority: "project_knowledge", assetRefs: [] };
  contextEntry.fingerprint = projectKnowledgeEntryFingerprint(contextEntry);
  const contextSnapshot = { version: 1, projectId: pendingProject.id, revision: 1, objects: [], entries: [contextEntry], budget: { maxEntries: 24, maxCharacters: 12000, usedCharacters: contextEntry.title.length + contextEntry.content.length, omittedEntries: 0 }, summary: contextEntry.title };
  contextSnapshot.fingerprint = projectKnowledgeSnapshotFingerprint(contextSnapshot);
  const templateSnapshot = { templateId: `reqtpl-${"c".repeat(32)}`, revision: 3, fingerprint: `template-${"d".repeat(32)}`, variableValues: { headline: "本任务标题" } };
  const frozenContext = { version: 1, projectId: pendingProject.id, conversationId: pendingConversationId, taskId: "portable-local-task", createdAt: "2026-10-20T05:00:00.000Z", fingerprint: contextSnapshot.fingerprint, projectKnowledge: contextSnapshot, requirementTemplate: templateSnapshot };
  pendingSession.projectTaskContexts = [frozenContext];
  pendingSession.pendingAgentExecution.taskScope.projectKnowledge = contextSnapshot;
  pendingSession.pendingAgentExecution.taskScope.template = templateSnapshot;
  writeJson(pendingProject.sessionPath, pendingSession);
  const restoredPendingSession = projectIo.projectSessionFromDisk(pendingProject);
  assert.equal(restoredPendingSession.pendingAgentExecution?.conversationId, pendingConversationId, "Pending Agent execution must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.imageRatio, "3:4", "Pending Agent frame ratio must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.imageResolution, "2K", "Pending Agent frame resolution must survive restart");
  assert.equal(restoredPendingSession.canvasRevision, 41, "Canvas revision must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.requirementRevision, 4, "Pending Requirement revision must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.requirementSourceNodeId, "A", "Pending Requirement source binding must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.role, "source");
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.path, pendingScopedPath);
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.referenceAssets?.[0]?.path, pendingLongPath);
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.snapshotHash, `scope-${"1".repeat(32)}`);
  assert.deepEqual(restoredPendingSession.projectTaskContexts, [frozenContext], "Local save/reopen must preserve the task's complete knowledge and template versions.");
  assert.deepEqual(restoredPendingSession.pendingAgentExecution.taskScope.projectKnowledge, contextSnapshot, "A local AskUser continuation retains the original knowledge.");
  assert.deepEqual(restoredPendingSession.pendingAgentExecution.taskScope.template, templateSnapshot, "A local AskUser continuation retains the original template expansion.");
  assert.equal(restoredPendingSession.pendingAgentExecution?.options?.[2]?.id, "direct");
  const portablePendingProject = projectIo.packageProject(pendingProject);
  assert.equal(portablePendingProject.session.pendingAgentExecution, null, "Portable projects must not export a local pending continuation");
  assert.deepEqual(portablePendingProject.session.projectTaskContexts, [], "Portable projects cannot carry local task receipts into another project identity.");
  assert.equal(JSON.stringify(portablePendingProject.session).includes(pendingAssetPath), false, "Portable pending state must not leak absolute local paths");
  const importedContextTarget = projectRecord("portable-local-context-target");
  const importedContextSession = projectIo.sessionFromPackage({ ...portablePendingProject, session: { ...portablePendingProject.session, projectTaskContexts: [frozenContext] } }, importedContextTarget);
  assert.deepEqual(importedContextSession.projectTaskContexts, [], "Import must reject inherited local task authority even if a package supplies it.");
  assert.equal(importedContextSession.pendingAgentExecution, null);
  assert.deepEqual(projectIo.projectSessionFromDisk(pendingProject).projectTaskContexts, [frozenContext], "Export/import must not erase local source context history.");
  const mismatchedPending = projectIo.sessionForProjectSave({
    ...pendingSession,
    activeConversationId: pendingConversationId,
    pendingAgentExecution: { ...pendingSession.pendingAgentExecution, conversationId: "other-conversation" },
  }, pendingProject);
  assert.equal(mismatchedPending.pendingAgentExecution, null, "A pending execution from another conversation must never resume");

  const containerV3Project = projectRecord("container-schema-v3");
  const containerPathA = path.join(containerV3Project.path, "assets", "a.png");
  const containerPathB = path.join(containerV3Project.path, "assets", "b.png");
  mkdirSync(path.dirname(containerPathA), { recursive: true });
  writeFileSync(containerPathA, fixturePng(31));
  writeFileSync(containerPathB, fixturePng(32));
  const reusedLegacyId = "legacy-container-asset";
  const persistedBrandStyle = {
    version: 1,
    enabled: true,
    fontFamily: "Inter, Arial, sans-serif",
    colors: ["#0b1f33", "#f4c430"],
    logoUsage: "Keep the original logo artwork and proportions.",
    productAppearance: "Keep geometry, finish, labels, and printed markings unchanged.",
    visualStyle: "Clean premium product photography.",
    references: [{
      linkId: `material-${"b".repeat(32)}`,
      assetId: reusedLegacyId,
      contentHash: createHash("sha256").update(fixturePng(31)).digest("hex"),
      nodeId: "A",
      assetIndex: 0,
      role: "logo",
      purpose: "Trusted brand Logo reference."
    }]
  };
  const containerV3Session = projectIo.sessionForProjectSave({
    schemaVersion: 3,
    messages: [],
    conversations: [],
    nodes: [
      imageNode("SUPER", [], {
        imageContainer: true,
        imageContainerSpec: { version: 1, kind: "container-group", memberNodeIds: [], childContainerNodeIds: ["A"], memberBindings: [], layoutOrigin: "manual", autoFit: true },
      }),
      imageNode("A", [{ assetId: reusedLegacyId, index: 1, type: "file", path: containerPathA }], {
        imageContainer: true,
        imageContainerSpec: {
          version: 1,
          kind: "folder",
          memberNodeIds: ["B"],
          childContainerNodeIds: [],
          memberBindings: [
            { bindingId: "binding-a", assetId: reusedLegacyId, nodeId: "A", containerNodeId: "A", assetIndex: 0 },
            { bindingId: "binding-b", assetId: reusedLegacyId, nodeId: "B", containerNodeId: "A", assetIndex: 0 },
          ],
          layoutOrigin: "manual",
          autoFit: true,
        },
      }),
      imageNode("B", [{ assetId: reusedLegacyId, index: 1, type: "file", path: containerPathB }]),
      imageNode("BATCH", [
        { assetId: "batch-a", index: 1, type: "file", path: containerPathA },
        { assetId: "batch-c", index: 3, type: "file", path: containerPathB },
      ], {
        taskProvenance: {
          version: 1,
          taskScopeSnapshotHash: `scope-${"3".repeat(32)}`,
          resultPolicy: "grouped-by-container",
          sourceBindingId: "binding:A:A:source-1",
          sourceAssetId: "source-asset-a",
          sourceOccurrenceId: `occ-${"4".repeat(32)}`,
          sourceNodeId: "A",
          sourceContainerId: "SUPER",
          sourceDisplayCode: "A1",
          requirementNodeId: "REQ-1",
          requirementRevision: 5,
          commercePlanHash: `commerce-${"5".repeat(32)}`,
          commerceSlotId: "hero-image",
          commerceSlotIndex: 0,
          commerceLocaleCode: "en-US",
          commerceCatalogTarget: {
            bindingId: "binding:A:A:source-1",
            catalogId: `catalog-${"6".repeat(32)}`,
            catalogRevision: 9,
            productId: `product-${"7".repeat(32)}`,
            productRevision: 4,
            ownerType: "sku",
            ownerId: `sku-${"8".repeat(32)}`,
            sourceLinkId: `material-${"9".repeat(32)}`,
            brandStyle: persistedBrandStyle,
          },
          commerceResultKey: `commerce-result-${"a".repeat(32)}`,
        },
        imageCollection: {
          id: "batch-v3",
          kind: "batch",
          generationMode: "parallel",
          items: [
            { id: "slot-1", requestIndex: 1, assetIndex: 1, assetId: "stale-a", prompt: "A", status: "done" },
            { id: "slot-2", requestIndex: 2, assetIndex: 2, assetId: "batch-c", prompt: "B", status: "error", error: "failed" },
            { id: "slot-3", requestIndex: 3, assetId: "batch-c", prompt: "C", status: "done" },
          ],
        },
      }),
      {
        id: "REQ-MALICIOUS",
        title: "需求",
        prompt: "需求不可伪装为容器",
        type: "requirement",
        status: "done",
        x: 0,
        y: 0,
        requirement: { version: 1, text: "需求不可伪装为容器", revision: 1, createdFrom: "node" },
        imageContainer: true,
        imageContainerSpec: { version: 1, kind: "manual", memberNodeIds: ["A"], childContainerNodeIds: [], memberBindings: [] },
      },
    ],
  }, containerV3Project);
  assert.equal(containerV3Session.schemaVersion, 3);
  const savedAContainer = containerV3Session.nodes.find((node) => node.id === "A");
  const savedBContainerAssetId = containerV3Session.nodes.find((node) => node.id === "B")?.assets?.[0]?.assetId;
  assert.notEqual(savedBContainerAssetId, reusedLegacyId, "Different bytes sharing one legacy assetId must split before container binding repair");
  assert.equal(savedAContainer?.imageContainerSpec?.memberBindings?.find((binding) => binding.nodeId === "B")?.assetId, savedBContainerAssetId);
  assert.deepEqual(containerV3Session.nodes.find((node) => node.id === "SUPER")?.imageContainerSpec?.childContainerNodeIds, ["A"]);
  const savedBatchNode = containerV3Session.nodes.find((node) => node.id === "BATCH");
  const savedBatchItems = savedBatchNode?.imageCollection?.items;
  assert.deepEqual(savedBatchItems.map((item) => ({ requestIndex: item.requestIndex, assetIndex: item.assetIndex, assetId: item.assetId, status: item.status })), [
    { requestIndex: 1, assetIndex: 1, assetId: savedBatchNode.assets[0].assetId, status: "done" },
    { requestIndex: 2, assetIndex: undefined, assetId: undefined, status: "error" },
    { requestIndex: 3, assetIndex: 2, assetId: savedBatchNode.assets[1].assetId, status: "done" },
  ]);
  assert.deepEqual(savedBatchNode?.taskProvenance, {
    version: 1,
    taskScopeSnapshotHash: `scope-${"3".repeat(32)}`,
    resultPolicy: "grouped-by-container",
    sourceBindingId: "binding:A:A:source-1",
    sourceAssetId: "source-asset-a",
    sourceOccurrenceId: `occ-${"4".repeat(32)}`,
    sourceNodeId: "A",
    sourceContainerId: "SUPER",
    sourceDisplayCode: "A1",
    requirementNodeId: "REQ-1",
    requirementRevision: 5,
    commercePlanHash: `commerce-${"5".repeat(32)}`,
    commerceSlotId: "hero-image",
    commerceSlotIndex: 0,
    commerceLocaleCode: "en-US",
    commerceCatalogTarget: {
      bindingId: "binding:A:A:source-1",
      catalogId: `catalog-${"6".repeat(32)}`,
      catalogRevision: 9,
      productId: `product-${"7".repeat(32)}`,
      productRevision: 4,
      ownerType: "sku",
      ownerId: `sku-${"8".repeat(32)}`,
      sourceLinkId: `material-${"9".repeat(32)}`,
      brandStyle: persistedBrandStyle,
    },
    commerceResultKey: `commerce-result-${"a".repeat(32)}`,
  }, "Image task provenance must survive the save boundary");
  const maliciousRequirement = containerV3Session.nodes.find((node) => node.id === "REQ-MALICIOUS");
  assert.equal(maliciousRequirement?.type, "requirement");
  assert.equal(maliciousRequirement?.imageContainerSpec, undefined, "A malicious container spec must never hide a Requirement node");
  writeJson(containerV3Project.sessionPath, containerV3Session);
  const restoredContainerV3 = projectIo.projectSessionFromDisk(containerV3Project);
  assert.equal(restoredContainerV3.schemaVersion, 3);
  assert.deepEqual(restoredContainerV3.nodes.find((node) => node.id === "SUPER")?.imageContainerSpec?.childContainerNodeIds, ["A"]);
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "A")?.imageContainerSpec?.memberBindings?.find((binding) => binding.nodeId === "B")?.assetId, savedBContainerAssetId);
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.sourceBindingId, "binding:A:A:source-1");
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.requirementRevision, 5);
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commercePlanHash, `commerce-${"5".repeat(32)}`);
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceSlotId, "hero-image");
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceSlotIndex, 0);
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceLocaleCode, "en-US");
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceCatalogTarget?.ownerId, `sku-${"8".repeat(32)}`);
  assert.deepEqual(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceCatalogTarget?.brandStyle, persistedBrandStyle,
    "Frozen brand constraints and references must survive session restart");
  assert.equal(restoredContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceResultKey, `commerce-result-${"a".repeat(32)}`);
  const portableContainerV3 = projectIo.packageProject(containerV3Project);
  assert.equal(portableContainerV3.session.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.taskScopeSnapshotHash, `scope-${"3".repeat(32)}`);
  const portableContainerTarget = projectRecord("container-schema-v3-package-target");
  mkdirSync(portableContainerTarget.path, { recursive: true });
  const importedContainerV3 = projectIo.sessionFromPackage(portableContainerV3, portableContainerTarget);
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.sourceContainerId, "SUPER");
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.requirementNodeId, "REQ-1");
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceSlotId, "hero-image");
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceCatalogTarget?.catalogRevision, 9);
  assert.deepEqual(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.commerceCatalogTarget?.brandStyle, persistedBrandStyle,
    "Portable project import must retain frozen brand constraints without adding local paths");

  const occurrenceProject = projectRecord("occurrence-roundtrip");
  const occurrencePath = path.join(occurrenceProject.path, "output", "imagegen", "imports", "shared.png");
  mkdirSync(path.dirname(occurrencePath), { recursive: true });
  writeFileSync(occurrencePath, fixturePng(71));
  const occurrenceHash = createHash("sha256").update(readFileSync(occurrencePath)).digest("hex");
  const occurrenceIds = [`occ-${"a".repeat(32)}`, `occ-${"b".repeat(32)}`];
  const rootIds = [`root-${"1".repeat(24)}`, `root-${"2".repeat(24)}`];
  const occurrenceAsset = (index) => ({
    assetId: "asset-shared-blob",
    occurrenceId: occurrenceIds[index],
    importBatchId: "batch-occurrence-roundtrip",
    importRootId: rootIds[index],
    sourceRelativePath: index === 0 ? "a/same.png" : "b/same.png",
    sourceRootLabel: index === 0 ? "folder-a" : "folder-b",
    sourceRootKind: "directory",
    contentHash: occurrenceHash,
    index: 1,
    type: "file",
    path: occurrencePath,
    relativePath: "output/imagegen/imports/shared.png",
    originalName: "same.png",
  });
  const occurrenceSession = projectIo.sessionForProjectSave({
    schemaVersion: 3,
    messages: [{
      id: "occurrence-message",
      role: "user",
      content: "OCCURRENCE_ROUNDTRIP",
      attachments: {
        sourceAssets: [0, 1].map((index) => ({
          ...occurrenceAsset(index),
          bindingId: `binding:F${index + 1}:F${index + 1}:${occurrenceIds[index]}`,
          displayCode: `F${index + 1}1`,
          role: "source",
          name: `folder-${index + 1}`,
          nodeId: `F${index + 1}`,
          assetIndex: 0,
          containerSlot: 0,
        })),
        referenceAssets: [],
      },
    }],
    conversations: [],
    nodes: [
      imageNode("FG", [], {
        imageContainer: true,
        imageContainerSpec: { version: 1, kind: "container-group", memberNodeIds: [], childContainerNodeIds: ["F1", "F2"], memberBindings: [], importBatchId: "batch-occurrence-roundtrip", layoutOrigin: "auto", autoFit: true },
      }),
      ...[0, 1].map((index) => imageNode(`F${index + 1}`, [occurrenceAsset(index)], {
        imageContainer: true,
        imageContainerSpec: {
          version: 1,
          kind: "folder",
          memberNodeIds: [],
          childContainerNodeIds: [],
          memberBindings: [{ bindingId: `binding:F${index + 1}:F${index + 1}:${occurrenceIds[index]}`, assetId: "asset-shared-blob", occurrenceId: occurrenceIds[index], nodeId: `F${index + 1}`, containerNodeId: `F${index + 1}`, assetIndex: 0 }],
          sourceLabel: `folder-${index + 1}`,
          importBatchId: "batch-occurrence-roundtrip",
          layoutOrigin: "auto",
          autoFit: true,
        },
      })),
    ],
  }, occurrenceProject);
  writeJson(occurrenceProject.sessionPath, occurrenceSession);
  const occurrenceRestored = projectIo.projectSessionFromDisk(occurrenceProject);
  const restoredOccurrenceAssets = ["F1", "F2"].map((id) => occurrenceRestored.nodes.find((node) => node.id === id)?.assets?.[0]);
  assert.equal(new Set(restoredOccurrenceAssets.map((asset) => asset.assetId)).size, 1, "Same bytes should retain one physical asset identity after save/reload");
  assert.equal(new Set(restoredOccurrenceAssets.map((asset) => asset.path)).size, 1, "Same bytes should continue sharing one managed file");
  assert.deepEqual(restoredOccurrenceAssets.map((asset) => asset.occurrenceId), occurrenceIds, "Each imported logical occurrence must survive save/reload");
  assert.deepEqual(restoredOccurrenceAssets.map((asset) => asset.importRootId), rootIds);
  assert.deepEqual(occurrenceRestored.nodes.find((node) => node.id === "FG")?.imageContainerSpec?.childContainerNodeIds, ["F1", "F2"]);
  assert.deepEqual(["F1", "F2"].map((id) => occurrenceRestored.nodes.find((node) => node.id === id)?.imageContainerSpec?.memberBindings?.[0]?.occurrenceId), occurrenceIds);
  const restoredOccurrenceAttachments = occurrenceRestored.messages.find((message) => message.content === "OCCURRENCE_ROUNDTRIP")?.attachments?.sourceAssets || [];
  assert.equal(restoredOccurrenceAttachments.length, 2);
  assert.deepEqual(restoredOccurrenceAttachments.map((asset) => asset.occurrenceId), occurrenceIds);
  assert.equal(new Set(restoredOccurrenceAttachments.map((asset) => asset.bindingId)).size, 2);

  const occurrencePackage = projectIo.packageProject(occurrenceProject);
  assert.equal(JSON.stringify(occurrencePackage.session).includes(occurrencePath), false, "Portable occurrence metadata must not leak the source project's absolute path");
  const portableOccurrenceAssets = ["F1", "F2"].map((id) => occurrencePackage.session.nodes.find((node) => node.id === id)?.assets?.[0]);
  assert.deepEqual(portableOccurrenceAssets.map((asset) => asset.occurrenceId), occurrenceIds);
  assert.deepEqual(portableOccurrenceAssets.map((asset) => asset.importRootId), rootIds);
  assert.deepEqual(portableOccurrenceAssets.map((asset) => asset.sourceRelativePath), ["a/same.png", "b/same.png"]);
  const occurrencePackageTarget = projectRecord("occurrence-package-target");
  mkdirSync(occurrencePackageTarget.path, { recursive: true });
  const importedOccurrenceSession = projectIo.sessionFromPackage(occurrencePackage, occurrencePackageTarget);
  const importedOccurrenceAssets = ["F1", "F2"].map((id) => importedOccurrenceSession.nodes.find((node) => node.id === id)?.assets?.[0]);
  assert.equal(new Set(importedOccurrenceAssets.map((asset) => asset.assetId)).size, 1, "Portable duplicate occurrences must still share one physical asset identity");
  assert.equal(new Set(importedOccurrenceAssets.map((asset) => asset.path)).size, 1, "Portable duplicate occurrences must restore one managed blob");
  assert.deepEqual(importedOccurrenceAssets.map((asset) => asset.occurrenceId), occurrenceIds, "Portable import must retain both logical occurrences");
  assert.deepEqual(importedOccurrenceAssets.map((asset) => asset.importRootId), rootIds, "Portable import must retain folder-root identity");
  assert.deepEqual(importedOccurrenceAssets.map((asset) => asset.sourceRelativePath), ["a/same.png", "b/same.png"]);
  assert.deepEqual(importedOccurrenceSession.nodes.find((node) => node.id === "FG")?.imageContainerSpec?.childContainerNodeIds, ["F1", "F2"]);
  assert.deepEqual(["F1", "F2"].map((id) => importedOccurrenceSession.nodes.find((node) => node.id === id)?.imageContainerSpec?.memberBindings?.[0]?.occurrenceId), occurrenceIds);
  const importedOccurrenceAttachments = importedOccurrenceSession.messages.find((message) => message.content === "OCCURRENCE_ROUNDTRIP")?.attachments?.sourceAssets || [];
  assert.deepEqual(importedOccurrenceAttachments.map((asset) => asset.occurrenceId), occurrenceIds);
  assert.equal(new Set(importedOccurrenceAttachments.map((asset) => asset.bindingId)).size, 2);

  const collisionProject = projectRecord("legacy-asset-id-collision");
  const collisionPathA = path.join(collisionProject.path, "output", "imagegen", "generated-1149.png");
  const collisionPathB = path.join(collisionProject.path, "output", "imagegen", "generated-281600.png");
  mkdirSync(path.dirname(collisionPathA), { recursive: true });
  writeFileSync(collisionPathA, fixturePng(11));
  writeFileSync(collisionPathB, fixturePng(22));
  const legacyCollisionId = "asset-1lobgxg";
  const collisionSession = projectIo.sessionForProjectSave({
    nodes: [
      imageNode("collision-a", [{ index: 1, type: "file", path: collisionPathA, assetId: legacyCollisionId, displayCode: "A1" }], {
        imageParams: { prompt: "COLLISION_REFERENCE", referenceImages: [{ index: 1, type: "file", path: collisionPathB, assetId: legacyCollisionId, displayCode: "B1" }] },
      }),
      imageNode("collision-b", [{ index: 1, type: "file", path: collisionPathB, assetId: legacyCollisionId, displayCode: "B1" }], {
        layerGroup: { id: "collision-layer", groupNumber: 1, order: 1, total: 1, layerId: "subject", layerTitle: "主体", previewAsset: { index: 1, type: "file", path: collisionPathB, assetId: legacyCollisionId, displayCode: "B1" } },
      }),
      imageNode("collision-a-copy", [{ index: 1, type: "file", path: collisionPathA, assetId: legacyCollisionId, displayCode: "C1" }]),
      imageNode("collision-run-node", [{ index: 1, type: "file", path: collisionPathA, assetId: "asset-run-node", displayCode: "D1", runId: "generation-run-a" }]),
    ],
    messages: [{
      id: "collision-message",
      role: "user",
      content: "LEGACY_COLLISION_ATTACHMENT",
      attachments: {
        sourceAssets: [{ assetId: legacyCollisionId, displayCode: "B1", role: "source", name: "第二张", nodeId: "collision-b", assetIndex: 0, path: collisionPathB }],
        referenceAssets: [
          { assetId: legacyCollisionId, displayCode: "A1", role: "reference", name: "第一张", nodeId: "collision-a", assetIndex: 0, path: collisionPathA },
          { assetId: "asset-run-message", displayCode: "D1", role: "reference", name: "缺少 runId 的同一张", nodeId: "collision-run-node", assetIndex: 0, path: collisionPathA },
        ],
      },
    }],
    conversations: [{
      id: "collision-conversation",
      title: "冲突迁移",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      messages: [{ id: "collision-history", role: "user", content: "HISTORY_COLLISION", attachments: { sourceAssets: [{ assetId: legacyCollisionId, displayCode: "B1", role: "source", name: "第二张", nodeId: "collision-b", assetIndex: 0, path: collisionPathB }] } }],
    }],
  }, collisionProject);
  const collisionIdA = collisionSession.nodes.find((node) => node.id === "collision-a")?.assets?.[0]?.assetId;
  const collisionIdB = collisionSession.nodes.find((node) => node.id === "collision-b")?.assets?.[0]?.assetId;
  const collisionIdACopy = collisionSession.nodes.find((node) => node.id === "collision-a-copy")?.assets?.[0]?.assetId;
  const collisionRunNodeId = collisionSession.nodes.find((node) => node.id === "collision-run-node")?.assets?.[0]?.assetId;
  assert.equal(collisionIdA, legacyCollisionId, "The first fingerprint may preserve its legacy ID");
  assert.match(collisionIdB, /^asset-[0-9a-f]{32}$/i, "A different file sharing a legacy ID must receive a deterministic 128-bit ID");
  assert.notEqual(collisionIdB, collisionIdA);
  assert.equal(collisionIdACopy, collisionIdA, "The same real file may continue sharing one identity");
  assert.equal(collisionRunNodeId, collisionIdA, "runId cannot split a node that points at the same managed file");
  assert.equal(collisionSession.nodes[0].imageParams.referenceImages[0].assetId, collisionIdB);
  assert.equal(collisionSession.nodes[1].layerGroup.previewAsset.assetId, collisionIdB);
  assert.equal(collisionSession.messages[0].attachments.sourceAssets[0].assetId, collisionIdB);
  assert.equal(collisionSession.messages[0].attachments.referenceAssets[0].assetId, collisionIdA);
  assert.equal(collisionSession.messages[0].attachments.referenceAssets[1].assetId, collisionRunNodeId, "A message attachment without runId must resolve to its node asset");
  assert.equal(collisionSession.conversations[0].messages[0].attachments.sourceAssets[0].assetId, collisionIdB);

  const weakNestedProject = projectRecord("weak-nested-identity");
  const weakNestedSession = projectIo.sessionForProjectSave({
    nodes: [imageNode("weak-node", [], {
      imageParams: { prompt: "weak", referenceImages: [{ assetId: "weak-param", name: "pending.png", index: 1 }] },
      layerGroup: {
        id: "weak-group",
        groupNumber: 1,
        order: 1,
        total: 1,
        layerId: "subject",
        layerTitle: "主体",
        previewAsset: { assetId: "weak-preview", originalName: "pending.png", index: 1 },
        mergedAsset: { assetId: "weak-merged", originalName: "pending.png", index: 1 },
      },
    })],
    messages: [],
  }, weakNestedProject);
  const weakNestedIds = [
    weakNestedSession.nodes[0].imageParams.referenceImages[0].assetId,
    weakNestedSession.nodes[0].layerGroup.previewAsset.assetId,
    weakNestedSession.nodes[0].layerGroup.mergedAsset.assetId,
  ];
  assert.equal(new Set(weakNestedIds).size, weakNestedIds.length, "Weak nested placeholders on different surfaces cannot share identity");

  const messageAliasProject = projectRecord("message-alias-identity");
  const messageAliasPath = path.join(messageAliasProject.path, "assets", "alias.png");
  const messageAliasSession = projectIo.sessionForProjectSave({
    nodes: [],
    messages: [{
      id: "message-alias",
      role: "user",
      content: "MESSAGE_ALIAS_IDENTITY",
      attachments: {
        sourceAssets: [],
        referenceAssets: [
          { assetId: "alias-relative-and-absolute", role: "reference", name: "alias.png", path: messageAliasPath, relativePath: "assets/alias.png", assetIndex: 0 },
          { assetId: "alias-absolute-only", role: "reference", name: "alias.png", path: messageAliasPath, assetIndex: 1 },
        ],
      },
    }],
  }, messageAliasProject);
  assert.equal(
    messageAliasSession.messages[0].attachments.referenceAssets[0].assetId,
    messageAliasSession.messages[0].attachments.referenceAssets[1].assetId,
    "Message-only relative and absolute aliases must converge without a node record"
  );

  const catalogOnlySource = projectRecord("catalog-only-source");
  const catalogOnlyAssetPath = path.join(catalogOnlySource.path, "assets", "catalog-only.png");
  mkdirSync(path.dirname(catalogOnlyAssetPath), { recursive: true });
  writeFileSync(catalogOnlyAssetPath, fixturePng(7));
  writeJson(catalogOnlySource.sessionPath, projectIo.sessionForProjectSave({
    sessionRevision: 1,
    nodes: [],
    messages: [],
    conversations: [],
    activeConversationId: "catalog-only"
  }, catalogOnlySource));
  const catalogOnlyHash = createHash("sha256").update(readFileSync(catalogOnlyAssetPath)).digest("hex");
  const catalogTimestamp = "2026-07-31T00:00:00.000Z";
  writeJson(path.join(catalogOnlySource.path, ".naimage", "commerce-catalog.json"), {
    schemaVersion: 1,
    catalogId: "catalog-11111111111111111111111111111111",
    revision: 1,
    createdAt: catalogTimestamp,
    updatedAt: catalogTimestamp,
    products: [{
      productId: "product-22222222222222222222222222222222",
      title: "Catalog-only product",
      platforms: ["amazon"],
      status: "active",
      revision: 1,
      createdAt: catalogTimestamp,
      updatedAt: catalogTimestamp,
      variants: [],
      skus: [],
      assets: [{
        linkId: "material-33333333333333333333333333333333",
        kind: "master",
        ownerType: "product",
        ownerId: "product-22222222222222222222222222222222",
        role: "primary",
        assetId: "asset-catalog-only",
        contentHash: catalogOnlyHash,
        relativePath: "assets/catalog-only.png",
        fileName: "catalog-only.png",
        createdAt: catalogTimestamp
      }]
    }]
  });
  const catalogOnlyPackage = projectIo.packageProject(catalogOnlySource);
  assert.equal(catalogOnlyPackage.version, 3);
  assert.equal(catalogOnlyPackage.commerceCatalog.products[0].assets.length, 1);
  assert.equal(catalogOnlyPackage.assets.filter((asset) => asset.assetId === "asset-catalog-only").length, 1);
  const catalogOnlyTargetPath = path.join(testRoot, "catalog-only-target");
  const catalogOnlyImported = projectIo.importProjectPackage(catalogOnlyPackage, catalogOnlyTargetPath);
  const importedCatalogOnlyDocument = readJson(path.join(catalogOnlyTargetPath, ".naimage", "commerce-catalog.json"));
  const importedCatalogOnlyLink = importedCatalogOnlyDocument.products[0].assets[0];
  assert.equal(importedCatalogOnlyLink.contentHash, catalogOnlyHash);
  assert.equal(importedCatalogOnlyLink.relativePath, "assets/catalog-only.png");
  assert.equal(existsSync(path.join(catalogOnlyImported.record.path, importedCatalogOnlyLink.relativePath)), true);

  const packageSourceProject = projectRecord("package-identity-source");
  const packageNodePath = path.join(packageSourceProject.path, "output", "imagegen", "node-asset.png");
  const packageReferencePath = path.join(packageSourceProject.path, "assets", "reference-only.png");
  const packageParamReferencePath = path.join(packageSourceProject.path, "assets", "param-reference.png");
  const packagePreviewPath = path.join(packageSourceProject.path, "output", "imagegen", "layer-preview.png");
  const packageMergedPath = path.join(packageSourceProject.path, "output", "imagegen", "layer-merged.png");
  const packageLayerPath = path.join(packageSourceProject.path, "output", "imagegen", "layer-subject.png");
  mkdirSync(path.dirname(packageNodePath), { recursive: true });
  mkdirSync(path.dirname(packageReferencePath), { recursive: true });
  writeFileSync(packageNodePath, fixturePng(1));
  writeFileSync(packageReferencePath, fixturePng(2));
  writeFileSync(packageParamReferencePath, fixturePng(3));
  writeFileSync(packagePreviewPath, fixturePng(4));
  writeFileSync(packageMergedPath, fixturePng(5));
  writeFileSync(packageLayerPath, fixturePng(6));
  writeJson(packageSourceProject.sessionPath, projectIo.sessionForProjectSave({
    sessionRevision: 11,
    nodeSequence: 12,
    selectedNodeId: "A",
    nodes: [
      imageNode("A", [{ index: 1, type: "file", path: packageNodePath, assetId: "asset-node-a1", displayCode: "A1", runId: "package-node", width: 1440, height: 1080, title: "节点资产标题", prompt: "节点资产提示词", status: "done", originalName: "original-node.png" }], {
        displayCode: "A",
        assetSequence: 3,
        imageParams: { prompt: "PACKAGE_IMAGE_PARAMS", referenceImages: [{ assetId: "asset-param-ref", displayCode: "R1", name: "参数参考图", path: packageParamReferencePath, mimeType: "image/png" }] },
        layerGroup: { id: "package-layer-group", groupNumber: 2, order: 1, total: 1, layerId: "subject", layerTitle: "主体", visible: true, opacity: 1, detached: false, previewAsset: { index: 1, type: "file", path: packagePreviewPath }, mergedAsset: { index: 1, type: "file", path: packageMergedPath } },
      }),
      imageNode("C", [{ index: 1, type: "file", path: packageLayerPath, assetId: "asset-layer-c1", displayCode: "C1" }], {
        displayCode: "C",
        layerComposition: { id: "package-composition", title: "分层合成", mode: "layer-stack", groupNumber: 3, layout: "stacked", width: 1024, height: 1024, background: "transparent", previewAsset: { index: 1, type: "file", path: packagePreviewPath }, mergedAsset: { index: 1, type: "file", path: packageMergedPath }, layers: [{ id: "subject", title: "主体", role: "subject", order: 1, x: 0, y: 0, scale: 1, opacity: 1, visible: true, blendMode: "normal", prompt: "主体图层", asset: { index: 1, type: "file", path: packageLayerPath } }] },
      }),
    ],
    messages: [{
      id: "package-message",
      role: "user",
      content: "PACKAGE_ATTACHMENT_IDENTITY",
      attachments: {
        sourceAssets: [{ assetId: "asset-node-a1", displayCode: "A1", role: "source", name: "节点原图", nodeId: "A", path: packageNodePath }],
        referenceAssets: [{ assetId: "asset-reference-b1", displayCode: "B1", role: "reference", name: "仅消息参考图", path: packageReferencePath }],
        sourceCount: 1,
        referenceCount: 1,
      },
    }],
    conversations: [],
    activeConversationId: "package-conversation",
  }, packageSourceProject));
  const packageData = projectIo.packageProject(packageSourceProject);
  assert.equal(packageData.format, "naimage-project-package");
  assert.equal(packageData.version, 3);
  assert.equal(packageData.commerceCatalog?.schemaVersion, 1);
  assert.deepEqual(packageData.commerceCatalog?.products, []);
  assert.equal(JSON.stringify(packageData.session).includes(testRoot), false, "Portable project session must not leak absolute local paths");
  assert(packageData.assets.some((asset) => asset.assetId === "asset-node-a1" && asset.displayCode === "A1"));
  assert(packageData.assets.some((asset) => asset.assetId === "asset-reference-b1" && asset.attachment === true));
  const packagedNode = packageData.assets.find((asset) => asset.assetId === "asset-node-a1");
  const packagedReference = packageData.assets.find((asset) => asset.assetId === "asset-reference-b1");
  const packagedLayerNode = packageData.assets.find((asset) => asset.assetId === "asset-layer-c1");
  const packagedParamReference = packageData.assets.find((asset) => asset.assetId === "asset-param-ref");
  const packagedPreview = packageData.assets.find((asset) => asset.fileName === "layer-preview.png");
  const packagedMerged = packageData.assets.find((asset) => asset.fileName === "layer-merged.png");
  assert(packagedPreview);
  assert(packagedMerged);
  assert.equal(packagedNode?.contentHash, createHash("sha256").update(readFileSync(packageNodePath)).digest("hex"));
  assert.equal(packagedReference?.contentHash, createHash("sha256").update(readFileSync(packageReferencePath)).digest("hex"));
  packagedNode.path = "output/imagegen/Package-Path-Collision.png";
  packagedLayerNode.path = "output/imagegen/package-path-collision.png";
  packagedReference.path = "session.json";
  packagedParamReference.path = ".naimage/project.json";
  packagedPreview.path = ".iiimage/project.json";
  packagedMerged.path = ".iiimage/assets/legacy-package-write.png";
  packageData.assets.forEach((asset) => { asset.contentHash = "f".repeat(64); });
  packageData.session.nodes.forEach((node) => {
    (node.assets || []).forEach((asset) => {
      asset.contentHash = "f".repeat(64);
      delete asset.packageAssetKey;
    });
  });
  const packageTargetProject = projectRecord("package-identity-target");
  mkdirSync(packageTargetProject.path, { recursive: true });
  writeFileSync(packageTargetProject.sessionPath, Buffer.from("USER-SESSION-METADATA"));
  const existingProjectMetadataPath = path.join(packageTargetProject.path, ".naimage", "project.json");
  const existingLegacyProjectMetadataPath = path.join(packageTargetProject.path, ".iiimage", "project.json");
  mkdirSync(path.dirname(existingProjectMetadataPath), { recursive: true });
  mkdirSync(path.dirname(existingLegacyProjectMetadataPath), { recursive: true });
  writeFileSync(existingProjectMetadataPath, Buffer.from("USER-PROJECT-METADATA"));
  writeFileSync(existingLegacyProjectMetadataPath, Buffer.from("USER-LEGACY-PROJECT-METADATA"));
  const existingTargetPath = path.join(packageTargetProject.path, "output", "imagegen", "Package-Path-Collision.png");
  mkdirSync(path.dirname(existingTargetPath), { recursive: true });
  writeFileSync(existingTargetPath, Buffer.from("USER-EXISTING-TARGET"));
  const importedPackageSession = projectIo.sessionFromPackage(packageData, packageTargetProject);
  const importedNodeAsset = importedPackageSession.nodes[0].assets[0];
  const importedPrimaryNode = importedPackageSession.nodes.find((node) => node.id === "A");
  const importedLayerNode = importedPackageSession.nodes.find((node) => node.id === "C");
  const importedLayerNodeAsset = importedLayerNode?.assets?.[0];
  const importedMessage = importedPackageSession.messages.find((message) => message.content === "PACKAGE_ATTACHMENT_IDENTITY");
  const importedSourceAttachment = importedMessage?.attachments?.sourceAssets?.[0];
  const importedReferenceAttachment = importedMessage?.attachments?.referenceAssets?.[0];
  assert.equal(importedPackageSession.nodeSequence, 12);
  assert.equal(importedPackageSession.nodes[0].displayCode, "A");
  assert.equal(importedPackageSession.nodes[0].assetSequence, 3);
  assert.equal(importedNodeAsset.assetId, "asset-node-a1");
  assert.equal(importedNodeAsset.displayCode, "A1");
  assert.equal(importedNodeAsset.width, 1440);
  assert.equal(importedNodeAsset.height, 1080);
  assert.equal(importedNodeAsset.title, "节点资产标题");
  assert.equal(importedNodeAsset.prompt, "节点资产提示词");
  assert.equal(importedNodeAsset.originalName, "original-node.png");
  assert(existsSync(importedNodeAsset.path));
  assert.equal(importedSourceAttachment?.assetId, "asset-node-a1");
  assert.equal(importedSourceAttachment?.path, importedNodeAsset.path);
  assert.equal(importedReferenceAttachment?.assetId, "asset-reference-b1");
  assert(existsSync(importedReferenceAttachment?.path));
  assert(importedReferenceAttachment.path.startsWith(packageTargetProject.path));
  assert(importedReferenceAttachment.path.includes(`${path.sep}assets${path.sep}package-imports${path.sep}`));
  assert(importedPrimaryNode?.imageParams?.referenceImages?.[0]?.path.includes(`${path.sep}assets${path.sep}package-imports${path.sep}`));
  assert.equal(readFileSync(packageTargetProject.sessionPath, "utf8"), "USER-SESSION-METADATA", "Package assets cannot target session.json");
  assert.equal(readFileSync(existingProjectMetadataPath, "utf8"), "USER-PROJECT-METADATA", "Package assets cannot target .naimage project metadata");
  assert.equal(readFileSync(existingLegacyProjectMetadataPath, "utf8"), "USER-LEGACY-PROJECT-METADATA", "Package assets cannot target legacy .iiimage project metadata");
  assert.equal(existsSync(path.join(packageTargetProject.path, ".iiimage", "assets", "legacy-package-write.png")), false, "Package imports cannot write into legacy .iiimage asset roots");
  assert.equal(importedNodeAsset.contentHash, createHash("sha256").update(readFileSync(importedNodeAsset.path)).digest("hex"));
  assert.equal(importedReferenceAttachment.contentHash, createHash("sha256").update(readFileSync(importedReferenceAttachment.path)).digest("hex"));
  assert.notEqual(importedNodeAsset.contentHash, importedReferenceAttachment.contentHash, "Package-declared hashes cannot merge different image bytes");
  assert.equal(importedLayerNodeAsset?.contentHash, createHash("sha256").update(readFileSync(importedLayerNodeAsset.path)).digest("hex"));
  assert.notEqual(importedLayerNodeAsset?.contentHash, importedNodeAsset.contentHash, "Forged session hashes cannot redirect one node to another packaged file");
  assert.notEqual(importedLayerNodeAsset?.path.toLowerCase(), importedNodeAsset.path.toLowerCase(), "Case-insensitive package path collisions must receive distinct safe targets");
  assert.equal(readFileSync(existingTargetPath, "utf8"), "USER-EXISTING-TARGET", "Importing a package cannot overwrite an existing user file");
  assert.notEqual(importedNodeAsset.path.toLowerCase(), existingTargetPath.toLowerCase());
  assert.notEqual(importedLayerNodeAsset.path.toLowerCase(), existingTargetPath.toLowerCase());
  const nestedPaths = [
    importedPrimaryNode?.imageParams?.referenceImages?.[0]?.path,
    importedPrimaryNode?.layerGroup?.previewAsset?.path,
    importedPrimaryNode?.layerGroup?.mergedAsset?.path,
    importedLayerNode?.layerComposition?.previewAsset?.path,
    importedLayerNode?.layerComposition?.mergedAsset?.path,
    importedLayerNode?.layerComposition?.layers?.[0]?.asset?.path,
  ];
  assert(nestedPaths.every((value) => typeof value === "string" && value.startsWith(packageTargetProject.path) && existsSync(value)));
  assert(nestedPaths.every((value) => !value.includes(`${path.sep}.iiimage${path.sep}`)), "Nested package assets must be redirected to canonical writable roots");

  const dirtyPackageTarget = projectRecord("package-dirty-fallback-key");
  mkdirSync(dirtyPackageTarget.path, { recursive: true });
  const dirtyBytesA = Buffer.concat([PNG_1X1, Buffer.from("DIRTY-PACKAGE-A")]);
  const dirtyBytesB = Buffer.concat([PNG_1X1, Buffer.from("DIRTY-PACKAGE-B")]);
  const dirtyPackageSession = projectIo.sessionFromPackage({
    // A pre-rename package remains a supported import format.
    format: "iiimage-project-package",
    version: 2,
    project: { id: "dirty", name: "dirty" },
    assets: [
      { nodeId: "dirty-node", index: 1, type: "file", path: "assets/a.png", fileName: "a.png", data: dirtyBytesA.toString("base64") },
      { nodeId: "dirty-node", index: 1, type: "file", path: "assets/b.png", fileName: "b.png", data: dirtyBytesB.toString("base64") },
    ],
    session: {
      nodes: [imageNode("dirty-node", [
        { index: 1, type: "file", relativePath: "assets/a.png", fileName: "a.png" },
        { index: 1, type: "file", relativePath: "assets/b.png", fileName: "b.png" },
      ])],
      messages: [],
    },
  }, dirtyPackageTarget);
  const dirtyAssets = dirtyPackageSession.nodes[0].assets;
  assert.equal(dirtyAssets.length, 2);
  assert.notEqual(dirtyAssets[0].path.toLowerCase(), dirtyAssets[1].path.toLowerCase(), "Ambiguous legacy node/index keys must fall back to each unique package path");
  assert.deepEqual(readFileSync(dirtyAssets[0].path), dirtyBytesA);
  assert.deepEqual(readFileSync(dirtyAssets[1].path), dirtyBytesB);

  assert.throws(
    () => projectIo.validateProjectPackageData({
      format: "naimage-project-package",
      version: 2,
      project: { name: "invalid-base64" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: [{ fileName: "invalid.png", data: "not-base64" }],
    }),
    (error) => error?.code === "NAIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE",
    "Malformed base64 assets must be rejected before decoding",
  );
  const tooManyAssets = Array.from({ length: projectIo.projectPackageMaximumAssets + 1 }, (_item, index) => ({
    fileName: `${index}.png`,
    data: PNG_1X1.toString("base64"),
  }));
  assert.throws(
    () => projectIo.validateProjectPackageData({
      format: "naimage-project-package",
      version: 2,
      project: { name: "too-many-assets" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: tooManyAssets,
    }),
    (error) => error?.code === "NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX",
    "Project packages must cap their asset count before decoding",
  );
  const invalidImageTarget = projectRecord("package-invalid-image-target");
  assert.throws(
    () => projectIo.sessionFromPackage({
      format: "naimage-project-package",
      version: 2,
      project: { name: "invalid-image" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: [{ fileName: "fake.png", path: "assets/fake.png", data: Buffer.from("not-an-image").toString("base64") }],
    }, invalidImageTarget),
    (error) => error?.code === "NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID",
    "Project packages must validate real image bytes before writing any asset",
  );
  assert.equal(existsSync(invalidImageTarget.path), false, "A rejected project package must not create a partial target project");

  return {
    ok: true,
    contextMetadataReadOnly: true,
    contextMetadataLegacyCorruptionRejected: true,
    validAssetCount: validAssets.length,
    validAssetScans: validScanCount,
    missingAssetScans: missingScanCount,
    projectARevision: legacyResult.appliedRevision,
    crossProjectIndependent: true,
    staleRevisionSkipped: staleResult.skippedStale,
    manifestV2Authoritative: true,
    legacyManifestMigrated: true,
    legacyManifestEnsureMigrated: true,
    legacyStartSessionMigrated: true,
    legacyAssetProtocolMigrated: true,
    legacyUserDataMigratedWithoutOverwrite: true,
    externalProjectFolderNested: true,
    explicitProjectFolderResolved: true,
    packageAssetIdentityPreserved: true,
    packageAttachmentPathsRewritten: true,
    packageNestedLayerAssetsPortable: true,
    packageContentHashVerifiedFromBytes: true,
    packageExistingTargetPreserved: true,
    packageReservedMetadataPathsProtected: true,
    packageLegacyAssetRootsReadOnly: true,
    packageAmbiguousLegacyKeysIsolated: true,
    packageAssetCountBounded: true,
    packageImageBytesValidated: true,
    movedProjectRelativeIdentityPreserved: true,
    movedProjectNestedReferencesHydrated: true,
    weakNestedIdentityIsolated: true,
    messageOnlyLocatorAliasesConverged: true,
    independentGeneratedIdsPreserved: true,
    independentGeneratedRendererIdsPreserved: true,
    independentGeneratedReceiptSavedCount: independentReceipt.savedCount,
    independentGeneratedReceiptPhase: independentReceipt.phase,
    duplicateNodeIdentityMigrated: true,
    occurrenceRoundTripPreserved: true,
    occurrencePortablePackagePreserved: true,
    frozenKnowledgeTemplateLocalReopen: true,
    portableLocalTaskContextIsolation: true,
    unsafeSourceRelativePathsRejected: true,
    emptySelectionPreserved: true,
    videoRelativePersistencePreserved: true,
    videoManifestAndRestartRecoveryPreserved: true,
    videoPortablePackageBoundaryEnforced: true,
    projectAssetRepositoryOwner: PROJECT_ASSET_REPOSITORY_OWNER,
    projectAssetRepositoryFacadeUnique: true,
    projectPackageServiceOwner: PROJECT_PACKAGE_SERVICE_OWNER,
    projectPackageServiceFacadeUnique: true,
  };
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    rmSync(testRoot, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
    app.exit(1);
  });
