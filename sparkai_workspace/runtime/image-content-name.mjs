export function normalizeContentName(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const displayName = String(value.displayName || "").normalize("NFKC").trim();
  if (!displayName || displayName.length > 48 || /[\r\n\\/:<>|`]|https?|data:|api.?key|bearer|nonce|selftest|aidebug|fmem-|gpt-|grok-/i.test(displayName)) return undefined;
  if (!["high", "medium"].includes(value.confidence)) return undefined;
  return { displayName, confidence: value.confidence, source: "visual" };
}

export function normalizeStoredContentName(value) {
  if (value?.source === "manual" && typeof value.displayName === "string") {
    const displayName = value.displayName.trim().slice(0, 160);
    return displayName ? { displayName, source: "manual" } : undefined;
  }
  if (value?.source === "fallback" && typeof value.displayName === "string" && value.displayName.length <= 48) {
    return { displayName: value.displayName, source: "fallback" };
  }
  return normalizeContentName(value);
}

export function canApplyContentName(node) {
  if (node.contentName?.source === "manual") return false;
  if (node.contentName) return node.title === node.contentName.displayName;
  return !node.title || /^(?:图片容器|文件夹容器|项目图片库|导入图片|本轮原图|本轮参考图|图片成果|Agent 成果|批量图片组|图片组|未命名成果)$/.test(node.title)
    || node.assets?.some(asset => node.title === asset.originalName || node.title === asset.title && asset.title === asset.originalName);
}

export function contentNamePatch(node, name, assetPath) {
  const contentName = normalizeContentName(name);
  if (!contentName) return undefined;
  const automaticSuffix = asset => {
    const prefix = `${asset.contentName?.displayName} · `;
    const suffix = asset.title?.startsWith(prefix) ? asset.title.slice(prefix.length) : "";
    return /^[1-9]\d*$/.test(suffix) ? Number(suffix) : 0;
  };
  const automaticAsset = asset => asset.contentName?.source !== "manual" && (!asset.title || asset.title === asset.originalName
    || asset.title === asset.contentName?.displayName || automaticSuffix(asset) > 0
    || /^(?:图片成果|导入图片|图片)(?:\s*\d+)?$/.test(asset.title));
  if (!(node.assets || []).some(asset => asset.path === assetPath && automaticAsset(asset))) return undefined;
  const assets = (node.assets || []).map(asset => asset.path !== assetPath || !automaticAsset(asset) ? asset : {
    ...asset, title: asset.contentName?.displayName === contentName.displayName && automaticSuffix(asset) ? asset.title : contentName.displayName, contentName
  });
  const counts = new Map();
  const baseTitle = asset => asset.contentName?.source === "visual" && automaticAsset(asset) ? asset.contentName.displayName : asset.title;
  for (const asset of assets) counts.set(baseTitle(asset), (counts.get(baseTitle(asset)) || 0) + 1);
  const suffixes = new Map();
  const used = new Map();
  // Persisted suffixes belong to asset identities; changing container order must
  // not rename the same picture. New collisions receive the first unused slot.
  for (const asset of assets) {
    const base = baseTitle(asset);
    if (asset.contentName?.source !== "visual" || !automaticAsset(asset)) continue;
    const suffix = Number(asset.title?.startsWith(`${base} · `) ? asset.title.slice(`${base} · `.length) : 0);
    const slots = used.get(base) || new Set();
    used.set(base, slots);
    if (Number.isSafeInteger(suffix) && suffix > 0 && !slots.has(suffix)) { slots.add(suffix); suffixes.set(asset, suffix); }
  }
  const stableAssets = [...assets].sort((a, b) => String(a.occurrenceId || a.assetId || a.path || a.index).localeCompare(String(b.occurrenceId || b.assetId || b.path || b.index)));
  for (const asset of stableAssets) {
    const base = baseTitle(asset);
    if (counts.get(base) <= 1 || suffixes.has(asset) || asset.contentName?.source !== "visual" || !automaticAsset(asset)) continue;
    const slots = used.get(base) || new Set(); let suffix = 1;
    while (slots.has(suffix)) suffix++;
    slots.add(suffix); used.set(base, slots); suffixes.set(asset, suffix);
  }
  const namedAssets = assets.map(asset => asset.contentName?.source === "visual" && automaticAsset(asset)
    ? { ...asset, title: suffixes.has(asset) ? `${baseTitle(asset)} · ${suffixes.get(asset)}` : baseTitle(asset) } : asset);
  const subjects = [...new Set(namedAssets.filter(asset => asset.contentName?.source === "visual").map(asset => asset.contentName.displayName).filter(Boolean))];
  const displayName = subjects.length ? subjects.join("与").slice(0, 48) : contentName.displayName;
  const renameNode = canApplyContentName(node);
  const imageCollection = node.imageCollection ? { ...node.imageCollection, name: renameNode && node.imageCollection.name === node.title ? displayName : node.imageCollection.name,
    items: node.imageCollection.items.map(item => ({ ...item, title: namedAssets[Math.max(0, Number(item.assetIndex) - 1)]?.title || item.title })) } : undefined;
  return { title: renameNode ? displayName : node.title, contentName: renameNode ? { ...contentName, displayName } : node.contentName, assets: namedAssets,
    ...(imageCollection ? { imageCollection } : {}) };
}
