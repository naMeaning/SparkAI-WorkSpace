import assert from "node:assert/strict";

import type { AgentTaskScope, ImageAsset, ImageCollection, ImageContainerSpec, WorkflowNode } from "../src/core.ts";
import {
  deriveImageLayoutGroupsFromContainerSpecs,
  flattenImageContainerBindings,
  imageContainerSpecForNode,
  mergeLegacyImageLayoutGroups,
  planTaskResultLayout,
  sanitizeImageContainerGraph,
  sanitizeImageContainerSpec,
  synchronizeImageContainerSpecs,
} from "../src/image-container.ts";
import { imageGridPlanForCount } from "../src/image-layout.ts";
import { buildTaskResultLayoutMutation } from "../src/task-result-layout.ts";
import {
  canvasNodePresentsImageContainer,
  mergeSelectionAndUploadedReferences,
  referenceImagesFromSelectedCanvasNodes
} from "../src/selection-reference-images.ts";

const asset = (assetId: string, index = 1, prompt = ""): ImageAsset => ({
  assetId,
  index,
  type: "file",
  path: `C:/naimage/${assetId}-${index}.png`,
  width: 1024,
  height: 1024,
  prompt,
});

const node = (
  id: string,
  options: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  displayCode: id,
  title: id,
  prompt: `${id} prompt`,
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  branch: "basic",
  outputs: options.assets?.length ?? 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  assets: options.assets ?? [asset(`asset-${id}`)],
  imageState: "done",
  ...options,
});

const spec = (
  kind: ImageContainerSpec["kind"],
  memberNodeIds: string[] = [],
  childContainerNodeIds: string[] = [],
  overrides: Partial<ImageContainerSpec> = {},
): ImageContainerSpec => ({
  version: 1,
  kind,
  memberNodeIds,
  childContainerNodeIds,
  memberBindings: [],
  layoutOrigin: "manual",
  autoFit: true,
  ...overrides,
});

const collection = (items: ImageCollection["items"]): ImageCollection => ({
  id: "collection-1",
  kind: "batch",
  generationMode: "parallel",
  items,
  autoFit: true,
});

const testCollectionSlotsAreCompactAndValidated = (): void => {
  const assets = [asset("current-a", 1), asset("current-c", 3)];
  const normalized = sanitizeImageContainerSpec(spec("batch-result", [], [], {
    collection: collection([
      { id: "one", requestIndex: 1, assetIndex: 1, assetId: "stale-a", prompt: "A", status: "done" },
      { id: "two", requestIndex: 2, assetIndex: 3, assetId: "missing-b", prompt: "B", status: "done" },
      { id: "three", requestIndex: 3, assetId: "current-c", prompt: "C", status: "done" },
      { id: "four", requestIndex: 4, assetIndex: 2, assetId: "current-c", prompt: "D", status: "error", error: "生成失败" },
    ]),
  }), "A", undefined, assets);
  assert.ok(normalized?.collection);
  assert.deepEqual(normalized.collection.items.map((item) => ({
    requestIndex: item.requestIndex,
    assetIndex: item.assetIndex,
    assetId: item.assetId,
    status: item.status,
  })), [
    { requestIndex: 1, assetIndex: 1, assetId: "current-a", status: "done" },
    { requestIndex: 2, assetIndex: undefined, assetId: undefined, status: "error" },
    { requestIndex: 3, assetIndex: 2, assetId: "current-c", status: "done" },
    { requestIndex: 4, assetIndex: undefined, assetId: undefined, status: "error" },
  ]);
};

