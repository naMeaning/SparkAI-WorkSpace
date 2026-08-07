import { stableImageAssetId, stableImageOccurrenceId } from "./asset-identity.ts";
import type {
  ImageAsset,
  ImageCollection,
  ImageContainerKind,
  ImageContainerMemberBinding,
  ImageContainerSpec,
  WorkflowNode,
} from "./core.ts";

/**
 * Canonical image-container spec ownership.
 *
 * This module owns persisted-spec sanitization, legacy compatibility and the
 * direct asset bindings attached to one container boundary. Graph topology
 * and canvas projection live in image-container-graph.ts.
 */

const CONTAINER_KINDS = new Set<ImageContainerKind>([
  "manual",
  "folder",
  "batch-result",
  "container-group",
]);

export const uniqueImageContainerIds = (values: readonly unknown[], excludedId = ""): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = typeof value === "string" ? value.trim().slice(0, 160) : "";
    if (!id || id === excludedId || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const cleanText = (value: unknown, maximum: number): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : undefined;
};

export const cloneImageContainerCollection = (collection?: ImageCollection): ImageCollection | undefined => {
  if (!collection) return undefined;
  return {
    ...collection,
    items: collection.items.map((item) => ({ ...item })),
  };
};

export const sanitizeImageContainerCollection = (
  value: unknown,
  fallback?: ImageCollection,
  assets: readonly ImageAsset[] = [],
): ImageCollection | undefined => {
  const source = value && typeof value === "object" ? value as Partial<ImageCollection> : fallback;
  if (!source) return undefined;
  const items = (Array.isArray(source.items) ? source.items : fallback?.items ?? [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as ImageCollection["items"][number];
      const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
      const rawAssetIndex = Number(candidate.assetIndex);
      const candidateAssetId = cleanText(candidate.assetId, 160);
      const candidateOccurrenceId = cleanText(candidate.occurrenceId, 80)?.toLowerCase();
      const explicitAssetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 1 && rawAssetIndex <= Math.min(200, assets.length)
        ? rawAssetIndex
        : undefined;
      const occurrenceIndex = explicitAssetIndex === undefined && candidateOccurrenceId
        ? assets.findIndex((asset) => asset.occurrenceId === candidateOccurrenceId)
        : -1;
      const matchingAssetIdIndexes = explicitAssetIndex === undefined && occurrenceIndex < 0 && candidateAssetId
        ? assets.map((asset, assetIndex) => asset.assetId === candidateAssetId ? assetIndex : -1).filter((assetIndex) => assetIndex >= 0)
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
      const asset = assetIndex === undefined ? undefined : assets[assetIndex - 1];
      const status = requestedStatus === "done" && !asset ? "error" as const : requestedStatus;
      return {
        id: cleanText(candidate.id, 120) || `item-${index + 1}`,
        assetId: status === "done" && asset
          ? asset.assetId || stableImageAssetId(asset, assetIndex)
          : undefined,
        occurrenceId: status === "done" && asset
          ? stableImageOccurrenceId(asset, "image-collection", (assetIndex ?? 1) - 1)
          : undefined,
        assetIndex,
        requestIndex: Math.max(1, Math.min(200, Math.floor(Number(candidate.requestIndex ?? index + 1) || index + 1))),
        prompt: cleanText(candidate.prompt, 12000) || cleanText(asset?.prompt || asset?.revisedPrompt, 12000) || "",
        title: cleanText(candidate.title, 160),
        defectReason: cleanText(candidate.defectReason, 320),
        replacedByAssetId: cleanText(candidate.replacedByAssetId, 160),
        replacesItemId: cleanText(candidate.replacesItemId, 120),
        status,
        error: cleanText(candidate.error, 320) || (
          requestedStatus === "done" && !asset ? "图片槽位缺少对应成果。" : undefined
        ),
      } satisfies ImageCollection["items"][number];
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 200);
  if (!items.length && !(fallback?.items.length)) return undefined;
  return {
    id: cleanText(source.id, 120) || cleanText(fallback?.id, 120) || "image-collection",
    name: cleanText(source.name, 160) || cleanText(fallback?.name, 160),
    kind: source.kind === "series" ? "series" : "batch",
    collectionRole: source.collectionRole === "defects" ? "defects" : "results",
    generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
    items: items.length ? items : cloneImageContainerCollection(fallback)?.items ?? [],
    sourceNodeId: cleanText(source.sourceNodeId, 160),
    sourceCollectionId: cleanText(source.sourceCollectionId, 120),
    defectOfNodeId: cleanText(source.defectOfNodeId, 160),
    createdAt: cleanText(source.createdAt, 80),
    autoFit: source.autoFit !== false,
  };
};

const sanitizeBindings = (value: unknown, hostNodeId: string): ImageContainerMemberBinding[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const seenBindingIds = new Set<string>();
  const result: ImageContainerMemberBinding[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<ImageContainerMemberBinding>;
    const assetId = cleanText(source.assetId, 160);
    const nodeId = cleanText(source.nodeId, 160) || hostNodeId;
    const containerNodeId = cleanText(source.containerNodeId, 160) || hostNodeId;
    if (!assetId || !nodeId || !containerNodeId) continue;
    const assetIndex = Math.max(0, Math.floor(Number(source.assetIndex ?? index) || 0));
    const occurrenceId = cleanText(source.occurrenceId, 80)?.toLowerCase();
    const key = `${nodeId}:${assetIndex}:${occurrenceId || assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const requestedBindingId = cleanText(source.bindingId, 520);
    const bindingSeed = occurrenceId || `${assetId}:${assetIndex}`;
    let bindingId = requestedBindingId && !seenBindingIds.has(requestedBindingId)
      ? requestedBindingId
      : `binding:${containerNodeId}:${nodeId}:${bindingSeed}`;
    let suffix = 1;
    while (seenBindingIds.has(bindingId)) bindingId = `binding:${containerNodeId}:${nodeId}:${bindingSeed}:${suffix++}`;
    seenBindingIds.add(bindingId);
    result.push({
      bindingId,
      assetId,
      occurrenceId,
      nodeId,
      containerNodeId,
      assetIndex,
      role: source.role === "reference" ? "reference" : source.role === "source" ? "source" : undefined,
    });
  }
  return result.slice(0, 2000);
};

type ImageContainerNodeInput = Pick<WorkflowNode,
  "id" | "branch" | "imageContainer" | "imageCollection" | "imageContainerSpec"
> & Partial<Pick<WorkflowNode, "type" | "assets" | "imageContainerRole" | "layerGroup">>;

export const imageContainerBindingsForNodeAssets = (
  node: ImageContainerNodeInput,
  containerNodeId = node.id,
  existingBindings: readonly ImageContainerMemberBinding[] = [],
): ImageContainerMemberBinding[] => {
  const unused = new Set(existingBindings.map((_binding, index) => index));
  const usedBindingIds = new Set<string>();
  return (node.assets ?? []).map((asset, assetIndex) => {
    const assetId = asset.assetId || stableImageAssetId(asset, assetIndex + 1);
    const occurrenceId = stableImageOccurrenceId(asset, node.id, assetIndex);
    const exactIndex = existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.assetIndex === assetIndex &&
      (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId)
    ));
    const occurrenceMatchIndex = exactIndex >= 0 ? exactIndex : existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.occurrenceId === occurrenceId
    ));
    const slotMatchIndex = occurrenceMatchIndex >= 0 ? occurrenceMatchIndex : existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.assetIndex === assetIndex
    ));
    const existing = slotMatchIndex >= 0 ? existingBindings[slotMatchIndex] : undefined;
    if (slotMatchIndex >= 0) unused.delete(slotMatchIndex);
    const bindingBase = `binding:${containerNodeId}:${node.id}:${occurrenceId}`;
    let bindingId = existing?.bindingId && !usedBindingIds.has(existing.bindingId) ? existing.bindingId : bindingBase;
    let bindingSuffix = 2;
    while (usedBindingIds.has(bindingId)) bindingId = `${bindingBase}:${bindingSuffix++}`;
    usedBindingIds.add(bindingId);
    return {
      bindingId,
      assetId,
      occurrenceId,
      nodeId: node.id,
      containerNodeId,
      assetIndex,
      role: asset.taskRole ?? (
        node.imageContainerRole === "source" || node.imageContainerRole === "reference"
          ? node.imageContainerRole
          : existing?.role
      ),
    };
  });
};

export function sanitizeImageContainerSpec(
  value: unknown,
  nodeId: string,
  fallbackCollection?: ImageCollection,
  assets: readonly ImageAsset[] = [],
): ImageContainerSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<ImageContainerSpec>;
  const kind = CONTAINER_KINDS.has(source.kind as ImageContainerKind)
    ? source.kind as ImageContainerKind
    : undefined;
  if (!kind) return undefined;
  const hostContentKind = source.hostContentKind === "manual" || source.hostContentKind === "folder" || source.hostContentKind === "batch-result"
    ? source.hostContentKind
    : undefined;
  const collection = sanitizeImageContainerCollection(source.collection, fallbackCollection, assets);
  return {
    version: 1,
    kind,
    memberNodeIds: uniqueImageContainerIds(Array.isArray(source.memberNodeIds) ? source.memberNodeIds : [], nodeId),
    childContainerNodeIds: uniqueImageContainerIds(Array.isArray(source.childContainerNodeIds) ? source.childContainerNodeIds : [], nodeId),
    memberBindings: sanitizeBindings(source.memberBindings, nodeId),
    hostContentKind,
    sourceLabel: cleanText(source.sourceLabel, 260),
    importBatchId: cleanText(source.importBatchId, 160),
    layoutId: cleanText(source.layoutId, 160),
    layoutOrigin: source.layoutOrigin === "auto" || source.layoutOrigin === "generation" ? source.layoutOrigin : "manual",
    autoFit: source.autoFit !== false,
    collection,
  };
}

export function imageContainerSpecForNode(node: ImageContainerNodeInput): ImageContainerSpec | undefined {
  if ((node.type !== undefined && node.type !== "image") || node.layerGroup) return undefined;
  const explicit = sanitizeImageContainerSpec(node.imageContainerSpec, node.id, node.imageCollection, node.assets ?? []);
  if (explicit) {
    if (!explicit.collection && node.imageCollection) explicit.collection = cloneImageContainerCollection(node.imageCollection);
    if (!explicit.memberNodeIds.length && !explicit.childContainerNodeIds.length) {
      explicit.memberBindings = imageContainerBindingsForNodeAssets(node, node.id, explicit.memberBindings);
    } else if (!explicit.memberBindings.length) {
      explicit.memberBindings = imageContainerBindingsForNodeAssets(node);
    }
    return explicit;
  }
  if (node.imageCollection) {
    return {
      version: 1,
      kind: "batch-result",
      memberNodeIds: [],
      childContainerNodeIds: [],
      memberBindings: imageContainerBindingsForNodeAssets(node),
      layoutOrigin: "generation",
      autoFit: node.imageCollection.autoFit !== false,
      collection: cloneImageContainerCollection(node.imageCollection),
    };
  }
  if (node.imageContainer) {
    const folderLike = /(?:^|[-_])folder(?:[-_]|$)/i.test(String(node.branch || ""));
    return {
      version: 1,
      kind: folderLike ? "folder" : "manual",
      memberNodeIds: [],
      childContainerNodeIds: [],
      memberBindings: imageContainerBindingsForNodeAssets(node),
      layoutOrigin: "manual",
      autoFit: true,
    };
  }
  return undefined;
}

export function nodeUsesImageContainer(node: ImageContainerNodeInput): boolean {
  return Boolean(imageContainerSpecForNode(node));
}

export function imageContainerKindForNode(node: ImageContainerNodeInput): ImageContainerKind | undefined {
  return imageContainerSpecForNode(node)?.kind;
}

export function applyImageContainerCompatibility(node: WorkflowNode): WorkflowNode {
  if (node.type !== "image" || node.layerGroup) {
    return {
      ...node,
      imageContainer: false,
      imageContainerSpec: undefined,
      imageCollection: undefined,
    };
  }
  const spec = imageContainerSpecForNode(node);
  if (!spec) return node;
  const collection = cloneImageContainerCollection(spec.collection ?? node.imageCollection);
  return {
    ...node,
    imageContainerSpec: spec,
    imageContainer: spec.kind !== "batch-result",
    imageCollection: collection,
  };
}

export function containerBoundarySummary(node: WorkflowNode): {
  kind?: ImageContainerKind;
  directMemberCount: number;
  childContainerCount: number;
  sourceLabel?: string;
  importBatchId?: string;
} {
  const spec = imageContainerSpecForNode(node);
  return {
    kind: spec?.kind,
    directMemberCount: spec?.memberNodeIds.length ?? 0,
    childContainerCount: spec?.childContainerNodeIds.length ?? 0,
    sourceLabel: spec?.sourceLabel,
    importBatchId: spec?.importBatchId,
  };
}
