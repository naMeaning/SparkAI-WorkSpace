"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
sharp.cache(false);
const {
  createAgentRuntime,
  normalizedSteerTaskScopeUpdate,
  normalizedTaskScope
} = require("../agent-runtime.cjs");
const { agentToolSchemas } = require("../runtime/tool-schemas.cjs");
const {
  COMMERCE_GENERATE_SET_COMMAND,
  composePluginTask
} = require("../desktop/plugin-task-prompts.cjs");
const {
  goalSourceJobs,
  validateFrozenGoalTaskScope
} = require("../runtime/goal-image-execution.cjs");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function writePng(filePath, color, width = 32, height = 32) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).png().toFile(filePath);
}

async function writeWebp(filePath, color, width = 32, height = 32) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).webp().toFile(filePath);
}

function goalFixture(root, options = {}) {
  const definitions = options.definitions || [
    { nodeId: "NODE-A", containerId: "CONTAINER-A", slot: 0, code: "A1" },
    { nodeId: "NODE-A", containerId: "CONTAINER-A", slot: 1, code: "A2" },
    { nodeId: "NODE-B", containerId: "CONTAINER-B", slot: 0, code: "B1" },
    { nodeId: "NODE-C", containerId: "CONTAINER-C", slot: 0, containerSlot: 1, code: "C1" }
  ];
  const sourceAssets = definitions.map((definition, index) => ({
    bindingId: `binding-${definition.code.toLowerCase()}`,
    assetId: `asset-${definition.code.toLowerCase()}`,
    displayCode: definition.code,
    role: "source",
    name: `${definition.code}.png`,
    assetIndex: definition.slot,
    containerSlot: definition.containerSlot ?? definition.slot,
    ownerAssetIndex: definition.slot,
    ownerNodeId: definition.nodeId,
    nodeId: definition.nodeId,
    containerId: definition.containerId,
    path: path.join(root, "sources", `${definition.code}.png`),
    mimeType: "image/png"
  }));
  const nodeIds = [...new Set(definitions.map((definition) => definition.nodeId))];
  const containerIds = [...new Set(definitions.map((definition) => definition.containerId))];
  const nodes = nodeIds.map((nodeId) => ({
    id: nodeId,
    type: "image",
    status: "done",
    assets: sourceAssets
      .filter((source) => source.nodeId === nodeId)
      .map((source) => ({
        assetId: source.assetId,
        path: source.path,
        mimeType: source.mimeType,
        title: source.name
      }))
  }));
  const rawScope = {
    version: 2,
    origin: "goal",
    scopeType: "container-group",
    canvasRevision: 17,
    sourceNodeIds: nodeIds,
    sourceContainerIds: containerIds,
    referenceContainerIds: [],
    sourceBindingIds: sourceAssets.map((source) => source.bindingId),
    referenceBindingIds: [],
    sourceAssets,
    referenceAssets: [],
    resultPolicy: "grouped-by-container",
    confirmationPolicy: "direct",
    goal: {
      version: 1,
      target: "all-image-containers",
      frozen: true,
      containerIds,
      bindingIds: sourceAssets.map((source) => source.bindingId),
      containerCount: containerIds.length,
      bindingCount: sourceAssets.length,
      configuredConcurrency: options.configuredConcurrency ?? 4,
      probeContainerCount: options.probeContainerCount ?? Math.min(2, containerIds.length),
      operationsPerAsset: options.operationsPerAsset ?? 1,
      requestCount: sourceAssets.length * (options.operationsPerAsset ?? 1),
      ...(options.commercePlanHash ? { commercePlanHash: options.commercePlanHash } : {}),
      ...(options.commerceCatalogTargets?.length ? { commerceCatalogTargets: options.commerceCatalogTargets } : {})
    },
    sourceAssetCount: sourceAssets.length,
    referenceAssetCount: 0,
    truncated: false
  };
  return { nodes, scope: normalizedTaskScope({ taskScope: rawScope }), sourceAssets };
}