const testFirstMiddleAndLastFailuresKeepRequestSlots = (): void => {
  const cases = [
    { failed: 1, successfulRequests: [2, 3] },
    { failed: 2, successfulRequests: [1, 3] },
    { failed: 3, successfulRequests: [1, 2] },
  ];
  for (const scenario of cases) {
    const assets = scenario.successfulRequests.map((requestIndex, compactIndex) => asset(`request-${requestIndex}`, requestIndex, `P${requestIndex}`));
    const items = Array.from({ length: 3 }, (_item, requestOffset) => {
      const requestIndex = requestOffset + 1;
      if (requestIndex === scenario.failed) {
        return { id: `item-${requestIndex}`, requestIndex, assetIndex: requestIndex, assetId: `request-${requestIndex}`, prompt: `P${requestIndex}`, status: "error" as const, error: "failed" };
      }
      const compactIndex = scenario.successfulRequests.indexOf(requestIndex);
      return { id: `item-${requestIndex}`, requestIndex, assetIndex: compactIndex + 1, assetId: `request-${requestIndex}`, prompt: `P${requestIndex}`, status: "done" as const };
    });
    const normalized = sanitizeImageContainerSpec(spec("batch-result", [], [], { collection: collection(items) }), "BATCH", undefined, assets)!;
    assert.deepEqual(normalized.collection?.items.map((item) => ({
      requestIndex: item.requestIndex,
      assetIndex: item.assetIndex,
      status: item.status,
    })), Array.from({ length: 3 }, (_item, requestOffset) => {
      const requestIndex = requestOffset + 1;
      const compactIndex = scenario.successfulRequests.indexOf(requestIndex);
      return {
        requestIndex,
        assetIndex: compactIndex >= 0 ? compactIndex + 1 : undefined,
        status: compactIndex >= 0 ? "done" : "error",
      };
    }));
  }
};

const testMixedLegacyMigrationKeepsEveryContainer = (): void => {
  const nodes = [
    node("A", { imageContainerSpec: spec("manual", ["B"], [], { layoutId: "canonical-a" }), imageContainer: true }),
    node("B"),
    node("C"),
    node("D"),
  ];
  const canonical = deriveImageLayoutGroupsFromContainerSpecs(nodes);
  const merged = mergeLegacyImageLayoutGroups(nodes, canonical, [{
    id: "legacy-c",
    hostNodeId: "C",
    memberNodeIds: ["C", "D"],
    origin: "manual",
    autoFit: true,
  }]);
  const synchronized = synchronizeImageContainerSpecs(nodes, merged);
  assert.deepEqual(imageContainerSpecForNode(synchronized.find((item) => item.id === "A")!)?.memberNodeIds, ["B"]);
  assert.deepEqual(imageContainerSpecForNode(synchronized.find((item) => item.id === "C")!)?.memberNodeIds, ["D"]);
};

const testNestedSuperContainerRoundTripDoesNotFlatten = (): void => {
  const nodes = [
    node("SUPER", { assets: [], outputs: 0, imageContainer: true, imageContainerSpec: spec("container-group", [], ["A", "B"]) }),
    node("A", { imageContainer: true, imageContainerSpec: spec("folder", ["A1"], []) }),
    node("A1"),
    node("B", { imageContainer: true, imageContainerSpec: spec("folder", ["B1"], []) }),
    node("B1"),
  ];
  const groups = deriveImageLayoutGroupsFromContainerSpecs(nodes);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].memberNodeIds, ["SUPER", "A", "A1", "B", "B1"]);
  const roundTrip = synchronizeImageContainerSpecs(nodes, groups);
  const superSpec = imageContainerSpecForNode(roundTrip.find((item) => item.id === "SUPER")!);
  const folderA = imageContainerSpecForNode(roundTrip.find((item) => item.id === "A")!);
  assert.deepEqual(superSpec?.childContainerNodeIds, ["A", "B"]);
  assert.deepEqual(superSpec?.memberNodeIds, []);
  assert.deepEqual(folderA?.memberNodeIds, ["A1"]);
  const flattened = flattenImageContainerBindings(roundTrip, "SUPER");
  assert.deepEqual(flattened.map((binding) => binding.nodeId), ["A", "A1", "B", "B1"]);
};

