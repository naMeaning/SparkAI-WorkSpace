"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { createReadStream } = require("node:fs");
const {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile
} = require("node:fs/promises");
const path = require("node:path");

const {
  normalizeSocialContentMetadata,
  normalizeSocialContentPlan,
  socialContentWritebackIssues
} = require("../runtime/social-content-plan.cjs");

const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;

class SocialExportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SocialExportError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(candidate, root) {
  const candidateKey = comparablePath(candidate);
  const rootKey = comparablePath(root);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function safeSegment(value, fallback) {
  let segment = cleanText(value, 160)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 88);
  if (!segment) segment = fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) segment = `_${segment}`;
  return segment;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function socialMetadataForNode(node) {
  return normalizeSocialContentMetadata(node?.socialContent || node?.taskProvenance?.socialContent);
}

function usableAssets(node) {
  return (Array.isArray(node?.assets) ? node.assets : [])
    .map((asset, assetIndex) => ({ asset, assetIndex }))
    .filter(({ asset }) => asset && asset.status !== "error" && asset.status !== "pending");
}

function assetExtension(asset, fallback) {
  const locator = cleanText(asset?.relativePath || asset?.path || asset?.originalName, 8_192);
  const extension = path.extname(locator).toLowerCase();
  if (/^\.(?:png|jpe?g|webp|avif|tiff?)$/.test(extension)) return extension === ".jpeg" ? ".jpg" : extension;
  if (/^\.(?:mp4|webm|mov|m4v)$/.test(extension)) return extension === ".m4v" ? ".mp4" : extension;
  return fallback;
}

function socialCopy(plan) {
  if (plan.platform === "xiaohongshu") {
    return {
      platform: plan.platform,
      recommendedTitle: plan.recommendedTitle,
      alternativeTitles: plan.titleCandidates.filter((title) => title !== plan.recommendedTitle),
      body: plan.body,
      tags: [...plan.tags]
    };
  }
  return {
    platform: plan.platform,
    title: plan.title,
    hooks: [...plan.hooks],
    script: plan.script,
    subtitleText: plan.subtitleText,
    tags: [...plan.tags]
  };
}

function socialMarkdown(plan) {
  if (plan.platform === "xiaohongshu") {
    return [
      `# ${plan.recommendedTitle}`,
      "",
      plan.body,
      "",
      plan.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
      "",
      "## 备选标题",
      ...plan.titleCandidates.map((title) => `- ${title}`),
      ""
    ].join("\n");
  }
  return [
    `# ${plan.title}`,
    "",
    "## 开场 Hook",
    ...plan.hooks.map((hook) => `- ${hook}`),
    "",
    "## 口播文案",
    plan.script,
    "",
    "## 标签",
    plan.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
    ""
  ].join("\n");
}

function publicPlan(plan) {
  return {
    ok: true,
    projectId: plan.projectId,
    requirementNodeId: plan.requirementNodeId,
    requirementRevision: plan.requirementRevision,
    workflowId: plan.socialPlan.workflowId,
    planHash: plan.socialPlan.planHash,
    platform: plan.socialPlan.platform,
    title: plan.title,
    summary: {
      images: plan.imageFiles.length,
      videos: plan.videoFile ? 1 : 0,
      missingSlots: [...plan.missingSlots]
    },
    files: [
      ...plan.imageFiles.map(({ sourcePath: _sourcePath, ...file }) => file),
      ...(plan.videoFile ? [{ ...plan.videoFile, sourcePath: undefined }].map(({ sourcePath: _sourcePath, ...file }) => file) : [])
    ],
    copy: socialCopy(plan.socialPlan)
  };
}

