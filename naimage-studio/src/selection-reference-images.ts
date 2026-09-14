import {
  MAX_REFERENCE_IMAGES,
  imageAssetName,
  mergeReferenceImages,
  mimeTypeFromPath,
  type ReferenceImage,
  type WorkflowNode
} from "./core.ts";
import { imageContainerSpecForNode, nodeUsesImageContainer } from "./image-container-spec.ts";

export function canvasNodePresentsImageContainer(node: WorkflowNode | null | undefined): boolean {
  if (!node || node.type !== "image" || node.layerGroup) return false;
  if (nodeUsesImageContainer(node)) return true;
  return (node.assets?.length ?? 0) > 1;
}

function assetMatchesBinding(asset: NonNullable<WorkflowNode["assets"]>[number], index: number, binding: { assetId?: string; assetIndex?: number }) {
  if (binding.assetId && asset.assetId === binding.assetId) return true;
  return Number.isInteger(binding.assetIndex) && binding.assetIndex === index;
}

export function referenceImagesFromCanvasNode(node: WorkflowNode, max = MAX_REFERENCE_IMAGES): ReferenceImage[] {
  const assets = node.assets ?? [];
  const spec = imageContainerSpecForNode(node);
  const ordered = spec?.memberBindings?.length
    ? spec.memberBindings
      .map((binding, slot) => assets.find((asset, index) => assetMatchesBinding(asset, index, binding)) ?? assets[binding.assetIndex] ?? assets[slot])
      .filter((asset): asset is NonNullable<WorkflowNode["assets"]>[number] => Boolean(asset))
    : assets;
  const seen = new Set<string>();
  const images: ReferenceImage[] = [];
  for (const [index, asset] of ordered.entries()) {
    const path = String(asset.path || "").trim();
    const relativePath = String(asset.relativePath || "").trim();
    const assetUrl = String(asset.assetUrl || asset.url || "").trim();
    if (!path && !relativePath && !assetUrl) continue;
    const key = asset.assetId
      || asset.occurrenceId
      || asset.contentHash
      || relativePath.replace(/\\/g, "/").toLowerCase()
      || path.replace(/\\/g, "/").toLowerCase()
      || assetUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({
      assetId: asset.assetId,
      occurrenceId: asset.occurrenceId,
      importBatchId: asset.importBatchId,
      importRootId: asset.importRootId,
      sourceRelativePath: asset.sourceRelativePath,
      sourceRootLabel: asset.sourceRootLabel,
      sourceRootKind: asset.sourceRootKind,
      displayCode: asset.displayCode || `REF${images.length + 1}`,
      contentHash: asset.contentHash,
      taskRole: "reference",
      name: imageAssetName(asset) || `参考图 ${images.length + 1}`,
      path,
      relativePath: relativePath || undefined,
      mimeType: mimeTypeFromPath(path || relativePath),
      assetUrl: assetUrl || undefined,
      role: "reference",
      purpose: `选中图片容器第 ${index + 1} 张`
    });
    if (images.length >= max) break;
  }
  return images;
}

export function referenceImagesFromSelectedCanvasNodes(nodes: WorkflowNode[], max = MAX_REFERENCE_IMAGES): ReferenceImage[] {
  const collected: ReferenceImage[] = [];
  for (const node of nodes) {
    if (!canvasNodePresentsImageContainer(node)) continue;
    const remaining = max - collected.length;
    if (remaining <= 0) break;
    collected.push(...referenceImagesFromCanvasNode(node, remaining));
  }
  return collected.slice(0, max);
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
