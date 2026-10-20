const text = value => typeof value === "string" ? value.trim() : "";
const locator = value => {
  const normalized = text(value).replace(/\\/g, "/").toLowerCase();
  return /^(?:data|blob):/i.test(normalized) ? "" : normalized;
};

export function imageAssetContentHash(asset = {}) {
  const value = String(asset.contentHash || asset.sha256 || "").trim().toLowerCase();
  return /^[a-f0-9]{32,128}$/.test(value) ? value : "";
}

export function imageAssetIdentityLocators(asset = {}) {
  const relativePath = String(asset.relativePath || "").trim().replace(/\\/g, "/").toLowerCase();
  const localPath = String(asset.path || "").trim().replace(/\\/g, "/").toLowerCase();
  const assetUrl = String(asset.assetUrl || "").trim();
  const url = String(asset.url || "").trim();
  return [...new Set([
    relativePath ? `relative-path:${relativePath}` : "",
    localPath ? `path:${localPath}` : "",
    assetUrl && !/^(?:data|blob):/i.test(assetUrl) ? `asset-url:${assetUrl}` : "",
    url && !/^(?:data|blob):/i.test(url) ? `url:${url}` : ""
  ].filter(Boolean))];
}

// Renderer and Main keep their historical digest algorithms, but must agree
// about which claims describe the same generated output or managed file.
export function imageAssetIdentitySources(asset = {}, { fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null } = {}) {
  const contentHash = imageAssetContentHash(asset), locators = imageAssetIdentityLocators(asset), bridgedHashes = new Set();
  if (!contentHash && contentHashesByLocator) for (const key of locators) {
    const hashes = contentHashesByLocator.get(key);
    if (hashes?.size === 1) bridgedHashes.add([...hashes][0]);
  }
  const effectiveContentHash = contentHash || (bridgedHashes.size === 1 ? [...bridgedHashes][0] : "");
  const runId = String(asset.runId || "").trim(), normalizedRunId = runId.toLowerCase();
  const originalName = String(asset.originalName || asset.fileName || asset.name || "").trim().toLowerCase();
  const index = Math.max(1, Number(asset.index || fallbackIndex) || 1);
  let primarySource = effectiveContentHash ? `content:${effectiveContentHash}` : locators[0] ||
    (runId ? `run:${runId}|index:${index}` : originalName ? `name:${originalName}|index:${index}` : `index:${index}`);
  if (!effectiveContentHash && !locators.length && !runId) primarySource += `|owner:${ownerId}|slot:${Math.max(0, Number(slot) || 0)}`;
  const imported = normalizedRunId.startsWith("import-") || Boolean(asset.importBatchId && asset.importRootId && asset.sourceRelativePath);
  if (normalizedRunId && !imported) {
    const occurrence = String(asset.occurrenceId || "").trim().toLowerCase() || String(asset.assetId || asset.index || "").trim();
    primarySource = `generated:${normalizedRunId}|occurrence:${occurrence}|${primarySource}`;
  }
  // Legacy previews/attachments may use different run metadata for one real
  // managed file. Byte-qualified physical aliases bridge only that file;
  // equal bytes written by other requests retain their generation identities.
  const physical = locators.map(key => effectiveContentHash ? `${key}|content:${effectiveContentHash}` : key);
  return { primarySource, aliasSources: [...new Set([primarySource, ...physical])] };
}

function assetKeys(asset, slot, generatedOnly) {
  const runId = text(asset.runId).toLowerCase();
  const imported = runId.startsWith("import-") || Boolean(text(asset.importBatchId) && text(asset.importRootId) && text(asset.sourceRelativePath));
  const locators = [...new Set([asset.relativePath, asset.path, asset.assetUrl, asset.url].map(locator).filter(Boolean))];
  const occurrenceId = text(asset.occurrenceId);
  if (!imported && runId && locators.length) {
    // Runtime deliveries may have only an absolute path, while a stored asset
    // also has a relative path. Keep every known locator as an alias, scoped to
    // the generation run; pixels alone never establish a logical occurrence.
    return locators.map(value => `generated:${runId}:locator:${value}`);
  }
  if (generatedOnly) return [];
  if (occurrenceId) return [`occurrence:${occurrenceId}`];
  const assetId = text(asset.assetId);
  if (assetId) return [`asset:${assetId}`];
  return [locators.length ? `path:${locators[0]}` : `slot:${slot}:${runId}`];
}

function mergeMetadata(previous, incoming) {
  const merged = { ...previous, ...incoming };
  for (const field of ["occurrenceId", "assetId", "displayCode"]) {
    if (previous[field]) merged[field] = previous[field];
  }
  for (const field of ["path", "relativePath", "assetUrl", "url"]) {
    if (!text(incoming[field]) && text(previous[field])) merged[field] = previous[field];
  }
  if (previous.contentName?.source === "manual" && incoming.contentName?.source !== "manual") {
    merged.title = previous.title;
    merged.contentName = previous.contentName;
  }
  return merged;
}

