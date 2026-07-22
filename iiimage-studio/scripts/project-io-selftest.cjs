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

process.env.IIIMAGE_PROJECT_IO_SELFTEST = "1";
const testRoot = mkdtempSync(path.join(os.tmpdir(), "iiimage-project-io-selftest-"));
process.env.IIIMAGE_CONFIG_DIR = path.join(testRoot, "config");

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
  writeJson(path.join(process.env.IIIMAGE_CONFIG_DIR, "project-list.json"), {
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
  const activeAgentImageRoots = projectIo.agentImageRootsForContext({ projectId: outputProjectA.id });
  assert.deepEqual(
    new Set(activeAgentImageRoots.map((root) => path.resolve(root))),
    new Set([
      path.join(outputProjectA.path, "output"),
      path.join(outputProjectA.path, "assets"),
      path.join(outputProjectA.path, ".iiimage", "assets"),
    ].map((root) => path.resolve(root))),
    "The active external project must expose only its managed image roots to view_image",
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
    format: "iiimage-project",
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
    format: "iiimage-project",
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
    format: "iiimage-project",
    version: 1,
    project: { id: v1AuthoritativeProject.id, name: v1AuthoritativeProject.name },
    session: { messages: [{ role: "user", content: "LEGACY_MANIFEST_IGNORED" }], nodes: [] },
    assets: [],
  });
  const loadedV1Authoritative = projectIo.projectSessionFromDisk(v1AuthoritativeProject);
  assert.equal(loadedV1Authoritative.messages[0].content, "NONEMPTY_SESSION_WINS");

  const v1MigrationProject = projectRecord("manifest-v1-migrate");
  writeJson(projectIo.projectManifestPath(v1MigrationProject), {
    format: "iiimage-project",
    version: 1,
    project: { id: v1MigrationProject.id, name: v1MigrationProject.name },
    session: { sessionRevision: 5, messages: [{ role: "user", content: "LEGACY_SESSION_MIGRATED" }], nodes: [] },
    assets: [],
  });
  assert.equal(existsSync(v1MigrationProject.sessionPath), false);
  const migratedV1 = projectIo.projectSessionFromDisk(v1MigrationProject);
  assert.equal(migratedV1.messages[0].content, "LEGACY_SESSION_MIGRATED");
  assert.equal(migratedV1.sessionRevision, 5);
  const migratedSessionDisk = readJson(v1MigrationProject.sessionPath);
  const migratedManifest = readJson(projectIo.projectManifestPath(v1MigrationProject));
  assert.equal(migratedSessionDisk.messages[0].content, "LEGACY_SESSION_MIGRATED");
  assert.equal(migratedManifest.version, 2);
  assert.equal(migratedManifest.sessionRevision, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(migratedManifest, "session"), false);

  const v1EmptyMigrationProject = projectRecord("manifest-v1-empty-migrate");
  writeJson(v1EmptyMigrationProject.sessionPath, { sessionRevision: 0, messages: [], nodes: [], selectedNodeId: "" });
  writeJson(projectIo.projectManifestPath(v1EmptyMigrationProject), {
    format: "iiimage-project",
    version: 1,
    project: { id: v1EmptyMigrationProject.id, name: v1EmptyMigrationProject.name },
    session: { sessionRevision: 6, messages: [{ role: "user", content: "EMPTY_SESSION_LEGACY_MIGRATED" }], nodes: [] },
    assets: [],
  });
  const migratedEmptyV1 = projectIo.projectSessionFromDisk(v1EmptyMigrationProject);
  assert.equal(migratedEmptyV1.messages[0].content, "EMPTY_SESSION_LEGACY_MIGRATED");
  assert.equal(migratedEmptyV1.sessionRevision, 6);
  assert.equal(readJson(projectIo.projectManifestPath(v1EmptyMigrationProject)).version, 2);

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
  writeJson(pendingProject.sessionPath, pendingSession);
  const restoredPendingSession = projectIo.projectSessionFromDisk(pendingProject);
  assert.equal(restoredPendingSession.pendingAgentExecution?.conversationId, pendingConversationId, "Pending Agent execution must survive restart");
  assert.equal(restoredPendingSession.canvasRevision, 41, "Canvas revision must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.requirementRevision, 4, "Pending Requirement revision must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.requirementSourceNodeId, "A", "Pending Requirement source binding must survive restart");
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.role, "source");
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.sourceAssets?.[0]?.path, pendingScopedPath);
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.referenceAssets?.[0]?.path, pendingLongPath);
  assert.equal(restoredPendingSession.pendingAgentExecution?.taskScope?.snapshotHash, `scope-${"1".repeat(32)}`);
  assert.equal(restoredPendingSession.pendingAgentExecution?.options?.[2]?.id, "direct");
  const portablePendingProject = projectIo.packageProject(pendingProject);
  assert.equal(portablePendingProject.session.pendingAgentExecution, null, "Portable projects must not export a local pending continuation");
  assert.equal(JSON.stringify(portablePendingProject.session).includes(pendingAssetPath), false, "Portable pending state must not leak absolute local paths");
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
  const portableContainerV3 = projectIo.packageProject(containerV3Project);
  assert.equal(portableContainerV3.session.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.taskScopeSnapshotHash, `scope-${"3".repeat(32)}`);
  const portableContainerTarget = projectRecord("container-schema-v3-package-target");
  mkdirSync(portableContainerTarget.path, { recursive: true });
  const importedContainerV3 = projectIo.sessionFromPackage(portableContainerV3, portableContainerTarget);
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.sourceContainerId, "SUPER");
  assert.equal(importedContainerV3.nodes.find((node) => node.id === "BATCH")?.taskProvenance?.requirementNodeId, "REQ-1");

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
  assert.equal(packageData.version, 2);
  assert.equal(JSON.stringify(packageData.session).includes(testRoot), false, "Portable project session must not leak absolute local paths");
  assert(packageData.assets.some((asset) => asset.assetId === "asset-node-a1" && asset.displayCode === "A1"));
  assert(packageData.assets.some((asset) => asset.assetId === "asset-reference-b1" && asset.attachment === true));
  const packagedNode = packageData.assets.find((asset) => asset.assetId === "asset-node-a1");
  const packagedReference = packageData.assets.find((asset) => asset.assetId === "asset-reference-b1");
  const packagedLayerNode = packageData.assets.find((asset) => asset.assetId === "asset-layer-c1");
  const packagedParamReference = packageData.assets.find((asset) => asset.assetId === "asset-param-ref");
  assert.equal(packagedNode?.contentHash, createHash("sha256").update(readFileSync(packageNodePath)).digest("hex"));
  assert.equal(packagedReference?.contentHash, createHash("sha256").update(readFileSync(packageReferencePath)).digest("hex"));
  packagedNode.path = "output/imagegen/Package-Path-Collision.png";
  packagedLayerNode.path = "output/imagegen/package-path-collision.png";
  packagedReference.path = "session.json";
  packagedParamReference.path = ".iiimage/project.json";
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
  const existingProjectMetadataPath = path.join(packageTargetProject.path, ".iiimage", "project.json");
  mkdirSync(path.dirname(existingProjectMetadataPath), { recursive: true });
  writeFileSync(existingProjectMetadataPath, Buffer.from("USER-PROJECT-METADATA"));
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
  assert.equal(readFileSync(existingProjectMetadataPath, "utf8"), "USER-PROJECT-METADATA", "Package assets cannot target .iiimage project metadata");
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

  const dirtyPackageTarget = projectRecord("package-dirty-fallback-key");
  mkdirSync(dirtyPackageTarget.path, { recursive: true });
  const dirtyBytesA = Buffer.concat([PNG_1X1, Buffer.from("DIRTY-PACKAGE-A")]);
  const dirtyBytesB = Buffer.concat([PNG_1X1, Buffer.from("DIRTY-PACKAGE-B")]);
  const dirtyPackageSession = projectIo.sessionFromPackage({
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
      format: "iiimage-project-package",
      version: 2,
      project: { name: "invalid-base64" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: [{ fileName: "invalid.png", data: "not-base64" }],
    }),
    (error) => error?.code === "IIIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE",
    "Malformed base64 assets must be rejected before decoding",
  );
  const tooManyAssets = Array.from({ length: projectIo.projectPackageMaximumAssets + 1 }, (_item, index) => ({
    fileName: `${index}.png`,
    data: PNG_1X1.toString("base64"),
  }));
  assert.throws(
    () => projectIo.validateProjectPackageData({
      format: "iiimage-project-package",
      version: 2,
      project: { name: "too-many-assets" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: tooManyAssets,
    }),
    (error) => error?.code === "IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX",
    "Project packages must cap their asset count before decoding",
  );
  const invalidImageTarget = projectRecord("package-invalid-image-target");
  assert.throws(
    () => projectIo.sessionFromPackage({
      format: "iiimage-project-package",
      version: 2,
      project: { name: "invalid-image" },
      session: { nodes: [], messages: [], conversations: [] },
      assets: [{ fileName: "fake.png", path: "assets/fake.png", data: Buffer.from("not-an-image").toString("base64") }],
    }, invalidImageTarget),
    (error) => error?.code === "IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID",
    "Project packages must validate real image bytes before writing any asset",
  );
  assert.equal(existsSync(invalidImageTarget.path), false, "A rejected project package must not create a partial target project");

  return {
    ok: true,
    validAssetCount: validAssets.length,
    validAssetScans: validScanCount,
    missingAssetScans: missingScanCount,
    projectARevision: legacyResult.appliedRevision,
    crossProjectIndependent: true,
    staleRevisionSkipped: staleResult.skippedStale,
    manifestV2Authoritative: true,
    legacyManifestMigrated: true,
    externalProjectFolderNested: true,
    explicitProjectFolderResolved: true,
    packageAssetIdentityPreserved: true,
    packageAttachmentPathsRewritten: true,
    packageNestedLayerAssetsPortable: true,
    packageContentHashVerifiedFromBytes: true,
    packageExistingTargetPreserved: true,
    packageReservedMetadataPathsProtected: true,
    packageAmbiguousLegacyKeysIsolated: true,
    packageAssetCountBounded: true,
    packageImageBytesValidated: true,
    movedProjectRelativeIdentityPreserved: true,
    movedProjectNestedReferencesHydrated: true,
    weakNestedIdentityIsolated: true,
    messageOnlyLocatorAliasesConverged: true,
    duplicateNodeIdentityMigrated: true,
    occurrenceRoundTripPreserved: true,
    occurrencePortablePackagePreserved: true,
    unsafeSourceRelativePathsRejected: true,
    emptySelectionPreserved: true,
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
