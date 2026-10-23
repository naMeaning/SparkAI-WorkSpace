import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AgentProviderControlRequest, AgentProviderSnapshot, AppSettings, ImageTaskDraft } from "./core";
import { ActionButton, Field, InlineNotice } from "./ui";
import { AGENT_PROVIDER_CHANGED, agentProviderLabel, agentProviderNetworkLabel } from "./agent-provider-state";

const ManagedRuntimeManager = React.lazy(() => import("./comfyui-runtime-manager"));
const ComfyUiTaskFields = React.lazy(() => import("./comfyui-task-fields"));

export default function AgentProviderManager({ projectId, conversationId = "", settings, saveSettings, onChanged }: {
  projectId?: string; conversationId?: string; settings: AppSettings; saveSettings: (settings: AppSettings) => Promise<void>; onChanged?: () => void;
}) {
  const [profiles, setProfiles] = useState<AgentProviderSnapshot[]>([]);
  const [selected, setSelected] = useState<AgentProviderSnapshot | null>(null);
  const [profileId, setProfileId] = useState("");
  const [strictOffline, setStrictOffline] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [managedOpen, setManagedOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageEnabled, setImageEnabled] = useState(settings.imageProvider === "comfyui");
  const [imageValid, setImageValid] = useState(false);
  const [imageDraft, setImageDraft] = useState<ImageTaskDraft>(() => ({ prompt: "", ratio: settings.imageRatio, resolution: settings.imageResolution,
    count: 1, quality: settings.imageQuality, provider: "comfyui", comfyui: settings.comfyui }));
  const mounted = useRef(false);
  const initialized = useRef(false);
  const revision = useRef(0);
  const listRevision = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const changed = useCallback(() => { window.dispatchEvent(new Event(AGENT_PROVIDER_CHANGED)); onChangedRef.current?.(); }, []);
  const refresh = useCallback(async () => {
    const current = ++listRevision.current;
    const result = await window.naimageAgent?.providerControl({ action: "list", ...(projectId ? { projectId } : {}) });
    if (!mounted.current || current !== listRevision.current) return;
    if (!result?.ok) throw new Error(result?.errorCode || "AGENT_PROVIDER_UNAVAILABLE");
    setProfiles(result.profiles || []); setSelected(result.selected || null);
    if (!initialized.current) { initialized.current = true; setProfileId(result.selected?.profileId || ""); setStrictOffline(result.selected?.strictOffline ?? true); }
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    initialized.current = false;
    setProfileId(""); setSelected(null);
    void refresh().catch(error => { if (mounted.current) setNotice(error instanceof Error ? error.message : String(error)); });
    return () => { mounted.current = false; ++revision.current; ++listRevision.current; };
  }, [refresh]);
  const profile = profiles.find(item => item.profileId === profileId);
  async function run(payload: AgentProviderControlRequest, message: string) {
    if (busy) return;
    const operation = ++revision.current;
    setBusy(payload.action); setNotice("");
    try {
      const result = await window.naimageAgent?.providerControl(payload);
      if (!mounted.current || revision.current !== operation) return;
      if (!result?.ok) throw new Error(result?.errorCode || "AGENT_PROVIDER_FAILED");
      if (result.canceled) { setNotice("已取消。"); return; }
      if (result.profile && payload.action === "import") { setProfileId(result.profile.profileId); setStrictOffline(result.profile.providerKind !== "cloud"); }
      if (result.selected) setSelected(result.selected);
      await refresh(); changed(); setNotice(message);
    } catch (error) { if (mounted.current && revision.current === operation) setNotice(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current && revision.current === operation) setBusy(""); }
  }
  async function saveImage() {
    if (busy || imageEnabled && !imageValid) return;
    setBusy("image-save"); setNotice("");
    try {
      const comfyui = imageEnabled && imageDraft.comfyui ? { ...imageDraft.comfyui } : undefined;
      if (comfyui) { delete comfyui.baseUrl; delete comfyui.networkScope; delete comfyui.profileId; }
      await saveSettings({ ...settings, imageProvider: imageEnabled ? "comfyui" : undefined, comfyui });
      changed(); setNotice(imageEnabled ? "本机生图配置已保存，下次任务将冻结此配置。" : "已关闭 Agent 本机生图；严格离线下 image_gen 不可用。");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(""); }
  }
  return <section className="agent-provider-manager" data-agent-provider-manager aria-label="Agent 执行服务">
    <InlineNotice>本地服务支持 Ollama、LM Studio、llama.cpp server 和 vLLM 的 OpenAI 兼容接口。通过系统文件窗口导入连接配置；打开面板、刷新和选择服务均不会发送模型请求。</InlineNotice>
    <div className="manual-image-task-controls">
      <ActionButton disabled={Boolean(busy)} onClick={() => void run({ action: "list", ...(projectId ? { projectId } : {}) }, "本地配置已刷新，未访问模型服务。")}>刷新配置</ActionButton>
      <ActionButton busy={busy === "import"} disabled={Boolean(busy)} onClick={() => void run({ action: "import" }, "连接已导入，请明确选择并应用。")}>导入本地 Agent 连接</ActionButton>
    </div>
    <Field label={projectId ? "当前项目 Agent 服务" : "默认 Agent 服务"}><select aria-label="Agent 执行服务" value={profileId} disabled={Boolean(busy)} onChange={event => {
      setProfileId(event.target.value); const next = profiles.find(item => item.profileId === event.target.value); setStrictOffline(next?.providerKind !== "cloud");
    }}><option value="">请选择服务</option>{profiles.map(item => <option key={item.profileId} value={item.profileId}>{item.profileLabel} · {agentProviderLabel(item)}</option>)}</select></Field>
    {profile ? <section data-agent-provider-detail={profile.profileId}>
      <p><strong>{profile.modelId || "沿用云端模型配置"}</strong> · {profile.networkScope === "local" ? "本机连接" : "远程连接"} · {profile.availability === "available" ? "服务运行中" : profile.availability === "not-running" ? "托管服务未启动" : "尚未发送推理请求"}</p>
      <p>工具调用：{profile.capabilities.tools ? "支持" : "未启用"} · 视觉：{profile.capabilities.vision ? "支持" : "未启用"} · 上下文：{profile.capabilities.contextWindowTokens.toLocaleString()} tokens · 最大输出：{profile.capabilities.maxOutputTokens.toLocaleString()} tokens</p>
      {profile.providerKind !== "cloud" ? <label className="settings-checkbox-row"><input type="checkbox" aria-label="严格离线" checked={strictOffline} disabled={Boolean(busy)} onChange={event => setStrictOffline(event.target.checked)} /><span>严格离线：只连接本机服务，禁用网页搜索、云端生图和远程 ComfyUI</span></label> : null}
      {!profile.capabilities.tools && profile.providerKind !== "cloud" ? <InlineNotice>此模型以文本模式运行，工具调用已禁用。视觉或工具能力来自明确导入的声明，接口兼容不代表已验证推理质量。</InlineNotice> : null}
      <ActionButton variant="primary" busy={busy === "select"} disabled={Boolean(busy)} onClick={() => void run({ action: "select", profileId: profile.profileId, strictOffline: profile.providerKind !== "cloud" && strictOffline, ...(profile.modelId ? { modelId: profile.modelId } : {}), ...(projectId ? { projectId } : {}) }, "Agent 服务已应用，新任务将使用此配置。")}>应用 Agent 服务</ActionButton>
    </section> : null}
    {selected ? <p data-agent-provider-selected={selected.profileId}>当前：{selected.profileLabel} · {agentProviderNetworkLabel(selected)}</p> : null}
    <details data-agent-local-image open={imageOpen} onToggle={event => setImageOpen(event.currentTarget.open)}><summary>Agent 本机生图</summary>
      <p>{settings.imageProvider === "comfyui" && settings.comfyui?.connectionId ? "已明确配置本机 ComfyUI。" : "本机生图未启用；严格离线下 image_gen 将隐藏。"}</p>
      {imageOpen ? <><label className="settings-checkbox-row"><input type="checkbox" aria-label="启用 Agent 本机生图" checked={imageEnabled} disabled={Boolean(busy)} onChange={event => setImageEnabled(event.target.checked)} /><span>使用明确选择的本机 ComfyUI 连接</span></label>
        {imageEnabled ? <React.Suspense fallback={<p>正在读取本机生图配置…</p>}><ComfyUiTaskFields draft={imageDraft} update={patch => setImageDraft(current => ({ ...current, ...patch }))} projectId={projectId || ""} conversationId={conversationId} onValidityChange={setImageValid} localOnly explicitSelection configurationOnly /></React.Suspense> : null}
        <ActionButton disabled={Boolean(busy) || imageEnabled && !imageValid} busy={busy === "image-save"} onClick={() => void saveImage()}>保存本机生图配置</ActionButton></> : null}
    </details>
    <details data-agent-managed-runtime open={managedOpen} onToggle={event => setManagedOpen(event.currentTarget.open)}><summary>托管本地模型与运行环境</summary>
      {managedOpen ? <React.Suspense fallback={<p>正在读取本地安装状态…</p>}><ManagedRuntimeManager platform="agent" onConnectionsChanged={changed} /></React.Suspense> : null}
    </details>
    {notice ? <InlineNotice role="status" data-agent-provider-notice>{notice}</InlineNotice> : null}
  </section>;
}
