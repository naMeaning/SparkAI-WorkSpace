import { automationCommandError } from "./automation-command-errors.ts";
import type { AssetTaskRole, WorkflowNode } from "./core.ts";
import {
  primaryRequirementInputNodeId,
  removeRequirementInputBindings,
  requirementInputBindings,
  requirementInputRoleForNode,
  upsertRequirementInputBinding,
} from "./requirement-graph.ts";

export type CanvasRelationEdge = {
  sourceId: string;
  targetId: string;
  relationType?: WorkflowNode["relationType"];
  inputRole?: AssetTaskRole;
};

export type CanvasRelationMutationResult = {
  changed: boolean;
  nodes: WorkflowNode[];
  affectedNodeIds: string[];
  edges: Array<Required<Pick<CanvasRelationEdge, "sourceId" | "targetId">> & {
    relationType: NonNullable<WorkflowNode["relationType"]>;
    inputRole?: AssetTaskRole;
  }>;
};

const RELATION_TYPES = new Set<NonNullable<WorkflowNode["relationType"]>>([
  "derived-from",
  "referenced",
  "variant",
  "grouped",
]);

const cleanId = (value: unknown): string => String(value ?? "").trim().slice(0, 160);

function relationEdges(nodes: readonly WorkflowNode[]): Array<{ sourceId: string; targetId: string }> {
  const result: Array<{ sourceId: string; targetId: string }> = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const sources = node.type === "requirement"
      ? requirementInputBindings(node, nodes).map((binding) => binding.nodeId)
      : node.parentId ? [node.parentId] : [];
    for (const sourceId of sources) {
      const key = `${sourceId}\u0000${node.id}`;
      if (!sourceId || seen.has(key)) continue;
      seen.add(key);
      result.push({ sourceId, targetId: node.id });
    }
  }
  return result;
}

export function assertCanvasRelationGraphAcyclic(nodes: readonly WorkflowNode[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of relationEdges(nodes)) {
    if (!adjacency.has(edge.sourceId) || !adjacency.has(edge.targetId)) continue;
    adjacency.get(edge.sourceId)!.push(edge.targetId);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string, path: string[]): void => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = [...path.slice(Math.max(0, cycleStart)), nodeId];
      throw automationCommandError("GRAPH_CYCLE", "连线会形成循环，整批操作未执行。", { cycle });
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const childId of adjacency.get(nodeId) ?? []) visit(childId, [...path, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of adjacency.keys()) visit(nodeId, []);
}

function normalizedEdges(edges: readonly CanvasRelationEdge[]): CanvasRelationEdge[] {
  if (!Array.isArray(edges) || edges.length === 0) {
    throw automationCommandError("INVALID_ARGUMENT", "edges 至少需要一条连线。", { field: "edges" });
  }
  if (edges.length > 240) {
    throw automationCommandError("INVALID_ARGUMENT", "单次最多处理 240 条连线。", { field: "edges", maximum: 240 });
  }
  const result: CanvasRelationEdge[] = [];
  const seen = new Map<string, CanvasRelationEdge>();
  for (const raw of edges) {
    const sourceId = cleanId(raw?.sourceId);
    const targetId = cleanId(raw?.targetId);
    if (!sourceId || !targetId || sourceId === targetId) {
      throw automationCommandError("INVALID_ARGUMENT", "连线必须包含不同的 sourceId 与 targetId。", { sourceId, targetId });
    }
    if (raw.inputRole !== undefined && raw.inputRole !== "source" && raw.inputRole !== "reference") {
      throw automationCommandError("INVALID_ARGUMENT", "inputRole 不是受支持的需求输入角色。", {
        sourceId,
        targetId,
        inputRole: raw.inputRole,
      });
    }
    if (raw.relationType !== undefined && !RELATION_TYPES.has(raw.relationType)) {
      throw automationCommandError("INVALID_ARGUMENT", "relationType 不是受支持的连线类型。", {
        sourceId,
        targetId,
        relationType: raw.relationType,
      });
    }
    const inputRole = raw.inputRole;
    const relationType = raw.relationType;
    const key = `${sourceId}\u0000${targetId}`;
    const normalized = { sourceId, targetId, relationType, inputRole };
    const previous = seen.get(key);
    if (previous) {
      if (previous.inputRole !== normalized.inputRole || previous.relationType !== normalized.relationType) {
        throw automationCommandError("INVALID_ARGUMENT", "同一对节点在一批连线中包含冲突的 relationType 或 inputRole。", {
          sourceId,
          targetId,
          first: { relationType: previous.relationType, inputRole: previous.inputRole },
          conflicting: { relationType: normalized.relationType, inputRole: normalized.inputRole },
        });
      }
      continue;
    }
    seen.set(key, normalized);
    result.push(normalized);
  }
  return result;
}

