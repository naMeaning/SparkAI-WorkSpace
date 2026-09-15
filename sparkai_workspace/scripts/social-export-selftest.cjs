"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { registerSocialExportIpc } = require("../desktop/ipc/social-export-ipc.cjs");
const { createProjectSocialExportService } = require("../desktop/project-social-export.cjs");
const { normalizeDouyinPlan, normalizeXiaohongshuPlan } = require("../runtime/social-content-plan.cjs");

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function fixtureFile(projectPath, relativePath, seed) {
  const filePath = path.join(projectPath, ...relativePath.split("/"));
  const buffer = Buffer.from(`naimage-social-fixture:${seed}`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
  return {
    type: "file",
    relativePath,
    contentHash: hash(buffer),
    mimeType: relativePath.endsWith(".mp4") ? "video/mp4" : "image/png"
  };
}

function metadata(plan, contentType, slot) {
  return { platform: plan.platform, contentType, workflowId: plan.workflowId, slot, status: "generated" };
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-social-export-"));
  const projectPath = path.join(tempRoot, "project");
  const destination = path.join(tempRoot, "exports");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(destination, { recursive: true });

  const xiaohongshuPlan = normalizeXiaohongshuPlan({
    brief: "夏季通勤防晒经验",
    titleCandidates: ["通勤防晒这样做", "夏天不狼狈的秘诀", "上班族防晒清单"],
    recommendedTitle: "通勤防晒这样做",
    body: "分享一套真实、克制的通勤防晒步骤。",
    tags: ["通勤", "防晒"],
    cover: { enabled: true, title: "通勤防晒", prompt: "清爽通勤封面", status: "generated" },
    cards: Array.from({ length: 7 }, (_, index) => ({
      title: `第 ${index + 1} 页`,
      copy: `卡片文案 ${index + 1}`,
      prompt: `卡片画面 ${index + 1}`,
      status: "generated"
    })),
    status: "generated"
  });
  const xhsCover = fixtureFile(projectPath, "output/imagegen/xhs-cover.png", "xhs-cover");
  const xhsCards = Array.from({ length: 7 }, (_, index) => fixtureFile(projectPath, `output/imagegen/xhs-card-${index + 1}.png`, `xhs-card-${index + 1}`));

  const douyinPlan = normalizeDouyinPlan({
    brief: "30 秒展示新品咖啡杯",
    hooks: ["这个杯口有点不一样", "通勤杯最容易忽略这里", "30 秒看懂这只杯子"],
    title: "30 秒看懂通勤咖啡杯",
    script: "从杯口、握持和保温体验依次展示。",
    subtitleText: "这个杯口有点不一样。\n握持稳定，适合通勤。",
    tags: ["咖啡杯", "通勤好物"],
    cover: { title: "通勤咖啡杯", prompt: "竖屏产品封面", status: "generated" },
    shots: Array.from({ length: 6 }, (_, index) => ({
      narration: `旁白 ${index + 1}`,
      visual: `画面 ${index + 1}`,
      prompt: `分镜素材 ${index + 1}`,
      durationSeconds: 5,
      status: "generated"
    })),
    status: "generated"
  });
  const douyinCover = fixtureFile(projectPath, "output/imagegen/douyin-cover.png", "douyin-cover");
  const douyinShots = Array.from({ length: 6 }, (_, index) => fixtureFile(projectPath, `output/imagegen/douyin-shot-${index + 1}.png`, `douyin-shot-${index + 1}`));
  const douyinVideo = fixtureFile(projectPath, "output/video/generated/douyin-final.mp4", "douyin-video");

  const session = {
    nodes: [
      {
        id: "REQ-XHS",
        type: "requirement",
        title: "小红书通勤防晒",
        requirement: { version: 2, text: "social", revision: 3, socialPlan: xiaohongshuPlan }
      },
      { id: "XHS-COVER", type: "image", createdAt: "2026-08-03T01:00:00.000Z", assets: [xhsCover], socialContent: metadata(xiaohongshuPlan, "cover", "cover") },
      { id: "XHS-CARDS", type: "image", createdAt: "2026-08-03T01:01:00.000Z", assets: xhsCards, taskProvenance: { socialContent: metadata(xiaohongshuPlan, "card", "card-set") } },
      {
        id: "REQ-DY",
        type: "requirement",
        title: "抖音咖啡杯",
        requirement: { version: 2, text: "social", revision: 4, socialPlan: { ...douyinPlan, videoNodeId: "DY-VIDEO" } }
      },
      { id: "DY-COVER", type: "image", createdAt: "2026-08-03T02:00:00.000Z", assets: [douyinCover], socialContent: metadata(douyinPlan, "cover", "cover") },
      { id: "DY-SHOTS", type: "image", createdAt: "2026-08-03T02:01:00.000Z", assets: douyinShots, socialContent: metadata(douyinPlan, "shot", "shot-set") },
      {
        id: "DY-VIDEO",
        type: "video",
        createdAt: "2026-08-03T02:02:00.000Z",
        videoAsset: douyinVideo,
        videoModel: "doubao-seedance-2-0-260128",
        videoTaskId: "video-task-social-fixture",
        socialContent: metadata(douyinPlan, "video", "video")
      }
    ]
  };
  const project = { id: "project-social", path: projectPath };
  const resolveProjectRelativePath = (root, relativePath) => {
    const target = path.resolve(root, String(relativePath || ""));
    const relation = path.relative(path.resolve(root), target);
    return relation && !relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation) ? target : "";
  };
  const service = createProjectSocialExportService({
    getProjectById: (id) => id === project.id ? project : null,
    projectSessionFromDisk: () => structuredClone(session),
    readProjectList: () => ({ projects: [project] }),
    resolveProjectRelativePath,
    now: () => "2026-08-03T03:00:00.000Z"
  });

  const xhsPreview = service.preview({ expectedProjectId: project.id, requirementNodeId: "REQ-XHS", expectedRequirementRevision: 3 });
  assert.equal(xhsPreview.summary.images, 8);
  assert.deepEqual(xhsPreview.summary.missingSlots, []);
  assert.equal(JSON.stringify(xhsPreview).includes(projectPath), false, "preview must not expose absolute managed paths");
  await assert.rejects(
    service.exportPackage({ expectedProjectId: project.id, requirementNodeId: "REQ-XHS", destinationParent: destination }),
    (error) => error?.code === "CONFIRMATION_REQUIRED"
  );

  const xhsExport = await service.exportPackage({
    expectedProjectId: project.id,
    requirementNodeId: "REQ-XHS",
    expectedRequirementRevision: 3,
    destinationParent: destination,
    confirmed: true
  });
  assert.equal(xhsExport.ok, true);
  assert.equal(xhsExport.images, 8);
  assert.equal(xhsExport.videos, 0);
  const xhsManifestPath = path.join(destination, xhsExport.folderName, "manifest.json");
  const xhsManifest = JSON.parse(readFileSync(xhsManifestPath, "utf8"));
  assert.equal(xhsManifest.files.length, 8);
  assert.equal(JSON.stringify(xhsManifest).includes(projectPath), false, "manifest must use relative paths only");
  assert.equal(existsSync(path.join(destination, xhsExport.folderName, "content.md")), true);

  const douyinExport = await service.exportPackage({
    expectedProjectId: project.id,
    requirementNodeId: "REQ-DY",
    expectedRequirementRevision: 4,
    destinationParent: destination,
    confirmed: true
  });
  assert.equal(douyinExport.images, 7);
  assert.equal(douyinExport.videos, 1);
  assert.equal(existsSync(path.join(destination, douyinExport.folderName, "video", "final.mp4")), true);
  assert.equal(existsSync(path.join(destination, douyinExport.folderName, "subtitles.txt")), true);

  const outsidePath = path.join(tempRoot, "outside.png");
  writeFileSync(outsidePath, "outside");
  const brokenSession = structuredClone(session);
  brokenSession.nodes.find((node) => node.id === "XHS-COVER").assets[0] = {
    type: "file",
    path: outsidePath,
    contentHash: hash(Buffer.from("outside")),
    mimeType: "image/png"
  };
  const unsafeService = createProjectSocialExportService({
    getProjectById: () => project,
    projectSessionFromDisk: () => brokenSession,
    readProjectList: () => ({ projects: [project] }),
    resolveProjectRelativePath
  });
  await assert.rejects(
    unsafeService.exportPackage({ expectedProjectId: project.id, requirementNodeId: "REQ-XHS", destinationParent: destination, confirmed: true }),
    (error) => error?.code === "SOCIAL_ASSET_NOT_MANAGED"
  );
  assert.equal(readdirSync(destination).some((name) => name.startsWith(".naimage-social-publish-")), false, "failed export must clean staging folders");

  const handlers = new Map();
  const selectedDestination = path.join(tempRoot, "authorized");
  mkdirSync(selectedDestination, { recursive: true });
  let receivedPayload;
  registerSocialExportIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selectedDestination] }) },
    socialExportService: {
      preview: () => ({ ok: true }),
      exportPackage: async (payload) => { receivedPayload = payload; return { ok: true, exported: true }; }
    }
  });
  const packageHandler = handlers.get("naimage:social-export:package");
  const ipcResult = await packageHandler({}, {
    expectedProjectId: project.id,
    requirementNodeId: "REQ-XHS",
    confirmed: true,
    destinationParent: path.join(tempRoot, "attacker-controlled")
  });
  assert.equal(ipcResult.ok, true);
  assert.equal(receivedPayload.destinationParent, selectedDestination, "IPC must replace renderer paths with native authorization");

  rmSync(tempRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: true, cases: 22 })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