const testInvalidMembersCyclesDoubleParentsAndDepthAreRejected = (): void => {
  const requirement = node("REQ", {
    type: "requirement",
    assets: undefined,
    outputs: 0,
    imageState: undefined,
    requirement: { version: 1, text: "do it", revision: 1, createdFrom: "node" },
  });
  const layer = node("LAYER", { layerGroup: {
    id: "layers", groupNumber: 1, total: 1, order: 1, layerId: "l1", layerTitle: "层", role: "foreground",
    compositionWidth: 1024, compositionHeight: 1024, anchorX: 0, anchorY: 0, detached: false,
  } });
  const graph = sanitizeImageContainerGraph([
    node("P1", { imageContainer: true, imageContainerSpec: spec("manual", ["X", "REQ", "LAYER"], []) }),
    node("P2", { imageContainer: true, imageContainerSpec: spec("manual", ["X"], []) }),
    node("X"),
    requirement,
    layer,
  ]);
  assert.deepEqual(imageContainerSpecForNode(graph.find((item) => item.id === "P1")!)?.memberNodeIds, ["X"]);
  assert.deepEqual(imageContainerSpecForNode(graph.find((item) => item.id === "P2")!)?.memberNodeIds, []);
  assert.equal(imageContainerSpecForNode(graph.find((item) => item.id === "REQ")!), undefined);
  assert.equal(imageContainerSpecForNode(graph.find((item) => item.id === "LAYER")!), undefined);

  const cycle = sanitizeImageContainerGraph([
    node("CA", { imageContainer: true, imageContainerSpec: spec("container-group", [], ["CB"]) }),
    node("CB", { imageContainer: true, imageContainerSpec: spec("container-group", [], ["CA"]) }),
  ]);
  assert.equal(cycle.some((item) => imageContainerSpecForNode(item)?.childContainerNodeIds.includes(item.id === "CA" ? "CB" : "CA")), false);

  const deepNodes = Array.from({ length: 18 }, (_item, index) => node(`D${index}`, {
    imageContainer: true,
    imageContainerSpec: spec("container-group", [], index < 17 ? [`D${index + 1}`] : []),
  }));
  const deep = sanitizeImageContainerGraph(deepNodes);
  const children = new Map(deep.map((item) => [item.id, imageContainerSpecForNode(item)?.childContainerNodeIds ?? []]));
  const depthFrom = (id: string, active = new Set<string>()): number => {
    if (active.has(id)) return 99;
    const next = new Set(active).add(id);
    const values = children.get(id) ?? [];
    return values.length ? 1 + Math.max(...values.map((child) => depthFrom(child, next))) : 1;
  };
  assert.ok(Math.max(...deep.map((item) => depthFrom(item.id))) <= 16);
};

const testBindingsAndPromptSurviveReorderDeleteAndSave = (): void => {
  const first = node("A", {
    assets: [asset("same", 1), asset("same", 2), asset("unique", 3)],
    imageContainer: true,
  });
  const initial = imageContainerSpecForNode(first)!;
  assert.equal(new Set(initial.memberBindings.map((binding) => binding.bindingId)).size, 3);

  const reordered = node("A", {
    assets: [asset("unique", 3), asset("same", 1), asset("same", 2)],
    imageContainer: true,
    imageContainerSpec: initial,
  });
  const reorderedSpec = imageContainerSpecForNode(reordered)!;
  assert.equal(
    reorderedSpec.memberBindings.find((binding) => binding.assetId === "unique")?.bindingId,
    initial.memberBindings.find((binding) => binding.assetId === "unique")?.bindingId,
  );

  const promptCollection = collection([
    { id: "one", requestIndex: 1, assetIndex: 1, assetId: "unique", prompt: "用户编辑后的提示词", status: "done" },
  ]);
  const saved = synchronizeImageContainerSpecs([
    node("A", {
      assets: [asset("unique", 1)],
      imageContainerSpec: spec("batch-result", [], [], { collection: promptCollection }),
      imageCollection: promptCollection,
    }),
  ], []);
  const savedSpec = imageContainerSpecForNode(saved[0]);
  assert.equal(savedSpec?.collection?.items[0].prompt, "用户编辑后的提示词");
  assert.equal(savedSpec?.collection?.items[0].assetId, "unique");
};

const testDissolvedManualContainerDowngradesOnlyPlainSingleImages = (): void => {
  const grouped = spec("manual", ["B"], [], { layoutId: "layout-a" });
  const downgraded = synchronizeImageContainerSpecs([
    node("A", { imageContainer: true, imageContainerSpec: grouped }),
    node("B"),
  ], []);
  const plain = downgraded.find((item) => item.id === "A")!;
  assert.equal(plain.imageContainer, false);
  assert.equal(plain.imageContainerSpec, undefined);
  assert.equal(imageContainerSpecForNode(plain), undefined);

  const protectedNodes = synchronizeImageContainerSpecs([
    node("SOURCE", {
      imageContainer: true,
      imageContainerRole: "source",
      imageContainerSpec: spec("manual", ["B"], [], { layoutId: "layout-source" }),
    }),
    node("NAMED", {
      imageContainer: true,
      imageContainerSpec: spec("manual", ["B"], [], { layoutId: "layout-named", sourceLabel: "原图 A" }),
    }),
    node("IMPORTED", {
      imageContainer: true,
      imageContainerSpec: spec("manual", ["B"], [], { layoutId: "layout-import", importBatchId: "batch-1" }),
    }),
    node("FOLDER", {
      imageContainer: true,
      imageContainerSpec: spec("folder", ["B"], [], { layoutId: "layout-folder" }),
    }),
    node("B"),
  ], []);
  for (const id of ["SOURCE", "NAMED", "IMPORTED", "FOLDER"]) {
    const preserved = protectedNodes.find((item) => item.id === id)!;
    assert.ok(imageContainerSpecForNode(preserved), `${id} should remain a container boundary`);
  }
};

