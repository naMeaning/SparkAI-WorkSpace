import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function createLayerEditingSuiteProbes({
  aidebugConfigDir,
  captureState,
  evaluate,
  fileSha256,
  generatedMaskPathForLayer,
  layerCompositeScreenshotMatchReport,
  liveImage,
  pngFileAlphaGeometryReport,
  pngFileAlphaReport,
  pngFileMagentaReport,
  pngFilesVisualFidelityReport,
  pngTextLayerShapeReport,
  realAgent,
  recordObservation,
  runDir,
  runLayerSemanticReplayAudit,
  setWindowSize,
  waitForExpression,
  workbenchMinWidth
}) {
function layerStackDomProofExpression(groupId) {
  return `(() => {
    const groupId = ${JSON.stringify(String(groupId || ""))};
    const canvas = document.querySelector('.workflow-canvas');
    const canvasRect = canvas?.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll('.flow-node.layer-group-member'))
      .filter((node) => node.getAttribute('data-layer-group') === groupId)
      .sort((left, right) => Number(left.getAttribute('data-layer-order') || 0) - Number(right.getAttribute('data-layer-order') || 0));
    const rect = (node) => {
      const box = node?.getBoundingClientRect();
      return box ? { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) } : null;
    };
    const within = (box, outer) => Boolean(box && outer && box.left >= outer.left - 1 && box.top >= outer.top - 1 && box.right <= outer.right + 1 && box.bottom <= outer.bottom + 1);
    const members = nodes.map((node) => {
      const image = node.querySelector('.node-image-tile img');
      const tab = node.querySelector('.node-layer-member-tab');
      const titlebar = node.querySelector('.node-layer-group-titlebar');
      const tabCopy = tab?.querySelector('.node-layer-tab-copy');
      const tabCopyStyle = tabCopy ? getComputedStyle(tabCopy) : null;
      const nodeRect = node.getBoundingClientRect();
      const head = node.querySelector('.node-head');
      const footer = node.querySelector('footer');
      const preview = node.querySelector('.node-image-preview');
      const previewRect = preview?.getBoundingClientRect();
      const tabRect = tab?.getBoundingClientRect();
      const tabHitStack = tabRect
        ? document.elementsFromPoint(tabRect.left + tabRect.width / 2, tabRect.top + tabRect.height / 2)
        : [];
      const tabTopHit = tabHitStack[0] || null;
      return {
        id: node.getAttribute('data-node-id') || '',
        order: Number(node.getAttribute('data-layer-order') || 0),
        zIndex: Number.parseInt(getComputedStyle(node).zIndex || '0', 10) || 0,
        stacked: node.classList.contains('layer-group-stacked'),
        detached: node.getAttribute('data-layer-detached') === 'true',
        imageLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
        imageNaturalSize: image ? { width: image.naturalWidth, height: image.naturalHeight } : null,
        nodeRect: rect(node),
        tabRect: rect(tab),
        tabWithinCanvas: tab ? within(tab.getBoundingClientRect(), canvasRect) : false,
        tabHitVisible: Boolean(tab && tabTopHit && (tabTopHit === tab || tab.contains(tabTopHit))),
        tabTopHit: tabTopHit ? { tag: tabTopHit.tagName?.toLowerCase() || '', className: String(tabTopHit.className || ''), nodeId: tabTopHit.closest?.('.flow-node')?.getAttribute('data-node-id') || '' } : null,
        tabTitle: tab?.getAttribute('title') || '',
        tabCopyVisible: Boolean(tabCopyStyle && tabCopyStyle.display !== 'none' && tabCopyStyle.visibility !== 'hidden' && tabCopy.getBoundingClientRect().width > 0),
        titlebarRect: rect(titlebar),
        titlebarWithinCanvas: titlebar ? within(titlebar.getBoundingClientRect(), canvasRect) : null,
        transparentShell: Boolean(
          node.classList.contains('layer-group-stacked') &&
          head && getComputedStyle(head).display === 'none' &&
          footer && getComputedStyle(footer).display === 'none' &&
          previewRect && Math.abs(previewRect.width - nodeRect.width) <= 3 && Math.abs(previewRect.height - nodeRect.height) <= 3
        )
      };
    });
    const firstRect = members[0]?.nodeRect;
    const sameArtboard = Boolean(firstRect && members.every((member) => member.nodeRect &&
      Math.abs(member.nodeRect.left - firstRect.left) <= 1 && Math.abs(member.nodeRect.top - firstRect.top) <= 1 &&
      Math.abs(member.nodeRect.width - firstRect.width) <= 1 && Math.abs(member.nodeRect.height - firstRect.height) <= 1));
    const zOrderOk = members.length > 0 && members.every((member, index) => index === 0 || member.zIndex > members[index - 1].zIndex);
    const titlebars = members.filter((member) => member.titlebarRect);
    const tabs = members.map((member) => member.tabRect).filter(Boolean);
    const tabsNonOverlapping = tabs.every((box, index) => tabs.slice(index + 1).every((other) => {
      const overlapWidth = Math.max(0, Math.min(box.right, other.right) - Math.max(box.left, other.left));
      const overlapHeight = Math.max(0, Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top));
      return overlapWidth * overlapHeight <= 2;
    }));
    const imagesLoaded = members.length === 6 && members.every((member) => member.imageLoaded);
    const tabsWithinCanvas = members.length === 6 && members.every((member) => member.tabWithinCanvas);
    const tabHitVisibleCount = members.filter((member) => member.tabHitVisible).length;
    const tabOccluded = members.filter((member) => !member.tabHitVisible).map((member) => ({ id: member.id, order: member.order, tabRect: member.tabRect, tabTopHit: member.tabTopHit }));
    const tabLabelsAccessible = members.every((member) => member.tabCopyVisible || member.tabTitle.length > 0);
    const titlebarBoundsOk = titlebars.length === 1 && titlebars[0].titlebarWithinCanvas === true;
    const transparentShells = members.length === 6 && members.every((member) => member.transparentShell);
    return {
      ok: Boolean(canvasRect && members.length === 6 && sameArtboard && zOrderOk && imagesLoaded && tabsWithinCanvas && tabHitVisibleCount === 6 && tabsNonOverlapping && tabLabelsAccessible && titlebarBoundsOk && transparentShells),
      groupId,
      canvasRect: rect(canvas),
      memberCount: members.length,
      sameArtboard,
      zOrderOk,
      imagesLoaded,
      tabsWithinCanvas,
      tabHitVisibleCount,
      tabOccluded,
      tabsNonOverlapping,
      tabLabelsAccessible,
      titlebarBoundsOk,
      transparentShells,
      members
    };
  })()`;
}

function detachedLayerDomProofExpression(nodeId) {
  return `(() => {
    const nodeId = ${JSON.stringify(String(nodeId || ""))};
    const node = document.querySelector('.flow-node[data-node-id="' + CSS.escape(nodeId) + '"]');
    const canvas = document.querySelector('.workflow-canvas');
    const image = node?.querySelector('.node-image-tile img');
    const nodeRect = node?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const head = node?.querySelector('.node-head');
    const footer = node?.querySelector('footer');
    const viewportOk = Boolean(nodeRect && canvasRect && nodeRect.left >= canvasRect.left - 1 && nodeRect.top >= canvasRect.top - 1 && nodeRect.right <= canvasRect.right + 1 && nodeRect.bottom <= canvasRect.bottom + 1);
    return {
      ok: Boolean(
        node && node.classList.contains('layer-group-detached') && node.getAttribute('data-layer-detached') === 'true' &&
        head && getComputedStyle(head).display !== 'none' && footer && getComputedStyle(footer).display !== 'none' &&
        image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 &&
        !node.querySelector('.node-layer-member-tab') && !node.querySelector('.node-image-export-handle') && viewportOk
      ),
      nodeId,
      detached: Boolean(node?.classList.contains('layer-group-detached')),
      headDisplay: head ? getComputedStyle(head).display : '',
      footerDisplay: footer ? getComputedStyle(footer).display : '',
      imageLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
      tabPresent: Boolean(node?.querySelector('.node-layer-member-tab')),
      exportHandlePresent: Boolean(node?.querySelector('.node-image-export-handle')),
      viewportOk,
      nodeRect: nodeRect ? { left: Math.round(nodeRect.left), top: Math.round(nodeRect.top), right: Math.round(nodeRect.right), bottom: Math.round(nodeRect.bottom), width: Math.round(nodeRect.width), height: Math.round(nodeRect.height) } : null
    };
  })()`;
}

function soloLayerViewerDomProofExpression() {
  return `(() => {
    const viewer = document.querySelector('.layer-group-viewer');
    const stage = viewer?.querySelector('.layer-viewer-stage');
    const rail = viewer?.querySelector('.layer-viewer-rail');
    const images = Array.from(viewer?.querySelectorAll('.layer-viewer-image-stack > img') || []);
    const activeMode = Array.from(viewer?.querySelectorAll('.layer-viewer-mode-switch button') || []).find((button) => button.classList.contains('active'));
    const activeRow = viewer?.querySelector('.layer-viewer-rail article.active');
    const visibleImages = images.filter((image) => Number.parseFloat(getComputedStyle(image).opacity || '0') >= 0.9);
    const hiddenImages = images.filter((image) => Number.parseFloat(getComputedStyle(image).opacity || '0') <= 0.05);
    const loaded = images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    const viewerRect = viewer?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    const within = (box) => Boolean(box && viewerRect && box.left >= viewerRect.left - 1 && box.top >= viewerRect.top - 1 && box.right <= viewerRect.right + 1 && box.bottom <= viewerRect.bottom + 1);
    return {
      ok: Boolean(viewer && stage && rail && activeMode?.textContent?.includes('单层') && activeRow && images.length === 6 && visibleImages.length === 1 && hiddenImages.length === 5 && loaded && within(stageRect) && within(railRect)),
      activeMode: (activeMode?.textContent || '').trim(),
      activeRow: (activeRow?.textContent || '').replace(/\\s+/g, ' ').trim(),
      imageCount: images.length,
      visibleImageCount: visibleImages.length,
      hiddenImageCount: hiddenImages.length,
      loaded,
      stageWithinViewer: within(stageRect),
      railWithinViewer: within(railRect)
    };
  })()`;
}

async function captureLayerStackSuiteProbe(client, targetId) {
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runLayerStackSuite && window.__iiimageDebugAgentState)", 10000);
  await evaluate(client, `window.__iiimageAIDebug?.resetLayerDetachAudit?.()`);
  recordObservation("info", "layer-stack-suite-request", {
    prompt: "验证六个独立分层 PNG 节点、真实 alpha、逐层文件、单层拖出、整组重组和画布显示。"
  });
  let suiteSettled = false;
  const suitePromise = evaluate(
    client,
    `window.__iiimageAIDebug.runLayerStackSuite({ agentDriven: ${JSON.stringify(realAgent)}, liveImage: ${JSON.stringify(liveImage)} })`,
    realAgent || liveImage ? 1_500_000 : 180000
  );
  const suiteSettlement = suitePromise.then(
    () => { suiteSettled = true; },
    () => { suiteSettled = true; }
  );
  if (realAgent || liveImage) {
    let heartbeat = 0;
    while (!suiteSettled) {
      await Promise.race([suiteSettlement, delay(15000)]);
      if (suiteSettled) break;
      heartbeat += 1;
      let state = null;
      try {
        state = await evaluate(client, `(() => {
          const current = window.__iiimageDebugAgentState?.() || {};
          const progress = Array.isArray(current.progress) ? current.progress : [];
          const last = progress.length ? progress[progress.length - 1] : null;
          return {
            agentStatus: current.agentStatus || "unknown",
            nodeCount: Number(current.nodeCount || 0),
            messageCount: Number(current.messageCount || 0),
            progressCount: Number(current.progressCount || progress.length || 0),
            lastProgress: last ? {
              phase: last.phase || "",
              tool: last.tool || "",
              operation: last.operation || "",
              summary: last.summary || "",
              retryCount: Number(last.retryCount || 0),
              childTaskId: last.childTaskId || ""
            } : null
          };
        })()`, 10000);
      } catch (error) {
        state = { probeError: error instanceof Error ? error.message : String(error) };
      }
      let imageOutputCount = 0;
      let latestOutputAt = "";
      try {
        const imagegenDir = join(aidebugConfigDir, "projects", "default", "output", "imagegen");
        const outputFiles = existsSync(imagegenDir)
          ? readdirSync(imagegenDir).filter((name) => name.toLowerCase().endsWith(".png"))
          : [];
        imageOutputCount = outputFiles.length;
        latestOutputAt = outputFiles.reduce((latest, name) => {
          try {
            const value = statSync(join(imagegenDir, name)).mtime.toISOString();
            return value > latest ? value : latest;
          } catch {
            return latest;
          }
        }, "");
      } catch {
        // The renderer state still provides the primary heartbeat evidence.
      }
      recordObservation("info", "layer-stack-suite-heartbeat", {
        heartbeat,
        elapsedMs: heartbeat * 15000,
        imageOutputCount,
        latestOutputAt,
        state
      });
    }
  }
  const suite = await suitePromise;
  if (!suite?.groupId) {
    const suitePath = join(runDir, "layer-stack-suite.json");
    writeFileSync(suitePath, JSON.stringify(suite, null, 2));
    recordObservation("issue", "layer-stack-core-suite-failed-before-node-commit", {
      ok: false,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error, detail: item.detail })),
      issues: suite?.issues
    });
    const failedState = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
    const capture = await captureState(
      client,
      targetId,
      "layer-stack-failed-before-commit-1280",
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
        agentNodeCount: Number(failedState?.nodeCount || 0),
        imageNodeCount: Number(failedState?.nodes?.filter?.((node) => node?.type === "image")?.length || 0),
        imageNodeViewportOk: true,
        imagePreviewVisibleCountOk: true
      }
    );
    return [{ ...capture, suite, suitePath }];
  }
  const postSuiteLayerState = await evaluate(client, `window.__iiimageAIDebug?.layerState?.()`);
  const postSuiteMembers = Array.isArray(postSuiteLayerState?.nodes)
    ? postSuiteLayerState.nodes.filter((node) => node?.layerGroup?.id === suite.groupId)
    : [];
  const unexpectedlyDetached = postSuiteMembers.filter((node) => node?.layerGroup?.detached === true);
  const layerDriftAudit = {
    ok: unexpectedlyDetached.length === 0,
    groupId: suite.groupId,
    detachedNodeIds: unexpectedlyDetached.map((node) => node.id),
    members: postSuiteMembers,
    audit: Array.isArray(postSuiteLayerState?.detachAudit) ? postSuiteLayerState.detachAudit : [],
    recovery: null
  };
  if (unexpectedlyDetached.length) {
    recordObservation("issue", "layer-stack-unexpected-detach", layerDriftAudit);
    const recovery = await evaluate(
      client,
      `window.__iiimageAIDebug?.recomposeLayer?.({ id: ${JSON.stringify(String(unexpectedlyDetached[0]?.id || suite.subjectId || suite.stackId || ""))} })`,
      30000
    );
    layerDriftAudit.recovery = recovery;
    try {
      await waitForExpression(client, `Boolean(window.__iiimageDebugAgentState?.().nodes?.filter((item) => item.layerGroup?.id === ${JSON.stringify(String(suite.groupId))}).every((item) => item.layerGroup?.detached === false))`, 8000);
    } catch {
      // Recovery evidence below retains the unresolved live state.
    }
    suite.issues = [...(Array.isArray(suite.issues) ? suite.issues : []), {
      label: "unexpected-layer-detach",
      error: "分层节点在无预期操作时脱离叠放状态；已保留来源审计并执行规范重组。",
      detail: layerDriftAudit
    }];
    suite.ok = false;
  }
  suite.layerDriftAudit = layerDriftAudit;
  suite.state = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
  const layerNodes = Array.isArray(suite?.state?.nodes)
    ? suite.state.nodes.filter((node) => node?.layerGroup?.id === suite?.groupId)
    : [];
  const group = layerNodes[0]?.layerGroup || null;
  const layerAssets = layerNodes.map((node) => ({
    role: String(node?.layerGroup?.role || ""),
    title: String(node?.layerGroup?.layerTitle || node?.title || ""),
    layerId: String(node?.layerGroup?.layerId || ""),
    runId: String(node?.assets?.[0]?.runId || ""),
    path: String(node?.assets?.[0]?.path || "")
  }));
  const alphaReports = layerAssets
    .filter((layer) => layer.path)
    .map((layer) => ({ ...layer, ...pngFileAlphaReport(layer.path), ...pngFileMagentaReport(layer.path), ...pngFileAlphaGeometryReport(layer.path) }));
  const nonBackgroundAlphaReports = alphaReports.filter((report) => report.role !== "background");
  const backgroundAlphaReports = alphaReports.filter((report) => report.role === "background");
  const allLayerPaths = [
    String(group?.previewAsset?.path || ""),
    String(group?.mergedAsset?.path || ""),
    ...layerAssets.map((layer) => layer.path)
  ].filter(Boolean);
  const expectedDeliverySize = { width: 1024, height: 1024 };
  const dimensionsOk = alphaReports.length === 6 && alphaReports.every((report) => report.ok && report.width === Number(group?.compositionWidth || 0) && report.height === Number(group?.compositionHeight || 0));
  const deliveryDimensionsOk = Boolean(
    dimensionsOk && Number(group?.compositionWidth || 0) === expectedDeliverySize.width && Number(group?.compositionHeight || 0) === expectedDeliverySize.height
  );
  const alphaOk = Boolean(
    alphaReports.length === 6 &&
    nonBackgroundAlphaReports.length === 5 &&
    nonBackgroundAlphaReports.every((report) => report.ok && Number(report.transparentRatio || 0) + Number(report.partialRatio || 0) >= 0.04) &&
    backgroundAlphaReports.length === 1 &&
    backgroundAlphaReports.every((report) => report.ok && Number(report.transparentRatio || 0) + Number(report.partialRatio || 0) <= 0.02)
  );
  const pathsOk = allLayerPaths.length === 8 && allLayerPaths.every((assetPath) => existsSync(assetPath) && assetPath.replace(/\\/g, "/").includes("/output/imagegen/layers/group-001/"));
  const mergedChromaReport = group?.mergedAsset?.path
    ? pngFileMagentaReport(String(group.mergedAsset.path))
    : { ok: false, error: "merged path missing" };
  const nonBackgroundChromaOk = nonBackgroundAlphaReports.every((report) => report.ok && Number(report.magentaRatio || 0) <= 0.002);
  const mergedChromaOk = Boolean(mergedChromaReport.ok && Number(mergedChromaReport.magentaRatio || 0) <= 0.002);
  const textContentOk = alphaReports
    .filter((report) => report.role === "text")
    .every((report) => {
      const visiblePixels = (Number(report.partialRatio || 0) + Number(report.opaqueRatio || 0)) * Number(report.width || 0) * Number(report.height || 0);
      const minimumVisiblePixels = Math.max(192, Math.round(Math.min(Number(report.width || 0), Number(report.height || 0)) * 0.75));
      return report.ok && visiblePixels >= minimumVisiblePixels;
    });
  const textShapeReports = layerAssets
    .filter((layer) => layer.role === "text")
    .map((layer) => {
      const maskPath = generatedMaskPathForLayer(layer);
      return {
        role: layer.role,
        title: layer.title,
        layerId: layer.layerId,
        ...pngTextLayerShapeReport(maskPath, layer.path)
      };
    });
  const textShapeOk = textShapeReports.length === 2 && textShapeReports.every((report) => report.ok === true);
  const semanticReplayAudit = await runLayerSemanticReplayAudit(layerAssets);
  const semanticReplayOk = semanticReplayAudit.ok === true;
  const subjectArtifactReports = alphaReports.filter((report) => report.role === "subject");
  const localArtifactOk = Boolean(
    subjectArtifactReports.length === 1 &&
    (!realAgent && !liveImage || subjectArtifactReports.every((report) => report.alphaGeometryOk === true))
  );
  const lastAssistantNarration = String(suite?.state?.lastAssistant || "").trim();
  const narrationPending = /(?:正在|仍在).{0,24}(?:校验|重组|提交)|校验完成后|完成后.{0,16}提交|将提交.{0,16}画布/.test(lastAssistantNarration);
  const narrationCompletionMentioned = /完成|已提交|画布已更新|提交到画布/.test(lastAssistantNarration);
  const agentNarrationReport = {
    checked: Boolean(realAgent),
    ok: !realAgent || Boolean(lastAssistantNarration && !narrationPending && narrationCompletionMentioned),
    mode: realAgent ? "agent-conversation" : liveImage ? "direct-live-image-tool" : "mock-tool",
    pending: narrationPending,
    completionMentioned: narrationCompletionMentioned,
    text: lastAssistantNarration
  };
  const previewFidelityReport = await pngFilesVisualFidelityReport(String(group?.previewAsset?.path || ""), String(group?.mergedAsset?.path || ""));
  const previewFidelityOk = previewFidelityReport.ok === true;
  const exportStep = Array.isArray(suite?.steps) ? suite.steps.find((item) => item?.label === "layer-export-bridges") : null;
  const exportDetail = exportStep?.detail || {};
  let exportProof = { ok: false, error: "layer export step missing" };
  try {
    const sourcePath = String(exportDetail?.sourcePath || "");
    const savedPath = String(exportDetail?.saved?.path || "");
    const singleLayerPsdPath = String(exportDetail?.singleLayerPsd?.path || "");
    const folderPath = String(exportDetail?.folder?.path || "");
    const psdPath = String(exportDetail?.psd?.path || "");
    const manifestPath = join(folderPath, "layers.json");
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    const folderFiles = Array.isArray(exportDetail?.folder?.files) ? exportDetail.folder.files.map(String) : [];
    const byteIdentityOk = Boolean(
      sourcePath && savedPath &&
      existsSync(sourcePath) && existsSync(savedPath) &&
      fileSha256(sourcePath) === fileSha256(savedPath)
    );
    const folderOk = Boolean(
      folderPath && existsSync(folderPath) && folderFiles.length === 9 && folderFiles.every((filePath) => existsSync(filePath)) &&
      manifest?.format === "iiimage-layer-export" && manifest?.version === 1 && Array.isArray(manifest?.layers) && manifest.layers.length === 6 &&
      manifest.layers.every((layer, index) => layer?.order === index + 1 && typeof layer?.fileName === "string" && existsSync(join(folderPath, layer.fileName))) &&
      !JSON.stringify(manifest).includes(String(dirname(sourcePath)))
    );
    const singleLayerPsdOk = Boolean(
      singleLayerPsdPath && existsSync(singleLayerPsdPath) &&
      readFileSync(singleLayerPsdPath).length > 1024 &&
      exportDetail?.singleLayerPsd?.count === 1 &&
      Number(exportDetail?.singleLayerPsd?.width || 0) === Number(group?.compositionWidth || 0) &&
      Number(exportDetail?.singleLayerPsd?.height || 0) === Number(group?.compositionHeight || 0)
    );
    const psdOk = Boolean(psdPath && existsSync(psdPath) && readFileSync(psdPath).length > 1024 && exportDetail?.psd?.count === 6);
    exportProof = {
      ok: Boolean(exportStep?.ok && byteIdentityOk && singleLayerPsdOk && folderOk && psdOk),
      sourcePath,
      savedPath,
      singleLayerPsdPath,
      folderPath,
      psdPath,
      byteIdentityOk,
      singleLayerPsdOk,
      folderOk,
      psdOk,
      manifestLayerCount: manifest?.layers?.length || 0,
      folderFileCount: folderFiles.length,
      error: ""
    };
  } catch (error) {
    exportProof = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  await delay(760);
  const sessionPath = join(aidebugConfigDir, "projects", "default", "session.json");
  let persistence = { ok: false, path: sessionPath, error: "session missing" };
  try {
    if (existsSync(sessionPath)) {
      const session = JSON.parse(readFileSync(sessionPath, "utf8"));
      const storedLayerNodes = Array.isArray(session?.nodes) ? session.nodes.filter((node) => node?.layerGroup?.id === suite?.groupId) : [];
      const storedGroup = storedLayerNodes[0]?.layerGroup;
      const anchors = new Set(storedLayerNodes.map((node) => `${node?.x}:${node?.y}`));
      persistence = {
        ok: Boolean(
          storedLayerNodes.length === 6 &&
          new Set(storedLayerNodes.map((node) => node?.id)).size === 6 &&
          anchors.size === 1 &&
          storedGroup?.groupNumber === 1 &&
          storedGroup?.total === 6 &&
          storedLayerNodes.every((node, index) =>
            node?.layerGroup?.order === index + 1 &&
            node?.layerGroup?.detached === false &&
            !node?.layerComposition &&
            node?.assets?.length === 1 &&
            existsSync(String(node?.assets?.[0]?.path || ""))
          )
        ),
        path: sessionPath,
        nodeCount: storedLayerNodes.length,
        groupNumber: storedGroup?.groupNumber,
        layerCount: storedLayerNodes.length,
        uniqueNodeCount: new Set(storedLayerNodes.map((node) => node?.id)).size,
        anchors: [...anchors],
        error: ""
      };
    }
  } catch (error) {
    persistence = { ok: false, path: sessionPath, error: error instanceof Error ? error.message : String(error) };
  }
  suite.assetProof = {
    alphaOk,
    dimensionsOk,
    deliveryDimensionsOk,
    expectedDeliverySize,
    pathsOk,
    nonBackgroundChromaOk,
    mergedChromaOk,
    mergedChromaReport,
    textContentOk,
    textShapeOk,
    textShapeReports,
    semanticReplayOk,
    semanticReplayAudit,
    localArtifactOk,
    subjectArtifactReports,
    agentNarrationReport,
    previewFidelityOk,
    previewFidelityReport,
    alphaReports,
    nonBackgroundAlphaReports,
    backgroundAlphaReports,
    allLayerPaths,
    persistence,
    exportProof
  };
  suite.ok = Boolean(suite?.ok && layerDriftAudit.ok && alphaOk && dimensionsOk && deliveryDimensionsOk && pathsOk && nonBackgroundChromaOk && mergedChromaOk && textContentOk && textShapeOk && semanticReplayOk && localArtifactOk && agentNarrationReport.ok && previewFidelityOk && persistence.ok && exportProof.ok);
  const coreSuiteOk = Boolean(suite.ok);
  recordObservation(coreSuiteOk ? "info" : "issue", "layer-stack-core-suite-complete", {
    ok: coreSuiteOk,
    stackId: suite?.stackId,
    steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
    issues: suite?.issues,
    assetProof: suite.assetProof
  });
  const suitePath = join(runDir, "layer-stack-suite.json");
  let layerDomProofWaitError = "";
  try {
    await waitForExpression(
      client,
      `Boolean((${layerStackDomProofExpression(suite?.groupId)}).ok)`,
      8000
    );
  } catch (error) {
    layerDomProofWaitError = error instanceof Error ? error.message : String(error);
  }
  const layerDomProof = await evaluate(client, layerStackDomProofExpression(suite?.groupId));
  if (!layerDomProof?.ok) {
    suite.ok = false;
    recordObservation("issue", "layer-stack-dom-proof-failed", {
      groupId: suite?.groupId,
      waitError: layerDomProofWaitError,
      proof: layerDomProof
    });
  }
  suite.evidence = {
    fileAlpha: {
      ok: Boolean(alphaOk && dimensionsOk && deliveryDimensionsOk && nonBackgroundChromaOk && mergedChromaOk && textContentOk && textShapeOk && semanticReplayOk && localArtifactOk && agentNarrationReport.ok && previewFidelityOk),
      alphaOk,
      dimensionsOk,
      deliveryDimensionsOk,
      nonBackgroundChromaOk,
      mergedChromaOk,
      textContentOk,
      textShapeOk,
      textShapeReports,
      semanticReplayOk,
      semanticReplayAudit,
      localArtifactOk,
      subjectArtifactReports,
      agentNarrationReport,
      previewFidelityOk,
      previewFidelityReport,
      alphaReports,
      backgroundAlphaReports,
      nonBackgroundAlphaReports
    },
    domStack: { desktop: layerDomProof, waitError: layerDomProofWaitError },
    screenshotPixels: {},
    intermediateStates: {},
    compact: {},
    manualVisual: {
      status: "pending-human-review",
      autoPassAllowed: false,
      note: "人工视觉结论必须独立检查截图，不由 alpha、DOM 或像素断言代替。"
    }
  };
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  const capture = await captureState(
    client,
    targetId,
    "layer-stack-suite-1280",
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
      agentNodeCount: 6,
      imageNodeCount: 6,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true,
      provenanceEdgeVisible: false
    }
  );
  const compositeScreenshotReport = layerCompositeScreenshotMatchReport({
    screenshotPath: capture.screenshotPath,
    capture,
    mergedPath: String(group?.mergedAsset?.path || ""),
    nodeId: String(suite?.stackId || suite?.subjectId || "")
  });
  capture.layerDomProof = layerDomProof;
  capture.layerCompositeScreenshotReport = compositeScreenshotReport;
  if (!layerDomProof?.ok) capture.stateIssues.push({ key: "layerStackDomProofOk", expected: true, actual: layerDomProof });
  if (!compositeScreenshotReport?.ok) capture.captureIssues.push({ key: "layerCompositeMatchesMergedOk", expected: true, actual: compositeScreenshotReport });
  suite.evidence.domStack.desktop = layerDomProof;
  suite.evidence.screenshotPixels.compositeVsMerged = compositeScreenshotReport;
  const detachedNodeId = String(suite?.subjectId || suite?.stackId || "");
  const detachedMenu = await evaluate(client, `window.__iiimageAIDebug?.openNodeMenu?.({ id: ${JSON.stringify(detachedNodeId)} })`, 10000);
  const detachedClick = await evaluate(client, `(() => {
    const button = Array.from(document.querySelectorAll('.canvas-context-menu button'))
      .find((item) => (item.textContent || '').includes('展开到画布'));
    button?.click();
    return { ok: Boolean(button), text: (button?.textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`);
  await waitForExpression(client, `Boolean(window.__iiimageDebugAgentState?.().nodes?.filter((item) => item.layerGroup?.id === ${JSON.stringify(String(suite?.groupId || ""))}).every((item) => item.layerGroup?.detached === true))`, 5000);
  const detachedFit = await evaluate(client, `window.__iiimageAIDebug?.fitCanvas?.()`, 10000);
  const detachedState = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
  const detachedMembers = Array.isArray(detachedState?.nodes)
    ? detachedState.nodes.filter((item) => item?.layerGroup?.id === suite?.groupId)
    : [];
  const detachedAction = {
    ok: Boolean(detachedMenu?.ok && detachedClick?.ok && detachedFit?.ok && detachedMembers.length === 6 && detachedMembers.every((item) => item?.layerGroup?.detached === true)),
    mode: "explode-all",
    nodeId: detachedNodeId,
    menu: detachedMenu,
    click: detachedClick,
    fit: detachedFit,
    members: detachedMembers
  };
  await waitForExpression(
    client,
    `Boolean((${detachedLayerDomProofExpression(suite?.subjectId || suite?.stackId)}).ok)`,
    8000
  );
  const detachedDomProof = await evaluate(client, detachedLayerDomProofExpression(suite?.subjectId || suite?.stackId));
  const detachedCapture = await captureState(
    client,
    targetId,
    "layer-stack-detached-1280",
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
      agentNodeCount: 6,
      imageNodeCount: 6,
      imageNodeViewportOk: true,
      imagePreviewLoadedOk: true,
      nodeOverlapOk: true
    }
  );
  detachedCapture.detachedAction = detachedAction;
  detachedCapture.detachedDomProof = detachedDomProof;
  if (!detachedAction?.ok || !detachedDomProof?.ok) {
    detachedCapture.stateIssues.push({ key: "detachedLayerVisualProofOk", expected: true, actual: { detachedAction, detachedDomProof } });
  }
  const recomposedAction = await evaluate(
    client,
    `window.__iiimageAIDebug?.recomposeLayer?.({ id: ${JSON.stringify(String(suite?.subjectId || suite?.stackId || ""))} })`,
    30000
  );
  await evaluate(client, `window.__iiimageAIDebug?.fitCanvas?.()`, 10000);
  await waitForExpression(client, `Boolean(window.__iiimageDebugAgentState?.().nodes?.filter((item) => item.layerGroup?.id === ${JSON.stringify(String(suite?.groupId || ""))}).every((item) => item.layerGroup?.detached === false))`, 5000);
  // Recomposition deliberately gives the active layer a short settle animation.
  // Reading geometry as soon as the state flips to `detached: false` observes an
  // intermediate scale and can report a false artboard mismatch.  Treat the UI
  // animation as part of the contract: wait until it has finished and all six
  // independent layer nodes really share one stable artboard before capturing
  // evidence.  This keeps the assertion strict without disabling the animation.
  await waitForExpression(
    client,
    `Boolean(!document.querySelector('.flow-node.layer-group-member.active-build') && (${layerStackDomProofExpression(suite?.groupId)}).ok)`,
    5000
  );
  const recomposedDomProof = await evaluate(client, layerStackDomProofExpression(suite?.groupId));
  suite.evidence.intermediateStates.detached = {
    ok: Boolean(detachedAction?.ok && detachedDomProof?.ok && detachedCapture?.screenshotSource !== "fallback"),
    action: detachedAction,
    dom: detachedDomProof,
    screenshotPath: detachedCapture.screenshotPath,
    screenshotSource: detachedCapture.screenshotSource,
    screenshotFrameReport: detachedCapture.screenshotFrameReport
  };
  suite.evidence.intermediateStates.recomposed = {
    ok: Boolean(recomposedAction?.ok && recomposedDomProof?.ok),
    action: recomposedAction,
    dom: recomposedDomProof
  };
  await evaluate(client, `(() => {
    const titlebar = document.querySelector('.flow-node[data-node-id="${String(suite?.stackId || suite?.subjectId || "").replace(/"/g, '\\"')}"] .node-layer-group-titlebar')
      || document.querySelector('.node-layer-group-titlebar');
    titlebar?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    return Boolean(titlebar);
  })()`);
  await waitForExpression(client, "Boolean(document.querySelector('.layer-group-viewer'))", 5000);
  const viewerCapture = await captureState(
    client,
    targetId,
    "layer-group-viewer-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true
    }
  );
  const soloLayerAction = await evaluate(client, `(() => {
    const viewer = document.querySelector('.layer-group-viewer');
    const subject = Array.from(viewer?.querySelectorAll('.layer-viewer-rail article') || [])
      .find((article) => (article.textContent || '').includes('subject'));
    subject?.querySelector('.layer-viewer-row')?.click();
    return { ok: Boolean(viewer && subject), subjectText: (subject?.textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`);
  await waitForExpression(client, `Array.from(document.querySelectorAll('.layer-group-viewer .layer-viewer-rail article'))
    .some((article) => article.classList.contains('active') && (article.textContent || '').includes('subject'))`, 5000);
  const soloModeAction = await evaluate(client, `(() => {
    const viewer = document.querySelector('.layer-group-viewer');
    const solo = Array.from(viewer?.querySelectorAll('.layer-viewer-mode-switch button') || [])
      .find((button) => (button.textContent || '').includes('单层'));
    solo?.click();
    return { ok: Boolean(viewer && solo) };
  })()`);
  await waitForExpression(client, "Boolean(document.querySelector('.layer-viewer-mode-switch button.active')?.textContent?.includes('单层'))", 5000);
  // The viewer deliberately animates layer opacity. Wait for the rendered
  // solo state instead of sampling at a fixed delay, which can race Chromium
  // compositing on slower Windows runs even though the eventual screenshot is
  // already correct.
  await waitForExpression(client, `Boolean((${soloLayerViewerDomProofExpression()})?.ok)`, 5000);
  const soloViewerDomProof = await evaluate(client, soloLayerViewerDomProofExpression());
  const soloViewerCapture = await captureState(
    client,
    targetId,
    "layer-group-viewer-solo-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true
    }
  );
  const soloViewerAction = { ok: Boolean(soloLayerAction?.ok && soloModeAction?.ok), layer: soloLayerAction, mode: soloModeAction };
  soloViewerCapture.soloModeAction = soloViewerAction;
  soloViewerCapture.soloViewerDomProof = soloViewerDomProof;
  if (!soloViewerAction.ok || !soloViewerDomProof?.ok) {
    soloViewerCapture.stateIssues.push({ key: "soloLayerViewerProofOk", expected: true, actual: { soloViewerAction, soloViewerDomProof } });
  }
  suite.evidence.intermediateStates.soloViewer = {
    ok: Boolean(soloViewerAction.ok && soloViewerDomProof?.ok && soloViewerCapture?.screenshotSource !== "fallback"),
    action: soloViewerAction,
    dom: soloViewerDomProof,
    screenshotPath: soloViewerCapture.screenshotPath,
    screenshotSource: soloViewerCapture.screenshotSource,
    screenshotFrameReport: soloViewerCapture.screenshotFrameReport
  };
  const compactViewerCapture = await captureState(
    client,
    targetId,
    "layer-group-viewer-min-884",
    null,
    { width: workbenchMinWidth, height: 720 },
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
  suite.evidence.intermediateStates.compactViewer = {
    ok: Boolean(compactViewerCapture?.screenshotSource !== "fallback" && compactViewerCapture?.state?.modalWithinViewport),
    screenshotPath: compactViewerCapture.screenshotPath,
    screenshotSource: compactViewerCapture.screenshotSource,
    screenshotFrameReport: compactViewerCapture.screenshotFrameReport
  };
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `document.querySelector('.layer-group-viewer > header [aria-label="关闭分层查看器"]')?.click()`);
  await waitForExpression(client, "!document.querySelector('.layer-group-viewer')", 5000);
  await evaluate(client, `(() => {
    const tab = document.querySelector('.flow-node[data-node-id="${String(suite?.subjectId || suite?.stackId || "").replace(/"/g, '\\"')}"] .node-layer-member-tab');
    tab?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    return Boolean(tab);
  })()`);
  await waitForExpression(client, "Boolean(window.__iiimageDebugAgentState?.().nodeEditorOpen)", 5000);
  const editorCapture = await captureState(
    client,
    targetId,
    "layer-stack-node-editor-1280",
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
  const editorSpaceProof = await evaluate(client, `window.__iiimageDebugAgentState?.().nodeEditorUi?.spaceUse || null`);
  editorCapture.nodeEditorSpaceProof = editorSpaceProof;
  if (!editorSpaceProof?.ok || !editorSpaceProof?.hasLayerPanel) {
    editorCapture.stateIssues.push({ key: "layerNodeEditorSpaceUseOk", expected: true, actual: editorSpaceProof });
  }
  suite.evidence.intermediateStates.nodeEditor = {
    ok: Boolean(editorSpaceProof?.ok && editorSpaceProof?.hasLayerPanel && editorCapture?.screenshotSource !== "fallback"),
    spaceUse: editorSpaceProof,
    screenshotPath: editorCapture.screenshotPath,
    screenshotSource: editorCapture.screenshotSource,
    screenshotFrameReport: editorCapture.screenshotFrameReport
  };
  await evaluate(client, `document.querySelector('.unified-node-editor [aria-label="关闭成果编辑器"]')?.click()`);
  await waitForExpression(client, "!window.__iiimageDebugAgentState?.().nodeEditorOpen", 5000);
  await setWindowSize(client, targetId, workbenchMinWidth, 720);
  await evaluate(client, `window.__iiimageAIDebug?.fitCanvas?.()`, 10000);
  const compactLayerDomProof = await evaluate(client, layerStackDomProofExpression(suite?.groupId));
  const compactCapture = await captureState(
    client,
    targetId,
    "layer-stack-suite-min-884",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      workbenchMinWidthOk: true,
      compactMainGridOk: true,
      agentDebugReady: true,
      agentIdle: true,
      canvasVisible: true,
      agentPanelVisible: true,
      imageNodeViewportOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  compactCapture.layerDomProof = compactLayerDomProof;
  if (!compactLayerDomProof?.ok) compactCapture.stateIssues.push({ key: "compactLayerStackDomProofOk", expected: true, actual: compactLayerDomProof });
  suite.evidence.domStack.compact = compactLayerDomProof;
  suite.evidence.compact.stack = {
    ok: Boolean(compactLayerDomProof?.ok && compactCapture?.screenshotSource !== "fallback"),
    dom: compactLayerDomProof,
    screenshotPath: compactCapture.screenshotPath,
    screenshotSource: compactCapture.screenshotSource,
    screenshotFrameReport: compactCapture.screenshotFrameReport
  };
  await evaluate(client, `(() => {
    const tab = document.querySelector('.flow-node[data-node-id="${String(suite?.subjectId || suite?.stackId || "").replace(/"/g, '\\"')}"] .node-layer-member-tab');
    tab?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    return Boolean(tab);
  })()`);
  await waitForExpression(client, "Boolean(window.__iiimageDebugAgentState?.().nodeEditorOpen)", 5000);
  const compactEditorCapture = await captureState(
    client,
    targetId,
    "layer-stack-node-editor-min-884",
    null,
    { width: workbenchMinWidth, height: 720 },
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
  const compactEditorProof = await evaluate(client, `(() => {
    const dialog = document.querySelector('.unified-node-editor');
    const body = dialog?.querySelector('.unified-node-editor-body');
    const preview = dialog?.querySelector('.unified-node-editor-preview');
    const fields = dialog?.querySelector('.unified-node-editor-fields');
    const layerPanel = dialog?.querySelector('.node-editor-layer-panel');
    const prompt = dialog?.querySelector('.unified-node-editor-fields textarea');
    const actions = Array.from(dialog?.querySelectorAll('.node-editor-action') || []);
    const rectOf = (node) => node ? node.getBoundingClientRect() : null;
    const dialogRect = rectOf(dialog);
    const bodyRect = rectOf(body);
    const previewRect = rectOf(preview);
    const fieldsRect = rectOf(fields);
    const actionMetrics = actions.map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        action: button.getAttribute('data-node-editor-action') || '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        borderRadius: parseFloat(style.borderRadius || '0') || 0,
        backgroundColor: style.backgroundColor,
        viewportOk: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
      };
    });
    const dialogViewportOk = Boolean(dialogRect && dialogRect.left >= -1 && dialogRect.top >= -1 && dialogRect.right <= innerWidth + 1 && dialogRect.bottom <= innerHeight + 1);
    const columnsUsable = Boolean(bodyRect && previewRect && fieldsRect && previewRect.width >= 220 && fieldsRect.width >= 320 && bodyRect.width <= (dialogRect?.width || 0) + 1);
    const fieldsStyle = fields ? getComputedStyle(fields) : null;
    const fieldsScrollOk = Boolean(fields && fieldsStyle && ['auto', 'scroll'].includes(fieldsStyle.overflowY) && fields.scrollHeight >= fields.clientHeight);
    const promptStyle = prompt ? getComputedStyle(prompt) : null;
    const spaceUse = window.__iiimageDebugAgentState?.().nodeEditorUi?.spaceUse || null;
    const rowGaps = [];
    for (let leftIndex = 0; leftIndex < actionMetrics.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < actionMetrics.length; rightIndex += 1) {
        const left = actionMetrics[leftIndex];
        const right = actionMetrics[rightIndex];
        if (Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) <= 2) continue;
        rowGaps.push(Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right)));
      }
    }
    const heights = actionMetrics.map((item) => item.height);
    const primaryAction = actionMetrics.find((item) => item.action === 'continue');
    const saveAction = actionMetrics.find((item) => item.action === 'save');
    const actionsOk = Boolean(
      actionMetrics.length >= 3 &&
      actionMetrics.every((item) => item.height >= 34 && item.borderRadius >= 4 && item.viewportOk) &&
      Math.max(...heights) - Math.min(...heights) <= 1 &&
      rowGaps.every((gap) => gap >= 10) &&
      primaryAction && saveAction && primaryAction.backgroundColor !== saveAction.backgroundColor
    );
    return {
      ok: Boolean(dialog && body && preview && fields && layerPanel && prompt && dialogViewportOk && columnsUsable && fieldsScrollOk && promptStyle?.resize === 'none' && actionsOk && spaceUse?.ok && spaceUse?.hasLayerPanel),
      viewport: { width: innerWidth, height: innerHeight },
      dialogViewportOk,
      columnsUsable,
      fieldsScrollOk,
      textareaResize: promptStyle?.resize || '',
      spaceUse,
      dialogRect: dialogRect ? { left: Math.round(dialogRect.left), top: Math.round(dialogRect.top), width: Math.round(dialogRect.width), height: Math.round(dialogRect.height), right: Math.round(dialogRect.right), bottom: Math.round(dialogRect.bottom) } : null,
      bodyRect: bodyRect ? { width: Math.round(bodyRect.width), height: Math.round(bodyRect.height) } : null,
      previewRect: previewRect ? { width: Math.round(previewRect.width), height: Math.round(previewRect.height) } : null,
      fieldsRect: fieldsRect ? { width: Math.round(fieldsRect.width), height: Math.round(fieldsRect.height), clientHeight: fields.clientHeight, scrollHeight: fields.scrollHeight } : null,
      rowGaps,
      actionMetrics
    };
  })()`);
  compactEditorCapture.layerEditorCompactProof = compactEditorProof;
  if (!compactEditorProof?.ok) {
    compactEditorCapture.stateIssues.push({ key: "layerEditorCompactProofOk", expected: true, actual: false });
  }
  suite.evidence.compact.editor = {
    ok: Boolean(compactEditorProof?.ok && compactEditorCapture?.screenshotSource !== "fallback"),
    dom: compactEditorProof,
    screenshotPath: compactEditorCapture.screenshotPath,
    screenshotSource: compactEditorCapture.screenshotSource,
    screenshotFrameReport: compactEditorCapture.screenshotFrameReport
  };
  const automatedEvidenceOk = Boolean(
    coreSuiteOk &&
    suite.evidence.fileAlpha.ok &&
    layerDomProof?.ok &&
    compositeScreenshotReport?.ok &&
    suite.evidence.intermediateStates.detached?.ok &&
    suite.evidence.intermediateStates.recomposed?.ok &&
    suite.evidence.intermediateStates.soloViewer?.ok &&
    suite.evidence.intermediateStates.compactViewer?.ok &&
    suite.evidence.intermediateStates.nodeEditor?.ok &&
    suite.evidence.compact.stack?.ok &&
    suite.evidence.compact.editor?.ok &&
    capture?.screenshotSource !== "fallback"
  );
  suite.evidence.automatedOk = automatedEvidenceOk;
  suite.ok = automatedEvidenceOk;
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite.ok) {
    recordObservation("issue", "layer-stack-suite-failed", {
      coreSuiteOk,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues,
      assetProof: suite.assetProof,
      evidence: suite.evidence
    });
  } else {
    recordObservation("info", "layer-stack-suite-success", {
      stackId: suite?.stackId,
      alphaReports,
      persistence,
      evidence: suite.evidence
    });
  }
  await evaluate(client, `document.querySelector('.unified-node-editor [aria-label="关闭成果编辑器"]')?.click()`);
  await waitForExpression(client, "!window.__iiimageDebugAgentState?.().nodeEditorOpen", 5000);
  return [
    { ...capture, suite, suitePath },
    { ...detachedCapture, suite, suitePath, focusedNodeId: suite?.subjectId || suite?.stackId },
    { ...viewerCapture, suite, suitePath, focusedNodeId: suite?.stackId || suite?.subjectId },
    { ...soloViewerCapture, suite, suitePath, focusedNodeId: suite?.subjectId || suite?.stackId },
    { ...compactViewerCapture, suite, suitePath, focusedNodeId: suite?.subjectId || suite?.stackId, compactOf: "layer-group-viewer-1280" },
    { ...editorCapture, suite, suitePath, focusedNodeId: suite?.subjectId || suite?.stackId },
    { ...compactCapture, suite, suitePath, compactOf: "layer-stack-suite-1280" },
    { ...compactEditorCapture, suite, suitePath, focusedNodeId: suite?.subjectId || suite?.stackId, compactOf: "layer-stack-node-editor-1280" }
  ];
}

async function captureCutoutSuiteProbe(client, targetId) {
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runCutoutSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "cutout-suite-request", { liveImage, prompt: "验证 AI 抠图必须先选区和描述，再生成真实 alpha、项目路径和画布来源关系。" });
  const suite = await evaluate(
    client,
    `window.__iiimageAIDebug.runCutoutSuite({ liveImage: ${JSON.stringify(liveImage)} })`,
    liveImage ? 900000 : 120000
  );
  const nodes = Array.isArray(suite?.state?.nodes) ? suite.state.nodes : [];
  const sourceNode = nodes.find((node) => node?.id === suite?.sourceId) || null;
  const cutoutNode = nodes.find((node) => node?.id === suite?.cutoutId) || null;
  const sourcePath = String(sourceNode?.assets?.[0]?.path || "");
  const cutoutPath = String(cutoutNode?.assets?.[0]?.path || "");
  const sourceReport = sourcePath ? pngFileAlphaReport(sourcePath) : { ok: false, error: "source path missing" };
  const cutoutReport = cutoutPath ? pngFileAlphaReport(cutoutPath) : { ok: false, error: "cutout path missing" };
  const alphaOk = Boolean(cutoutReport.ok && Number(cutoutReport.transparentRatio || 0) >= 0.04);
  const sizeOk = Boolean(sourceReport.ok && cutoutReport.ok && sourceReport.width === cutoutReport.width && sourceReport.height === cutoutReport.height);
  const pathOk = Boolean(cutoutPath && existsSync(cutoutPath) && cutoutPath.replace(/\\/g, "/").includes("/output/imagegen/cutout/"));
  suite.assetProof = { alphaOk, sizeOk, pathOk, sourceReport, cutoutReport, sourcePath, cutoutPath };
  suite.ok = Boolean(suite?.ok && alphaOk && sizeOk && pathOk);
  if (!suite.ok) {
    recordObservation("issue", "cutout-suite-failed", { steps: suite?.steps, issues: suite?.issues, assetProof: suite.assetProof });
  } else {
    recordObservation("info", "cutout-suite-success", { sourceId: suite?.sourceId, cutoutId: suite?.cutoutId, cutoutReport });
  }
  const suitePath = join(runDir, "cutout-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  const capture = await captureState(
    client,
    targetId,
    "cutout-suite-1280",
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
      agentNodeCount: 2,
      imageNodeCount: 2,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true,
      provenanceEdgeVisible: true
    }
  );
  return { ...capture, suite, suitePath };
}

