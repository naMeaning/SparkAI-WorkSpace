import {
  analyzeLayerVisualContribution,
  analyzeTransparentLayerAlphaOverlap,
  extractPreviewLayerFromMaskToDataUrl,
  imageAssetCanvasSrc,
  loadImageForCanvas,
  removeConnectedBorderBackgroundToDataUrl,
  repairLayerCoverageFromPreview,
  type ImageLayerComposition,
} from "./core";
import { normalizeTransparentLayerAlphaExclusivity } from "./layer-alpha-normalization";

declare const __IIIMAGE_AIDEBUG__: boolean;

export class LayerCompositionPreparationError extends Error {
  readonly recoverable = true;

  constructor(
    message: string,
    readonly partialComposition: ImageLayerComposition,
    readonly failedLayerIds: string[],
    readonly successfulLayerIds: string[],
    readonly stage: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LayerCompositionPreparationError";
  }
}

export function isLayerCompositionPreparationError(error: unknown): error is LayerCompositionPreparationError {
  return error instanceof LayerCompositionPreparationError || Boolean(
    error && typeof error === "object" &&
    (error as { name?: unknown }).name === "LayerCompositionPreparationError" &&
    (error as { recoverable?: unknown }).recoverable === true &&
    (error as { partialComposition?: unknown }).partialComposition
  );
}

