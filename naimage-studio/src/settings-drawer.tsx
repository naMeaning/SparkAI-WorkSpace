import React, { useEffect, useRef, useState } from "react";
import { Brain, Check, Download, Film, ImageIcon, Plus, RotateCcw, Settings, Shield } from "lucide-react";

import {
  CONTEXT_STRATEGY_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  defaultSettings,
  mergeSettings,
} from "./settings-persistence";
import {
  FRAME_OPTIONS,
  SIZE_PRESETS,
  computedSizeFor,
  imageModelsWithPreferredFallback,
  modelsWithPreferred,
  normalizeModelPoolSelections,
  selectedAgentModelsFromSettings,
  selectedImageModelsFromSettings,
  selectedVideoModelsFromSettings,
  type AccountApiToken,
  type AgentIntegrationTarget,
  type AppSettings,
  type DesktopInstallerCaptcha,
  type DesktopUpdateInfo,
  type DesktopUpdateProgress,
  type ImageFrameRatio,
  type ImageResolutionPreset,
  type ModelProvider,
  type ServerPublicSettings,
} from "./core";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  DeferredNumberInput,
  DrawerShell,
  Field,
  GlassSelect,
  IconActionButton,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceSection,
  StatusLine,
} from "./ui";
import {
  applyGlassAppearance,
  fetchServerModelSettings,
  fullServerModelList,
  preferredAgentModelFromList,
  preferredImageModelFromList,
  preferredVideoModelFromList,
} from "./settings-runtime";
import type { HelpCenterSection } from "./help-center";
import { appAccessPolicy, enforceRendererAccessPolicy } from "./access-policy";

const LazyModelConfigDialog = React.lazy(() => import("./model-config-dialog"));
const LazyGlassLab = React.lazy(() => import("./glass-lab"));
const LazyPluginSettingsPanel = React.lazy(() => import("./plugin-settings-panel"));
const LazyCanvasToolsSettingsPanel = React.lazy(() => import("./canvas-tools-settings-panel"));
const CLOSE_BUTTON_REASON = "close-button" as const;
export type SettingsSection = "access" | "appearance" | "models" | "agent" | "tools" | "plugins" | "updates";

