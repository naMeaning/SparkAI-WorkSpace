import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function createAidebugReporting({
  runDir,
  desktopLogPath,
  observations,
  mockAgent,
  cycleIndex,
  cycleTotal,
  fallbackPng,
  recordObservation,
  log = (value) => console.log(value),
  setExitCode = (code) => {
    process.exitCode = code;
  }
}) {
  function pngSize(path) {
    const buffer = readFileSync(path);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 1, height: 1 };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  function xmlEscape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function writeContactSheet(results) {
    const tileWidth = 560;
    const labelHeight = 28;
    const gap = 12;
    const columns = 2;
    const tiles = results.map((result) => {
      const size = pngSize(result.screenshotPath);
      const imageHeight = Math.max(1, Math.round(tileWidth * size.height / size.width));
      return {
        ...result,
        size,
        imageHeight,
        tileHeight: labelHeight + imageHeigh
      };
    });
    const rowHeights = [];
    for (let i = 0; i < tiles.length; i += columns) {
      rowHeights.push(Math.max(...tiles.slice(i, i + columns).map((tile) => tile.tileHeight)));
    }
    const width = columns * tileWidth + (columns + 1) * gap;
    const height = rowHeights.reduce((total, row) => total + row, gap) + (rowHeights.length + 1) * gap;
    let body = `<rect width="100%" height="100%" fill="#1e1e1e"/>`;
    let y = gap;
    for (let row = 0; row < rowHeights.length; row += 1) {
      const rowTiles = tiles.slice(row * columns, row * columns + columns);
      for (let column = 0; column < rowTiles.length; column += 1) {
        const tile = rowTiles[column];
        const x = gap + column * (tileWidth + gap);
        const imageBase64 = readFileSync(tile.screenshotPath).toString("base64");
        const label = `${tile.label} | overflow:${tile.overflow.elementOverflowX.length ? "yes" : "no"} | state:${tile.stateIssues.length ? "fail" : "ok"} | visual:${tile.visualReliability?.status || "unverified"}/${tile.visualPolicy || "overview"} | capture:${tile.captureIssues.length ? "fail" : "window"}`;
        body += `<rect x="${x}" y="${y}" width="${tileWidth}" height="${tile.tileHeight}" fill="#252526" stroke="#3c3c3c"/>`;
        body += `<text x="${x + 10}" y="${y + 19}" fill="#cccccc" font-family="Segoe UI, Arial" font-size="13">${xmlEscape(label)}</text>`;
        body += `<image x="${x}" y="${y + labelHeight}" width="${tileWidth}" height="${tile.imageHeight}" href="data:image/png;base64,${imageBase64}" preserveAspectRatio="xMinYMin meet"/>`;
      }
      y += rowHeights[row] + gap;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
    const sheetPath = join(runDir, "contact-sheet.svg");
    writeFileSync(sheetPath, svg);
    return sheetPath;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
  }

  function latestRuntimeProgress(progress) {
    const list = asArray(progress).filter((item) => item && typeof item === "object");
    if (!list.length) return [];
    const requestIndex = list.reduce((latest, item, index) => (item?.phase === "runtime-request" ? index : latest), -1);
    if (requestIndex < 0) return list;
    const runId = list[requestIndex]?.runId;
    const sliced = list.slice(requestIndex);
    return runId ? sliced.filter((item) => !item?.runId || item.runId === runId) : sliced;
  }

  function progressToolSet(progress) {
    const tools = new Set();
    for (const item of asArray(progress)) {
      const phase = String(item?.phase || "");
      const tool = String(item?.tool || "").trim();
      if (tool && (phase === "tool-start" || phase === "tool-done" || phase.startsWith("image-"))) {
        tools.add(tool);
      }
    }
    return tools;
  }

  function isAgentAutonomyStep(label, detail) {
    const text = String(label || "");
    if (!detail || typeof detail !== "object") return false;
    if (text.includes("direct-image-gen") || text.includes("create-probe-image")) return false;
    if (text.includes("agent-chat") || text.includes("agent-image-continue") || text.includes("agent-read-image")) return true;
    if (text.includes("-agent-") || text.startsWith("agent-")) return true;
    if (text.includes("compact-summary-image")) return true;
    return Boolean(detail.chat || detail.usedImageGen || detail.usedCommand || detail.usedWorkflowList || detail.usedContextManage);
  }

  function classifyAgentAutonomyStep(label, detail) {
    const progress = latestRuntimeProgress(detail?.state?.progress || detail?.chat?.state?.progress || detail?.progress);
    const forcedProgress = asArray(detail?.forcedProgress);
    const modelForceEvents = forcedProgress.length || progress.filter((item) => item?.phase === "model-force").length;
    const argCorrectionEvents = asArray(detail?.correctedProgress).length || progress.filter((item) => item?.phase === "model-arg-correct").length;
    const modelToolChoiceEvents = progress.filter((item) => item?.phase === "model-tool-choice").length;
    const imageToolChoiceEvents = progress.filter((item) => item?.phase === "model-tool-choice" && item?.tool === "image_gen").length;
    const tools = progressToolSet(progress);
    if (detail?.usedCommand) tools.add("shell_command");
    if (detail?.usedWorkflowList) tools.add("workflow");
    if (detail?.usedContextManage) tools.add("context_manage");
    if (detail?.usedImageGen) tools.add("image_gen");
    const usedTool = tools.size > 0;
    const usedImageGen = tools.has("image_gen") || Boolean(detail?.usedImageGen);
    const kind = modelForceEvents > 0
      ? "fallback"
      : modelToolChoiceEvents > 0
        ? "tool-choice"
        : usedTool
          ? "direct"
          : "unknown";
    return {
      label,
      kind,
      usedTool,
      usedImageGen,
      tools: Array.from(tools).sort(),
      modelForceEvents,
      argCorrectionEvents,
      modelToolChoiceEvents,
      imageToolChoiceEvents
    };
  }

  function collectAgentAutonomyStats(results) {
    const stats = {
      requests: 0,
      direct: 0,
      toolChoice: 0,
      fallback: 0,
      unknown: 0,
      imageRequests: 0,
      imageDirect: 0,
      imageToolChoice: 0,
      imageFallback: 0,
      modelForceEvents: 0,
      argCorrectionEvents: 0,
      modelToolChoiceEvents: 0,
      imageToolChoiceEvents: 0,
      selectedContinuation: "not-run",
      selectedDirectContinuation: "not-run",
      samples: []
    };
    const addRecord = (record) => {
      if (!record) return;
      stats.requests += 1;
      if (record.kind === "direct") stats.direct += 1;
      else if (record.kind === "tool-choice") stats.toolChoice += 1;
      else if (record.kind === "fallback") stats.fallback += 1;
      else stats.unknown += 1;
      if (record.usedImageGen) {
        stats.imageRequests += 1;
        if (record.kind === "direct") stats.imageDirect += 1;
        else if (record.kind === "tool-choice") stats.imageToolChoice += 1;
        else if (record.kind === "fallback") stats.imageFallback += 1;
      }
      stats.modelForceEvents += Number(record.modelForceEvents || 0);
      stats.argCorrectionEvents += Number(record.argCorrectionEvents || 0);
      stats.modelToolChoiceEvents += Number(record.modelToolChoiceEvents || 0);
      stats.imageToolChoiceEvents += Number(record.imageToolChoiceEvents || 0);
      if (stats.samples.length < 18) {
        const tools = record.tools?.length ? `:${record.tools.join("+")}` : "";
        stats.samples.push(`${record.label}=${record.kind}${tools}`);
      }
    };

    const seenSuiteKeys = new Set();
    for (const result of results) {
      const suite = result?.suite || {};
      const suiteSteps = asArray(suite.steps);
      const suiteKey = result?.suitePath || (suite.startedAt ? `${result?.label || "suite"}:${suite.startedAt}` : "");
      const shouldScanSuite = suiteSteps.length && (!suiteKey || !seenSuiteKeys.has(suiteKey));
      if (suiteKey && shouldScanSuite) seenSuiteKeys.add(suiteKey);
      if (shouldScanSuite) {
        for (const step of suiteSteps) {
          const detail = step?.detail;
          if (!isAgentAutonomyStep(step?.label, detail)) continue;
          addRecord(classifyAgentAutonomyStep(step.label, detail));
        }
      }
      if ((result?.label === "agent-selected-continuation-884" || result?.label === "agent-selected-direct-continuation-884") && suite) {
        const kind = suite.autonomyKind || (suite.autonomousImageGen ? "direct" : suite.routedImageGen ? "tool-choice" : suite.usedModelForce ? "fallback" : "unknown");
        if (result.label === "agent-selected-direct-continuation-884") stats.selectedDirectContinuation = kind;
        else stats.selectedContinuation = kind;
        addRecord({
          label: result.label,
          kind,
          usedTool: Boolean(suite.usedImageGen),
          usedImageGen: Boolean(suite.usedImageGen),
          tools: suite.usedImageGen ? ["image_gen"] : [],
          modelForceEvents: asArray(suite.forcedProgress).length,
          argCorrectionEvents: Number(suite.autonomyCounts?.argCorrections || asArray(suite.correctedProgress).length),
          modelToolChoiceEvents: Number(suite.autonomyCounts?.modelToolChoice || (suite.usedToolChoice ? 1 : 0)),
          imageToolChoiceEvents: Number(suite.autonomyCounts?.imageToolChoice || (suite.usedToolChoice ? 1 : 0))
        });
      }
    }
    stats.ok = stats.requests > 0 && stats.fallback === 0 && stats.unknown === 0;
    return stats;
  }

  function emptyOverflowReport() {
    return { documentOverflowX: false, bodyOverflowX: false, elementOverflowX: [] };
  }

  function captureAgentAutonomyHardGateFixture() {
    const label = "agent-autonomy-hard-gate-fixture";
    const screenshotPath = join(runDir, `${label}.png`);
    const jsonPath = join(runDir, `${label}.json`);
    const directSuite = {
      ok: false,
      directProbe: true,
      correctionFreeOk: false,
      usedImageGen: true,
      autonomousImageGen: true,
      routedImageGen: false,
      usedModelForce: false,
      usedToolChoice: false,
      autonomyKind: "direct",
      forcedProgress: [],
      correctedProgress: [{ tool: "image_gen", summary: "fixture corrected wrong parentId", input: { parentId: "wrong-node" } }],
      autonomyCounts: {
        direct: 1,
        toolChoice: 0,
        fallback: 0,
        unknown: 0,
        modelForce: 0,
        argCorrections: 1,
        modelToolChoice: 0,
        imageToolChoice: 0
      }
    };
    const stats = collectAgentAutonomyStats([{ label: "agent-selected-direct-continuation-884", suite: directSuite }]);
    const hardGateWouldFail = directSuite.directProbe && !directSuite.correctionFreeOk && directSuite.ok === false;
    const aggregateCountsCorrection = stats.argCorrectionEvents === 1;
    const aggregateWouldWarn = stats.argCorrectionEvents > 0;
    const ok = Boolean(hardGateWouldFail && aggregateCountsCorrection && aggregateWouldWarn);
    const state = {
      hardGateFixtureOk: ok,
      hardGateWouldFail,
      aggregateCountsCorrection,
      aggregateWouldWarn,
      argCorrectionEvents: stats.argCorrectionEvents,
      selectedDirectContinuation: stats.selectedDirectContinuation
    };
    const stateIssues = ok ? [] : Object.entries(state)
      .filter(([key, value]) => (key === "argCorrectionEvents" ? value !== 1 : value !== true && key !== "selectedDirectContinuation"))
      .map(([key, actual]) => ({ key, expected: key === "argCorrectionEvents" ? 1 : true, actual }));
    writeFileSync(screenshotPath, fallbackPng);
    writeFileSync(jsonPath, JSON.stringify({ label, state, suite: { ok, directSuite, stats }, stateIssues }, null, 2));
    if (stateIssues.length) recordObservation("issue", label, { stateIssues, stats });
    return {
      label,
      screenshotPath,
      jsonPath,
      imagePreviewPixelReport: { checked: false, ok: true },
      nativeCapture: { ok: true, source: "fixture" },
      state,
      stateIssues,
      overflow: emptyOverflowReport(),
      captureIssues: [],
      suite: { ok, directSuite, stats }
    };
  }

  function appendNonVisualSelfChecks(results) {
    if (!results.some((item) => item?.label === "agent-autonomy-hard-gate-fixture")) {
      results.push(captureAgentAutonomyHardGateFixture());
    }
  }

  function formatAgentAutonomyStats(stats) {
    if (!stats?.requests) return "requests=0, direct=0, toolChoice=0, fallback=0, unknown=0";
    return [
      `requests=${stats.requests}`,
      `direct=${stats.direct}`,
      `toolChoice=${stats.toolChoice}`,
      `fallback=${stats.fallback}`,
      `unknown=${stats.unknown}`,
      `image=${stats.imageRequests}`,
      `imageDirect=${stats.imageDirect}`,
      `imageToolChoice=${stats.imageToolChoice}`,
      `imageFallback=${stats.imageFallback}`,
      `modelForce=${stats.modelForceEvents}`,
      `argCorrections=${stats.argCorrectionEvents}`,
      `modelToolChoice=${stats.modelToolChoiceEvents}`,
      `imageToolChoiceEvents=${stats.imageToolChoiceEvents}`,
      `selected=${stats.selectedContinuation}`,
      `selectedDirect=${stats.selectedDirectContinuation}`
    ].join(", ");
  }

  function writeRunSummary(results, failures, contactSheetPath) {
    const issueObservations = observations.filter((item) => item.level === "issue");
    const runningUiSuites = results.filter((item) => item.label.startsWith("agent-running-ui"));
    const runningSupplementDraftSuites = results.filter((item) => item.label.startsWith("agent-running-supplement-draft"));
    const runningSupplementModelSuites = results.filter((item) => item.label.startsWith("agent-running-supplement-model-popover"));
    const runningReferenceSuites = results.filter((item) => item.label.startsWith("agent-running-reference-"));
    const stopUiSuites = results.filter((item) => item.label.startsWith("agent-stop-ui"));
    const stopResendSuites = results.filter((item) => item.label.startsWith("agent-stop-resend"));
    const busySupplementSuites = results.filter((item) => item.label.startsWith("agent-busy-supplement"));
    const toolSuite = results.find((item) => item.label.startsWith("agent-tool-suite")) || results.find((item) => item.label.startsWith("agent-clear-canvas"));
    const toolSuiteCompact = results.find((item) => item.label === "agent-tool-suite-540");
    const messageFixtureSuites = results.filter((item) => item.label.startsWith("agent-message-fixture-"));
    const agentUiPromptSuite = results.find((item) => item.label.startsWith("agent-ui-prompt-suite"));
    const realAgentSuite = results.find((item) => item.label.startsWith("agent-real-agent-suite"));
    const experienceImageSuite = results.find((item) => item.label.startsWith("agent-experience-image"));
    const imageSuite = results.find((item) => item.label.startsWith("agent-image-suite"));
    const posterBatchSuite = results.find((item) => item.label.startsWith("agent-poster-batch"));
    const mixedSuite = results.find((item) => item.label.startsWith("agent-mixed-stress"));
    const mixedCompactSuite = results.find((item) => item.label === "agent-mixed-stress-884");
    const mixedFocusSuites = results.filter((item) => item.label.startsWith("agent-mixed-focus-"));
    const selectedContinuationSuite = results.find((item) => item.label === "agent-selected-continuation-884");
    const selectedDirectContinuationSuite = results.find((item) => item.label === "agent-selected-direct-continuation-884");
    const longSessionBottomSuite = results.find((item) => item.label === "agent-long-session-bottom-884");
    const contextPersistenceSuite = results.find((item) => item.label.startsWith("agent-context-persistence"));
    const hardGateFixture = results.find((item) => item.label === "agent-autonomy-hard-gate-fixture");
    const contextPersistenceImageStep = contextPersistenceSuite?.suite?.steps?.find((item) => item.label === "context-persistence-agent-image-after-read");
    const contextPersistenceMemoryImage =
      contextPersistenceImageStep
        ? contextPersistenceImageStep.ok && contextPersistenceImageStep.detail?.promptIncludesSentinel
          ? "ok"
          : "fail"
        : "not-run";
    const agentAutonomyStats = collectAgentAutonomyStats(results);
    const agentAutonomySummary = formatAgentAutonomyStats(agentAutonomyStats);
    const agentAutonomyObservation = agentAutonomyStats.requests
      ? {
          level: agentAutonomyStats.fallback > 0 || agentAutonomyStats.unknown > 0 || agentAutonomyStats.argCorrectionEvents > 0 ? "warning" : "info",
          area: "agent-autonomy",
          message: `Agent autonomy aggregate: ${agentAutonomySummary}`
        }
      : null;
    const previewCropStatus = (item) =>
      item?.imagePreviewPixelReport?.checked
        ? item.imagePreviewPixelReport.geometryOk === false
          ? "fail"
          : "ok"
        : "not-run";
    const compactSummaryStatus = (suite) =>
      suite?.compactSummaryRequired === false
        ? "skip"
        : suite?.compactSummaryImageOk
          ? "ok"
          : "fail";
    const previewGeometryStats = (item) => {
      const report = item?.imagePreviewPixelReport || {};
      if (!report.checked) return "minSrc=not-run, maxAspect=not-run";
      const samples = Array.isArray(report.samples) ? report.samples : [];
      if (!samples.length) return "minSrc=none, maxAspect=none";
      const sourceRatios = samples.map((sample) => Number(sample.sourceVisibleRatio)).filter(Number.isFinite);
      const aspectDeltas = samples.map((sample) => Number(sample.aspectDelta)).filter(Number.isFinite);
      const minSource = sourceRatios.length ? Math.min(...sourceRatios) : 0;
      const maxAspect = aspectDeltas.length ? Math.max(...aspectDeltas) : 0;
      return `minSrc=${Math.round(minSource * 1000) / 1000}, maxAspect=${Math.round(maxAspect * 1000) / 1000}`;
    };
    const previewDetailStats = (item) => {
      const thresholds = item?.state?.imagePreviewDetailThresholds || {};
      return `detail=${item?.state?.imagePreviewDetailOk ? "ok" : "fail"}, previewArea=${item?.state?.imagePreviewAreaMin ?? "unknown"}/${thresholds.minArea ?? "unknown"}`;
    };
    const titleAccessStats = (item) =>
      `titleAccess=${item?.state?.nodeTitleTextClippingAccessibleOk ? "ok" : "fail"}, visibleTitleClip=${item?.state?.visibleNodeTitleTextClippedCount ?? "unknown"}`;
    const formatMessageFixtureSuite = (item) => {
      const report = item?.messageFixturePixelReport || {};
      const requiredKinds = Array.isArray(report.requiredKinds) && report.requiredKinds.length ? report.requiredKinds.join("|") : "none";
      const visibleKinds = Array.isArray(report.visibleKinds) && report.visibleKinds.length ? report.visibleKinds.join("|") : "none";
      const missingKinds = Array.isArray(report.missingKinds) && report.missingKinds.length ? report.missingKinds.join("|") : "none";
      const bottomStatus = requiredKinds === "tool-trace" ? "not-required" : item.state?.agentTimelineBottomOk ? "ok" : "fail";
      return `- ${item.label}: messageLayout=${item.state?.agentMessageLayoutOk ? "ok" : "fail"}, trace=${item.state?.agentToolTracePresent && item.state?.agentToolTraceLayoutOk ? "ok" : "fail"}, traceCount=${item.state?.agentToolTraceCount ?? "unknown"}, code=${item.state?.markdownCodeBlockPresent && item.state?.markdownCodeBlockLayoutOk ? "ok" : "fail"}, codeCount=${item.state?.markdownCodeBlockCount ?? "unknown"}, codeHead=${item.state?.markdownCodeHeaderPolishOk ? "ok" : "fail"}, paste=${item.state?.agentPasteBlockPresent && item.state?.agentPasteBlockLayoutOk ? "ok" : "fail"}, pasteCount=${item.state?.agentPasteBlockCount ?? "unknown"}, pixel=${report.checked ? report.ok ? "ok" : "fail" : "not-run"}, required=${requiredKinds}, visible=${visibleKinds}, missing=${missingKinds}, bottom=${bottomStatus}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`;
    };
    const agentIssues = [
      ...(Array.isArray(toolSuite?.suite?.issues) ? toolSuite.suite.issues : []),
      ...(Array.isArray(realAgentSuite?.suite?.issues) ? realAgentSuite.suite.issues : []),
      ...(Array.isArray(experienceImageSuite?.suite?.issues) ? experienceImageSuite.suite.issues : []),
      ...(Array.isArray(imageSuite?.suite?.issues) ? imageSuite.suite.issues : []),
      ...(Array.isArray(posterBatchSuite?.suite?.issues) ? posterBatchSuite.suite.issues : []),
      ...(Array.isArray(mixedSuite?.suite?.issues) ? mixedSuite.suite.issues : []),
      ...(Array.isArray(contextPersistenceSuite?.suite?.issues) ? contextPersistenceSuite.suite.issues : []),
      ...(agentAutonomyObservation ? [agentAutonomyObservation] : [])
    ];
    const lines = [
      "# IIimage AIDebug Run",
      "",
      `- ok: ${failures.length === 0}`,
      `- agentMode: ${mockAgent ? "mock-agent" : "real-agent"}`,
      `- modelForce: ${mockAgent ? "enabled-for-fixture" : "disabled"}`,
      `- scenes: ${results.length}`,
      `- failures: ${failures.length}`,
      `- observations: ${observations.length}`,
      `- cycle: ${cycleIndex}/${cycleTotal}`,
      `- contactSheet: ${contactSheetPath}`,
      "",
      "## Agent Running UI",
      "",
      ...(runningUiSuites.length
        ? runningUiSuites.map((item) => `- ${item.label}: running=${item.state?.agentRunningUiOk ? "ok" : "fail"}, status=${item.state?.agentRunningStatusOk ? "ok" : "fail"}, stop=${item.state?.stopButtonOk ? "ok" : "fail"}, dot=${item.state?.runningTimelineDotOk ? "ok" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, stopMs=${item.state?.motionMetrics?.stop?.transitionMs ?? "unknown"}, dotAnim=${item.state?.motionMetrics?.runningDot?.animationName || "none"}, placeholder=${item.state?.composerBusyPlaceholderOk ? "ok" : "fail"}, controls=${item.state?.composerControlsVisibleOk ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, topbar=${item.state?.topbarControlsDockedOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : ["- agent running UI scene missing"]),
      ...(runningSupplementDraftSuites.length
        ? runningSupplementDraftSuites.map((item) => `- ${item.label}: draft=${item.state?.agentRunningSupplementDraftOk ? "ok" : "fail"}, send=${item.state?.supplementButtonVisibleOk ? "visible" : "missing"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, supplementAnim=${item.state?.motionMetrics?.supplement?.animationName || "none"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, gap=${item.state?.supplementButtonGap ?? "unknown"}, prompt=${item.state?.supplementDraftPromptPresent ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      ...(runningSupplementModelSuites.length
        ? runningSupplementModelSuites.map((item) => `- ${item.label}: popover=${item.state?.busySupplementModelPopoverOk ? "ok" : "fail"}, docked=${item.state?.composerPopoverDocked ? "ok" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, popoverAnim=${item.state?.motionMetrics?.popover?.animationName || "none"}, avoidsActions=${item.state?.composerPopoverAvoidsActions ? "ok" : "fail"}, stopOverlap=${item.state?.popoverStopOverlapArea ?? "unknown"}, supplementOverlap=${item.state?.popoverSupplementOverlapArea ?? "unknown"}, send=${item.state?.supplementButtonVisibleOk ? "visible" : "missing"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, prompt=${item.state?.busyModelPromptPresent ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      ...(runningReferenceSuites.length
        ? runningReferenceSuites.map((item) => `- ${item.label}: strip=${item.state?.agentRunningReferenceStripOk ? "ok" : "fail"}, count=${item.state?.referenceImageCount ?? "unknown"}, add=${item.state?.referenceAddButtonDisabledOk ? "disabled" : item.state?.referenceAddButtonEnabledOk ? "enabled" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, removeMs=${item.state?.motionMetrics?.referenceRemove?.transitionMs ?? "unknown"}, thumbs=${item.state?.referenceThumbsVisibleOk ? "ok" : "fail"}, visual=${item.state?.referenceThumbVisualOk ? "ok" : "fail"}, polish=${item.state?.referenceThumbPolishOk ? "ok" : "fail"}, remove=${item.state?.referenceRemoveButtonsOk ? "ok" : "fail"}, toolbarOverlap=${item.state?.referenceStripToolbarOverlapArea ?? "unknown"}, sendOverlap=${item.state?.referenceStripSendOverlapArea ?? "unknown"}, supplementOverlap=${item.state?.referenceStripSupplementOverlapArea ?? "unknown"}, toolbarGap=${item.state?.referenceStripToolbarGap ?? "unknown"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      ...(stopUiSuites.length
        ? stopUiSuites.map((item) => `- ${item.label}: stopped=${item.state?.agentStopUiOk ? "ok" : "fail"}, status=${item.state?.agentStoppedStatusOk ? "ok" : "fail"}, send=${item.state?.sendButtonIdleOk ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, interrupt=${item.state?.agentInterruptMessageVisible ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      ...(stopResendSuites.length
        ? stopResendSuites.map((item) => `- ${item.label}: resend=${item.state?.agentStopResendOk ? "ok" : "fail"}, afterInterrupt=${item.state?.stopResendAfterInterruptOk ? "ok" : "fail"}, assistant=${item.state?.stopResendAssistantOk ? "ok" : "fail"}, workflow=${item.state?.stopResendWorkflowToolOk ? "ok" : "fail"}, imageGen=${item.state?.stopResendImageGenUsed ? "used" : "none"}, promptCleared=${item.state?.stopResendPromptCleared ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, interruptCount=${item.state?.interruptMessageCount ?? "unknown"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      ...(busySupplementSuites.length
        ? busySupplementSuites.map((item) => `- ${item.label}: supplement=${item.state?.agentBusySupplementOk ? "ok" : "fail"}, click=${item.state?.busySupplementClickPathOk ? "button" : "fail"}, meta=${item.state?.busySupplementUserMetaOk ? "interrupt" : "fail"}, assistant=${item.state?.busySupplementAssistantOk ? "ok" : "fail"}, runtime=${item.state?.busySupplementRuntimeRequestOk ? "ok" : "fail"}, workflow=${item.state?.busySupplementWorkflowToolOk ? "ok" : "fail"}, imageGen=${item.state?.busySupplementImageGenUsed ? "used" : "none"}, latestProgress=${item.state?.busySupplementLatestProgressOk ? "new-run" : "stale"}, promptCleared=${item.state?.busySupplementPromptCleared ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, runId=${item.state?.busySupplementRunId || "unknown"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      "",
      "## Agent Tool Suite",
      "",
      toolSuite?.suite
        ? `- ${toolSuite.label}: ok=${toolSuite.suite.ok}, steps=${toolSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : toolSuite
          ? `- ${toolSuite.label}: nodeCount=${toolSuite.state?.agentNodeCount}, workflowClear=${toolSuite.state?.agentWorkflowClearTool}, done=${toolSuite.state?.agentClearCanvasDone}`
          : "- agent tool suite scene missing",
      toolSuiteCompac
        ? `- ${toolSuiteCompact.label}: messageLayout=${toolSuiteCompact.state?.agentMessageLayoutOk ? "ok" : "fail"}, trace=${toolSuiteCompact.state?.agentToolTraceLayoutOk ? "ok" : "fail"}, traceNoBar=${toolSuiteCompact.state?.agentToolTraceNoLeftRuleOk && toolSuiteCompact.state?.agentToolTraceNoPseudoLeftRuleOk ? "ok" : "fail"}, traceCopy=${toolSuiteCompact.state?.agentToolTraceTitleBriefOk ? "ok" : "fail"}, timelineLine=${toolSuiteCompact.state?.agentTimelineLeftLineOk ? "ok" : "fail"}, imageGenText=${toolSuiteCompact.state?.agentImageGenStillRunningTextAbsent ? "ok" : "fail"}, imageGenTimer=${toolSuiteCompact.state?.agentImageGenTimerOk ? "ok" : "fail"}, traceCount=${toolSuiteCompact.state?.agentToolTraceCount ?? "unknown"}, code=${toolSuiteCompact.state?.markdownCodeBlockLayoutOk ? "ok" : "fail"}, codeCount=${toolSuiteCompact.state?.markdownCodeBlockCount ?? "unknown"}, bottom=${toolSuiteCompact.state?.agentTimelineBottomOk ? "ok" : "fail"}, stateIssues=${toolSuiteCompact.stateIssues.length}, overflow=${toolSuiteCompact.overflow.elementOverflowX.length}, captureIssues=${toolSuiteCompact.captureIssues.length}`
        : null,
      ...(messageFixtureSuites.length
        ? messageFixtureSuites.map(formatMessageFixtureSuite)
        : ["- agent message fixture scenes missing"]),
      "",
      "## Real UI Prompt Suite",
      "",
      agentUiPromptSuite?.suite
        ? `- ${agentUiPromptSuite.label}: ok=${agentUiPromptSuite.suite.ok}, autonomous=${agentUiPromptSuite.suite.autonomous ? "yes" : "no"}, usedImageGen=${agentUiPromptSuite.suite.usedImageGen ? "yes" : "no"}, toolStartImage=${agentUiPromptSuite.suite.toolStartImage ? "yes" : "no"}, modal=${agentUiPromptSuite.suite.imageTaskModalOpen ? "open" : "closed"}, newImages=${agentUiPromptSuite.suite.newImageNodes?.map((node) => node.id).join("|") || "none"}, force=${agentUiPromptSuite.suite.modelForce?.length || 0}, toolChoice=${agentUiPromptSuite.suite.modelToolChoice?.length || 0}, argCorrect=${agentUiPromptSuite.suite.modelArgCorrect?.length || 0}, contractWarn=${agentUiPromptSuite.suite.modelContractWarning?.length || 0}, responses=${agentUiPromptSuite.suite.modelResponseDetails?.map((item) => `toolCalls=${item?.toolCallCount ?? "unknown"}`).join("|") || "none"}, steps=${agentUiPromptSuite.suite.steps?.map((step) => `${step.label}:${step.ok ? "ok" : "fail"}${step.label === "feedback-continue-3" ? `/count=${step.countOk ? "ok" : "fail"}/parent=${step.parentOk ? "ok" : "fail"}/relation=${step.relationOk ? "ok" : "fail"}/prompt=${step.promptInheritedOk ? "ok" : "fail"}/assets=${step.imageCountOk ? "ok" : "fail"}` : ""}`).join(", ") || "none"}`
        : "- real UI prompt suite scene missing",
      "",
      "## Real Agent Suite",
      "",
      realAgentSuite?.suite
        ? `- ${realAgentSuite.label}: ok=${realAgentSuite.suite.ok}, liveImage=${realAgentSuite.suite.liveImageMode ? "true" : "false"}, created=${realAgentSuite.suite.createdImageId || "none"}, steps=${realAgentSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- real agent suite scene missing",
      "",
      "## Agent Experience Image",
      "",
      experienceImageSuite?.suite
        ? `- ${experienceImageSuite.label}: ok=${experienceImageSuite.suite.ok}, recorded=${experienceImageSuite.suite.experienceRecorded ? "yes" : "no"}, read=${experienceImageSuite.suite.experienceRead ? "yes" : "no"}, sentinel=${experienceImageSuite.suite.agentExperienceSentinel ? "present" : "none"}, imageId=${experienceImageSuite.suite.imageId || "none"}, steps=${experienceImageSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- agent experience image scene missing",
      "",
      "## Agent Image Suite",
      "",
      imageSuite?.suite
        ? `- ${imageSuite.label}: ok=${imageSuite.suite.ok}, runs=${imageSuite.suite.runs}, maxFooterGap=${imageSuite.state?.nodeFooterGapMax}, readability=${imageSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${imageSuite.state?.imagePreviewVisibleCountOk && imageSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${imageSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(imageSuite)}, ${previewGeometryStats(imageSuite)}, ${previewDetailStats(imageSuite)}, visiblePreviews=${imageSuite.state?.visibleImagePreviewCount ?? "unknown"}, overlap=${imageSuite.state?.nodeOverlapPairCount ?? "unknown"}, titleMin=${imageSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(imageSuite)}, composerOverlap=${imageSuite.state?.composerNodeOverlapCount ?? "unknown"}, steps=${imageSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- agent image suite scene missing",
      "",
      "## Agent Poster Batch",
      "",
      posterBatchSuite?.suite
        ? `- ${posterBatchSuite.label}: ok=${posterBatchSuite.suite.ok}, generated=${posterBatchSuite.suite.generatedCount}/${posterBatchSuite.suite.totalRequested}, agent=${posterBatchSuite.suite.agentGenerated}/${posterBatchSuite.suite.agentRequested}, direct=${posterBatchSuite.suite.directGenerated}/${posterBatchSuite.suite.directRequested}, resolution=${posterBatchSuite.suite.resolution || "unknown"}, maxFooterGap=${posterBatchSuite.state?.nodeFooterGapMax}, readability=${posterBatchSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${posterBatchSuite.state?.imagePreviewVisibleCountOk && posterBatchSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${posterBatchSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(posterBatchSuite)}, ${previewGeometryStats(posterBatchSuite)}, ${previewDetailStats(posterBatchSuite)}, visiblePreviews=${posterBatchSuite.state?.visibleImagePreviewCount ?? "unknown"}, overlap=${posterBatchSuite.state?.nodeOverlapPairCount ?? "unknown"}, titleMin=${posterBatchSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(posterBatchSuite)}, composerOverlap=${posterBatchSuite.state?.composerNodeOverlapCount ?? "unknown"}, steps=${posterBatchSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- agent poster batch scene missing",
      "",
      "## Agent Mixed Stress",
      "",
      mixedSuite?.suite
        ? `- ${mixedSuite.label}: ok=${mixedSuite.suite.ok}, rounds=${mixedSuite.suite.rounds}, imageNodes=${mixedSuite.suite.imageNodeIds?.length || 0}/${mixedSuite.suite.expectedImageNodes || 0}, imageChains=${mixedSuite.suite.imageChains?.filter((item) => item.parentOk).length || 0}/${mixedSuite.suite.rounds || 0}, compactDone=${mixedSuite.suite.compactDoneCount || 0}, compactImage=${mixedSuite.suite.compactImageContinuations || 0}, compactAny=${mixedSuite.suite.compactSuccessfulContinuations || 0}, compactSummary=${compactSummaryStatus(mixedSuite.suite)}, experienceRounds=${mixedSuite.suite.experienceSentinels?.length || 0}, steps=${mixedSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- agent mixed stress scene missing",
      mixedSuite?.suite && mixedCompactSuite
        ? `- ${mixedCompactSuite.label}: supportedMinimum=${mixedCompactSuite.stateIssues.length || mixedCompactSuite.overflow.elementOverflowX.length || mixedCompactSuite.captureIssues.length ? "fail" : "ok"}, imageViewport=${mixedCompactSuite.state?.imageNodeViewportOk ? "ok" : "fail"}, readability=${mixedCompactSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${mixedCompactSuite.state?.imagePreviewVisibleCountOk && mixedCompactSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${mixedCompactSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(mixedCompactSuite)}, ${previewGeometryStats(mixedCompactSuite)}, ${previewDetailStats(mixedCompactSuite)}, density=${mixedCompactSuite.state?.compactCanvasDensityOk ? "ok" : "fail"}, spacing=${mixedCompactSuite.state?.selectedNodeSpacingOk ? "ok" : "fail"}, viewport=${mixedCompactSuite.state?.compactViewportFitOk ? "ok" : "fail"}, topbar=${mixedCompactSuite.state?.topbarControlsDockedOk ? "ok" : "fail"}, composerViewport=${mixedCompactSuite.state?.composerViewportVisibleOk ? "ok" : "fail"}, imageNodes=${mixedCompactSuite.state?.imageNodeCount ?? "unknown"}, visibleNodes=${mixedCompactSuite.state?.visibleFlowNodeCount ?? "unknown"}, visiblePreviews=${mixedCompactSuite.state?.visibleImagePreviewCount ?? "unknown"}, zoom=${mixedCompactSuite.state?.canvasZoomPercent ?? "unknown"}%, selectedGap=${mixedCompactSuite.state?.selectedNodeNearestGap ?? "unknown"}, selectedVisibleGap=${mixedCompactSuite.state?.selectedNodeNearestVisibleGap ?? "unknown"}, footerGap=${mixedCompactSuite.state?.nodeFooterGapMax ?? "unknown"}, overlap=${mixedCompactSuite.state?.nodeOverlapPairCount ?? "unknown"}, maxOverlapRatio=${mixedCompactSuite.state?.nodeOverlapRatioMax ?? "unknown"}, titleMin=${mixedCompactSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(mixedCompactSuite)}, composerOverlap=${mixedCompactSuite.state?.composerNodeOverlapCount ?? "unknown"}, stateIssues=${mixedCompactSuite.stateIssues.length}, overflow=${mixedCompactSuite.overflow.elementOverflowX.length}, captureIssues=${mixedCompactSuite.captureIssues.length}`
        : null,
      ...(mixedFocusSuites.length
        ? mixedFocusSuites.map((item) => `- ${item.label}: target=${item.focusTargetId || "unknown"}, selected=${item.state?.selectedNodeId || "unknown"}, focus=${item.state?.selectedImageFocusOk ? "ok" : "fail"}, selectedViewport=${item.state?.selectedImageNodeViewportOk ? "ok" : "fail"}, latestViewport=${item.state?.imageNodeViewportOk ? "ok" : "fail"}, title=${item.state?.selectedNodeTitleVisibleOk ? "ok" : "fail"}, ${titleAccessStats(item)}, spacing=${item.state?.selectedNodeSpacingOk ? "ok" : "fail"}, zoom=${item.state?.canvasZoomPercent ?? "unknown"}%, zoomUsable=${item.state?.canvasZoomUsableOk ? "ok" : "fail"}, visibleImages=${item.state?.visibleImageNodeCount ?? "unknown"}, visiblePreviews=${item.state?.visibleImagePreviewCount ?? "unknown"}, preview=${item.state?.imagePreviewVisibleCountOk && item.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${item.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(item)}, ${previewGeometryStats(item)}, ${previewDetailStats(item)}, composerOverlap=${item.state?.selectedNodeComposerOverlapArea ?? "unknown"}, readability=${item.state?.canvasReadabilityOk ? "ok" : "fail"}, density=${item.state?.compactCanvasDensityOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
        : []),
      selectedContinuationSuite
        ? `- ${selectedContinuationSuite.label}: ok=${selectedContinuationSuite.suite?.ok ? "true" : "false"}, sequence=${selectedContinuationSuite.suite?.sequence?.join(">") || "none"}, target=${selectedContinuationSuite.suite?.targetId || "unknown"}, selectedBefore=${selectedContinuationSuite.suite?.selectedBeforeChat || "unknown"}, created=${selectedContinuationSuite.suite?.createdId || "none"}, parent=${selectedContinuationSuite.suite?.createdParentId || "none"}, imageGen=${selectedContinuationSuite.suite?.usedImageGen ? "used" : "missing"}, autonomy=${selectedContinuationSuite.suite?.autonomousImageGen ? "direct" : selectedContinuationSuite.suite?.routedImageGen ? "tool-choice" : selectedContinuationSuite.suite?.usedModelForce ? "fallback" : "unknown"}, force=${selectedContinuationSuite.suite?.forcedProgress?.length || 0}, correct=${selectedContinuationSuite.suite?.correctedProgress?.length || 0}, clear=${selectedContinuationSuite.suite?.unexpectedClear ? "bad" : "none"}, focus=${selectedContinuationSuite.state?.selectedImageFocusOk ? "ok" : "fail"}, selected=${selectedContinuationSuite.state?.selectedNodeId || "unknown"}, preview=${selectedContinuationSuite.state?.imagePreviewVisibleCountOk && selectedContinuationSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${selectedContinuationSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(selectedContinuationSuite)}, ${previewGeometryStats(selectedContinuationSuite)}, ${previewDetailStats(selectedContinuationSuite)}, ${titleAccessStats(selectedContinuationSuite)}, stateIssues=${selectedContinuationSuite.stateIssues.length}, overflow=${selectedContinuationSuite.overflow.elementOverflowX.length}, captureIssues=${selectedContinuationSuite.captureIssues.length}`
        : null,
      selectedDirectContinuationSuite
        ? `- ${selectedDirectContinuationSuite.label}: ok=${selectedDirectContinuationSuite.suite?.ok ? "true" : "false"}, sequence=${selectedDirectContinuationSuite.suite?.sequence?.join(">") || "none"}, target=${selectedDirectContinuationSuite.suite?.targetId || "unknown"}, selectedBefore=${selectedDirectContinuationSuite.suite?.selectedBeforeChat || "unknown"}, created=${selectedDirectContinuationSuite.suite?.createdId || "none"}, parent=${selectedDirectContinuationSuite.suite?.createdParentId || "none"}, imageGen=${selectedDirectContinuationSuite.suite?.usedImageGen ? "used" : "missing"}, autonomy=${selectedDirectContinuationSuite.suite?.autonomousImageGen ? "direct" : selectedDirectContinuationSuite.suite?.routedImageGen ? "tool-choice" : selectedDirectContinuationSuite.suite?.usedModelForce ? "fallback" : "unknown"}, force=${selectedDirectContinuationSuite.suite?.forcedProgress?.length || 0}, correct=${selectedDirectContinuationSuite.suite?.correctedProgress?.length || 0}, clear=${selectedDirectContinuationSuite.suite?.unexpectedClear ? "bad" : "none"}, focus=${selectedDirectContinuationSuite.state?.selectedImageFocusOk ? "ok" : "fail"}, selected=${selectedDirectContinuationSuite.state?.selectedNodeId || "unknown"}, preview=${selectedDirectContinuationSuite.state?.imagePreviewVisibleCountOk && selectedDirectContinuationSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${selectedDirectContinuationSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(selectedDirectContinuationSuite)}, ${previewGeometryStats(selectedDirectContinuationSuite)}, ${previewDetailStats(selectedDirectContinuationSuite)}, ${titleAccessStats(selectedDirectContinuationSuite)}, stateIssues=${selectedDirectContinuationSuite.stateIssues.length}, overflow=${selectedDirectContinuationSuite.overflow.elementOverflowX.length}, captureIssues=${selectedDirectContinuationSuite.captureIssues.length}`
        : null,
      mixedSuite?.suite && longSessionBottomSuite
        ? `- ${longSessionBottomSuite.label}: bottom=${longSessionBottomSuite.state?.agentTimelineBottomOk ? "ok" : "fail"}, feedBottom=${longSessionBottomSuite.state?.agentFeedScrolledToBottom ? "ok" : "fail"}, lastMessage=${longSessionBottomSuite.state?.lastAgentMessageBottomVisible ? "ok" : "fail"}, composerControls=${longSessionBottomSuite.state?.composerControlsVisibleOk ? "ok" : "fail"}, composerViewport=${longSessionBottomSuite.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${longSessionBottomSuite.state?.compactViewportFitOk ? "ok" : "fail"}, topbar=${longSessionBottomSuite.state?.topbarControlsDockedOk ? "ok" : "fail"}, density=${longSessionBottomSuite.state?.compactCanvasDensityOk ? "ok" : "fail"}, spacing=${longSessionBottomSuite.state?.selectedNodeSpacingOk ? "ok" : "fail"}, preview=${longSessionBottomSuite.state?.imagePreviewVisibleCountOk && longSessionBottomSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${longSessionBottomSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(longSessionBottomSuite)}, ${previewGeometryStats(longSessionBottomSuite)}, ${previewDetailStats(longSessionBottomSuite)}, ${titleAccessStats(longSessionBottomSuite)}, zoom=${longSessionBottomSuite.state?.canvasZoomPercent ?? "unknown"}%, visibleNodes=${longSessionBottomSuite.state?.visibleFlowNodeCount ?? "unknown"}, visiblePreviews=${longSessionBottomSuite.state?.visibleImagePreviewCount ?? "unknown"}, selectedGap=${longSessionBottomSuite.state?.selectedNodeNearestGap ?? "unknown"}, composerGap=${longSessionBottomSuite.state?.agentComposerBottomGap ?? "unknown"}, overlapLast=${longSessionBottomSuite.state?.composerLastMessageOverlapArea ?? "unknown"}, stateIssues=${longSessionBottomSuite.stateIssues.length}, overflow=${longSessionBottomSuite.overflow.elementOverflowX.length}, captureIssues=${longSessionBottomSuite.captureIssues.length}`
        : null,
      "",
      "## Agent Context Persistence",
      "",
      contextPersistenceSuite?.suite
        ? `- ${contextPersistenceSuite.label}: ok=${contextPersistenceSuite.suite.ok}, stage=${contextPersistenceSuite.suite.stage}, scope=${contextPersistenceSuite.suite.scope ? `${contextPersistenceSuite.suite.scope.projectId}/${contextPersistenceSuite.suite.scope.conversationId}` : "none"}, publicMetadataHidden=${contextPersistenceSuite.suite.publicMetadataHidden ? "yes" : "no"}, memoryImage=${contextPersistenceMemoryImage}, steps=${contextPersistenceSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
        : "- agent context persistence scene missing",
      "",
      "## Agent Autonomy",
      "",
      `- aggregate: ${agentAutonomySummary}`,
      agentAutonomyStats.samples.length
        ? `- samples: ${agentAutonomyStats.samples.join("; ")}`
        : "- samples: none",
      hardGateFixture
        ? `- hardGateFixture(synthetic): ${hardGateFixture.suite?.ok ? "ok" : "fail"}, syntheticCorrectionCount=${hardGateFixture.state?.argCorrectionEvents ?? "unknown"}, reporterWouldFail=${hardGateFixture.state?.hardGateWouldFail ? "yes" : "no"}, reporterWouldWarn=${hardGateFixture.state?.aggregateWouldWarn ? "yes" : "no"}`
        : "- hardGateFixture: not-run",
      "",
      "## Agent Tool Observations",
      "",
      ...(agentIssues.length
        ? agentIssues.map((item) => `- ${item.level || "info"} ${item.area || "agent"}: ${item.message || JSON.stringify(item)}`)
        : ["- none"]),
      "",
      "## Issues",
      "",
      ...(issueObservations.length
        ? issueObservations.map((item) => `- [${item.at}] ${item.label}: ${JSON.stringify(item.detail)}`)
        : ["- none"]),
      "",
      "## Next Cycle Plan",
      "",
      ...(failures.length || issueObservations.length
        ? [
            "- Re-run the same AIDebug mode after fixing the failed scene checks.",
            "- Prioritize Agent tool-call failures before visual polish if both appear.",
            "- If image generation passes but node layout fails, inspect `.flow-node.image` sizing, footer spacing, title visibility, and node overlap metrics."
          ]
        : agentIssues.some((item) => item.level === "warning")
          ? [
              "- Reduce Agent autonomy warnings, especially model-force fallback during explicit tool and image-generation requests.",
              "- Re-run mixed stress with --stress-rounds=2 after fallback warnings are reduced.",
              "- Keep one real image-suite run after any Agent prompt/runtime change."
            ]
        : [
            "- Increase --stress-rounds, --cycles, or --image-runs to expose long-session Agent tool drift.",
            "- Run mixed stress in 540px compact mode after long image chains to keep narrow UI regressions visible.",
            "- Keep one real image-suite run after any Agent prompt/runtime change."
          ]),
      "",
      "## Scene Results",
      "",
      ...results.map((item) => `- ${item.label}: stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}, visual=${item.visualReliability?.status || "unverified"}, policy=${item.visualPolicy || "overview"}, selectedPreview=${item.visualPolicy === "focus" ? item.state?.selectedImagePreviewDetailOk ? "ok" : "fail" : "n/a"}, frame=${item.screenshotFrameReport?.ok ? "ok" : "fail"}, surfaces=${item.screenshotSurfaceReport?.ok ? "ok" : "fail"}, stateLayers=${item.state?.stateLayerConsistencyOk ? "ok" : "fail"}`)
    ];
    const summaryPath = join(runDir, "summary.md");
    writeFileSync(summaryPath, `${lines.filter((line) => line != null).join("\n")}\n`);
    appendDesktopLog(summaryPath, failures, contactSheetPath);
    return summaryPath;
  }

  function appendDesktopLog(summaryPath, failures, contactSheetPath) {
    try {
      mkdirSync(dirname(desktopLogPath), { recursive: true });
      const firstWrite = !existsSync(desktopLogPath);
      const summary = readFileSync(summaryPath, "utf8");
      const header = firstWrite
        ? [
            "# IIimage AIDebug 持续测试记录",
            "",
            "本文件由 `scripts/aidebug-gui.mjs` 追加写入，用于睡眠/长任务期间保留每轮观察、问题和下一轮计划。",
            ""
          ].join("\n")
        : "";
      const block = [
        header,
        `\n---\n\n## Run ${new Date().toLocaleString("zh-CN")} · cycle ${cycleIndex}/${cycleTotal}`,
        "",
        `- ok: ${failures.length === 0}`,
        `- runDir: ${runDir}`,
        `- contactSheet: ${contactSheetPath}`,
        "",
        summary.replace(/^# IIimage AIDebug Run\s*/u, "").trim(),
        ""
      ].filter(Boolean).join("\n");
      writeFileSync(desktopLogPath, `${block}\n`, { flag: "a" });
    } catch (error) {
      recordObservation("issue", "desktop-log-write-failed", { path: desktopLogPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function appendSupervisorDesktopLog(label, ok, detail = {}) {
    try {
      mkdirSync(dirname(desktopLogPath), { recursive: true });
      const firstWrite = !existsSync(desktopLogPath);
      const header = firstWrite
        ? [
            "# IIimage AIDebug 持续测试记录",
            "",
            "本文件由 `scripts/aidebug-gui.mjs` 追加写入，用于睡眠/长任务期间保留每轮观察、问题和下一轮计划。",
            ""
          ].join("\n")
        : "";
      const lines = [
        header,
        `\n---\n\n## Supervisor ${new Date().toLocaleString("zh-CN")} · ${label}`,
        "",
        `- ok: ${ok}`,
        ...Object.entries(detail).map(([key, value]) => `- ${key}: ${value}`),
        ""
      ].filter(Boolean);
      writeFileSync(desktopLogPath, `${lines.join("\n")}\n`, { flag: "a" });
    } catch (error) {
      recordObservation("issue", "desktop-log-write-failed", { path: desktopLogPath, error: error instanceof Error ? error.message : String(error), label });
    }
  }

  function suiteResultFailed(item) {
    return Boolean(
      item.overflow.documentOverflowX ||
      item.overflow.bodyOverflowX ||
      item.overflow.elementOverflowX.length ||
      item.stateIssues.length ||
      item.captureIssues.length ||
      item.suite?.ok === false
    );
  }

  function finishSuiteRun({
    results,
    reportMetadata = {},
    consoleMetadata = reportMetadata,
    reportAfterObservations = {},
    consoleAfterSummary = {},
    includeReportPathInReport = true
  }) {
    const failures = results.filter(suiteResultFailed);
    const contactSheetPath = writeContactSheet(results);
    const summaryPath = writeRunSummary(results, failures, contactSheetPath);
    const reportPath = join(runDir, "report.json");
    const ok = failures.length === 0;
    const reportPayload = {
      ok,
      ...reportMetadata,
      runDir,
      ...(includeReportPathInReport ? { reportPath } : {}),
      contactSheetPath,
      summaryPath,
      observations,
      ...reportAfterObservations,
      results,
      failures
    };
    const consolePayload = {
      ok,
      ...consoleMetadata,
      runDir,
      reportPath,
      contactSheetPath,
      summaryPath,
      ...consoleAfterSummary,
      failures
    };
    writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2));
    log(JSON.stringify(consolePayload, null, 2));
    if (failures.length) setExitCode(1);
    return { ok, runDir, reportPath, contactSheetPath, summaryPath, results, failures };
  }

  return {
    appendNonVisualSelfChecks,
    appendSupervisorDesktopLog,
    finishSuiteRun
  };
}
