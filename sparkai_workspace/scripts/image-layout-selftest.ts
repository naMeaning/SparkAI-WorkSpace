import assert from "node:assert/strict";

import {
  createManualImageLayoutGroup,
  extractImageLayoutMember,
  imageGridPresentationForRatios,
  imageGridPlanForCount,
  mergeImageLayoutSelection,
  moveImageLayoutMember,
  normalizeImageLayoutState,
  reorderImageLayoutMember,
  sanitizeImageLayoutGroups,
  type ImageLayoutGroup,
  type ImageLayoutState,
} from "../src/image-layout.ts";

type TestNode = {
  id: string;
  type: "image" | "requirement";
  parentId?: string;
  relationType?: "derived-from" | "referenced" | "variant" | "grouped";
  layerGroup?: { id: string };
  payload?: { label: string };
};

const nodes = (): TestNode[] => [
  { id: "A", type: "image", payload: { label: "root" } },
  { id: "C", type: "image", parentId: "A", relationType: "derived-from", payload: { label: "middle" } },
  { id: "B", type: "image", parentId: "C", relationType: "variant", payload: { label: "leaf" } },
  { id: "D", type: "image", parentId: "A", relationType: "referenced", payload: { label: "reference" } },
  { id: "L", type: "image", layerGroup: { id: "layers-1" }, payload: { label: "layer" } },
  { id: "R", type: "requirement", payload: { label: "requirement" } },
];

const group = (
  id: string,
  memberNodeIds: string[],
  hostNodeId = memberNodeIds[0],
): ImageLayoutGroup => ({ id, hostNodeId, memberNodeIds, origin: "manual", autoFit: true });

const causalitySnapshot = (value: readonly TestNode[]): string =>
  JSON.stringify(value.map(({ id, parentId, relationType }) => ({ id, parentId, relationType })));

const deepFreeze = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
};

const testCausalityNeverChanges = (): void => {
  const initialNodes = nodes();
  const expected = causalitySnapshot(initialNodes);
  const created = createManualImageLayoutGroup(
    { nodes: initialNodes, groups: [] },
    { groupId: "g1", hostNodeId: "A", memberNodeIds: ["C"] },
  );
  assert.equal(created.ok, true);
  assert.equal(causalitySnapshot(created.nodes), expected);
  const moved = moveImageLayoutMember(created, { memberNodeId: "B", targetGroupId: "g1" });
  assert.equal(causalitySnapshot(moved.nodes), expected);
  const reordered = reorderImageLayoutMember(moved, {
    groupId: "g1",
    memberNodeId: "B",
    targetIndex: 0,
  });
  assert.equal(causalitySnapshot(reordered.nodes), expected);
  const extracted = extractImageLayoutMember(reordered, { groupId: "g1", memberNodeId: "C" });
  assert.equal(causalitySnapshot(extracted.nodes), expected);
};

const testDuplicateMembershipIsNoOp = (): void => {
  const state: ImageLayoutState<TestNode> = { nodes: nodes(), groups: [group("g1", ["A", "B"])] };
  const before = JSON.stringify(state.groups);
  const duplicateMove = moveImageLayoutMember(state, { memberNodeId: "B", targetGroupId: "g1" });
  assert.deepEqual(
    { ok: duplicateMove.ok, changed: duplicateMove.changed, reason: duplicateMove.reason },
    { ok: true, changed: false, reason: "duplicate" },
  );
  assert.equal(JSON.stringify(duplicateMove.groups), before);

  const duplicateCreate = createManualImageLayoutGroup(state, {
    groupId: "g2",
    hostNodeId: "A",
    memberNodeIds: ["C"],
  });
  assert.deepEqual(
    { ok: duplicateCreate.ok, changed: duplicateCreate.changed, reason: duplicateCreate.reason },
    { ok: true, changed: false, reason: "duplicate" },
  );
  assert.equal(JSON.stringify(duplicateCreate.groups), before);
};

const testSameGroupReorder = (): void => {
  const result = reorderImageLayoutMember(
    { nodes: nodes(), groups: [group("g1", ["A", "B", "C"])] },
    { groupId: "g1", memberNodeId: "C", targetIndex: 0 },
  );
  assert.equal(result.reason, "reordered");
  assert.deepEqual(result.groups[0].memberNodeIds, ["C", "A", "B"]);
  assert.equal(result.groups[0].hostNodeId, "A");
};

const testCrossGroupMove = (): void => {
  const result = moveImageLayoutMember(
    {
      nodes: nodes(),
      groups: [group("g1", ["A", "B"]), group("g2", ["C", "D"])],
    },
    { memberNodeId: "B", targetGroupId: "g2", targetIndex: 1 },
  );
  assert.equal(result.reason, "moved");
  assert.deepEqual(result.groups, [group("g2", ["C", "B", "D"])]);
  assert.deepEqual(result.removedGroupIds, ["g1"]);
  assert.deepEqual(result.exposedNodeIds, ["A"]);
};

