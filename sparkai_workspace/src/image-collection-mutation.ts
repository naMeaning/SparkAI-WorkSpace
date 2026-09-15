import { stableImageAssetId, stableImageOccurrenceId, stableIdentityHash } from "./asset-identity.ts";
import {
  imageContainerBindingsForNodeAssets,
  imageContainerSpecForNode,
} from "./image-container-spec.ts";
import type { ImageAsset, ImageCollection, ImageCollectionItem, WorkflowNode } from "./core.ts";

export const IMAGE_COLLECTION_NAME_MAX_LENGTH = 80;

export type ImageCollectionMutationErrorCode =
  | "INVALID_ARGUMENT"
  | "COLLECTION_NOT_FOUND"
  | "COLLECTION_NOT_REPLACEABLE"
  | "COLLECTION_ITEM_NOT_FOUND"
  | "COLLECTION_ITEM_AMBIGUOUS"
  | "COLLECTION_ITEM_NOT_READY"
  | "COLLECTION_ITEM_ALREADY_REPLACED"
  | "REPLACEMENT_ASSET_NOT_FOUND"
  | "REPLACEMENT_ASSET_NOT_READY"
  | "REPLACEMENT_ASSET_UNMANAGED"
  | "DUPLICATE_REPLACEMENT"
  | "DEFECT_COLLECTION_CONFLICT";

export class ImageCollectionMutationError extends Error {
  readonly code: ImageCollectionMutationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ImageCollectionMutationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ImageCollectionMutationError";
    this.code = code;
    this.details = details;
  }
}

export type RenameImageCollectionRequest = {
  collectionId: string;
  name: string;
};

export type ReplaceImageCollectionItemRequest = {
  sourceCollectionId: string;
  itemId?: string;
  requestIndex?: number;
  replacementNodeId: string;
  replacementAssetIndex: number;
  defectReason: string;
};

export type ImageCollectionRenameResult = {
  changed: boolean;
  nodes: WorkflowNode[];
  renamed: Array<{ nodeId: string; collectionId: string; name: string }>;
};

export type ImageCollectionReplacementResult = {
  changed: boolean;
  nodes: WorkflowNode[];
  replacements: Array<{
    sourceNodeId: string;
    sourceCollectionId: string;
    itemId: string;
    requestIndex: number;
    replacementAssetId: string;
    defectNodeId: string;
    defectCollectionId: string;
  }>;
};

const cleanIdentifier = (value: unknown, maximum = 160): string =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const collectionNameKey = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("en-US");

export function sanitizeImageCollectionName(value: unknown, fallback = "图片组"): string {
  const source = typeof value === "string" ? value.normalize("NFKC") : "";
  let name = source
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name) {
    name = String(fallback || "图片组")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim() || "图片组";
  }
  name = name.slice(0, IMAGE_COLLECTION_NAME_MAX_LENGTH).replace(/[. ]+$/g, "").trim() || "图片组";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  return name.slice(0, IMAGE_COLLECTION_NAME_MAX_LENGTH);
}

