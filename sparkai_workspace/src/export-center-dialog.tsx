import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileImage,
  FolderArchive,
  History,
  Layers3,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

import type {
  ExportCenterFormat,
  ExportCenterHistoryEntry,
  ExportCenterState,
  ExportCenterTarget,
  ExportConflictPolicy,
  ImageAsset,
  ImageAssetExportResult,
  ImageCollectionRole,
  ImageExportFormat,
} from "./core";
import { imageAssetSrc } from "./core";
import { cleanExportFilenamePart as cleanFilenamePart, exportFilenameTemplateError as templateError, renderExportFilename } from "../runtime/image-export-naming.mjs";
import {
  ActionButton,
  DialogShell,
  Field,
  IconActionButton,
  InlineNotice,
  SegmentButton,
  SegmentedControl,
  StatusLine,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
} from "./ui";
import "./styles/04j-export-center-dialog.css";

export type ExportCenterImageSource = {
  key: string;
  nodeId: string;
  assetIndex: number;
  title: string;
  groupName?: string;
  asset: ImageAsset;
};

export type ExportCenterCollectionSource = {
  key: string;
  nodeId: string;
  collectionId: string;
  title: string;
  imageCount: number;
  role: ImageCollectionRole;
};

export type ExportCenterPsdSource = {
  key: string;
  nodeId: string;
  kind: "asset" | "layer-group";
  assetIndex?: number;
  title: string;
  layerCount?: number;
};

export type ExportCenterInitialSelection = {
  target: ExportCenterTarget;
  keys: string[];
};

type ExportCenterSource = ExportCenterImageSource | ExportCenterCollectionSource | ExportCenterPsdSource;
type ExportCenterView = "setup" | "queue" | "history";
type QueueStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled" | "interrupted";

type ExportConfig = {
  target: ExportCenterTarget;
  container: "folder" | "zip";
  format: ExportCenterFormat;
  filenameTemplate: string;
  conflictPolicy: ExportConflictPolicy;
  incremental: boolean;
  authorizationId?: string;
  destinationLabel?: string;
};

type ExportQueueJob = {
  id: string;
  queueId?: string;
  label: string;
  config: ExportConfig;
  total: number;
  status: QueueStatus;
  progress: number;
  exportedCount: number;
  skippedCount: number;
  totalBytes: number;
  relativePaths: string[];
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  error?: string;
};

export type ExportCenterDialogProps = {
  projectId: string;
  images: ExportCenterImageSource[];
  collections: ExportCenterCollectionSource[];
  psdItems: ExportCenterPsdSource[];
  initialSelection?: ExportCenterInitialSelection;
  close: () => void;
  prepareProject: () => Promise<void>;
  exportPsd: (source: ExportCenterPsdSource, suggestedName: string) => Promise<ImageAssetExportResult>;
  onCompleted?: (message: string) => void;
};