const testAdaptiveGridReturnsToSinglePresentation = (): void => {
  assert.deepEqual(imageGridPlanForCount(1), { columns: 1, rows: 1 });
  assert.deepEqual(imageGridPlanForCount(4), { columns: 2, rows: 2 });
  assert.deepEqual(imageGridPlanForCount(1), { columns: 1, rows: 1 });
};

const testSharedBlobOccurrencesKeepIndependentBindings = (): void => {
  const sharedPath = "C:/naimage/library/shared.png";
  const source = node("OCC", {
    assets: [
      { ...asset("shared", 1), occurrenceId: `occ-${"a".repeat(32)}`, importBatchId: "batch", importRootId: "root-a", sourceRelativePath: "a.png", path: sharedPath },
      { ...asset("shared", 2), occurrenceId: `occ-${"b".repeat(32)}`, importBatchId: "batch", importRootId: "root-b", sourceRelativePath: "b.png", path: sharedPath },
    ],
    imageContainer: true,
    imageContainerSpec: spec("folder"),
  });
  const normalized = imageContainerSpecForNode(source)!;
  assert.equal(normalized.memberBindings.length, 2);
  assert.equal(new Set(normalized.memberBindings.map((binding) => binding.bindingId)).size, 2);
  assert.deepEqual(normalized.memberBindings.map((binding) => binding.occurrenceId), [`occ-${"a".repeat(32)}`, `occ-${"b".repeat(32)}`]);
  assert.equal(flattenImageContainerBindings([source], source.id).length, 2);
};

const taskScope = (
  resultPolicy: AgentTaskScope["resultPolicy"],
  sources: Array<{ bindingId: string; nodeId: string; containerId?: string; displayCode: string }>,
): AgentTaskScope => ({
  version: 2,
  origin: "container",
  scopeType: resultPolicy === "grouped-by-container" ? "container-group" : "multi-source",
  canvasRevision: 7,
  sourceNodeIds: [...new Set(sources.map((source) => source.nodeId))],
  sourceContainerIds: [...new Set(sources.map((source) => source.containerId).filter((id): id is string => Boolean(id)))],
  referenceContainerIds: [],
  sourceBindingIds: sources.map((source) => source.bindingId),
  referenceBindingIds: [],
  sourceAssets: sources.map((source, index) => ({
    bindingId: source.bindingId,
    assetId: `asset-${index + 1}`,
    displayCode: source.displayCode,
    role: "source",
    name: source.displayCode,
    assetIndex: 0,
    ownerAssetIndex: 0,
    ownerNodeId: source.nodeId,
    nodeId: source.nodeId,
    containerId: source.containerId,
  })),
  referenceAssets: [],
  resultPolicy,
  confirmationPolicy: "direct",
  snapshotHash: `scope-${"7".repeat(32)}`,
  sourceAssetCount: sources.length,
  referenceAssetCount: 0,
  truncated: false,
});

const resultNode = (
  id: string,
  scope: AgentTaskScope,
  bindingId: string,
  sourceContainerId?: string,
): WorkflowNode => {
  const source = scope.sourceAssets.find((asset) => asset.bindingId === bindingId);
  return node(id, {
    parentId: source?.nodeId,
    relationType: source?.nodeId ? "derived-from" : undefined,
    taskProvenance: {
    version: 1,
    taskScopeSnapshotHash: scope.snapshotHash,
    resultPolicy: scope.resultPolicy,
    sourceBindingId: bindingId,
    sourceAssetId: source?.assetId,
    sourceNodeId: source?.nodeId,
    sourceContainerId,
    sourceDisplayCode: source?.displayCode,
    },
  });
};

