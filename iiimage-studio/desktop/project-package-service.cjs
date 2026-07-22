"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const PROJECT_PACKAGE_SERVICE_OWNER = "desktop/project-package-service.cjs";
const projectPackageMaximumFileBytes = 192 * 1024 * 1024;
const projectPackageMaximumAssetBytes = 32 * 1024 * 1024;
const projectPackageMaximumDecodedBytes = 128 * 1024 * 1024;
const projectPackageMaximumSessionBytes = 16 * 1024 * 1024;
const projectPackageMaximumAssets = 1_000;
const projectPackageMaximumNodes = 5_000;
const projectPackageMaximumMessages = 10_000;
const projectPackageMaximumConversations = 1_000;

function createProjectPackageService(options = {}) {
  const {
    assertSafeEncodedImageDimensions,
    assetUrlFor,
    boundedImageRead,
    buildProjectAssetIndex,
    comparablePath,
    controlledProjectAssetFile,
    createProjectRecord,
    defaultSession,
    detectImageFormat,
    encodedImageDimensions,
    hydrateAssetForProject,
    isComparablePathInside,
    log = () => {},
    mimeTypeForPath,
    nativeImage,
    projectAssetRoots,
    projectRelativePath,
    projectSessionFromDisk,
    resolveProjectRelativePath,
    safeName,
    sanitizeSession,
    sessionForProjectSave,
    writeJson,
    writeProjectManifest
  } = options;

  function projectPackageFailure(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validateProjectPackageSessionShape(session) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包缺少有效会话数据。");
    }
    const nodes = Array.isArray(session.nodes) ? session.nodes : [];
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const conversations = Array.isArray(session.conversations) ? session.conversations : [];
    if (nodes.length > projectPackageMaximumNodes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `画布节点超过 ${projectPackageMaximumNodes} 个，无法安全导入或导出。`);
    }
    if (messages.length > projectPackageMaximumMessages || conversations.length > projectPackageMaximumConversations) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布会话或消息数量过多，无法安全导入或导出。");
    }
    let conversationMessages = 0;
    for (const conversation of conversations) {
      conversationMessages += Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
      if (conversationMessages > projectPackageMaximumMessages) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布历史消息数量过多，无法安全导入或导出。");
      }
    }
    let serialized;
    try {
      serialized = JSON.stringify(session);
    } catch {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布会话无法序列化。");
    }
    if (Buffer.byteLength(serialized, "utf8") > projectPackageMaximumSessionBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "画布会话数据超过 16MB，无法安全导入或导出。");
    }
  }

  function estimatedBase64DecodedBytes(value) {
    const data = String(value || "");
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return -1;
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return (data.length / 4) * 3 - padding;
  }

  function validateProjectPackageData(packageData) {
    if (!packageData || typeof packageData !== "object" || Array.isArray(packageData)) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布文件格式无效。");
    }
    if (packageData.format !== "iiimage-project-package" || ![1, 2].includes(Number(packageData.version))) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_UNSUPPORTED", "这不是受支持的 iiimage 画布项目包。");
    }
    validateProjectPackageSessionShape(packageData.session);
    const assets = Array.isArray(packageData.assets) ? packageData.assets : [];
    if (assets.length > projectPackageMaximumAssets) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `项目包图片超过 ${projectPackageMaximumAssets} 张，无法安全导入。`);
    }
    let decodedBytes = 0;
    for (const asset of assets) {
      if (!asset || typeof asset !== "object" || typeof asset.data !== "string") {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "项目包包含缺失图片数据的资产。");
      }
      const estimatedBytes = estimatedBase64DecodedBytes(asset.data);
      if (estimatedBytes <= 0 || estimatedBytes > projectPackageMaximumAssetBytes) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE", "项目包中的单张图片无效或超过 32MB。");
      }
      decodedBytes += estimatedBytes;
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes > projectPackageMaximumDecodedBytes) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
      }
    }
    return { assets, decodedBytes };
  }

  function validateProjectPackageImageBuffer(buffer, label) {
    const format = detectImageFormat(buffer);
    const dimensions = encodedImageDimensions(buffer);
    if (!format || !dimensions) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”不是真实的 PNG、JPEG 或 WebP。`);
    }
    assertSafeEncodedImageDimensions(buffer, label);
    const decoded = nativeImage.createFromBuffer(buffer);
    if (decoded.isEmpty()) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”已经损坏或无法解码。`);
    }
    const decodedSize = decoded.getSize();
    if (decodedSize.width !== dimensions.width || decodedSize.height !== dimensions.height) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”的尺寸信息不一致。`);
    }
    return { ...format, width: dimensions.width, height: dimensions.height };
  }

  function writeProjectPackageFile(filePath, packageData) {
    const serialized = `${JSON.stringify(packageData)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > projectPackageMaximumFileBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "导出的项目包超过 192MB，请减少画布图片后重试。");
    }
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx" });
      renameSync(tempPath, filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
  }

  function packageProject(project) {
    const session = projectSessionFromDisk(project);
    const projectPath = path.resolve(project.path);
    const assets = [];
    let packagedDecodedBytes = 0;
    const readPackageAsset = (filePath) => {
      if (assets.length >= projectPackageMaximumAssets) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `画布图片超过 ${projectPackageMaximumAssets} 张，无法安全导出。`);
      }
      const label = path.basename(filePath);
      const buffer = boundedImageRead(filePath, projectPackageMaximumAssetBytes, label, "项目图片");
      const format = validateProjectPackageImageBuffer(buffer, label);
      packagedDecodedBytes += buffer.length;
      if (packagedDecodedBytes > projectPackageMaximumDecodedBytes) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "画布图片总量超过 128MB，请减少图片后再导出。");
      }
      return { buffer, ...format };
    };
    for (const node of session.nodes) {
      for (const asset of node.assets || []) {
        if (asset.type !== "file" || !asset.path || !existsSync(asset.path)) continue;
        const controlledPath = controlledProjectAssetFile(asset.path, projectPath);
        if (!controlledPath || !/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(controlledPath))) continue;
        const packagedImage = readPackageAsset(controlledPath);
        const { buffer, mimeType } = packagedImage;
        assets.push({
          nodeId: node.id,
          assetId: asset.assetId || "",
          displayCode: asset.displayCode || "",
          contentHash: createHash("sha256").update(buffer).digest("hex"),
          index: asset.index,
          type: "file",
          path: asset.relativePath || projectRelativePath(projectPath, controlledPath) || path.join("output", "imagegen", path.basename(controlledPath)).split(path.sep).join("/"),
          fileName: path.basename(controlledPath),
          mimeType,
          runId: asset.runId || "",
          revisedPrompt: asset.revisedPrompt || "",
          data: buffer.toString("base64")
        });
      }
    }
    const packagedAttachmentKeys = new Set(assets.map((asset) => asset.assetId || `${asset.nodeId}:${asset.index}:${asset.runId}`));
    const conversationMessages = [
      ...(Array.isArray(session.messages) ? session.messages : []),
      ...(Array.isArray(session.conversations) ? session.conversations.flatMap((conversation) => Array.isArray(conversation?.messages) ? conversation.messages : []) : [])
    ];
    for (const message of conversationMessages) {
      const attachmentItems = [
        ...(Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : []),
        ...(Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : [])
      ];
      for (const attachment of attachmentItems) {
        const attachmentPath = controlledProjectAssetFile(attachment?.path, projectPath);
        if (!attachmentPath) continue;
        if (!/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(attachmentPath))) continue;
        const packageKey = String(attachment.assetId || "").trim() || `path:${comparablePath(attachmentPath)}`;
        if (packagedAttachmentKeys.has(packageKey)) continue;
        packagedAttachmentKeys.add(packageKey);
        const packagedImage = readPackageAsset(attachmentPath);
        const { buffer, mimeType } = packagedImage;
        assets.push({
          nodeId: attachment.nodeId || "",
          attachment: true,
          assetId: attachment.assetId || "",
          displayCode: attachment.displayCode || "",
          contentHash: createHash("sha256").update(buffer).digest("hex"),
          index: 1,
          type: "file",
          path: projectRelativePath(projectPath, attachmentPath) || path.join("assets", path.basename(attachmentPath)).split(path.sep).join("/"),
          fileName: path.basename(attachmentPath),
          mimeType,
          runId: "",
          revisedPrompt: "",
          data: buffer.toString("base64")
        });
      }
    }
    const packagedByPath = new Map();
    for (const packaged of assets) {
      const absolutePath = resolveProjectRelativePath(projectPath, packaged.path);
      if (absolutePath) packagedByPath.set(comparablePath(absolutePath), packaged);
    }
    const portableFileReference = (reference, nodeId = "", slot = "asset", index = 1) => {
      if (!reference || typeof reference !== "object") return reference;
      const controlledPath = controlledProjectAssetFile(reference.path, projectPath);
      if (!controlledPath) {
        return reference.type === "file" || reference.path
          ? { ...reference, path: undefined, assetUrl: undefined }
          : { ...reference };
      }
      const mimeType = mimeTypeForPath(controlledPath);
      if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return { ...reference, path: undefined, assetUrl: undefined };
      const pathKey = comparablePath(controlledPath);
      let packaged = packagedByPath.get(pathKey);
      if (!packaged) {
        const relativePath = projectRelativePath(projectPath, controlledPath) || path.join("assets", path.basename(controlledPath)).split(path.sep).join("/");
        const packagedImage = readPackageAsset(controlledPath);
        const { buffer, mimeType: actualMimeType } = packagedImage;
        packaged = {
          nodeId,
          nested: true,
          assetId: reference.assetId || "",
          displayCode: reference.displayCode || "",
          contentHash: createHash("sha256").update(buffer).digest("hex"),
          index,
          type: "file",
          path: relativePath,
          fileName: path.basename(controlledPath),
          mimeType: actualMimeType,
          runId: reference.runId || "",
          revisedPrompt: reference.revisedPrompt || "",
          data: buffer.toString("base64")
        };
        assets.push(packaged);
        packagedByPath.set(pathKey, packaged);
      }
      const packageAssetKey = packaged.packageAssetKey || reference.assetId || `pkg-${createHash("sha256").update(`${nodeId}|${slot}|${packaged.path}`).digest("hex").slice(0, 24)}`;
      packaged.packageAssetKey = packageAssetKey;
      return {
        ...reference,
        packageAssetKey,
        path: undefined,
        assetUrl: undefined,
        relativePath: reference.relativePath || projectRelativePath(projectPath, controlledPath),
        fileName: reference.fileName || path.basename(controlledPath)
      };
    };
    const portableAttachment = (attachment, index, role) => portableFileReference(attachment, attachment?.nodeId || "", `message-${role}-${index}`, index + 1);
    const portableMessage = (message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...message,
        attachments: {
          ...message.attachments,
          sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((item, index) => portableAttachment(item, index, "source")) : [],
          referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((item, index) => portableAttachment(item, index, "reference")) : []
        }
      };
    };
    const portableSession = {
      ...session,
      // A pending AskUser continuation depends on local protocol history and
      // project identity. Exporting it would leak local paths and cannot resume
      // safely after import, so portable projects always start without it.
      pendingAgentExecution: null,
      nodes: session.nodes.map((node) => ({
        ...node,
        assets: (node.assets || []).map((asset, index) => portableFileReference(asset, node.id, `assets-${index}`, index + 1)),
        imageParams: node.imageParams ? {
          ...node.imageParams,
          referenceImages: Array.isArray(node.imageParams.referenceImages)
            ? node.imageParams.referenceImages.map((reference, index) => portableFileReference(reference, node.id, `image-params-reference-${index}`, index + 1))
            : []
        } : node.imageParams,
        layerGroup: node.layerGroup ? {
          ...node.layerGroup,
          previewAsset: portableFileReference(node.layerGroup.previewAsset, node.id, "layer-group-preview", 1),
          mergedAsset: portableFileReference(node.layerGroup.mergedAsset, node.id, "layer-group-merged", 1)
        } : node.layerGroup,
        layerComposition: node.layerComposition ? {
          ...node.layerComposition,
          previewAsset: portableFileReference(node.layerComposition.previewAsset, node.id, "layer-composition-preview", 1),
          mergedAsset: portableFileReference(node.layerComposition.mergedAsset, node.id, "layer-composition-merged", 1),
          layers: Array.isArray(node.layerComposition.layers)
            ? node.layerComposition.layers.map((layer, index) => ({ ...layer, asset: portableFileReference(layer.asset, node.id, `layer-${layer.id || index}`, index + 1) }))
            : []
        } : node.layerComposition
      })),
      messages: Array.isArray(session.messages) ? session.messages.map(portableMessage) : [],
      conversations: Array.isArray(session.conversations)
        ? session.conversations.map((conversation) => ({ ...conversation, messages: Array.isArray(conversation.messages) ? conversation.messages.map(portableMessage) : [] }))
        : []
    };
    validateProjectPackageSessionShape(portableSession);
    return {
      format: "iiimage-project-package",
      version: 2,
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      },
      session: portableSession,
      assets
    };
  }

  function sessionFromPackage(packageData, targetProject) {
    const packageValidation = validateProjectPackageData(packageData);
    const projectPath = path.resolve(targetProject.path);
    const assetMap = new Map();
    const assetById = new Map();
    const assetByPackageKey = new Map();
    const assetByRelativePath = new Map();
    const ambiguousAssetIds = new Set();
    const ambiguousAssetMapKeys = new Set();
    const ambiguousPackageKeys = new Set();
    const ambiguousRelativePaths = new Set();
    const restoredByTargetPath = new Map();
    const existingTargetEntry = (filePath) => {
      const key = comparablePath(filePath);
      const known = restoredByTargetPath.get(key);
      if (known) return known;
      if (!existsSync(filePath)) return null;
      try {
        const stats = lstatSync(filePath);
        const contentHash = stats.isFile() && !stats.isSymbolicLink()
          ? createHash("sha256").update(boundedImageRead(filePath, projectPackageMaximumAssetBytes, path.basename(filePath), "已有项目图片")).digest("hex")
          : `occupied:${stats.isDirectory() ? "directory" : "non-file"}`;
        const entry = { path: filePath, contentHash };
        restoredByTargetPath.set(key, entry);
        return entry;
      } catch {
        const entry = { path: filePath, contentHash: "occupied:unreadable" };
        restoredByTargetPath.set(key, entry);
        return entry;
      }
    };
    const packageRelativeLookupKey = (value) => String(value || "").trim().replace(/\\/g, "/").toLowerCase();
    const setUniqueAssetLookup = (lookup, ambiguous, key, value) => {
      const cleanKey = String(key || "").trim();
      if (!cleanKey || ambiguous.has(cleanKey)) return;
      const existing = lookup.get(cleanKey);
      if (existing && existing.contentHash !== value.contentHash) {
        lookup.delete(cleanKey);
        ambiguous.add(cleanKey);
        return;
      }
      lookup.set(cleanKey, value);
    };
    const packageAssets = packageValidation.assets;
    let decodedBytes = 0;
    for (const asset of packageAssets) {
      if (!asset || typeof asset !== "object" || !asset.data) continue;
      const relative = String(asset.path || path.join("output", "imagegen", asset.fileName || `asset-${Date.now()}.png`)).replace(/\\/g, "/");
      const buffer = Buffer.from(String(asset.data), "base64");
      if (buffer.toString("base64") !== asset.data || buffer.length > projectPackageMaximumAssetBytes) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${asset.fileName || relative}”的编码无效。`);
      }
      decodedBytes += buffer.length;
      if (decodedBytes > projectPackageMaximumDecodedBytes) {
        throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
      }
      const imageFormat = validateProjectPackageImageBuffer(buffer, asset.fileName || path.basename(relative));
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const declaredTarget = resolveProjectRelativePath(projectPath, relative);
      const allowedTarget = declaredTarget && projectAssetRoots(projectPath).some((root) => (
        comparablePath(declaredTarget) !== comparablePath(root) && isComparablePathInside(declaredTarget, root)
      ));
      let targetPath = allowedTarget
        ? declaredTarget
        : path.join(projectPath, "assets", "package-imports", safeName(asset.fileName || path.basename(relative), `asset-${contentHash.slice(0, 12)}${imageFormat.extension}`));
      if (path.extname(targetPath).toLowerCase() !== imageFormat.extension) {
        targetPath = path.join(path.dirname(targetPath), `${safeName(path.basename(targetPath, path.extname(targetPath)), "asset")}${imageFormat.extension}`);
      }
      let targetKey = comparablePath(targetPath);
      const existingTarget = existingTargetEntry(targetPath);
      if (existingTarget && existingTarget.contentHash !== contentHash) {
        const extension = path.extname(targetPath);
        const stem = safeName(path.basename(targetPath, extension), "asset");
        let attempt = 0;
        do {
          const suffix = attempt ? `${contentHash.slice(0, 12)}-${attempt}` : contentHash.slice(0, 12);
          targetPath = path.join(path.dirname(targetPath), `${stem}-${suffix}${extension}`);
          targetKey = comparablePath(targetPath);
          attempt += 1;
        } while (
          existingTargetEntry(targetPath) &&
          existingTargetEntry(targetPath).contentHash !== contentHash
        );
      }
      const reusableTarget = existingTargetEntry(targetPath);
      if (!reusableTarget) {
        mkdirSync(path.dirname(targetPath), { recursive: true });
        const temporaryTarget = path.join(path.dirname(targetPath), `.iiimage-package-${randomBytes(8).toString("hex")}.tmp`);
        try {
          writeFileSync(temporaryTarget, buffer, { flag: "wx" });
          renameSync(temporaryTarget, targetPath);
        } finally {
          rmSync(temporaryTarget, { force: true });
        }
        targetKey = comparablePath(targetPath);
        restoredByTargetPath.set(targetKey, { path: targetPath, contentHash });
      } else {
        targetPath = reusableTarget.path;
      }
      const declaredHash = String(asset.contentHash || "").trim().toLowerCase();
      if (declaredHash && declaredHash !== contentHash) {
        log(`project package content hash corrected ${relative}`);
      }
      const key = `${asset.nodeId || ""}:${asset.index || ""}:${asset.runId || ""}`;
      const restoredAsset = {
        assetId: asset.assetId || "",
        displayCode: asset.displayCode || "",
        contentHash,
        index: Number(asset.index || 1),
        type: "file",
        path: targetPath,
        relativePath: projectRelativePath(projectPath, targetPath),
        fileName: path.basename(targetPath),
        assetUrl: assetUrlFor(targetPath),
        runId: asset.runId || "",
        revisedPrompt: asset.revisedPrompt || ""
      };
      setUniqueAssetLookup(assetMap, ambiguousAssetMapKeys, key, restoredAsset);
      setUniqueAssetLookup(assetById, ambiguousAssetIds, restoredAsset.assetId, restoredAsset);
      setUniqueAssetLookup(assetByPackageKey, ambiguousPackageKeys, asset.packageAssetKey, restoredAsset);
      setUniqueAssetLookup(assetByRelativePath, ambiguousRelativePaths, packageRelativeLookupKey(relative), restoredAsset);
    }

    const packageAssetForReference = (reference, fallbackKey = "") => {
      if (!reference || typeof reference !== "object") return null;
      const portablePath = reference.relativePath || (
        typeof reference.path === "string" && !path.isAbsolute(reference.path) ? reference.path : ""
      );
      return (reference.packageAssetKey ? assetByPackageKey.get(String(reference.packageAssetKey)) : null) ||
        (reference.assetId ? assetById.get(String(reference.assetId)) : null) ||
        (fallbackKey ? assetMap.get(fallbackKey) : null) ||
        (portablePath ? assetByRelativePath.get(packageRelativeLookupKey(portablePath)) : null) ||
        null;
    };
    const restoredForReference = (reference) => {
      if (!reference || typeof reference !== "object") return reference;
      const restored = packageAssetForReference(reference);
      if (!restored) {
        const next = { ...reference };
        delete next.contentHash;
        delete next.sha256;
        return next;
      }
      const next = { ...reference, ...restored };
      delete next.packageAssetKey;
      return next;
    };
    const preparePackageMessage = (message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...message,
        attachments: {
          ...message.attachments,
          sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(restoredForReference) : [],
          referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(restoredForReference) : []
        }
      };
    };
    const portableSession = packageData?.session && typeof packageData.session === "object" ? packageData.session : defaultSession;
    const preparedSession = {
      ...portableSession,
      pendingAgentExecution: null,
      nodes: (Array.isArray(portableSession.nodes) ? portableSession.nodes : []).map((node) => ({
        ...node,
        assets: (Array.isArray(node?.assets) ? node.assets : []).map((asset) => {
          const key = `${node?.id || ""}:${asset?.index || ""}:${asset?.runId || ""}`;
          const restored = packageAssetForReference(asset, key);
          return restored ? restoredForReference({ ...asset, ...restored }) : restoredForReference(asset);
        }),
        imageParams: node?.imageParams ? {
          ...node.imageParams,
          referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
        } : node?.imageParams,
        layerGroup: node?.layerGroup ? {
          ...node.layerGroup,
          previewAsset: restoredForReference(node.layerGroup.previewAsset),
          mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
        } : node?.layerGroup,
        layerComposition: node?.layerComposition ? {
          ...node.layerComposition,
          previewAsset: restoredForReference(node.layerComposition.previewAsset),
          mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
          layers: Array.isArray(node.layerComposition.layers)
            ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer?.asset) }))
            : []
        } : node?.layerComposition
      })),
      messages: Array.isArray(portableSession.messages) ? portableSession.messages.map(preparePackageMessage) : [],
      conversations: Array.isArray(portableSession.conversations)
        ? portableSession.conversations.map((conversation) => ({
            ...conversation,
            messages: Array.isArray(conversation?.messages) ? conversation.messages.map(preparePackageMessage) : []
          }))
        : []
    };
    // The first identity reconciliation must only see hashes derived from the
    // decoded package bytes. Package/session metadata is untrusted and may be
    // stale, corrupt, or deliberately forged.
    const rawSession = sanitizeSession(preparedSession);
    const importedIndex = buildProjectAssetIndex(projectPath);
    const nodes = rawSession.nodes.map((node) => {
      const assets = (node.assets || []).map((asset) => {
        const key = `${node.id}:${asset.index || ""}:${asset.runId || ""}`;
        const restored = (asset.packageAssetKey ? assetByPackageKey.get(asset.packageAssetKey) : null) ||
          (asset.assetId ? assetById.get(asset.assetId) : null) ||
          assetMap.get(key);
        if (!restored) return hydrateAssetForProject(asset, targetProject, importedIndex);
        const next = { ...asset, ...restored };
        delete next.packageAssetKey;
        return next;
      }).filter(Boolean);
      if (!assets.length) {
        for (const [key, value] of assetMap.entries()) {
          if (key.startsWith(`${node.id}:`)) assets.push(value);
        }
      }
      return {
        ...node,
        assets,
        imageParams: node.imageParams ? {
          ...node.imageParams,
          referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
        } : node.imageParams,
        layerGroup: node.layerGroup ? {
          ...node.layerGroup,
          previewAsset: restoredForReference(node.layerGroup.previewAsset),
          mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
        } : node.layerGroup,
        layerComposition: node.layerComposition ? {
          ...node.layerComposition,
          previewAsset: restoredForReference(node.layerComposition.previewAsset),
          mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
          layers: Array.isArray(node.layerComposition.layers)
            ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer.asset) }))
            : []
        } : node.layerComposition,
        imageState: node.type === "image" && assets.length ? "done" : node.imageState,
        status: node.type === "image" && assets.length ? "done" : node.status,
        outputs: Math.max(Number(node.outputs || 0), assets.length)
      };
    });
    const rewriteAttachment = (attachment) => {
      if (!attachment || typeof attachment !== "object") return attachment;
      const restored = restoredForReference(attachment);
      if (restored === attachment) return attachment;
      return {
        ...restored,
        path: restored.path,
        assetUrl: restored.assetUrl,
        mimeType: attachment.mimeType || mimeTypeForPath(restored.path),
        name: attachment.name || restored.fileName
      };
    };
    const rewriteMessage = (message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...message,
        attachments: {
          ...message.attachments,
          sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(rewriteAttachment) : [],
          referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(rewriteAttachment) : []
        }
      };
    };
    const messages = Array.isArray(rawSession.messages) ? rawSession.messages.map(rewriteMessage) : [];
    const conversations = Array.isArray(rawSession.conversations)
      ? rawSession.conversations.map((conversation) => ({ ...conversation, messages: Array.isArray(conversation.messages) ? conversation.messages.map(rewriteMessage) : [] }))
      : [];
    return sanitizeSession({ ...rawSession, nodes, messages, conversations });
  }

  function importProjectPackage(packageData, targetPath) {
    validateProjectPackageData(packageData);
    const name = safeName(packageData.project?.name || path.basename(targetPath), "导入画布");
    const record = createProjectRecord(name, targetPath);
    const session = sessionFromPackage(packageData, record);
    writeJson(record.sessionPath, sessionForProjectSave(session, record));
    writeProjectManifest(record, session);
    return { record, session: projectSessionFromDisk(record) };
  }

  return {
    owner: PROJECT_PACKAGE_SERVICE_OWNER,
    estimatedBase64DecodedBytes,
    importProjectPackage,
    packageProject,
    projectPackageFailure,
    sessionFromPackage,
    validateProjectPackageData,
    validateProjectPackageImageBuffer,
    validateProjectPackageSessionShape,
    writeProjectPackageFile
  };
}

module.exports = {
  createProjectPackageService,
  PROJECT_PACKAGE_SERVICE_OWNER,
  projectPackageMaximumAssetBytes,
  projectPackageMaximumAssets,
  projectPackageMaximumConversations,
  projectPackageMaximumDecodedBytes,
  projectPackageMaximumFileBytes,
  projectPackageMaximumMessages,
  projectPackageMaximumNodes,
  projectPackageMaximumSessionBytes
};