const IMAGE_FORMATS: Array<{ value: ImageExportFormat; label: string }> = [
  { value: "original", label: "原文件 · 原尺寸" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
  { value: "tiff", label: "TIFF" },
];

const EMPTY_STATE: ExportCenterState = {
  format: "sparkai-export-center",
  version: 1,
  updatedAt: "",
  presets: [],
  history: [],
};

const DEFAULT_CONFIG: ExportConfig = {
  target: "image",
  container: "folder",
  format: "original",
  filenameTemplate: "{title}-{index}",
  conflictPolicy: "keep-both",
  incremental: false,
};

const TARGET_LABELS: Record<ExportCenterTarget, string> = {
  image: "图片",
  collection: "图片组",
  psd: "PSD",
};

const STATUS_LABELS: Record<QueueStatus, string> = {
  queued: "排队中",
  running: "导出中",
  succeeded: "已完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
  interrupted: "已中断",
};

function formatBytes(value: number | undefined) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function sourceTitle(source: ExportCenterSource) {
  return cleanFilenamePart(source.title, TARGET_LABELS["collectionId" in source ? "collection" : "assetIndex" in source ? "image" : "psd"]);
}

function renderFilenameTemplate(template: string, source: ExportCenterSource, index: number) {
  const title = sourceTitle(source);
  const asset = "asset" in source ? String(source.asset.assetId || source.key) : source.key;
  const group = "groupName" in source ? source.groupName || title : "collectionId" in source ? source.title : title;
  return renderExportFilename(template, { title, assetId: asset, groupName: group }, index);
}

function sourceDetail(source: ExportCenterSource) {
  if ("collectionId" in source) {
    return `${source.role === "defects" ? "瑕疵组" : "结果组"} · ${source.imageCount} 张`;
  }
  if ("asset" in source) {
    const dimensions = source.asset.width && source.asset.height ? ` · ${source.asset.width}x${source.asset.height}` : "";
    return `单张图片${source.groupName ? ` · ${source.groupName}` : ""}${dimensions}`;
  }
  return source.kind === "layer-group" ? `分层 PSD · ${source.layerCount || 0} 层` : "单图 PSD";
}

function sourceKeySet(sources: ExportCenterSource[]) {
  return new Set(sources.map((source) => source.key));
}

function queueStatusIcon(status: QueueStatus) {
  if (status === "running") return <Loader2 size={15} className="spin" />;
  if (status === "succeeded") return <CheckCircle2 size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  if (status === "skipped") return <Clock3 size={15} />;
  return <Clock3 size={15} />;
}

function historyStatusIcon(status: ExportCenterHistoryEntry["status"]) {
  if (status === "succeeded") return <CheckCircle2 size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  return <Clock3 size={15} />;
}

export default function ExportCenterDialog({
  projectId,
  images,
  collections,
  psdItems,
  initialSelection,
  close,
  prepareProject,
  onCompleted,
}: ExportCenterDialogProps) {
  const initialTarget = initialSelection?.target || "image";
  const [view, setView] = useState<ExportCenterView>("setup");
  const [config, setConfig] = useState<ExportConfig>(() => ({
    ...DEFAULT_CONFIG,
    target: initialTarget,
    format: initialTarget === "psd" ? "psd" : "original",
  }));
  const [selectedByTarget, setSelectedByTarget] = useState<Record<ExportCenterTarget, string[]>>(() => ({
    image: initialTarget === "image" ? initialSelection?.keys || [] : [],
    collection: initialTarget === "collection" ? initialSelection?.keys || [] : [],
    psd: initialTarget === "psd" ? initialSelection?.keys || [] : [],
  }));
  const [state, setState] = useState<ExportCenterState>(EMPTY_STATE);
  const [stateBusy, setStateBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [preview, setPreview] = useState<{
    itemCount: number;
    outputCount: number;
    skippedCount: number;
    estimatedBytes?: number;
    relativeRoot: string;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<ExportQueueJob[]>([]);
  const hiddenJobsRef = useRef(new Set<string>());
  const terminalRevisionsRef = useRef<Map<string, string> | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const mountedRef = useRef(true);

  const sources = useMemo<ExportCenterSource[]>(() => {
    if (config.target === "collection") return collections;
    if (config.target === "psd") return psdItems;
    return images;
  }, [collections, config.target, images, psdItems]);
  const validKeys = useMemo(() => sourceKeySet(sources), [sources]);
  const selectedKeys = useMemo(
    () => selectedByTarget[config.target].filter((key) => validKeys.has(key)),
    [config.target, selectedByTarget, validKeys],
  );
  const selectedSources = useMemo(
    () => sources.filter((source) => selectedKeys.includes(source.key)),
    [selectedKeys, sources],
  );
  const running = jobs.some((job) => job.status === "running");
  const queued = jobs.some((job) => job.status === "queued");
  const namingError = templateError(config.filenameTemplate);
  const defaultDestination = config.container === "zip" ? "项目/exports/archives" : config.target === "collection" ? "项目/image-groups" : `项目/exports/${config.target === "psd" ? "psd" : "images"}`;

  const loadState = useCallback(async () => {
    const bridge = window.naimageConfig?.exportCenterState;
    if (!bridge) {
      setStateBusy(false);
      setError("当前桌面运行时未提供导出中心状态服务。");
      return;
    }
    setStateBusy(true);
    try {
      const result = await bridge({ expectedProjectId: projectId });
      if (!result.ok || !result.state) throw new Error(result.error || "读取导出预设和历史失败。");
      if (result.projectId && result.projectId !== projectId) throw new Error("当前项目已经切换，请重新打开导出中心。");
      setState(result.state);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setStateBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;
    void loadState();
    return () => {
      mountedRef.current = false;
    };
  }, [loadState]);

  useEffect(() => {
    const queue = window.naimageConfig?.exportManagedAssetQueue;
    if (!queue) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await queue.status({ projectId });
        if (!stopped && response.ok) {
          const terminalRevisions = new Map<string, string>();
          const projections: ExportQueueJob[] = [...(response.history || []), ...(response.jobs || [])].map((job) => {
            const failed = job.results.find((result) => result?.ok === false);
            const exportedCount = job.results.reduce((sum, result) => sum + (result?.ok && !result.skipped ? Number(result.exportedCount ?? 1) : 0), 0);
            const skippedCount = job.results.reduce((sum, result) => sum + Number(result?.skippedCount ?? (result?.skipped ? 1 : 0)), 0);
            const status: QueueStatus = ["queued", "running", "failed", "cancelled", "interrupted"].includes(job.status)
              ? job.status as QueueStatus : exportedCount === 0 && skippedCount > 0 ? "skipped" : "succeeded";
            const target = job.config?.target || "image";
            const projection: ExportQueueJob = {
              id: job.queueId, queueId: job.queueId,
              label: `${TARGET_LABELS[target]}${job.config?.container === "zip" ? " ZIP" : "导出"} · ${job.total} 项`,
              config: { ...DEFAULT_CONFIG, ...job.config, target, container: job.config?.container || "folder", format: job.config?.format || (target === "psd" ? "psd" : "original") },
              total: job.total, status, progress: job.completed, exportedCount, skippedCount,
              totalBytes: job.results.reduce((sum, result) => sum + Number(result?.bytes || 0), 0),
              relativePaths: job.results.flatMap((result) => result?.relativePaths || (result?.relativePath ? [result.relativePath] : [])),
              errorCode: failed?.errorCode,
              error: failed?.error || (status === "cancelled" ? "已取消；已完成的文件保留。" : status === "interrupted" ? "应用退出时中断，请重新选择内容提交。" : undefined),
              startedAt: job.startedAt, finishedAt: job.finishedAt,
            };
            if (status !== "queued" && status !== "running") {
              terminalRevisions.set(job.queueId, JSON.stringify([status, job.finishedAt, job.results]));
            }
            return projection;
          });
          const previous = terminalRevisionsRef.current;
          terminalRevisionsRef.current = terminalRevisions;
          setJobs(projections.filter((job) => !hiddenJobsRef.current.has(job.id)));
          if (previous) {
            const changed = projections.filter((job) => terminalRevisions.has(job.id) && previous.get(job.id) !== terminalRevisions.get(job.id));
            if (changed.length) {
              void loadState();
              for (const job of changed) onCompletedRef.current?.(job.status === "failed"
                ? `${job.label}失败：${job.error || "未知错误"}`
                : `${job.label}${STATUS_LABELS[job.status]}：导出 ${job.exportedCount} 项，跳过 ${job.skippedCount} 项。`);
            }
          }
        }
      } catch { /* Retain the last confirmed projection while the project is unavailable. */ }
      if (!stopped) timer = setTimeout(() => void refresh(), 500);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [loadState, projectId]);

  useEffect(() => {
    setPreview(null);
    setNotice("");
  }, [config.authorizationId, config.container, config.conflictPolicy, config.filenameTemplate, config.format, config.incremental, config.target, selectedKeys.join("\u0000")]);

  async function retryFailedJob(job: ExportQueueJob) {
    if (!job.queueId) return;
    const result = await window.naimageConfig?.exportManagedAssetQueue?.retryFailed?.({ queueId: job.queueId, projectId });
    if (!result?.ok) setError(result?.error || "该失败任务已无法重试，请重新选择内容提交。");
    else setNotice("已提交失败项，成功项将保留。");
  }

  async function cancelJob(job: ExportQueueJob) {
    if (!job.queueId) return;
    const result = await window.naimageConfig?.exportManagedAssetQueue?.cancel({ queueId: job.queueId, projectId });
    if (!result?.ok) setError(result?.error || "取消导出失败。");
  }

  function changeTarget(target: ExportCenterTarget) {
    if (target !== config.target && (target === "image" || target === "psd") && selectedByTarget[target].length === 0) {
      const currentSources = config.target === "image" ? images : config.target === "psd" ? psdItems : [];
      const selectedCurrent = currentSources.filter((source) => selectedByTarget[config.target].includes(source.key));
      const mapped = target === "psd"
        ? psdItems.filter((candidate) => candidate.kind === "asset" && selectedCurrent.some((source) => source.nodeId === candidate.nodeId && "assetIndex" in source && source.assetIndex === candidate.assetIndex))
        : images.filter((candidate) => selectedCurrent.some((source) => source.nodeId === candidate.nodeId && "assetIndex" in source && source.assetIndex === candidate.assetIndex));
      if (mapped.length) setSelectedByTarget((current) => ({ ...current, [target]: mapped.map((source) => source.key) }));
    }
    setConfig((current) => ({
      ...current,
      target,
      container: target === "psd" ? "folder" : current.container,
      format: target === "psd" ? "psd" : current.format === "psd" ? "original" : current.format,
    }));
    setError("");
  }

  function toggleSource(key: string) {
    setSelectedByTarget((current) => {
      const selected = new Set(current[config.target]);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      return { ...current, [config.target]: [...selected] };
    });
  }

  function selectAllSources() {
    setSelectedByTarget((current) => ({ ...current, [config.target]: sources.map((source) => source.key) }));
  }

  function clearSourceSelection() {
    setSelectedByTarget((current) => ({ ...current, [config.target]: [] }));
  }

  async function runPreview() {
    setError("");
    if (!selectedSources.length) {
      setError(`请至少选择一个${TARGET_LABELS[config.target]}导出项。`);
      return;
    }
    if (namingError) {
      setError(namingError);
      return;
    }
    setPreviewBusy(true);
    try {
      if (config.target === "collection") {
        const bridge = window.naimageConfig?.previewImageCollectionExport;
        if (!bridge) throw new Error("当前桌面运行时未提供图片组导出预检。");
        await prepareProject();
        const result = await bridge({
          expectedProjectId: projectId,
          collectionIds: selectedSources.flatMap((source) => "collectionId" in source ? [source.collectionId] : []),
          format: config.format as ImageExportFormat,
          filenameTemplate: config.filenameTemplate,
          conflictPolicy: config.conflictPolicy,
          incremental: config.incremental,
        });
        if (!result.ok) throw new Error(result.error || "图片组导出预检失败。");
        setPreview({
          itemCount: result.collectionCount || selectedSources.length,
          outputCount: result.imageCount || 0,
          skippedCount: config.container === "zip" ? 0 : result.skippedCount || 0,
          estimatedBytes: result.estimatedBytes,
          relativeRoot: config.destinationLabel || defaultDestination,
        });
      } else {
        setPreview({
          itemCount: selectedSources.length,
          outputCount: selectedSources.length,
          skippedCount: 0,
          relativeRoot: config.destinationLabel || defaultDestination,
        });
      }
      setNotice("预检完成，可以加入串行导出队列。");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
      setPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function enqueueSelection() {
    setError("");
    if (!selectedSources.length) {
      setError(`请至少选择一个${TARGET_LABELS[config.target]}导出项。`);
      return;
    }
    if (namingError) {
      setError(namingError);
      return;
    }
    const queue = window.naimageConfig?.exportManagedAssetQueue;
    if (!queue) { setError("导出队列不可用。"); return; }
    const snapshot: ExportConfig = { ...config, container: config.target === "psd" ? "folder" : config.container,
      format: config.target === "psd" ? "psd" : config.format };
    setSubmitting(true);
    try {
      await prepareProject();
      const request = {
        projectId, target: snapshot.target, container: snapshot.container, authorizationId: snapshot.authorizationId,
        format: snapshot.format, filenameTemplate: snapshot.filenameTemplate, conflictPolicy: snapshot.conflictPolicy,
        incremental: snapshot.target !== "psd" && snapshot.container !== "zip" && snapshot.incremental,
      };
      let accepted;
      if (snapshot.target === "collection") {
        const collectionIds = selectedSources.flatMap((source) => "collectionId" in source ? [source.collectionId] : []);
        const previewBridge = window.naimageConfig?.previewImageCollectionExport;
        if (!previewBridge) throw new Error("图片组导出预检不可用。");
        const prepared = await previewBridge({ ...request, expectedProjectId: projectId, collectionIds, format: snapshot.format as ImageExportFormat });
        if (!prepared.ok || !prepared.previewToken) throw new Error(prepared.error || "图片组导出预检失败。");
        accepted = await queue.start({ ...request, collectionIds, previewToken: prepared.previewToken });
      } else {
        accepted = await queue.start({ ...request, items: selectedSources.map((source, index) => ({
          ...("asset" in source ? { asset: source.asset } : "kind" in source ? { kind: source.kind } : {}),
          nodeId: source.nodeId, assetIndex: "assetIndex" in source ? source.assetIndex : undefined,
          suggestedName: renderFilenameTemplate(snapshot.filenameTemplate, source, index),
        })) });
      }
      if (!accepted.ok || !accepted.queueId) throw new Error(accepted.error || "导出未受理。");
      setView("queue");
      setNotice("已加入导出队列，关闭面板后继续执行，可重新打开查看结果。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally { setSubmitting(false); }
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) {
      setError("请输入导出预设名称。");
      return;
    }
    const bridge = window.naimageConfig?.saveExportCenterPreset;
    if (!bridge) {
      setError("当前桌面运行时未提供导出预设服务。");
      return;
    }
    setPresetBusy(true);
    setError("");
    try {
      const result = await bridge({
        expectedProjectId: projectId,
        preset: {
          ...(selectedPresetId ? { id: selectedPresetId } : {}),
          name,
          ...config,
          format: config.target === "psd" ? "psd" : config.format,
        },
      });
      if (!result.ok || !result.state || !result.preset) throw new Error(result.error || "保存导出预设失败。");
      setState(result.state);
      setSelectedPresetId(result.preset.id);
      setPresetName(result.preset.name);
      setNotice(`已保存预设“${result.preset.name}”。`);
    } catch (presetError) {
      setError(presetError instanceof Error ? presetError.message : String(presetError));
    } finally {
      setPresetBusy(false);
    }
  }

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    const preset = state.presets.find((item) => item.id === presetId);
    if (!preset) {
      setPresetName("");
      return;
    }
    setPresetName(preset.name);
    setConfig({
      target: preset.target,
      container: preset.target === "psd" ? "folder" : preset.container || "folder",
      format: preset.target === "psd" ? "psd" : preset.format === "psd" ? "original" : preset.format,
      filenameTemplate: preset.filenameTemplate,
      conflictPolicy: preset.conflictPolicy,
      incremental: preset.incremental,
    });
    setNotice(`已应用预设“${preset.name}”。`);
  }

  async function deletePreset() {
    if (!selectedPresetId) return;
    const bridge = window.naimageConfig?.deleteExportCenterPreset;
    if (!bridge) return;
    setPresetBusy(true);
    try {
      const result = await bridge({ expectedProjectId: projectId, presetId: selectedPresetId });
      if (!result.ok || !result.state) throw new Error(result.error || "删除导出预设失败。");
      setState(result.state);
      setSelectedPresetId("");
      setPresetName("");
      setNotice("预设已删除。");
    } catch (presetError) {
      setError(presetError instanceof Error ? presetError.message : String(presetError));
    } finally {
      setPresetBusy(false);
    }
  }

  async function clearHistory() {
    const bridge = window.naimageConfig?.clearExportCenterHistory;
    if (!bridge || running) return;
    setStateBusy(true);
    try {
      const result = await bridge({ expectedProjectId: projectId });
      if (!result.ok || !result.state) throw new Error(result.error || "清空导出历史失败。");
      setState(result.state);
      setNotice("当前项目的导出历史已清空。");
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : String(historyError));
    } finally {
      setStateBusy(false);
    }
  }

  const closeBlocked = submitting;
  const history = [...state.history].reverse();

  return (
    <DialogShell
      surface="export-center"
      ariaLabel="导出中心"
      className="export-center-dialog"
      busy={closeBlocked}
      closePolicy={{ escape: closeBlocked ? "never" : "always", backdrop: closeBlocked ? "never" : "always", "close-button": closeBlocked ? "never" : "always" }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="当前项目"
            title="导出中心"
            description="选择图片、图片组或 Photoshop PSD，配置格式与目标后加入导出队列。"
            onClose={() => requestClose("close-button")}
            closeDisabled={closeBlocked}
          />
          <SurfaceBody className="export-center-body">
            <div className="export-center-view-tabs">
              <SegmentedControl aria-label="导出中心视图">
                <SegmentButton active={view === "setup"} onClick={() => setView("setup")}><ListChecks size={14} />配置</SegmentButton>
                <SegmentButton active={view === "queue"} onClick={() => setView("queue")}><Download size={14} />队列{jobs.length ? ` ${jobs.length}` : ""}</SegmentButton>
                <SegmentButton active={view === "history"} onClick={() => setView("history")}><History size={14} />历史{state.history.length ? ` ${state.history.length}` : ""}</SegmentButton>
              </SegmentedControl>
            </div>
            <div className="export-center-view-content">
            {view === "setup" ? (
              <div className="export-center-setup">
                <section className="export-center-config" aria-label="导出配置">
                  <div className="export-center-targets">
                    <SegmentedControl aria-label="导出类型">
                      <SegmentButton active={config.target === "image"} onClick={() => changeTarget("image")}><FileImage size={15} />图片</SegmentButton>
                      <SegmentButton active={config.target === "collection"} onClick={() => changeTarget("collection")}><FolderArchive size={15} />图片组</SegmentButton>
                      <SegmentButton active={config.target === "psd"} onClick={() => changeTarget("psd")}><Layers3 size={15} />PSD</SegmentButton>
                    </SegmentedControl>
                  </div>

                  <div className="export-center-preset-row">
                    <Field label="项目预设">
                      <select value={selectedPresetId} onChange={(event) => applyPreset(event.target.value)} disabled={stateBusy || presetBusy}>
                        <option value="">自定义配置</option>
                        {state.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                      </select>
                    </Field>
                    <Field label="预设名称">
                      <input value={presetName} onChange={(event) => setPresetName(event.target.value)} maxLength={80} placeholder="例如：Amazon 主图" />
                    </Field>
                    <IconActionButton label="保存预设" icon={<Save size={16} />} disabled={presetBusy} onClick={() => void savePreset()} />
                    <IconActionButton label="删除所选预设" icon={<Trash2 size={16} />} disabled={!selectedPresetId || presetBusy} onClick={() => void deletePreset()} />
                  </div>

                  <div className="export-center-option-grid">
                    <Field label="目标位置">
                      <ActionButton onClick={() => void (async () => {
                        const result = await window.naimageConfig?.authorizeExportDirectory?.({ projectId });
                        if (result?.ok && result.authorizationId) setConfig((current) => ({ ...current, authorizationId: result.authorizationId, destinationLabel: result.label }));
                        else if (result && !result.ok) setError(result.error || "目录授权失败。");
                      })()}>{config.destinationLabel || `${defaultDestination}（选择交付目录…）`}</ActionButton>
                      {config.authorizationId ? <ActionButton variant="ghost" onClick={() => setConfig((current) => ({ ...current, authorizationId: undefined, destinationLabel: undefined }))}>使用项目目录</ActionButton> : null}
                    </Field>
                    {config.target !== "psd" ? <Field label="交付方式">
                      <select value={config.container} onChange={(event) => setConfig((current) => ({ ...current, container: event.target.value as "folder" | "zip" }))}>
                        <option value="folder">文件夹</option><option value="zip">ZIP 压缩包</option>
                      </select>
                    </Field> : null}
                    <Field label="格式">
                      <select
                        value={config.target === "psd" ? "psd" : config.format}
                        disabled={config.target === "psd"}
                        onChange={(event) => setConfig((current) => ({ ...current, format: event.target.value as ImageExportFormat }))}
                      >
                        {config.target === "psd" ? <option value="psd">Photoshop PSD</option> : null}
                        {config.target !== "psd" ? IMAGE_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>) : null}
                      </select>
                    </Field>
                    <Field label="命名模板">
                      <input
                        value={config.filenameTemplate}
                        onChange={(event) => setConfig((current) => ({ ...current, filenameTemplate: event.target.value }))}
                        maxLength={160}
                        placeholder="{title}-{index}"
                      />
                    </Field>
                    <Field label="同名冲突">
                      <select
                        value={config.conflictPolicy}
                        onChange={(event) => setConfig((current) => ({ ...current, conflictPolicy: event.target.value as ExportConflictPolicy }))}
                      >
                        <option value="overwrite">覆盖旧导出</option>
                        <option value="keep-both">保留两份</option>
                        <option value="skip">跳过同名项</option>
                      </select>
                    </Field>
                    <label className="export-center-incremental-toggle">
                      <input
                        type="checkbox"
                        checked={config.target !== "psd" && config.container !== "zip" && config.incremental}
                        disabled={config.target === "psd" || config.container === "zip"}
                        onChange={(event) => setConfig((current) => ({ ...current, incremental: event.target.checked }))}
                      />
                      <span><strong>增量导出</strong><small>内容与配置未变化时直接跳过</small></span>
                    </label>
                  </div>
                  {namingError ? <InlineNotice tone="warning" icon={<AlertTriangle size={15} />}>{namingError}</InlineNotice> : null}
                  <p className="export-center-token-help">可用变量：<code>{"{title}"}</code> <code>{"{index}"}</code> <code>{"{asset}"}</code> <code>{"{group}"}</code> <code>{"{request}"}</code></p>
                </section>

                <section className="export-center-selection" aria-label={`${TARGET_LABELS[config.target]}选择`}>
                  <header>
                    <span><strong>选择{TARGET_LABELS[config.target]}</strong><small>{selectedSources.length} / {sources.length} 项</small></span>
                    <span>
                      <ActionButton variant="ghost" onClick={selectAllSources} disabled={!sources.length || selectedSources.length === sources.length}>全选</ActionButton>
                      <ActionButton variant="ghost" onClick={clearSourceSelection} disabled={!selectedSources.length}>清空</ActionButton>
                    </span>
                  </header>
                  <div className="export-center-source-list">
                    {sources.length ? sources.map((source, index) => (
                      <label key={source.key} className={`export-center-source-row${"asset" in source ? " has-thumbnail" : ""}`}>
                        <input type="checkbox" checked={selectedKeys.includes(source.key)} onChange={() => toggleSource(source.key)} />
                        <span className="export-center-source-index">{String(index + 1).padStart(2, "0")}</span>
                        {"asset" in source ? <span className="export-center-source-thumbnail"><img src={imageAssetSrc(source.asset)} alt="" loading="lazy" /></span> : null}
                        <span className="export-center-source-copy"><strong>{source.title}</strong><small>{sourceDetail(source)}</small></span>
                        {selectedKeys.includes(source.key) ? <Check size={15} aria-hidden="true" /> : null}
                      </label>
                    )) : (
                      <div className="export-center-empty"><FileImage size={26} /><strong>当前项目没有可导出的{TARGET_LABELS[config.target]}</strong></div>
                    )}
                  </div>
                </section>

                <aside className="export-center-preview" aria-label="导出预检">
                  <header><strong>本次导出</strong><span>{config.destinationLabel || defaultDestination}</span></header>
                  <dl>
                    <div><dt>选择项</dt><dd>{preview?.itemCount ?? selectedSources.length}</dd></div>
                    <div><dt>预计文件</dt><dd>{preview?.outputCount ?? selectedSources.length}</dd></div>
                    <div><dt>预计跳过</dt><dd>{preview?.skippedCount ?? 0}</dd></div>
                    <div><dt>预计体积</dt><dd>{preview?.estimatedBytes !== undefined ? formatBytes(preview.estimatedBytes) : "执行后统计"}</dd></div>
                  </dl>
                  <p>{preview ? `目标：${preview.relativeRoot}` : "图片组预检会读取当前项目 manifest，计算冲突、增量跳过和转码后的预计体积。"}</p>
                  <ActionButton icon={<RefreshCw size={15} />} busy={previewBusy} disabled={!selectedSources.length || Boolean(namingError)} onClick={() => void runPreview()}>预检</ActionButton>
                </aside>
              </div>
            ) : null}

            {view === "queue" ? (
              <div className="export-center-queue-view">
                <header>
                  <span><strong>本地串行队列</strong><small>同一时间只执行一个导出任务</small></span>
                  <ActionButton
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    disabled={running || queued || !jobs.some((job) => job.status !== "running" && job.status !== "queued")}
                    onClick={() => {
                      for (const job of jobs) if (job.status !== "running" && job.status !== "queued") hiddenJobsRef.current.add(job.id);
                      setJobs((current) => current.filter((job) => !hiddenJobsRef.current.has(job.id)));
                    }}
                  >隐藏已结束</ActionButton>
                </header>
                <div className="export-center-job-list">
                  {jobs.length ? jobs.map((job) => (
                    <div key={job.id} className={`export-center-job-row is-${job.status}`} data-job-status={job.status}>
                      <span className="export-center-job-icon">{queueStatusIcon(job.status)}</span>
                      <span className="export-center-job-copy">
                        <strong>{job.label}</strong>
                        <small>{TARGET_LABELS[job.config.target]} · {job.config.format.toUpperCase()}{job.config.container === "zip" ? " / ZIP" : ""} · {job.progress}/{job.total}</small>
                        {job.error ? <em>{job.error}</em> : null}
                      </span>
                      <span className="export-center-job-result">
                        <strong>{STATUS_LABELS[job.status]}</strong>
                        <small>{job.exportedCount} 导出 · {job.skippedCount} 跳过{job.totalBytes ? ` · ${formatBytes(job.totalBytes)}` : ""}</small>
                        {job.status === "failed" && job.queueId ? <ActionButton variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void retryFailedJob(job)}>仅重试失败项</ActionButton> : null}
                        {(job.status === "queued" || job.status === "running") && job.queueId ? <ActionButton variant="ghost" onClick={() => void cancelJob(job)}>取消</ActionButton> : null}
                      </span>
                    </div>
                  )) : (
                    <div className="export-center-empty"><ListChecks size={28} /><strong>队列为空</strong><small>在“配置”中选择内容并加入队列。</small></div>
                  )}
                </div>
              </div>
            ) : null}

            {view === "history" ? (
              <div className="export-center-history-view">
                <header>
                  <span><strong>项目导出历史</strong><small>最多保留最近 100 条，不记录绝对路径</small></span>
                  <ActionButton variant="ghost" icon={<Trash2 size={14} />} disabled={stateBusy || !history.length} onClick={() => void clearHistory()}>清空历史</ActionButton>
                </header>
                <div className="export-center-history-list">
                  {history.length ? history.map((entry) => (
                    <div key={entry.id} className={`export-center-history-row is-${entry.status}`} data-history-status={entry.status}>
                      <span>{historyStatusIcon(entry.status)}</span>
                      <span>
                        <strong>{entry.label}</strong>
                        <small>{TARGET_LABELS[entry.target]} · {entry.format.toUpperCase()} · {entry.exportedCount} 导出 · {entry.skippedCount} 跳过</small>
                        {entry.relativePaths.length ? <code>{entry.relativePaths.slice(0, 2).join(" · ")}</code> : null}
                        {entry.error ? <em>{entry.error}</em> : null}
                      </span>
                      <span><strong>{entry.status === "succeeded" ? "成功" : entry.status === "skipped" ? "跳过" : "失败"}</strong><small>{new Date(entry.finishedAt).toLocaleString("zh-CN")}</small></span>
                    </div>
                  )) : (
                    <div className="export-center-empty"><History size={28} /><strong>暂无导出历史</strong><small>成功、跳过和失败结果都会保存在当前项目中。</small></div>
                  )}
                </div>
              </div>
            ) : null}
            </div>

            {error ? <InlineNotice className="export-center-global-notice" tone="danger" icon={<XCircle size={15} />}>{error}</InlineNotice> : null}
            {!error && notice ? <StatusLine className="export-center-global-notice" tone="success" icon={<CheckCircle2 size={15} />} live="polite">{notice}</StatusLine> : null}
          </SurfaceBody>
          <SurfaceFooter leading={<span className="export-center-footer-status">{closeBlocked ? "正在加入导出队列" : "导出队列继续运行，可关闭面板"}</span>}>
            <ActionButton onClick={() => requestClose("action")} disabled={closeBlocked}>关闭</ActionButton>
            {view !== "setup" ? <ActionButton icon={<Plus size={15} />} onClick={() => setView("setup")}>添加任务</ActionButton> : null}
            {view === "setup" ? (
              <ActionButton variant="primary" icon={<Download size={15} />} busy={submitting} disabled={submitting || !selectedSources.length || Boolean(namingError)} onClick={enqueueSelection}>加入导出队列</ActionButton>
            ) : null}
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