const testTaskResultPlannerGroupsBySourceAndRejectsMissingProvenance = (): void => {
  const scope = taskScope("grouped-by-source", [
    { bindingId: "binding:A:1", nodeId: "A", displayCode: "A1" },
    { bindingId: "binding:B:1", nodeId: "B", displayCode: "B1" },
  ]);
  const completeNodes = [
    resultNode("R1", scope, "binding:A:1"),
    resultNode("R2", scope, "binding:B:1"),
  ];
  const complete = planTaskResultLayout(completeNodes, ["R1", "R2"], scope);
  assert.equal(complete.ok, true);
  assert.equal(complete.reason, "ready");
  assert.deepEqual(complete.partitions.map((partition) => partition.nodeIds), [["R1"], ["R2"]]);

  const missing = planTaskResultLayout([
    completeNodes[0],
    node("R2"),
  ], ["R1", "R2"], scope);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing-provenance");
  assert.deepEqual(missing.missingResultNodeIds, ["R2"]);
  assert.deepEqual(missing.missingSourceKeys, ["binding:B:1"]);
};

const testTaskResultPlannerGroupsContainersButStillRequiresEverySource = (): void => {
  const scope = taskScope("grouped-by-container", [
    { bindingId: "binding:A:1", nodeId: "A", containerId: "FOLDER-A", displayCode: "A1" },
    { bindingId: "binding:A:2", nodeId: "A", containerId: "FOLDER-A", displayCode: "A2" },
    { bindingId: "binding:B:1", nodeId: "B", containerId: "FOLDER-B", displayCode: "B1" },
  ]);
  const partialNodes = [
    resultNode("R1", scope, "binding:A:1", "FOLDER-A"),
    resultNode("R3", scope, "binding:B:1", "FOLDER-B"),
  ];
  const partial = planTaskResultLayout(partialNodes, ["R1", "R3"], scope);
  assert.equal(partial.ok, false);
  assert.equal(partial.reason, "missing-source-results");
  assert.deepEqual(partial.missingSourceKeys, ["binding:A:2"]);
  assert.deepEqual(partial.partitions.map((partition) => partition.key), ["FOLDER-A", "FOLDER-B"]);

  const previewScope = { ...scope, confirmationPolicy: "preview-3" as const };
  const preview = planTaskResultLayout(partialNodes, ["R1", "R3"], previewScope);
  assert.equal(preview.ok, true, "Preview/staged rounds may intentionally cover only a frozen SOURCE subset");
  assert.equal(preview.reason, "ready-partial");
  assert.deepEqual(preview.missingSourceKeys, ["binding:A:2"]);

  const completeNodes = [
    ...partialNodes,
    resultNode("R2", scope, "binding:A:2", "FOLDER-A"),
  ];
  const complete = planTaskResultLayout(completeNodes, ["R1", "R2", "R3"], scope);
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.partitions.map((partition) => ({ key: partition.key, nodeIds: partition.nodeIds })), [
    { key: "FOLDER-A", nodeIds: ["R1", "R2"] },
    { key: "FOLDER-B", nodeIds: ["R3"] },
  ]);
};

const testTaskResultMutationBuildsAndAccumulatesContainerGroups = (): void => {
  const scope = taskScope("grouped-by-container", [
    { bindingId: "binding:A:1", nodeId: "A", containerId: "FOLDER-A", displayCode: "A1" },
    { bindingId: "binding:B:1", nodeId: "B", containerId: "FOLDER-B", displayCode: "B1" },
    { bindingId: "binding:C:1", nodeId: "C", containerId: "FOLDER-C", displayCode: "C1" },
  ]);
  scope.confirmationPolicy = "staged";
  const firstResults = [
    resultNode("R-A", scope, "binding:A:1", "FOLDER-A"),
    resultNode("R-B", scope, "binding:B:1", "FOLDER-B"),
  ];
  let sequence = 0;
  const first = buildTaskResultLayoutMutation({
    nodes: firstResults,
    groups: [],
    taskScope: scope,
    resultNodeIds: firstResults.map((item) => item.id),
    allocateNodeId: () => `OUTER-${++sequence}`,
    createdAt: "2026-07-19T00:00:00.000Z",
    nextZOrder: 10,
    containerWidth: 460,
    containerHeight: 300,
  });
  assert.equal(first.applied, true);
  assert.equal(first.plan.reason, "ready-partial");
  assert.equal(first.plan.missingSourceKeys.length, 1);
  assert.ok(first.containerGroupNodeId);
  const firstGroup = first.nodes?.find((item) => item.id === first.containerGroupNodeId);
  assert.deepEqual(imageContainerSpecForNode(firstGroup!)?.childContainerNodeIds, first.partitionHostNodeIds);

  const thirdResult = resultNode("R-C", scope, "binding:C:1", "FOLDER-C");
  const second = buildTaskResultLayoutMutation({
    nodes: [...(first.nodes ?? []), thirdResult],
    groups: first.groups ?? [],
    taskScope: scope,
    resultNodeIds: [thirdResult.id],
    allocateNodeId: () => `OUTER-${++sequence}`,
    createdAt: "2026-07-19T00:01:00.000Z",
    nextZOrder: 20,
    containerWidth: 460,
    containerHeight: 300,
  });
  assert.equal(second.applied, true);
  assert.equal(second.plan.reason, "ready");
  assert.deepEqual(second.removedContainerGroupNodeIds, [first.containerGroupNodeId]);
  assert.equal(second.nodes?.some((item) => item.id === first.containerGroupNodeId), false);
  const secondGroup = second.nodes?.find((item) => item.id === second.containerGroupNodeId);
  assert.equal(imageContainerSpecForNode(secondGroup!)?.childContainerNodeIds.length, 3);
  for (const result of [...firstResults, thirdResult]) {
    const restored = second.nodes?.find((item) => item.id === result.id);
    assert.equal(restored?.parentId, result.parentId);
    assert.equal(restored?.relationType, result.relationType);
    assert.equal(restored?.taskProvenance?.sourceBindingId, result.taskProvenance?.sourceBindingId);
  }
};