export function coalesceImageAssets(assets = [], { generatedOnly = false } = {}) {
  const rows = [], parents = [], sourceRows = new Map(), rowByKey = new Map();
  const root = row => {
    while (parents[row] !== row) {
      parents[row] = parents[parents[row]];
      row = parents[row];
    }
    return row;
  };
  for (const [slot, asset] of assets.entries()) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
    const keys = assetKeys(asset, slot, generatedOnly);
    const matches = [...new Set(keys.filter(key => rowByKey.has(key)).map(key => root(rowByKey.get(key))))].sort((a, b) => a - b);
    const row = matches.length ? matches[0] : rows.length;
    if (!matches.length) {
      rows.push({ ...asset });
      parents.push(row);
    } else {
      // A complete record can bridge two earlier records that each knew only
      // one locator. Reconcile both groups, keeping the first stable identity.
      for (const duplicate of matches.slice(1)) {
        rows[row] = mergeMetadata(rows[row], rows[duplicate]);
        parents[duplicate] = row;
      }
      rows[row] = mergeMetadata(rows[row], asset);
    }
    for (const key of keys) rowByKey.set(key, row);
    sourceRows.set(slot, row);
  }
  const result = [], finalSlotByRow = new Map();
  rows.forEach((asset, row) => {
    if (root(row) !== row) return;
    finalSlotByRow.set(row, result.length);
    result.push(asset);
  });
  return {
    assets: result,
    slotMap: new Map([...sourceRows].map(([slot, row]) => [slot, finalSlotByRow.get(root(row))]))
  };
}

function remappedReferenceSlot(reference, sourceAssets, slotMap, indexBase) {
  const explicit = Number(reference.assetIndex) - indexBase;
  // Identity belongs to the selected writer's asset list. Resolve there before
  // using its numeric slot, then map to the canonical list from this merge.
  for (const field of ["occurrenceId", "assetId"]) {
    const identity = text(reference[field]);
    if (!identity) continue;
    const candidates = sourceAssets.flatMap((asset, slot) => text(asset?.[field]) === identity ? [slot] : []);
    const mapped = [...new Set(candidates.map(slot => slotMap.get(slot)).filter(Number.isInteger))];
    if (mapped.length === 1) return mapped[0];
    if (candidates.includes(explicit)) return slotMap.get(explicit);
  }
  return Number.isInteger(explicit) ? slotMap.get(explicit) : undefined;
}

// Mutates only slot-dependent metadata. Both historical repair and Main's
// writer merge use this owner before old numeric slots lose their meaning.
export function remapImageAssetSlots(node, sourceAssets, assets, slotMap) {
  const identityAt = slot => ({
    ...(assets[slot]?.assetId ? { assetId: assets[slot].assetId } : {}),
    ...(assets[slot]?.occurrenceId ? { occurrenceId: assets[slot].occurrenceId } : {})
  });
  const remapCollection = collection => {
    if (!collection || typeof collection !== "object") return collection;
    const items = [], seenDoneSlots = new Set();
    for (const item of Array.isArray(collection.items) ? collection.items : []) {
      if (!item || typeof item !== "object") continue;
      const slot = remappedReferenceSlot(item, sourceAssets, slotMap, 1);
      if (item.status !== "pending" && item.status !== "error" && slot !== undefined) {
        if (seenDoneSlots.has(slot)) continue;
        seenDoneSlots.add(slot);
        items.push({ ...item, assetIndex: slot + 1, ...identityAt(slot) });
      } else {
        items.push({ ...item });
      }
    }
    return { ...collection, items };
  };
  if (node.imageCollection) node.imageCollection = remapCollection(node.imageCollection);
  if (node.imageContainerSpec && typeof node.imageContainerSpec === "object") {
    const spec = { ...node.imageContainerSpec };
    if (spec.collection) spec.collection = remapCollection(spec.collection);
    if (Array.isArray(spec.memberBindings)) {
      const seenSlots = new Set();
      spec.memberBindings = spec.memberBindings.flatMap(binding => {
        if (!binding || typeof binding !== "object" || (binding.nodeId && binding.nodeId !== node.id)) return [binding];
        const slot = remappedReferenceSlot(binding, sourceAssets, slotMap, 0);
        if (slot === undefined) return [binding];
        if (seenSlots.has(slot)) return [];
        seenSlots.add(slot);
        return [{ ...binding, assetIndex: slot, ...identityAt(slot) }];
      });
    }
    node.imageContainerSpec = spec;
  }

  const mappedSlots = new Set(sourceAssets.map((_asset, slot) => slotMap.get(slot)).filter(Number.isInteger));
  if (node.type === "image" && mappedSlots.size < sourceAssets.length) {
    node.outputs = assets.length;
    const progress = node.imageProgress && typeof node.imageProgress === "object" ? node.imageProgress : null;
    if (progress) {
      const collection = node.imageCollection || node.imageContainerSpec?.collection;
      const collectionItems = Array.isArray(collection?.items) ? collection.items : [];
      const completed = collectionItems.length
        ? collectionItems.filter(item => item?.status !== "pending" && item?.status !== "error").length
        : assets.length;
      const failed = collectionItems.length
        ? collectionItems.filter(item => item?.status === "error").length
        : Math.max(0, Number(progress.failed) || 0);
      const preservedFailedSlots = Array.isArray(progress.failedSlots)
        ? [...new Set(progress.failedSlots.map(slot => Math.max(1, Math.floor(Number(slot) || 0))).filter(Boolean))]
        : [];
      const failedSlots = collectionItems.length
        ? collectionItems.filter(item => item?.status === "error").map((item, index) => Math.max(1, Math.floor(Number(item.requestIndex || index + 1) || index + 1)))
        : preservedFailedSlots;
      const configuredTotal = Math.max(0, Math.floor(Number(node.imageParams?.count) || 0));
      const total = Math.max(1, completed + failed, collectionItems.length, configuredTotal);
      node.imageProgress = {
        ...progress, total, completed, failed, failedSlots, activeIndex: undefined,
        message: failed ? `已完成 ${completed}/${total} 张，失败 ${failed} 张` : `已完成 ${completed}/${total} 张`
      };
    }
  }
  return node;
}
