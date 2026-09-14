import {
  MAX_AGENT_SOURCE_IMAGES,
  MAX_REFERENCE_IMAGES,
  imageAssetName,
  mergeReferenceImages,
  mimeTypeFromPath,
  type ReferenceImage,
  type WorkflowNode
} from "./core.ts";
import { imageContainerSpecForNode, nodeUsesImageContainer } from "./image-container-spec.ts";

export type ComposerMaterialRole = "source" | "reference";
export type ComposerMaterialOrigin = "canvas" | "upload";

export type ComposerMaterialOverride = {
  sequence?: number;
  role?: ComposerMaterialRole;
  excluded?: boolean;
};

export type ComposerMaterialItem = {
  key: string;
  origin: ComposerMaterialOrigin;
  nodeId?: string;
  assetIndex: number;
  role: ComposerMaterialRole;
  sequence: number;
  name: string;
  reference: ReferenceImage;
};

function assetMatchesBinding(asset: NonNullable<WorkflowNode["assets"]>[number], index: number, binding: { assetId?: string; assetIndex?: number }) {
  if (binding.assetId && asset.assetId === binding.assetId) return true;
  return Number.isInteger(binding.assetIndex) && binding.assetIndex === index;
}

export function canvasNodePresentsImageContainer(node: WorkflowNode | null | undefined): boolean {
  if (!node || node.type !== "image" || node.layerGroup) return false;
  if (nodeUsesImageContainer(node)) return true;
  return (node.assets?.length ?? 0) > 1;
}

export function composerMaterialKey(origin: ComposerMaterialOrigin, nodeId: string | undefined, assetIndex: number, fallbackId = "") {
  if (origin === "canvas" && nodeId) return `canvas:${nodeId}:${assetIndex}`;
  return `upload:${fallbackId || assetIndex}`;
}

export function defaultComposerMaterialRole(
  node: WorkflowNode,
  asset?: NonNullable<WorkflowNode["assets"]>[number],
  assetIndex = 0
): ComposerMaterialRole {
  const spec = imageContainerSpecForNode(node);
  const binding = spec?.memberBindings?.find((item) => item.assetId && asset?.assetId && item.assetId === asset.assetId)
    || spec?.memberBindings?.[assetIndex];
  if (binding?.role === "source" || binding?.role === "reference") return binding.role;
  if (asset?.taskRole === "source" || asset?.taskRole === "reference") return asset.taskRole;
  if (node.imageContainerRole === "source" || node.imageContainerRole === "reference") return node.imageContainerRole;
  if (!canvasNodePresentsImageContainer(node) && (node.imageParams || node.parentId)) return "source";
  return "reference";
}

function referenceFromAsset(
  node: WorkflowNode,
  asset: NonNullable<WorkflowNode["assets"]>[number],
  assetIndex: number,
  role: ComposerMaterialRole,
  slot = assetIndex
): ReferenceImage | null {
  const path = String(asset.path || "").trim();
  const relativePath = String(asset.relativePath || "").trim();
  const assetUrl = String(asset.assetUrl || asset.url || "").trim();
  if (!path && !relativePath && !assetUrl) return null;
  return {
    assetId: asset.assetId,
    occurrenceId: asset.occurrenceId,
    importBatchId: asset.importBatchId,
    importRootId: asset.importRootId,
    sourceRelativePath: asset.sourceRelativePath,
    sourceRootLabel: asset.sourceRootLabel,
    sourceRootKind: asset.sourceRootKind,
    displayCode: asset.displayCode,
    contentHash: asset.contentHash,
    taskRole: role,
    name: imageAssetName(asset) || `${role === "source" ? "原图" : "参考图"} ${assetIndex + 1}`,
    path,
    relativePath: relativePath || undefined,
    mimeType: mimeTypeFromPath(path || relativePath),
    assetUrl: assetUrl || undefined,
    role,
    purpose: canvasNodePresentsImageContainer(node) ? `选中图片容器第 ${slot + 1} 张` : "选中画布图片"
  };
}

function orderedAssetsForNode(node: WorkflowNode): Array<{ asset: NonNullable<WorkflowNode["assets"]>[number]; assetIndex: number }> {
  const assets = node.assets ?? [];
  const spec = imageContainerSpecForNode(node);
  if (!spec?.memberBindings?.length) {
    return assets.map((asset, assetIndex) => ({ asset, assetIndex }));
  }
  const used = new Set<number>();
  const ordered: Array<{ asset: NonNullable<WorkflowNode["assets"]>[number]; assetIndex: number }> = [];
  for (const [slot, binding] of spec.memberBindings.entries()) {
    const assetIndex = assets.findIndex((asset, index) => assetMatchesBinding(asset, index, binding));
    const resolvedIndex = assetIndex >= 0 ? assetIndex : (Number.isInteger(binding.assetIndex) ? binding.assetIndex : slot);
    if (!Number.isInteger(resolvedIndex) || resolvedIndex < 0 || resolvedIndex >= assets.length || used.has(resolvedIndex)) continue;
    used.add(resolvedIndex);
    ordered.push({ asset: assets[resolvedIndex], assetIndex: resolvedIndex });
  }
  assets.forEach((asset, assetIndex) => {
    if (used.has(assetIndex)) return;
    ordered.push({ asset, assetIndex });
  });
  return ordered;
}

