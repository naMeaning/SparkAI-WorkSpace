"use strict";

const { existsSync, lstatSync, readdirSync, realpathSync, mkdirSync, readFileSync, writeFileSync, renameSync } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");

const PROJECT_ASSET_REPOSITORY_OWNER = "desktop/project-asset-repository.cjs";

function createProjectAssetRepository(options = {}) {
  const {
    assetPathFromUrl = () => "",
    assetUrlFor,
    boundedImageRead,
    comparablePath,
    isComparablePathInside,
    maxExportImageBytes,
    legacyProjectMetaDirNames = [],
    projectMetaDirName,
    projectRelativePath,
    projectRoot,
    realPathIfPresent,
    resolveProjectRelativePath,
    sanitizeSession,
    sessionAssetContentHash,
    sessionPath
  } = options;
  const readableProjectMetaDirNames = [projectMetaDirName, ...legacyProjectMetaDirNames]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);

  let validationRoots = null;
  function withAssetValidation(callback) {
    const previous = validationRoots;
    validationRoots = new Map();
    try { return callback(); }
    finally { validationRoots = previous; }
  }

  function collectAssetFiles(rootDir, maxFiles = 5000) {
    const files = [];
    const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    function walk(dir) {
      if (files.length >= maxFiles || !existsSync(dir)) return;
      let entries = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          walk(fullPath);
        } else if (entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    }
    walk(rootDir);
    return files;
  }

  function projectWritableAssetRoots(projectPath) {
    const resolvedProject = path.resolve(projectPath || projectRoot);
    return [
      path.join(resolvedProject, "output", "imagegen"),
      path.join(resolvedProject, "output", "video"),
      path.join(resolvedProject, "assets"),
      path.join(resolvedProject, projectMetaDirName, "assets")
    ];
  }

  function projectAssetRoots(projectPath) {
    const resolvedProject = path.resolve(projectPath || projectRoot);
    return [
      ...projectWritableAssetRoots(resolvedProject),
      ...readableProjectMetaDirNames
        .filter((dirName) => dirName !== projectMetaDirName)
        .map((dirName) => path.join(resolvedProject, dirName, "assets"))
    ];
  }

  function resolvedValidationRoots(projectPath) {
    const realProject = realPathIfPresent(projectPath);
    return projectAssetRoots(projectPath).map((root) => realPathIfPresent(root))
      .filter((root) => isComparablePathInside(root, realProject));
  }

  function validateProjectAssetFile(filePath, rootsFor) {
    if (!filePath || !existsSync(filePath)) return "";
    try {
      const stats = lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) return "";
      const realFile = realpathSync(filePath);
      const roots = rootsFor();
      const controlled = roots.some((root) => isComparablePathInside(realFile, root));
      return controlled ? realFile : "";
    } catch {
      return "";
    }
  }

  function controlledProjectAssetFile(filePath, projectPath) {
    return validateProjectAssetFile(filePath, () => {
      let roots = validationRoots?.get(projectPath);
      if (!roots) { roots = resolvedValidationRoots(projectPath); validationRoots?.set(projectPath, roots); }
      return roots;
    });
  }

  // One asynchronous index refresh owns this closure. Never share it across
  // queries: each file still gets fresh lstat/realpath, including junctions.
  function createProjectAssetFileValidator(projectPath) {
    let roots;
    return filePath => validateProjectAssetFile(filePath, () => roots ??= resolvedValidationRoots(projectPath));
  }

  const materialFailure = () => Object.assign(new Error("已导入素材的项目身份、位置或内容已变化，请重新导入。"), { code: "PROJECT_MATERIAL_IDENTITY_INVALID" });
  function materialIdentity(value) {
    if (!value || !["assetId", "occurrenceId"].every(field => typeof value[field] === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value[field])) || !/^[a-f0-9]{64}$/.test(value.contentHash || "")) throw materialFailure();
    return { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash };
  }
  function registeredMaterialFile(project, relativePath) {
    try {
    if (!project?.id || !project.path || typeof relativePath !== "string" || !relativePath || /[\u0000-\u001f\\]/.test(relativePath)) throw materialFailure();
    const file = resolveProjectRelativePath(project.path, relativePath), root = realpathSync(project.path);
    if (!file) throw materialFailure();
    const relative = path.relative(root, path.resolve(file));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw materialFailure();
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw materialFailure();
    }
    const controlled = controlledProjectAssetFile(file, project.path);
    if (!controlled) throw materialFailure();
    return controlled;
    } catch { throw materialFailure(); }
  }
  function materialRegistryPath(project, create = false) {
    if (!project?.id || !project.path) throw materialFailure();
    const root = realpathSync(project.path), dir = path.join(root, projectMetaDirName);
    if (create && !existsSync(dir)) mkdirSync(dir);
    if (existsSync(dir) && (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())) throw materialFailure();
    const file = path.join(dir, "imported-materials.json");
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 16 * 1024 * 1024)) throw materialFailure();
    return file;
  }
  function readMaterialRegistry(project) {
    try {
      const file = materialRegistryPath(project);
      if (!existsSync(file)) return { schemaVersion: 1, projectId: project.id, materials: [] };
      const document = JSON.parse(readFileSync(file, "utf8"));
      if (document.schemaVersion !== 1 || document.projectId !== project.id || !Array.isArray(document.materials) || document.materials.length > 20_000) throw materialFailure();
      const occurrences = new Set();
      for (const record of document.materials) {
        materialIdentity(record);
        if (typeof record.relativePath !== "string" || !record.relativePath || /[\u0000-\u001f\\]/.test(record.relativePath) || occurrences.has(record.occurrenceId)) throw materialFailure();
        occurrences.add(record.occurrenceId);
      }
      return document;
    } catch { throw materialFailure(); }
  }
  // Only the native import owner registers successfully copied images. The
  // Renderer and command surfaces have no registration operation or path input.
  function registerImportedMaterials(project, assets) {
    try {
    const document = readMaterialRegistry(project), registered = [];
    for (const asset of assets) {
      const contentHash = String(asset.contentHash || "").toLowerCase();
      const identity = materialIdentity({ assetId: `asset-${contentHash}`, occurrenceId: asset.occurrenceId, contentHash });
      const relativePath = projectRelativePath(project.path, asset.path).replace(/\\/g, "/");
      const file = registeredMaterialFile(project, relativePath), bytes = boundedImageRead(file, maxExportImageBytes, "导入素材");
      if (createHash("sha256").update(bytes).digest("hex") !== contentHash) throw materialFailure();
      const previous = document.materials.find(value => value.occurrenceId === identity.occurrenceId);
      if (previous && ["assetId", "occurrenceId", "contentHash", "relativePath"].some(field => previous[field] !== ({ ...identity, relativePath })[field])) throw materialFailure();
      if (!previous) document.materials.push({ ...identity, relativePath, createdAt: new Date().toISOString() });
      registered.push({ ...asset, ...identity });
    }
    if (document.materials.length > 20_000) throw materialFailure();
    const file = materialRegistryPath(project, true), temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(document), { flag: "wx" }); renameSync(temporary, file);
    return registered;
    } catch { throw materialFailure(); }
  }
  function resolveRegisteredMaterial(project, value) {
    const identity = materialIdentity(value), document = readMaterialRegistry(project);
    const matches = document.materials.filter(record => ["assetId", "occurrenceId", "contentHash"].every(field => record[field] === identity[field]));
    if (!matches.length) return null;
    if (matches.length !== 1) throw materialFailure();
    try {
      const record = matches[0], file = registeredMaterialFile(project, record.relativePath), bytes = boundedImageRead(file, maxExportImageBytes, "导入素材");
      if (createHash("sha256").update(bytes).digest("hex") !== identity.contentHash) throw materialFailure();
      return { ...identity, type: "file", path: file, relativePath: record.relativePath, status: "done" };
    } catch { throw materialFailure(); }
  }

  function controlledRecordedAssetUrl(asset = {}) {
    for (const value of [asset.url, asset.assetUrl]) {
      const source = typeof value === "string" ? value.trim() : "";
      if (/^https?:\/\//i.test(source) || /^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) return source;
    }
    return "";
  }

  function buildProjectAssetIndex(projectPath) {
    const roots = projectAssetRoots(projectPath);
    const files = roots.flatMap((root) => collectAssetFiles(root));
    const byName = new Map();
    const byRunId = new Map();
    for (const filePath of files) {
      const basename = path.basename(filePath).toLowerCase();
      if (!byName.has(basename)) byName.set(basename, []);
      byName.get(basename).push(filePath);
      const runMatch = basename.match(/(gen-[a-z0-9_-]+|cutout-[a-z0-9_-]+|agent-[a-z0-9_-]+|basic-[a-z0-9_-]+)/i);
      if (runMatch) {
        const runKey = runMatch[1].toLowerCase();
        if (!byRunId.has(runKey)) byRunId.set(runKey, []);
        byRunId.get(runKey).push(filePath);
      }
    }
    return { files, byName, byRunId };
  }

  function hydrateAssetForProject(asset, project, assetIndex) {
    if (!asset || typeof asset !== "object") return null;
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const next = { ...asset };
    const expectedHash = sessionAssetContentHash(next);
    const candidates = [];
    if (typeof next.relativePath === "string") candidates.push({ path: resolveProjectRelativePath(projectPath, next.relativePath), source: "relative" });
    if (typeof next.path === "string") candidates.push({ path: path.resolve(next.path), source: "recorded" });
    for (const value of [next.assetUrl, next.url]) {
      const decodedPath = assetPathFromUrl(value);
      if (decodedPath) candidates.push({ path: decodedPath, source: "asset-url" });
    }
    if (typeof next.fileName === "string") {
      const named = assetIndex?.byName?.get(String(next.fileName).toLowerCase());
      if (named?.length && (expectedHash || named.length === 1)) candidates.push(...named.map((filePath) => ({ path: filePath, source: "name" })));
    }
    if (next.runId) {
      const byRun = assetIndex?.byRunId?.get(String(next.runId).toLowerCase());
      if (byRun?.length) {
        const ordered = expectedHash ? byRun : [byRun[Math.max(0, Number(next.index || 1) - 1)] || byRun[0]];
        candidates.push(...ordered.map((filePath) => ({ path: filePath, source: "run" })));
      }
      const looseRun = assetIndex?.files?.filter((filePath) => path.basename(filePath).toLowerCase().includes(String(next.runId).toLowerCase()));
      if (looseRun?.length) {
        const ordered = expectedHash ? looseRun : [looseRun[Math.max(0, Number(next.index || 1) - 1)] || looseRun[0]];
        candidates.push(...ordered.map((filePath) => ({ path: filePath, source: "run" })));
      }
    }

    const recordedControlledPath = typeof next.path === "string" ? controlledProjectAssetFile(next.path, projectPath) : "";
    const seenCandidates = new Set();
    const found = candidates.map((candidate) => {
      const controlled = controlledProjectAssetFile(candidate.path, projectPath);
      if (!controlled) return "";
      const key = comparablePath(controlled);
      if (seenCandidates.has(key)) return "";
      seenCandidates.add(key);
      const needsHashVerification = Boolean(
        expectedHash && (
          candidate.source === "name" || candidate.source === "run" ||
          !recordedControlledPath || comparablePath(recordedControlledPath) !== key
        )
      );
      if (needsHashVerification) {
        try {
          const actualHash = createHash("sha256").update(boundedImageRead(controlled, maxExportImageBytes, path.basename(controlled), "项目图片")).digest("hex");
          if (actualHash !== expectedHash) return "";
        } catch {
          return "";
        }
      }
      return controlled;
    }).find(Boolean);
    if (found) {
      next.type = "file";
      next.path = found;
      next.relativePath = projectRelativePath(projectPath, found);
      next.fileName = path.basename(found);
      next.assetUrl = assetUrlFor(found);
      return next;
    }
    const recordedUrl = controlledRecordedAssetUrl(next);
    if (recordedUrl) {
      next.type = "url";
      if (/^https?:\/\//i.test(recordedUrl)) next.url = recordedUrl;
      else next.assetUrl = recordedUrl;
      return next;
    }
    return null;
  }

  function hydrateVideoAssetForProject(asset, project) {
    if (!asset || typeof asset !== "object") return null;
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const next = { ...asset };
    const candidates = [];
    if (typeof next.relativePath === "string") candidates.push(resolveProjectRelativePath(projectPath, next.relativePath));
    if (typeof next.path === "string") candidates.push(path.resolve(next.path));
    for (const value of [next.assetUrl, next.url]) {
      const decodedPath = assetPathFromUrl(value);
      if (decodedPath) candidates.push(decodedPath);
    }
    const found = candidates.map((candidate) => controlledProjectAssetFile(candidate, projectPath)).find(Boolean);
    if (found) {
      const extension = path.extname(found).toLowerCase();
      if (![".mp4", ".m4v", ".webm", ".mov"].includes(extension)) return null;
      next.type = "file";
      next.path = found;
      next.relativePath = projectRelativePath(projectPath, found);
      next.assetUrl = assetUrlFor(found);
      next.originalName = String(next.originalName || path.basename(found)).slice(0, 260);
      next.mimeType = extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
      delete next.url;
      return next;
    }
    const remoteUrl = [next.url, next.assetUrl]
      .map((value) => typeof value === "string" ? value.trim() : "")
      .find((value) => /^https?:\/\//i.test(value));
    if (!remoteUrl) return null;
    next.type = "url";
    next.url = remoteUrl;
    delete next.path;
    delete next.relativePath;
    delete next.assetUrl;
    return next;
  }

  function recoverNodeAssets(node, project, assetIndex) {
    const assets = Array.isArray(node.assets)
      ? node.assets.map((asset) => hydrateAssetForProject(asset, project, assetIndex)).filter(Boolean)
      : [];
    if (assets.length > 0 || node.type !== "image") return assets;
    const runId = typeof node.generationRunId === "string" ? node.generationRunId.toLowerCase() : "";
    const byRun = runId ? assetIndex.byRunId.get(runId) : null;
    const looseRun = runId ? assetIndex.files.filter((filePath) => path.basename(filePath).toLowerCase().includes(runId)) : [];
    const files = byRun?.length
      ? byRun
      : looseRun.length
        ? looseRun
        : assetIndex.files.filter((filePath) => path.basename(filePath).toLowerCase().includes(String(node.id || "").toLowerCase()));
    return files.slice(0, Math.max(1, Number(node.outputs || 1))).map((filePath, index) => ({
      index: index + 1,
      type: "file",
      path: filePath,
      relativePath: projectRelativePath(project.path, filePath),
      fileName: path.basename(filePath),
      assetUrl: assetUrlFor(filePath),
      runId: node.generationRunId || ""
    }));
  }

  function mapMessageAssetReferences(messages, mapper) {
    return (Array.isArray(messages) ? messages : []).map((message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...message,
        attachments: {
          ...message.attachments,
          sourceAssets: (Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets : []).map(mapper).filter(Boolean),
          referenceAssets: (Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets : []).map(mapper).filter(Boolean)
        }
      };
    });
  }

  function mapNestedNodeAssetReferences(node, mapper) {
    return {
      ...node,
      imageParams: node.imageParams ? {
        ...node.imageParams,
        referenceImages: (Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages : []).map(mapper).filter(Boolean)
      } : node.imageParams,
      layerGroup: node.layerGroup ? {
        ...node.layerGroup,
        previewAsset: node.layerGroup.previewAsset ? mapper(node.layerGroup.previewAsset) || undefined : undefined,
        mergedAsset: node.layerGroup.mergedAsset ? mapper(node.layerGroup.mergedAsset) || undefined : undefined
      } : node.layerGroup,
      layerComposition: node.layerComposition ? {
        ...node.layerComposition,
        previewAsset: node.layerComposition.previewAsset ? mapper(node.layerComposition.previewAsset) || undefined : undefined,
        mergedAsset: node.layerComposition.mergedAsset ? mapper(node.layerComposition.mergedAsset) || undefined : undefined,
        layers: (Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers : []).map((layer) => ({
          ...layer,
          asset: layer?.asset ? mapper(layer.asset) || undefined : undefined
        }))
      } : node.layerComposition
    };
  }

  function nestedSessionAssetReferences(session) {
    const references = [];
    for (const node of Array.isArray(session?.nodes) ? session.nodes : []) {
      references.push(...(Array.isArray(node?.imageParams?.referenceImages) ? node.imageParams.referenceImages : []));
      if (node?.layerGroup?.previewAsset) references.push(node.layerGroup.previewAsset);
      if (node?.layerGroup?.mergedAsset) references.push(node.layerGroup.mergedAsset);
      if (node?.layerComposition?.previewAsset) references.push(node.layerComposition.previewAsset);
      if (node?.layerComposition?.mergedAsset) references.push(node.layerComposition.mergedAsset);
      for (const layer of Array.isArray(node?.layerComposition?.layers) ? node.layerComposition.layers : []) {
        if (layer?.asset) references.push(layer.asset);
      }
    }
    const messages = [
      ...(Array.isArray(session?.messages) ? session.messages : []),
      ...(Array.isArray(session?.conversations) ? session.conversations.flatMap((conversation) => Array.isArray(conversation?.messages) ? conversation.messages : []) : [])
    ];
    for (const message of messages) {
      references.push(...(Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : []));
      references.push(...(Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : []));
    }
    return references.filter((reference) => reference && typeof reference === "object");
  }

  function hydrateProjectSession(session, project, options) {
    const source = sanitizeSession(session, { expectedProjectId: project?.id });
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const normalizedProject = { ...project, path: projectPath };
    const validatedNodes = source.nodes.map((node) => {
      if (node.type === "video") {
        const videoAsset = hydrateVideoAssetForProject(node.videoAsset, normalizedProject);
        return { node, recordedAssets: [], assets: [], videoAsset, needsRecovery: false };
      }
      const recordedAssets = Array.isArray(node.assets) ? node.assets : [];
      const assets = recordedAssets.map((asset) => hydrateAssetForProject(asset, normalizedProject, null));
      const missingRecordedAssets = assets.some((asset) => !asset);
      const missingExpectedAssets = node.type === "image" && recordedAssets.length === 0 && (
        Number(node.outputs || 0) > 0 || node.imageState === "done" || node.status === "done"
      );
      return { node, recordedAssets, assets, needsRecovery: missingRecordedAssets || missingExpectedAssets };
    });
    const nestedReferences = nestedSessionAssetReferences(source);
    const nestedMissingCount = nestedReferences.filter((reference) => !hydrateAssetForProject(reference, normalizedProject, null)).length;
    const needsRecovery = validatedNodes.some((item) => item.needsRecovery) || nestedMissingCount > 0;
    const assetIndex = needsRecovery
      ? (typeof options.buildAssetIndex === "function" ? options.buildAssetIndex(projectPath) : buildProjectAssetIndex(projectPath))
      : null;
    options.onAssetIndex?.({ projectPath, scanned: Boolean(assetIndex), missingNodeCount: validatedNodes.filter((item) => item.needsRecovery).length + nestedMissingCount });
    const hydrateReference = (reference) => hydrateAssetForProject(reference, normalizedProject, assetIndex);
    const nodes = validatedNodes.map(({ node, recordedAssets, assets: validatedAssets, videoAsset, needsRecovery: nodeNeedsRecovery }) => {
      if (node.type === "video") {
        const ready = Boolean(videoAsset);
        return {
          ...node,
          assets: undefined,
          videoAsset: videoAsset || undefined,
          videoState: ready ? "ready" : node.videoAsset ? "error" : node.videoState,
          videoError: ready ? undefined : node.videoAsset ? "项目视频文件不存在或不在受管目录中。" : node.videoError,
          status: ready ? "done" : node.status,
          outputs: ready ? 1 : 0
        };
      }
      let assets = validatedAssets.filter(Boolean);
      if (nodeNeedsRecovery && assetIndex) {
        if (recordedAssets.length > 0) {
          assets = recordedAssets
            .map((asset, index) => validatedAssets[index] || hydrateAssetForProject(asset, normalizedProject, assetIndex))
            .filter(Boolean);
        } else {
          assets = recoverNodeAssets({ ...node, assets: [] }, normalizedProject, assetIndex);
        }
      }
      if (node.type !== "image") return mapNestedNodeAssetReferences({ ...node, assets }, hydrateReference);
      const done = assets.length > 0;
      return mapNestedNodeAssetReferences({
        ...node,
        assets,
        imageState: done ? "done" : node.imageState,
        status: done ? "done" : node.status,
        outputs: Math.max(Number(node.outputs || 0), assets.length)
      }, hydrateReference);
    });
    const messages = mapMessageAssetReferences(source.messages, hydrateReference);
    const conversations = Array.isArray(source.conversations)
      ? source.conversations.map((conversation) => ({
          ...conversation,
          messages: mapMessageAssetReferences(conversation.messages, hydrateReference)
        }))
      : [];
    return sanitizeSession({ ...source, nodes, messages, conversations });
  }

  function sessionWithProjectAssets(session, project, options = {}) {
    return withAssetValidation(() => hydrateProjectSession(session, project, options));
  }

  function assetForProjectSave(asset, projectPath) {
    if (!asset || typeof asset !== "object") return asset;
    const next = { ...asset };
    const controlledCurrent = typeof next.path === "string" ? controlledProjectAssetFile(next.path, projectPath) : "";
    const safeRelativeTarget = typeof next.relativePath === "string" ? resolveProjectRelativePath(projectPath, next.relativePath) : "";
    const controlledRelative = safeRelativeTarget ? controlledProjectAssetFile(safeRelativeTarget, projectPath) : "";
    const resolved = controlledCurrent || controlledRelative;
    if (resolved) {
      next.path = resolved;
      next.relativePath = projectRelativePath(projectPath, resolved);
      next.fileName = path.basename(resolved);
      next.assetUrl = assetUrlFor(resolved);
    } else {
      if (typeof next.path === "string" && next.path.trim()) next.path = path.resolve(next.path);
      if (safeRelativeTarget) next.relativePath = projectRelativePath(projectPath, safeRelativeTarget);
      else delete next.relativePath;
      if (typeof next.assetUrl === "string" && /^(?:naimage|iiimage)-asset:/i.test(next.assetUrl)) delete next.assetUrl;
    }
    if (typeof next.url === "string" && /^(?:naimage|iiimage)-asset:/i.test(next.url)) delete next.url;
    return next;
  }

  function videoAssetForProjectSave(asset, projectPath) {
    if (!asset || typeof asset !== "object") return undefined;
    const next = { ...asset };
    const controlledCurrent = typeof next.path === "string" ? controlledProjectAssetFile(next.path, projectPath) : "";
    const safeRelativeTarget = typeof next.relativePath === "string" ? resolveProjectRelativePath(projectPath, next.relativePath) : "";
    const controlledRelative = safeRelativeTarget ? controlledProjectAssetFile(safeRelativeTarget, projectPath) : "";
    const resolved = controlledCurrent || controlledRelative;
    if (resolved) {
      next.type = "file";
      next.relativePath = projectRelativePath(projectPath, resolved);
      next.originalName = String(next.originalName || path.basename(resolved)).slice(0, 260);
      delete next.path;
      delete next.assetUrl;
      delete next.url;
      return next;
    }
    const remoteUrl = [next.url, next.assetUrl]
      .map((value) => typeof value === "string" ? value.trim() : "")
      .find((value) => /^https?:\/\//i.test(value));
    delete next.path;
    delete next.relativePath;
    delete next.assetUrl;
    if (remoteUrl) {
      next.type = "url";
      next.url = remoteUrl;
      return next;
    }
    delete next.url;
    return undefined;
  }

  function serializeProjectSession(session, project) {
    const source = sanitizeSession(session, { expectedProjectId: project?.id });
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const normalizeAsset = (asset) => assetForProjectSave(asset, projectPath);
    return {
      ...source,
      nodes: source.nodes.map((node) => mapNestedNodeAssetReferences({
        ...node,
        assets: node.type === "video" ? undefined : Array.isArray(node.assets) ? node.assets.map(normalizeAsset).filter(Boolean) : [],
        videoAsset: node.type === "video" ? videoAssetForProjectSave(node.videoAsset, projectPath) : undefined
      }, normalizeAsset)),
      messages: mapMessageAssetReferences(source.messages, normalizeAsset),
      conversations: Array.isArray(source.conversations)
        ? source.conversations.map((conversation) => ({
            ...conversation,
            messages: mapMessageAssetReferences(conversation.messages, normalizeAsset)
          }))
        : []
    };
  }

  function sessionForProjectSave(session, project) {
    return withAssetValidation(() => serializeProjectSession(session, project));
  }

  return {
    owner: PROJECT_ASSET_REPOSITORY_OWNER,
    assetForProjectSave,
    buildProjectAssetIndex,
    collectAssetFiles,
    controlledProjectAssetFile,
    createProjectAssetFileValidator,
    controlledRecordedAssetUrl,
    hydrateAssetForProject,
    hydrateVideoAssetForProject,
    mapMessageAssetReferences,
    mapNestedNodeAssetReferences,
    nestedSessionAssetReferences,
    registerImportedMaterials,
    resolveRegisteredMaterial,
    projectAssetRoots,
    projectWritableAssetRoots,
    recoverNodeAssets,
    sessionForProjectSave,
    sessionWithProjectAssets,
    videoAssetForProjectSave
  };
}

module.exports = {
  createProjectAssetRepository,
  PROJECT_ASSET_REPOSITORY_OWNER
};