async function writeGoalFixtureSources(fixture) {
  await Promise.all(fixture.sourceAssets.map((source, index) => writePng(
    source.path,
    { r: 40 + (index * 29) % 190, g: 80 + (index * 17) % 120, b: 140, alpha: 1 }
  )));
}

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), "naimage-goal-runtime-"));
  try {
    const fixture = goalFixture(root);
    await writeGoalFixtureSources(fixture);

    const { agentTaskScopeSnapshotHash } = await import("../src/core.ts");
    assert.equal(fixture.scope.snapshotHash, agentTaskScopeSnapshotHash(fixture.scope), "Renderer and runtime Goal hashes must match");
    assert.equal(validateFrozenGoalTaskScope(fixture.scope).sources.length, 4);
    const legacyMissingFeeScope = structuredClone(fixture.scope);
    delete legacyMissingFeeScope.goal.operationsPerAsset;
    delete legacyMissingFeeScope.goal.requestCount;
    const normalizedLegacyScope = normalizedTaskScope({ taskScope: legacyMissingFeeScope });
    assert.equal(normalizedLegacyScope.goal.operationsPerAsset, 1);
    assert.equal(normalizedLegacyScope.goal.requestCount, normalizedLegacyScope.sourceAssets.length);
    assert.equal(
      validateFrozenGoalTaskScope(normalizedLegacyScope).sources.length,
      fixture.sourceAssets.length,
      "A legacy Goal without fee metadata must derive a conservative execution matrix"
    );
    const missingGoalMetadata = structuredClone(fixture.scope);
    delete missingGoalMetadata.goal;
    const normalizedMinimalScope = normalizedTaskScope({ taskScope: missingGoalMetadata });
    assert.equal(normalizedMinimalScope.goal.operationsPerAsset, 1);
    assert.equal(normalizedMinimalScope.goal.requestCount, normalizedMinimalScope.sourceAssets.length);
    const missingSourceNodesScope = normalizedTaskScope({
      taskScope: { ...fixture.scope, sourceNodeIds: [] }
    });
    assert.throws(
      () => validateFrozenGoalTaskScope(missingSourceNodesScope),
      (error) => error?.code === "NAIMAGE_GOAL_NODE_IDS_INVALID"
    );
    const orderedJobs = goalSourceJobs(fixture.scope);
    assert.deepEqual(
      orderedJobs.slice(0, 2).map((job) => job.source.containerId),
      ["CONTAINER-A", "CONTAINER-B"],
      "The serial probe must sample distinct containers before remaining bindings"
    );
    const oneContainerFixture = goalFixture(root, {
      definitions: [
        { nodeId: "ONE-CONTAINER", containerId: "SHARED-CONTAINER", slot: 0, code: "SC1" },
        { nodeId: "ONE-CONTAINER", containerId: "SHARED-CONTAINER", slot: 1, code: "SC2" },
        { nodeId: "ONE-CONTAINER", containerId: "SHARED-CONTAINER", slot: 2, code: "SC3" }
      ],
      configuredConcurrency: 4,
      probeContainerCount: 2
    });
    await writeGoalFixtureSources(oneContainerFixture);
    assert.deepEqual(
      goalSourceJobs(oneContainerFixture.scope).slice(0, 2).map((job) => job.source.bindingId),
      ["binding-sc1", "binding-sc2"],
      "A multi-image container must still probe two distinct mother images before ramp-up"
    );
    const publicImageTool = agentToolSchemas({ imageModel: "mock-image-model", imageModelPool: ["mock-image-model"] })
      .find((tool) => tool.function?.name === "image_gen");
    assert.equal(
      publicImageTool?.function?.parameters?.properties?.commercePlanHash?.pattern,
      "^commerce-[a-f0-9]{32}$",
      "The main Agent must be able to submit the confirmed commerce plan hash"
    );
    assert.equal(
      publicImageTool?.function?.parameters?.properties?.items?.items?.properties?.slotIndex?.maximum,
      11
    );
    assert.equal(publicImageTool?.function?.parameters?.properties?.slotIndex?.maximum, 11);
    assert.ok(publicImageTool?.function?.parameters?.properties?.slotId);
    assert.ok(publicImageTool?.function?.parameters?.properties?.localeCode);
    const commercePluginTask = composePluginTask({
      command: COMMERCE_GENERATE_SET_COMMAND,
      sourceCount: 2,
      sourceNodeIds: ["NODE-A", "NODE-B"],
      plan: {
        mode: "generate",
        setSize: 3,
        targetLocales: [{ code: "en-US" }]
      }
    });
    assert.match(commercePluginTask.prompt, /image_gen\.commercePlanHash 必须严格等于 commerce-[a-f0-9]{32}/);
    assert.match(commercePluginTask.prompt, /slotId、零基 slotIndex 和 localeCode/);
    const singleCommercePluginTask = composePluginTask({
      command: COMMERCE_GENERATE_SET_COMMAND,
      sourceCount: 1,
      sourceNodeIds: ["NODE-A"],
      plan: { mode: "generate", setSize: 1, targetLocales: [] }
    });
    assert.match(singleCommercePluginTask.prompt, /每个 SOURCE 只输出一张：省略 items/);
    assert.match(singleCommercePluginTask.prompt, /顶层设置 slotId=/);

    const settings = {
      imageModel: "mock-image-model",
      imageModelPool: ["mock-image-model"],
      imageBatchSize: 4,
      imageSize: "128x128",
      imageQuality: "auto"
    };
    let active = 0;
    let maxActive = 0;
    const requests = [];
    const runtime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-success"),
      serverGenerateImage: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        requests.push({ path: request.editImage?.path, active });
        try {
          await delay(12);
          const sourceName = path.basename(request.editImage.path);
          const webpOutput = sourceName === "C1.png";
          const outputName = webpOutput
            ? `${requests.length}-${path.basename(sourceName, path.extname(sourceName))}.webp`
            : `${requests.length}-${sourceName}`;
          const outputPath = path.join(root, "outputs", outputName);
          await (webpOutput ? writeWebp : writePng)(outputPath, { r: 20, g: 160, b: 90, alpha: 1 }, 48, 48);
          return {
            ok: true,
            model: "mock-image-model",
            size: "128x128",
            assets: [{ path: outputPath, mimeType: webpOutput ? "image/webp" : "image/png", runId: request.runId }],
            costCents: 3,
            providerUsage: [{ requestIndex: 1, total_tokens: 9, ignoredPrivateField: 42 }]
          };
        } finally {
          active -= 1;
        }
      }
    });
    const progress = [];
    const result = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "保持主体身份，只统一为干净的商品摄影光线。",
      size: "128x128",
      count: 1,
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-goal",
      conversationId: "conversation-goal",
      runId: "run-goal",
      settings,
      nodes: fixture.nodes,
      taskScope: fixture.scope,
      progress: (event) => progress.push(event)
    });
    runtime.dispose();
    assert.equal(requests.length, 4, "One Goal tool call must expand to every frozen binding");
    assert.equal(maxActive, 2, "Two serial probes must pass before the remaining two sources run concurrently");
    assert.deepEqual(
      requests.slice(0, 2).map((request) => path.basename(request.path)),
      ["A1.png", "B1.png"]
    );
    assert.equal(result.actions.length, 4);
    assert.equal(result.actions.every((action) => action.type === "workflow.node.create" && action.node.assets.length === 1), true);
    assert.equal(path.extname(result.actions[3].node.assets[0].path), ".webp", "WebP Goal outputs must pass decode and delivery-frame validation");
    assert.deepEqual(
      result.actions.map((action) => action.node.parentId),
      ["NODE-A", "NODE-A", "NODE-B", "NODE-C"],
      "Goal results must preserve the frozen binding order even when dispatch order probes other containers first"
    );
    assert.deepEqual(
      result.actions.map((action) => action.node.taskProvenance.sourceBindingId),
      fixture.scope.sourceBindingIds
    );
    assert.equal(
      result.actions.every((action) => action.node.taskProvenance.commerceSlotIndex === undefined),
      true,
      "Ordinary count=1 Goals must not be mislabeled as commerce slot zero"
    );
    assert.equal(new Set(result.actions.map((action) => action.node.taskProvenance.sourceContainerId)).size, 3);
    assert.match(result.envelope.modelOutput, /validated: 4/);
    assert.match(result.envelope.modelOutput, /accepted upstream may still be charged/i);
    assert.equal(result.envelope.batchSafety.admission.mode, "local");
    assert.equal(result.envelope.batchSafety.probe.succeeded, 2);
    assert.equal(result.envelope.batchSafety.costCents, 12);
    assert.equal(result.envelope.batchSafety.providerUsage.length, 4);
    assert.equal(result.envelope.batchSafety.providerUsage.every((usage) => usage.total_tokens === 9), true);
    assert.equal(result.envelope.batchSafety.providerUsage.some((usage) => Object.hasOwn(usage, "ignoredPrivateField")), false);
    assert.equal(progress.some((event) => event.phase === "goal-probe"), true);
    assert.equal(progress.some((event) => event.phase === "goal-ramp"), true);

    const repeatedFixture = goalFixture(root, {
      definitions: [{ nodeId: "REPEATED-A", containerId: "REPEATED-CONTAINER-A", slot: 0, code: "RA1" }],
      operationsPerAsset: 3,
      probeContainerCount: 1
    });
    await writeGoalFixtureSources(repeatedFixture);
    let repeatedRequests = 0;
    const repeatedRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-repeated"),
      serverGenerateImage: async (request) => {
        repeatedRequests += 1;
        const outputPath = path.join(root, "repeated-outputs", `${repeatedRequests}.png`);
        await writePng(outputPath, { r: 75, g: 130, b: 185, alpha: 1 }, 48, 48);
        return {
          ok: true,
          model: "mock-image-model",
          size: "128x128",
          assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
        };
      }
    });
    const repeatedResult = await repeatedRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Three consistent variants",
      size: "128x128",
      count: 3,
      scopeExecution: "all-goal-sources"
    }, {
      settings,
      nodes: repeatedFixture.nodes,
      taskScope: repeatedFixture.scope,
      prompt: "Create three variants for every frozen source"
    });
    repeatedRuntime.dispose();
    assert.equal(repeatedRequests, 3, "A non-commerce Goal must dispatch exactly its frozen repeated count");
    assert.equal(repeatedResult.actions.length, 1, "Repeated outputs for one SOURCE must finish in one image-group node");
    assert.equal(repeatedResult.actions[0].node.assets.length, 3);
    assert.equal(repeatedResult.actions[0].node.imageCollection.items.length, 3);
    assert.equal(repeatedResult.actions[0].node.imageCollection.items.every((item) => item.status === "done"), true);
    assert.equal(Object.hasOwn(repeatedResult.envelope.batchSafety, "costCents"), false);
    assert.equal(Object.hasOwn(repeatedResult.envelope.batchSafety, "providerUsage"), false);
    assert.doesNotMatch(String(repeatedResult.envelope.visibleOutput || ""), /costCents:\s*0/, "Missing upstream accounting must not be rendered as a zero-cost receipt");

    const matrixCommerceTask = composePluginTask({
      command: COMMERCE_GENERATE_SET_COMMAND,
      sourceCount: 2,
      sourceNodeIds: ["MATRIX-A", "MATRIX-B"],
      plan: {
        mode: "generate",
        targetLocales: [{ code: "en-US" }],
        slots: [
          { id: "hero", title: "Hero", prompt: "Hero product composition" },
          { id: "detail", title: "Detail", prompt: "Detail close-up composition" },
          { id: "lifestyle", title: "Lifestyle", prompt: "Lifestyle product composition" }
        ]
      }
    });
    const commercePlanHash = matrixCommerceTask.planHash;
    const brandReferencePath = path.join(root, "brand-references", "north-logo.png");
    const brandReferenceHash = "9".repeat(64);
    const matrixFixture = goalFixture(root, {
      definitions: [
        { nodeId: "MATRIX-A", containerId: "MATRIX-CONTAINER-A", slot: 0, code: "MA1" },
        { nodeId: "MATRIX-B", containerId: "MATRIX-CONTAINER-B", slot: 0, code: "MB1" }
      ],
      configuredConcurrency: 4,
      probeContainerCount: 2,
      operationsPerAsset: 3,
      commercePlanHash,
      commerceCatalogTargets: [{
        bindingId: "binding-ma1",
        catalogId: `catalog-${"1".repeat(32)}`,
        catalogRevision: 7,
        productId: `product-${"2".repeat(32)}`,
        productRevision: 3,
        ownerType: "sku",
        ownerId: `sku-${"3".repeat(32)}`,
        sourceLinkId: `material-${"4".repeat(32)}`,
        brandStyle: {
          version: 1,
          enabled: true,
          fontFamily: "Inter, Arial, sans-serif",
          colors: ["#0b1f33", "#f4c430"],
          logoUsage: "Keep the original North logo artwork, wording, colors, and proportions.",
          modelAppearance: "Use the same adult model identity across the complete listing set.",
          productAppearance: "Keep the mug body, lid geometry, finish, and printed markings unchanged.",
          visualStyle: "Clean premium product photography with restrained typography.",
          references: [{
            linkId: `material-${"7".repeat(32)}`,
            assetId: "asset-north-logo",
            contentHash: brandReferenceHash,
            nodeId: "BRAND-LOGO",
            assetIndex: 0,
            role: "logo",
            purpose: "Trusted North brand Logo identity reference."
          }]
        }
      }, {
        bindingId: "binding-mb1",
        catalogId: `catalog-${"1".repeat(32)}`,
        catalogRevision: 7,
        productId: `product-${"5".repeat(32)}`,
        productRevision: 6,
        ownerType: "product",
        ownerId: `product-${"5".repeat(32)}`,
        sourceLinkId: `material-${"6".repeat(32)}`
      }]
    });
    await writeGoalFixtureSources(matrixFixture);
    await writePng(brandReferencePath, { r: 244, g: 196, b: 48, alpha: 1 }, 40, 40);
    matrixFixture.nodes.push({
      id: "BRAND-LOGO",
      type: "image",
      status: "done",
      assets: [{
        assetId: "asset-north-logo",
        contentHash: brandReferenceHash,
        path: brandReferencePath,
        mimeType: "image/png",
        title: "North logo"
      }]
    });
    assert.equal(matrixFixture.scope.snapshotHash, agentTaskScopeSnapshotHash(matrixFixture.scope), "Brand-aware Renderer and runtime Goal hashes must match");
    const matrixItems = [
      { title: "Hero", prompt: "Hero product composition", slotId: "hero", slotIndex: 0, localeCode: "en-US" },
      { title: "Detail", prompt: "Detail close-up composition", slotId: "detail", slotIndex: 1, localeCode: "en-US" },
      { title: "Lifestyle", prompt: "Lifestyle product composition", slotId: "lifestyle", slotIndex: 2, localeCode: "en-US" }
    ];
    const matrixRequests = [];
    const matrixRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-matrix"),
      serverGenerateImage: async (request) => {
        matrixRequests.push({
          path: request.editImage?.path,
          prompt: request.prompt,
          inputFidelity: request.inputFidelity,
          referenceImages: (request.referenceImages || []).map((reference) => ({
            path: reference.path,
            role: reference.role,
            purpose: reference.purpose
          }))
        });
        const outputPath = path.join(root, "matrix-outputs", `${matrixRequests.length}.png`);
        await writePng(outputPath, { r: 32, g: 150, b: 110, alpha: 1 }, 48, 48);
        return {
          ok: true,
          model: "mock-image-model",
          size: "128x128",
          assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }],
          costCents: 2
        };
      }
    });
    const matrixResult = await matrixRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Shared product identity and geometry",
      size: "128x128",
      count: 3,
      items: matrixItems,
      commercePlanHash,
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-matrix",
      conversationId: "conversation-matrix",
      runId: "run-matrix",
      settings,
      nodes: matrixFixture.nodes,
      taskScope: matrixFixture.scope,
      prompt: matrixCommerceTask.prompt,
      progress: () => {}
    });
    matrixRuntime.dispose();
    assert.equal(matrixRequests.length, 6, "Two sources by three items must dispatch exactly six requests");
    assert.deepEqual(
      matrixRequests.slice(0, 2).map((request) => path.basename(request.path)),
      ["MA1.png", "MB1.png"],
      "Matrix probes must represent different source containers"
    );
    assert.equal(matrixRequests[0].prompt.includes(matrixItems[0].prompt), true);
    assert.equal(matrixRequests[1].prompt.startsWith(`${matrixItems[0].prompt}\n\n交付规格：`), true,
      "The unbranded probe must preserve the representative first slot and append only the delivery specification");
    assert.match(matrixRequests[1].prompt, /画面比例 1:1，清晰度 1K，最终像素 128×128/);
    const brandedRequests = matrixRequests.filter((request) => path.basename(request.path) === "MA1.png");
    const unbrandedRequests = matrixRequests.filter((request) => path.basename(request.path) === "MB1.png");
    assert.equal(brandedRequests.length, 3);
    assert.equal(brandedRequests.every((request) => (
      request.inputFidelity === "high" && request.referenceImages.length === 1 &&
      request.referenceImages[0].path === brandReferencePath && request.referenceImages[0].role === "product" &&
      request.referenceImages[0].purpose === "Trusted North brand Logo identity reference."
    )), true, "Every branded SOURCE request must receive its frozen trusted reference at high fidelity");
    assert.equal(brandedRequests.every((request) => (
      /品牌风格锁定/.test(request.prompt) && /Inter, Arial, sans-serif/.test(request.prompt) &&
      /#0b1f33、#f4c430/.test(request.prompt) && /Keep the mug body/.test(request.prompt)
    )), true, "Brand fields must reach the actual provider prompt for every matrix slot");
    assert.equal(unbrandedRequests.every((request) => request.referenceImages.length === 0 && !/品牌风格锁定/.test(request.prompt)), true,
      "Brand constraints must remain scoped to the matching SOURCE product");
    assert.equal(matrixResult.actions.length, 2, "Each SOURCE must own one image group instead of one canvas node per slot");
    assert.deepEqual(
      matrixResult.actions.map((action) => action.node.parentId),
      ["MATRIX-A", "MATRIX-B"]
    );
    const matrixCollectionItems = matrixResult.actions.flatMap((action) => action.node.imageCollection.items);
    assert.deepEqual(
      matrixCollectionItems.map((item) => item.prompt.split("\n")[0]),
      [...matrixItems.map((item) => item.prompt), ...matrixItems.map((item) => item.prompt)]
    );
    assert.equal(matrixCollectionItems.every((item) => !/交付规格：/.test(item.prompt)), true,
      "Provider-only delivery specifications must not pollute editable collection prompts");
    assert.equal(matrixResult.actions[0].node.imageCollection.items.every((item) => /品牌风格锁定/.test(item.prompt)), true);
    assert.equal(matrixResult.actions[1].node.imageCollection.items.every((item) => !/品牌风格锁定/.test(item.prompt)), true);
    assert.deepEqual(
      matrixCollectionItems.map((item) => item.taskProvenance.commerceSlotId),
      ["hero", "detail", "lifestyle", "hero", "detail", "lifestyle"]
    );
    assert.deepEqual(
      matrixCollectionItems.map((item) => item.taskProvenance.commerceSlotIndex),
      [0, 1, 2, 0, 1, 2]
    );
    assert.equal(
      matrixCollectionItems.every((item) => (
        item.taskProvenance.commercePlanHash === commercePlanHash &&
        item.taskProvenance.commerceLocaleCode === "en-US"
      )),
      true
    );
    assert.deepEqual(
      matrixCollectionItems.map((item) => item.taskProvenance.commerceCatalogTarget.ownerType),
      ["sku", "sku", "sku", "product", "product", "product"],
      "Every matrix result must inherit the Catalog target of its own SOURCE binding"
    );
    assert.equal(
      matrixCollectionItems.every((item) => /^commerce-result-[a-f0-9]{32}$/.test(item.taskProvenance.commerceResultKey)),
      true,
      "Every Catalog-bound result must carry a deterministic idempotency key"
    );
    assert.equal(new Set(matrixCollectionItems.map((item) => item.taskProvenance.commerceResultKey)).size, 6);
    const resultBrandStyle = matrixCollectionItems[0].taskProvenance.commerceCatalogTarget.brandStyle;
    resultBrandStyle.colors.push("#ffffff");
    resultBrandStyle.references[0].purpose = "mutated result provenance";
    const frozenBrandStyle = matrixFixture.scope.goal.commerceCatalogTargets[0].brandStyle;
    assert.deepEqual(frozenBrandStyle.colors, ["#0b1f33", "#f4c430"]);
    assert.notEqual(frozenBrandStyle.references[0].purpose, "mutated result provenance",
      "Result provenance must not share mutable brand arrays with the frozen TaskScope");
    assert.deepEqual(matrixResult.envelope.batchSafety.matrix, {
      sourceBindingCount: 2,
      outputsPerSource: 3,
      totalRequests: 6,
      commercePlanHash,
      probeSourceBindingIds: ["binding-ma1", "binding-mb1"]
    });
    assert.equal(matrixResult.envelope.batchSafety.receipts.every((receipt) => receipt.status === "validated"), true);

    const staleBrandNodes = structuredClone(matrixFixture.nodes);
    const staleBrandNode = staleBrandNodes.find((node) => node.id === "BRAND-LOGO");
    staleBrandNode.assets[0].contentHash = "8".repeat(64);
    let staleBrandProviderCalls = 0;
    const staleBrandRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-stale-brand-reference"),
      serverGenerateImage: async () => {
        staleBrandProviderCalls += 1;
        throw new Error("stale brand reference must fail before provider dispatch");
      }
    });
    try {
      await assert.rejects(
        staleBrandRuntime.runTool("image_gen", {
          operation: "variants",
          prompt: "Shared product identity and geometry",
          size: "128x128",
          count: 3,
          items: matrixItems,
          commercePlanHash,
          scopeExecution: "all-goal-sources"
        }, {
          projectId: "project-stale-brand",
          conversationId: "conversation-stale-brand",
          runId: "run-stale-brand",
          settings,
          nodes: staleBrandNodes,
          taskScope: matrixFixture.scope,
          prompt: matrixCommerceTask.prompt,
          progress: () => {}
        }),
        (error) => error?.code === "NAIMAGE_COMMERCE_BRAND_REFERENCE_STALE"
      );
    } finally {
      staleBrandRuntime.dispose();
    }
    assert.equal(staleBrandProviderCalls, 0, "A changed brand reference must block the complete Goal before any provider request");

    const translationCommerceTask = composePluginTask({
      command: "sparkai.commerce-toolkit.translate-listing-set",
      sourceCount: 2,
      sourceNodeIds: ["TRANSLATE-A", "TRANSLATE-B"],
      plan: {
        mode: "translate",
        languageCodes: ["en-US"],
        translationItems: [
          { sourceIndex: 0, localeCode: "en-US", prompt: "SOURCE A: use a concise English title." },
          { sourceIndex: 1, localeCode: "en-US", prompt: "SOURCE B: preserve the technical packaging copy." }
        ]
      }
    });
    const translationFixture = goalFixture(root, {
      definitions: [
        { nodeId: "TRANSLATE-A", containerId: "TRANSLATE-CONTAINER-A", slot: 0, code: "TA1" },
        { nodeId: "TRANSLATE-B", containerId: "TRANSLATE-CONTAINER-B", slot: 0, code: "TB1" }
      ],
      configuredConcurrency: 2,
      probeContainerCount: 2,
      operationsPerAsset: 1,
      commercePlanHash: translationCommerceTask.planHash
    });
    await writeGoalFixtureSources(translationFixture);
    const translationRequests = [];
    const translationRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-translation-cells"),
      serverGenerateImage: async (request) => {
        translationRequests.push({
          sourcePath: request.editImage?.path,
          prompt: request.prompt
        });
        const outputPath = path.join(root, "translation-cell-outputs", `${translationRequests.length}.png`);
        await writePng(outputPath, { r: 196, g: 118, b: 42, alpha: 1 }, 48, 48);
        return {
          ok: true,
          model: "mock-image-model",
          size: "128x128",
          assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
        };
      }
    });
    const translationResult = await translationRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Translate visible product copy while preserving the product.",
      size: "128x128",
      count: 1,
      commercePlanHash: translationCommerceTask.planHash,
      slotId: "translation",
      slotIndex: 0,
      localeCode: "en-US",
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-translation-cells",
      conversationId: "conversation-translation-cells",
      runId: "run-translation-cells",
      settings,
      nodes: translationFixture.nodes,
      taskScope: translationFixture.scope,
      prompt: translationCommerceTask.prompt,
      progress: () => {}
    });
    translationRuntime.dispose();
    assert.equal(translationRequests.length, 2, "Two translation SOURCE bindings must dispatch one request each");
    const translationBySource = new Map(translationRequests.map((request) => [path.basename(request.sourcePath), request.prompt]));
    assert.match(translationBySource.get("TA1.png") || "", /SOURCE A: use a concise English title/);
    assert.doesNotMatch(translationBySource.get("TA1.png") || "", /SOURCE B: preserve the technical packaging copy/);
    assert.match(translationBySource.get("TB1.png") || "", /SOURCE B: preserve the technical packaging copy/);
    assert.doesNotMatch(translationBySource.get("TB1.png") || "", /SOURCE A: use a concise English title/);
    assert.equal(translationResult.actions.length, 2);
    assert.deepEqual(
      translationResult.actions.map((action) => action.node.taskProvenance.commerceLocaleCode),
      ["en-US", "en-US"],
      "Per-cell translation prompts must keep the shared locale provenance"
    );

    const singleCommerceTask = composePluginTask({
      command: COMMERCE_GENERATE_SET_COMMAND,
      sourceCount: 1,
      sourceNodeIds: ["BOUNDARY-A"],
      plan: { mode: "generate", setSize: 1, targetLocales: [] }
    });
    const boundaryFixture = goalFixture(root, {
      definitions: [{ nodeId: "BOUNDARY-A", containerId: "BOUNDARY-CONTAINER-A", slot: 0, code: "BA1" }],
      configuredConcurrency: 4,
      probeContainerCount: 1,
      operationsPerAsset: 1,
      commercePlanHash: singleCommerceTask.planHash
    });
    await writeGoalFixtureSources(boundaryFixture);
    const boundaryRequests = [];
    const boundaryRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-matrix-boundaries"),
      serverGenerateImage: async (request) => {
        boundaryRequests.push({ prompt: request.prompt, path: request.editImage?.path });
        const outputPath = path.join(root, "matrix-boundary-outputs", `${boundaryRequests.length}.png`);
        await writePng(outputPath, { r: 118, g: 92, b: 170, alpha: 1 }, 48, 48);
        return {
          ok: true,
          model: "mock-image-model",
          size: "128x128",
          assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
        };
      }
    });
    const singleMatrixResult = await boundaryRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Single hero image",
      size: "128x128",
      commercePlanHash: singleCommerceTask.planHash,
      slotId: "hero",
      slotIndex: 0,
      localeCode: "source-language",
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-matrix-single",
      conversationId: "conversation-matrix-single",
      runId: "run-matrix-single",
      settings,
      nodes: boundaryFixture.nodes,
      taskScope: boundaryFixture.scope,
      prompt: singleCommerceTask.prompt,
      progress: () => {}
    });
    assert.equal(singleMatrixResult.actions.length, 1);
    assert.equal(singleMatrixResult.actions[0].node.taskProvenance.commerceSlotId, "hero");
    assert.equal(singleMatrixResult.actions[0].node.taskProvenance.commerceSlotIndex, 0);
    assert.equal(singleMatrixResult.actions[0].node.taskProvenance.commerceLocaleCode, "source-language");

    const resumedSingleMatrixResult = await boundaryRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Single hero image after confirmation",
      size: "128x128",
      commercePlanHash: singleCommerceTask.planHash,
      slotId: "hero",
      slotIndex: 0,
      localeCode: "source-language",
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-matrix-single-resumed",
      conversationId: "conversation-matrix-single-resumed",
      runId: "run-matrix-single-resumed",
      settings,
      nodes: boundaryFixture.nodes,
      taskScope: boundaryFixture.scope,
      prompt: "已确认，请继续原套图任务。",
      messages: [
        { role: "user", content: singleCommerceTask.prompt },
        { role: "assistant", content: "请确认是否继续。" },
        { role: "user", content: "继续执行。" }
      ],
      progress: () => {}
    });
    assert.equal(resumedSingleMatrixResult.actions.length, 1, "A resumed commerce Goal must recover its frozen plan from recent user history");
    assert.equal(resumedSingleMatrixResult.actions[0].node.taskProvenance.commercePlanHash, singleCommerceTask.planHash);

    const twelveItems = Array.from({ length: 12 }, (_item, index) => ({
      title: `Set image ${index + 1}`,
      prompt: `Complete commerce image prompt ${index + 1}`,
      slotId: `slot-${index + 1}`,
      slotIndex: index,
      localeCode: "en-US"
    }));
    const twelveCommerceTask = composePluginTask({
      command: COMMERCE_GENERATE_SET_COMMAND,
      sourceCount: 1,
      sourceNodeIds: ["TWELVE-A"],
      plan: {
        mode: "generate",
        targetLocales: [{ code: "en-US" }],
        slots: twelveItems.map((item) => ({ id: item.slotId, title: item.title, prompt: item.prompt }))
      }
    });
    const twelveFixture = goalFixture(root, {
      definitions: [{ nodeId: "TWELVE-A", containerId: "TWELVE-CONTAINER-A", slot: 0, code: "TA1" }],
      configuredConcurrency: 4,
      probeContainerCount: 1,
      operationsPerAsset: 12,
      commercePlanHash: twelveCommerceTask.planHash
    });
    await writeGoalFixtureSources(twelveFixture);
    const twelveItemResult = await boundaryRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Twelve-image listing set",
      size: "128x128",
      count: 12,
      items: twelveItems,
      commercePlanHash: twelveCommerceTask.planHash,
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-matrix-twelve",
      conversationId: "conversation-matrix-twelve",
      runId: "run-matrix-twelve",
      settings,
      nodes: twelveFixture.nodes,
      taskScope: twelveFixture.scope,
      prompt: twelveCommerceTask.prompt,
      progress: () => {}
    });
    boundaryRuntime.dispose();
    assert.equal(twelveItemResult.actions.length, 1, "A 12-slot set must remain one image-group node");
    assert.equal(twelveItemResult.actions[0].node.assets.length, 12, "The UI's supported 12-slot set must execute without a hidden 10-item cap");
    assert.deepEqual(
      twelveItemResult.actions[0].node.imageCollection.items.map((item) => item.taskProvenance.commerceSlotIndex),
      Array.from({ length: 12 }, (_item, index) => index)
    );

    let partialCalls = 0;
    const partialRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-matrix-partial"),
      serverGenerateImage: async (request) => {
        partialCalls += 1;
        if (request.prompt.split("\n")[0] === matrixItems[2].prompt) {
          throw new Error("simulated persistence failure for lifestyle slot");
        }
        const outputPath = path.join(root, "matrix-partial-outputs", `${partialCalls}.png`);
        await writePng(outputPath, { r: 82, g: 125, b: 190, alpha: 1 }, 48, 48);
        return {
          ok: true,
          model: "mock-image-model",
          size: "128x128",
          assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
        };
      }
    });
    const partialResult = await partialRuntime.runTool("image_gen", {
      operation: "variants",
      prompt: "Shared product identity and geometry",
      size: "128x128",
      count: 3,
      items: matrixItems,
      commercePlanHash,
      scopeExecution: "all-goal-sources"
    }, {
      projectId: "project-matrix-partial",
      conversationId: "conversation-matrix-partial",
      runId: "run-matrix-partial",
      settings,
      nodes: matrixFixture.nodes,
      taskScope: matrixFixture.scope,
      prompt: matrixCommerceTask.prompt,
      progress: () => {}
    });
    partialRuntime.dispose();
    assert.equal(partialCalls, 4, "A protected ramp failure must stop the two remaining matrix requests");
    assert.deepEqual(
      partialResult.envelope.batchSafety.receipts.map((receipt) => receipt.status),
      ["validated", "validated", "failed", "validated", "not-dispatched", "not-dispatched"]
    );
    assert.equal(partialResult.actions.length, 2, "Partial results must remain one image group per SOURCE");
    const partialFailureItem = partialResult.actions
      .flatMap((action) => action.node.imageCollection.items)
      .find((item) => item.status === "error" && item.taskProvenance?.commerceSlotId === "lifestyle");
    assert.equal(partialFailureItem?.taskProvenance?.commerceSlotId, "lifestyle");
    assert.equal(partialFailureItem?.taskProvenance?.commerceSlotIndex, 2);
    assert.match(partialResult.envelope.modelOutput, /failed_receipts: .*lifestyle/);
    assert.match(partialResult.envelope.modelOutput, /not_dispatched_receipts: .*detail/);

    let rejectedDispatches = 0;
    const rejectionRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-matrix-rejections"),
      serverGenerateImage: async () => {
        rejectedDispatches += 1;
        throw new Error("must not dispatch");
      }
    });
    const matrixRejectionContext = {
      settings,
      nodes: matrixFixture.nodes,
      taskScope: matrixFixture.scope,
      prompt: matrixCommerceTask.prompt
    };
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Count drift",
        size: "128x128",
        count: 2,
        items: matrixItems,
        commercePlanHash,
        scopeExecution: "all-goal-sources"
      }, matrixRejectionContext),
      (error) => error?.code === "NAIMAGE_GOAL_OPERATION_COUNT_MISMATCH"
    );
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Hash drift",
        size: "128x128",
        count: 3,
        items: matrixItems,
        commercePlanHash: `commerce-${"f".repeat(32)}`,
        scopeExecution: "all-goal-sources"
      }, matrixRejectionContext),
      (error) => error?.code === "NAIMAGE_COMMERCE_PLAN_HASH_MISMATCH"
    );
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Metadata order drift",
        size: "128x128",
        count: 3,
        items: [matrixItems[1], matrixItems[0], matrixItems[2]],
        commercePlanHash,
        scopeExecution: "all-goal-sources"
      }, matrixRejectionContext),
      (error) => error?.code === "NAIMAGE_COMMERCE_ITEM_METADATA_MISMATCH"
    );
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Shared product identity and geometry",
        size: "128x128",
        count: 3,
        items: matrixItems,
        slotId: "hero",
        commercePlanHash,
        scopeExecution: "all-goal-sources"
      }, matrixRejectionContext),
      (error) => error?.code === "NAIMAGE_COMMERCE_ITEM_SHAPE_INVALID"
    );
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Single hero image",
        size: "128x128",
        count: 1,
        items: [{
          prompt: "Single hero image",
          slotId: "hero",
          slotIndex: 0,
          localeCode: "source-language"
        }],
        commercePlanHash: singleCommerceTask.planHash,
        scopeExecution: "all-goal-sources"
      }, {
        settings,
        nodes: boundaryFixture.nodes,
        taskScope: boundaryFixture.scope,
        prompt: singleCommerceTask.prompt
      }),
      (error) => error?.code === "NAIMAGE_COMMERCE_ITEM_SHAPE_INVALID"
    );
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "edit",
        prompt: "Ordinary Goal with injected commerce metadata",
        size: "128x128",
        count: 1,
        commercePlanHash,
        slotId: "hero",
        slotIndex: 0,
        localeCode: "source-language",
        scopeExecution: "all-goal-sources"
      }, {
        settings,
        nodes: fixture.nodes,
        taskScope: fixture.scope,
        prompt: "Ordinary Goal"
      }),
      (error) => error?.code === "NAIMAGE_COMMERCE_METADATA_FORBIDDEN"
    );
    const largeFixture = goalFixture(root, {
      definitions: Array.from({ length: 21 }, (_item, index) => ({
        nodeId: `LIMIT-NODE-${index + 1}`,
        containerId: `LIMIT-CONTAINER-${index + 1}`,
        slot: 0,
        code: `L${String(index + 1).padStart(2, "0")}`
      })),
      configuredConcurrency: 4,
      probeContainerCount: 2
    });
    await writeGoalFixtureSources(largeFixture);
    await assert.rejects(
      rejectionRuntime.runTool("image_gen", {
        operation: "variants",
        prompt: "Matrix request limit",
        size: "128x128",
        items: Array.from({ length: 10 }, (_item, index) => ({
          title: `Slot ${index + 1}`,
          prompt: `Matrix slot ${index + 1}`
        })),
        scopeExecution: "all-goal-sources"
      }, {
        settings,
        nodes: largeFixture.nodes,
        taskScope: largeFixture.scope
      }),
      (error) => error?.code === "NAIMAGE_GOAL_OPERATION_COUNT_MISMATCH"
    );
    rejectionRuntime.dispose();
    assert.equal(rejectedDispatches, 0, "A matrix larger than the frozen Goal quote must fail before billable dispatch");

    assert.throws(
      () => normalizedSteerTaskScopeUpdate(fixture.scope, { sourceMode: "clear", referenceMode: "keep" }),
      /Goal 运行中只能修改文字/
    );
    const textOnlySteer = normalizedSteerTaskScopeUpdate(fixture.scope, { sourceMode: "keep", referenceMode: "keep" });
    assert.equal(textOnlySteer.taskScope.origin, "goal");
    assert.equal(textOnlySteer.taskScope.snapshotHash, fixture.scope.snapshotHash);

    let staleCalls = 0;
    const staleRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-stale"),
      serverGenerateImage: async () => {
        staleCalls += 1;
        throw new Error("must not dispatch");
      }
    });
    await assert.rejects(
      staleRuntime.runTool("image_gen", {
        operation: "edit",
        prompt: "test",
        size: "128x128",
        scopeExecution: "all-goal-sources"
      }, {
        settings,
        nodes: fixture.nodes,
        taskScope: { ...fixture.scope, snapshotHash: `scope-${"f".repeat(32)}` }
      }),
      /snapshotHash/
    );
    staleRuntime.dispose();
    assert.equal(staleCalls, 0, "Hash drift must fail before any image request");

    let staleNodeCalls = 0;
    const staleNodeRuntime = createAgentRuntime({
      projectRoot: root,
      configDir: path.join(root, "config-stale-node"),
      serverGenerateImage: async () => {
        staleNodeCalls += 1;
        throw new Error("must not dispatch");
      }
    });
    const staleNodes = fixture.nodes.map((node) => (
      node.id === "NODE-C" ? { ...node, assets: [] } : node
    ));
    await assert.rejects(
      staleNodeRuntime.runTool("image_gen", {
        operation: "edit",
        prompt: "test stale node",
        size: "128x128",
        scopeExecution: "all-goal-sources"
      }, {
        settings,
        nodes: staleNodes,
        taskScope: fixture.scope
      }),
      (error) => error?.code === "NAIMAGE_GOAL_SOURCE_STALE"
    );
    staleNodeRuntime.dispose();
    assert.equal(staleNodeCalls, 0, "Every frozen source slot must be checked before the first billable probe");

    for (const failureMode of ["dry-run", "corrupt"]) {
      let calls = 0;
      const failureRuntime = createAgentRuntime({
        projectRoot: root,
        configDir: path.join(root, `config-${failureMode}`),
        serverGenerateImage: async (request) => {
          calls += 1;
          const outputPath = path.join(root, "failure-outputs", `${failureMode}-${calls}.png`);
          mkdirSync(path.dirname(outputPath), { recursive: true });
          if (failureMode === "corrupt") {
            require("node:fs").writeFileSync(outputPath, "not-an-image");
          } else {
            await writePng(outputPath, { r: 200, g: 40, b: 40, alpha: 1 }, 32, 32);
          }
          return {
            ok: true,
            dryRun: failureMode === "dry-run",
            model: "mock-image-model",
            assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
          };
        }
      });
      await assert.rejects(
        failureRuntime.runTool("image_gen", {
          operation: "replace",
          prompt: "probe failure",
          size: "128x128",
          scopeExecution: "all-goal-sources"
        }, {
          settings,
          nodes: fixture.nodes,
          taskScope: fixture.scope,
          progress: () => {}
        }),
        failureMode === "dry-run" ? /dry-run/i : /decod|image dimensions/i
      );
      failureRuntime.dispose();
      assert.equal(calls, 1, `${failureMode} probe failure must stop all undispatched work`);
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 43,
      expandedBindings: requests.length,
      matrixRequests: matrixRequests.length,
      partialMatrixDispatches: partialCalls,
      maxConcurrentObserved: maxActive,
      probeContainers: orderedJobs.slice(0, 2).map((job) => job.source.containerId)
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