export function flattenSelectedCanvasMaterials(nodes: WorkflowNode[]): ComposerMaterialItem[] {
  const items: ComposerMaterialItem[] = [];
  for (const node of nodes) {
    if (node.type !== "image" || node.layerGroup) continue;
    const ordered = orderedAssetsForNode(node);
    if (!ordered.length) continue;
    for (const [slot, { asset, assetIndex }] of ordered.entries()) {
      const role = defaultComposerMaterialRole(node, asset, assetIndex);
      const reference = referenceFromAsset(node, asset, assetIndex, role, slot);
      if (!reference) continue;
      items.push({
        key: composerMaterialKey("canvas", node.id, assetIndex),
        origin: "canvas",
        nodeId: node.id,
        assetIndex,
        role,
        sequence: items.length + 1,
        name: reference.name,
        reference
      });
    }
  }
  return items;
}

function uploadMaterial(image: ReferenceImage, role: ComposerMaterialRole, index: number): ComposerMaterialItem {
  const fallbackId = String(image.assetId || image.occurrenceId || image.path || image.assetUrl || index);
  return {
    key: composerMaterialKey("upload", undefined, index, `${role}:${fallbackId}`),
    origin: "upload",
    assetIndex: index,
    role,
    sequence: index + 1,
    name: image.name || `${role === "source" ? "原图" : "参考图"} ${index + 1}`,
    reference: { ...image, taskRole: role, role }
  };
}

export function applyComposerMaterialOverrides(
  items: ComposerMaterialItem[],
  overrides: Record<string, ComposerMaterialOverride> = {}
): ComposerMaterialItem[] {
  const next: ComposerMaterialItem[] = [];
  items.forEach((item, index) => {
    const override = overrides[item.key] || {};
    if (override.excluded) return;
    const role: ComposerMaterialRole = override.role === "source" || override.role === "reference" ? override.role : item.role;
    const sequence = Number.isInteger(override.sequence) && Number(override.sequence) > 0
      ? Math.floor(Number(override.sequence))
      : index + 1;
    next.push({
      ...item,
      role,
      sequence,
      reference: {
        ...item.reference,
        taskRole: role,
        role,
        displayCode: `${role === "source" ? "SRC" : "REF"}${sequence}`
      }
    });
  });
  next.sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name, "zh-CN"));
  return next;
}

export function buildComposerMaterials(
  selectedNodes: WorkflowNode[],
  uploadedSources: ReferenceImage[] = [],
  uploadedReferences: ReferenceImage[] = [],
  overrides: Record<string, ComposerMaterialOverride> = {}
): ComposerMaterialItem[] {
  const canvasItems = flattenSelectedCanvasMaterials(selectedNodes);
  const canvasKeys = new Set(canvasItems.map((item) => `${item.reference.assetId || ""}|${item.reference.path || ""}|${item.reference.assetUrl || ""}`));
  const unusedUpload = (image: ReferenceImage) => {
    const key = `${image.assetId || ""}|${image.path || ""}|${image.assetUrl || ""}`;
    return !canvasKeys.has(key);
  };
  const uploads = [
    ...uploadedSources.filter(unusedUpload).map((image, index) => uploadMaterial(image, "source", index)),
    ...uploadedReferences.filter(unusedUpload).map((image, index) => uploadMaterial(image, "reference", index + uploadedSources.length))
  ];
  return applyComposerMaterialOverrides([...canvasItems, ...uploads], overrides);
}

export function splitComposerMaterials(items: ComposerMaterialItem[]) {
  const ordered = applyComposerMaterialOverrides(items);
  const sourceItems = ordered.filter((item) => item.role === "source").slice(0, MAX_AGENT_SOURCE_IMAGES);
  const referenceItems = ordered.filter((item) => item.role === "reference").slice(0, MAX_REFERENCE_IMAGES);
  return {
    sourceImages: sourceItems.map((item, index) => ({
      ...item.reference,
      displayCode: item.reference.displayCode || `SRC${index + 1}`,
      taskRole: "source" as const
    })),
    referenceImages: referenceItems.map((item, index) => ({
      ...item.reference,
      displayCode: item.reference.displayCode || `REF${index + 1}`,
      taskRole: "reference" as const
    })),
    sourceNodeIds: [...new Set(sourceItems.map((item) => item.nodeId).filter((id): id is string => Boolean(id)))],
    referenceNodeIds: [...new Set(referenceItems.map((item) => item.nodeId).filter((id): id is string => Boolean(id)))]
  };
}

export function referenceImagesFromCanvasNode(node: WorkflowNode, max = MAX_REFERENCE_IMAGES): ReferenceImage[] {
  return flattenSelectedCanvasMaterials([node])
    .map((item) => ({ ...item.reference, taskRole: "reference" as const, role: "reference" }))
    .slice(0, max);
}

export function referenceImagesFromSelectedCanvasNodes(nodes: WorkflowNode[], max = MAX_REFERENCE_IMAGES): ReferenceImage[] {
  return flattenSelectedCanvasMaterials(nodes)
    .map((item) => ({ ...item.reference, taskRole: "reference" as const, role: "reference" }))
    .slice(0, max);
}

export function mergeSelectionAndUploadedReferences(
  selection: ReferenceImage[],
  uploaded: ReferenceImage[],
  max = MAX_REFERENCE_IMAGES
): ReferenceImage[] {
  return mergeReferenceImages(selection, uploaded, max).map((image, index) => ({
    ...image,
    taskRole: "reference",
    displayCode: image.displayCode || `REF${index + 1}`
  }));
}

export function sequenceByMaterialKey(items: ComposerMaterialItem[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.key, item.sequence]));
}
