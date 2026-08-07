import type {
  AssetTaskRole,
  CanvasRequirement,
  CanvasRequirementInputBinding,
  WorkflowNode,
} from "./core.ts";

function uniqueBindings(bindings: readonly CanvasRequirementInputBinding[]) {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const nodeId = String(binding.nodeId || "").trim();
    if (!nodeId || seen.has(nodeId)) return false;
    seen.add(nodeId);
    return true;
  }).map((binding) => ({ nodeId: String(binding.nodeId).trim(), role: binding.role }));
}

export function sanitizeRequirementInputBindings(value: unknown): CanvasRequirementInputBinding[] {
  if (!Array.isArray(value)) return [];
  return uniqueBindings(value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Partial<CanvasRequirementInputBinding>;
    const nodeId = typeof source.nodeId === "string" ? source.nodeId.trim().slice(0, 160) : "";
    const role = source.role === "reference" ? "reference" : source.role === "source" ? "source" : null;
    return nodeId && role ? [{ nodeId, role }] : [];
  })).slice(0, 240);
}

export function requirementInputRoleForNode(node: WorkflowNode | null | undefined): AssetTaskRole {
  if (!node) return "source";
  if (node.imageContainerRole === "reference") return "reference";
  if (node.imageContainerRole === "source") return "source";
  const roles = new Set((node.assets ?? []).map((asset) => asset.taskRole).filter(Boolean));
  return roles.size === 1 && roles.has("reference") ? "reference" : "source";
}

export function requirementInputBindings(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
  nodeById?: ReadonlyMap<string, WorkflowNode>,
): CanvasRequirementInputBinding[] {
  const explicit = sanitizeRequirementInputBindings(node.requirement?.inputBindings);
  if (explicit.length) return explicit;
  const parentId = String(node.parentId || "").trim();
  if (!parentId) return [];
  return [{
    nodeId: parentId,
    role: requirementInputRoleForNode(nodeById?.get(parentId) ?? allNodes.find((candidate) => candidate.id === parentId)),
  }];
}

export function requirementInputNodeIds(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
) {
  return requirementInputBindings(node, allNodes).map((binding) => binding.nodeId);
}

export function requirementInputRoleMap(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
) {
  return Object.fromEntries(requirementInputBindings(node, allNodes).map((binding) => [binding.nodeId, binding.role])) as Record<string, AssetTaskRole>;
}

export function primaryRequirementInputNodeId(bindings: readonly CanvasRequirementInputBinding[]) {
  return bindings.find((binding) => binding.role === "source")?.nodeId || bindings[0]?.nodeId || "";
}

export function upsertRequirementInputBinding(
  requirement: CanvasRequirement,
  binding: CanvasRequirementInputBinding,
): CanvasRequirement {
  const current = sanitizeRequirementInputBindings(requirement.inputBindings);
  const index = current.findIndex((item) => item.nodeId === binding.nodeId);
  const next = index >= 0
    ? current.map((item, itemIndex) => itemIndex === index ? { ...binding } : item)
    : [...current, { ...binding }];
  return {
    ...requirement,
    version: 2,
    inputBindings: uniqueBindings(next),
    lastError: undefined,
  };
}

export function removeRequirementInputBindings(
  requirement: CanvasRequirement,
  nodeIds?: ReadonlySet<string>,
): CanvasRequirement {
  const current = sanitizeRequirementInputBindings(requirement.inputBindings);
  const inputBindings = nodeIds ? current.filter((binding) => !nodeIds.has(binding.nodeId)) : [];
  return {
    ...requirement,
    version: 2,
    inputBindings,
    lastError: undefined,
  };
}