const testSelectedContainerBecomesOrderedReferences = () => {
  const container: WorkflowNode = {
    ...node("container-a", {
      imageContainer: true,
      imageContainerSpec: {
        version: 1,
        kind: "manual",
        memberNodeIds: ["m1", "m2", "m3"],
        childContainerNodeIds: [],
        memberBindings: [
          { bindingId: "b-3", assetId: "asset-c", nodeId: "m3", containerNodeId: "container-a", assetIndex: 2 },
          { bindingId: "b-1", assetId: "asset-a", nodeId: "m1", containerNodeId: "container-a", assetIndex: 0 },
          { bindingId: "b-2", assetId: "asset-b", nodeId: "m2", containerNodeId: "container-a", assetIndex: 1 }
        ]
      },
      assets: [asset("asset-a", 1), asset("asset-b", 2), asset("asset-c", 3)]
    })
  };
  assert.equal(canvasNodePresentsImageContainer(container), true);
  const images = referenceImagesFromSelectedCanvasNodes([container], 9);
  assert.equal(images.map((item) => item.assetId).join(","), "asset-c,asset-a,asset-b");
  assert.equal(images[0]?.purpose, "选中图片容器第 1 张");
  const merged = mergeSelectionAndUploadedReferences(images, [{
    name: "uploaded",
    path: "C:/naimage/uploaded.png",
    assetId: "uploaded"
  }]);
  assert.equal(merged.map((item) => item.assetId).join(","), "asset-c,asset-a,asset-b,uploaded");
};

const tests: Array<[string, () => void]> = [
  ["collection slots stay compact and valid", testCollectionSlotsAreCompactAndValidated],
  ["first, middle, and last failures preserve request slots", testFirstMiddleAndLastFailuresKeepRequestSlots],
  ["mixed legacy migration keeps every container", testMixedLegacyMigrationKeepsEveryContainer],
  ["nested super containers round-trip without flattening", testNestedSuperContainerRoundTripDoesNotFlatten],
  ["invalid graph members and unsafe nesting are rejected", testInvalidMembersCyclesDoubleParentsAndDepthAreRejected],
  ["bindings and edited prompts survive mutations", testBindingsAndPromptSurviveReorderDeleteAndSave],
  ["dissolved manual containers downgrade only plain single images", testDissolvedManualContainerDowngradesOnlyPlainSingleImages],
  ["shared blobs keep independent occurrence bindings", testSharedBlobOccurrencesKeepIndependentBindings],
  ["adaptive grids return to single presentation", testAdaptiveGridReturnsToSinglePresentation],
  ["task result planner groups by source and rejects missing provenance", testTaskResultPlannerGroupsBySourceAndRejectsMissingProvenance],
  ["task result planner keeps container partitions and requires every source", testTaskResultPlannerGroupsContainersButStillRequiresEverySource],
  ["task result mutation builds and accumulates staged container groups", testTaskResultMutationBuildsAndAccumulatesContainerGroups],
  ["selected containers become ordered reference images", testSelectedContainerBecomesOrderedReferences],
];

for (const [name, run] of tests) {
  run();
  console.log(`ok - ${name}`);
}
console.log(`image-container selftest passed (${tests.length} cases)`);