async function captureRegionRedrawSuiteProbe(client, targetId) {
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runRegionRedrawSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "region-redraw-suite-request", {
    liveImage,
    prompt: "验证 Agent 无蒙版请求自动打开涂抹 UI、真实 mask、Image 2 重绘成果和画布来源关系。"
  });
  const suite = await evaluate(
    client,
    `window.__iiimageAIDebug.runRegionRedrawSuite({ liveImage: ${JSON.stringify(liveImage)} })`,
    liveImage ? 1200000 : 180000
  );
  const nodes = Array.isArray(suite?.state?.nodes) ? suite.state.nodes : [];
  const sourceNode = nodes.find((node) => node?.id === suite?.sourceId) || null;
  const redrawNode = nodes.find((node) => node?.id === suite?.redrawId) || null;
  const sourcePath = String(sourceNode?.assets?.[0]?.path || "");
  const redrawPath = String(redrawNode?.assets?.[0]?.path || "");
  const sourceReport = sourcePath ? pngFileAlphaReport(sourcePath) : { ok: false, error: "source path missing" };
  const redrawReport = redrawPath ? pngFileAlphaReport(redrawPath) : { ok: false, error: "redraw path missing" };
  const sizeOk = Boolean(sourceReport.ok && redrawReport.ok && sourceReport.width === redrawReport.width && sourceReport.height === redrawReport.height);
  const pathOk = Boolean(redrawPath && existsSync(redrawPath) && redrawPath.replace(/\\/g, "/").includes("/output/imagegen/"));
  const sourceRelationOk = Boolean(redrawNode?.parentId === suite?.sourceId && redrawNode?.relationType === "derived-from");
  suite.assetProof = { sizeOk, pathOk, sourceRelationOk, sourceReport, redrawReport, sourcePath, redrawPath };
  suite.ok = Boolean(suite?.ok && sizeOk && pathOk && sourceRelationOk);
  if (!suite.ok) {
    recordObservation("issue", "region-redraw-suite-failed", { steps: suite?.steps, issues: suite?.issues, assetProof: suite.assetProof });
  } else {
    recordObservation("info", "region-redraw-suite-success", { sourceId: suite?.sourceId, redrawId: suite?.redrawId, redrawReport });
  }
  const suitePath = join(runDir, "region-redraw-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));

  const resultCapture = await captureState(
    client,
    targetId,
    "region-redraw-result-1280",
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
      agentNodeCount: 2,
      imageNodeCount: 2,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true,
      provenanceEdgeVisible: true
    }
  );

  await setWindowSize(client, targetId, workbenchMinWidth, 720);
  if (suite?.sourceId) {
    await evaluate(
      client,
      `(async () => {
        await window.__iiimageAIDebug.selectNode({ id: ${JSON.stringify(String(suite.sourceId))} });
        return window.__iiimageAIDebug.runTool(${JSON.stringify({
          name: "image_gen",
          selectedNodeId: String(suite.sourceId),
          input: {
            operation: "redraw",
            parentId: String(suite.sourceId),
            prompt: "884px 布局验证：把涂抹区域改成金色星芒徽章。"
          }
        })});
      })()`,
      30000
    );
    await waitForExpression(client, "Boolean(document.querySelector('.region-redraw-dialog') && window.__iiimageDebugAgentState?.().regionRedrawReady)", 12000);
  }
  const compactDialogCapture = await captureState(
    client,
    targetId,
    "region-redraw-dialog-min-884",
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
      compactMainGridOk: true,
      agentDebugReady: true,
      canvasVisible: true,
      agentPanelVisible: true
    }
  );
  await evaluate(client, `document.querySelector(".region-redraw-dialog .ui-surface-close")?.click()`);
  await waitForExpression(client, "!document.querySelector('.region-redraw-dialog')", 5000);
  return [
    { ...resultCapture, suite, suitePath },
    { ...compactDialogCapture, suite, suitePath, compactOf: "region-redraw-result-1280" }
  ];
}

  return {
    captureCutoutSuiteProbe,
    captureLayerStackSuiteProbe,
    captureRegionRedrawSuiteProbe
  };
}