const testMergeSelectedContainers = (): void => {
  const initialNodes = nodes();
  const expectedCausality = causalitySnapshot(initialNodes);
  const result = mergeImageLayoutSelection(
    {
      nodes: initialNodes,
      groups: [group("g1", ["A", "B"]), group("g2", ["C", "D"])],
    },
    {
      groupId: "g1",
      hostNodeId: "A",
      memberNodeIds: ["A", "B", "C", "D"],
      replaceGroupIds: ["g1", "g2"],
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.groups, [group("g1", ["A", "B", "C", "D"])]);
  assert.equal(causalitySnapshot(result.nodes), expectedCausality);

  const layerRejected = mergeImageLayoutSelection(
    { nodes: initialNodes, groups: [] },
    { groupId: "bad", hostNodeId: "A", memberNodeIds: ["A", "L"] },
  );
  assert.equal(layerRejected.reason, "layer-member-forbidden");
};

const testMergeSelectedImagesIntoExistingContainer = (): void => {
  const initialNodes = nodes();
  const expectedCausality = causalitySnapshot(initialNodes);
  const result = mergeImageLayoutSelection(
    { nodes: initialNodes, groups: [group("target", ["A", "D"])] },
    {
      groupId: "target",
      hostNodeId: "A",
      memberNodeIds: ["A", "D", "B", "C"],
      replaceGroupIds: ["target"],
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.groups, [group("target", ["A", "D", "B", "C"])]);
  assert.equal(causalitySnapshot(result.nodes), expectedCausality);
};

const testExtractMember = (): void => {
  const result = extractImageLayoutMember(
    { nodes: nodes(), groups: [group("g1", ["A", "B", "C"])] },
    { groupId: "g1", memberNodeId: "B" },
  );
  assert.equal(result.reason, "extracted");
  assert.deepEqual(result.groups[0].memberNodeIds, ["A", "C"]);
  assert.deepEqual(result.exposedNodeIds, ["B"]);
};

const testLastMemberNormalizesGroup = (): void => {
  const result = extractImageLayoutMember(
    { nodes: nodes(), groups: [group("g1", ["A", "B"])] },
    { groupId: "g1", memberNodeId: "B" },
  );
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.removedGroupIds, ["g1"]);
  assert.deepEqual(result.exposedNodeIds, ["B", "A"]);

  const normalized = normalizeImageLayoutState({
    nodes: nodes(),
    groups: [group("empty", []), group("single", ["A"])],
  });
  assert.deepEqual(normalized.groups, []);
  assert.deepEqual(normalized.removedGroupIds, ["empty", "single"]);
  assert.deepEqual(normalized.exposedNodeIds, ["A"]);
};

const testLayerMembersAreRejected = (): void => {
  const initial: ImageLayoutState<TestNode> = { nodes: nodes(), groups: [] };
  const createResult = createManualImageLayoutGroup(initial, {
    groupId: "layers-are-not-containers",
    hostNodeId: "A",
    memberNodeIds: ["L"],
  });
  assert.deepEqual(
    { ok: createResult.ok, changed: createResult.changed, reason: createResult.reason },
    { ok: false, changed: false, reason: "layer-member-forbidden" },
  );

  const moveResult = moveImageLayoutMember(
    { nodes: nodes(), groups: [group("g1", ["A", "B"])] },
    { memberNodeId: "L", targetGroupId: "g1" },
  );
  assert.deepEqual(
    { ok: moveResult.ok, changed: moveResult.changed, reason: moveResult.reason },
    { ok: false, changed: false, reason: "layer-member-forbidden" },
  );
};

const testNoArtifactIsDeleted = (): void => {
  const initialNodes = nodes();
  const expectedIds = initialNodes.map((node) => node.id);
  const created = createManualImageLayoutGroup(
    { nodes: initialNodes, groups: [] },
    { groupId: "g1", hostNodeId: "A", memberNodeIds: ["B", "C"] },
  );
  const extracted = extractImageLayoutMember(created, { groupId: "g1", memberNodeId: "B" });
  assert.deepEqual(extracted.nodes.map((node) => node.id), expectedIds);
};

const testInputsAreNotMutatedAndOutputsAreCloned = (): void => {
  const mutableState: ImageLayoutState<TestNode> = {
    nodes: nodes(),
    groups: [group("g1", ["A", "B", "C"])],
  };
  const before = JSON.stringify(mutableState);
  const frozenState = deepFreeze(mutableState);
  const result = reorderImageLayoutMember(frozenState, {
    groupId: "g1",
    memberNodeId: "C",
    targetIndex: 1,
  });
  assert.equal(JSON.stringify(mutableState), before);
  assert.notEqual(result.nodes, mutableState.nodes);
  assert.notEqual(result.nodes[0], mutableState.nodes[0]);
  assert.notEqual(result.groups, mutableState.groups);
  assert.notEqual(result.groups[0], mutableState.groups[0]);
  assert.notEqual(result.groups[0].memberNodeIds, mutableState.groups[0].memberNodeIds);
};

const testSanitizer = (): void => {
  const result = sanitizeImageLayoutGroups(nodes(), [
    group("g1", ["A", "A", "missing", "B"]),
    group("g2", ["B", "C"]),
    group("g3", ["L", "D"], "L"),
  ]);
  assert.deepEqual(result.groups, [group("g1", ["A", "B"])]);
  assert.deepEqual(result.removedGroupIds, ["g2", "g3"]);
  assert.deepEqual(result.exposedNodeIds, ["C", "D"]);
};

const testNonImageNodesAreRejected = (): void => {
  const source = nodes();
  const created = createManualImageLayoutGroup(
    { nodes: source, groups: [] },
    { groupId: "bad", hostNodeId: "R", memberNodeIds: ["A"] },
  );
  assert.equal(created.ok, false);
  assert.equal(created.reason, "unsupported-node");

  const merged = mergeImageLayoutSelection(
    { nodes: source, groups: [] },
    { groupId: "bad-merge", hostNodeId: "A", memberNodeIds: ["R"] },
  );
  assert.equal(merged.ok, false);
  assert.equal(merged.reason, "unsupported-node");

  const sanitized = sanitizeImageLayoutGroups(source, [group("bad-stored", ["R", "A"], "R")]);
  assert.equal(sanitized.groups.length, 0);
};

const testAdaptiveImageGridPlans = (): void => {
  const expected = [
    [1, 1],
    [2, 1],
    [2, 2],
    [2, 2],
    [3, 2],
    [3, 2],
    [4, 2],
    [4, 2],
    [3, 3],
    [5, 2],
  ];
  expected.forEach(([columns, rows], index) => {
    assert.deepEqual(imageGridPlanForCount(index + 1), { columns, rows });
  });
  assert.deepEqual(imageGridPlanForCount(0), { columns: 1, rows: 1 });
  assert.deepEqual(imageGridPlanForCount(999), { columns: 5, rows: 2 });
};

const testAspectAwareImageGridPresentations = (): void => {
  assert.deepEqual(
    imageGridPresentationForRatios(3, [0.8, 0.8, 0.8], 0.8),
    { columns: 3, rows: 1, variant: "triple-row", order: [0, 1, 2], representativeRatio: 0.8 },
  );

  const tallPrimary = imageGridPresentationForRatios(3, [1.55, 0.58, 1.7], 1);
  assert.equal(tallPrimary.variant, "triple-mosaic-left");
  assert.deepEqual(tallPrimary.order, [1, 0, 2]);
  assert.equal(tallPrimary.columns, 2);
  assert.equal(tallPrimary.rows, 2);

  const widePrimary = imageGridPresentationForRatios(3, [0.72, 1.9, 0.78], 1);
  assert.equal(widePrimary.variant, "triple-mosaic-top");
  assert.deepEqual(widePrimary.order, [1, 0, 2]);
  assert.equal(widePrimary.columnFr?.length, 2);
  assert.equal(widePrimary.rowFr?.length, 2);

  const balanced = imageGridPresentationForRatios(6, [0.5, 0.62, 0.8, 1.2, 1.7, 2.1], 1);
  assert.deepEqual(balanced.order, [0, 1, 2, 5, 4, 3]);
  assert.deepEqual({ columns: balanced.columns, rows: balanced.rows }, { columns: 3, rows: 2 });
  assert.equal(balanced.rowFr?.length, 2);
  assert.ok(Number(balanced.rowFr?.[0]) > Number(balanced.rowFr?.[1]));

  const stableSameRatio = imageGridPresentationForRatios(10, Array.from({ length: 10 }, () => 0.75), 0.75);
  assert.deepEqual(stableSameRatio.order, Array.from({ length: 10 }, (_item, index) => index));
  assert.equal(stableSameRatio.rowFr, undefined);
};

const tests: Array<[string, () => void]> = [
  ["causality snapshot remains unchanged", testCausalityNeverChanges],
  ["duplicate membership is a no-op", testDuplicateMembershipIsNoOp],
  ["same-group member reorder", testSameGroupReorder],
  ["cross-group member move", testCrossGroupMove],
  ["selected containers merge atomically", testMergeSelectedContainers],
  ["selected ordinary images join an existing container atomically", testMergeSelectedImagesIntoExistingContainer],
  ["member extraction", testExtractMember],
  ["zero/one-member normalization", testLastMemberNormalizesGroup],
  ["layer nodes are rejected", testLayerMembersAreRejected],
  ["artifact nodes are never deleted", testNoArtifactIsDeleted],
  ["inputs are immutable and outputs cloned", testInputsAreNotMutatedAndOutputsAreCloned],
  ["persisted groups are sanitized", testSanitizer],
  ["non-image nodes never enter image layouts", testNonImageNodesAreRejected],
  ["adaptive image grids stay balanced", testAdaptiveImageGridPlans],
  ["image grids adapt to real aspect ratios", testAspectAwareImageGridPresentations],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`ok - ${name}\n`);
}

process.stdout.write(`image-layout selftest passed (${tests.length} cases)\n`);