function createProjectSocialExportService({
  getProjectById,
  projectSessionFromDisk,
  readProjectList,
  resolveProjectRelativePath,
  now = () => new Date().toISOString()
} = {}) {
  if (![getProjectById, projectSessionFromDisk, readProjectList, resolveProjectRelativePath].every((item) => typeof item === "function")) {
    throw new TypeError("social export project services are required");
  }

  function projectForId(projectIdValue) {
    const projectId = cleanText(projectIdValue, 160);
    const project = projectId ? getProjectById(projectId, readProjectList()) : null;
    if (!project?.path) throw new SocialExportError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    return project;
  }

  function socialRequirement(nodes, payload) {
    const nodeId = cleanText(payload.requirementNodeId || payload.nodeId, 160);
    const workflowId = cleanText(payload.workflowId, 96).toLowerCase();
    const node = nodes.find((candidate) => candidate?.type === "requirement" && candidate.requirement?.socialPlan && (
      nodeId ? candidate.id === nodeId : workflowId && candidate.requirement.socialPlan.workflowId === workflowId
    ));
    if (!node?.requirement?.socialPlan) {
      throw new SocialExportError("SOCIAL_REQUIREMENT_NOT_FOUND", "没有找到要导出的社媒 Requirement。", { nodeId, workflowId });
    }
    const expectedRevision = Number(payload.expectedRequirementRevision);
    if (Number.isInteger(expectedRevision) && expectedRevision > 0 && node.requirement.revision !== expectedRevision) {
      throw new SocialExportError("REQUIREMENT_REVISION_CONFLICT", "社媒 Requirement 已发生变化，请重新读取后再导出。", {
        expectedRevision,
        currentRevision: node.requirement.revision
      });
    }
    const plan = normalizeSocialContentPlan(node.requirement.socialPlan);
    const issues = socialContentWritebackIssues(plan);
    if (issues.length) {
      throw new SocialExportError("SOCIAL_CONTENT_INCOMPLETE", `社媒内容尚未完成：${issues.join("；")}。`, { issues });
    }
    return { node, plan };
  }

  function buildPlan(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const session = projectSessionFromDisk(project);
    const nodes = Array.isArray(session?.nodes) ? session.nodes : [];
    const { node: requirementNode, plan: socialPlan } = socialRequirement(nodes, payload);
    const imageSlots = new Map();
    let videoNode = null;
    const matchingNodes = nodes
      .filter((node) => {
        const metadata = socialMetadataForNode(node);
        return metadata?.workflowId === socialPlan.workflowId && metadata.platform === socialPlan.platform;
      })
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));

    for (const node of matchingNodes) {
      const metadata = socialMetadataForNode(node);
      if (!metadata) continue;
      if (node.type === "video" && (node.videoAsset?.path || node.videoAsset?.relativePath)) {
        videoNode = node;
        continue;
      }
      if (node.type !== "image") continue;
      const assets = usableAssets(node);
      if (metadata.slot === "card-set" || metadata.slot === "shot-set") {
        const prefix = metadata.slot === "card-set" ? "card" : "shot";
        assets.forEach(({ asset, assetIndex }, index) => imageSlots.set(`${prefix}-${index + 1}`, { node, asset, assetIndex }));
      } else if (assets[0] && /^(?:cover|card-[1-9]|shot-[1-8])$/.test(metadata.slot || "")) {
        imageSlots.set(metadata.slot, { node, ...assets[0] });
      }
    }

    if (!videoNode && socialPlan.platform === "douyin" && socialPlan.videoNodeId) {
      const candidate = nodes.find((node) => node.id === socialPlan.videoNodeId && node.type === "video");
      if (candidate?.videoAsset?.path || candidate?.videoAsset?.relativePath) videoNode = candidate;
    }

    const expectedImageSlots = socialPlan.platform === "xiaohongshu"
      ? [
          ...(socialPlan.cover.enabled ? ["cover"] : []),
          ...Array.from({ length: socialPlan.cardCount }, (_, index) => `card-${index + 1}`)
        ]
      : ["cover", ...Array.from({ length: socialPlan.shotCount }, (_, index) => `shot-${index + 1}`)];
    const missingSlots = expectedImageSlots.filter((slot) => !imageSlots.has(slot));
    if (socialPlan.platform === "douyin" && !videoNode) missingSlots.push("video");

    const imageFiles = expectedImageSlots.flatMap((slot, order) => {
      const item = imageSlots.get(slot);
      if (!item) return [];
      return [{
        role: slot === "cover" ? "cover" : socialPlan.platform === "xiaohongshu" ? "card" : "shot",
        slot,
        order,
        nodeId: item.node.id,
        assetIndex: item.assetIndex,
        extension: assetExtension(item.asset, ".png"),
        mimeType: cleanText(item.asset.mimeType, 80),
        contentHash: cleanText(item.asset.contentHash, 128).toLowerCase(),
        sourcePath: cleanText(item.asset.path, 8_192) || resolveProjectRelativePath(project.path, item.asset.relativePath),
        model: cleanText(item.node.taskProvenance?.model || item.node.imageParams?.model, 240),
        createdAt: cleanText(item.node.createdAt, 80)
      }];
    });
    const videoFile = videoNode ? {
      role: "video",
      slot: "video",
      order: 0,
      nodeId: videoNode.id,
      extension: assetExtension(videoNode.videoAsset, ".mp4"),
      mimeType: cleanText(videoNode.videoAsset?.mimeType, 80) || "video/mp4",
      contentHash: cleanText(videoNode.videoAsset?.contentHash, 128).toLowerCase(),
      sourcePath: cleanText(videoNode.videoAsset?.path, 8_192) || resolveProjectRelativePath(project.path, videoNode.videoAsset?.relativePath),
      model: cleanText(videoNode.videoModel, 240),
      taskId: cleanText(videoNode.videoTaskId, 180),
      createdAt: cleanText(videoNode.createdAt, 80)
    } : null;
    return {
      project,
      projectId: project.id,
      requirementNodeId: requirementNode.id,
      requirementRevision: requirementNode.requirement.revision,
      socialPlan,
      title: requirementNode.title || (socialPlan.platform === "xiaohongshu" ? socialPlan.recommendedTitle : socialPlan.title),
      imageFiles,
      videoFile,
      missingSlots
    };
  }

  async function verifiedSource(project, file) {
    const requested = cleanText(file.sourcePath, 8_192);
    if (!requested) throw new SocialExportError("SOCIAL_ASSET_MISSING", `发布包缺少 ${file.slot} 的受管文件。`, { slot: file.slot });
    const [projectRoot, sourcePath] = await Promise.all([realpath(project.path), realpath(requested).catch(() => "")]);
    if (!sourcePath || !isPathInside(sourcePath, projectRoot)) {
      throw new SocialExportError("SOCIAL_ASSET_NOT_MANAGED", `发布包素材 ${file.slot} 不在当前项目受管目录中。`, { slot: file.slot });
    }
    const stats = await lstat(sourcePath).catch(() => null);
    const maximum = file.role === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > maximum) {
      throw new SocialExportError("SOCIAL_ASSET_INVALID", `发布包素材 ${file.slot} 不是有效的受管文件。`, { slot: file.slot });
    }
    const contentHash = await hashFile(sourcePath);
    if (file.contentHash && file.contentHash !== contentHash) {
      throw new SocialExportError("SOCIAL_ASSET_HASH_MISMATCH", `发布包素材 ${file.slot} 的内容已变化。`, { slot: file.slot });
    }
    return { sourcePath, contentHash, bytes: stats.size };
  }

  async function uniqueDestination(parent, baseName) {
    for (let index = 0; index < 1_000; index += 1) {
      const candidate = path.join(parent, index ? `${baseName}-${index + 1}` : baseName);
      try {
        await access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new SocialExportError("SOCIAL_EXPORT_NAME_EXHAUSTED", "导出目录中同名发布包过多，请选择其他目录。");
  }

  async function exportPackage(payload = {}) {
    if (payload.confirmed !== true) throw new SocialExportError("CONFIRMATION_REQUIRED", "导出发布包需要由用户明确触发。", { confirmed: false });
    const plan = buildPlan(payload);
    if (plan.missingSlots.length) {
      throw new SocialExportError("SOCIAL_ASSETS_INCOMPLETE", `发布包缺少：${plan.missingSlots.join("、")}。`, { missingSlots: plan.missingSlots });
    }
    const destinationParent = cleanText(payload.destinationParent, 8_192);
    if (!destinationParent) throw new SocialExportError("SOCIAL_EXPORT_DESTINATION_REQUIRED", "请选择发布包导出目录。");
    const parentStats = await lstat(destinationParent).catch(() => null);
    if (!parentStats?.isDirectory()) throw new SocialExportError("SOCIAL_EXPORT_DESTINATION_INVALID", "所选发布包目录不可用。");
    const realParent = await realpath(destinationParent);
    const workflowSuffix = plan.socialPlan.workflowId.slice(-8);
    const baseName = safeSegment(
      `${plan.socialPlan.platform}-${plan.socialPlan.platform === "xiaohongshu" ? plan.socialPlan.recommendedTitle : plan.socialPlan.title}-${workflowSuffix}`,
      `social-${workflowSuffix}`
    );
    const finalPath = await uniqueDestination(realParent, baseName);
    const stagingPath = await mkdtemp(path.join(realParent, ".naimage-social-publish-"));
    const manifestFiles = [];
    try {
      const verifiedImages = [];
      for (const file of plan.imageFiles) verifiedImages.push({ file, verified: await verifiedSource(plan.project, file) });
      const verifiedVideo = plan.videoFile ? { file: plan.videoFile, verified: await verifiedSource(plan.project, plan.videoFile) } : null;
      for (const { file, verified } of verifiedImages) {
        const directory = file.role === "shot" ? "shots" : "images";
        const prefix = file.slot === "cover" ? "00" : String(Number(file.slot.split("-")[1]) || file.order + 1).padStart(2, "0");
        const name = `${prefix}-${safeSegment(file.slot, file.role)}${file.extension}`;
        const relativePath = path.posix.join(directory, name);
        const outputPath = path.join(stagingPath, ...relativePath.split("/"));
        await mkdir(path.dirname(outputPath), { recursive: true });
        await copyFile(verified.sourcePath, outputPath);
        manifestFiles.push({
          role: file.role,
          slot: file.slot,
          path: relativePath,
          bytes: verified.bytes,
          sha256: verified.contentHash,
          mimeType: file.mimeType,
          model: file.model,
          nodeId: file.nodeId,
          assetIndex: file.assetIndex
        });
      }
      if (verifiedVideo) {
        const relativePath = `video/final${verifiedVideo.file.extension}`;
        const outputPath = path.join(stagingPath, "video", `final${verifiedVideo.file.extension}`);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await copyFile(verifiedVideo.verified.sourcePath, outputPath);
        manifestFiles.push({
          role: "video",
          slot: "video",
          path: relativePath,
          bytes: verifiedVideo.verified.bytes,
          sha256: verifiedVideo.verified.contentHash,
          mimeType: verifiedVideo.file.mimeType,
          model: verifiedVideo.file.model,
          nodeId: verifiedVideo.file.nodeId,
          taskId: verifiedVideo.file.taskId
        });
      }
      await writeFile(path.join(stagingPath, "content.json"), `${JSON.stringify(socialCopy(plan.socialPlan), null, 2)}\n`, "utf8");
      await writeFile(path.join(stagingPath, "content.md"), socialMarkdown(plan.socialPlan), "utf8");
      if (plan.socialPlan.platform === "douyin" && plan.socialPlan.subtitlesEnabled) {
        await writeFile(path.join(stagingPath, "subtitles.txt"), `${plan.socialPlan.subtitleText}\n`, "utf8");
      }
      const manifest = {
        format: "naimage-social-publish-package",
        version: 1,
        generatedAt: now(),
        platform: plan.socialPlan.platform,
        workflowId: plan.socialPlan.workflowId,
        planHash: plan.socialPlan.planHash,
        requirement: { nodeId: plan.requirementNodeId, revision: plan.requirementRevision },
        files: manifestFiles,
        contentFile: "content.json",
        readableContentFile: "content.md",
        ...(plan.socialPlan.platform === "douyin" && plan.socialPlan.subtitlesEnabled ? { subtitlesFile: "subtitles.txt" } : {})
      };
      await writeFile(path.join(stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await rename(stagingPath, finalPath);
      return {
        ...publicPlan(plan),
        exported: true,
        folderName: path.basename(finalPath),
        manifest: "manifest.json",
        fileCount: manifestFiles.length + 2 + (manifest.subtitlesFile ? 1 : 0),
        images: plan.imageFiles.length,
        videos: plan.videoFile ? 1 : 0,
        exportId: `social-export-${randomBytes(8).toString("hex")}`
      };
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    buildPlan,
    preview(payload = {}) {
      return publicPlan(buildPlan(payload));
    },
    exportPackage
  };
}

module.exports = {
  SocialExportError,
  createProjectSocialExportService
};