function formatSettingsBytes(value?: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatModelCheckedAt(value?: string) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "尚未检查";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function modelServiceStateCopy(status?: NonNullable<ServerPublicSettings["serviceStatuses"]>[ModelProvider]) {
  if (!status) return "尚未检查接入状态";
  if (status.state === "ready") return `目录与当前接入可用 · ${formatModelCheckedAt(status.lastCheckedAt)}`;
  if (status.state === "catalog-only") return `目录可用，当前 Token 尚未真实连通 · ${formatModelCheckedAt(status.lastCheckedAt)}`;
  return `当前接入不可用 · ${formatModelCheckedAt(status.lastCheckedAt)}`;
}

function modelServiceStateLabel(status?: NonNullable<ServerPublicSettings["serviceStatuses"]>[ModelProvider]) {
  if (!status) return "待检查";
  if (status.state === "ready") return "可用";
  if (status.state === "catalog-only") return "仅目录";
  return "不可用";
}

function modelProviderLabel(provider: ModelProvider) {
  if (provider === "agent") return "对话";
  if (provider === "video") return "视频";
  return "生图";
}

function modelAccessProfileStats(profile: NonNullable<ServerPublicSettings["modelAccessProfiles"]>[number]) {
  const capabilities = Object.values(profile.capabilities || {});
  const verified = capabilities.filter((capability) => capability.evidence === "runtime-verified");
  const declared = capabilities.filter((capability) => capability.evidence === "upstream-declared");
  const inferred = capabilities.filter((capability) => capability.evidence === "name-inferred");
  const verifiedTimestamps = verified
    .map((capability) => capability.lastVerifiedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastVerifiedAt = verifiedTimestamps[verifiedTimestamps.length - 1];
  return { verified: verified.length, declared: declared.length, inferred: inferred.length, lastVerifiedAt };
}

export default function SettingsDrawer({
  settings,
  saveSettings,
  initialUpdateInfo,
  initialSection = "access",
  openPromptEditor,
  openHelp,
  close
}: {
  settings: AppSettings;
  saveSettings: (settings: AppSettings) => Promise<void>;
  initialUpdateInfo?: DesktopUpdateInfo | null;
  initialSection?: SettingsSection;
  openPromptEditor: () => void;
  openHelp?: (section: HelpCenterSection) => void;
  close: () => void;
}) {
  const [baselineSettings, setBaselineSettings] = useState(() => enforceRendererAccessPolicy(mergeSettings(settings)));
  const [draftSettings, setDraftSettings] = useState(() => enforceRendererAccessPolicy(mergeSettings(settings)));
  const [modelConfigTarget, setModelConfigTarget] = useState<ModelProvider | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsMessageError, setSettingsMessageError] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(initialUpdateInfo || null);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateError, setUpdateError] = useState(false);
  const [installerCaptcha, setInstallerCaptcha] = useState<DesktopInstallerCaptcha | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [accountTokens, setAccountTokens] = useState<AccountApiToken[]>([]);
  const [accountTokenBaseUrl, setAccountTokenBaseUrl] = useState("");
  const [accountTokenBusy, setAccountTokenBusy] = useState(false);
  const [accountTokenError, setAccountTokenError] = useState("");
  const [accountTokenSnapshot, setAccountTokenSnapshot] = useState({
    loaded: false,
    cached: false,
    available: false,
    updatedAt: 0
  });
  const [accountTokenEditor, setAccountTokenEditor] = useState<{
    mode: "create" | "edit";
    id: string;
    name: string;
    group: string;
    status: number;
    unlimitedQuota: boolean;
    remainQuota: string;
  } | null>(null);
  const [accountTokenDeleteArmed, setAccountTokenDeleteArmed] = useState("");
  const [integrationTargets, setIntegrationTargets] = useState<AgentIntegrationTarget[]>([]);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState("");
  const modelLoadRef = useRef<Promise<void> | null>(null);
  const pendingModelRefreshRef = useRef<{ force: boolean; group: string; cacheOnly: boolean } | null>(null);
  const captchaRequestEpochRef = useRef(0);
  const captchaRequestInFlightRef = useRef(false);
  const savedAppearanceRef = useRef(baselineSettings);
  savedAppearanceRef.current = baselineSettings;
  const [modelState, setModelState] = useState<{
    loading: boolean;
    refreshing: boolean;
    imageModels: string[];
    agentModels: string[];
    videoModels: string[];
    groups: NonNullable<ServerPublicSettings["modelGroups"]>;
    accessProfiles: NonNullable<ServerPublicSettings["modelAccessProfiles"]>;
    serviceStatuses: NonNullable<ServerPublicSettings["serviceStatuses"]>;
    error: string;
    cacheSource?: ServerPublicSettings["cacheSource"];
    cacheAgeMs?: number;
  }>(() => ({
    loading: false,
    refreshing: false,
    imageModels: imageModelsWithPreferredFallback([], draftSettings.imageModel, selectedImageModelsFromSettings(draftSettings)),
    agentModels: modelsWithPreferred([], draftSettings.agentModel, selectedAgentModelsFromSettings(draftSettings)),
    videoModels: modelsWithPreferred([], draftSettings.videoModel, selectedVideoModelsFromSettings(draftSettings)),
    groups: [],
    accessProfiles: [],
    serviceStatuses: {},
    error: "",
    cacheSource: undefined,
    cacheAgeMs: undefined
  }));
  const dirty = JSON.stringify(draftSettings) !== JSON.stringify(baselineSettings);

  useEffect(() => {
    applyGlassAppearance(draftSettings);
  }, [
    draftSettings.glassTheme,
    draftSettings.glassMaterial,
    draftSettings.glassParameters,
    draftSettings.glassBackgroundEnabled,
    draftSettings.glassBackgroundAssetId,
    draftSettings.glassBackgroundAssetName,
    draftSettings.glassBackgroundOverlay,
    draftSettings.glassBackgroundBlur,
  ]);

  useEffect(() => () => {
    applyGlassAppearance(savedAppearanceRef.current);
  }, []);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraftSettings((current) => ({ ...current, [key]: value }));
    setSettingsMessage("");
    setResetArmed(false);
  }

  function updateImageFrame(patch: { ratio?: ImageFrameRatio; resolution?: ImageResolutionPreset }) {
    setDraftSettings((current) => {
      const imageRatio = patch.ratio ?? current.imageRatio;
      const imageResolution = patch.resolution ?? current.imageResolution;
      return {
        ...current,
        imageRatio,
        imageResolution,
        imageSize: computedSizeFor(imageRatio, imageResolution)
      };
    });
    setSettingsMessage("");
    setResetArmed(false);
  }

  function replaceDraftSettings(next: AppSettings) {
    setDraftSettings(next);
    setSettingsMessage("");
    setSettingsMessageError(false);
    setResetArmed(false);
  }

  function updateCustomApiCredentials(kind: "baseUrl" | "apiKey", value: string) {
    setDraftSettings((current) => kind === "baseUrl"
      ? { ...current, agentBaseUrl: value, imageBaseUrl: value }
      : { ...current, agentApiKey: value, imageApiKey: value });
    setSettingsMessage("");
    setResetArmed(false);
  }

  async function refreshModels(forceRefresh = false, group = draftSettings.modelGroup, cacheOnly = false): Promise<void> {
    if (modelLoadRef.current) {
      const pending = pendingModelRefreshRef.current;
      pendingModelRefreshRef.current = {
        force: Boolean(forceRefresh || pending?.force),
        group: String(group || ""),
        cacheOnly: Boolean(cacheOnly && (pending?.cacheOnly ?? true))
      };
      const activeRequest = modelLoadRef.current;
      return activeRequest.then(async () => {
        const queued = pendingModelRefreshRef.current;
        if (!queued) return;
        pendingModelRefreshRef.current = null;
        await refreshModels(queued.force, queued.group, queued.cacheOnly);
      });
    }
    setModelState((current) => {
      const hasVisibleCatalog = current.agentModels.length > 0 || current.imageModels.length > 0 || current.videoModels.length > 0;
      return {
        ...current,
        loading: !hasVisibleCatalog,
        refreshing: hasVisibleCatalog,
        error: forceRefresh ? "" : current.error
      };
    });
    const request = (async () => {
      try {
        const serverSettings = await fetchServerModelSettings(forceRefresh, group, cacheOnly);
        const serverModels = fullServerModelList(serverSettings);
        const imageCatalog = serverSettings.imageModels?.length ? serverSettings.imageModels : serverModels;
        const agentCatalog = serverSettings.agentModels?.length ? serverSettings.agentModels : serverModels;
        const videoCatalog = serverSettings.videoModels?.length ? serverSettings.videoModels : selectedVideoModelsFromSettings(draftSettings);
        const imageModels = imageModelsWithPreferredFallback(imageCatalog, serverSettings.imageModel || draftSettings.imageModel, draftSettings.imageModelPool);
        const agentModels = modelsWithPreferred(agentCatalog, draftSettings.agentModel, draftSettings.agentModelPool);
        const videoModels = modelsWithPreferred(videoCatalog, serverSettings.videoModel || draftSettings.videoModel, draftSettings.videoModelPool);
        const preferredImageModel = preferredImageModelFromList(imageModels);
        const preferredAgentModel = preferredAgentModelFromList(agentModels);
        const preferredVideoModel = preferredVideoModelFromList(videoModels);
        setModelState({
          loading: false,
          refreshing: false,
          imageModels,
          agentModels,
          videoModels,
          groups: serverSettings.modelGroups ?? [],
          accessProfiles: serverSettings.modelAccessProfiles ?? [],
          serviceStatuses: serverSettings.serviceStatuses ?? {},
          error: "",
          cacheSource: serverSettings.cacheSource,
          cacheAgeMs: serverSettings.cacheAgeMs
        });
        setDraftSettings((current) =>
          normalizeModelPoolSelections(
            {
              ...current,
              modelGroup: serverSettings.modelGroup ?? current.modelGroup,
              imageModel: current.imageModel || serverSettings.imageModel || preferredImageModel,
              imageModelPool: current.imageModelPool?.length ? current.imageModelPool : [current.imageModel || serverSettings.imageModel || preferredImageModel],
              agentModel: current.agentModel || preferredAgentModel,
              agentModelPool: current.agentModelPool?.length ? current.agentModelPool : [current.agentModel || preferredAgentModel],
              videoModel: current.videoModel || serverSettings.videoModel || preferredVideoModel,
              videoModelPool: current.videoModelPool?.length ? current.videoModelPool : [current.videoModel || serverSettings.videoModel || preferredVideoModel]
            },
            agentModels,
            imageModels,
            videoModels
          )
        );
      } catch (error) {
        setModelState((current) => ({ ...current, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        modelLoadRef.current = null;
      }
    })();
    modelLoadRef.current = request;
    return request;
  }

  async function refreshAccountTokens(options: { preferCached?: boolean } = {}): Promise<AccountApiToken | undefined> {
    if (draftSettings.accessMode !== "account" || !window.naimageServer?.tokens) return;
    setAccountTokenBusy(true);
    setAccountTokenError("");
    try {
      const result = await window.naimageServer.tokens({ preferCached: options.preferCached === true });
      if (!result.ok) throw new Error(result.error || "无法获取账户密钥。");
      const tokens = result.tokens ?? [];
      setAccountTokens(tokens);
      setAccountTokenBaseUrl(result.baseUrl || `${draftSettings.accountBaseUrl.replace(/\/+$/, "")}/v1`);
      setAccountTokenSnapshot({
        loaded: true,
        cached: result.cached === true,
        available: result.cacheAvailable === true,
        updatedAt: Math.max(0, Number(result.cacheUpdatedAt) || 0)
      });
      const selected = tokens.find((token) => token.id === result.selectedTokenId);
      if (selected) syncSelectedAccountToken(selected);
      return selected;
    } catch (error) {
      setAccountTokens([]);
      setAccountTokenSnapshot((current) => ({ ...current, loaded: true }));
      setAccountTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountTokenBusy(false);
    }
  }

  async function refreshAccountAccess() {
    const selected = await refreshAccountTokens();
    await refreshModels(true, selected?.group || draftSettings.selectedAccountTokenGroup || draftSettings.modelGroup);
  }

  useEffect(() => {
    void (async () => {
      await refreshModels(false, draftSettings.modelGroup, true);
      await refreshModels(false, draftSettings.modelGroup, false);
    })();
    if (draftSettings.accessMode === "account" && draftSettings.serverUserId) {
      void refreshAccountTokens({ preferCached: true });
    }
  }, []);

  function syncSelectedAccountToken(token?: AccountApiToken | null) {
    const patch = {
      selectedAccountTokenId: token?.id || "",
      selectedAccountTokenName: token?.name || "",
      selectedAccountTokenGroup: token?.group || "",
      modelGroup: token?.group || ""
    };
    setDraftSettings((current) => ({ ...current, ...patch }));
    setBaselineSettings((current) => ({ ...current, ...patch }));
  }

  async function selectAccountToken(id: string) {
    if (!window.naimageServer?.selectToken) return;
    setAccountTokenBusy(true);
    setAccountTokenError("");
    try {
      const result = await window.naimageServer.selectToken({ id });
      if (!result.ok) throw new Error(result.error || "选择密钥失败。");
      const token = result.token || accountTokens.find((item) => item.id === result.selectedTokenId);
      syncSelectedAccountToken(token);
      setAccountTokenBaseUrl(result.baseUrl || accountTokenBaseUrl);
      await refreshModels(true, token?.group || "");
    } catch (error) {
      setAccountTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountTokenBusy(false);
    }
  }

  function openAccountTokenEditor(token?: AccountApiToken) {
    setAccountTokenDeleteArmed("");
    setAccountTokenEditor(token ? {
      mode: "edit",
      id: token.id,
      name: token.name,
      group: token.group || "default",
      status: token.status,
      unlimitedQuota: token.unlimitedQuota,
      remainQuota: String(token.remainQuota)
    } : {
      mode: "create",
      id: "",
      name: "SparkAI WorkSpace",
      group: draftSettings.selectedAccountTokenGroup || draftSettings.modelGroup || "default",
      status: 1,
      unlimitedQuota: true,
      remainQuota: "0"
    });
  }

  async function saveAccountTokenEditor() {
    if (!accountTokenEditor || !accountTokenEditor.name.trim()) return;
    const bridge = window.naimageServer;
    if (!bridge) return;
    setAccountTokenBusy(true);
    setAccountTokenError("");
    try {
      const payload = {
        name: accountTokenEditor.name.trim(),
        group: accountTokenEditor.group.trim() || "default",
        status: accountTokenEditor.status,
        unlimitedQuota: accountTokenEditor.unlimitedQuota,
        remainQuota: Math.max(0, Math.floor(Number(accountTokenEditor.remainQuota) || 0)),
        crossGroupRetry: true
      };
      const result = accountTokenEditor.mode === "create"
        ? await bridge.createToken?.({ ...payload, select: true })
        : await bridge.updateToken?.({ id: accountTokenEditor.id, ...payload });
      if (!result?.ok) throw new Error(result?.error || "保存密钥失败。");
      setAccountTokenEditor(null);
      await refreshAccountTokens();
      await refreshModels(true, payload.group);
    } catch (error) {
      setAccountTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountTokenBusy(false);
    }
  }

  async function deleteAccountToken(id: string) {
    if (accountTokenDeleteArmed !== id) {
      setAccountTokenDeleteArmed(id);
      return;
    }
    if (!window.naimageServer?.deleteToken) return;
    setAccountTokenBusy(true);
    setAccountTokenError("");
    try {
      const result = await window.naimageServer.deleteToken({ id });
      if (!result.ok) throw new Error(result.error || "删除密钥失败。");
      setAccountTokenEditor(null);
      setAccountTokenDeleteArmed("");
      syncSelectedAccountToken(null);
      await refreshAccountTokens();
    } catch (error) {
      setAccountTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountTokenBusy(false);
    }
  }

  async function detectAgentIntegrations() {
    if (!window.naimageAgentIntegrations) return;
    setIntegrationBusy(true);
    setIntegrationError("");
    try {
      const result = await window.naimageAgentIntegrations.detect();
      if (!result.ok) throw new Error(result.error || "无法检测 Agent 配置目录。");
      setIntegrationTargets(result.targets ?? []);
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIntegrationBusy(false);
    }
  }

  useEffect(() => {
    if (activeSection === "agent") void detectAgentIntegrations();
  }, [activeSection, draftSettings.accessMode]);

  async function mutateAgentIntegrations(action: "install" | "remove") {
    const bridge = window.naimageAgentIntegrations;
    if (!bridge) return;
    const targets = draftSettings.agentSkillAutoInstallTargets;
    if (!targets.length) {
      setIntegrationError("请先勾选至少一个 Agent。");
      return;
    }
    setIntegrationBusy(true);
    setIntegrationError("");
    try {
      const result = action === "install" ? await bridge.install({ targets }) : await bridge.remove({ targets });
      if (!result.ok && result.errors?.length) throw new Error(result.errors.join("；"));
      setIntegrationTargets(result.targets ?? []);
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIntegrationBusy(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    window.naimageUpdater?.status().then((result) => {
      if (!disposed) {
        setUpdateInfo(result);
        if (result.progress) {
          setUpdateProgress(result.progress);
          if (result.progress.message) setUpdateMessage(result.progress.message);
          setUpdateError(result.progress.stage === "error");
        }
        if (result.rollbackDetected) {
          setUpdateMessage(result.progress?.message || result.recovery?.reason || "新版本启动失败，已自动恢复。请改用完整安装包完成升级。");
          setUpdateError(true);
        }
      }
    }).catch(() => undefined);
    const unsubscribe = window.naimageUpdater?.onProgress?.((progress) => {
      if (disposed) return;
      setUpdateProgress(progress);
      setUpdateInfo((current) => current ? {
        ...current,
        busy: ["checking", "downloading", "retrying", "verifying", "applying"].includes(progress.stage)
      } : current);
      if (progress.message) setUpdateMessage(progress.message);
      setUpdateError(progress.stage === "error");
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  function handleManualModelRefresh() {
    void refreshModels(true);
  }

  async function commitSettings(closeAfterSave = false) {
    setSaving(true);
    setSettingsMessage("");
    setSettingsMessageError(false);
    try {
      const normalized = enforceRendererAccessPolicy(mergeSettings(draftSettings));
      await saveSettings(normalized);
      savedAppearanceRef.current = normalized;
      setDraftSettings(normalized);
      setBaselineSettings(normalized);
      setResetArmed(false);
      setSettingsMessage("设置已保存");
      if (closeAfterSave) {
        setClosePromptOpen(false);
        close();
      }
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
      setSettingsMessageError(true);
    } finally {
      setSaving(false);
    }
  }

  function restoreDefaults() {
    if (!resetArmed) {
      setResetArmed(true);
      setSettingsMessage("再次点击“确认恢复默认”后生成默认设置草稿。");
      setSettingsMessageError(false);
      return;
    }
    const defaults = enforceRendererAccessPolicy(mergeSettings(defaultSettings));
    setDraftSettings(defaults);
    setResetArmed(false);
    setSettingsMessage("已恢复为默认设置草稿，点击保存后生效。");
    setSettingsMessageError(false);
  }

  function discardAndClose() {
    applyGlassAppearance(baselineSettings);
    setClosePromptOpen(false);
    close();
  }

  function requestSettingsClose() {
    if (saving) return;
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  async function checkForUpdates() {
    if (!window.naimageUpdater) {
      setUpdateMessage("当前运行环境不支持在线更新。");
      setUpdateError(true);
      return;
    }
    setUpdateBusy(true);
    setUpdateError(false);
    setUpdateMessage("正在安全检查新版本…");
    setInstallerCaptcha(null);
    setCaptchaCode("");
    try {
      const result = await window.naimageUpdater.check();
      setUpdateInfo(result);
      if (!result.ok) throw new Error(result.error || "检查更新失败。");
      if (result.rollbackDetected) {
        setUpdateProgress(result.progress || null);
        setUpdateMessage(result.progress?.message || result.recovery?.reason || `已切换为 ${result.latestVersion || "新版"} 完整安装恢复。`);
        setUpdateError(true);
      } else {
        setUpdateMessage(result.updateAvailable ? `发现新版本 ${result.latestVersion}` : "当前已是最新版本。");
      }
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setUpdateError(true);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function loadInstallerCaptcha() {
    if (!window.naimageUpdater) return;
    if (captchaRequestInFlightRef.current) return;
    captchaRequestInFlightRef.current = true;
    const requestEpoch = ++captchaRequestEpochRef.current;
    setUpdateBusy(true);
    setUpdateError(false);
    setUpdateMessage("正在获取升级验证码…");
    try {
      const result = await window.naimageUpdater.createInstallerCaptcha();
      if (captchaRequestEpochRef.current !== requestEpoch) return;
      if (!result.ok) throw new Error(result.error || "验证码获取失败。");
      setInstallerCaptcha(result);
      setCaptchaCode("");
      setUpdateMessage("请输入验证码，授权下载完整安装包。");
    } catch (error) {
      if (captchaRequestEpochRef.current !== requestEpoch) return;
      setInstallerCaptcha(null);
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setUpdateError(true);
    } finally {
      if (captchaRequestEpochRef.current === requestEpoch) {
        captchaRequestInFlightRef.current = false;
        setUpdateBusy(false);
      }
    }
  }

  async function downloadRestartUpdate() {
    if (!window.naimageUpdater) return;
    setUpdateBusy(true);
    setUpdateError(false);
    try {
      const result = await window.naimageUpdater.downloadRestart();
      if (!result.ok) throw new Error(result.error || "更新下载失败。");
      setUpdateInfo((current) => ({ ...(current || { ok: true }), pending: result.pending || null }));
      setUpdateMessage("更新已就绪，重启后生效。");
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setUpdateError(true);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function authorizeInstallerDownload() {
    if (!window.naimageUpdater || !installerCaptcha?.challengeId || captchaCode.length !== 6) return;
    setUpdateBusy(true);
    setUpdateError(false);
    try {
      const result = await window.naimageUpdater.downloadInstaller({ challengeId: installerCaptcha.challengeId, code: captchaCode });
      if (!result.ok) throw new Error(result.error || "安装包下载失败。");
      setUpdateInfo((current) => ({ ...(current || { ok: true }), pending: result.pending || null }));
      setInstallerCaptcha(null);
      setCaptchaCode("");
      setUpdateMessage("安装包已下载并通过完整性校验。");
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setUpdateError(true);
      await loadInstallerCaptcha();
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installReadyUpdate() {
    if (!window.naimageUpdater || !updateInfo?.pending) return;
    setUpdateBusy(true);
    setUpdateError(false);
    try {
      const result = updateInfo.pending.kind === "restart"
        ? await window.naimageUpdater.applyRestart()
        : await window.naimageUpdater.launchInstaller();
      if (!result.ok) throw new Error(result.error || "无法启动更新。");
      setUpdateMessage(updateInfo.pending.kind === "restart" ? "正在重启并完成更新…" : "正在退出并启动新版安装器…");
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setUpdateError(true);
      setUpdateBusy(false);
    }
  }

  const selectedImageModels = selectedImageModelsFromSettings(draftSettings);
  const selectedAgentModels = selectedAgentModelsFromSettings(draftSettings);
  const selectedVideoModels = selectedVideoModelsFromSettings(draftSettings);
  const visibleImageModels = imageModelsWithPreferredFallback(modelState.imageModels, draftSettings.imageModel, selectedImageModels);
  const visibleAgentModels = modelsWithPreferred(modelState.agentModels, draftSettings.agentModel, selectedAgentModels);
  const visibleVideoModels = modelsWithPreferred(modelState.videoModels, draftSettings.videoModel, selectedVideoModels);
  const pendingMatchesLatest = Boolean(updateInfo?.pending && updateInfo.pending.version === updateInfo.latestVersion);
  const updateOperationBusy = updateBusy || Boolean(updateInfo?.busy);
  let updateActionLabel = "检查更新";
  if (pendingMatchesLatest) updateActionLabel = updateInfo?.pending?.kind === "restart" ? "重启并更新" : "启动安装程序";
  else if (updateInfo?.updateType === "restart" && updateInfo.updateAvailable) updateActionLabel = "下载重启更新";
  else if (updateInfo?.updateType === "installer" && updateInfo.updateAvailable) updateActionLabel = "验证并下载安装包";

  async function runUpdateAction() {
    if (updateOperationBusy) return;
    if (pendingMatchesLatest) {
      await installReadyUpdate();
      return;
    }
    if (updateInfo?.updateType === "restart" && updateInfo.updateAvailable) {
      await downloadRestartUpdate();
      return;
    }
    if (updateInfo?.updateType === "installer" && updateInfo.updateAvailable) {
      await loadInstallerCaptcha();
      return;
    }
    await checkForUpdates();
  }

  return (
    <>
      <DrawerShell
        surface="settings"
        ariaLabel="设置"
        className="settings-drawer"
        busy={saving}
        dirty={dirty}
        closePolicy={{ escape: "when-idle", backdrop: "when-idle", [CLOSE_BUTTON_REASON]: "when-idle" }}
        onCloseBlocked={() => {
          setSettingsMessage("正在处理设置，请稍候再关闭。");
          setSettingsMessageError(false);
        }}
        onRequestClose={requestSettingsClose}
      >
        {({ requestClose }) => (
          <>
            <SurfaceHeader
              title="设置"
              description="服务接入、外观、模型、Agent、画布工具与软件更新"
              onClose={() => requestClose(CLOSE_BUTTON_REASON)}
              closeLabel="关闭设置"
              closeDisabled={saving}
            />
            <nav className="settings-section-tabs" aria-label="设置分类">
              {([
                ["access", "接入"],
                ["appearance", "外观"],
                ["models", "模型"],
                ["agent", "Agent"],
                ["tools", "工具"],
                ["plugins", "插件"],
                ["updates", "更新"]
              ] as const).map(([section, label]) => (
                <ButtonBase
                  key={section}
                  type="button"
                  className={`ui-segment-action settings-section-tab ${activeSection === section ? "active" : ""}`}
                  aria-pressed={activeSection === section}
                  onClick={() => setActiveSection(section)}
                >
                  {label}
                </ButtonBase>
              ))}
            </nav>
            <SurfaceBody className="settings-surface-body">
              {activeSection === "access" ? (
              <SurfaceSection className="settings-surface-section settings-access-section" aria-labelledby="settings-access-heading">
                <div className="settings-section-header">
                  <h3 id="settings-access-heading">服务接入</h3>
                  <span className="settings-update-status available">{appAccessPolicy.customApiAccess && draftSettings.accessMode === "custom" ? "自定义接口" : "账号模式"}</span>
                </div>
                {appAccessPolicy.customApiAccess ? (
                  <Field label="使用方式">
                    <select value={draftSettings.accessMode} onChange={(event) => update("accessMode", event.target.value as AppSettings["accessMode"])}>
                      <option value="account">SparkAPI 账号登录</option>
                      <option value="custom">自定义 Base URL / API Key</option>
                    </select>
                  </Field>
                ) : <InlineNotice tone="neutral">当前为 SparkAPI 专用发行版，只允许官方账号登录。</InlineNotice>}
                {draftSettings.accessMode === "account" ? (
                  <>
                    <Field label="账户服务地址">
                      <input
                        value={appAccessPolicy.accountBaseUrlLocked ? appAccessPolicy.officialAccountBaseUrl : draftSettings.accountBaseUrl}
                        onChange={(event) => update("accountBaseUrl", event.target.value)}
                        type="url"
                        placeholder="https://sparkapi.org"
                        readOnly={appAccessPolicy.accountBaseUrlLocked}
                        aria-readonly={appAccessPolicy.accountBaseUrlLocked}
                      />
                    </Field>
                    <div className="settings-account-token-section">
                      <div className="settings-section-header settings-account-token-header">
                        <div>
                          <strong>账户密钥</strong>
                          <small>{accountTokenBaseUrl || `${draftSettings.accountBaseUrl.replace(/\/+$/, "")}/v1`}</small>
                        </div>
                        <div className="settings-inline-actions">
                          <IconActionButton label="刷新密钥与分组" icon={<RotateCcw size={14} />} onClick={() => void refreshAccountAccess()} disabled={accountTokenBusy || modelState.loading} />
                          <ActionButton variant="secondary" icon={<Plus size={14} />} onClick={() => openAccountTokenEditor()}>新建密钥</ActionButton>
                        </div>
                      </div>
                      {accountTokenError ? <InlineNotice tone="danger">{accountTokenError}</InlineNotice> : null}
                      {!accountTokenBusy && !accountTokenError && accountTokenSnapshot.loaded ? (
                        <InlineNotice tone="neutral">
                          {accountTokenSnapshot.available && accountTokenSnapshot.updatedAt > 0
                            ? `${accountTokenSnapshot.cached ? "本地快照" : "账户数据"}更新于 ${new Date(accountTokenSnapshot.updatedAt).toLocaleString("zh-CN", { hour12: false })}。`
                            : "尚无本地密钥快照，请点击“刷新密钥与分组”。"}
                        </InlineNotice>
                      ) : null}
                      {accountTokens.length ? (
                        <Field label="当前使用密钥">
                          <GlassSelect
                            value={draftSettings.selectedAccountTokenId}
                            disabled={accountTokenBusy}
                            ariaLabel="当前使用密钥"
                            onChange={(value) => void selectAccountToken(value)}
                            options={[
                              { value: "", label: "请选择密钥" },
                              ...(
                                draftSettings.selectedAccountTokenId && !accountTokens.some((token) => token.id === draftSettings.selectedAccountTokenId)
                                  ? [{ value: draftSettings.selectedAccountTokenId, label: `密钥 #${draftSettings.selectedAccountTokenId} · 元数据未加载` }]
                                  : []
                              ),
                              ...accountTokens.map((token) => ({
                                value: token.id,
                                label: `${token.name} · ${token.group || "default"}${token.status !== 1 ? " · 已停用" : ""}`,
                                disabled: token.status !== 1
                              }))
                            ]}
                          />
                        </Field>
                      ) : !accountTokenBusy && !accountTokenError && accountTokenSnapshot.available ? <InlineNotice tone="neutral">当前账户还没有密钥，请新建一枚后使用。</InlineNotice> : null}
                      {accountTokens.find((token) => token.id === draftSettings.selectedAccountTokenId) ? (() => {
                        const token = accountTokens.find((item) => item.id === draftSettings.selectedAccountTokenId)!;
                        return (
                          <div className="settings-account-token-summary">
                            <span>分组 <strong>{token.group || "default"}</strong></span>
                            <span>状态 <strong>{token.status === 1 ? "启用" : "停用"}</strong></span>
                            <span className="settings-account-token-quota">
                              额度
                              <strong title={token.quotaAuditLabel}>{token.unlimitedQuota ? "不限" : token.remainCnyDisplay}</strong>
                              {!token.unlimitedQuota ? <small>{token.remainRDisplay} R · 原始 {token.remainQuota.toLocaleString("zh-CN")}</small> : null}
                            </span>
                            <IconActionButton label="编辑当前密钥" icon={<Settings size={14} />} onClick={() => openAccountTokenEditor(token)} />
                          </div>
                        );
                      })() : null}
                      {accountTokenEditor ? (
                        <div className="settings-account-token-editor">
                          <Field label="密钥名称">
                            <input value={accountTokenEditor.name} maxLength={50} onChange={(event) => setAccountTokenEditor((current) => current ? { ...current, name: event.target.value } : current)} />
                          </Field>
                          <Field label="密钥分组">
                            <input value={accountTokenEditor.group} list="naimage-token-groups" onChange={(event) => setAccountTokenEditor((current) => current ? { ...current, group: event.target.value } : current)} placeholder="default" />
                          </Field>
                          <datalist id="naimage-token-groups">
                            {modelState.groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                          </datalist>
                          <label className="settings-checkbox-row">
                            <input type="checkbox" checked={accountTokenEditor.status === 1} onChange={(event) => setAccountTokenEditor((current) => current ? { ...current, status: event.target.checked ? 1 : 2 } : current)} />
                            <span>启用密钥</span>
                          </label>
                          <label className="settings-checkbox-row">
                            <input type="checkbox" checked={accountTokenEditor.unlimitedQuota} onChange={(event) => setAccountTokenEditor((current) => current ? { ...current, unlimitedQuota: event.target.checked } : current)} />
                            <span>不限额度</span>
                          </label>
                          {!accountTokenEditor.unlimitedQuota ? <Field label="原始额度（New API quota）">
                            <input type="number" min="0" step="1" value={accountTokenEditor.remainQuota} onChange={(event) => setAccountTokenEditor((current) => current ? { ...current, remainQuota: event.target.value } : current)} />
                          </Field> : null}
                          <div className="settings-inline-actions">
                            <ActionButton variant="primary" onClick={() => void saveAccountTokenEditor()} busy={accountTokenBusy}>保存密钥</ActionButton>
                            <ActionButton onClick={() => setAccountTokenEditor(null)}>取消</ActionButton>
                            {accountTokenEditor.mode === "edit" ? (
                              <ActionButton variant={accountTokenDeleteArmed === accountTokenEditor.id ? "danger" : "secondary"} onClick={() => void deleteAccountToken(accountTokenEditor.id)}>
                                {accountTokenDeleteArmed === accountTokenEditor.id ? "确认删除" : "删除"}
                              </ActionButton>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <InlineNotice tone="neutral">Cookie 只用于账户与密钥管理；Agent 和生图使用所选密钥直连上方 `/v1` 地址。完整 Key 仅保留在 Electron 主进程内存中。</InlineNotice>
                  </>
                ) : (
                  <>
                    <Field label="Base URL">
                      <input value={draftSettings.agentBaseUrl} onChange={(event) => updateCustomApiCredentials("baseUrl", event.target.value)} type="url" placeholder="https://example.com/v1" />
                    </Field>
                    <Field label="API Key">
                      <input value={draftSettings.agentApiKey} onChange={(event) => updateCustomApiCredentials("apiKey", event.target.value)} type="password" placeholder="sk-..." autoComplete="off" />
                    </Field>
                    <InlineNotice tone="neutral">同一组凭证用于 Agent 与生图；模型名称仍在“模型”页选择。</InlineNotice>
                  </>
                )}
                <Field label="网络代理（可选）">
                  <input
                    value={draftSettings.networkProxyUrl}
                    onChange={(event) => update("networkProxyUrl", event.target.value)}
                    type="url"
                    placeholder="http://127.0.0.1:7897"
                    autoComplete="off"
                  />
                </Field>
                <InlineNotice tone="neutral">留空时使用 Node 直连；填写后仅 SparkAI WorkSpace 的服务请求使用该代理，不修改 Git 或系统全局代理。</InlineNotice>
              </SurfaceSection>
              ) : null}

              {activeSection === "appearance" ? (
              <SurfaceSection className="settings-surface-section settings-appearance-section" aria-labelledby="settings-appearance-heading">
                <div className="settings-section-header">
                  <div>
                    <h3 id="settings-appearance-heading" className="settings-appearance-title">Glass Lab</h3>
                    <small>配置项目界面的透明玻璃主题、材质与辅助效果。</small>
                  </div>
                  <span className="settings-update-status available">项目外观</span>
                </div>
                <React.Suspense fallback={<InlineNotice tone="neutral">正在载入外观设置…</InlineNotice>}>
                  <LazyGlassLab settings={draftSettings} onChange={replaceDraftSettings} />
                </React.Suspense>
              </SurfaceSection>
              ) : null}

              {activeSection === "models" ? (
              <SurfaceSection className="settings-surface-section settings-model-section" aria-labelledby="settings-model-heading">
                <div className="settings-section-header">
                  <h3 id="settings-model-heading">模型配置</h3>
                  <ActionButton
                    variant="secondary"
                    className="settings-refresh-action"
                    onClick={handleManualModelRefresh}
                    busy={modelState.loading || modelState.refreshing}
                    icon={<RotateCcw size={15} />}
                    aria-label="获取模型"
                  >
                    刷新模型
                  </ActionButton>
                </div>
                {modelState.error ? <InlineNotice className="setting-error" tone="danger">{modelState.error}</InlineNotice> : null}
                {!modelState.error && modelState.cacheSource ? (
                  <InlineNotice tone="neutral">
                    {modelState.cacheSource === "network"
                      ? "模型与分组已从服务端刷新，并保存为本地快照。"
                      : modelState.cacheSource === "settings"
                        ? "当前使用已保存的模型配置；点击“刷新模型”后才会访问服务端。"
                        : `当前使用本地模型快照${modelState.cacheAgeMs !== undefined ? `（约 ${Math.max(0, Math.round(modelState.cacheAgeMs / 60_000))} 分钟前更新）` : ""}；点击“刷新模型”可获取最新数据。`}
                  </InlineNotice>
                ) : null}
                {draftSettings.accessMode === "account"
                  ? <InlineNotice tone="neutral">当前分组由所选账户密钥决定：{draftSettings.selectedAccountTokenGroup || "尚未选择密钥"}。如需切换分组，请在“接入”页编辑或选择对应密钥。</InlineNotice>
                  : <InlineNotice tone="neutral">自定义接口模式直接使用 API Key 对应权限，不发送 SparkAPI 模型分组。</InlineNotice>}
                <div className="settings-model-access-block">
                  <div className="settings-model-access-head">
                    <div>
                      <strong>接入兼容性画像</strong>
                      <small>区分上游声明、名称推断与真实调用验证；不会显示完整 Token。</small>
                    </div>
                    {modelState.refreshing ? <span>后台刷新中</span> : null}
                  </div>
                  {modelState.accessProfiles.length ? (
                    <div className="settings-model-access-list">
                      {modelState.accessProfiles.map((profile) => {
                        const stats = modelAccessProfileStats(profile);
                        return (
                          <article key={profile.id} className={`settings-model-access-card ${profile.error ? "has-error" : ""}`}>
                            <div className="settings-model-access-title">
                              <strong>{profile.label}</strong>
                              <span>{profile.credentialLabel || "未命名凭证"}</span>
                            </div>
                            <small className="settings-model-access-url" title={profile.baseUrl}>{profile.baseUrl || "未提供 Base URL"}</small>
                            <div className="settings-model-access-meta">
                              <span>{profile.providers.map(modelProviderLabel).join(" / ") || "未识别服务"}</span>
                              <span>真实验证 {stats.verified}</span>
                              <span>上游声明 {stats.declared}</span>
                              <span>名称推断 {stats.inferred}</span>
                            </div>
                            <small className="settings-model-access-time">
                              最后检查 {formatModelCheckedAt(profile.lastCheckedAt)} · 最后真实验证 {formatModelCheckedAt(stats.lastVerifiedAt)}
                            </small>
                            {profile.error ? <small className="settings-model-access-error" title={profile.error}>{profile.error}</small> : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <InlineNotice tone="neutral">尚无接入画像；当前仍可使用已保存模型，刷新后会补充兼容性证据。</InlineNotice>
                  )}
                </div>
                <div className="settings-model-list">
                  <article className="settings-model-card">
                    <div className="settings-model-meta">
                      <div className="settings-model-kind-row">
                        <span className="settings-model-kind"><Brain size={13} />对话模型</span>
                        <span className={`settings-model-service-badge ${modelState.serviceStatuses.agent?.state || "unchecked"}`}>
                          {modelServiceStateLabel(modelState.serviceStatuses.agent)}
                        </span>
                      </div>
                      <strong title={draftSettings.agentModel || "未配置"}>{draftSettings.agentModel || "未配置"}</strong>
                      <small>{selectedAgentModels.length} 个已选 · 用户自选模型</small>
                      <small className="settings-model-service-copy">{modelServiceStateCopy(modelState.serviceStatuses.agent)}</small>
                      {modelState.serviceStatuses.agent?.error ? <small className="settings-model-service-error" title={modelState.serviceStatuses.agent.error}>{modelState.serviceStatuses.agent.error}</small> : null}
                    </div>
                    <IconActionButton className="settings-model-config-action" label="配置对话模型" icon={<Settings size={15} />} onClick={() => setModelConfigTarget("agent")} />
                  </article>
                  <article className="settings-model-card">
                    <div className="settings-model-meta">
                      <div className="settings-model-kind-row">
                        <span className="settings-model-kind"><ImageIcon size={13} />生图模型</span>
                        <span className={`settings-model-service-badge ${modelState.serviceStatuses.image?.state || "unchecked"}`}>
                          {modelServiceStateLabel(modelState.serviceStatuses.image)}
                        </span>
                      </div>
                      <strong title={draftSettings.imageModel || "未配置"}>{draftSettings.imageModel || "未配置"}</strong>
                      <small>{selectedImageModels.length} 个已选 · 用于画布生成</small>
                      <small className="settings-model-service-copy">{modelServiceStateCopy(modelState.serviceStatuses.image)}</small>
                      {modelState.serviceStatuses.image?.error ? <small className="settings-model-service-error" title={modelState.serviceStatuses.image.error}>{modelState.serviceStatuses.image.error}</small> : null}
                    </div>
                    <IconActionButton className="settings-model-config-action" label="配置生图模型" icon={<Settings size={15} />} onClick={() => setModelConfigTarget("image")} />
                  </article>
                  <article className="settings-model-card">
                    <div className="settings-model-meta">
                      <div className="settings-model-kind-row">
                        <span className="settings-model-kind"><Film size={13} />视频模型</span>
                        <span className={`settings-model-service-badge ${modelState.serviceStatuses.video?.state || "unchecked"}`}>
                          {modelServiceStateLabel(modelState.serviceStatuses.video)}
                        </span>
                      </div>
                      <strong title={draftSettings.videoModel || "未配置"}>{draftSettings.videoModel || "未配置"}</strong>
                      <small>{selectedVideoModels.length} 个已选 · 独立视频任务链路</small>
                      <small className="settings-model-service-copy">{modelServiceStateCopy(modelState.serviceStatuses.video)}</small>
                      {modelState.serviceStatuses.video?.error ? <small className="settings-model-service-error" title={modelState.serviceStatuses.video.error}>{modelState.serviceStatuses.video.error}</small> : null}
                    </div>
                    <IconActionButton className="settings-model-config-action" label="配置视频模型" icon={<Settings size={15} />} onClick={() => setModelConfigTarget("video")} />
                  </article>
                </div>
                <div className="settings-runtime-fields">
                  <Field label="推理强度">
                    <select value={draftSettings.reasoningEffort} onChange={(event) => update("reasoningEffort", event.target.value as AppSettings["reasoningEffort"])}>
                      {REASONING_EFFORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  <Field label="模式">
                    <select value={draftSettings.fastMode ? "fast" : "standard"} onChange={(event) => update("fastMode", event.target.value === "fast")}>
                      <option value="standard">标准</option>
                      <option value="fast">快速</option>
                    </select>
                  </Field>
                </div>
              </SurfaceSection>
              ) : null}

              {activeSection === "agent" ? (
              <SurfaceSection className="settings-surface-section settings-prompt-section" aria-label="Agent 提示词">
                <div className="settings-section-header">
                  <h3>Agent</h3>
                  <ActionButton variant="secondary" className="settings-prompt-action" onClick={openPromptEditor} icon={<Brain size={15} />}>
                    编辑提示词
                  </ActionButton>
                </div>
                <div className="settings-context-policy">
                  <div className="settings-section-header">
                    <div>
                      <strong>默认出图规格</strong>
                      <small>用于未单独指定规格的 Agent 与手动生图任务。</small>
                    </div>
                    <span className="settings-update-status available">
                      {draftSettings.imageRatio} · {draftSettings.imageResolution} · {computedSizeFor(draftSettings.imageRatio, draftSettings.imageResolution)}
                    </span>
                  </div>
                  <div className="settings-runtime-fields">
                    <Field label="图片比例">
                      <select
                        value={draftSettings.imageRatio}
                        onChange={(event) => updateImageFrame({ ratio: event.target.value as ImageFrameRatio })}
                      >
                        {FRAME_OPTIONS.map((option) => (
                          <option key={option.ratio} value={option.ratio}>{option.ratio} · {option.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="图片清晰度">
                      <select
                        value={draftSettings.imageResolution}
                        onChange={(event) => updateImageFrame({ resolution: event.target.value as ImageResolutionPreset })}
                      >
                        {SIZE_PRESETS.map((option) => (
                          <option key={option.resolution} value={option.resolution}>{option.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <InlineNotice tone="neutral">
                    清晰度控制交付像素；“草稿 / 标准 / 精细”控制模型生成质量，两者互不替代。2K、4K 可能更慢，并可能由上游产生更高费用。
                  </InlineNotice>
                </div>
                <div className="settings-context-policy">
                  <div className="settings-section-header">
                    <div>
                      <strong>批量生图调度</strong>
                      <small>同一批并行处理，不同批按顺序执行；暂停后不再派发下一批。</small>
                    </div>
                    <span className="settings-update-status available">每批 {draftSettings.imageBatchSize} 路</span>
                  </div>
                  <Field label="每批生图数量">
                    <DeferredNumberInput
                      min="1"
                      max="10"
                      step="1"
                      value={draftSettings.imageBatchSize}
                      onValueChange={(value) => update("imageBatchSize", value)}
                    />
                  </Field>
                  <InlineNotice tone="neutral">
                    建议先使用 2–3 路。提高批次会更快占用接口并发与额度，但任务总量仍会拆成多个有序批次。
                  </InlineNotice>
                </div>
                <div className="settings-context-policy settings-context-strategy">
                  <div className="settings-section-header">
                    <div>
                      <strong>上下文控制</strong>
                      <small>SparkAI WorkSpace 图片上下文叠加在模型原生 Agent 上下文之上；自动模式会按模型族选择策略。</small>
                    </div>
                    <span className="settings-update-status available">
                      {CONTEXT_STRATEGY_OPTIONS.find((option) => option.value === draftSettings.contextStrategy)?.label || "自动匹配"}
                    </span>
                  </div>
                  <Field label="上下文策略">
                    <select
                      name="contextStrategy"
                      data-settings-control="context-strategy"
                      value={draftSettings.contextStrategy}
                      onChange={(event) => update("contextStrategy", event.target.value as AppSettings["contextStrategy"])}
                    >
                      {CONTEXT_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  <InlineNotice tone="neutral">
                    {CONTEXT_STRATEGY_OPTIONS.find((option) => option.value === draftSettings.contextStrategy)?.detail}
                    {draftSettings.contextStrategy === "auto" && /^gpt|codex|chatgpt/i.test(draftSettings.agentModel || "")
                      ? " 当前模型将使用 Codex 级 272K 窗口，并在约 244.8K Token 时自动 checkpoint。"
                      : draftSettings.contextStrategy === "auto" && /claude|anthropic/i.test(draftSettings.agentModel || "")
                        ? " 当前模型将使用 Claude 策略，并按具体模型选择 200K 或长上下文窗口。"
                        : ""}
                  </InlineNotice>
                  <Field label="压缩模型（可选）">
                    <input
                      value={draftSettings.compactModel}
                      onChange={(event) => update("compactModel", event.target.value)}
                      list="naimage-context-models"
                      placeholder="留空时跟随当前 Agent 模型"
                    />
                  </Field>
                  <datalist id="naimage-context-models">
                    {visibleAgentModels.map((model) => <option key={model} value={model} />)}
                  </datalist>
                  {draftSettings.contextStrategy === "custom" ? (
                    <div className="settings-runtime-fields settings-context-custom-fields">
                      <Field label="上下文窗口 Token">
                        <DeferredNumberInput min="8000" max="2000000" step="1000" value={draftSettings.contextWindowTokens} onValueChange={(value) => update("contextWindowTokens", value)} />
                      </Field>
                      <Field label="有效窗口比例 %">
                        <DeferredNumberInput min="50" max="99" step="1" value={draftSettings.contextEffectiveWindowPercent} onValueChange={(value) => update("contextEffectiveWindowPercent", value)} />
                      </Field>
                      <Field label="自动压缩点 %">
                        <DeferredNumberInput min="50" max="98" step="1" value={draftSettings.contextAutoCompactPercent} onValueChange={(value) => update("contextAutoCompactPercent", value)} />
                      </Field>
                      <Field label="保留用户消息 Token">
                        <DeferredNumberInput min="0" max="50000" step="1000" value={draftSettings.contextRetainedUserTokens} onValueChange={(value) => update("contextRetainedUserTokens", value)} />
                      </Field>
                    </div>
                  ) : null}
                </div>
                <div className="settings-agent-integrations">
                  <div className="settings-section-header">
                    <div>
                      <strong>外部 Agent 控制</strong>
                      <small>安装 SparkAI WorkSpace CLI Skill 后，Agent 可通过本机认证桥控制项目、画布与对话。</small>
                    </div>
                    <IconActionButton label="重新检测" icon={<RotateCcw size={14} />} onClick={() => void detectAgentIntegrations()} disabled={integrationBusy} />
                  </div>
                  {integrationError ? <InlineNotice tone="danger">{integrationError}</InlineNotice> : null}
                  <div className="settings-integration-list">
                    {integrationTargets.map((target) => {
                      const checked = draftSettings.agentSkillAutoInstallTargets.includes(target.id);
                      return (
                        <label key={target.id} className="settings-integration-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => update("agentSkillAutoInstallTargets", event.target.checked
                              ? [...draftSettings.agentSkillAutoInstallTargets, target.id]
                              : draftSettings.agentSkillAutoInstallTargets.filter((id) => id !== target.id))}
                          />
                          <span>
                            <strong>{target.label}</strong>
                            <small title={target.skillsPath}>{target.detected ? target.skillsPath : `未检测到，安装时将创建 ${target.skillsPath}`}</small>
                          </span>
                          <em className={target.installed ? "installed" : ""}>{target.installed ? "已安装" : "未安装"}</em>
                        </label>
                      );
                    })}
                  </div>
                  <div className="settings-inline-actions">
                    <ActionButton variant="primary" onClick={() => void mutateAgentIntegrations("install")} busy={integrationBusy}>安装 / 更新 Skill</ActionButton>
                    <ActionButton variant="secondary" onClick={() => void mutateAgentIntegrations("remove")} disabled={integrationBusy}>移除所选 Skill</ActionButton>
                  </div>
                  <InlineNotice tone="neutral">勾选项保存后会在 SparkAI WorkSpace 启动时自动更新。自动化服务仅监听 `127.0.0.1`，并使用每次启动随机生成的 Bearer Token。</InlineNotice>
                </div>
              </SurfaceSection>
              ) : null}

              {activeSection === "updates" ? (
              <SurfaceSection className="settings-surface-section settings-update-section" aria-labelledby="settings-update-heading">
                <div className="settings-section-header">
                  <h3 id="settings-update-heading">软件更新</h3>
                  <span className={`settings-update-status ${updateInfo?.updateAvailable ? "available" : ""}`}>
                    {updateInfo?.updateAvailable ? "有新版本" : `当前 ${updateInfo?.currentVersion || "-"}`}
                  </span>
                </div>
                <div className="settings-update-card">
                  <div className="settings-update-version-row">
                    <div>
                      <small>稳定通道</small>
                      <strong>{updateInfo?.updateAvailable ? `${updateInfo.currentVersion || "-"} → ${updateInfo.latestVersion}` : `SparkAI WorkSpace ${updateInfo?.currentVersion || "-"}`}</strong>
                    </div>
                    {updateInfo?.artifact ? <span>{formatSettingsBytes(updateInfo.artifact.size)}</span> : null}
                  </div>
                  {updateInfo?.notes?.length ? (
                    <ul className="settings-update-notes">
                      {updateInfo.notes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  ) : null}
                  {updateProgress?.stage === "downloading" ? (
                    <div
                      className="settings-update-progress"
                      role="progressbar"
                      aria-label="更新下载进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.max(0, Math.min(100, updateProgress.percent || 0))}
                    >
                      <span style={{ width: `${Math.max(0, Math.min(100, updateProgress.percent || 0))}%` }} />
                    </div>
                  ) : null}
                  {updateMessage ? <InlineNotice className="settings-update-message" tone={updateError ? "danger" : "info"}>{updateMessage}</InlineNotice> : null}
                  {installerCaptcha?.imageDataUrl ? (
                    <div className="settings-update-captcha">
                      <ButtonBase type="button" className="settings-update-captcha-image" onClick={() => void loadInstallerCaptcha()} title="点击刷新验证码" disabled={updateOperationBusy || captchaRequestInFlightRef.current}>
                        <img src={installerCaptcha.imageDataUrl} alt="下载验证码" />
                      </ButtonBase>
                      <Field label="验证码">
                        <input
                          value={captchaCode}
                          onChange={(event) => setCaptchaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="输入 6 位数字"
                          autoFocus
                        />
                      </Field>
                      <ActionButton variant="primary" onClick={() => void authorizeInstallerDownload()} busy={updateOperationBusy} disabled={captchaCode.length !== 6} icon={<Download size={15} />}>
                        验证并下载
                      </ActionButton>
                    </div>
                  ) : (
                    <div className="settings-update-actions">
                      <ActionButton variant="primary" onClick={() => void runUpdateAction()} busy={updateOperationBusy} icon={pendingMatchesLatest ? <RotateCcw size={15} /> : <Download size={15} />}>
                        {updateActionLabel}
                      </ActionButton>
                    </div>
                  )}
                  <InlineNotice className="settings-update-security" tone="neutral" icon={<Shield size={14} />}>更新包会自动验证，失败时保留当前版本</InlineNotice>
                </div>
                <div className="settings-help-card">
                  <div>
                    <strong>帮助、隐私与用户政策</strong>
                    <small>查看从导入原图到平台导出的完整引导，以及费用和数据规则。</small>
                  </div>
                  <div className="settings-inline-actions">
                    <ActionButton variant="secondary" onClick={() => openHelp?.("tutorial")}>AI 示例教学</ActionButton>
                    <ActionButton variant="secondary" onClick={() => openHelp?.("start")}>使用帮助</ActionButton>
                    <ActionButton variant="secondary" onClick={() => openHelp?.("privacy")}>隐私政策</ActionButton>
                    <ActionButton variant="secondary" onClick={() => openHelp?.("terms")}>用户协议</ActionButton>
                    <ActionButton variant="secondary" onClick={() => openHelp?.("fees")}>费用与退款</ActionButton>
                  </div>
                  <small>SparkAI WorkSpace 软件制作者：namean</small>
                </div>
              </SurfaceSection>
              ) : null}

              {activeSection === "tools" ? (
              <SurfaceSection className="settings-surface-section settings-canvas-tools-section" aria-labelledby="settings-canvas-tools-heading">
                <div className="settings-section-header">
                  <div>
                    <h3 id="settings-canvas-tools-heading">画布工具</h3>
                    <small>控制底部工具栏的展开方式和可见工具。</small>
                  </div>
                  <span className="settings-update-status available">本机偏好</span>
                </div>
                <React.Suspense fallback={null}>
                  <LazyCanvasToolsSettingsPanel
                    states={draftSettings.pluginStates}
                    mode={draftSettings.canvasToolDockMode}
                    hiddenCommands={draftSettings.disabledCanvasToolCommands}
                    shortcuts={draftSettings.canvasToolShortcuts}
                    visibleAssetRailTabs={draftSettings.visibleWorkspaceAssetRailTabs}
                    onModeChange={(canvasToolDockMode) => update("canvasToolDockMode", canvasToolDockMode)}
                    onHiddenCommandsChange={(disabledCanvasToolCommands) => update("disabledCanvasToolCommands", disabledCanvasToolCommands)}
                    onShortcutsChange={(canvasToolShortcuts) => update("canvasToolShortcuts", canvasToolShortcuts)}
                    onVisibleAssetRailTabsChange={(visibleWorkspaceAssetRailTabs) => update("visibleWorkspaceAssetRailTabs", visibleWorkspaceAssetRailTabs)}
                  />
                </React.Suspense>
              </SurfaceSection>
              ) : null}

              {activeSection === "plugins" ? (
              <SurfaceSection className="settings-surface-section settings-plugin-section" aria-labelledby="settings-plugin-heading">
                <div className="settings-section-header">
                  <div>
                    <h3 id="settings-plugin-heading">插件</h3>
                    <small>安装并授权插件；工具显隐与展开方式在“工具”中设置。</small>
                  </div>
                  <span className="settings-update-status available">声明式安全插件</span>
                </div>
                <React.Suspense fallback={null}>
                  <LazyPluginSettingsPanel
                    states={draftSettings.pluginStates}
                    onChange={(pluginStates) => update("pluginStates", pluginStates)}
                  />
                </React.Suspense>
              </SurfaceSection>
              ) : null}
            </SurfaceBody>
            <SurfaceFooter
              className="settings-surface-footer"
              leading={
                <>
                  <ActionButton variant={resetArmed ? "danger" : "secondary"} onClick={restoreDefaults} disabled={saving} icon={<RotateCcw size={15} />}>
                    {resetArmed ? "确认恢复默认" : "恢复默认"}
                  </ActionButton>
                  <StatusLine className="settings-save-state" tone={settingsMessageError ? "danger" : dirty ? "warning" : "success"} busy={saving} live="polite">
                    {settingsMessage || (dirty ? "有未保存修改" : "设置已同步")}
                  </StatusLine>
                </>
              }
            >
              <ActionButton onClick={requestSettingsClose} disabled={saving}>关闭</ActionButton>
              <ActionButton variant="primary" onClick={() => void commitSettings()} busy={saving} disabled={!dirty} icon={<Check size={15} />}>
                保存设置
              </ActionButton>
            </SurfaceFooter>
          </>
        )}
      </DrawerShell>
      {closePromptOpen ? (
        <DialogShell
          surface="settings-unsaved"
          ariaLabel="保存设置修改"
          layerLevel="nested"
          className="settings-unsaved-dialog"
          busy={saving}
          closePolicy={{ escape: "when-idle", backdrop: "when-idle", [CLOSE_BUTTON_REASON]: "when-idle" }}
          onRequestClose={() => setClosePromptOpen(false)}
        >
          {({ requestClose }) => (
            <>
              <SurfaceHeader
                eyebrow="未保存修改"
                title="关闭前要保存设置吗？"
                description="你刚才修改的设置还没有写入本机。"
                onClose={() => requestClose(CLOSE_BUTTON_REASON)}
                closeLabel="继续编辑设置"
                closeDisabled={saving}
              />
              <SurfaceBody className="settings-unsaved-body">
                <p>保存后关闭会立即应用修改；不保存会恢复到打开设置前的状态。</p>
              </SurfaceBody>
              <SurfaceFooter>
                <ActionButton onClick={() => setClosePromptOpen(false)} disabled={saving}>继续编辑</ActionButton>
                <ActionButton variant="danger" onClick={discardAndClose} disabled={saving}>不保存并关闭</ActionButton>
                <ActionButton variant="primary" onClick={() => void commitSettings(true)} busy={saving} icon={<Check size={15} />}>
                  保存并关闭
                </ActionButton>
              </SurfaceFooter>
            </>
          )}
        </DialogShell>
      ) : null}
      {modelConfigTarget ? (
        <React.Suspense fallback={null}>
          <LazyModelConfigDialog
            kind={modelConfigTarget}
            settings={draftSettings}
            setSettings={setDraftSettings}
            selectedModels={modelConfigTarget === "agent" ? selectedAgentModels : modelConfigTarget === "video" ? selectedVideoModels : selectedImageModels}
            models={modelConfigTarget === "agent" ? visibleAgentModels : modelConfigTarget === "video" ? visibleVideoModels : visibleImageModels}
            accountTokens={accountTokens}
            accessProfiles={modelState.accessProfiles}
            close={() => setModelConfigTarget(null)}
          />
        </React.Suspense>
      ) : null}
    </>
  );
}