export async function prepareLayerCompositionAssets(composition: ImageLayerComposition, projectId: string): Promise<ImageLayerComposition> {
    const groupLabel = composition.groupNumber
      ? `group-${String(composition.groupNumber).padStart(3, "0")}`
      : composition.id || `group-${Date.now()}`;
    const subdir = `layers/${groupLabel}`;
    const saveLayerDataUrl = async (dataUrl: string, stem: string, runId: string) => {
      if (!window.iiimageConfig?.saveOutputImage) throw new Error("项目图片库不可用，无法保存独立 PNG 图层。");
      const saved = await window.iiimageConfig.saveOutputImage({
        dataUrl,
        stem,
        runId,
        projectId,
        bucket: "imagegen",
        subdir
      });
      if (!saved.ok || !saved.asset) throw new Error(saved.error || `无法保存图层 ${stem}。`);
      return saved.asset;
    };
    const fitToCompositionSize = async (dataUrl: string) => {
      const image = await loadImageForCanvas(dataUrl);
      if (image.naturalWidth === composition.width && image.naturalHeight === composition.height) return dataUrl;
      const canvas = document.createElement("canvas");
      canvas.width = composition.width;
      canvas.height = composition.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器环境不支持统一图层尺寸。");
      context.clearRect(0, 0, composition.width, composition.height);
      context.drawImage(image, 0, 0, composition.width, composition.height);
      return canvas.toDataURL("image/png");
    };

    let previewAsset = composition.previewAsset ? { ...composition.previewAsset } : undefined;
    let previewDataUrl = "";
    if (previewAsset) {
      previewDataUrl = await fitToCompositionSize(await imageAssetCanvasSrc(previewAsset));
      const reusesPreparedLayers = composition.layers.some((layer) => layer.extractionMode === "prepared");
      previewAsset = reusesPreparedLayers && previewAsset.path
        ? {
            ...previewAsset,
            index: 1,
            title: "合成预览",
            prompt: previewAsset.prompt || previewAsset.revisedPrompt
          }
        : {
            ...(await saveLayerDataUrl(previewDataUrl, "00-preview", `${composition.id}-preview`)),
            index: 1,
            title: "合成预览",
            prompt: previewAsset.prompt || previewAsset.revisedPrompt
          };
    }

    const transparencyReports: Array<{
      id: string;
      role: string;
      transparentRatio: number;
      visibleRatio: number;
      remainingChromaRatio: number;
      removedPixels: number;
      usedExistingAlpha: boolean;
      maskContrast?: number;
      maskColorRatio?: number;
      maskTransparentRatio?: number;
      maskMidtoneRatio?: number;
      inputMode?: "semantic-mask" | "transparent-layer" | "isolated-color-plate" | "unsupported-color";
      borderMatchRatio?: number;
      alignmentX?: number;
      alignmentY?: number;
      alignmentImprovement?: number;
      solidified?: boolean;
      textRefined?: boolean;
      semanticRemovedRatio?: number;
    }> = [];
    const preparedLayers: Array<{
      layer: ImageLayerComposition["layers"][number];
      index: number;
      role: string;
      isBackground: boolean;
      runId: string;
      dataUrl: string;
      minimumVisibleRatio: number;
      isPrepared: boolean;
      semanticRefined?: boolean;
      lockGeometry?: boolean;
    }> = [];
    const throwRecoverableFailure = async (
      message: string,
      failedLayerIds: string[],
      stage: string,
      detail?: Record<string, unknown>,
    ): Promise<never> => {
      const failed = new Set(failedLayerIds);
      const layers = await Promise.all(preparedLayers.map(async ({ layer, index, role, runId, dataUrl, isPrepared }) => {
        let asset;
        if (isPrepared && layer.asset) {
          asset = { ...layer.asset };
        } else {
          try {
            asset = await saveLayerDataUrl(dataUrl, `${String(index + 1).padStart(2, "0")}-${role}-${layer.id}`, `${runId}-recoverable`);
          } catch {
            asset = { index: index + 1, type: "url" as const, url: dataUrl, assetUrl: dataUrl, runId: `${runId}-recoverable` };
          }
        }
        return {
          ...layer,
          groupId: layer.groupId || composition.id,
          order: Number(layer.order ?? index + 1),
          width: composition.width,
          height: composition.height,
          asset: {
            ...asset,
            index: index + 1,
            title: layer.title || `图层 ${index + 1}`,
            prompt: layer.prompt,
            status: failed.has(layer.id) ? "error" as const : "done" as const,
          },
        };
      }));
      throw new LayerCompositionPreparationError(
        message,
        { ...composition, previewAsset, layers },
        failedLayerIds,
        layers.map((layer) => layer.id).filter((id) => !failed.has(id)),
        stage,
        detail,
      );
    };
    for (let index = 0; index < composition.layers.length; index += 1) {
      const layer = composition.layers[index];
      if (!layer.asset) throw new Error(`图层 ${layer.title || layer.id} 缺少图片资产。`);
      const role = String(layer.role || "other");
      const isBackground = role === "background";
      const isPrepared = layer.extractionMode === "prepared";
      const runId = `${composition.id}-${String(index + 1).padStart(2, "0")}-${layer.id}`;
      let dataUrl = await imageAssetCanvasSrc(layer.asset);
      let lockGeometry = false;
      if (!isBackground && !isPrepared) {
        const extracted = layer.extractionMode === "mask-from-preview"
          ? await extractPreviewLayerFromMaskToDataUrl(
              previewDataUrl || await imageAssetCanvasSrc(composition.previewAsset!),
              dataUrl,
              {
                width: composition.width,
                height: composition.height,
                alignment: role === "text" ? "luminance" : "none",
                solidify: role === "decoration" || role === "text",
                solidifyPasses: 1,
                fillNarrowGaps: 0,
                refineText: role === "text"
              }
            )
          : null;
        const isolated: {
          dataUrl: string;
          transparentRatio: number;
          visibleRatio: number;
          remainingChromaRatio: number;
          removedPixels: number;
          usedExistingAlpha: boolean;
          checkerboardDetected?: boolean;
          checkerboardSuspiciousRemovedPixels?: number;
        } = extracted ?? await removeConnectedBorderBackgroundToDataUrl(layer.asset, {
              width: composition.width,
              height: composition.height
            });
        if (isolated.transparentRatio < 0.04) {
          throw new Error(`图层「${layer.title || layer.id}」未形成可靠透明区域，已停止以避免伪分层。`);
        }
        const minimumVisibleRatio = role === "text" ? 0.001 : role === "shadow" ? 0.002 : 0.005;
        if (isolated.visibleRatio < minimumVisibleRatio) {
          throw new Error(`图层「${layer.title || layer.id}」有效内容过少，已停止以避免创建空图层。`);
        }
        if (isolated.remainingChromaRatio > 0.002) {
          throw new Error(`图层「${layer.title || layer.id}」仍残留明显品红色键，已停止以避免污染重组图。`);
        }
        if (isolated.checkerboardDetected && Number(isolated.checkerboardSuspiciousRemovedPixels || 0) > 0) {
          throw new Error(`图层「${layer.title || layer.id}」的棋盘透明提取可能误伤主体，已停止提交损坏图层。`);
        }
        if (extracted) {
          const maximumVisibleRatio = role === "text"
            ? 0.35
            : role === "decoration"
              ? 0.65
              : role === "subject"
                ? 0.82
                : 0.9;
          if (extracted.visibleRatio > maximumVisibleRatio) {
            throw new Error(`图层「${layer.title || layer.id}」蒙版覆盖范围异常（${Math.round(extracted.visibleRatio * 100)}%），已停止以避免把整张图误作单层。`);
          }
          if (extracted.partialRatio > 0.35) {
            throw new Error(`图层「${layer.title || layer.id}」蒙版边缘过度灰化，已停止以避免棋盘格或虚假透明。`);
          }
          // Sparse captions need one high-confidence transform before their
          // preview pixels are extracted.  Once aligned, a second semantic
          // rescale can only discard glyph strokes that are no longer present
          // in the already-clipped RGBA layer, so keep its geometry immutable.
          lockGeometry = role === "text" && extracted.visibleRatio < 0.003;
        }
        dataUrl = isolated.dataUrl;
        transparencyReports.push({
          id: layer.id,
          role,
          transparentRatio: isolated.transparentRatio,
          visibleRatio: isolated.visibleRatio,
          remainingChromaRatio: isolated.remainingChromaRatio,
          removedPixels: isolated.removedPixels,
          usedExistingAlpha: isolated.usedExistingAlpha,
          maskContrast: extracted?.maskContrast,
          maskColorRatio: extracted?.maskColorRatio,
          maskTransparentRatio: extracted?.maskTransparentRatio,
          maskMidtoneRatio: extracted?.maskMidtoneRatio,
          inputMode: extracted?.inputMode,
          borderMatchRatio: extracted?.borderMatchRatio,
          alignmentX: extracted?.alignmentX,
          alignmentY: extracted?.alignmentY,
          alignmentImprovement: extracted?.alignmentImprovement,
          solidified: extracted?.solidified,
          textRefined: extracted?.textRefined
        });
      } else {
        dataUrl = await fitToCompositionSize(dataUrl);
      }
      preparedLayers.push({
        layer,
        index,
        role,
        isBackground,
        runId,
        dataUrl,
        minimumVisibleRatio: role === "text" ? 0.001 : role === "shadow" ? 0.002 : 0.005,
        isPrepared,
        semanticRefined: !isBackground && (layer.extractionMode === "direct" || isPrepared),
        lockGeometry: lockGeometry || isPrepared
      });
    }
    const transparentPrepared = preparedLayers.filter((item) => !item.isBackground);
    const backgroundPrepared = preparedLayers.find((item) => item.isBackground);
    const directPrepared = transparentPrepared.filter((item) => item.layer.extractionMode === "direct");
    const maskPrepared = transparentPrepared.filter((item) => item.layer.extractionMode === "mask-from-preview");
    const reusedPrepared = transparentPrepared.filter((item) => item.layer.extractionMode === "prepared");
    const directSubjectPrepared = directPrepared.filter((item) => item.role === "subject");
    // A native transparent/checkerboard subject is still a model
    // reconstruction, not authoritative semantic isolation.  Re-run aligned
    // subjects through the preview/background matte together with the
    // foreground/text masks.  Other direct assets remain geometry-locked in
    // this pass so they can block duplicated product/text pixels without being
    // aligned for a second time.
    const semanticPrepared = [...maskPrepared, ...directSubjectPrepared, ...directPrepared.filter((item) => item.role !== "subject")];
    const subjectPrepared = semanticPrepared.filter((item) => item.role === "subject");
    const refineSemanticLayers = window.iiimageConfig?.refineSemanticLayers;
    if (previewDataUrl && backgroundPrepared && directPrepared.length) {
      if (!refineSemanticLayers) throw new Error("透明图层对齐服务不可用，已停止提交未经验证的独立图层。");
      const aligned = await refineSemanticLayers({
        mode: "direct-alignment",
        width: composition.width,
        height: composition.height,
        previewSource: previewDataUrl,
        backgroundSource: backgroundPrepared.dataUrl,
        layers: directPrepared.map((item) => ({ id: item.layer.id, role: item.role, source: item.dataUrl }))
      });
      if (!aligned.ok || !Array.isArray(aligned.layers)) throw new Error(aligned.error || "透明图层自动对齐失败，已停止提交错位图层。");
      const reportById = new Map((aligned.reports || []).map((report) => [report.id, report]));
      const rejected = directPrepared.find((item) => reportById.get(item.layer.id)?.accepted !== true);
      if (rejected) throw new Error(`独立图层「${rejected.layer.title || rejected.layer.id}」无法可靠对齐合成画面，已停止提交。`);
      const alignedById = new Map(aligned.layers.map((item) => [item.id, item.source]));
      for (const prepared of directPrepared) {
        prepared.dataUrl = alignedById.get(prepared.layer.id) || prepared.dataUrl;
        const report = reportById.get(prepared.layer.id);
        const transparencyReport = transparencyReports.find((item) => item.id === prepared.layer.id);
        if (report && transparencyReport) {
          transparencyReport.alignmentX = report.alignmentX;
          transparencyReport.alignmentY = report.alignmentY;
          transparencyReport.alignmentImprovement = report.alignmentImprovement;
        }
      }
    }
    if (previewDataUrl && backgroundPrepared && semanticPrepared.length) {
      if (!refineSemanticLayers) {
        throw new Error("语义蒙版细化服务不可用，已停止提交未经验证的主体图层。");
      }
      const refined = await refineSemanticLayers({
        width: composition.width,
        height: composition.height,
        previewSource: previewDataUrl,
        backgroundSource: backgroundPrepared.dataUrl,
        layers: semanticPrepared.map((item) => ({
          id: item.layer.id,
          role: item.role,
          source: item.dataUrl,
          preserveGeometry: item.lockGeometry === true || (item.layer.extractionMode === "direct" && item.role !== "subject"),
          directSubjectSeed: item.layer.extractionMode === "direct" && item.role === "subject"
        }))
      });
      if (!refined.ok || !Array.isArray(refined.layers)) {
        throw new Error(refined.error || "语义蒙版细化失败，已停止提交低质量分层结果。");
      }
      const reportById = new Map((refined.reports || []).map((report) => [report.id, report]));
      const rejectedSubject = subjectPrepared.find((item) => reportById.get(item.layer.id)?.accepted !== true);
      if (rejectedSubject) {
        const report = reportById.get(rejectedSubject.layer.id);
        throw new Error(`主体图层「${rejectedSubject.layer.title || rejectedSubject.layer.id}」未通过语义细化（${report?.reason || "结果不可确认"}），已停止提交。`);
      }
      const damagedLockedText = semanticPrepared.find((item) => {
        return item.lockGeometry && reportById.get(item.layer.id)?.geometryPreserved !== true;
      });
      if (damagedLockedText) {
        throw new Error(`小字「${damagedLockedText.layer.title || damagedLockedText.layer.id}」异常，停止。`);
      }
      const refinedById = new Map(refined.layers.map((item) => [item.id, item.source]));
      for (const prepared of semanticPrepared) {
        const source = refinedById.get(prepared.layer.id);
        if (source) {
          prepared.dataUrl = source;
          prepared.semanticRefined = true;
        }
        const report = reportById.get(prepared.layer.id);
        const transparencyReport = transparencyReports.find((item) => item.id === prepared.layer.id);
        if (report?.outputVisiblePixels !== undefined && transparencyReport) {
          const visibleRatio = report.outputVisiblePixels / Math.max(1, composition.width * composition.height);
          transparencyReport.visibleRatio = visibleRatio;
          transparencyReport.transparentRatio = 1 - visibleRatio;
        }
      }
    }
    const rawOverlapSources = transparentPrepared.map((item) => ({ id: item.layer.id, role: item.role, source: item.dataUrl }));
    const directLayerIds = new Set(transparentPrepared.filter((item) => item.layer.extractionMode === "direct" || item.layer.extractionMode === "prepared").map((item) => item.layer.id));
    const rawOverlapReport = rawOverlapSources.length > 1
      ? await analyzeTransparentLayerAlphaOverlap(rawOverlapSources, { width: composition.width, height: composition.height })
      : { width: composition.width, height: composition.height, layers: [], pairs: [] };
    if (rawOverlapSources.length > 1) {
      const normalized = await normalizeTransparentLayerAlphaExclusivity(rawOverlapSources, {
        width: composition.width,
        height: composition.height
      });
      const normalizedById = new Map(normalized.layers.map((item) => [item.id, item]));
      for (const prepared of transparentPrepared) {
        const normalizedLayer = normalizedById.get(prepared.layer.id);
        if (!normalizedLayer) throw new Error(`图层「${prepared.layer.title || prepared.layer.id}」缺少像素归属结果。`);
        if (prepared.layer.extractionMode === "prepared") continue;
        if (normalizedLayer.visibleRatio < prepared.minimumVisibleRatio) {
          throw new Error(`图层「${prepared.layer.title || prepared.layer.id}」在语义去重后已无有效内容，已停止创建重复或空图层。`);
        }
        if (normalizedLayer.removedRatio > 0.9) {
          throw new Error(`图层「${prepared.layer.title || prepared.layer.id}」超过 90% 内容与更上层重复，已停止创建伪独立图层。`);
        }
        prepared.dataUrl = normalizedLayer.source;
        const report = transparencyReports.find((item) => item.id === prepared.layer.id);
        if (report) {
          report.visibleRatio = normalizedLayer.visibleRatio;
          report.transparentRatio = 1 - normalizedLayer.visibleRatio;
          report.semanticRemovedRatio = normalizedLayer.removedRatio;
        }
      }
    }
    if (previewDataUrl && backgroundPrepared && transparentPrepared.length) {
      const repaired = await repairLayerCoverageFromPreview(
        previewDataUrl,
        backgroundPrepared.dataUrl,
        transparentPrepared.map((item) => ({
          id: item.layer.id,
          role: item.role,
          source: item.dataUrl,
          semanticRefined: item.semanticRefined === true
        })),
        { width: composition.width, height: composition.height }
      );
      // Direct subject/product renders are independent reconstructions, so
      // pixel-perfect preview coverage is neither possible nor desirable.
      // They still need a bounded hybrid residual, while mask-only stacks keep
      // the stricter exact-recomposition requirement.
      const residualLimit = directPrepared.length || reusedPrepared.length ? 0.22 : 0.3;
      const forcedResidualRatio = __IIIMAGE_AIDEBUG__
        ? Math.min(1, Math.max(0, Number((window as unknown as { __iiimageDebugLayerCoverageFailure?: number }).__iiimageDebugLayerCoverageFailure || 0)))
        : 0;
      const residualRatio = Math.max(repaired.residualRatio, forcedResidualRatio);
      if (residualRatio > residualLimit) {
        await throwRecoverableFailure(
          `图层覆盖缺失达到 ${Math.round(residualRatio * 100)}%，已保留现有图层并等待定向修复。`,
          transparentPrepared.map((item) => item.layer.id),
          "coverage",
          {
            residualRatio,
            measuredResidualRatio: repaired.residualRatio,
            residualLimit,
            assignments: repaired.assignments,
          },
        );
      }
      const repairedById = new Map(repaired.layers.map((item) => [item.id, item.source]));
      for (const prepared of transparentPrepared) {
        if (prepared.layer.extractionMode !== "prepared") prepared.dataUrl = repairedById.get(prepared.layer.id) || prepared.dataUrl;
      }
    }
    const normalizedOverlapSources = transparentPrepared.map((item) => ({ id: item.layer.id, role: item.role, source: item.dataUrl }));
    const overlapReport = normalizedOverlapSources.length > 1
      ? await analyzeTransparentLayerAlphaOverlap(normalizedOverlapSources, { width: composition.width, height: composition.height })
      : { width: composition.width, height: composition.height, layers: [], pairs: [] };
    const severeOverlapPairs = overlapReport.pairs.filter((pair) =>
      !directLayerIds.has(pair.leftId) && !directLayerIds.has(pair.rightId) &&
      pair.canvasRatio > 0.0002 && pair.smallerLayerRatio > 0.25
    );
    if (severeOverlapPairs.length) {
      const detail = severeOverlapPairs
        .slice(0, 3)
        .map((pair) => `${pair.leftId}/${pair.rightId} ${Math.round(pair.smallerLayerRatio * 100)}%`)
        .join("、");
      throw new Error(`分层像素归属处理后仍存在明显重复（${detail}），已停止提交错误图层。`);
    }
    const contributionReport = backgroundPrepared && normalizedOverlapSources.length
      ? await analyzeLayerVisualContribution(backgroundPrepared.dataUrl, normalizedOverlapSources, {
          width: composition.width,
          height: composition.height
        })
      : { width: composition.width, height: composition.height, reports: [] };
    const weakContribution = contributionReport.reports.filter((report) => {
      const prepared = transparentPrepared.find((item) => item.layer.id === report.id);
      const isTitle = Boolean(prepared && /title|heading|headline|主标题/i.test(`${prepared.layer.id} ${prepared.layer.title || ""}`));
      if (isTitle) return report.strongContrastRatio < 0.45 || report.meanContrast < 24;
      if (report.role === "text") return report.strongContrastRatio < 0.18 || report.meanContrast < 14;
      if (report.role === "subject" || report.role === "decoration") return report.strongContrastRatio < 0.2 || report.meanContrast < 14;
      return report.strongContrastRatio < 0.1 || report.meanContrast < 8;
    });
    if (weakContribution.length) {
      const detail = weakContribution
        .map((report) => `${report.id} 有效对比 ${Math.round(report.strongContrastRatio * 100)}%`)
        .join("、");
      throw new Error(`图层蒙版与合成预览未准确对齐（${detail}），已停止提交暗层、缺笔文字或背景伪层。`);
    }
    const layers = [] as ImageLayerComposition["layers"];
    for (const prepared of preparedLayers) {
      const { layer, index, role, runId, dataUrl, isPrepared } = prepared;
      const savedAsset = isPrepared && layer.asset
        ? { ...layer.asset }
        : await saveLayerDataUrl(
            dataUrl,
            `${String(index + 1).padStart(2, "0")}-${role}-${layer.id}`,
            runId
          );
      layers.push({
        ...layer,
        groupId: layer.groupId || composition.id,
        order: Number(layer.order ?? index + 1),
        x: Number(layer.x ?? 0),
        y: Number(layer.y ?? 0),
        homeX: Number(layer.homeX ?? layer.x ?? 0),
        homeY: Number(layer.homeY ?? layer.y ?? 0),
        width: composition.width,
        height: composition.height,
        asset: {
          ...savedAsset,
          index: index + 1,
          title: layer.title || `图层 ${index + 1}`,
          prompt: layer.prompt,
          status: "done"
        }
      });
    }
    const maximumRawOverlap = rawOverlapReport.pairs.reduce((maximum, pair) => Math.max(maximum, pair.smallerLayerRatio), 0);
    const maximumOverlap = overlapReport.pairs.reduce((maximum, pair) => Math.max(maximum, pair.smallerLayerRatio), 0);
    const minimumContribution = contributionReport.reports.reduce((minimum, report) => Math.min(minimum, report.strongContrastRatio), 1);
    const transparencySummary = transparencyReports.length
      ? `透明图层 ${transparencyReports.length} 个，透明像素比例 ${transparencyReports.map((item) => `${item.id}:${Math.round(item.transparentRatio * 100)}%`).join("、")}，语义交叠 ${Math.round(maximumRawOverlap * 100)}%→${Math.round(maximumOverlap * 100)}%，最低有效对比 ${Math.round(minimumContribution * 100)}%`
      : "仅背景图层";
    return {
      ...composition,
      layout: composition.layout === "exploded" ? "exploded" : "stacked",
      previewAsset,
      layers,
      summary: [`已生成并重组 ${layers.length} 个独立 PNG 图层。`, transparencySummary].filter(Boolean).join("；")
    };
  }