export function connectCanvasRelations(
  sourceNodes: readonly WorkflowNode[],
  requestedEdges: readonly CanvasRelationEdge[],
  options: { replaceExisting?: boolean } = {},
): CanvasRelationMutationResult {
  const edges = normalizedEdges(requestedEdges);
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const missingNodeIds = [...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]))]
    .filter((nodeId) => !nodeById.has(nodeId));
  if (missingNodeIds.length) {
    throw automationCommandError("NODE_NOT_FOUND", "连线引用了不存在的节点，整批操作未执行。", { nodeIds: missingNodeIds });
  }
  const nonRequirementSourcesByTarget = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceId)!;
    const target = nodeById.get(edge.targetId)!;
    if (target.type === "requirement") {
      if (edge.relationType !== undefined && edge.relationType !== "referenced") {
        throw automationCommandError("INVALID_ARGUMENT", "需求输入连线的 relationType 只能是 referenced。", {
          sourceId: source.id,
          targetId: target.id,
          relationType: edge.relationType,
        });
      }
      if (source.type === "requirement") {
        throw automationCommandError("UNSUPPORTED_NODE", "需求节点不能串联需求节点。", {
          sourceId: source.id,
          targetId: target.id,
        });
      }
      if (!target.requirement || source.type !== "image") {
        throw automationCommandError(
          "UNSUPPORTED_NODE",
          "需求节点左侧只允许连接图片、图片容器或分层图片成果。",
          { sourceId: source.id, targetId: target.id },
        );
      }
      continue;
    }
    if (edge.inputRole) {
      throw automationCommandError("INVALID_ARGUMENT", "inputRole 仅适用于目标为需求节点的连线。", {
        sourceId: source.id,
        targetId: target.id,
      });
    }
    if (source.type === "requirement" && edge.relationType !== undefined && edge.relationType !== "derived-from") {
      throw automationCommandError("INVALID_ARGUMENT", "需求输出连线的 relationType 只能是 derived-from。", {
        sourceId: source.id,
        targetId: target.id,
        relationType: edge.relationType,
      });
    }
    const sources = nonRequirementSourcesByTarget.get(target.id) ?? new Set<string>();
    sources.add(source.id);
    nonRequirementSourcesByTarget.set(target.id, sources);
  }
  const conflictingTargets = [...nonRequirementSourcesByTarget.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([targetId]) => targetId);
  if (conflictingTargets.length) {
    throw automationCommandError("RELATION_CONFLICT", "普通成果只能拥有一个输入来源。", { targetIds: conflictingTargets });
  }

  let changed = false;
  let nodes = sourceNodes.map((node) => ({ ...node }));
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.sourceId)!;
    const target = nodes.find((node) => node.id === edge.targetId)!;
    if (target.type === "requirement" && target.requirement) {
      const inputRole = edge.inputRole ?? requirementInputRoleForNode(source);
      const before = requirementInputBindings(target, nodes);
      const existing = before.find((binding) => binding.nodeId === source.id);
      if (existing?.role === inputRole) continue;
      const requirement = {
        ...upsertRequirementInputBinding(target.requirement, { nodeId: source.id, role: inputRole }),
        revision: target.requirement.revision + 1,
        lastError: undefined,
      };
      const bindings = requirementInputBindings({ ...target, requirement }, nodes);
      nodes = nodes.map((node) => node.id === target.id ? {
        ...node,
        parentId: primaryRequirementInputNodeId(bindings) || undefined,
        relationType: "referenced",
        requirement,
      } : node);
      changed = true;
      continue;
    }
    const relationType: NonNullable<WorkflowNode["relationType"]> = source.type === "requirement"
      ? "derived-from"
      : edge.relationType ?? "derived-from";
    if (target.parentId === source.id && (target.relationType ?? "derived-from") === relationType) continue;
    if (target.parentId && target.parentId !== source.id && options.replaceExisting !== true) {
      throw automationCommandError(
        "RELATION_CONFLICT",
        "目标节点已有不同来源；如需替换请显式传入 replaceExisting=true。",
        { targetId: target.id, existingSourceId: target.parentId, requestedSourceId: source.id },
      );
    }
    nodes = nodes.map((node) => node.id === target.id
      ? { ...node, parentId: source.id, relationType }
      : node);
    changed = true;
  }
  assertCanvasRelationGraphAcyclic(nodes);
  return {
    changed,
    nodes,
    affectedNodeIds: [...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]))],
    edges: edges.map((edge) => {
      const source = nodeById.get(edge.sourceId)!;
      const target = nodeById.get(edge.targetId)!;
      return {
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relationType: target.type === "requirement" ? "referenced" : source.type === "requirement" ? "derived-from" : edge.relationType ?? "derived-from",
        ...(target.type === "requirement" ? { inputRole: edge.inputRole ?? requirementInputRoleForNode(source) } : {}),
      };
    }),
  };
}

