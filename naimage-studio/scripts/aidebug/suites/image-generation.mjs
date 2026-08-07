import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { runCanvasLayoutMutationRegression } from "../../aidebug-image-layout-regression.mjs";

export function createImageGenerationSuiteProbes({
  captureState,
  dragFixturePaths,
  evaluate,
  imageRuns,
  liveImage,
  recordObservation,
  runDir,
  setWindowSize,
  waitForCanvasImagePreviews,
  waitForExpression,
  workbenchMinWidth
}) {
async function captureAgentImageSuiteProbe(client, targetId, runs = imageRuns) {
  const expectedImageNodes = Number(runs) + 2;
  const suiteTimeoutMs = Math.max(300000, Number(runs || 1) * 180000);
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__naimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__naimageAIDebug?.runImageSuite && window.__naimageDebugAgentState)", 10000);
  recordObservation("info", "agent-image-suite-request", {
    runs,
    prompt: "AIDebug 连续执行真实 image_gen 生图任务并观察节点布局。"
  });
  const expectedPartialCount = Math.max(0, Math.min(3, Math.floor(Number(process.env.NAIMAGE_AIDEBUG_IMAGE_PARTIALS || 0) || 0)));
  const partialSnapshots = [];
  let suiteSettled = false;
  const suitePromise = evaluate(client, `window.__naimageAIDebug.runImageSuite({ runs: ${Number(runs)} })`, suiteTimeoutMs)
    .finally(() => { suiteSettled = true; });
  if (expectedPartialCount > 0) {
    const partialDeadline = Date.now() + 20_000;
    while (!suiteSettled && Date.now() < partialDeadline) {
      const snapshot = await evaluate(client, `(() => ({
        tiles: Array.from(document.querySelectorAll('.stream-preview-tile')).map((tile) => {
          const source = tile.querySelector('img')?.getAttribute('src') || '';
          let sourceHash = 0;
          for (let index = 0; index < source.length; index += 1) sourceHash = (Math.imul(sourceHash, 31) + source.charCodeAt(index)) >>> 0;
          return {
            operationId: tile.getAttribute('data-operation-id') || '',
            requestIndex: Number(tile.getAttribute('data-request-index') || 0),
            previewIndex: Number(tile.getAttribute('data-preview-index') || 0),
            previewTotal: Number(tile.getAttribute('data-preview-total') || 0),
            sourceHash: sourceHash.toString(16)
          };
        })
      }))()`);
      if (snapshot?.tiles?.length) partialSnapshots.push(snapshot);
      await delay(25);
    }
  }
  const suite = await suitePromise;
  if (expectedPartialCount > 0) {
    const partialEvents = [];
    let previousSignature = "";
    for (const snapshot of partialSnapshots) {
      const signature = JSON.stringify(snapshot.tiles);
      if (signature === previousSignature) continue;
      previousSignature = signature;
      partialEvents.push(...snapshot.tiles);
    }
    const seenIndexes = [...new Set(partialEvents.map((item) => item.previewIndex))].sort((left, right) => left - right);
    const expectedIndexes = Array.from({ length: expectedPartialCount }, (_item, index) => index + 1);
    const slotKeys = [...new Set(partialEvents.map((item) => `${item.operationId}:${item.requestIndex}`))];
    const slotProofs = slotKeys.map((slotKey) => {
      const events = partialEvents.filter((item) => `${item.operationId}:${item.requestIndex}` === slotKey);
      const indexes = [...new Set(events.map((item) => item.previewIndex))].sort((left, right) => left - right);
      const sourceHashes = [...new Set(events.map((item) => item.sourceHash).filter(Boolean))];
      return {
        slotKey,
        indexes,
        sourceHashes,
        ok: JSON.stringify(indexes) === JSON.stringify(expectedIndexes) && sourceHashes.length >= expectedPartialCount
      };
    });
    const finalPreviewCount = await evaluate(client, `document.querySelectorAll('.stream-preview-tile').length`);
    const streamingPreviewProof = {
      ok: JSON.stringify(seenIndexes) === JSON.stringify(expectedIndexes)
        && partialEvents.every((item) => item.previewTotal === expectedPartialCount)
        && Math.max(0, ...partialSnapshots.map((snapshot) => snapshot.tiles.length)) === 1
        && slotProofs.length > 0
        && slotProofs.every((slot) => slot.ok)
        && finalPreviewCount === 0,
      expectedIndexes,
      seenIndexes,
      slotProofs,
      maxConcurrentTiles: Math.max(0, ...partialSnapshots.map((snapshot) => snapshot.tiles.length)),
      finalPreviewCount
    };
    suite.streamingPreviewProof = streamingPreviewProof;
    if (!streamingPreviewProof.ok) {
      suite.ok = false;
      suite.issues = [...(Array.isArray(suite.issues) ? suite.issues : []), {
        level: "error",
        area: "streaming-image-preview",
        message: "画布中间图未按同一请求槽位依次替换并在最终结果后清理。",
        detail: streamingPreviewProof
      }];
    }
  }
  const suitePath = join(runDir, "agent-image-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-image-suite-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "agent-image-suite-success", {
      suitePath,
      runs,
      nodeLayouts: suite?.state?.nodeLayouts
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-image-suite-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    "agent-image-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
       agentIdle: true,
       agentNodeCount: expectedImageNodes,
       agentImageNodeCount: expectedImageNodes,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      canvasReadabilityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  return { ...capture, suite, suitePath };
}

async function captureAgentImageRecoverySuiteProbe(client, targetId) {
  const expectedImageNodes = 7;
  const suiteTimeoutMs = 180000;
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__naimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__naimageAIDebug?.runImageRecoverySuite && window.__naimageDebugAgentState)", 10000);
  recordObservation("info", "agent-image-recovery-suite-request", {
    scenarios: ["429", "generic-402", "5xx", "network", "terminated-socket", "timeout-once", "partial-batch-five-retries"],
    prompt: "在真实 image_gen 工具链的单图 attempt 层注入故障，审计重试、operation、时间线和节点幂等。"
  });
  const suite = await evaluate(client, `window.__naimageAIDebug.runImageRecoverySuite()`, suiteTimeoutMs);
  const suitePath = join(runDir, "agent-image-recovery-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-image-recovery-suite-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error, detail: item.detail })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "agent-image-recovery-suite-success", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, durationMs: item.durationMs }))
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-image-recovery-suite-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const finalRecoveryState = [...(Array.isArray(suite?.steps) ? suite.steps : [])]
    .reverse()
    .find((step) => step?.detail?.state)?.detail?.state;
  const expectedPreviewCount = Math.max(
    1,
    (Array.isArray(finalRecoveryState?.nodes) ? finalRecoveryState.nodes : [])
      .reduce((sum, node) => sum + Math.max(0, Number(node?.assetCount ?? node?.assets?.length ?? 0)), 0)
  );
  await waitForCanvasImagePreviews(client, expectedPreviewCount, 60000);
  await evaluate(client, `window.__naimageAIDebug?.fitCanvas?.()`);
  const capture = await captureState(
    client,
    targetId,
    "agent-image-recovery-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: expectedImageNodes,
      agentImageNodeCount: expectedImageNodes,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  return { ...capture, suite, suitePath };
}

async function captureCanvasImageCollectionSuiteProbe(client, targetId, options = {}) {
  let expectedImageNodes = 0;
  const suiteTimeoutMs = liveImage ? 900000 : 180000;
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__naimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__naimageAIDebug?.runCanvasImageCollectionSuite && window.__naimageDebugAgentState)", 10000);
  recordObservation("info", "canvas-image-collection-suite-request", {
    liveImage,
    prompt: "验证标准单图、连续三图、并行十图、不同提示词图片组、画布内部归组、明确另存为和继续生成的真实闭环。"
  });
  const suite = await evaluate(client, `window.__naimageAIDebug.runCanvasImageCollectionSuite()`, suiteTimeoutMs);
  expectedImageNodes = Math.max(0, Number(suite?.state?.imageNodeCount || suite?.state?.nodeCount || 0));
  const nativeDragStep = Array.isArray(suite?.steps)
    ? suite.steps.find((item) => item?.label === "canvas-native-dragback-auto-group")
    : null;
  const nativeDragDetail = nativeDragStep?.detail || {};
  const nativeDragProof = {
    ok: Boolean(
      nativeDragStep?.ok && nativeDragDetail?.dragOverAccepted && nativeDragDetail?.dropAccepted &&
      nativeDragDetail?.nativeRefConsumed && nativeDragDetail?.routeCompleted && nativeDragDetail?.sourceBytesUnchanged &&
      nativeDragDetail?.sourceStillPresent && nativeDragDetail?.targetHasOriginalPath && nativeDragDetail?.causalityPreserved &&
      nativeDragDetail?.targetContainer && Number(nativeDragDetail?.targetAfterAssetCount || 0) === 2 &&
      Array.isArray(nativeDragDetail?.route) && [
        "internalAssetDragRef -> handleCanvasDrop -> moveContainerAsset",
        "DOM dragstart -> beginInternalAssetDrag -> handleCanvasDrop -> moveContainerAsset",
        "pointerdown image tile -> beginNodeDrag -> moveNode -> endNodeDrag -> moveContainerAsset"
      ].includes(nativeDragDetail.route.join(" -> "))
    ),
    route: nativeDragDetail?.route,
    diagnosticId: nativeDragDetail?.diagnosticId,
    originalPath: nativeDragDetail?.originalPath,
    dragOverAccepted: Boolean(nativeDragDetail?.dragOverAccepted),
    dropAccepted: Boolean(nativeDragDetail?.dropAccepted),
    nativeRefConsumed: Boolean(nativeDragDetail?.nativeRefConsumed),
    routeCompleted: Boolean(nativeDragDetail?.routeCompleted),
    sourceBytesUnchanged: Boolean(nativeDragDetail?.sourceBytesUnchanged),
    sourceStillPresent: Boolean(nativeDragDetail?.sourceStillPresent),
    targetHasOriginalPath: Boolean(nativeDragDetail?.targetHasOriginalPath),
    causalityPreserved: Boolean(nativeDragDetail?.causalityPreserved),
    layoutGroup: nativeDragDetail?.layoutGroup,
    targetContainer: Boolean(nativeDragDetail?.targetContainer),
    targetAfterAssetCount: Number(nativeDragDetail?.targetAfterAssetCount || 0)
  };
  const windowsDragStep = Array.isArray(suite?.steps)
    ? suite.steps.find((item) => item?.label === "windows-drag-removed")
    : null;
  const windowsDragDetail = windowsDragStep?.detail || {};
  const windowsDragRemovedProof = {
    ok: Boolean(
      windowsDragStep?.ok && windowsDragDetail?.saveVisible && !windowsDragDetail?.viewerDragHandleVisible &&
      Number(windowsDragDetail?.canvasDragHandleCount || 0) === 0
    ),
    saveVisible: Boolean(windowsDragDetail?.saveVisible),
    viewerDragHandleVisible: Boolean(windowsDragDetail?.viewerDragHandleVisible),
    canvasDragHandleCount: Number(windowsDragDetail?.canvasDragHandleCount || 0),
    sourceAssetIndex: Number(windowsDragDetail?.sourceAssetIndex || 0)
  };
  suite.nativeDragProof = nativeDragProof;
  suite.windowsDragRemovedProof = windowsDragRemovedProof;
  const collectionOk = Boolean(suite?.ok && nativeDragProof.ok && windowsDragRemovedProof.ok);
  suite.collectionOk = collectionOk;
  suite.ok = collectionOk;
  const suitePath = join(runDir, "canvas-image-collection-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "canvas-image-collection-suite-failed", {
      suitePath,
      ids: suite?.ids,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "canvas-image-collection-suite-success", {
      suitePath,
      ids: suite?.ids,
      nodeLayouts: suite?.state?.nodeLayouts
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `canvas-image-collection-suite-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  if (expectedImageNodes > 0) {
    await waitForExpression(client, `document.querySelectorAll(".flow-node.image").length >= ${expectedImageNodes}`, 6000);
  }
  const capture = await captureState(
    client,
    targetId,
    "canvas-image-collection-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: expectedImageNodes,
      imageNodeCount: expectedImageNodes,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  await evaluate(client, `window.__naimageAIDebug.selectNode({ id: ${JSON.stringify(String(suite?.ids?.seriesId || ""))} })`);
  const seriesCapture = await captureState(
    client,
    targetId,
    "canvas-image-series-focused-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      agentImageGenToolLifecycleOrderOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  await evaluate(client, `window.__naimageAIDebug.selectNode({ id: ${JSON.stringify(String(suite?.ids?.batchId || ""))} })`);
  const batchCapture = await captureState(
    client,
    targetId,
    "canvas-image-batch-ten-focused-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  const viewerOpen = await evaluate(
    client,
    `window.__naimageAIDebug.openImageViewer({ id: ${JSON.stringify(String(suite?.ids?.batchId || ""))}, index: 4 })`
  );
  await waitForExpression(client, "Boolean(document.querySelector('.image-viewer header [aria-label=\"另存为\"]')) && !document.querySelector('.image-viewer .image-viewer-drag-handle')", 5000);
  const viewerHeaderProof = await evaluate(client, `(() => {
    const surface = document.querySelector('[data-ui-surface="image-viewer"]');
    const description = String(surface?.querySelector('.ui-surface-description')?.textContent || '').replace(/\\s+/g, ' ').trim();
    const total = surface?.querySelectorAll('.image-viewer-strip img').length || 0;
    const expectedPrefix = '图片 5/' + total;
    const internalNodeId = ${JSON.stringify(String(suite?.ids?.batchId || ""))};
    const toolbar = surface?.querySelector('.image-viewer-actions');
    const toolbarMetrics = Array.from(toolbar?.children || []).map((item) => {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return {
        tag: item.tagName.toLowerCase(),
        label: item.getAttribute('aria-label') || item.getAttribute('title') || String(item.textContent || '').trim(),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        height: Math.round(rect.height),
        borderRadius: parseFloat(style.borderRadius || '0') || 0
      };
    });
    const toolbarGaps = toolbarMetrics.slice(1).map((item, index) => item.left - toolbarMetrics[index].right);
    const toolbarOk = toolbarMetrics.length >= 7 && toolbarMetrics.every((item) => item.height >= 34 && item.borderRadius >= 4 && item.label) && toolbarGaps.every((gap) => gap >= 8);
    return {
      description,
      total,
      expectedPrefix,
      toolbarOk,
      toolbarGaps,
      toolbarMetrics,
      internalIdAbsent: !internalNodeId || !description.includes(internalNodeId),
      ok: total > 0 && toolbarOk && description.startsWith(expectedPrefix) && (!internalNodeId || !description.includes(internalNodeId))
    };
  })()`);
  const viewerSwitchProof = await evaluate(client, `(async () => {
    const surface = document.querySelector('[data-ui-surface="image-viewer"]');
    const stage = surface?.querySelector('.image-viewer-stage');
    const buttons = Array.from(surface?.querySelectorAll('.image-viewer-strip button') || []);
    if (!surface || !stage || buttons.length < 3) return { ok: false, error: 'viewer switch fixture unavailable' };
    const surfaceBefore = surface.getBoundingClientRect();
    const samples = [];
    let blankFrames = 0;
    let maxSurfaceDelta = 0;
    let frameHandle = 0;
    const sample = () => {
      const surfaceRect = surface.getBoundingClientRect();
      maxSurfaceDelta = Math.max(
        maxSurfaceDelta,
        Math.abs(surfaceRect.width - surfaceBefore.width),
        Math.abs(surfaceRect.height - surfaceBefore.height)
      );
      const images = Array.from(stage.querySelectorAll('.image-viewer-image'));
      const visible = images.filter((image) => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return image.complete && image.naturalWidth > 0 && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
      });
      if (!visible.length) blankFrames += 1;
      samples.push({
        buffering: stage.getAttribute('data-buffering'),
        targetSrc: stage.getAttribute('data-target-src'),
        displayedSrc: stage.getAttribute('data-displayed-src'),
        imageCount: images.length,
        visibleCount: visible.length
      });
      frameHandle = requestAnimationFrame(sample);
    };
    frameHandle = requestAnimationFrame(sample);
    const clickOrder = [Math.min(7, buttons.length - 1), 1, buttons.length - 1, 2];
    for (const index of clickOrder) {
      buttons[index]?.click();
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    cancelAnimationFrame(frameHandle);
    const finalTarget = stage.getAttribute('data-target-src') || '';
    const finalDisplayed = stage.getAttribute('data-displayed-src') || '';
    const currentImages = Array.from(stage.querySelectorAll('.image-viewer-image-current')).filter((image) => image.complete && image.naturalWidth > 0);
    return {
      ok: samples.length >= 4 && blankFrames === 0 && maxSurfaceDelta <= 1 && finalTarget === finalDisplayed && currentImages.length === 1,
      sampleCount: samples.length,
      blankFrames,
      maxSurfaceDelta,
      finalTarget,
      finalDisplayed,
      currentImageCount: currentImages.length,
      maxBufferedImageCount: Math.max(0, ...samples.map((item) => item.imageCount)),
      samples
    };
  })()`);
  const viewerCapture = await captureState(
    client,
    targetId,
    "image-viewer-save-action-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: true,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true
    }
  );
  viewerCapture.viewerHeaderProof = viewerHeaderProof;
  viewerCapture.viewerSwitchProof = viewerSwitchProof;
  if (!viewerHeaderProof?.ok) {
    viewerCapture.stateIssues.push({
      key: "imageViewerPublicHeaderOk",
      expected: true,
      actual: viewerHeaderProof
    });
  }
  if (!viewerSwitchProof?.ok) {
    viewerCapture.stateIssues.push({
      key: "imageViewerSwitchStable",
      expected: true,
      actual: viewerSwitchProof
    });
  }
  await evaluate(client, `document.querySelector('[data-ui-surface="image-viewer"] .ui-surface-close')?.click()`);
  await waitForExpression(client, "!document.querySelector('[data-ui-surface=\"image-viewer\"]')", 5000);
  const normalEditorOpen = await evaluate(
    client,
    `window.__naimageAIDebug?.openNodeEditor?.({ id: ${JSON.stringify(String(suite?.ids?.singleId || ""))}, index: 0 })`
  );
  await waitForExpression(client, "Boolean(window.__naimageDebugAgentState?.().nodeEditorOpen)", 5000);
  const normalEditorSpaceProof = await evaluate(client, `window.__naimageDebugAgentState?.().nodeEditorUi?.spaceUse || null`);
  const normalEditorCapture = await captureState(
    client,
    targetId,
    "standard-node-editor-space-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: true,
      modalWithinViewport: true,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true
    }
  );
  normalEditorCapture.nodeEditorSpaceProof = normalEditorSpaceProof;
  normalEditorCapture.nodeEditorOpen = normalEditorOpen;
  if (!normalEditorOpen?.ok || !normalEditorSpaceProof?.ok || normalEditorSpaceProof?.hasLayerPanel) {
    normalEditorCapture.stateIssues.push({
      key: "standardNodeEditorSpaceUseOk",
      expected: true,
      actual: { open: normalEditorOpen, spaceUse: normalEditorSpaceProof }
    });
  }
  await evaluate(client, `document.querySelector('.unified-node-editor [aria-label="关闭成果编辑器"]')?.click()`);
  await waitForExpression(client, "!window.__naimageDebugAgentState?.().nodeEditorOpen", 5000);
  const compactCapture = await captureState(
    client,
    targetId,
    "canvas-image-collection-suite-min-884",
    null,
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      workbenchMinWidthOk: true,
      compactMainGridOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      canvasVisible: true,
      agentPanelVisible: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  const compactNormalEditorOpen = await evaluate(
    client,
    `window.__naimageAIDebug?.openNodeEditor?.({ id: ${JSON.stringify(String(suite?.ids?.singleId || ""))}, index: 0 })`
  );
  await waitForExpression(client, "Boolean(window.__naimageDebugAgentState?.().nodeEditorOpen)", 5000);
  const compactNormalEditorSpaceProof = await evaluate(client, `window.__naimageDebugAgentState?.().nodeEditorUi?.spaceUse || null`);
  const compactNormalEditorCapture = await captureState(
    client,
    targetId,
    "standard-node-editor-space-min-884",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: true,
      modalWithinViewport: true,
      accountOpen: false,
      titlebarOverlay: true,
      workbenchMinWidthOk: true,
      agentDebugReady: true,
      agentIdle: true
    }
  );
  compactNormalEditorCapture.nodeEditorSpaceProof = compactNormalEditorSpaceProof;
  compactNormalEditorCapture.nodeEditorOpen = compactNormalEditorOpen;
  if (!compactNormalEditorOpen?.ok || !compactNormalEditorSpaceProof?.ok || compactNormalEditorSpaceProof?.hasLayerPanel) {
    compactNormalEditorCapture.stateIssues.push({
      key: "compactStandardNodeEditorSpaceUseOk",
      expected: true,
      actual: { open: compactNormalEditorOpen, spaceUse: compactNormalEditorSpaceProof }
    });
  }
  await evaluate(client, `document.querySelector('.unified-node-editor [aria-label="关闭成果编辑器"]')?.click()`);
  await waitForExpression(client, "!window.__naimageDebugAgentState?.().nodeEditorOpen", 5000);
  const collectionSuite = JSON.parse(JSON.stringify(suite));
  const baseCaptures = [
    { ...capture, suite: collectionSuite, suitePath },
    { ...seriesCapture, suite: collectionSuite, suitePath, focusedNodeId: suite?.ids?.seriesId },
    { ...batchCapture, suite: collectionSuite, suitePath, focusedNodeId: suite?.ids?.batchId },
    { ...viewerCapture, suite: collectionSuite, suitePath, viewerOpen, focusedNodeId: suite?.ids?.batchId, viewerIndex: 4 },
    { ...normalEditorCapture, suite: collectionSuite, suitePath, focusedNodeId: suite?.ids?.singleId },
    { ...compactCapture, suite: collectionSuite, suitePath, compactOf: "canvas-image-collection-suite-1280" },
    { ...compactNormalEditorCapture, suite: collectionSuite, suitePath, focusedNodeId: suite?.ids?.singleId, compactOf: "standard-node-editor-space-1280" }
  ];
  // The collection suite already exercises the real image service in live-image
  // mode. Layout mutation has its own deterministic mock regression and must not
  // replace the live session or spend another long-running image request here.
  if (liveImage || options.runLayoutMutationRegression === false) return baseCaptures;
  await setWindowSize(client, targetId, 1280, 820);
  let layoutMutationRegression;
  try {
    layoutMutationRegression = await runCanvasLayoutMutationRegression({
      client,
      evaluate,
      fixturePath: dragFixturePaths[0],
      fixturePaths: dragFixturePaths
    });
  } catch (error) {
    layoutMutationRegression = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  suite.layoutMutationRegression = layoutMutationRegression;
  suite.layoutMutationOk = layoutMutationRegression?.ok === true;
  suite.steps = [
    ...(Array.isArray(suite.steps) ? suite.steps : []),
    {
      label: "canvas-image-layout-mutation-regression",
      ok: suite.layoutMutationOk,
      ...(layoutMutationRegression?.error ? { error: layoutMutationRegression.error } : {}),
      checks: Object.fromEntries(Object.entries(layoutMutationRegression?.results || {}).map(([key, value]) => [key, value?.ok === true]))
    }
  ];
  suite.ok = Boolean(collectionOk && suite.layoutMutationOk);
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!layoutMutationRegression?.ok) {
    recordObservation("issue", "canvas-image-layout-mutation-regression-failed", {
      suitePath,
      error: layoutMutationRegression?.error,
      results: layoutMutationRegression?.results
    });
  } else {
    recordObservation("info", "canvas-image-layout-mutation-regression-success", {
      suitePath,
      checks: Object.keys(layoutMutationRegression.results || {})
    });
  }
  await evaluate(client, `window.__naimageAIDebug.fitCanvas()`);
  const layoutMutationNodeCount = Number(layoutMutationRegression?.state?.nodeCount || 0);
  const layoutMutationImageNodeCount = Array.isArray(layoutMutationRegression?.state?.nodes)
    ? layoutMutationRegression.state.nodes.filter((node) => node?.type === "image").length
    : 0;
  const layoutMutationCapture = await captureState(
    client,
    targetId,
    "canvas-image-layout-mutation-regression-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: layoutMutationNodeCount,
      imageNodeCount: layoutMutationImageNodeCount,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true
    }
  );
  return [
    ...baseCaptures,
    { ...layoutMutationCapture, suite, suitePath, layoutMutationRegression }
  ];
}

  return {
    captureAgentImageRecoverySuiteProbe,
    captureAgentImageSuiteProbe,
    captureCanvasImageCollectionSuiteProbe
  };
}
