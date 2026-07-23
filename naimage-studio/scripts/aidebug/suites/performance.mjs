import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

async function readRendererHeapUsage(client) {
  try {
    const usage = await client.send("Runtime.getHeapUsage", {}, 5000);
    const usedSize = Number(usage?.usedSize);
    const totalSize = Number(usage?.totalSize);
    if (!Number.isFinite(usedSize) || !Number.isFinite(totalSize)) {
      return { status: "unknown", reason: "Runtime.getHeapUsage returned non-numeric sizes" };
    }
    return {
      status: "measured",
      source: "cdp-runtime-get-heap-usage",
      usedBytes: usedSize,
      totalBytes: totalSize,
      embedderHeapUsedBytes: Number.isFinite(Number(usage?.embedderHeapUsedSize)) ? Number(usage.embedderHeapUsedSize) : null,
      backingStorageBytes: Number.isFinite(Number(usage?.backingStorageSize)) ? Number(usage.backingStorageSize) : null
    };
  } catch (error) {
    return { status: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}
async function collectRendererGarbage(client, passes = 3) {
  const requestedPasses = Math.max(1, Math.min(5, Math.round(Number(passes) || 1)));
  try {
    await client.send("HeapProfiler.enable", {}, 5000);
    const durationsMs = [];
    for (let index = 0; index < requestedPasses; index += 1) {
      const startedAt = Date.now();
      await client.send("HeapProfiler.collectGarbage", {}, 15000);
      durationsMs.push(Date.now() - startedAt);
      await delay(80);
    }
    return {
      status: "measured",
      source: "cdp-heap-profiler-collect-garbage",
      completed: true,
      requestedPasses,
      completedPasses: durationsMs.length,
      durationsMs
    };
  } catch (error) {
    return {
      status: "unknown",
      source: "cdp-heap-profiler-collect-garbage",
      completed: false,
      requestedPasses,
      completedPasses: 0,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function capturePerformanceSuiteProbe({
  client,
  targetId,
  aidebugConfigDir,
  packageRoot,
  runDir,
  startupPerformance,
  evaluate,
  captureState
}) {
  const nodeActions = Array.from({ length: 200 }, (_, index) => ({
    type: "workflow.node.create",
    toolRunId: `aidebug-performance-node-${index + 1}`,
    node: {
      id: `aidebug-performance-node-${index + 1}`,
      parentId: "",
      nodeType: "image",
      title: `性能基线节点 ${index + 1}`,
      prompt: `AIDebug controlled 200-node hydrate fixture ${index + 1}`,
      status: "review",
      imageState: "empty",
      x: 80 + (index % 20) * 248,
      y: 80 + Math.floor(index / 20) * 228,
      width: 214,
      height: 176
    }
  }));
  const imageFixtureDir = join(aidebugConfigDir, "projects", "default", "output", "imagegen", "performance-image-fixtures");
  mkdirSync(imageFixtureDir, { recursive: true });
  const fixtureFormats = ["png", "jpeg", "webp"];
  const imageFixtures = [];
  for (let index = 0; index < 10; index += 1) {
    const format = fixtureFormats[index % fixtureFormats.length];
    const extension = format === "jpeg" ? "jpg" : format;
    const filePath = join(imageFixtureDir, `performance-4k-${String(index + 1).padStart(2, "0")}.${extension}`);
    const background = {
      r: 38 + (index * 31) % 190,
      g: 42 + (index * 47) % 180,
      b: 54 + (index * 59) % 170,
      alpha: format === "jpeg" ? 1 : index % 2 === 0 ? 0.58 : 1
    };
    let fixture = sharp({ create: { width: 3840, height: 2160, channels: format === "jpeg" ? 3 : 4, background } });
    if (format === "png") fixture = fixture.png({ compressionLevel: 3 });
    else if (format === "jpeg") fixture = fixture.jpeg({ quality: 88, chromaSubsampling: "4:4:4" });
    else fixture = fixture.webp({ quality: 88, alphaQuality: 100 });
    await fixture.toFile(filePath);
    const relativePath = relative(packageRoot, filePath).split(/[\\/]+/).map(encodeURIComponent).join("/");
    imageFixtures.push({
      path: filePath,
      assetUrl: `naimage-asset://local/${relativePath}`,
      mimeType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
      width: 3840,
      height: 2160,
      bytes: statSync(filePath).size
    });
  }
  const heapBefore = await readRendererHeapUsage(client);
  const rendererMetrics = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrames = (count = 2) => new Promise((resolve) => {
      let remaining = Math.max(1, count);
      const step = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const waitFor = async (predicate, timeoutMs, label) => {
      const started = performance.now();
      while (performance.now() - started < timeoutMs) {
        if (predicate()) return { ok: true, elapsedMs: performance.now() - started };
        await nextFrames(1);
      }
      return { ok: false, elapsedMs: performance.now() - started, error: label + ' timed out' };
    };
    const percentile = (values, ratio) => {
      if (!values.length) return null;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
    };
    const round = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : null;
    const summarizeFrames = (name, startedAt, intervals, effectObserved, detail = {}) => ({
      name,
      status: intervals.length >= 10 ? 'measured' : 'unknown',
      reason: intervals.length >= 10 ? '' : 'fewer than 10 requestAnimationFrame intervals were captured',
      durationMs: round(performance.now() - startedAt),
      sampleCount: intervals.length,
      p50Ms: round(percentile(intervals, 0.5)),
      p95Ms: round(percentile(intervals, 0.95)),
      maxMs: round(intervals.length ? Math.max(...intervals) : null),
      effectObserved: Boolean(effectObserved),
      ...detail
    });
    const measureFrames = async (name, onStart, onFrame, onEnd) => {
      const intervals = [];
      let previous = null;
      const startedAt = performance.now();
      const before = onStart();
      await new Promise((resolve) => {
        let index = 0;
        const sample = (timestamp) => {
          if (previous != null) intervals.push(timestamp - previous);
          previous = timestamp;
          onFrame(index);
          index += 1;
          if (index >= 36) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const after = await onEnd(before);
      await nextFrames(2);
      return summarizeFrames(name, startedAt, intervals, after?.effectObserved, after?.detail || {});
    };

    const longTaskSupported = typeof PerformanceObserver === 'function' &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes('longtask');
    const longTaskEntries = [];
    let longTaskObserver = null;
    if (longTaskSupported) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
    const phaseLongTasks = {
      support: {
        status: 'measured',
        source: 'performance-observer-supported-entry-types',
        supported: longTaskSupported
      }
    };
    const rendererMemorySamples = {};
    const flushLongTasks = () => {
      if (!longTaskObserver) return;
      for (const entry of longTaskObserver.takeRecords()) longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' });
    };
    const beginPhase = (name) => {
      flushLongTasks();
      return { name, startedAt: performance.now() };
    };
    const endPhase = async (phase) => {
      await delay(80);
      flushLongTasks();
      const endedAt = performance.now();
      const entries = longTaskEntries.filter((entry) => Number(entry.startTime || 0) >= phase.startedAt && Number(entry.startTime || 0) <= endedAt);
      phaseLongTasks[phase.name] = longTaskSupported
        ? {
            status: 'measured',
            source: 'performance-observer-longtask',
            startedAt: round(phase.startedAt),
            endedAt: round(endedAt),
            durationMs: round(endedAt - phase.startedAt),
            count: entries.length,
            totalDurationMs: round(entries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)),
            maxDurationMs: round(entries.length ? Math.max(...entries.map((entry) => Number(entry.duration || 0))) : 0),
            entries: entries.map((entry) => ({ ...entry, startTime: round(entry.startTime), duration: round(entry.duration) }))
          }
        : { status: 'unknown', reason: 'PerformanceObserver longtask entry type is unavailable in this renderer' };
      return phaseLongTasks[phase.name];
    };
    const captureRendererMemory = (name) => {
      rendererMemorySamples[name] = performance.memory && Number.isFinite(Number(performance.memory.usedJSHeapSize))
        ? {
            status: 'measured',
            source: 'renderer-performance-memory',
            usedBytes: Number(performance.memory.usedJSHeapSize),
            totalBytes: Number(performance.memory.totalJSHeapSize),
            limitBytes: Number(performance.memory.jsHeapSizeLimit)
          }
        : { status: 'unknown', reason: 'performance.memory is unavailable in this renderer' };
      return rendererMemorySamples[name];
    };
    const performanceState = () => window.__naimageAIDebug?.performanceState?.() || window.__naimageDebugAgentState?.() || {};

    window.__naimageDebugOpenSurface?.('main');
    window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
    await nextFrames(3);
    await delay(420);
    window.__naimageAIDebug?.resetPersistenceMetrics?.();
    window.__naimageAIDebug?.resetRenderCommits?.();
    const nodes200Phase = beginPhase('nodes200');
    const hydrateStartedAt = performance.now();
    const hydrateAccepted = window.__naimageDebugApplyAgentActions?.(${JSON.stringify(nodeActions)});
    const hydrateWait = await waitFor(() => {
      const state = performanceState();
      return Number(state?.nodeCount || 0) === 200 && document.querySelectorAll('.flow-node').length > 0;
    }, 12000, '200-node hydrate');
    await nextFrames(3);
    const projectedDomNodeCount = document.querySelectorAll('.flow-node').length;
    const nodes200RenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    const nodes200 = {
      status: hydrateAccepted && hydrateWait.ok ? 'measured' : 'unknown',
      reason: hydrateAccepted && hydrateWait.ok ? '' : hydrateWait.error || 'runtime action fixture was rejected',
      durationMs: round(performance.now() - hydrateStartedAt),
      requestedNodeCount: 200,
      hydratedNodeCount: Number(performanceState().nodeCount || 0),
      renderedNodeCount: projectedDomNodeCount,
      projectionMode: projectedDomNodeCount < 200 ? 'viewport-projected' : 'all-nodes-mounted',
      projectionRatio: round(projectedDomNodeCount / 200),
      runtimeNodeCount: Number(performanceState().nodeCount || 0),
      renderCommits: nodes200RenderCommits,
      fixture: 'workflow.node.create x200 in one React state transaction'
    };
    await endPhase(nodes200Phase);
    captureRendererMemory('afterNodes200');

    let persistenceMutationAcceptedCount = 0;
    for (let index = 0; index < 8; index += 1) {
      const accepted = window.__naimageDebugApplyAgentActions?.([{
        type: 'workflow.node.update',
        patch: {
          id: 'aidebug-performance-node-' + (index + 1),
          x: 80 + (index % 20) * 248 + index + 1
        }
      }]);
      if (accepted) persistenceMutationAcceptedCount += 1;
      await delay(24);
    }
    await delay(760);
    const automaticPersistenceMetrics = window.__naimageAIDebug?.persistenceMetrics?.() || null;
    const largeProjectLoadStartedAt = performance.now();
    const largeProjectLoaded = await window.naimageConfig?.loadSession?.();
    const largeProjectLoadMs = performance.now() - largeProjectLoadStartedAt;
    const loadedNodeCount = Array.isArray(largeProjectLoaded?.session?.nodes) ? largeProjectLoaded.session.nodes.length : 0;
    const loadedRevision = Math.max(0, Number(largeProjectLoaded?.session?.sessionRevision || 0));
    const requestedRevision = loadedRevision + 1;
    const largeProjectSaveStartedAt = performance.now();
    const largeProjectSaved = largeProjectLoaded?.ok && loadedNodeCount === 200
      ? await window.naimageConfig?.saveSession?.({
          ...largeProjectLoaded.session,
          projectId: largeProjectLoaded.activeProjectId || largeProjectLoaded.project?.id || 'default',
          sessionRevision: requestedRevision
        })
      : null;
    const largeProjectSaveMs = performance.now() - largeProjectSaveStartedAt;
    const largeProject = {
      status: largeProjectLoaded?.ok && loadedNodeCount === 200 && largeProjectSaved?.ok && !largeProjectSaved?.skippedStale && Number(largeProjectSaved?.appliedRevision) === requestedRevision ? 'measured' : 'unknown',
      reason: largeProjectLoaded?.ok && loadedNodeCount === 200 && largeProjectSaved?.ok && !largeProjectSaved?.skippedStale && Number(largeProjectSaved?.appliedRevision) === requestedRevision
        ? ''
        : String(largeProjectSaved?.error || largeProjectLoaded?.error || ('expected persisted 200 nodes and revision ' + requestedRevision + ', received ' + loadedNodeCount + '/' + (largeProjectSaved?.appliedRevision ?? 'none'))),
      payloadNodeCount: loadedNodeCount,
      loadMs: round(largeProjectLoadMs),
      saveMs: round(largeProjectSaveMs),
      loadedRevision,
      requestedRevision,
      appliedRevision: Number(largeProjectSaved?.appliedRevision ?? -1),
      skippedStale: Boolean(largeProjectSaved?.skippedStale),
      persistedPath: largeProjectSaved?.path || '',
      persistenceMutationAcceptedCount,
      automaticPersistenceMetrics
    };

    window.__naimageAIDebug?.resetRenderCommits?.();
    const interactionsPhase = beginPhase('interactions');
    const canvas = document.querySelector('.workflow-canvas');
    const canvasBox = canvas?.getBoundingClientRect();
    const originX = (canvasBox?.left || 0) + Math.max(32, Math.min(120, Number(canvasBox?.width || 0) / 3));
    const originY = (canvasBox?.top || 0) + Math.max(48, Math.min(160, Number(canvasBox?.height || 0) / 3));
    const pan = await measureFrames('pan', () => {
      const before = performanceState().viewport || null;
      canvas?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 201, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: originX, clientY: originY }));
      return before;
    }, (index) => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 201, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: originX + index * 2, clientY: originY + index }));
    }, async (before) => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 201, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: originX + 72, clientY: originY + 36 }));
      await nextFrames(2);
      const after = performanceState().viewport || null;
      return {
        effectObserved: Boolean(before && after && (Number(before.x) !== Number(after.x) || Number(before.y) !== Number(after.y))),
        detail: { before, after }
      };
    });

    const zoom = await measureFrames('zoom', () => performanceState().viewport || null, () => {
      canvas?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -8, clientX: originX, clientY: originY }));
    }, async (before) => {
      await nextFrames(2);
      const after = performanceState().viewport || null;
      return {
        effectObserved: Boolean(before && after && Number(before.scale) !== Number(after.scale)),
        detail: { before, after }
      };
    });

    let dragTarget = null;
    const drag = await measureFrames('drag', () => {
      const node = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).find((item) => {
        const box = item.getBoundingClientRect();
        return box.width > 40 && box.height > 40 && box.right > 0 && box.bottom > 38 && box.left < innerWidth && box.top < innerHeight;
      }) || document.querySelector('.flow-node[data-node-id]');
      const title = node?.querySelector('.node-title-block') || node?.querySelector('.node-head') || node;
      const box = title?.getBoundingClientRect();
      const startX = (box?.left || originX) + Math.min(32, Number(box?.width || 64) / 2);
      const startY = (box?.top || originY) + Math.min(18, Number(box?.height || 36) / 2);
      const before = node ? {
        id: String(node.dataset.nodeId || ''),
        left: Number.parseFloat(node.style.left || '0'),
        top: Number.parseFloat(node.style.top || '0'),
        screenLeft: node.getBoundingClientRect().left,
        screenTop: node.getBoundingClientRect().top
      } : null;
      dragTarget = { node, startX, startY, before };
      title?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 202, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: startX, clientY: startY }));
      return dragTarget;
    }, (index) => {
      dragTarget?.node?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 202, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: dragTarget.startX + index * 1.5, clientY: dragTarget.startY + index * 0.75 }));
    }, async (beforePayload) => {
      const node = dragTarget?.node || null;
      const box = node?.getBoundingClientRect();
      node?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 202, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: dragTarget?.startX + 54, clientY: dragTarget?.startY + 27 }));
      await nextFrames(3);
      const after = node ? {
        id: String(node.dataset.nodeId || ''),
        left: Number.parseFloat(node.style.left || '0'),
        top: Number.parseFloat(node.style.top || '0'),
        screenLeft: node.getBoundingClientRect().left,
        screenTop: node.getBoundingClientRect().top
      } : null;
      const before = beforePayload?.before || null;
      return {
        effectObserved: Boolean(before && after && before.id === after.id && (Number(before.left) !== Number(after.left) || Number(before.top) !== Number(after.top))),
        detail: { before, after }
      };
    });
    const interactionRenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    await endPhase(interactionsPhase);
    captureRendererMemory('afterInteractions');

    window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
    await nextFrames(4);
    window.__naimageAIDebug?.resetRenderCommits?.();
    const nodes1000Phase = beginPhase('nodes1000');
    const nodes1000Actions = Array.from({ length: 1000 }, (_, index) => ({
      type: 'workflow.node.create',
      toolRunId: 'aidebug-performance-node-1000-' + (index + 1),
      node: {
        id: 'aidebug-performance-node-1000-' + (index + 1),
        parentId: index > 0 && index % 5 === 0 ? 'aidebug-performance-node-1000-' + index : '',
        relationType: index > 0 && index % 5 === 0 ? 'derived-from' : '',
        nodeType: 'image',
        title: '千节点压力成果 ' + (index + 1),
        prompt: 'AIDebug controlled 1000-node viewport fixture ' + (index + 1),
        status: 'review',
        imageState: 'empty',
        x: 80 + (index % 40) * 380,
        y: 80 + Math.floor(index / 40) * 520,
        width: 204,
        height: 166
      }
    }));
    const nodes1000StartedAt = performance.now();
    const nodes1000Accepted = window.__naimageDebugApplyAgentActions?.(nodes1000Actions);
    const nodes1000Wait = await waitFor(() => Number(performanceState().nodeCount || 0) === 1000, 30000, '1000-node hydrate');
    const selectedLast = await window.__naimageAIDebug?.selectNode?.({ id: 'aidebug-performance-node-1000-1000' });
    await nextFrames(4);
    const nodes1000State = performanceState();
    const nodes1000DomCount = document.querySelectorAll('.flow-node').length;
    const nodes1000EdgeCount = document.querySelectorAll('.edge.provenance').length;
    const selectedLastElement = document.querySelector('.flow-node[data-node-id="aidebug-performance-node-1000-1000"]');
    const selectedLastBox = selectedLastElement?.getBoundingClientRect();
    const selectedLastVisibleWidth = selectedLastBox ? Math.max(0, Math.min(selectedLastBox.right, innerWidth) - Math.max(selectedLastBox.left, 0)) : 0;
    const selectedLastVisibleHeight = selectedLastBox ? Math.max(0, Math.min(selectedLastBox.bottom, innerHeight) - Math.max(selectedLastBox.top, 0)) : 0;
    const selectedLastVisibleRatio = selectedLastBox
      ? (selectedLastVisibleWidth * selectedLastVisibleHeight) / Math.max(1, selectedLastBox.width * selectedLastBox.height)
      : 0;
    const nodes1000RenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    const nodes1000 = {
      status: nodes1000Accepted && nodes1000Wait.ok && selectedLast?.ok && Number(nodes1000State.nodeCount || 0) === 1000 && Number(nodes1000State.parentedNodeCount || 0) === 199 && nodes1000DomCount > 0 && Boolean(selectedLastElement) && selectedLastVisibleRatio > 0.9 && String(nodes1000State.selectedNodeId || '') === 'aidebug-performance-node-1000-1000' ? 'measured' : 'unknown',
      reason: nodes1000Accepted && nodes1000Wait.ok && selectedLast?.ok && Number(nodes1000State.nodeCount || 0) === 1000 && Number(nodes1000State.parentedNodeCount || 0) === 199 && nodes1000DomCount > 0 && Boolean(selectedLastElement) && selectedLastVisibleRatio > 0.9 && String(nodes1000State.selectedNodeId || '') === 'aidebug-performance-node-1000-1000'
        ? ''
        : nodes1000Wait.error || selectedLast?.error || '1000-node runtime/relation/visible-selection fixture was not fully observed',
      durationMs: round(performance.now() - nodes1000StartedAt),
      requestedNodeCount: 1000,
      hydratedNodeCount: Number(nodes1000State.nodeCount || 0),
      requestedRelationCount: 199,
      hydratedRelationCount: Number(nodes1000State.parentedNodeCount || 0),
      renderedNodeCount: nodes1000DomCount,
      renderedEdgeCount: nodes1000EdgeCount,
      projectionMode: nodes1000DomCount < 1000 ? 'viewport-projected' : 'all-nodes-mounted',
      projectionRatio: round(nodes1000DomCount / 1000),
      selectedNodeId: String(nodes1000State.selectedNodeId || ''),
      selectedLastRendered: Boolean(selectedLastElement),
      selectedLastVisibleRatio: round(selectedLastVisibleRatio),
      selectedLastGeometry: selectedLastBox ? { left: round(selectedLastBox.left), top: round(selectedLastBox.top), right: round(selectedLastBox.right), bottom: round(selectedLastBox.bottom), width: round(selectedLastBox.width), height: round(selectedLastBox.height) } : null,
      renderCommits: nodes1000RenderCommits,
      fixture: 'workflow.node.create x1000 with 199 derived-from relationships in one React state transaction'
    };
    await endPhase(nodes1000Phase);
    captureRendererMemory('afterNodes1000');

    window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
    await waitFor(() => Number(performanceState().nodeCount || 0) === 0 && document.querySelectorAll('.flow-node').length === 0, 12000, '1000-node cleanup');
    window.__naimageDebugOpenSurface?.('agent-timeline');
    window.__naimageDebugSeedAgentMessages?.({ clear: true });
    await nextFrames(3);
    window.__naimageAIDebug?.resetRenderCommits?.();
    const longTimelinePhase = beginPhase('longTimeline');
    const timelineMessages = [];
    for (let index = 0; index < 400; index += 1) {
      timelineMessages.push({
        id: 'aidebug-performance-timeline-message-' + (index + 1),
        role: index % 4 === 0 ? 'user' : 'assistant',
        content: '长时间线已完成消息 ' + (index + 1) + ' · 东方设计任务上下文与结果摘要。',
        status: 'done',
        meta: 'performance-long-timeline'
      });
    }
    for (let index = 0; index < 50; index += 1) {
      timelineMessages.push({
        id: 'aidebug-performance-tool-start-' + (index + 1),
        role: 'assistant',
        content: '准备执行第 ' + (index + 1) + ' 次工具任务。',
        status: 'done',
        meta: 'performance-tool-start',
        toolTrace: { stage: 'start', label: '工具', name: 'image_gen', operation: '开始 ' + (index + 1), brief: '长时间线工具开始事件 ' + (index + 1) }
      });
      timelineMessages.push({
        id: 'aidebug-performance-tool-done-' + (index + 1),
        role: 'assistant',
        content: '第 ' + (index + 1) + ' 次工具任务完成。',
        status: 'done',
        meta: 'performance-tool-complete',
        toolTrace: { stage: 'result', label: '工具', name: 'image_gen', operation: '完成 ' + (index + 1), brief: '长时间线工具完成事件 ' + (index + 1), completionText: '第 ' + (index + 1) + ' 次工具任务完成' }
      });
    }
    const longTimelineStartedAt = performance.now();
    const longTimelineAccepted = window.__naimageDebugSeedAgentMessages?.({ messages: timelineMessages, append: false, maxMessages: 500 });
    const longTimelineRenderWindow = 80;
    const longTimelineVisibleToolPairs = 40;
    const longTimelineWait = await waitFor(() => Number(performanceState().messageCount || 0) === 500 && document.querySelectorAll('.project-agent-feed .agent-message').length === longTimelineRenderWindow, 12000, '500-message timeline window');
    const feed = document.querySelector('.project-agent-feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
    await nextFrames(3);
    const composer = document.querySelector('.project-agent-composer textarea');
    const composerSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const inputSentinel = 'AIDEBUG_PERFORMANCE_INPUT_LATENCY_' + Date.now();
    const inputStartedAt = performance.now();
    composerSetter?.call(composer, inputSentinel);
    composer?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: inputSentinel }));
    await nextFrames(2);
    const inputLatencyMs = performance.now() - inputStartedAt;
    const inputObserved = composer?.value === inputSentinel;
    if (feed) feed.scrollTop = Number.MAX_SAFE_INTEGER;
    await nextFrames(2);
    const feedBottomGap = feed ? Math.max(0, feed.scrollHeight - feed.scrollTop - feed.clientHeight) : null;
    const longTimelineDomCount = document.querySelectorAll('.project-agent-feed .agent-message').length;
    const longTimelineToolTraceCount = document.querySelectorAll('.project-agent-feed .agent-tool-trace').length;
    const longTimelineToolStartCount = document.querySelectorAll('.project-agent-feed .agent-tool-trace[data-tool-stage="start"]').length;
    const longTimelineToolCompleteCount = document.querySelectorAll('.project-agent-feed .agent-tool-trace[data-tool-stage="result"]').length;
    const feedPresent = Boolean(feed);
    const composerPresent = Boolean(composer);
    const longTimelineRenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    const longTimeline = {
      status: longTimelineAccepted && longTimelineWait.ok && longTimelineDomCount === longTimelineRenderWindow && longTimelineToolTraceCount === longTimelineVisibleToolPairs * 2 && longTimelineToolStartCount === longTimelineVisibleToolPairs && longTimelineToolCompleteCount === longTimelineVisibleToolPairs && feedPresent && composerPresent && inputObserved && Number(feedBottomGap) <= 2 ? 'measured' : 'unknown',
      reason: longTimelineAccepted && longTimelineWait.ok && longTimelineDomCount === longTimelineRenderWindow && longTimelineToolTraceCount === longTimelineVisibleToolPairs * 2 && longTimelineToolStartCount === longTimelineVisibleToolPairs && longTimelineToolCompleteCount === longTimelineVisibleToolPairs && feedPresent && composerPresent && inputObserved && Number(feedBottomGap) <= 2
        ? ''
        : longTimelineWait.error || '500-message window/tool-stage/input/scroll evidence was incomplete',
      durationMs: round(performance.now() - longTimelineStartedAt),
      requestedMessageCount: 500,
      renderWindowSize: longTimelineRenderWindow,
      runtimeMessageCount: Number(performanceState().messageCount || 0),
      domMessageCount: longTimelineDomCount,
      toolStartCompletePairCount: 50,
      visibleToolPairCount: longTimelineVisibleToolPairs,
      toolTraceDomCount: longTimelineToolTraceCount,
      toolStartDomCount: longTimelineToolStartCount,
      toolCompleteDomCount: longTimelineToolCompleteCount,
      feedPresent,
      composerPresent,
      feedScrollTop: feed ? round(feed.scrollTop) : null,
      feedScrollHeight: feed ? round(feed.scrollHeight) : null,
      feedClientHeight: feed ? round(feed.clientHeight) : null,
      feedBottomGap: round(feedBottomGap),
      inputLatencyMs: round(inputLatencyMs),
      inputObserved,
      renderCommits: longTimelineRenderCommits,
      fixture: '500 completed messages including 50 image_gen start/complete pairs'
    };
    composerSetter?.call(composer, '');
    composer?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    await endPhase(longTimelinePhase);
    captureRendererMemory('afterLongTimeline');

    window.__naimageDebugSeedAgentMessages?.({
      messages: [{ id: 'aidebug-performance-stream-message', role: 'assistant', content: 'STREAM_BEGIN|', status: 'running', meta: 'performance-streaming' }],
      append: false,
      maxMessages: 1
    });
    await nextFrames(3);
    window.__naimageAIDebug?.resetRenderCommits?.();
    const streamingPhase = beginPhase('streamingTimeline');
    const streamingStartedAt = performance.now();
    let acceptedDeltaCount = 0;
    let streamingExpectedText = 'STREAM_BEGIN|';
    for (let index = 1; index <= 1000; index += 1) {
      const deltaToken = 'D' + String(index).padStart(4, '0') + (index === 1000 ? '|STREAM_END_1000' : '|');
      streamingExpectedText += deltaToken;
      const accepted = window.__naimageDebugSeedAgentMessages?.({
        streamDelta: {
          id: 'aidebug-performance-stream-message',
          delta: deltaToken,
          status: index === 1000 ? 'done' : 'running'
        }
      });
      if (accepted) acceptedDeltaCount += 1;
      if (index % 20 === 0) await delay(0);
    }
    let streamingWaitState = null;
    const streamingWait = await waitFor(() => {
      const text = String(document.querySelector('.project-agent-feed .agent-message .markdown-body')?.textContent || '');
      const currentFeed = document.querySelector('.project-agent-feed');
      const bottomGap = currentFeed ? Math.max(0, currentFeed.scrollHeight - currentFeed.scrollTop - currentFeed.clientHeight) : Infinity;
      const paddingBottom = currentFeed ? Number.parseFloat(getComputedStyle(currentFeed).paddingBottom || '0') || 0 : 0;
      const contentBottomGap = Math.max(0, bottomGap - paddingBottom);
      const domMessageCount = document.querySelectorAll('.project-agent-feed .agent-message').length;
      const runningMessageCount = document.querySelectorAll('.project-agent-feed .agent-message.running').length;
      streamingWaitState = {
        domMessageCount,
        runningMessageCount,
        payloadExactMatch: text === streamingExpectedText,
        payloadLength: text.length,
        expectedPayloadLength: streamingExpectedText.length,
        feedPresent: Boolean(currentFeed),
        scrollTop: currentFeed ? currentFeed.scrollTop : null,
        scrollHeight: currentFeed ? currentFeed.scrollHeight : null,
        clientHeight: currentFeed ? currentFeed.clientHeight : null,
        bottomGap,
        paddingBottom,
        contentBottomGap
      };
      return domMessageCount === 1 && streamingWaitState.payloadExactMatch && runningMessageCount === 0 && contentBottomGap <= 2;
    }, 12000, '1000 streaming deltas');
    const streamingFeed = document.querySelector('.project-agent-feed');
    await nextFrames(3);
    await delay(280);
    await nextFrames(2);
    const streamingArticle = document.querySelector('.project-agent-feed .agent-message');
    const streamingText = String(streamingArticle?.querySelector('.markdown-body')?.textContent || '');
    const streamingBottomGap = streamingFeed ? Math.max(0, streamingFeed.scrollHeight - streamingFeed.scrollTop - streamingFeed.clientHeight) : null;
    const streamingBottomPadding = streamingFeed ? Number.parseFloat(getComputedStyle(streamingFeed).paddingBottom || '0') || 0 : 0;
    const streamingContentBottomGap = streamingBottomGap === null ? null : Math.max(0, streamingBottomGap - streamingBottomPadding);
    const streamingRunningCount = document.querySelectorAll('.project-agent-feed .agent-message.running').length;
    const streamingFinalStatus = streamingArticle?.classList.contains('done') ? 'done' : streamingArticle?.classList.contains('error') ? 'error' : streamingArticle?.classList.contains('running') ? 'running' : 'unknown';
    const streamingRuntimeMessageCount = Number(performanceState().messageCount || 0);
    const streamingFeedPresent = Boolean(streamingFeed);
    const streamingRenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    const streamingTimeline = {
      status: acceptedDeltaCount === 1000 && streamingWait.ok && streamingRuntimeMessageCount === 1 && document.querySelectorAll('.project-agent-feed .agent-message').length === 1 && streamingText === streamingExpectedText && streamingFinalStatus === 'done' && streamingRunningCount === 0 && streamingFeedPresent && Number(streamingContentBottomGap) <= 2 ? 'measured' : 'unknown',
      reason: acceptedDeltaCount === 1000 && streamingWait.ok && streamingRuntimeMessageCount === 1 && document.querySelectorAll('.project-agent-feed .agent-message').length === 1 && streamingText === streamingExpectedText && streamingFinalStatus === 'done' && streamingRunningCount === 0 && streamingFeedPresent && Number(streamingContentBottomGap) <= 2
        ? ''
        : streamingWait.error || 'single-message 1000-delta payload/status/scroll evidence was incomplete',
      durationMs: round(performance.now() - streamingStartedAt),
      requestedDeltaCount: 1000,
      acceptedDeltaCount,
      runtimeMessageCount: streamingRuntimeMessageCount,
      domMessageCount: document.querySelectorAll('.project-agent-feed .agent-message').length,
      finalMarkerPresent: streamingText.includes('STREAM_END_1000'),
      finalStatus: streamingFinalStatus,
      runningMessageCount: streamingRunningCount,
      feedPresent: streamingFeedPresent,
      expectedPayloadLength: streamingExpectedText.length,
      runtimePayloadLength: streamingText.length,
      payloadExactMatch: streamingText === streamingExpectedText,
      finalTextLength: streamingText.length,
      feedBottomGap: round(streamingBottomGap),
      feedBottomPadding: round(streamingBottomPadding),
      feedContentBottomGap: round(streamingContentBottomGap),
      waitElapsedMs: round(streamingWait.elapsedMs),
      autoScrollState: streamingWaitState ? {
        ...streamingWaitState,
        scrollTop: round(streamingWaitState.scrollTop),
        scrollHeight: round(streamingWaitState.scrollHeight),
        clientHeight: round(streamingWaitState.clientHeight),
        bottomGap: round(streamingWaitState.bottomGap),
        paddingBottom: round(streamingWaitState.paddingBottom),
        contentBottomGap: round(streamingWaitState.contentBottomGap)
      } : null,
      renderCommits: streamingRenderCommits,
      fixture: 'one assistant message with 1000 incremental streamDelta state updates'
    };
    await endPhase(streamingPhase);
    captureRendererMemory('afterStreamingTimeline');
    window.__naimageDebugSeedAgentMessages?.({ clear: true });
    window.__naimageDebugOpenSurface?.('main');
    await nextFrames(4);

    window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
    await nextFrames(3);
    window.__naimageAIDebug?.resetRenderCommits?.();
    const imageContainerPhase = beginPhase('imageContainer10');
    const thumbnailStatsReset = await window.naimageConfig?.thumbnailStats?.({ reset: true });
    const imageFixtures = ${JSON.stringify(imageFixtures)};
    const assets = imageFixtures.map((fixture, index) => ({
      id: 'aidebug-performance-asset-' + (index + 1),
      index: index + 1,
      runId: 'aidebug-performance-container-10',
      title: '性能图片 ' + (index + 1),
      prompt: 'AIDebug ten-image container fixture ' + (index + 1),
      status: 'done',
      mimeType: fixture.mimeType,
      width: fixture.width,
      height: fixture.height,
      path: fixture.path,
      originalPath: fixture.path,
      assetUrl: fixture.assetUrl
    }));
    const collectionItems = assets.map((asset, index) => ({
      id: 'aidebug-performance-item-' + (index + 1),
      assetIndex: index + 1,
      title: asset.title,
      prompt: asset.prompt,
      status: 'done'
    }));
    const containerStartedAt = performance.now();
    const containerAccepted = window.__naimageDebugApplyAgentActions?.([{
      type: 'workflow.node.create',
      toolRunId: 'aidebug-performance-container-10',
      node: {
        id: 'aidebug-performance-container-10',
        parentId: '',
        nodeType: 'image',
        title: '10 图容器性能基线',
        prompt: 'AIDebug controlled ten-image adaptive container fixture',
        status: 'done',
        imageState: 'done',
        x: 260,
        y: 140,
        assets,
        imageParams: { prompt: 'AIDebug controlled ten-image adaptive container fixture', count: 10, size: '1024x1024' },
        imageProgress: { total: 10, completed: 10, failed: 0, failedSlots: [], retryCount: 0, maxRetries: 0, stopped: false, message: 'Agent 生成完成' },
        imageCollection: { id: 'aidebug-performance-collection-10', kind: 'batch', generationMode: 'parallel', createdAt: new Date().toISOString(), items: collectionItems }
      }
    }]);
    const containerWait = await waitFor(() => {
      const host = document.querySelector('.flow-node[data-node-id="aidebug-performance-container-10"]');
      const tiles = host?.querySelectorAll('.node-image-tile') || [];
      const images = host?.querySelectorAll('.node-image-tile img') || [];
      return tiles.length === 10 && images.length === 10 && Array.from(images).every((image) => image.complete && image.naturalWidth > 0);
    }, 30000, '10-image container render');
    await nextFrames(3);
    const containerHost = document.querySelector('.flow-node[data-node-id="aidebug-performance-container-10"]');
    const containerImages = Array.from(containerHost?.querySelectorAll('.node-image-tile img') || []);
    const canvasImageSources = containerImages.map((image) => String(image.currentSrc || image.getAttribute('src') || ''));
    const canvasNaturalSizes = containerImages.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    const canvasUsesThumbnails = canvasImageSources.length === 10 && canvasImageSources.every((source) => /[?&]preview=thumbnail(?:&|$)/.test(source));
    const thumbnailDimensionsBounded = canvasNaturalSizes.length === 10 && canvasNaturalSizes.every((size) => Math.max(Number(size.width || 0), Number(size.height || 0)) <= 512);
    const firstTile = containerHost?.querySelector('.node-image-tile');
    firstTile?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    const viewerWait = await waitFor(() => Boolean(document.querySelector('.image-viewer-stage img')), 3000, 'original image viewer');
    await delay(260);
    const viewerMainImage = document.querySelector('.image-viewer-stage img');
    const viewerMainSource = String(viewerMainImage?.currentSrc || viewerMainImage?.getAttribute('src') || '');
    const viewerStripSources = Array.from(document.querySelectorAll('.image-viewer-strip img')).map((image) => String(image.currentSrc || image.getAttribute('src') || ''));
    const viewerUsesOriginal = Boolean(viewerWait.ok && viewerMainSource && !/[?&]preview=thumbnail(?:&|$)/.test(viewerMainSource));
    const viewerStripUsesThumbnails = viewerStripSources.length === 10 && viewerStripSources.every((source) => /[?&]preview=thumbnail(?:&|$)/.test(source));
    const viewerCloseButton = document.querySelector('[data-ui-surface="image-viewer"] .ui-surface-close');
    viewerCloseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    const viewerCloseWait = await waitFor(() => !document.querySelector('[data-ui-surface="image-viewer"]'), 3000, 'image viewer close');
    await nextFrames(2);
    const imageContainerRenderCommits = window.__naimageAIDebug?.renderCommits?.() || null;
    const coldThumbnailStatsResult = await window.naimageConfig?.thumbnailStats?.();
    const coldThumbnailStats = coldThumbnailStatsResult?.stats || null;
    const coldThumbnailOk = Boolean(
      thumbnailStatsReset?.ok && coldThumbnailStatsResult?.ok && coldThumbnailStats &&
      Number(coldThumbnailStats.generated) === 10 && Number(coldThumbnailStats.workerStarts) === 10 &&
      Number(coldThumbnailStats.maxActiveWorkers) > 0 && Number(coldThumbnailStats.maxActiveWorkers) <= 2 &&
      Number(coldThumbnailStats.errors) === 0
    );
    await window.naimageConfig?.thumbnailStats?.({ reset: true });
    const warmStartedAt = performance.now();
    const warmResponses = await Promise.all(canvasImageSources.map((source, index) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ ok: false, width: 0, height: 0 });
      image.src = source + '&warmProbe=' + index;
    })));
    const warmDurationMs = performance.now() - warmStartedAt;
    const warmThumbnailStatsResult = await window.naimageConfig?.thumbnailStats?.();
    const warmThumbnailStats = warmThumbnailStatsResult?.stats || null;
    const warmThumbnailOk = Boolean(
      warmThumbnailStatsResult?.ok && warmThumbnailStats && warmResponses.every((item) => item.ok && Math.max(Number(item.width || 0), Number(item.height || 0)) <= 512) &&
      Number(warmThumbnailStats.cacheHits) === 10 && Number(warmThumbnailStats.workerStarts) === 0 &&
      Number(warmThumbnailStats.generated) === 0 && Number(warmThumbnailStats.errors) === 0
    );
    const thumbnailEvidenceOk = canvasUsesThumbnails && thumbnailDimensionsBounded && viewerUsesOriginal && viewerStripUsesThumbnails && viewerCloseWait.ok && coldThumbnailOk && warmThumbnailOk;
    const imageContainer10 = {
      status: containerAccepted && containerWait.ok && thumbnailEvidenceOk ? 'measured' : 'unknown',
      reason: containerAccepted && containerWait.ok && thumbnailEvidenceOk ? '' : containerWait.error || viewerWait.error || viewerCloseWait.error || 'thumbnail/original source boundary was not observed',
      durationMs: round(performance.now() - containerStartedAt),
      requestedImageCount: 10,
      renderedImageCount: containerHost?.querySelectorAll('.node-image-tile').length || 0,
      loadedImageCount: containerImages.filter((image) => image.complete && image.naturalWidth > 0).length,
      canvasUsesThumbnails,
      thumbnailDimensionsBounded,
      canvasImageSources,
      canvasNaturalSizes,
      viewerUsesOriginal,
      viewerMainSource,
      viewerStripUsesThumbnails,
      viewerStripSources,
      viewerClosed: viewerCloseWait.ok,
      coldThumbnailOk,
      coldThumbnailStats,
      warmThumbnailOk,
      warmThumbnailStats,
      warmDurationMs: round(warmDurationMs),
      warmNaturalSizes: warmResponses.map((item) => ({ width: item.width, height: item.height })),
      thumbnailEvidenceOk,
      renderCommits: imageContainerRenderCommits,
      fixture: 'one parallel imageCollection node with ten managed 4K PNG/JPEG/WebP assets'
    };
    await endPhase(imageContainerPhase);
    captureRendererMemory('afterImageContainer10');
    await window.__naimageAIDebug?.fitCanvas?.();
    await delay(450);
    const loadStartedAt = performance.now();
    const loaded = await window.naimageConfig?.loadSession?.();
    const loadBeforeSaveMs = performance.now() - loadStartedAt;
    const saveStartedAt = performance.now();
    const saved = loaded?.ok && loaded.session
      ? await window.naimageConfig?.saveSession?.({ ...loaded.session, projectId: loaded.activeProjectId || loaded.project?.id || 'default' })
      : null;
    const save = {
      status: loaded?.ok && saved?.ok ? 'measured' : 'unknown',
      reason: loaded?.ok && saved?.ok ? '' : String(saved?.error || loaded?.error || 'session load/save bridge unavailable'),
      durationMs: round(performance.now() - saveStartedAt),
      loadBeforeSaveMs: round(loadBeforeSaveMs),
      payloadNodeCount: Array.isArray(loaded?.session?.nodes) ? loaded.session.nodes.length : null,
      persistedPath: saved?.path || ''
    };

    await delay(120);
    if (longTaskObserver) {
      for (const entry of longTaskObserver.takeRecords()) longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' });
      longTaskObserver.disconnect();
    }
    const rendererMemory = performance.memory && Number.isFinite(Number(performance.memory.usedJSHeapSize))
      ? {
          status: 'measured',
          source: 'renderer-performance-memory',
          usedBytes: Number(performance.memory.usedJSHeapSize),
          totalBytes: Number(performance.memory.totalJSHeapSize),
          limitBytes: Number(performance.memory.jsHeapSizeLimit)
        }
      : { status: 'unknown', reason: 'performance.memory is unavailable in this renderer' };
    const longTasks = longTaskSupported
      ? {
          status: 'measured',
          source: 'performance-observer-longtask',
          count: longTaskEntries.length,
          totalDurationMs: round(longTaskEntries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)),
          maxDurationMs: round(longTaskEntries.length ? Math.max(...longTaskEntries.map((entry) => Number(entry.duration || 0))) : 0),
          entries: longTaskEntries.map((entry) => ({ ...entry, startTime: round(entry.startTime), duration: round(entry.duration) }))
        }
      : { status: 'unknown', reason: 'PerformanceObserver longtask entry type is unavailable in this renderer' };
    const rendererCommits = {
      canvas: {
        status: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? 'measured' : 'unknown',
        reason: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? '' : 'render commit probes unavailable',
        nodes200: Number(nodes200RenderCommits?.canvas ?? 0),
        interactions: Number(interactionRenderCommits?.canvas ?? 0),
        nodes1000: Number(nodes1000RenderCommits?.canvas ?? 0),
        longTimeline: Number(longTimelineRenderCommits?.canvas ?? 0),
        streamingTimeline: Number(streamingRenderCommits?.canvas ?? 0),
        imageContainer10: Number(imageContainerRenderCommits?.canvas ?? 0)
      },
      agentFeed: {
        status: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? 'measured' : 'unknown',
        reason: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? '' : 'render commit probes unavailable',
        nodes200: Number(nodes200RenderCommits?.agentFeed ?? 0),
        interactions: Number(interactionRenderCommits?.agentFeed ?? 0),
        nodes1000: Number(nodes1000RenderCommits?.agentFeed ?? 0),
        longTimeline: Number(longTimelineRenderCommits?.agentFeed ?? 0),
        streamingTimeline: Number(streamingRenderCommits?.agentFeed ?? 0),
        imageContainer10: Number(imageContainerRenderCommits?.agentFeed ?? 0)
      },
      composer: {
        status: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? 'measured' : 'unknown',
        reason: nodes200RenderCommits && interactionRenderCommits && nodes1000RenderCommits && longTimelineRenderCommits && streamingRenderCommits && imageContainerRenderCommits ? '' : 'render commit probes unavailable',
        nodes200: Number(nodes200RenderCommits?.composer ?? 0),
        interactions: Number(interactionRenderCommits?.composer ?? 0),
        nodes1000: Number(nodes1000RenderCommits?.composer ?? 0),
        longTimeline: Number(longTimelineRenderCommits?.composer ?? 0),
        streamingTimeline: Number(streamingRenderCommits?.composer ?? 0),
        imageContainer10: Number(imageContainerRenderCommits?.composer ?? 0)
      }
    };
    const persistence = {
      largeProject,
      writeCount: Number(automaticPersistenceMetrics?.writeCount ?? NaN),
      coalescedWriteCount: Number(automaticPersistenceMetrics?.coalescedWriteCount ?? NaN),
      flushMs: Number(automaticPersistenceMetrics?.flushMs ?? NaN),
      mutationCount: Number(automaticPersistenceMetrics?.mutationCount ?? NaN),
      scheduledWriteCount: Number(automaticPersistenceMetrics?.scheduledWriteCount ?? NaN),
      pendingWriteCount: Number(automaticPersistenceMetrics?.pendingWriteCount ?? NaN),
      skippedWriteCount: Number(automaticPersistenceMetrics?.skippedWriteCount ?? NaN),
      failedWriteCount: Number(automaticPersistenceMetrics?.failedWriteCount ?? NaN),
      maxFlushMs: Number(automaticPersistenceMetrics?.maxFlushMs ?? NaN),
      lastFlushMs: Number(automaticPersistenceMetrics?.lastFlushMs ?? NaN),
      source: String(automaticPersistenceMetrics?.source || '')
    };
    return { nodes200, nodes1000, longTimeline, streamingTimeline, imageContainer10, interactions: { pan, zoom, drag }, rendererCommits, persistence, save, longTasks, phaseLongTasks, rendererMemory, rendererMemorySamples };
  })()`, 180000);
  const thumbnailCacheDir = join(aidebugConfigDir, "projects", "default", ".naimage", "thumbnails");
  const thumbnailEntries = existsSync(thumbnailCacheDir) ? readdirSync(thumbnailCacheDir) : [];
  const thumbnailFiles = thumbnailEntries.filter((entry) => extname(entry).toLowerCase() === ".webp");
  const thumbnailStagingFiles = thumbnailEntries.filter((entry) => entry.endsWith(".tmp"));
  const thumbnailBytes = thumbnailFiles.reduce((sum, entry) => sum + statSync(join(thumbnailCacheDir, entry)).size, 0);
  const sourceBytes = imageFixtures.reduce((sum, fixture) => sum + Number(fixture.bytes || 0), 0);
  const thumbnailDiskCache = {
    status: thumbnailFiles.length === 10 && thumbnailStagingFiles.length === 0 ? "measured" : "unknown",
    reason: thumbnailFiles.length === 10 && thumbnailStagingFiles.length === 0 ? "" : `expected 10 committed WebP thumbnails and no staging files, received ${thumbnailFiles.length}/${thumbnailStagingFiles.length}`,
    sourceAssetCount: imageFixtures.length,
    sourceFormats: [...new Set(imageFixtures.map((fixture) => fixture.mimeType))],
    sourceBytes,
    thumbnailCount: thumbnailFiles.length,
    thumbnailBytes,
    byteRatio: sourceBytes > 0 ? Math.round((thumbnailBytes / sourceBytes) * 100000) / 100000 : null,
    stagingFileCount: thumbnailStagingFiles.length,
    cacheDir: thumbnailCacheDir
  };
  if (rendererMetrics?.imageContainer10) {
    rendererMetrics.imageContainer10.thumbnailDiskCache = thumbnailDiskCache;
    if (thumbnailDiskCache.status !== "measured") {
      rendererMetrics.imageContainer10.status = "unknown";
      rendererMetrics.imageContainer10.reason = thumbnailDiskCache.reason;
    }
  }
  const heapAfterFixture = await readRendererHeapUsage(client);
  const jsHeap = heapBefore.status === "measured" && heapAfterFixture.status === "measured"
    ? {
        status: "measured",
        source: heapAfterFixture.source,
        beforeBytes: heapBefore.usedBytes,
        afterBytes: heapAfterFixture.usedBytes,
        deltaBytes: heapAfterFixture.usedBytes - heapBefore.usedBytes,
        beforeTotalBytes: heapBefore.totalBytes,
        afterTotalBytes: heapAfterFixture.totalBytes,
        rendererMemory: rendererMetrics?.rendererMemory || null,
        rendererMemorySamples: rendererMetrics?.rendererMemorySamples || null
      }
    : {
        status: "unknown",
        reason: [heapBefore.reason, heapAfterFixture.reason].filter(Boolean).join("; ") || "CDP heap usage unavailable",
        before: heapBefore,
        after: heapAfterFixture,
        rendererMemory: rendererMetrics?.rendererMemory || null,
        rendererMemorySamples: rendererMetrics?.rendererMemorySamples || null
      };
  const imageContainerMetric = rendererMetrics?.imageContainer10 || null;
  const imageThumbnailCold = imageContainerMetric?.coldThumbnailOk
    ? {
        status: "measured",
        reason: "",
        durationMs: imageContainerMetric.durationMs,
        stats: imageContainerMetric.coldThumbnailStats,
        naturalSizes: imageContainerMetric.canvasNaturalSizes
      }
    : { status: "unknown", reason: "cold thumbnail runtime stats did not prove ten generated assets", stats: imageContainerMetric?.coldThumbnailStats || null };
  const imageThumbnailWarm = imageContainerMetric?.warmThumbnailOk
    ? {
        status: "measured",
        reason: "",
        durationMs: imageContainerMetric.warmDurationMs,
        responseBytes: imageContainerMetric.warmResponseBytes,
        stats: imageContainerMetric.warmThumbnailStats
      }
    : { status: "unknown", reason: "warm thumbnail runtime stats did not prove ten cache hits", stats: imageContainerMetric?.warmThumbnailStats || null };
  const imagePipeline = {
    requestCount: Number(imageContainerMetric?.coldThumbnailStats?.requests || 0) + Number(imageContainerMetric?.warmThumbnailStats?.requests || 0),
    originalBytes: sourceBytes,
    thumbnailBytes,
    cacheHits: Number(imageContainerMetric?.warmThumbnailStats?.cacheHits || 0),
    generated: Number(imageContainerMetric?.coldThumbnailStats?.generated || 0),
    maxConcurrentWorkers: Number(imageContainerMetric?.coldThumbnailStats?.maxActiveWorkers || 0),
    canvasUsesThumbnails: imageContainerMetric?.canvasUsesThumbnails === true,
    viewerUsesOriginal: imageContainerMetric?.viewerUsesOriginal === true
  };
  const containerCapture = await captureState(
    client,
    targetId,
    "performance-suite-10-image-container",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentNodeCount: 1,
      imageNodeCount: 1,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true
    }
  );
  const containerObserved = await evaluate(client, `({
    runtimeNodeCount: Number(window.__naimageDebugAgentState?.().nodeCount || 0),
    domNodeCount: document.querySelectorAll('.flow-node').length,
    renderedImageCount: document.querySelectorAll('.flow-node .node-image-tile').length,
    loadedImageCount: Array.from(document.querySelectorAll('.flow-node .node-image-tile img')).filter((image) => image.complete && image.naturalWidth > 0).length
  })`);

  const nodes1000Capture = await captureState(
    client,
    targetId,
    "performance-suite-1000-nodes",
    `(async () => {
      window.__naimageDebugOpenSurface?.('main');
      window.__naimageDebugSeedAgentMessages?.({ clear: true });
      window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
      const actions = Array.from({ length: 1000 }, (_, index) => ({
        type: 'workflow.node.create',
        toolRunId: 'aidebug-performance-visual-node-' + (index + 1),
        node: {
          id: 'aidebug-performance-visual-node-' + (index + 1),
          parentId: index > 0 && index % 5 === 0 ? 'aidebug-performance-visual-node-' + index : '',
          relationType: index > 0 && index % 5 === 0 ? 'derived-from' : '',
          nodeType: 'image',
          title: '千节点视觉证据 ' + (index + 1),
          prompt: 'AIDebug controlled visual checkpoint ' + (index + 1),
          status: 'review', imageState: 'empty',
          x: 80 + (index % 40) * 380,
          y: 80 + Math.floor(index / 40) * 520,
          width: 204, height: 166
        }
      }));
      const accepted = window.__naimageDebugApplyAgentActions?.(actions);
      const startedAt = Date.now();
      while (Date.now() - startedAt < 30000 && Number(window.__naimageDebugAgentState?.().nodeCount || 0) !== 1000) await new Promise((resolve) => requestAnimationFrame(resolve));
      const selected = await window.__naimageAIDebug?.selectNode?.({ id: 'aidebug-performance-visual-node-1000' });
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { accepted, selected };
    })()`,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentNodeCount: 1000,
      selectedNodeId: "aidebug-performance-visual-node-1000",
      nodeOverlapOk: true
    },
    45000,
    "overview"
  );
  const nodes1000Observed = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    const selected = document.querySelector('.flow-node[data-node-id="aidebug-performance-visual-node-1000"]');
    const box = selected?.getBoundingClientRect?.() || null;
    const visibleWidth = box ? Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0)) : 0;
    const visibleHeight = box ? Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) : 0;
    return {
      runtimeNodeCount: Number(state.nodeCount || 0),
      relationCount: Number(state.parentedNodeCount || 0),
      domNodeCount: document.querySelectorAll('.flow-node').length,
      selectedNodeId: String(state.selectedNodeId || ''),
      selectedRendered: Boolean(selected),
      selectedVisibleRatio: box ? (visibleWidth * visibleHeight) / Math.max(1, box.width * box.height) : 0
    };
  })()`);

  const longTimelineCapture = await captureState(
    client,
    targetId,
    "performance-suite-500-message-timeline",
    `(async () => {
      window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
      window.__naimageDebugOpenSurface?.('agent-timeline');
      const messages = [];
      for (let index = 0; index < 400; index += 1) messages.push({ id: 'aidebug-performance-visual-message-' + (index + 1), role: index % 4 === 0 ? 'user' : 'assistant', content: '长时间线视觉证据消息 ' + (index + 1), status: 'done', meta: 'performance-long-timeline-visual' });
      for (let index = 0; index < 50; index += 1) {
        messages.push({ id: 'aidebug-performance-visual-tool-start-' + (index + 1), role: 'assistant', content: '准备执行工具 ' + (index + 1), status: 'done', toolTrace: { stage: 'start', label: '工具', name: 'image_gen', operation: '开始 ' + (index + 1), brief: '工具开始事件 ' + (index + 1) } });
        messages.push({ id: 'aidebug-performance-visual-tool-result-' + (index + 1), role: 'assistant', content: '工具执行完成 ' + (index + 1), status: 'done', toolTrace: { stage: 'result', label: '工具', name: 'image_gen', operation: '完成 ' + (index + 1), brief: '工具完成事件 ' + (index + 1), completionText: '工具执行完成' } });
      }
      const accepted = window.__naimageDebugSeedAgentMessages?.({ messages, append: false, maxMessages: 500 });
      const startedAt = Date.now();
      while (Date.now() - startedAt < 12000 && (Number(window.__naimageDebugAgentState?.().messageCount || 0) !== 500 || document.querySelectorAll('.project-agent-feed .agent-message').length !== 80)) await new Promise((resolve) => requestAnimationFrame(resolve));
      const feed = document.querySelector('.project-agent-feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (feed) feed.scrollTop = Number.MAX_SAFE_INTEGER;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { accepted };
    })()`,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentNodeCount: 0,
      agentMessageLayoutOk: true
    },
    45000,
    "overview"
  );
  const longTimelineObserved = await evaluate(client, `(() => {
    const feed = document.querySelector('.project-agent-feed');
    return {
      runtimeMessageCount: Number(window.__naimageDebugAgentState?.().messageCount || 0),
      domMessageCount: document.querySelectorAll('.project-agent-feed .agent-message').length,
      toolStartCount: document.querySelectorAll('.project-agent-feed .agent-tool-trace[data-tool-stage="start"]').length,
      toolCompleteCount: document.querySelectorAll('.project-agent-feed .agent-tool-trace[data-tool-stage="result"]').length,
      feedPresent: Boolean(feed),
      feedBottomGap: feed ? Math.max(0, feed.scrollHeight - feed.scrollTop - feed.clientHeight) : null
    };
  })()`);

  const streamingCapture = await captureState(
    client,
    targetId,
    "performance-suite-1000-delta-stream",
    `(async () => {
      window.__naimageDebugOpenSurface?.('agent-timeline');
      window.__naimageDebugSeedAgentMessages?.({ messages: [{ id: 'aidebug-performance-visual-stream', role: 'assistant', content: 'STREAM_BEGIN|', status: 'running', meta: 'performance-streaming-visual' }], append: false, maxMessages: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (let index = 1; index <= 1000; index += 1) {
        const delta = 'D' + String(index).padStart(4, '0') + (index === 1000 ? '|STREAM_END_1000' : '|');
        window.__naimageDebugSeedAgentMessages?.({ streamDelta: { id: 'aidebug-performance-visual-stream', delta, status: index === 1000 ? 'done' : 'running' } });
        if (index % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const startedAt = Date.now();
      while (Date.now() - startedAt < 12000 && !String(document.querySelector('.project-agent-feed .agent-message .markdown-body')?.textContent || '').includes('STREAM_END_1000')) await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 450));
      return true;
    })()`,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentNodeCount: 0,
      agentMessageLayoutOk: true
    },
    30000,
    "overview"
  );
  const streamingObserved = await evaluate(client, `(() => {
    const article = document.querySelector('.project-agent-feed .agent-message');
    const text = String(article?.querySelector('.markdown-body')?.textContent || '');
    const feed = document.querySelector('.project-agent-feed');
    const feedBottomGap = feed ? Math.max(0, feed.scrollHeight - feed.scrollTop - feed.clientHeight) : null;
    const feedBottomPadding = feed ? Number.parseFloat(getComputedStyle(feed).paddingBottom || '0') || 0 : 0;
    const expected = 'STREAM_BEGIN|' + Array.from({ length: 1000 }, (_, index) => 'D' + String(index + 1).padStart(4, '0') + (index === 999 ? '|STREAM_END_1000' : '|')).join('');
    return {
      runtimeMessageCount: Number(window.__naimageDebugAgentState?.().messageCount || 0),
      domMessageCount: document.querySelectorAll('.project-agent-feed .agent-message').length,
      payloadExactMatch: text === expected,
      expectedPayloadLength: expected.length,
      runtimePayloadLength: text.length,
      finalStatus: article?.classList.contains('done') ? 'done' : article?.classList.contains('running') ? 'running' : article?.classList.contains('error') ? 'error' : 'unknown',
      runningMessageCount: document.querySelectorAll('.project-agent-feed .agent-message.running').length,
      feedPresent: Boolean(feed),
      feedBottomGap,
      feedBottomPadding,
      feedContentBottomGap: feedBottomGap === null ? null : Math.max(0, feedBottomGap - feedBottomPadding)
    };
  })()`);

  const heapBeforeCleanup = await readRendererHeapUsage(client);
  const cleanupRendererMetrics = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrames = (count = 2) => new Promise((resolve) => {
      let remaining = Math.max(1, count);
      const step = () => { remaining -= 1; if (remaining <= 0) resolve(); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    const round = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : null;
    const supported = typeof PerformanceObserver === 'function' && Array.isArray(PerformanceObserver.supportedEntryTypes) && PerformanceObserver.supportedEntryTypes.includes('longtask');
    const entries = [];
    let observer = null;
    if (supported) {
      observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) entries.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' }); });
      observer.observe({ type: 'longtask', buffered: false });
    }
    window.__naimageAIDebug?.resetRenderCommits?.();
    const startedAt = performance.now();
    window.__naimageDebugApplyAgentActions?.([{ type: 'workflow.canvas.clear', mode: 'all' }]);
    window.__naimageDebugSeedAgentMessages?.({ clear: true });
    window.__naimageDebugOpenSurface?.('main');
    let waitOk = false;
    const waitStartedAt = performance.now();
    while (performance.now() - waitStartedAt < 15000) {
      const state = window.__naimageDebugAgentState?.() || {};
      if (Number(state.nodeCount || 0) === 0 && Number(state.messageCount || 0) === 0 && document.querySelectorAll('.flow-node').length === 0 && document.querySelectorAll('.project-agent-feed .agent-message').length === 0) { waitOk = true; break; }
      await nextFrames(1);
    }
    await nextFrames(8);
    await delay(120);
    if (observer) {
      for (const entry of observer.takeRecords()) entries.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' });
      observer.disconnect();
    }
    const endedAt = performance.now();
    const state = window.__naimageDebugAgentState?.() || {};
    const cleanupState = {
      ok: Boolean(waitOk && Number(state.nodeCount || 0) === 0 && Number(state.messageCount || 0) === 0 && document.querySelectorAll('.flow-node').length === 0 && document.querySelectorAll('.project-agent-feed .agent-message').length === 0 && document.querySelectorAll('.edge').length === 0 && Number(state.selectedNodeIds?.length || 0) === 0),
      waitOk,
      runtimeNodeCount: Number(state.nodeCount || 0),
      domNodeCount: document.querySelectorAll('.flow-node').length,
      runtimeMessageCount: Number(state.messageCount || 0),
      domMessageCount: document.querySelectorAll('.project-agent-feed .agent-message').length,
      edgeCount: document.querySelectorAll('.edge').length,
      selectedNodeCount: Number(state.selectedNodeIds?.length || 0),
      settledFrames: 8,
      settleMs: round(endedAt - waitStartedAt)
    };
    return {
      cleanupState,
      renderCommits: window.__naimageAIDebug?.renderCommits?.() || null,
      rendererMemory: performance.memory && Number.isFinite(Number(performance.memory.usedJSHeapSize)) ? { status: 'measured', source: 'renderer-performance-memory', usedBytes: Number(performance.memory.usedJSHeapSize), totalBytes: Number(performance.memory.totalJSHeapSize), limitBytes: Number(performance.memory.jsHeapSizeLimit) } : { status: 'unknown', reason: 'performance.memory is unavailable in this renderer' },
      phaseLongTask: supported ? {
        status: 'measured', source: 'performance-observer-longtask', startedAt: round(startedAt), endedAt: round(endedAt), durationMs: round(endedAt - startedAt),
        count: entries.length,
        totalDurationMs: round(entries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)),
        maxDurationMs: round(entries.length ? Math.max(...entries.map((entry) => Number(entry.duration || 0))) : 0),
        entries: entries.map((entry) => ({ ...entry, startTime: round(entry.startTime), duration: round(entry.duration) }))
      } : { status: 'unknown', reason: 'PerformanceObserver longtask entry type is unavailable in this renderer' }
    };
  })()`, 30000);
  if (rendererMetrics?.phaseLongTasks) rendererMetrics.phaseLongTasks.fixtureCleanup = cleanupRendererMetrics?.phaseLongTask || { status: "unknown", reason: "cleanup phase result missing" };
  if (rendererMetrics?.rendererMemorySamples) rendererMetrics.rendererMemorySamples.afterFixtureCleanupBeforeGc = cleanupRendererMetrics?.rendererMemory || null;
  for (const area of ["canvas", "agentFeed", "composer"]) {
    if (!rendererMetrics?.rendererCommits?.[area]) continue;
    rendererMetrics.rendererCommits[area].fixtureCleanup = Number(cleanupRendererMetrics?.renderCommits?.[area] ?? 0);
    if (!cleanupRendererMetrics?.renderCommits) {
      rendererMetrics.rendererCommits[area].status = "unknown";
      rendererMetrics.rendererCommits[area].reason = "fixture cleanup render commit probe unavailable";
    }
  }
  const garbageCollection = await collectRendererGarbage(client, 3);
  const heapAfterCleanup = await readRendererHeapUsage(client);
  const afterFixtureCleanup = heapBefore.status === "measured" && heapBeforeCleanup.status === "measured" && heapAfterCleanup.status === "measured" && garbageCollection.status === "measured" && cleanupRendererMetrics?.cleanupState?.ok
    ? {
        status: "measured",
        source: "cdp-runtime-get-heap-usage",
        baselineBeforeBytes: heapBefore.usedBytes,
        beforeCleanupBytes: heapBeforeCleanup.usedBytes,
        afterCleanupBytes: heapAfterCleanup.usedBytes,
        retainedDeltaBytes: heapAfterCleanup.usedBytes - heapBefore.usedBytes,
        reclaimedBytes: heapBeforeCleanup.usedBytes - heapAfterCleanup.usedBytes,
        garbageCollection,
        cleanupState: cleanupRendererMetrics.cleanupState,
        rendererMemoryBeforeGc: cleanupRendererMetrics.rendererMemory || null
      }
    : {
        status: "unknown",
        reason: [heapBefore.reason, heapBeforeCleanup.reason, heapAfterCleanup.reason, garbageCollection.reason, cleanupRendererMetrics?.cleanupState?.ok ? "" : "fixture cleanup state did not settle to zero"].filter(Boolean).join("; ") || "cleanup memory evidence unavailable",
        baselineBefore: heapBefore,
        beforeCleanup: heapBeforeCleanup,
        afterCleanup: heapAfterCleanup,
        garbageCollection,
        cleanupState: cleanupRendererMetrics?.cleanupState || null
      };

  const summarizeVisualCheckpoint = (capture, observed, truthOk) => {
    const overflowCount = Number(Boolean(capture?.overflow?.documentOverflowX)) + Number(Boolean(capture?.overflow?.bodyOverflowX)) + Number(capture?.overflow?.elementOverflowX?.length || 0);
    const screenshotSource = String(capture?.screenshotSource || "");
    const ok = Boolean(
      truthOk && capture?.visualReliability?.ok && capture?.dualFrameReport?.ok && capture?.stateStabilityReport?.ok &&
      screenshotSource.startsWith("cdp") && capture?.screenshotEvidence?.sha256 && Number(capture?.screenshotEvidence?.byteLength || 0) > 0 &&
      Number(capture?.stateIssues?.length || 0) === 0 && Number(capture?.captureIssues?.length || 0) === 0 && overflowCount === 0
    );
    return {
      status: ok ? "measured" : "unknown",
      reason: ok ? "" : "real screenshot, dual-frame stability, GUI visual reliability, state truth, or fixture counts were incomplete",
      label: capture?.label || "",
      path: capture?.screenshotPath || "",
      screenshotSource,
      screenshotBytes: Number(capture?.screenshotEvidence?.byteLength || 0),
      screenshotSha256: capture?.screenshotEvidence?.sha256 || "",
      dualFrameStable: Boolean(capture?.dualFrameReport?.ok),
      stateStable: Boolean(capture?.stateStabilityReport?.ok),
      visualReliabilityOk: Boolean(capture?.visualReliability?.ok),
      stateIssueCount: Number(capture?.stateIssues?.length || 0),
      captureIssueCount: Number(capture?.captureIssues?.length || 0),
      overflowCount,
      observed
    };
  };
  const visualCheckpoints = {
    imageContainer10: summarizeVisualCheckpoint(containerCapture, containerObserved, Number(containerObserved?.runtimeNodeCount) === 1 && Number(containerObserved?.renderedImageCount) === 10 && Number(containerObserved?.loadedImageCount) === 10),
    nodes1000: summarizeVisualCheckpoint(nodes1000Capture, nodes1000Observed, Number(nodes1000Observed?.runtimeNodeCount) === 1000 && Number(nodes1000Observed?.relationCount) === 199 && Number(nodes1000Observed?.domNodeCount) > 0 && nodes1000Observed?.selectedNodeId === "aidebug-performance-visual-node-1000" && nodes1000Observed?.selectedRendered === true && Number(nodes1000Observed?.selectedVisibleRatio) > 0.9),
    longTimeline: summarizeVisualCheckpoint(longTimelineCapture, longTimelineObserved, Number(longTimelineObserved?.runtimeMessageCount) === 500 && Number(longTimelineObserved?.domMessageCount) === 80 && Number(longTimelineObserved?.toolStartCount) === 40 && Number(longTimelineObserved?.toolCompleteCount) === 40 && longTimelineObserved?.feedPresent === true && Number(longTimelineObserved?.feedBottomGap) <= 2),
    streamingTimeline: summarizeVisualCheckpoint(streamingCapture, streamingObserved, Number(streamingObserved?.runtimeMessageCount) === 1 && Number(streamingObserved?.domMessageCount) === 1 && streamingObserved?.payloadExactMatch === true && streamingObserved?.finalStatus === "done" && Number(streamingObserved?.runningMessageCount) === 0 && streamingObserved?.feedPresent === true && Number(streamingObserved?.feedContentBottomGap) <= 2)
  };
  const requiredPhaseNames = ["nodes200", "interactions", "nodes1000", "longTimeline", "streamingTimeline", "imageContainer10", "fixtureCleanup"];
  const phaseSupport = rendererMetrics?.phaseLongTasks?.support;
  const phaseLongTasksOk = phaseSupport?.status === "measured" && typeof phaseSupport?.supported === "boolean" && requiredPhaseNames.every((name) => phaseSupport.supported ? rendererMetrics?.phaseLongTasks?.[name]?.status === "measured" : rendererMetrics?.phaseLongTasks?.[name]?.status === "unknown" && Boolean(rendererMetrics?.phaseLongTasks?.[name]?.reason));
  const phaseLongTasksMetric = { status: phaseLongTasksOk ? "measured" : "unknown", reason: phaseLongTasksOk ? "" : "required phase-level Long Task evidence is incomplete" };
  const coldStart = startupPerformance
    ? { status: "measured", ...startupPerformance }
    : { status: "unknown", reason: "startup timing was not initialized" };
  const mandatory = [
    ["coldStart", coldStart],
    ["nodes200", rendererMetrics?.nodes200],
    ["nodes1000", rendererMetrics?.nodes1000],
    ["longTimeline", rendererMetrics?.longTimeline],
    ["streamingTimeline", rendererMetrics?.streamingTimeline],
    ["imageContainer10", rendererMetrics?.imageContainer10],
    ["visual.imageContainer10", visualCheckpoints.imageContainer10],
    ["visual.nodes1000", visualCheckpoints.nodes1000],
    ["visual.longTimeline", visualCheckpoints.longTimeline],
    ["visual.streamingTimeline", visualCheckpoints.streamingTimeline],
    ["memory.afterFixtureCleanup", afterFixtureCleanup],
    ["phaseLongTasks", phaseLongTasksMetric],
    ["pan", rendererMetrics?.interactions?.pan],
    ["zoom", rendererMetrics?.interactions?.zoom],
    ["drag", rendererMetrics?.interactions?.drag],
    ["largeProject", rendererMetrics?.persistence?.largeProject],
    ["save", rendererMetrics?.save]
  ].map(([name, metric]) => ({ name, status: metric?.status || "missing", effectObserved: metric?.effectObserved, reason: metric?.reason || "" }));
  const mandatoryOk = mandatory.every((item) => item.status === "measured") && ["pan", "zoom", "drag"].every((name) => mandatory.find((item) => item.name === name)?.effectObserved === true);
  const optional = [
    { name: "longTasks", status: rendererMetrics?.longTasks?.status || "missing", reason: rendererMetrics?.longTasks?.reason || "" },
    { name: "jsHeap", status: jsHeap.status, reason: jsHeap.reason || "" }
  ];
  const optionalExplicit = optional.every((item) => item.status === "measured" || (item.status === "unknown" && Boolean(item.reason)));
  const knownGaps = ["writeCount", "coalescedWriteCount", "flushMs"]
    .filter((key) => !Number.isFinite(Number(rendererMetrics?.persistence?.[key])))
    .map((key) => `persistence.${key}`);
  const evidenceQuality = {
    ok: mandatoryOk && optionalExplicit,
    status: mandatoryOk && optionalExplicit ? (knownGaps.length > 0 || optional.some((item) => item.status !== "measured") ? "partial" : "complete") : "invalid",
    coverage: mandatoryOk && optionalExplicit && knownGaps.length > 0 ? "fixture-complete-with-known-gaps" : mandatoryOk && optionalExplicit ? "fixture-complete" : "incomplete",
    truthContractReady: mandatoryOk && optionalExplicit && knownGaps.length === 0,
    productPerformanceReady: false,
    mandatory,
    optional,
    knownGaps,
    missing: [...mandatory.filter((item) => item.status !== "measured").map((item) => item.name), ...optional.filter((item) => item.status === "missing").map((item) => item.name)],
    note: "Development AIDebug evidence only. Green means the fixture truth contract and real screenshots agree; it does not assert production performance budgets."
  };
  const performance = {
    schemaVersion: 2,
    baselineOnly: true,
    productPerformanceReady: false,
    environment: { profile: "development", fullAidebugControlPlane: true },
    coldStart,
    fixtures: {
      nodes200: rendererMetrics?.nodes200 || null,
      nodes1000: rendererMetrics?.nodes1000 || null,
      longTimeline: rendererMetrics?.longTimeline || null,
      streamingTimeline: rendererMetrics?.streamingTimeline || null,
      imageContainer10: imageContainerMetric,
      imageThumbnailCold,
      imageThumbnailWarm
    },
    visualCheckpoints,
    interactions: rendererMetrics?.interactions || null,
    rendererCommits: rendererMetrics?.rendererCommits || null,
    imagePipeline,
    longTasks: rendererMetrics?.longTasks || { status: "unknown", reason: "renderer result missing" },
    phaseLongTasks: rendererMetrics?.phaseLongTasks || null,
    jsHeap,
    memory: { afterFixtureCleanup },
    persistence: rendererMetrics?.persistence || null,
    save: rendererMetrics?.save || null,
    knownGaps,
    evidenceQuality
  };
  const performancePath = join(runDir, "performance-baseline.json");
  writeFileSync(performancePath, JSON.stringify(performance, null, 2));
  const captures = [containerCapture, nodes1000Capture, longTimelineCapture, streamingCapture];
  for (const capture of captures) {
    capture.suite = {
      ok: evidenceQuality.ok,
      performancePath,
      evidenceQuality,
      issues: evidenceQuality.ok ? [] : [{ area: "performance-evidence", message: "Mandatory performance/visual truth evidence is missing or an interaction had no observed effect.", detail: evidenceQuality }]
    };
  };
  return captures.map((capture, index) => index === 0 ? { ...capture, performance, performancePath } : capture);
}