export function disconnectCanvasRelations(
  sourceNodes: readonly WorkflowNode[],
  requestedEdges: readonly CanvasRelationEdge[],
): CanvasRelationMutationResult {
  const edges = normalizedEdges(requestedEdges);
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const missingNodeIds = [...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]))]
    .filter((nodeId) => !nodeById.has(nodeId));
  if (missingNodeIds.length) {
    throw automationCommandError("NODE_NOT_FOUND", "断线引用了不存在的节点，整批操作未执行。", { nodeIds: missingNodeIds });
  }
  const missingEdges = edges.filter((edge) => {
    const target = nodeById.get(edge.targetId)!;
    return target.type === "requirement"
      ? !requirementInputBindings(target, sourceNodes).some((binding) => binding.nodeId === edge.sourceId)
      : target.parentId !== edge.sourceId;
  });
  if (missingEdges.length) {
    throw automationCommandError("RELATION_NOT_FOUND", "部分待断开的连线已经不存在，整批操作未执行。", {
      edges: missingEdges.map(({ sourceId, targetId }) => ({ sourceId, targetId })),
    });
  }

  let nodes = sourceNodes.map((node) => ({ ...node }));
  const byTarget = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceIds = byTarget.get(edge.targetId) ?? new Set<string>();
    sourceIds.add(edge.sourceId);
    byTarget.set(edge.targetId, sourceIds);
  }
  for (const [targetId, sourceIds] of byTarget) {
    const target = nodes.find((node) => node.id === targetId)!;
    if (target.type === "requirement" && target.requirement) {
      const before = requirementInputBindings(target, nodes);
      const requirement = {
        ...removeRequirementInputBindings({ ...target.requirement, inputBindings: before }, sourceIds),
        revision: target.requirement.revision + 1,
        lastError: undefined,
      };
      const bindings = requirementInputBindings({ ...target, requirement, parentId: undefined }, nodes);
      nodes = nodes.map((node) => node.id === target.id ? {
        ...node,
        requirement,
        parentId: primaryRequirementInputNodeId(bindings) || undefined,
        relationType: bindings.length ? "referenced" : undefined,
      } : node);
    } else {
      nodes = nodes.map((node) => node.id === targetId
        ? { ...node, parentId: undefined, relationType: undefined }
        : node);
    }
  }
  return {
    changed: true,
    nodes,
    affectedNodeIds: [...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]))],
    edges: edges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relationType: nodeById.get(edge.targetId)?.relationType ?? "derived-from",
    })),
  };
}
