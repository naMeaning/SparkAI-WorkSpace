import { imageAssetIdentityFingerprint } from "./core.ts";
import type { WorkflowNode } from "./core.ts";
import { imageContainerSpecForNode } from "./image-container.ts";
import { requirementInputBindings } from "./requirement-graph.ts";

/**
 * Content-based fingerprint for reusable Requirement execution.
 *
 * Canvas node IDs and current container hosts are deliberately excluded: a
 * copied folder tree with the same content remains the same input. Asset
 * order, task role, folder boundaries, child-container order, and every
 * visible layer state remain part of the fingerprint because they materially
 * change how a reusable batch requirement is executed.
 */
export function stableRequirementSourceSignature(
  node: WorkflowNode,
  allNodes: readonly WorkflowNode[] = [node],
): string {
  const nodeById = new Map(allNodes.map((candidate) => [candidate.id, candidate]));
  if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  const assetState = (owner: WorkflowNode, assetIndex: number, role?: "source" | "reference") => {
    const asset = owner.assets?.[assetIndex];
    if (!asset) return "";
    return `${imageAssetIdentityFingerprint(asset, assetIndex + 1)}:${role || asset.taskRole || "source"}`;
  };
  const containerState = (current: WorkflowNode, active = new Set<string>()): string => {
    if (active.has(current.id)) return "cycle";
    const canonical = nodeById.get(current.id) ?? current;
    const spec = imageContainerSpecForNode(canonical);
    if (!spec) {
      return `image[${(canonical.assets ?? []).map((_asset, index) => assetState(canonical, index)).join(",")}]`;
    }
    const nextActive = new Set(active).add(canonical.id);
    const bindingAssets = spec.memberBindings.map((binding) => {
      const owner = nodeById.get(binding.nodeId) ?? (binding.nodeId === canonical.id ? canonical : undefined);
      return owner ? assetState(owner, binding.assetIndex, binding.role) : "";
    }).filter(Boolean);
    const fallbackDirectNodes = [
      canonical,
      ...spec.memberNodeIds.map((id) => nodeById.get(id)).filter((candidate): candidate is WorkflowNode => Boolean(candidate)),
    ];
    const directAssets = bindingAssets.length
      ? bindingAssets
      : fallbackDirectNodes.flatMap((owner) => (owner.assets ?? []).map((_asset, index) => assetState(owner, index)));
    const children = spec.childContainerNodeIds.map((id) => {
      const child = nodeById.get(id);
      return child ? containerState(child, nextActive) : "missing-child";
    });
    return [
      `container:${spec.kind}`,
      `host:${spec.hostContentKind || "none"}`,
      `label:${spec.sourceLabel || ""}`,
      `direct[${directAssets.join(",")}]`,
      `children[${children.join(",")}]`,
    ].join("|");
  };
  const layerMembers = node.layerGroup?.id
    ? allNodes
        .filter((candidate) => candidate.layerGroup?.id === node.layerGroup?.id)
        .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0))
    : [];
  const layerState = layerMembers.map((member, memberIndex) => {
    const layer = member.layerGroup!;
    const fingerprints = (member.assets ?? []).map((asset, assetIndex) => imageAssetIdentityFingerprint(asset, assetIndex + 1));
    return [
      `layer:${memberIndex + 1}`,
      `order:${Number(layer.order ?? memberIndex + 1)}`,
      `visible:${layer.visible === false ? 0 : 1}`,
      `opacity:${Math.round(Number(layer.opacity ?? 1) * 1000) / 1000}`,
      `blend:${layer.blendMode || "normal"}`,
      `assets:${fingerprints.join(",")}`,
    ].join("|");
  });
  const sourceState = containerState(nodeById.get(node.id) ?? node);
  return imageAssetIdentityFingerprint({
    url: `requirement-source:v3|source:${sourceState}|layers:${layerState.join("|")}`,
  }, 1);
}

/** Stable digest for every explicitly connected Requirement input and its task role. */
export function stableRequirementInputSignature(
  requirementNode: WorkflowNode,
  allNodes: readonly WorkflowNode[],
): string {
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const material = requirementInputBindings(requirementNode, allNodes).map((binding, index) => {
    const node = nodeById.get(binding.nodeId);
    return node
      ? `${index + 1}:${binding.role}:${stableRequirementSourceSignature(node, allNodes)}`
      : `${index + 1}:${binding.role}:missing`;
  });
  return imageAssetIdentityFingerprint({ url: `requirement-inputs:v1|${material.join("|")}` }, 1);
}
