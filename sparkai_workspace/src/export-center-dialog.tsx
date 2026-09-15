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
  ExportCenterPreset,
  ExportCenterState,
  ExportCenterTarget,
  ExportConflictPolicy,
  ImageAsset,
  ImageAssetExportResult,
  ImageCollectionRole,
  ImageExportFormat,
} from "./core";
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
type QueueStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

type ExportConfig = {
  target: ExportCenterTarget;
  format: ExportCenterFormat;
  filenameTemplate: string;
  conflictPolicy: ExportConflictPolicy;
  incremental: boolean;
};

type ExportQueueJob = {
  id: string;
  label: string;
  config: ExportConfig;
  sources: ExportCenterSource[];
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

type JobOutcome = Pick<
  ExportQueueJob,
  "status" | "exportedCount" | "skippedCount" | "totalBytes" | "relativePaths" | "errorCode" | "error"
>;

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
  format: "png",
  filenameTemplate: "{title}-{index}",
  conflictPolicy: "overwrite",
  incremental: true,
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
};

function uid(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function formatBytes(value: number | undefined) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function cleanFilenamePart(value: string, fallback: string) {
  const normalized = String(value || "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (normalized || fallback).slice(0, 100).replace(/[. ]+$/g, "") || fallback;
}

function sourceTitle(source: ExportCenterSource) {
  return cleanFilenamePart(source.title, TARGET_LABELS["collectionId" in source ? "collection" : "assetIndex" in source ? "image" : "psd"]);
}

function renderFilenameTemplate(template: string, source: ExportCenterSource, index: number) {
  const title = sourceTitle(source);
  const asset = "asset" in source ? String(source.asset.assetId || source.key) : source.key;
  const group = "groupName" in source ? source.groupName || title : "collectionId" in source ? source.title : title;
  const rendered = String(template || "{title}-{index}").replace(/\{([^{}]+)\}/g, (_match, token) => {
    const values: Record<string, string> = {
      title,
      index: String(index + 1).padStart(3, "0"),
      asset: cleanFilenamePart(asset, `asset-${index + 1}`),
      group: cleanFilenamePart(group, "图片组"),
      request: String(index + 1).padStart(3, "0"),
    };
    return values[String(token || "").toLowerCase()] || "";
  });
  return cleanFilenamePart(rendered, `${title}-${String(index + 1).padStart(3, "0")}`);
}

function templateError(template: string) {
  if (!String(template || "").trim()) return "请输入命名模板。";
  const allowed = new Set(["title", "index", "asset", "group", "request"]);
  for (const match of String(template).matchAll(/\{([^{}]+)\}/g)) {
    if (!allowed.has(String(match[1] || "").toLowerCase())) {
      return "命名模板只支持 {title}、{index}、{asset}、{group} 和 {request}。";
    }
  }
  return "";
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
  exportPsd,
  onCompleted,
}: ExportCenterDialogProps) {
  const initialTarget = initialSelection?.target || "image";
  const [view, setView] = useState<ExportCenterView>("setup");
  const [config, setConfig] = useState<ExportConfig>(() => ({
    ...DEFAULT_CONFIG,
    target: initialTarget,
    format: initialTarget === "psd" ? "psd" : "png",
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
  const [jobs, setJobs] = useState<ExportQueueJob[]>([]);
  const jobsRef = useRef<ExportQueueJob[]>([]);
  const drainingRef = useRef(false);
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
  const namingError = config.target === "psd" ? "" : templateError(config.filenameTemplate);

  const setJobsSafe = useCallback((updater: ExportQueueJob[] | ((current: ExportQueueJob[]) => ExportQueueJob[])) => {
    const next = typeof updater === "function" ? updater(jobsRef.current) : updater;
    jobsRef.current = next;
    if (mountedRef.current) setJobs(next);
  }, []);

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
    setPreview(null);
    setNotice("");
  }, [config.conflictPolicy, config.filenameTemplate, config.format, config.incremental, config.target, selectedKeys.join("\u0000")]);

  const recordHistory = useCallback(async (job: ExportQueueJob) => {
    const bridge = window.naimageConfig?.recordExportCenterHistory;
    if (!bridge || (job.status !== "succeeded" && job.status !== "failed" && job.status !== "skipped")) return;
    const result = await bridge({
      expectedProjectId: projectId,
      entry: {
        id: uid("export-history"),
        jobId: job.id,
        target: job.config.target,
        status: job.status,
        format: job.config.format,
        label: job.label,
        itemCount: job.sources.length,
        exportedCount: job.exportedCount,
        skippedCount: job.skippedCount,
        totalBytes: job.totalBytes,
        relativePaths: job.relativePaths,
        errorCode: job.errorCode,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    });
    if (result.ok && result.state && mountedRef.current) setState(result.state);
  }, [projectId]);

  const executeImageJob = useCallback(async (job: ExportQueueJob): Promise<JobOutcome> => {
    const bridge = window.naimageConfig?.exportManagedAsset;
    if (!bridge) throw new Error("当前桌面运行时未提供受管图片导出服务。");
    await prepareProject();
    let exportedCount = 0;
    let skippedCount = 0;
    let totalBytes = 0;
    const relativePaths: string[] = [];
    let firstError = "";
    let firstErrorCode = "";
    for (let index = 0; index < job.sources.length; index += 1) {
      const source = job.sources[index];
      if (!("asset" in source)) continue;
      const result = await bridge({
        asset: source.asset,
        projectId,
        suggestedName: renderFilenameTemplate(job.config.filenameTemplate, source, index),
        format: job.config.format as ImageExportFormat,
        conflictPolicy: job.config.conflictPolicy,
        incremental: job.config.incremental,
      });
      if (!result.ok) {
        firstError ||= result.error || "图片导出失败。";
        firstErrorCode ||= result.errorCode || "IMAGE_EXPORT_FAILED";
      } else if (result.skipped || result.canceled) {
        skippedCount += 1;
      } else {
        exportedCount += 1;
      }
      totalBytes += Math.max(0, Number(result.bytes || 0));
      if (result.relativePath) relativePaths.push(result.relativePath);
      setJobsSafe((current) => current.map((item) => item.id === job.id
        ? { ...item, progress: index + 1, exportedCount, skippedCount, totalBytes }
        : item));
    }
    return {
      status: firstError ? "failed" : exportedCount ? "succeeded" : "skipped",
      exportedCount,
      skippedCount,
      totalBytes,
      relativePaths,
      ...(firstError ? { error: firstError, errorCode: firstErrorCode } : {}),
    };
  }, [prepareProject, projectId, setJobsSafe]);

  const executeCollectionJob = useCallback(async (job: ExportQueueJob): Promise<JobOutcome> => {
    const previewBridge = window.naimageConfig?.previewImageCollectionExport;
    const exportBridge = window.naimageConfig?.exportImageCollections;
    if (!previewBridge || !exportBridge) throw new Error("当前桌面运行时未提供图片组导出服务。");
    await prepareProject();
    const collectionIds = job.sources.flatMap((source) => "collectionId" in source ? [source.collectionId] : []);
    const request = {
      expectedProjectId: projectId,
      collectionIds,
      format: job.config.format as ImageExportFormat,
      filenameTemplate: job.config.filenameTemplate,
      conflictPolicy: job.config.conflictPolicy,
      incremental: job.config.incremental,
    };
    const prepared = await previewBridge(request);
    if (!prepared.ok || !prepared.previewToken) {
      return {
        status: "failed",
        exportedCount: 0,
        skippedCount: 0,
        totalBytes: 0,
        relativePaths: [],
        errorCode: prepared.errorCode || "IMAGE_COLLECTION_EXPORT_PREVIEW_FAILED",
        error: prepared.error || "图片组导出预检失败。",
      };
    }
    setJobsSafe((current) => current.map((item) => item.id === job.id ? { ...item, progress: 1 } : item));
    const result = await exportBridge({ ...request, previewToken: prepared.previewToken, confirmed: true });
    if (!result.ok) {
      return {
        status: "failed",
        exportedCount: 0,
        skippedCount: 0,
        totalBytes: 0,
        relativePaths: [],
        errorCode: result.errorCode || "IMAGE_COLLECTION_EXPORT_FAILED",
        error: result.error || "图片组导出失败。",
      };
    }
    const exportedGroups = result.exported || [];
    const exportedCount = exportedGroups.filter((item) => !item.skipped).length;
    const skippedCount = exportedGroups.filter((item) => item.skipped).length;
    return {
      status: exportedCount ? "succeeded" : "skipped",
      exportedCount,
      skippedCount,
      totalBytes: Math.max(0, Number(result.totalBytes || 0)),
      relativePaths: exportedGroups.map((item) => item.relativePath).filter(Boolean),
    };
  }, [prepareProject, projectId, setJobsSafe]);

  const executePsdJob = useCallback(async (job: ExportQueueJob): Promise<JobOutcome> => {
    let exportedCount = 0;
    let skippedCount = 0;
    let firstError = "";
    let firstErrorCode = "";
    for (let index = 0; index < job.sources.length; index += 1) {
      const source = job.sources[index];
      if (!("kind" in source)) continue;
      const suggestedName = `${renderFilenameTemplate(job.config.filenameTemplate, source, index)}.psd`;
      const result = await exportPsd(source, suggestedName);
      if (!result.ok) {
        firstError ||= result.error || "PSD 导出失败。";
        firstErrorCode ||= result.errorCode || "PSD_EXPORT_FAILED";
      } else if (result.canceled || result.skipped) {
        skippedCount += 1;
      } else {
        exportedCount += 1;
      }
      setJobsSafe((current) => current.map((item) => item.id === job.id
        ? { ...item, progress: index + 1, exportedCount, skippedCount }
        : item));
    }
    return {
      status: firstError ? "failed" : exportedCount ? "succeeded" : "skipped",
      exportedCount,
      skippedCount,
      totalBytes: 0,
      relativePaths: [],
      ...(firstError ? { error: firstError, errorCode: firstErrorCode } : {}),
    };
  }, [exportPsd, setJobsSafe]);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (true) {
        const next = jobsRef.current.find((job) => job.status === "queued");
        if (!next) break;
        const startedAt = new Date().toISOString();
        setJobsSafe((current) => current.map((job) => job.id === next.id
          ? { ...job, status: "running", startedAt, error: undefined, errorCode: undefined }
          : job));
        let outcome: JobOutcome;
        try {
          outcome = next.config.target === "collection"
            ? await executeCollectionJob(next)
            : next.config.target === "psd"
              ? await executePsdJob(next)
              : await executeImageJob(next);
        } catch (jobError) {
          outcome = {
            status: "failed",
            exportedCount: 0,
            skippedCount: 0,
            totalBytes: 0,
            relativePaths: [],
            errorCode: "EXPORT_JOB_FAILED",
            error: jobError instanceof Error ? jobError.message : String(jobError),
          };
        }
        const finishedAt = new Date().toISOString();
        const completed = { ...next, ...outcome, status: outcome.status, startedAt, finishedAt, progress: next.sources.length };
        setJobsSafe((current) => current.map((job) => job.id === next.id ? completed : job));
        await recordHistory(completed).catch(() => undefined);
        onCompleted?.(
          outcome.status === "failed"
            ? `${next.label}失败：${outcome.error || "未知错误"}`
            : `${next.label}完成：导出 ${outcome.exportedCount} 项，跳过 ${outcome.skippedCount} 项。`,
        );
      }
    } finally {
      drainingRef.current = false;
    }
  }, [executeCollectionJob, executeImageJob, executePsdJob, onCompleted, recordHistory, setJobsSafe]);

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
      format: target === "psd" ? "psd" : current.format === "psd" ? "png" : current.format,
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
          skippedCount: result.skippedCount || 0,
          estimatedBytes: result.estimatedBytes,
          relativeRoot: result.relativeRoot || "image-groups",
        });
      } else {
        setPreview({
          itemCount: selectedSources.length,
          outputCount: selectedSources.length,
          skippedCount: 0,
          relativeRoot: config.target === "image" ? "exports/images" : "用户选择的位置",
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

  function enqueueSelection() {
    setError("");
    if (!selectedSources.length) {
      setError(`请至少选择一个${TARGET_LABELS[config.target]}导出项。`);
      return;
    }
    if (namingError) {
      setError(namingError);
      return;
    }
    const snapshot: ExportConfig = { ...config, format: config.target === "psd" ? "psd" : config.format };
    const job: ExportQueueJob = {
      id: uid("export-job"),
      label: `${TARGET_LABELS[config.target]}导出 · ${selectedSources.length} 项`,
      config: snapshot,
      sources: selectedSources.map((source) => ({ ...source })),
      status: "queued",
      progress: 0,
      exportedCount: 0,
      skippedCount: 0,
      totalBytes: 0,
      relativePaths: [],
    };
    setJobsSafe((current) => [...current, job]);
    setView("queue");
    setNotice("任务已加入队列，将按顺序执行。");
    window.setTimeout(() => void drainQueue(), 0);
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
      format: preset.target === "psd" ? "psd" : preset.format === "psd" ? "png" : preset.format,
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

  const closeBlocked = running || queued;
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
            description="图片、图片组和 Photoshop PSD 共用一个入口；底层导出链路仍彼此独立。"
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
                        disabled={config.target === "psd"}
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
                        checked={config.incremental}
                        disabled={config.target === "psd"}
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
                      <label key={source.key} className="export-center-source-row">
                        <input type="checkbox" checked={selectedKeys.includes(source.key)} onChange={() => toggleSource(source.key)} />
                        <span className="export-center-source-index">{String(index + 1).padStart(2, "0")}</span>
                        <span><strong>{source.title}</strong><small>{sourceDetail(source)}</small></span>
                        {selectedKeys.includes(source.key) ? <Check size={15} aria-hidden="true" /> : null}
                      </label>
                    )) : (
                      <div className="export-center-empty"><FileImage size={26} /><strong>当前项目没有可导出的{TARGET_LABELS[config.target]}</strong></div>
                    )}
                  </div>
                </section>

                <aside className="export-center-preview" aria-label="导出预检">
                  <header><strong>本次导出</strong><span>{config.target === "collection" ? "项目/image-groups" : config.target === "image" ? "项目/exports/images" : "原生另存为位置"}</span></header>
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
                    onClick={() => setJobsSafe((current) => current.filter((job) => job.status === "running" || job.status === "queued"))}
                  >清除已完成</ActionButton>
                </header>
                <div className="export-center-job-list">
                  {jobs.length ? jobs.map((job) => (
                    <div key={job.id} className={`export-center-job-row is-${job.status}`} data-job-status={job.status}>
                      <span className="export-center-job-icon">{queueStatusIcon(job.status)}</span>
                      <span className="export-center-job-copy">
                        <strong>{job.label}</strong>
                        <small>{TARGET_LABELS[job.config.target]} · {job.config.format.toUpperCase()} · {job.progress}/{job.sources.length}</small>
                        {job.error ? <em>{job.error}</em> : null}
                      </span>
                      <span className="export-center-job-result">
                        <strong>{STATUS_LABELS[job.status]}</strong>
                        <small>{job.exportedCount} 导出 · {job.skippedCount} 跳过{job.totalBytes ? ` · ${formatBytes(job.totalBytes)}` : ""}</small>
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
          <SurfaceFooter leading={<span className="export-center-footer-status">{closeBlocked ? "导出任务执行期间请保持窗口打开" : "全部输出都由 Electron Main 解析和写入"}</span>}>
            <ActionButton onClick={() => requestClose("action")} disabled={closeBlocked}>关闭</ActionButton>
            {view !== "setup" ? <ActionButton icon={<Plus size={15} />} onClick={() => setView("setup")}>添加任务</ActionButton> : null}
            {view === "setup" ? (
              <ActionButton variant="primary" icon={<Download size={15} />} disabled={!selectedSources.length || Boolean(namingError)} onClick={enqueueSelection}>加入导出队列</ActionButton>
            ) : null}
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