function uniqueCollectionName(requested: string, occupied: Set<string>): string {
  const base = sanitizeImageCollectionName(requested);
  let candidate = base;
  for (let suffix = 2; occupied.has(collectionNameKey(candidate)); suffix += 1) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, Math.max(1, IMAGE_COLLECTION_NAME_MAX_LENGTH - marker.length)).replace(/[. ]+$/g, "")}${marker}`;
  }
  occupied.add(collectionNameKey(candidate));
  return candidate;
}

function cloneCollection(collection: ImageCollection): ImageCollection {
  return {
    ...collection,
    items: collection.items.map((item) => ({
      ...item,
      taskProvenance: item.taskProvenance ? { ...item.taskProvenance } : undefined,
    })),
  };
}

function nodeCollection(node: WorkflowNode): ImageCollection | undefined {
  const collection = node.imageCollection ?? imageContainerSpecForNode(node)?.collection;
  return collection ? cloneCollection(collection) : undefined;
}

function withSynchronizedCollection(
  node: WorkflowNode,
  collection: ImageCollection,
  assets: ImageAsset[] = (node.assets ?? []).map((asset) => ({ ...asset })),
  title = node.title,
): WorkflowNode {
  const nextCollection = cloneCollection(collection);
  const nodeWithAssets: WorkflowNode = { ...node, title, assets, imageCollection: nextCollection };
  const currentSpec = imageContainerSpecForNode(nodeWithAssets);
  const imageContainerSpec = currentSpec ? {
    ...currentSpec,
    memberNodeIds: [...currentSpec.memberNodeIds],
    childContainerNodeIds: [...currentSpec.childContainerNodeIds],
    memberBindings: imageContainerBindingsForNodeAssets(nodeWithAssets, node.id, currentSpec.memberBindings),
    collection: cloneCollection(nextCollection),
  } : undefined;
  return {
    ...nodeWithAssets,
    imageContainerSpec,
    imageContainer: imageContainerSpec ? imageContainerSpec.kind !== "batch-result" : node.imageContainer,
    imageCollection: nextCollection,
  };
}

function collectionNodes(nodes: readonly WorkflowNode[]): Array<{ node: WorkflowNode; collection: ImageCollection }> {
  return nodes.flatMap((node) => {
    const collection = nodeCollection(node);
    return collection ? [{ node, collection }] : [];
  });
}

function collectionEntryById(nodes: readonly WorkflowNode[], collectionId: string) {
  const matches = collectionNodes(nodes).filter((entry) => entry.collection.id === collectionId);
  if (matches.length !== 1) {
    throw new ImageCollectionMutationError(
      "COLLECTION_NOT_FOUND",
      matches.length ? "图片组 ID 不唯一，整批操作未执行。" : "图片组不存在，整批操作未执行。",
      { collectionId, matchCount: matches.length },
    );
  }
  return matches[0];
}

export function renameImageCollections(
  nodes: readonly WorkflowNode[],
  requests: readonly RenameImageCollectionRequest[],
): ImageCollectionRenameResult {
  if (!requests.length) {
    throw new ImageCollectionMutationError("INVALID_ARGUMENT", "至少需要指定一个图片组。", { field: "requests" });
  }
  const requestedIds = requests.map((request) => cleanIdentifier(request.collectionId, 120));
  if (requestedIds.some((id) => !id) || new Set(requestedIds).size !== requestedIds.length) {
    throw new ImageCollectionMutationError("INVALID_ARGUMENT", "图片组 ID 不能为空或重复，整批操作未执行。", { field: "collectionId" });
  }

  const targets = requests.map((request, index) => ({
    ...collectionEntryById(nodes, requestedIds[index]),
    requestedName: request.name,
  }));
  const requestedSet = new Set(requestedIds);
  const occupied = new Set(
    collectionNodes(nodes)
      .filter(({ collection }) => !requestedSet.has(collection.id))
      .map(({ node, collection }) => collectionNameKey(sanitizeImageCollectionName(collection.name || node.title))),
  );
  const planned = targets.map((target) => ({
    ...target,
    name: uniqueCollectionName(target.requestedName, occupied),
  }));
  const namesByNodeId = new Map(planned.map((entry) => [entry.node.id, entry.name]));
  const collectionsByNodeId = new Map(planned.map((entry) => [entry.node.id, { ...entry.collection, name: entry.name }]));
  const changed = planned.some((entry) => entry.collection.name !== entry.name || entry.node.title !== entry.name);
  const nextNodes = changed
    ? nodes.map((node) => {
        const collection = collectionsByNodeId.get(node.id);
        return collection ? withSynchronizedCollection(node, collection, undefined, namesByNodeId.get(node.id) || node.title) : node;
      })
    : nodes.slice();
  return {
    changed,
    nodes: nextNodes,
    renamed: planned.map((entry) => ({ nodeId: entry.node.id, collectionId: entry.collection.id, name: entry.name })),
  };
}

function managedReplacementAsset(node: WorkflowNode, assetIndex: number): ImageAsset {
  if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex >= (node.assets?.length ?? 0)) {
    throw new ImageCollectionMutationError("REPLACEMENT_ASSET_NOT_FOUND", "替换图片槽位不存在，整批操作未执行。", {
      replacementNodeId: node.id,
      replacementAssetIndex: assetIndex,
    });
  }
  const asset = node.assets?.[assetIndex];
  if (!asset) {
    throw new ImageCollectionMutationError("REPLACEMENT_ASSET_NOT_FOUND", "替换图片不存在，整批操作未执行。", {
      replacementNodeId: node.id,
      replacementAssetIndex: assetIndex,
    });
  }
  if (asset.status === "pending" || asset.status === "error" || node.imageState === "generating") {
    throw new ImageCollectionMutationError("REPLACEMENT_ASSET_NOT_READY", "替换图片尚未完成，整批操作未执行。", {
      replacementNodeId: node.id,
      replacementAssetIndex: assetIndex,
    });
  }
  if (!asset.path && !asset.relativePath && !asset.assetUrl && !asset.url) {
    throw new ImageCollectionMutationError("REPLACEMENT_ASSET_UNMANAGED", "替换图片不是当前项目中的受管资产，整批操作未执行。", {
      replacementNodeId: node.id,
      replacementAssetIndex: assetIndex,
    });
  }
  return { ...asset, assetId: stableImageAssetId(asset, assetIndex + 1) };
}

function sourceItemForRequest(collection: ImageCollection, request: ReplaceImageCollectionItemRequest): ImageCollectionItem {
  const itemId = cleanIdentifier(request.itemId, 120);
  const requestedIndex = Number(request.requestIndex);
  const hasRequestIndex = Number.isInteger(requestedIndex) && requestedIndex >= 1 && requestedIndex <= 200;
  if (!itemId && !hasRequestIndex) {
    throw new ImageCollectionMutationError("INVALID_ARGUMENT", "替换图片时必须指定 itemId 或 requestIndex。", {
      sourceCollectionId: collection.id,
    });
  }
  const matches = collection.items.filter((item) => (
    (!itemId || item.id === itemId) && (!hasRequestIndex || item.requestIndex === requestedIndex)
  ));
  if (matches.length !== 1) {
    throw new ImageCollectionMutationError(
      matches.length ? "COLLECTION_ITEM_AMBIGUOUS" : "COLLECTION_ITEM_NOT_FOUND",
      matches.length ? "图片组槽位不唯一，整批操作未执行。" : "图片组槽位不存在，整批操作未执行。",
      { sourceCollectionId: collection.id, itemId: itemId || undefined, requestIndex: hasRequestIndex ? requestedIndex : undefined, matchCount: matches.length },
    );
  }
  return { ...matches[0], taskProvenance: matches[0].taskProvenance ? { ...matches[0].taskProvenance } : undefined };
}

function defectCollectionIdentity(sourceCollectionId: string): string {
  return `defects-${stableIdentityHash(sourceCollectionId).slice(0, 24)}`;
}

function defectNodeIdentity(sourceNodeId: string, sourceCollectionId: string, occupied: Set<string>): string {
  const base = `DEFECT-${stableIdentityHash(`${sourceNodeId}:${sourceCollectionId}`).slice(0, 12).toUpperCase()}`;
  if (!occupied.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
}

function findDefectEntry(nodes: readonly WorkflowNode[], sourceNodeId: string, sourceCollectionId: string) {
  const matches = collectionNodes(nodes).filter(({ collection }) => (
    collection.collectionRole === "defects" &&
    collection.sourceCollectionId === sourceCollectionId &&
    collection.defectOfNodeId === sourceNodeId
  ));
  if (matches.length > 1) {
    throw new ImageCollectionMutationError("DEFECT_COLLECTION_CONFLICT", "同一结果组存在多个瑕疵组，整批操作未执行。", {
      sourceNodeId,
      sourceCollectionId,
      defectNodeIds: matches.map(({ node }) => node.id),
    });
  }
  return matches[0];
}

type ValidatedReplacement = {
  request: ReplaceImageCollectionItemRequest;
  sourceNode: WorkflowNode;
  sourceCollection: ImageCollection;
  sourceItem: ImageCollectionItem;
  sourceAssetIndex: number;
  sourceAsset: ImageAsset;
  replacementAsset: ImageAsset;
  replacementAssetId: string;
  existingDefectNode?: WorkflowNode;
  existingDefectCollection?: ImageCollection;
  idempotent: boolean;
};

function validateReplacement(
  nodes: readonly WorkflowNode[],
  request: ReplaceImageCollectionItemRequest,
): ValidatedReplacement {
  const sourceCollectionId = cleanIdentifier(request.sourceCollectionId, 120);
  const replacementNodeId = cleanIdentifier(request.replacementNodeId, 160);
  if (!sourceCollectionId || !replacementNodeId) {
    throw new ImageCollectionMutationError("INVALID_ARGUMENT", "图片组和替换节点 ID 不能为空，整批操作未执行。", {
      fields: ["sourceCollectionId", "replacementNodeId"],
    });
  }
  const sourceEntry = collectionEntryById(nodes, sourceCollectionId);
  if (sourceEntry.collection.collectionRole === "defects") {
    throw new ImageCollectionMutationError("COLLECTION_NOT_REPLACEABLE", "瑕疵图片组不能作为替换目标。", { sourceCollectionId });
  }
  const sourceItem = sourceItemForRequest(sourceEntry.collection, request);
  if (sourceItem.status !== "done" || !Number.isInteger(sourceItem.assetIndex) || Number(sourceItem.assetIndex) < 1) {
    throw new ImageCollectionMutationError("COLLECTION_ITEM_NOT_READY", "目标图片槽位没有可替换的完成图片，整批操作未执行。", {
      sourceCollectionId,
      itemId: sourceItem.id,
      requestIndex: sourceItem.requestIndex,
    });
  }
  const sourceAssetIndex = Number(sourceItem.assetIndex) - 1;
  const sourceAsset = sourceEntry.node.assets?.[sourceAssetIndex];
  if (!sourceAsset || sourceAsset.status === "pending" || sourceAsset.status === "error") {
    throw new ImageCollectionMutationError("COLLECTION_ITEM_NOT_READY", "目标图片槽位与受管资产不一致，整批操作未执行。", {
      sourceCollectionId,
      itemId: sourceItem.id,
      assetIndex: sourceItem.assetIndex,
    });
  }
  const replacementNode = nodes.find((node) => node.id === replacementNodeId);
  if (!replacementNode) {
    throw new ImageCollectionMutationError("REPLACEMENT_ASSET_NOT_FOUND", "替换图片所在节点不存在，整批操作未执行。", { replacementNodeId });
  }
  const replacementAsset = managedReplacementAsset(replacementNode, Number(request.replacementAssetIndex));
  const replacementAssetId = stableImageAssetId(replacementAsset, Number(request.replacementAssetIndex) + 1);
  const defectEntry = findDefectEntry(nodes, sourceEntry.node.id, sourceCollectionId);
  const existingDefectItem = defectEntry?.collection.items.find((item) => item.replacesItemId === sourceItem.id);
  const currentAssetId = stableImageAssetId(sourceAsset, sourceAssetIndex + 1);
  const idempotent = sourceItem.replacedByAssetId === replacementAssetId && currentAssetId === replacementAssetId;
  if (sourceItem.replacedByAssetId && !idempotent) {
    throw new ImageCollectionMutationError("COLLECTION_ITEM_ALREADY_REPLACED", "目标槽位已经使用另一张图片替换，整批操作未执行。", {
      sourceCollectionId,
      itemId: sourceItem.id,
      replacedByAssetId: sourceItem.replacedByAssetId,
    });
  }
  if (idempotent && !existingDefectItem) {
    throw new ImageCollectionMutationError("DEFECT_COLLECTION_CONFLICT", "替换记录缺少对应瑕疵图片，整批操作未执行。", {
      sourceCollectionId,
      itemId: sourceItem.id,
    });
  }
  return {
    request,
    sourceNode: sourceEntry.node,
    sourceCollection: sourceEntry.collection,
    sourceItem,
    sourceAssetIndex,
    sourceAsset: { ...sourceAsset },
    replacementAsset,
    replacementAssetId,
    existingDefectNode: defectEntry?.node,
    existingDefectCollection: defectEntry?.collection,
    idempotent,
  };
}

export function replaceImageCollectionItems(
  nodes: readonly WorkflowNode[],
  requests: readonly ReplaceImageCollectionItemRequest[],
  options: { createdAt?: string } = {},
): ImageCollectionReplacementResult {
  if (!requests.length) {
    throw new ImageCollectionMutationError("INVALID_ARGUMENT", "至少需要指定一个图片替换操作。", { field: "requests" });
  }
  const validated = requests.map((request) => validateReplacement(nodes, request));
  const targetKeys = validated.map((entry) => `${entry.sourceCollection.id}:${entry.sourceItem.id}`);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new ImageCollectionMutationError("DUPLICATE_REPLACEMENT", "同一图片槽位在批次中出现多次，整批操作未执行。", {
      targets: targetKeys,
    });
  }
  if (validated.every((entry) => entry.idempotent)) {
    return {
      changed: false,
      nodes: nodes.slice(),
      replacements: validated.map((entry) => ({
        sourceNodeId: entry.sourceNode.id,
        sourceCollectionId: entry.sourceCollection.id,
        itemId: entry.sourceItem.id,
        requestIndex: entry.sourceItem.requestIndex ?? entry.sourceAssetIndex + 1,
        replacementAssetId: entry.replacementAssetId,
        defectNodeId: entry.existingDefectNode!.id,
        defectCollectionId: entry.existingDefectCollection!.id,
      })),
    };
  }

  const createdAt = cleanIdentifier(options.createdAt, 80) || new Date().toISOString();
  const occupiedNodeIds = new Set(nodes.map((node) => node.id));
  const working = nodes.map((node) => ({ ...node }));
  const nodeIndexById = new Map(working.map((node, index) => [node.id, index]));
  const replacementResults: ImageCollectionReplacementResult["replacements"] = [];

  for (const entry of validated) {
    if (entry.idempotent) {
      replacementResults.push({
        sourceNodeId: entry.sourceNode.id,
        sourceCollectionId: entry.sourceCollection.id,
        itemId: entry.sourceItem.id,
        requestIndex: entry.sourceItem.requestIndex ?? entry.sourceAssetIndex + 1,
        replacementAssetId: entry.replacementAssetId,
        defectNodeId: entry.existingDefectNode!.id,
        defectCollectionId: entry.existingDefectCollection!.id,
      });
      continue;
    }

    const sourceIndex = nodeIndexById.get(entry.sourceNode.id);
    if (sourceIndex === undefined) throw new ImageCollectionMutationError("COLLECTION_NOT_FOUND", "图片组节点在事务中消失。", { nodeId: entry.sourceNode.id });
    const currentSource = working[sourceIndex];
    const currentCollection = nodeCollection(currentSource)!;
    const originalAsset = currentSource.assets?.[entry.sourceAssetIndex];
    if (!originalAsset) throw new ImageCollectionMutationError("COLLECTION_ITEM_NOT_READY", "目标图片在事务中消失。", { nodeId: currentSource.id });
    const replacementOccurrenceId = entry.sourceItem.occurrenceId
      || originalAsset.occurrenceId
      || stableImageOccurrenceId(originalAsset, currentSource.id, entry.sourceAssetIndex);
    const replacementAsset: ImageAsset = {
      ...entry.replacementAsset,
      assetId: entry.replacementAssetId,
      occurrenceId: replacementOccurrenceId,
      index: originalAsset.index ?? entry.sourceItem.requestIndex ?? entry.sourceAssetIndex + 1,
      prompt: entry.sourceItem.prompt || entry.replacementAsset.prompt,
      title: entry.sourceItem.title || entry.replacementAsset.title,
      status: "done",
    };
    const sourceAssets = (currentSource.assets ?? []).map((asset, index) => index === entry.sourceAssetIndex ? replacementAsset : { ...asset });
    const sourceCollection: ImageCollection = {
      ...currentCollection,
      items: currentCollection.items.map((item) => item.id === entry.sourceItem.id ? {
        ...item,
        assetIndex: entry.sourceAssetIndex + 1,
        assetId: entry.replacementAssetId,
        occurrenceId: replacementOccurrenceId,
        replacedByAssetId: entry.replacementAssetId,
        status: "done",
        error: undefined,
      } : { ...item }),
    };
    working[sourceIndex] = withSynchronizedCollection(currentSource, sourceCollection, sourceAssets, currentSource.title);

    let defectNode = working.find((node) => {
      const collection = nodeCollection(node);
      return collection?.collectionRole === "defects" && collection.sourceCollectionId === entry.sourceCollection.id && collection.defectOfNodeId === entry.sourceNode.id;
    });
    let defectCollection = defectNode ? nodeCollection(defectNode)! : undefined;
    if (!defectNode || !defectCollection) {
      const defectNodeId = defectNodeIdentity(entry.sourceNode.id, entry.sourceCollection.id, occupiedNodeIds);
      occupiedNodeIds.add(defectNodeId);
      const defaultName = sanitizeImageCollectionName(`${entry.sourceCollection.name || entry.sourceNode.title || "图片组"} - 瑕疵`, "瑕疵图片组");
      defectCollection = {
        id: defectCollectionIdentity(entry.sourceCollection.id),
        name: defaultName,
        kind: entry.sourceCollection.kind,
        collectionRole: "defects",
        generationMode: entry.sourceCollection.generationMode,
        items: [],
        sourceNodeId: entry.sourceCollection.sourceNodeId,
        sourceCollectionId: entry.sourceCollection.id,
        defectOfNodeId: entry.sourceNode.id,
        createdAt,
        autoFit: true,
      };
      defectNode = {
        id: defectNodeId,
        displayCode: defectNodeId,
        title: defaultName,
        prompt: entry.sourceNode.prompt || "被替换图片的瑕疵记录。",
        type: "image",
        status: "done",
        x: entry.sourceNode.x + Math.max(360, Number(entry.sourceNode.width ?? 0) + 48),
        y: entry.sourceNode.y,
        branch: "image-collection-defects",
        outputs: 0,
        createdAt,
        assets: [],
        imageState: "done",
        imageCollection: defectCollection,
      };
      defectNode = withSynchronizedCollection(defectNode, defectCollection, [], defaultName);
      nodeIndexById.set(defectNode.id, working.length);
      working.push(defectNode);
    }

    const defectIndex = nodeIndexById.get(defectNode.id)!;
    const currentDefectNode = working[defectIndex];
    const currentDefectCollection = nodeCollection(currentDefectNode)!;
    const existingDefectItem = currentDefectCollection.items.find((item) => item.replacesItemId === entry.sourceItem.id);
    if (!existingDefectItem) {
      const defectAssetIndex = (currentDefectNode.assets?.length ?? 0) + 1;
      const defectAsset = { ...originalAsset, status: "done" as const };
      const defectItem: ImageCollectionItem = {
        ...entry.sourceItem,
        id: `defect-${stableIdentityHash(`${entry.sourceCollection.id}:${entry.sourceItem.id}`).slice(0, 24)}`,
        assetIndex: defectAssetIndex,
        assetId: stableImageAssetId(defectAsset, defectAssetIndex),
        occurrenceId: stableImageOccurrenceId(defectAsset, currentDefectNode.id, defectAssetIndex - 1),
        replacedByAssetId: undefined,
        replacesItemId: entry.sourceItem.id,
        defectReason: cleanIdentifier(entry.request.defectReason, 320) || "图片已被替换。",
        status: "done",
        error: undefined,
      };
      const defectAssets = [...(currentDefectNode.assets ?? []).map((asset) => ({ ...asset })), {
        ...defectAsset,
        assetId: defectItem.assetId,
        occurrenceId: defectItem.occurrenceId,
        index: entry.sourceItem.requestIndex ?? defectAssetIndex,
        prompt: entry.sourceItem.prompt || defectAsset.prompt,
        title: entry.sourceItem.title || defectAsset.title,
      }];
      const nextDefectCollection = {
        ...currentDefectCollection,
        items: [...currentDefectCollection.items.map((item) => ({ ...item })), defectItem],
      };
      working[defectIndex] = withSynchronizedCollection(
        { ...currentDefectNode, outputs: defectAssets.length, imageProgress: {
          total: defectAssets.length,
          completed: defectAssets.length,
          failed: 0,
          failedSlots: [],
          message: `已保留 ${defectAssets.length} 张被替换图片`,
        } },
        nextDefectCollection,
        defectAssets,
        currentDefectNode.title,
      );
    }

    replacementResults.push({
      sourceNodeId: entry.sourceNode.id,
      sourceCollectionId: entry.sourceCollection.id,
      itemId: entry.sourceItem.id,
      requestIndex: entry.sourceItem.requestIndex ?? entry.sourceAssetIndex + 1,
      replacementAssetId: entry.replacementAssetId,
      defectNodeId: working[defectIndex].id,
      defectCollectionId: nodeCollection(working[defectIndex])!.id,
    });
  }

  return { changed: true, nodes: working, replacements: replacementResults };
}
