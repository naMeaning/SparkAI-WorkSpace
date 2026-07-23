"use strict";

const { createHash } = require("node:crypto");

function safeImageSourceRelativePath(value, maximum = 1000) {
  const source = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (!source || source.startsWith("/") || /^[a-z]:/i.test(source) || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (source.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return source.slice(0, maximum);
}

function persistedNodeSequenceFromCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (/^[A-Z]$/.test(code)) return code.charCodeAt(0) - 64;
  const numbered = code.match(/^N(\d+)$/);
  return numbered ? Math.max(0, Number(numbered[1]) || 0) : 0;
}

function sessionAssetContentHash(asset) {
  const source = asset && typeof asset === "object" ? asset : {};
  const value = String(source.contentHash || source.sha256 || "").trim().toLowerCase();
  return /^[a-f0-9]{32,128}$/.test(value) ? value : "";
}

function sessionAssetOccurrenceId(asset, ownerId = "asset", assetIndex = 0) {
  const source = asset && typeof asset === "object" ? asset : {};
  const existing = String(source.occurrenceId || "").trim().toLowerCase();
  if (/^occ-[a-f0-9]{16,64}$/.test(existing)) return existing;
  const importBatchId = String(source.importBatchId || "").trim();
  const importRootId = String(source.importRootId || "").trim();
  const sourceRelativePath = safeImageSourceRelativePath(source.sourceRelativePath).toLowerCase();
  const runId = String(source.runId || "").trim().toLowerCase();
  const assetId = String(source.assetId || `asset-${sessionAssetFingerprint(source, assetIndex + 1, ownerId, assetIndex)}`).trim();
  const identity = importBatchId && importRootId && sourceRelativePath
    ? `import:${importBatchId}|root:${importRootId}|source:${sourceRelativePath}`
    : runId
      ? `run:${runId}|slot:${Math.max(0, Math.floor(Number(assetIndex) || 0))}|asset:${assetId}`
    : `owner:${ownerId}|asset:${assetId}`;
  return `occ-${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function sessionAssetIdentityLocators(asset) {
  const source = asset && typeof asset === "object" ? asset : {};
  const relativePath = String(source.relativePath || "").trim().replace(/\\/g, "/").toLowerCase();
  const localPath = String(source.path || "").trim().replace(/\\/g, "/").toLowerCase();
  const assetUrl = String(source.assetUrl || "").trim();
  const url = String(source.url || "").trim();
  const stableAssetUrl = /^(?:data|blob):/i.test(assetUrl) ? "" : assetUrl;
  const stableUrl = /^(?:data|blob):/i.test(url) ? "" : url;
  return [...new Set([
    relativePath ? `relative-path:${relativePath}` : "",
    localPath ? `path:${localPath}` : "",
    stableAssetUrl ? `asset-url:${stableAssetUrl}` : "",
    stableUrl ? `url:${stableUrl}` : ""
  ].filter(Boolean))];
}

function sessionAssetFingerprint(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
  const source = asset && typeof asset === "object" ? asset : {};
  const contentHash = sessionAssetContentHash(source);
  const locators = sessionAssetIdentityLocators(source);
  const bridgedHashes = new Set();
  if (!contentHash && contentHashesByLocator) {
    for (const locator of locators) {
      const hashes = contentHashesByLocator.get(locator);
      if (hashes?.size === 1) bridgedHashes.add([...hashes][0]);
    }
  }
  const effectiveContentHash = contentHash || (bridgedHashes.size === 1 ? [...bridgedHashes][0] : "");
  const runId = String(source.runId || "").trim();
  const originalName = String(source.originalName || source.fileName || source.name || "").trim().toLowerCase();
  const index = Math.max(1, Number(source.index || fallbackIndex) || 1);
  let identity = effectiveContentHash
    ? `content:${effectiveContentHash}`
    : locators.length
      ? locators[0]
        : runId
          ? `run:${runId}|index:${index}`
          : originalName
            ? `name:${originalName}|index:${index}`
            : `index:${index}`;
  if (!effectiveContentHash && locators.length === 0 && !runId) {
    identity = `${identity}|owner:${String(ownerId || "")}|slot:${Math.max(0, Number(slot) || 0)}`;
  }
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function sessionAssetAliasFingerprints(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
  const primary = sessionAssetFingerprint(asset, fallbackIndex, ownerId, slot, contentHashesByLocator);
  const contentHash = sessionAssetContentHash(asset);
  const locators = sessionAssetIdentityLocators(asset);
  const bridgedHashes = new Set();
  if (!contentHash && contentHashesByLocator) {
    for (const locator of locators) {
      const hashes = contentHashesByLocator.get(locator);
      if (hashes?.size === 1) bridgedHashes.add([...hashes][0]);
    }
  }
  if (contentHash || bridgedHashes.size === 1 || locators.length === 0) return [primary];
  return [...new Set([primary, ...locators.map((locator) => createHash("sha256").update(locator).digest("hex").slice(0, 32))])];
}

function repairSessionAssetIdentities(nodes) {
  const records = [];
  const pinCollectionAssetSlots = (collection, assets) => {
    if (!collection || typeof collection !== "object" || !Array.isArray(collection.items)) return collection;
    return {
      ...collection,
      items: collection.items.map((item, itemIndex) => {
        if (!item || typeof item !== "object" || item.status === "pending" || item.status === "error") return item;
        const explicit = Number(item.assetIndex);
        if (Number.isInteger(explicit) && explicit >= 1 && explicit <= assets.length) return item;
        const assetId = String(item.assetId || "").trim();
        const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(item.occurrenceId || "").trim())
          ? String(item.occurrenceId).trim().toLowerCase()
          : "";
        const requestIndex = Math.max(1, Math.floor(Number(item.requestIndex || itemIndex + 1) || itemIndex + 1));
        const occurrenceIndex = occurrenceId
          ? assets.findIndex((asset) => asset?.occurrenceId === occurrenceId)
          : -1;
        const matchingIdIndexes = assetId
          ? assets.map((asset, index) => String(asset?.assetId || "").trim() === assetId ? index : -1).filter((index) => index >= 0)
          : [];
        const matchedIndex = occurrenceIndex >= 0
          ? occurrenceIndex
          : matchingIdIndexes.length === 1
            ? matchingIdIndexes[0]
          : matchingIdIndexes.find((index) => Number(assets[index]?.index) === requestIndex) ??
            assets.findIndex((asset) => Number(asset?.index) === requestIndex);
        return matchedIndex >= 0 ? {
          ...item,
          assetIndex: matchedIndex + 1,
          occurrenceId: sessionAssetOccurrenceId(assets[matchedIndex], "image-collection", matchedIndex)
        } : item;
      })
    };
  };
  const register = (asset, nodeId, slot, apply, ownerId = nodeId) => {
    if (!asset || typeof asset !== "object") return asset;
    const next = { ...asset };
    delete next.inputRoot;
    delete next.sourcePath;
    if (typeof next.importBatchId === "string") next.importBatchId = next.importBatchId.trim().slice(0, 160) || undefined;
    if (typeof next.importRootId === "string") next.importRootId = next.importRootId.trim().slice(0, 80) || undefined;
    if (typeof next.sourceRootLabel === "string") next.sourceRootLabel = next.sourceRootLabel.trim().slice(0, 260) || undefined;
    if (next.sourceRootKind !== "directory" && next.sourceRootKind !== "file") delete next.sourceRootKind;
    if (typeof next.sourceRelativePath === "string") {
      next.sourceRelativePath = safeImageSourceRelativePath(next.sourceRelativePath) || undefined;
    }
    next.occurrenceId = sessionAssetOccurrenceId(next, ownerId, slot);
    apply(next);
    records.push({
      asset: next,
      nodeId,
      ownerId,
      slot,
      oldId: String(next.assetId || "").trim(),
      displayCode: String(next.displayCode || "").trim()
    });
    return next;
  };
  for (const node of nodes) {
    const rawAssets = Array.isArray(node.assets) ? node.assets : [];
    if (node.imageCollection) node.imageCollection = pinCollectionAssetSlots(node.imageCollection, rawAssets);
    if (node.imageContainerSpec?.collection) {
      node.imageContainerSpec = {
        ...node.imageContainerSpec,
        collection: pinCollectionAssetSlots(node.imageContainerSpec.collection, rawAssets)
      };
    }
    node.assets = (Array.isArray(node.assets) ? node.assets : []).map((asset, index) => register(asset, node.id, index, () => undefined));
    if (node.imageParams && Array.isArray(node.imageParams.referenceImages)) {
      node.imageParams = { ...node.imageParams, referenceImages: node.imageParams.referenceImages.map((asset, index) => register(asset, node.id, index, () => undefined, `${node.id}:imageParams`)) };
    }
    if (node.layerGroup) {
      node.layerGroup = { ...node.layerGroup };
      if (node.layerGroup.previewAsset) node.layerGroup.previewAsset = register(node.layerGroup.previewAsset, node.id, 0, () => undefined, `${node.id}:group-preview`);
      if (node.layerGroup.mergedAsset) node.layerGroup.mergedAsset = register(node.layerGroup.mergedAsset, node.id, 0, () => undefined, `${node.id}:group-merged`);
    }
    if (node.layerComposition) {
      node.layerComposition = { ...node.layerComposition };
      if (node.layerComposition.previewAsset) node.layerComposition.previewAsset = register(node.layerComposition.previewAsset, node.id, 0, () => undefined, `${node.id}:layer-preview`);
      if (node.layerComposition.mergedAsset) node.layerComposition.mergedAsset = register(node.layerComposition.mergedAsset, node.id, 0, () => undefined, `${node.id}:layer-merged`);
      if (Array.isArray(node.layerComposition.layers)) {
        node.layerComposition.layers = node.layerComposition.layers.map((layer, index) => ({
          ...layer,
          asset: layer?.asset ? register(layer.asset, node.id, index, () => undefined, `${node.id}:layer:${layer.id || index}`) : layer?.asset
        }));
      }
    }
  }
  const contentHashesByLocator = new Map();
  for (const record of records) {
    const contentHash = sessionAssetContentHash(record.asset);
    if (!contentHash) continue;
    for (const locator of sessionAssetIdentityLocators(record.asset)) {
      const hashes = contentHashesByLocator.get(locator) || new Set();
      hashes.add(contentHash);
      contentHashesByLocator.set(locator, hashes);
    }
  }
  for (const record of records) {
    record.fingerprint = sessionAssetFingerprint(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
    record.aliasFingerprints = sessionAssetAliasFingerprints(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
  }
  const recordsByOldId = new Map();
  const assigned = new Map();
  const canonicalByFingerprint = new Map();
  const canonicalReferenceByFingerprint = new Map();
  const allocations = new Map();
  const allocate = (record, preferred) => {
    let candidate = preferred;
    let salt = 0;
    while (assigned.has(candidate) && assigned.get(candidate) !== record.fingerprint) {
      candidate = `asset-${createHash("sha256").update(`${record.fingerprint}|${record.ownerId}|${record.slot}|${salt++}`).digest("hex").slice(0, 32)}`;
    }
    assigned.set(candidate, record.fingerprint);
    return candidate;
  };
  for (const record of records) {
    const oldId = record.oldId || `asset-${record.fingerprint}`;
    record.oldId = oldId;
    const sameOldId = recordsByOldId.get(oldId) || [];
    sameOldId.push(record);
    recordsByOldId.set(oldId, sameOldId);
    let assetId = record.aliasFingerprints.map((fingerprint) => canonicalByFingerprint.get(fingerprint)).find(Boolean);
    if (!assetId) {
      assetId = assigned.has(oldId) && assigned.get(oldId) !== record.fingerprint
        ? allocate(record, `asset-${record.fingerprint}`)
        : oldId;
      assigned.set(assetId, record.fingerprint);
    }
    record.aliasFingerprints.forEach((fingerprint) => canonicalByFingerprint.set(fingerprint, assetId));
    allocations.set(`${oldId}\n${record.fingerprint}`, assetId);
    record.asset.assetId = assetId;
  }
  const resolve = (reference, fallbackIndex = 1) => {
    if (!reference || typeof reference !== "object") return reference;
    const oldId = String(reference.assetId || "").trim();
    const nodeId = String(reference.nodeId || "").trim();
    const assetIndex = Number(reference.assetIndex);
    const fingerprint = sessionAssetFingerprint(
      reference,
      fallbackIndex,
      nodeId,
      Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1),
      contentHashesByLocator
    );
    const aliasFingerprints = sessionAssetAliasFingerprints(
      reference,
      fallbackIndex,
      nodeId,
      Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1),
      contentHashesByLocator
    );
    const canonical = aliasFingerprints.map((alias) => canonicalByFingerprint.get(alias)).find(Boolean);
    if (canonical) return { ...reference, assetId: canonical };
    const exact = oldId ? allocations.get(`${oldId}\n${fingerprint}`) : "";
    if (exact) return { ...reference, assetId: exact };
    const candidates = oldId ? recordsByOldId.get(oldId) || [] : [];
    const matched = candidates.find((record) => nodeId && record.nodeId === nodeId && Number.isInteger(assetIndex) && record.slot === assetIndex) ||
      candidates.find((record) => reference.displayCode && record.displayCode === reference.displayCode) ||
      (candidates.length === 1 ? candidates[0] : null);
    if (matched) return { ...reference, assetId: matched.asset.assetId };
    const knownReferenceId = aliasFingerprints.map((alias) => canonicalReferenceByFingerprint.get(alias)).find(Boolean);
    if (knownReferenceId) return { ...reference, assetId: knownReferenceId };
    let unresolvedId = candidates.length > 1 || !oldId ? `asset-${fingerprint}` : oldId;
    if (assigned.has(unresolvedId) && assigned.get(unresolvedId) !== fingerprint) unresolvedId = `asset-${fingerprint}`;
    assigned.set(unresolvedId, fingerprint);
    aliasFingerprints.forEach((alias) => canonicalReferenceByFingerprint.set(alias, unresolvedId));
    return { ...reference, assetId: unresolvedId };
  };
  return { resolve };
}

function repairSessionMessageAssetIds(messages, resolve) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((asset, index) => resolve(asset, index + 1)) : [],
        referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((asset, index) => resolve(asset, index + 1)) : []
      }
    };
  });
}

function sanitizePersistedCanvasRequirement(value, fallbackText = "") {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" && value.text.trim()
    ? value.text.trim().slice(0, 24_000)
    : typeof fallbackText === "string" && fallbackText.trim()
      ? fallbackText.trim().slice(0, 24_000)
      : "";
  if (!text) return null;
  const createdFrom = value.createdFrom === "container" || value.createdFrom === "layer" ? value.createdFrom : "node";
  const requirement = {
    version: 1,
    text,
    revision: Math.max(1, Math.floor(Number(value.revision || 1))),
    createdFrom,
  };
  if (typeof value.lastSourceSignature === "string" && value.lastSourceSignature.trim()) {
    requirement.lastSourceSignature = value.lastSourceSignature.trim().slice(0, 160);
  }
  if (typeof value.lastRunAt === "string" && value.lastRunAt.trim()) {
    requirement.lastRunAt = value.lastRunAt.trim().slice(0, 80);
  }
  const lastRunCount = Math.max(0, Math.floor(Number(value.lastRunCount || 0)));
  if (lastRunCount > 0) requirement.lastRunCount = lastRunCount;
  if (typeof value.lastError === "string" && value.lastError.trim()) {
    requirement.lastError = value.lastError.trim().slice(0, 500);
  }
  return requirement;
}

function sanitizePersistedImageTaskProvenance(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const snapshotHash = String(value.taskScopeSnapshotHash || "").trim().toLowerCase();
  const resultPolicies = new Set(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
  if (!/^scope-[a-f0-9]{32}$/.test(snapshotHash) || !resultPolicies.has(value.resultPolicy)) return null;
  const clean = (input, maximum) => typeof input === "string" && input.trim() ? input.trim().slice(0, maximum) : undefined;
  const revision = Number(value.requirementRevision);
  return {
    version: 1,
    taskScopeSnapshotHash: snapshotHash,
    resultPolicy: value.resultPolicy,
    ...(clean(value.sourceBindingId, 520) ? { sourceBindingId: clean(value.sourceBindingId, 520) } : {}),
    ...(clean(value.sourceAssetId, 160) ? { sourceAssetId: clean(value.sourceAssetId, 160) } : {}),
    ...(clean(value.sourceOccurrenceId, 80) ? { sourceOccurrenceId: clean(value.sourceOccurrenceId, 80) } : {}),
    ...(clean(value.sourceNodeId, 160) ? { sourceNodeId: clean(value.sourceNodeId, 160) } : {}),
    ...(clean(value.sourceContainerId, 160) ? { sourceContainerId: clean(value.sourceContainerId, 160) } : {}),
    ...(clean(value.sourceDisplayCode, 40) ? { sourceDisplayCode: clean(value.sourceDisplayCode, 40) } : {}),
    ...(clean(value.requirementNodeId, 160) ? { requirementNodeId: clean(value.requirementNodeId, 160) } : {}),
    ...(Number.isInteger(revision) && revision >= 1 ? { requirementRevision: Math.floor(revision) } : {})
  };
}

function sanitizePersistedImageCollection(value, assets = []) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const items = (Array.isArray(source.items) ? source.items : []).slice(0, 10).map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
    const rawAssetIndex = Number(candidate.assetIndex);
      const candidateAssetId = typeof candidate.assetId === "string" && candidate.assetId.trim()
        ? candidate.assetId.trim().slice(0, 160)
        : "";
    const candidateOccurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(candidate.occurrenceId || "").trim())
      ? String(candidate.occurrenceId).trim().toLowerCase()
      : "";
    const explicitAssetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 1 && rawAssetIndex <= Math.min(10, assets.length)
      ? rawAssetIndex
      : undefined;
    const occurrenceIndex = explicitAssetIndex === undefined && candidateOccurrenceId
      ? assets.findIndex((asset) => asset?.occurrenceId === candidateOccurrenceId)
      : -1;
    const matchingAssetIdIndexes = explicitAssetIndex === undefined && occurrenceIndex < 0 && candidateAssetId
      ? assets.map((asset, assetIndex) => asset?.assetId === candidateAssetId ? assetIndex : -1).filter((assetIndex) => assetIndex >= 0)
      : [];
    const assetIdIndex = matchingAssetIdIndexes.length === 1
      ? matchingAssetIdIndexes[0]
      : -1;
    const legacyAssetIndex = explicitAssetIndex === undefined && occurrenceIndex < 0 && assetIdIndex < 0 && requestedStatus === "done" &&
      candidate.assetIndex === undefined && !candidateAssetId && Boolean(assets[index])
      ? index + 1
      : undefined;
    const assetIndex = requestedStatus === "done"
      ? explicitAssetIndex ?? (occurrenceIndex >= 0 ? occurrenceIndex + 1 : assetIdIndex >= 0 ? assetIdIndex + 1 : legacyAssetIndex)
      : undefined;
    const asset = assetIndex === undefined ? null : assets[assetIndex - 1];
    const status = requestedStatus === "done" && !asset ? "error" : requestedStatus;
    return {
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 120) : `item-${index + 1}`,
      requestIndex: Math.max(1, Math.min(10, Math.floor(Number(candidate.requestIndex || index + 1) || index + 1))),
      ...(assetIndex === undefined ? {} : { assetIndex }),
      ...(status === "done" && asset?.assetId ? { assetId: asset.assetId } : {}),
      ...(status === "done" && asset ? { occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", (assetIndex || 1) - 1) } : {}),
      prompt: typeof candidate.prompt === "string" && candidate.prompt.trim()
        ? candidate.prompt.trim().slice(0, 12_000)
        : String(asset?.prompt || asset?.revisedPrompt || "").slice(0, 12_000),
      ...(typeof candidate.title === "string" && candidate.title.trim() ? { title: candidate.title.trim().slice(0, 160) } : {}),
      status,
      ...(typeof candidate.error === "string" && candidate.error.trim()
        ? { error: candidate.error.trim().slice(0, 320) }
        : requestedStatus === "done" && !asset ? { error: "图片槽位缺少对应成果。" } : {})
    };
  });
  if (!items.length && !assets.length) return null;
  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : "image-collection",
    kind: source.kind === "series" ? "series" : "batch",
    generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
    items: items.length ? items : assets.slice(0, 10).map((asset, index) => ({
      id: `item-${index + 1}`,
      requestIndex: index + 1,
      assetIndex: index + 1,
      assetId: asset.assetId,
      occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", index),
      prompt: String(asset.prompt || asset.revisedPrompt || "").slice(0, 12_000),
      ...(asset.title ? { title: String(asset.title).slice(0, 160) } : {}),
      status: "done"
    })),
    ...(typeof source.sourceNodeId === "string" && source.sourceNodeId.trim() ? { sourceNodeId: source.sourceNodeId.trim().slice(0, 160) } : {}),
    ...(typeof source.createdAt === "string" && source.createdAt.trim() ? { createdAt: source.createdAt.trim().slice(0, 80) } : {}),
    autoFit: source.autoFit !== false
  };
}

function sanitizePersistedImageContainerSpec(value, node, fallbackCollection = null) {
  if (!value || typeof value !== "object") return null;
  const kinds = new Set(["manual", "folder", "batch-result", "container-group"]);
  if (!kinds.has(value.kind)) return null;
  const uniqueIds = (items) => [...new Set((Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" ? item.trim().slice(0, 160) : "")
    .filter((id) => id && id !== node.id))];
  const seenBindingIds = new Set();
  const memberBindings = (Array.isArray(value.memberBindings) ? value.memberBindings : []).slice(0, 2000).flatMap((binding, index) => {
    if (!binding || typeof binding !== "object") return [];
    const assetId = typeof binding.assetId === "string" ? binding.assetId.trim().slice(0, 160) : "";
    const ownerNodeId = typeof binding.nodeId === "string" && binding.nodeId.trim() ? binding.nodeId.trim().slice(0, 160) : node.id;
    const containerNodeId = typeof binding.containerNodeId === "string" && binding.containerNodeId.trim() ? binding.containerNodeId.trim().slice(0, 160) : node.id;
    if (!assetId) return [];
    const assetIndex = Math.max(0, Math.floor(Number(binding.assetIndex ?? index) || 0));
    const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(binding.occurrenceId || "").trim())
      ? String(binding.occurrenceId).trim().toLowerCase()
      : undefined;
    const requestedBindingId = typeof binding.bindingId === "string" && binding.bindingId.trim()
      ? binding.bindingId.trim().slice(0, 520)
      : "";
    const bindingSeed = occurrenceId || `${assetId}:${assetIndex}`;
    let bindingId = requestedBindingId && !seenBindingIds.has(requestedBindingId)
      ? requestedBindingId
      : `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}`;
    let suffix = 1;
    while (seenBindingIds.has(bindingId)) bindingId = `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}:${suffix++}`;
    seenBindingIds.add(bindingId);
    return [{
      bindingId,
      assetId,
      ...(occurrenceId ? { occurrenceId } : {}),
      nodeId: ownerNodeId,
      containerNodeId,
      assetIndex,
      ...(binding.role === "source" || binding.role === "reference" ? { role: binding.role } : {})
    }];
  });
  const collection = sanitizePersistedImageCollection(value.collection, node.assets) || fallbackCollection;
  return {
    version: 1,
    kind: value.kind,
    memberNodeIds: uniqueIds(value.memberNodeIds),
    childContainerNodeIds: uniqueIds(value.childContainerNodeIds),
    memberBindings,
    ...(value.hostContentKind === "manual" || value.hostContentKind === "folder" || value.hostContentKind === "batch-result" ? { hostContentKind: value.hostContentKind } : {}),
    ...(typeof value.sourceLabel === "string" && value.sourceLabel.trim() ? { sourceLabel: value.sourceLabel.trim().slice(0, 260) } : {}),
    ...(typeof value.importBatchId === "string" && value.importBatchId.trim() ? { importBatchId: value.importBatchId.trim().slice(0, 160) } : {}),
    ...(typeof value.layoutId === "string" && value.layoutId.trim() ? { layoutId: value.layoutId.trim().slice(0, 160) } : {}),
    layoutOrigin: value.layoutOrigin === "auto" || value.layoutOrigin === "generation" ? value.layoutOrigin : "manual",
    autoFit: value.autoFit !== false,
    ...(collection ? { collection } : {})
  };
}

function repairPersistedImageContainerSpecs(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const eligible = (id) => {
    const node = nodeById.get(id);
    return Boolean(node && node.type === "image" && !node.layerGroup);
  };
  const isContainer = (node) => Boolean(node && node.type === "image" && !node.layerGroup && (node.imageContainerSpec || node.imageContainer || node.imageCollection));
  const rawSpecs = new Map();
  for (const node of nodes) {
    if (node.type !== "image" || node.layerGroup) continue;
    const collection = sanitizePersistedImageCollection(node.imageCollection, node.assets);
    let spec = sanitizePersistedImageContainerSpec(node.imageContainerSpec, node, collection);
    if (!spec && collection) {
      spec = { version: 1, kind: "batch-result", memberNodeIds: [], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "generation", autoFit: collection.autoFit !== false, collection };
    } else if (!spec && node.imageContainer) {
      spec = { version: 1, kind: "manual", memberNodeIds: [], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "manual", autoFit: true };
    }
    if (spec) rawSpecs.set(node.id, spec);
  }
  const reaches = (startId, targetId, active = new Set(), depth = 0) => {
    if (startId === targetId) return true;
    if (depth >= 16 || active.has(startId)) return false;
    const spec = rawSpecs.get(startId);
    if (!spec) return false;
    const next = new Set(active).add(startId);
    return spec.childContainerNodeIds.some((childId) => reaches(childId, targetId, next, depth + 1));
  };
  const maxDepth = (nodeId, active = new Set()) => {
    if (active.has(nodeId)) return 17;
    const spec = rawSpecs.get(nodeId);
    if (!spec?.childContainerNodeIds?.length) return 1;
    const next = new Set(active).add(nodeId);
    return 1 + Math.max(...spec.childContainerNodeIds.map((childId) => maxDepth(childId, next)));
  };
  const descendantIds = (nodeId, active = new Set()) => {
    if (active.has(nodeId)) return new Set();
    const spec = rawSpecs.get(nodeId);
    const result = new Set();
    if (!spec) return result;
    const next = new Set(active).add(nodeId);
    for (const memberId of spec.memberNodeIds || []) result.add(memberId);
    for (const childId of spec.childContainerNodeIds || []) {
      result.add(childId);
      descendantIds(childId, next).forEach((id) => result.add(id));
    }
    return result;
  };
  const claimedParent = new Map();
  const ancestorDepth = (nodeId) => {
    let depth = 0;
    let current = nodeId;
    const seen = new Set();
    while (claimedParent.has(current) && !seen.has(current) && depth <= 16) {
      seen.add(current);
      current = claimedParent.get(current);
      depth += 1;
    }
    return depth;
  };
  const bindingForAssets = (owner, containerId, existing = []) => {
    const unused = new Set(existing.map((_item, index) => index));
    const usedBindingIds = new Set();
    return (Array.isArray(owner.assets) ? owner.assets : []).map((asset, assetIndex) => {
      const assetId = String(asset.assetId || `asset-${sessionAssetFingerprint(asset, assetIndex + 1, owner.id, assetIndex)}`).slice(0, 160);
      const occurrenceId = sessionAssetOccurrenceId(asset, owner.id, assetIndex);
      asset.occurrenceId = occurrenceId;
      const exact = existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex && (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId));
      const sameOccurrence = exact >= 0 ? exact : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.occurrenceId === occurrenceId);
      const fallback = sameOccurrence >= 0 ? sameOccurrence : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex);
      const previous = fallback >= 0 ? existing[fallback] : null;
      if (fallback >= 0) unused.delete(fallback);
      const bindingBase = `binding:${containerId}:${owner.id}:${occurrenceId}`;
      let bindingId = previous?.bindingId && !usedBindingIds.has(previous.bindingId) ? previous.bindingId : bindingBase;
      let bindingSuffix = 2;
      while (usedBindingIds.has(bindingId)) bindingId = `${bindingBase}:${bindingSuffix++}`;
      usedBindingIds.add(bindingId);
      return {
        bindingId,
        assetId,
        occurrenceId,
        nodeId: owner.id,
        containerNodeId: containerId,
        assetIndex,
        ...(asset.taskRole === "source" || asset.taskRole === "reference"
          ? { role: asset.taskRole }
          : owner.imageContainerRole === "source" || owner.imageContainerRole === "reference"
            ? { role: owner.imageContainerRole }
            : previous?.role ? { role: previous.role } : {})
      };
    });
  };

  for (const node of nodes) {
    const source = rawSpecs.get(node.id);
    if (!source) {
      delete node.imageContainerSpec;
      if (node.type !== "image" || node.layerGroup) {
        delete node.imageContainer;
        delete node.imageCollection;
      }
      continue;
    }
    const rawMembers = [...new Set((source.memberNodeIds || []).filter((id) => eligible(id) && id !== node.id))];
    const childCandidates = [...new Set([
      ...(source.childContainerNodeIds || []),
      ...rawMembers.filter((id) => isContainer(nodeById.get(id)))
    ])].filter((id) => eligible(id) && id !== node.id && isContainer(nodeById.get(id)));
    const requestedChildren = childCandidates.filter((candidateId) => !childCandidates.some((otherId) => (
      otherId !== candidateId && descendantIds(otherId).has(candidateId)
    )));
    const childContainerNodeIds = [];
    for (const childId of requestedChildren) {
      if (claimedParent.has(childId) || reaches(childId, node.id) || ancestorDepth(node.id) + 1 + maxDepth(childId) > 16) continue;
      claimedParent.set(childId, node.id);
      childContainerNodeIds.push(childId);
    }
    const memberNodeIds = [];
    for (const memberId of rawMembers) {
      if (childContainerNodeIds.includes(memberId) || claimedParent.has(memberId)) continue;
      claimedParent.set(memberId, node.id);
      memberNodeIds.push(memberId);
    }
    const hasChildren = childContainerNodeIds.length > 0;
    const kind = hasChildren ? "container-group" : source.kind === "container-group" ? source.hostContentKind || "manual" : source.kind;
    const ownBindings = bindingForAssets(node, node.id, source.memberBindings || []);
    const memberBindings = [
      ...ownBindings,
      ...memberNodeIds.flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return bindingForAssets(member, node.id, (source.memberBindings || []).filter((binding) => binding.nodeId === memberId && binding.containerNodeId === node.id));
      })
    ].slice(0, 2000);
    const collection = sanitizePersistedImageCollection(source.collection || node.imageCollection, node.assets);
    if (collection) {
      collection.items = collection.items.map((item) => {
        const asset = Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 1 ? node.assets?.[Number(item.assetIndex) - 1] : null;
        return { ...item, ...(asset?.assetId ? { assetId: asset.assetId, occurrenceId: sessionAssetOccurrenceId(asset, node.id, Number(item.assetIndex) - 1) } : {}) };
      });
    }
    node.imageContainerSpec = {
      ...source,
      kind,
      ...(hasChildren ? { hostContentKind: source.kind === "container-group" ? source.hostContentKind : source.kind } : { hostContentKind: undefined }),
      memberNodeIds,
      childContainerNodeIds,
      memberBindings,
      ...((memberNodeIds.length || childContainerNodeIds.length) && source.layoutId ? { layoutId: source.layoutId } : { layoutId: undefined }),
      ...(collection ? { collection } : { collection: undefined })
    };
    node.imageContainer = kind !== "batch-result";
    if (collection) node.imageCollection = collection;
    else delete node.imageCollection;
  }
}

function sanitizePersistedPendingAgentExecution(value) {
  if (!value || typeof value !== "object") return null;
  const clean = (input, maximum) => typeof input === "string" ? input.trim().slice(0, maximum) : "";
  const cleanPath = (input) => {
    const candidate = typeof input === "string" ? input.trim() : "";
    return candidate && candidate.length <= 32767 && !candidate.includes("\u0000") ? candidate : "";
  };
  const requestId = clean(value.requestId, 180);
  const projectId = clean(value.projectId, 180);
  const conversationId = clean(value.conversationId, 180);
  const originalPrompt = clean(value.originalPrompt, 24_000);
  const question = clean(value.question, 4_000);
  const kinds = new Set(["clarify", "confirm", "source_images", "reference_images"]);
  const origins = new Set(["chat", "canvas", "node", "container", "layer", "requirement"]);
  const scopeTypes = new Set(["none", "single", "multi-source", "container", "container-group", "layer", "layer-group", "mixed"]);
  const resultPolicies = new Set(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
  const confirmationPolicies = new Set(["auto", "preview-3", "staged", "direct"]);
  if (!requestId || !projectId || !conversationId || !originalPrompt || !question || !kinds.has(value.kind)) return null;
  const rawScope = value.taskScope && typeof value.taskScope === "object" ? value.taskScope : null;
  if (!rawScope) return null;
  const normalizeAssets = (items, role, limit) => (Array.isArray(items) ? items : []).slice(0, limit).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const assetId = clean(item.assetId, 160);
    const localPath = cleanPath(item.path);
    const relativePath = cleanPath(item.relativePath).replace(/\\/g, "/");
    const assetUrl = clean(item.assetUrl, 4000);
    if (!assetId && !localPath && !relativePath && !assetUrl) return [];
    const containerSlot = Number.isInteger(Number(item.containerSlot)) && Number(item.containerSlot) >= 0
      ? Math.floor(Number(item.containerSlot))
      : Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 0
        ? Math.floor(Number(item.assetIndex))
        : undefined;
    const ownerAssetIndex = Number.isInteger(Number(item.ownerAssetIndex)) && Number(item.ownerAssetIndex) >= 0
      ? Math.floor(Number(item.ownerAssetIndex))
      : undefined;
    const sourceRelativePath = safeImageSourceRelativePath(item.sourceRelativePath);
    return [{
      ...(clean(item.bindingId, 520) ? { bindingId: clean(item.bindingId, 520) } : {}),
      assetId: assetId || `pending-${role}-${index + 1}`,
      ...(/^occ-[a-f0-9]{16,64}$/i.test(clean(item.occurrenceId, 80)) ? { occurrenceId: clean(item.occurrenceId, 80).toLowerCase() } : {}),
      ...(clean(item.importBatchId, 160) ? { importBatchId: clean(item.importBatchId, 160) } : {}),
      ...(clean(item.importRootId, 80) ? { importRootId: clean(item.importRootId, 80) } : {}),
      ...(sourceRelativePath ? { sourceRelativePath } : {}),
      ...(clean(item.sourceRootLabel, 260) ? { sourceRootLabel: clean(item.sourceRootLabel, 260) } : {}),
      ...(item.sourceRootKind === "directory" || item.sourceRootKind === "file" ? { sourceRootKind: item.sourceRootKind } : {}),
      displayCode: clean(item.displayCode, 40) || `${role === "source" ? "SRC" : "REF"}${index + 1}`,
      ...(/^[a-f0-9]{32,128}$/i.test(clean(item.contentHash, 128)) ? { contentHash: clean(item.contentHash, 128).toLowerCase() } : {}),
      role,
      name: clean(item.name, 260) || `${role === "source" ? "原图" : "参考图"} ${index + 1}`,
      ...(containerSlot === undefined ? {} : { assetIndex: containerSlot, containerSlot }),
      ...(ownerAssetIndex === undefined ? {} : { ownerAssetIndex }),
      ...(clean(item.ownerNodeId, 160) ? { ownerNodeId: clean(item.ownerNodeId, 160) } : {}),
      ...(clean(item.nodeId, 160) ? { nodeId: clean(item.nodeId, 160) } : {}),
      ...(clean(item.containerId, 160) ? { containerId: clean(item.containerId, 160) } : {}),
      ...(localPath ? { path: localPath } : {}),
      ...(relativePath ? { relativePath } : {}),
      ...(assetUrl ? { assetUrl } : {}),
      ...(clean(item.mimeType, 100) ? { mimeType: clean(item.mimeType, 100) } : {}),
      ...(clean(item.purpose, 400) ? { purpose: clean(item.purpose, 400) } : {}),
      ...(role === "reference" && clean(item.referenceRole, 80) ? { referenceRole: clean(item.referenceRole, 80) } : {})
    }];
  });
  const sourceAssets = normalizeAssets(rawScope.sourceAssets, "source", 200);
  const referenceAssets = normalizeAssets(rawScope.referenceAssets, "reference", 40);
  const normalizeOptions = (items) => {
    if (!Array.isArray(items)) return [];
    const usedIds = new Set();
    let recommendedClaimed = false;
    const options = items.slice(0, 3).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const label = clean(item.label, 80).replace(/\s+/g, " ");
      if (!label) return [];
      const fallbackId = `option-${index + 1}`;
      let id = clean(item.id, 80).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallbackId;
      let suffix = 2;
      const baseId = id;
      while (usedIds.has(id)) id = `${baseId}-${suffix++}`.slice(0, 80);
      usedIds.add(id);
      const recommended = item.recommended === true && !recommendedClaimed;
      if (recommended) recommendedClaimed = true;
      return [{
        id,
        label,
        ...(clean(item.description, 260) ? { description: clean(item.description, 260) } : {}),
        answer: clean(item.answer, 4_000) || label,
        ...(recommended ? { recommended: true } : {})
      }];
    });
    return options.length >= 2 ? options : [];
  };
  const options = normalizeOptions(value.options);
  const sourceNodeIds = [...new Set((Array.isArray(value.sourceNodeIds) ? value.sourceNodeIds : rawScope.sourceNodeIds || [])
    .map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200);
  const origin = origins.has(value.taskOrigin) ? value.taskOrigin : origins.has(rawScope.origin) ? rawScope.origin : "chat";
  const cleanIds = (items, maximum) => [...new Set((Array.isArray(items) ? items : [])
    .map((id) => clean(id, 520))
    .filter(Boolean))].slice(0, maximum);
  const scopeType = scopeTypes.has(rawScope.scopeType)
    ? rawScope.scopeType
    : sourceAssets.length > 1 || sourceNodeIds.length > 1
      ? "multi-source"
      : sourceAssets.length === 1
        ? "single"
        : "none";
  const resultPolicy = resultPolicies.has(rawScope.resultPolicy)
    ? rawScope.resultPolicy
    : scopeType === "layer" || scopeType === "layer-group"
      ? "layer-variants"
      : scopeType === "container-group"
        ? "grouped-by-container"
        : sourceAssets.length > 1 || sourceNodeIds.length > 1
          ? "grouped-by-source"
          : "single";
  const confirmationPolicy = confirmationPolicies.has(rawScope.confirmationPolicy) ? rawScope.confirmationPolicy : "auto";
  const requirementNodeId = clean(value.requirementNodeId, 160) || clean(rawScope.requirement?.nodeId, 160);
  const requirementRevisionValue = Number(value.requirementRevision ?? rawScope.requirement?.revision);
  const requirementRevision = Number.isInteger(requirementRevisionValue) && requirementRevisionValue >= 1
    ? Math.floor(requirementRevisionValue)
    : undefined;
  const requirementSourceSignature = clean(value.requirementSourceSignature, 240) || clean(rawScope.requirement?.sourceSignature, 240);
  const snapshotHash = /^scope-[a-f0-9]{32}$/i.test(clean(rawScope.snapshotHash, 80))
    ? clean(rawScope.snapshotHash, 80).toLowerCase()
    : "";
  return {
    version: 2,
    requestId,
    projectId,
    conversationId,
    originalPrompt,
    sourceNodeIds,
    ...(clean(value.focusedNodeId, 160) ? { focusedNodeId: clean(value.focusedNodeId, 160) } : {}),
    taskOrigin: origin,
    taskScope: {
      version: 2,
      origin,
      scopeType,
      canvasRevision: Math.max(0, Math.floor(Number(rawScope.canvasRevision) || 0)),
      sourceNodeIds: [...new Set((Array.isArray(rawScope.sourceNodeIds) ? rawScope.sourceNodeIds : sourceNodeIds).map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200),
      sourceContainerIds: cleanIds(rawScope.sourceContainerIds, 200),
      referenceContainerIds: cleanIds(rawScope.referenceContainerIds, 40),
      sourceBindingIds: cleanIds(
        Array.isArray(rawScope.sourceBindingIds) && rawScope.sourceBindingIds.length
          ? rawScope.sourceBindingIds
          : sourceAssets.map((asset) => asset.bindingId),
        200
      ),
      referenceBindingIds: cleanIds(
        Array.isArray(rawScope.referenceBindingIds) && rawScope.referenceBindingIds.length
          ? rawScope.referenceBindingIds
          : referenceAssets.map((asset) => asset.bindingId),
        40
      ),
      sourceAssets,
      referenceAssets,
      resultPolicy,
      confirmationPolicy,
      ...(requirementNodeId && requirementRevision !== undefined
        ? { requirement: { nodeId: requirementNodeId, revision: requirementRevision, ...(requirementSourceSignature ? { sourceSignature: requirementSourceSignature } : {}) } }
        : {}),
      snapshotHash,
      sourceAssetCount: Math.max(sourceAssets.length, Math.floor(Number(rawScope.sourceAssetCount || sourceAssets.length) || sourceAssets.length)),
      referenceAssetCount: Math.max(referenceAssets.length, Math.floor(Number(rawScope.referenceAssetCount || referenceAssets.length) || referenceAssets.length)),
      truncated: rawScope.truncated === true
    },
    ...(requirementNodeId ? { requirementNodeId } : {}),
    ...(requirementRevision === undefined ? {} : { requirementRevision }),
    ...(clean(value.requirementSourceNodeId, 160) ? { requirementSourceNodeId: clean(value.requirementSourceNodeId, 160) } : {}),
    ...(requirementSourceSignature ? { requirementSourceSignature } : {}),
    kind: value.kind,
    title: clean(value.title, 240) || (value.kind === "source_images" ? "添加原图" : value.kind === "reference_images" ? "添加参考图" : "需要你确认"),
    question,
    ...(clean(value.detail, 4_000) ? { detail: clean(value.detail, 4_000) } : {}),
    ...(clean(value.suggestedAnswer, 4_000) ? { suggestedAnswer: clean(value.suggestedAnswer, 4_000) } : {}),
    ...(options.length ? { options } : {}),
    maxImages: Math.max(1, Math.min(40, Math.floor(Number(value.maxImages || 9) || 9))),
    createdAt: clean(value.createdAt, 80) || new Date().toISOString()
  };
}

function sanitizeSession(session) {
  const source = session && typeof session === "object" ? session : {};
  const usedIds = new Set();
  const usedDisplayCodes = new Set();
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .filter((node) => node && typeof node === "object")
        .map((node, index) => {
          const next = { ...node };
          const fallbackId = `N${index + 1}`;
          next.id = typeof next.id === "string" && next.id.trim() ? next.id.trim() : fallbackId;
          if (usedIds.has(next.id)) {
            let suffix = Math.max(27, index + 1);
            while (usedIds.has(`N${suffix}`)) suffix += 1;
            next.id = `N${suffix}`;
          }
          usedIds.add(next.id);
          next.displayCode = typeof next.displayCode === "string" && next.displayCode.trim()
            ? next.displayCode.trim().replace(/\s+/g, "").slice(0, 32)
            : next.id;
          if (usedDisplayCodes.has(next.displayCode)) {
            let suffix = Math.max(27, index + 1);
            while (usedDisplayCodes.has(`N${suffix}`)) suffix += 1;
            next.displayCode = `N${suffix}`;
          }
          usedDisplayCodes.add(next.displayCode);
          if (next.parentId === next.id || typeof next.parentId !== "string" || !next.parentId.trim()) delete next.parentId;
          if (next.agentOwnerId === next.id || typeof next.agentOwnerId !== "string" || !next.agentOwnerId.trim()) delete next.agentOwnerId;
          if (next.type === "image" && next.imageState === "queued") next.imageState = "empty";
          if (next.type === "image" && Array.isArray(next.assets) && next.assets.length > 0) {
            next.imageState = "done";
            next.status = "done";
            next.outputs = Math.max(Number(next.outputs ?? 0), next.assets.length);
          }
          if (next.type === "image") {
            next.taskProvenance = sanitizePersistedImageTaskProvenance(next.taskProvenance);
            if (!next.taskProvenance) delete next.taskProvenance;
          }
          if (next.type === "requirement") {
            next.requirement = sanitizePersistedCanvasRequirement(next.requirement, next.prompt);
            next.status = "done";
            next.outputs = 0;
            delete next.assets;
            delete next.imageState;
            delete next.imageProgress;
            delete next.imageParams;
            delete next.imageCollection;
            delete next.imageContainer;
            delete next.imageContainerSpec;
            delete next.layerGroup;
            delete next.layerComposition;
          }
          if (!Number.isFinite(Number(next.x))) next.x = 120 + index * 300;
          if (!Number.isFinite(Number(next.y))) next.y = 120 + index * 120;
          return next;
        })
    : [];
  const removedLegacyIds = new Set(
    nodes
      .filter((node) => node.type !== "image" && !(node.type === "requirement" && node.requirement) && (!Array.isArray(node.assets) || node.assets.length === 0))
      .map((node) => node.id)
  );
  const artifactNodes = nodes
    .filter((node) => node.type === "image" || (node.type === "requirement" && node.requirement) || (Array.isArray(node.assets) && node.assets.length > 0))
    .map((node) => node.type === "requirement" ? node : ({ ...node, type: "image" }));
  const ids = new Set(artifactNodes.map((node) => node.id));
  for (const node of artifactNodes) {
    if (node.parentId && !ids.has(node.parentId)) delete node.parentId;
    if (node.parentId && removedLegacyIds.has(node.parentId)) delete node.parentId;
    delete node.agentOwnerId;
    delete node.agentConversationId;
    delete node.agentInitState;
    delete node.agentLastMemoryEntryId;
  }
  const assetIdentity = repairSessionAssetIdentities(artifactNodes);
  repairPersistedImageContainerSpecs(artifactNodes);
  const nodeById = new Map(artifactNodes.map((node) => [node.id, node]));
  const claimedLayoutNodeIds = new Set();
  const usedLayoutGroupIds = new Set();
  const layoutGroups = [];
  for (const rawGroup of Array.isArray(source.layoutGroups) ? source.layoutGroups : []) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const id = typeof rawGroup.id === "string" ? rawGroup.id.trim().slice(0, 160) : "";
    if (!id || usedLayoutGroupIds.has(id)) continue;
    usedLayoutGroupIds.add(id);
    const requestedMembers = Array.isArray(rawGroup.memberNodeIds) ? rawGroup.memberNodeIds : [];
    const candidateIds = [];
    const hostCandidate = typeof rawGroup.hostNodeId === "string" ? rawGroup.hostNodeId.trim() : "";
    if (hostCandidate) candidateIds.push(hostCandidate);
    candidateIds.push(...requestedMembers.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean));
    const memberNodeIds = [];
    for (const memberId of candidateIds) {
      const member = nodeById.get(memberId);
      if (!member || member.type !== "image" || member.layerGroup || claimedLayoutNodeIds.has(memberId) || memberNodeIds.includes(memberId)) continue;
      memberNodeIds.push(memberId);
    }
    if (memberNodeIds.length < 2) continue;
    const hostNodeId = memberNodeIds.includes(hostCandidate) ? hostCandidate : memberNodeIds[0];
    memberNodeIds.forEach((memberId) => claimedLayoutNodeIds.add(memberId));
    layoutGroups.push({
      id,
      hostNodeId,
      memberNodeIds,
      origin: rawGroup.origin === "auto" || rawGroup.origin === "generation" ? rawGroup.origin : "manual",
      autoFit: rawGroup.autoFit !== false
    });
  }
  const selectedNodeId = ids.has(source.selectedNodeId) ? source.selectedNodeId : "";
  const conversations = Array.isArray(source.conversations)
    ? source.conversations
        .filter((item) => item && typeof item === "object")
        .map((item, index) => {
          const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `conv-${index + 1}`;
          const messages = repairSessionMessageAssetIds(item.messages, assetIdentity.resolve);
          const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString();
          return {
            id,
            title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 80) : `会话 ${index + 1}`,
            messages,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : updatedAt,
            updatedAt
          };
        })
    : [];
  const activeConversationId =
    typeof source.activeConversationId === "string" && conversations.some((item) => item.id === source.activeConversationId)
      ? source.activeConversationId
      : conversations[0]?.id ?? "";
  const pendingAgentExecution = sanitizePersistedPendingAgentExecution(source.pendingAgentExecution);
  const validPendingAgentExecution = pendingAgentExecution && pendingAgentExecution.conversationId === activeConversationId
    ? pendingAgentExecution
    : null;
  return {
    schemaVersion: Math.max(0, Math.floor(Number(source.schemaVersion || 0))) >= 3 ? 3 : 2,
    sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || 0))),
    canvasRevision: Math.max(0, Math.floor(Number(source.canvasRevision || 0))),
    nodeSequence: Math.max(
      Math.max(0, Math.floor(Number(source.nodeSequence || 0))),
      ...artifactNodes.flatMap((node) => [persistedNodeSequenceFromCode(node.displayCode), persistedNodeSequenceFromCode(node.id)])
    ),
    messages: repairSessionMessageAssetIds(source.messages, assetIdentity.resolve),
    conversations,
    activeConversationId,
    nodes: artifactNodes,
    layoutGroups,
    selectedNodeId,
    pendingAgentExecution: validPendingAgentExecution
  };
}

function messageHasSessionContent(message) {
  if (!message || typeof message !== "object" || message.hidden) return false;
  return Boolean(String(message.content || "").trim() || message.toolTrace);
}

function sessionHasContent(session) {
  const source = sanitizeSession(session);
  if (source.nodes.length > 0) return true;
  if (source.messages.some(messageHasSessionContent)) return true;
  return source.conversations.some((conversation) => Array.isArray(conversation.messages) && conversation.messages.some(messageHasSessionContent));
}

function hydrateSessionAssets(session) {
  return sanitizeSession(session);
}

module.exports = {
  hydrateSessionAssets,
  safeImageSourceRelativePath,
  sanitizeSession,
  sessionAssetContentHash,
  sessionHasContent
};

