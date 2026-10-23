import { useEffect, useMemo, useRef, useState } from "react";
import { COMFYUI_PARAMETER_RANGES } from "../runtime/comfyui-options.mjs";
import type { ComfyUiParameterRanges, ComfyUiTaskOptions, ComfyUiTemplate, ImageTaskDraft, ServerBridge } from "./core";
import { ActionButton, Field, InlineNotice } from "./ui";

type InspectCapabilities = {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  parameterRanges: ComfyUiParameterRanges;
  capabilitiesHash?: string;
  devices?: Array<{ name: string; type: string }>;
};

type ConnectionSummary = NonNullable<Awaited<ReturnType<ServerBridge["comfyui"]>>["connections"]>[number];
type NetworkScope = "local" | "lan" | "remote";
type CredentialMode = "none" | "bearer" | "basic" | "mtls";
type ConnectionDraft = { connectionId: string; label: string; baseUrl: string; networkScope: NetworkScope; credentialType: CredentialMode };
const networkLabels: Record<NetworkScope | "unknown", string> = { local: "本机", lan: "局域网", remote: "远程", unknown: "网络范围未知" };

function connectionDraftFor(connection?: ConnectionSummary, legacyBaseUrl = ""): ConnectionDraft {
  const mode = connection?.credentialMode || connection?.credentialType || "none";
  return {
    connectionId: connection?.connectionId || "",
    label: connection?.label || "本机 ComfyUI",
    baseUrl: connection?.baseUrl || legacyBaseUrl || "http://127.0.0.1:8188",
    networkScope: connection?.networkScope || "local",
    credentialType: ["none", "bearer", "basic", "mtls"].includes(mode) ? mode as CredentialMode : "none"
  };
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function templateSupports(template: ComfyUiTemplate | undefined, field: string) {
  if (!template) return false;
  if (Array.isArray(template.exposedInputs)) return template.exposedInputs.includes(field);
  if (Array.isArray(template.inputMappings)) return template.inputMappings.some(mapping => mapping.kind === field);
  return false;
}

function normalizeRange(field: keyof ComfyUiParameterRanges, ...ranges: Array<ComfyUiParameterRanges[keyof ComfyUiParameterRanges] | undefined>) {
  const result = { ...COMFYUI_PARAMETER_RANGES[field] };
  for (const range of ranges) if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
    result.min = Math.max(result.min, range.min); result.max = Math.min(result.max, range.max);
    if (Number.isFinite(range.step) && range.step! > 0) result.step = range.step;
  }
  return result;
}

export default function ComfyUiTaskFields({ draft, update }: { draft: ImageTaskDraft; update: (patch: Partial<ImageTaskDraft>) => void }) {
  const [templates, setTemplates] = useState<ComfyUiTemplate[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [capabilities, setCapabilities] = useState<InspectCapabilities | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState("");
  const [outputNodeId, setOutputNodeId] = useState("9");
  const [label, setLabel] = useState("");
  const options: ComfyUiTaskOptions = draft.comfyui || {
    templateId: "", templateHash: "", checkpoint: "", seed: -1, width: 1024, height: 1024
  };
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(() => connectionDraftFor(undefined, options.baseUrl));
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [credentialDirty, setCredentialDirty] = useState(false);
  const inspectRevision = useRef(0);
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const activeConnectionId = options.connectionId || options.profileId;
  const selectedConnection = connections.find(connection => connection.connectionId === activeConnectionId);
  const networkScope = selectedConnection?.networkScope || options.networkScope || (activeConnectionId ? "unknown" : "local");
  const selected = templates.find(template => template.id === options.templateId);
  const supportsDenoise = templateSupports(selected, "denoise");
  const sampling = {
    steps: options.steps ?? selected?.defaults?.steps ?? "",
    cfg: options.cfg ?? selected?.defaults?.cfg ?? "",
    sampler: options.sampler ?? selected?.defaults?.sampler ?? "",
    scheduler: options.scheduler ?? selected?.defaults?.scheduler ?? "",
    denoise: options.denoise ?? selected?.defaults?.denoise ?? ""
  };
  const ranges = useMemo(() => ({
    steps: normalizeRange("steps", selected?.parameterRanges?.steps, capabilities?.parameterRanges.steps),
    cfg: normalizeRange("cfg", selected?.parameterRanges?.cfg, capabilities?.parameterRanges.cfg),
    denoise: normalizeRange("denoise", selected?.parameterRanges?.denoise, capabilities?.parameterRanges.denoise)
  }), [capabilities, selected]);
  const samplerOptions = uniqueValues([sampling.sampler, ...(capabilities?.samplers || [])]);
  const schedulerOptions = uniqueValues([sampling.scheduler, ...(capabilities?.schedulers || [])]);

  function patch(value: Partial<ComfyUiTaskOptions>) {
    const next = { ...latestOptions.current, ...value };
    if (next.connectionId) { delete next.baseUrl; delete next.profileId; delete next.networkScope; }
    latestOptions.current = next;
    update({ provider: "comfyui", count: 1, comfyui: next });
  }
  function clearInspection() { inspectRevision.current += 1; setCapabilities(null); setStatus(""); }
  function selectConnection(connection: ConnectionSummary) {
    clearInspection();
    setConnectionDraft(connectionDraftFor(connection)); setConnectionDirty(false); setCredentialDirty(false);
    patch({ connectionId: connection.connectionId });
  }
  function editConnection(value: Partial<ConnectionDraft>) {
    clearInspection(); setConnectionDirty(true);
    if (value.credentialType !== undefined) setCredentialDirty(true);
    setConnectionDraft(current => ({ ...current, ...value }));
  }
  function select(template: ComfyUiTemplate) {
    const value: Partial<ComfyUiTaskOptions> = {
      templateId: template.id, templateHash: template.templateHash,
      steps: undefined, cfg: undefined, sampler: undefined, scheduler: undefined, denoise: undefined
    };
    for (const field of ["steps", "cfg", "sampler", "scheduler", "denoise"] as const) {
      const templateValue = template.defaults?.[field];
      if (templateSupports(template, field) && templateValue !== undefined) Object.assign(value, { [field]: templateValue });
    }
    patch(value);
    setMapping(JSON.stringify(template.inputMappings, null, 2)); setOutputNodeId(template.outputNodeId);
  }
  useEffect(() => {
    let stopped = false;
    void window.naimageServer?.comfyui({ action: "list" }).then(result => {
      if (stopped) return;
      if (!result.ok) { setStatus(result.error || "读取本地模板失败。"); return; }
      setTemplates(result.templates || []);
      const first = result.templates?.find(template => template.id === options.templateId) || result.templates?.[0];
      if (first) {
        setMapping(JSON.stringify(first.inputMappings, null, 2)); setOutputNodeId(first.outputNodeId);
        if (!options.templateId) select(first);
      }
    });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    let stopped = false;
    const revision = inspectRevision.current;
    void window.naimageServer?.comfyui({ action: "connections-list" }).then(result => {
      if (stopped) return;
      if (!result.ok) { setStatus(result.error || "读取 ComfyUI 连接失败。"); return; }
      const available = result.connections || [];
      setConnections(available);
      if (inspectRevision.current !== revision) return;
      const current = latestOptions.current;
      const currentConnectionId = current.connectionId || current.profileId;
      const matching = available.find(connection => connection.connectionId === currentConnectionId)
        || (!currentConnectionId && current.baseUrl ? available.find(connection => connection.baseUrl?.replace(/\/+$/, "") === current.baseUrl?.replace(/\/+$/, "")) : undefined)
        || (!currentConnectionId && !current.baseUrl ? available.find(connection => connection.enabled !== false) : undefined);
      if (matching) selectConnection(matching);
      else if (currentConnectionId) setStatus("原 ComfyUI 连接不可用，请明确选择已有连接或保存新的连接。");
      else if (current.baseUrl) { setConnectionDraft(connectionDraftFor(undefined, current.baseUrl)); setConnectionDirty(true); }
    }).catch(error => { if (!stopped) setStatus(error instanceof Error ? error.message : String(error)); });
    return () => { stopped = true; };
  }, []);
  async function saveConnection() {
    const result = await window.naimageServer?.comfyui({
      action: "connections-save", confirmed: true,
      ...(connectionDraft.connectionId ? { connectionId: connectionDraft.connectionId } : {}),
      label: connectionDraft.label, baseUrl: connectionDraft.baseUrl, networkScope: connectionDraft.networkScope,
      ...(!connectionDraft.connectionId || credentialDirty && connectionDraft.credentialType === "none" ? { credentialType: "none" as const } : {})
    });
    if (!result?.ok || !result.connection?.connectionId) throw new Error(result?.error || "连接保存失败。");
    const saved = result.connection;
    setConnections(result.connections || [...connections.filter(connection => connection.connectionId !== saved.connectionId), saved]);
    selectConnection(saved);
    if (connectionDraft.credentialType !== "none" && connectionDraft.credentialType !== (saved.credentialMode || saved.credentialType)) {
      setConnectionDraft(current => ({ ...current, credentialType: connectionDraft.credentialType }));
      setCredentialDirty(true);
    }
    return saved;
  }
  async function saveConnectionFromForm() {
    setBusy(true); setStatus("");
    try { await saveConnection(); setStatus(connectionDraft.credentialType === "none" ? "连接已保存。点击测试连接后才会访问服务。" : "连接已保存。请导入凭据，再明确测试连接。"); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function importCredential() {
    setBusy(true); setStatus("");
    try {
      if (!connectionDraft.connectionId) throw new Error("请先保存连接，再导入凭据。");
      if (connectionDraft.credentialType === "none") throw new Error("请先选择 Bearer、Basic 或 mTLS 认证方式。");
      const result = await window.naimageServer?.comfyui({ action: "connections-credential-import", connectionId: connectionDraft.connectionId, credentialType: connectionDraft.credentialType, confirmed: true });
      if (!result?.ok) throw new Error(result?.error || "凭据导入失败。");
      if (result.canceled) return;
      const saved = result.connection;
      if (!saved?.connectionId) throw new Error("凭据已导入，但连接摘要暂不可用，请重新打开配置。");
      setConnections(result.connections || [...connections.filter(connection => connection.connectionId !== saved.connectionId), saved]);
      selectConnection(saved);
      setStatus("凭据已保存到受保护存储。点击测试连接后才会访问服务。");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function inspect() {
    setBusy(true); setStatus("");
    let inspectedRevision = inspectRevision.current;
    try {
      if (credentialDirty && connectionDraft.credentialType !== "none") throw new Error("请先导入所选认证方式的凭据，再测试连接。");
      const connection = connectionDirty || !latestOptions.current.connectionId ? await saveConnection() : selectedConnection;
      const connectionId = connection?.connectionId || latestOptions.current.connectionId;
      if (!connectionId) throw new Error("请先保存并选择 ComfyUI 连接。");
      inspectedRevision = inspectRevision.current;
      const result = await window.naimageServer?.comfyui({ action: "connections-test", connectionId, confirmed: true });
      if (inspectRevision.current !== inspectedRevision || latestOptions.current.connectionId !== connectionId) return;
      if (!result?.ok) throw new Error(result?.error || "未连接 ComfyUI。");
      const inspected: InspectCapabilities = {
        checkpoints: result.checkpoints || [],
        samplers: result.samplers || [],
        schedulers: result.schedulers || [],
        parameterRanges: result.parameterRanges || {},
        capabilitiesHash: result.capabilitiesHash,
        devices: result.devices || []
      };
      setCapabilities(inspected);
      if (!latestOptions.current.checkpoint && inspected.checkpoints[0]) patch({ checkpoint: inspected.checkpoints[0] });
      setStatus(`已连接 · ${networkLabels[connection?.networkScope || networkScope]} · ${inspected.checkpoints.length} 个模型 · ${inspected.samplers.length} 个采样器 · ${inspected.schedulers.length} 个调度器 · ${inspected.devices?.map(device => device.name).join("、") || "服务设备"}`);
    } catch (error) {
      if (inspectRevision.current !== inspectedRevision) return;
      setCapabilities(null);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }
  async function importTemplate() {
    setBusy(true); setStatus("");
    try {
      const inputMappings = JSON.parse(mapping);
      const result = await window.naimageServer?.comfyui({ action: "import", label, outputNodeId, inputMappings });
      if (!result?.ok) throw new Error(result?.error || "模板导入失败。");
      if (result.canceled) return;
      setTemplates(result.templates || []);
      if (result.template) select(result.template);
      setStatus("模板已校验并保存。执行前仍会检查服务节点与模型依赖。");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="comfyui-task-fields" aria-label="ComfyUI 图片执行配置" data-comfyui-inspected={capabilities ? "true" : "false"}>
    <div className="manual-image-task-controls">
      <Field label="ComfyUI 执行连接"><select aria-label="ComfyUI 连接" value={options.connectionId || options.profileId || ""} disabled={busy} onChange={event => { const connection = connections.find(item => item.connectionId === event.target.value); if (connection) selectConnection(connection); }}>
        {!options.connectionId && !options.profileId ? <option value="">{options.baseUrl ? "旧地址 · 请保存连接后使用" : "请选择连接"}</option> : null}
        {activeConnectionId && !selectedConnection ? <option value={activeConnectionId}>连接不可用 · 请重新选择</option> : null}
        {connections.map(connection => <option key={connection.connectionId} value={connection.connectionId} disabled={connection.enabled === false}>{connection.label || connection.connectionId} · {networkLabels[connection.networkScope || "local"]}{connection.enabled === false ? "（已停用）" : ""}</option>)}
      </select></Field>
      <ActionButton busy={busy} onClick={() => void inspect()}>检查环境</ActionButton>
    </div>
    <InlineNotice data-comfyui-network-scope={networkScope} tone={networkScope === "local" ? undefined : "warning"}>{networkScope === "local"
      ? "图片任务仅访问本机回环 ComfyUI。Agent 对话仍使用当前 Agent 连接。"
      : networkScope === "lan"
        ? "图片任务将通过局域网传输提示词与素材，这个连接不属于严格离线。"
        : networkScope === "remote"
          ? "图片任务将通过网络发送到远程 ComfyUI，这个连接不属于严格离线。"
          : "连接的网络范围未知。请明确选择可用连接后再执行图片任务。"}</InlineNotice>
    <div className="manual-image-task-controls">
      <Field label="审核模板"><select aria-label="ComfyUI 模板" value={options.templateId} onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) select(template); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.label} · v{template.version}</option>)}</select></Field>
      <Field label="服务模型"><input aria-label="ComfyUI 模型" list="comfyui-checkpoint-options" value={options.checkpoint} onChange={event => patch({ checkpoint: event.target.value })} placeholder="检查环境后选择 checkpoint" /><datalist id="comfyui-checkpoint-options">{(capabilities?.checkpoints || []).map(name => <option key={name} value={name} />)}</datalist></Field>
      <Field label={`采样步数（${ranges.steps.min}–${ranges.steps.max}）`}><input aria-label="ComfyUI steps" type="number" min={ranges.steps.min} max={ranges.steps.max} step={ranges.steps.step} disabled={!templateSupports(selected, "steps")} value={sampling.steps} onChange={event => patch({ steps: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
      <Field label={`CFG（${ranges.cfg.min}–${ranges.cfg.max}）`}><input aria-label="ComfyUI cfg" type="number" min={ranges.cfg.min} max={ranges.cfg.max} step={ranges.cfg.step} disabled={!templateSupports(selected, "cfg")} value={sampling.cfg} onChange={event => patch({ cfg: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
      <Field label="采样器"><select aria-label="ComfyUI sampler" value={sampling.sampler} disabled={!capabilities || !templateSupports(selected, "sampler")} onChange={event => patch({ sampler: event.target.value })}>{samplerOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      <Field label="调度器"><select aria-label="ComfyUI scheduler" value={sampling.scheduler} disabled={!capabilities || !templateSupports(selected, "scheduler")} onChange={event => patch({ scheduler: event.target.value })}>{schedulerOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      <Field label={`去噪强度（${ranges.denoise.min}–${ranges.denoise.max}）`}><input aria-label="ComfyUI denoise" type="number" min={ranges.denoise.min} max={ranges.denoise.max} step={ranges.denoise.step} disabled={!supportsDenoise} value={sampling.denoise} onChange={event => patch({ denoise: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
      <Field label="宽度"><input aria-label="ComfyUI 宽度" type="number" min={64} max={4096} step={8} disabled={selected?.operation === "img2img"} value={options.width} onChange={event => patch({ width: Number(event.target.value) })} /></Field>
      <Field label="高度"><input aria-label="ComfyUI 高度" type="number" min={64} max={4096} step={8} disabled={selected?.operation === "img2img"} value={options.height} onChange={event => patch({ height: Number(event.target.value) })} /></Field>
      <Field label="种子（-1 随机）"><input aria-label="ComfyUI 种子" type="number" min={-1} step={1} value={options.seed} onChange={event => patch({ seed: Number(event.target.value) })} /></Field>
      <Field label="负面提示词"><input aria-label="ComfyUI 负面提示词" value={options.negativePrompt || ""} onChange={event => patch({ negativePrompt: event.target.value })} /></Field>
    </div>
    <p>{selected?.operation === "img2img" ? `图生图需要 ${selected.imageInputs} 张受管素材，按素材尺寸执行。` : "文生图模板无需参考素材。"}</p>
    {!capabilities ? <InlineNotice tone="warning">尚未检查连接能力，将显示模板默认值；提交前会再次验证参数是否受支持。</InlineNotice> : null}
    {status ? <InlineNotice>{status}</InlineNotice> : null}
    <details data-comfyui-connection-manager><summary>管理 ComfyUI 连接</summary>
      <div className="manual-image-task-controls">
        <Field label="连接名称"><input aria-label="ComfyUI 连接名称" value={connectionDraft.label} disabled={busy} onChange={event => editConnection({ label: event.target.value })} /></Field>
        <Field label="网络范围"><select aria-label="ComfyUI 网络范围" value={connectionDraft.networkScope} disabled={busy} onChange={event => editConnection({ networkScope: event.target.value as NetworkScope })}>
          <option value="local">本机 · loopback</option><option value="lan">局域网 · 私网</option><option value="remote">远程 · HTTPS</option>
        </select></Field>
        <Field label="服务地址"><input aria-label="ComfyUI 地址" value={connectionDraft.baseUrl} disabled={busy} onChange={event => editConnection({ baseUrl: event.target.value })} /></Field>
        <Field label="认证方式"><select aria-label="ComfyUI 认证方式" value={connectionDraft.credentialType} disabled={busy} onChange={event => editConnection({ credentialType: event.target.value as CredentialMode })}>
          <option value="none">无认证</option><option value="bearer">Bearer</option><option value="basic">Basic</option><option value="mtls">mTLS</option>
        </select></Field>
      </div>
      <p>{connectionDraft.networkScope === "remote" ? "远程地址默认需要 HTTPS。" : connectionDraft.networkScope === "lan" ? "局域网地址只能解析到获准的私网范围。" : "本机地址只能使用 localhost 或回环 IP。"} 通过系统文件选择器导入凭据，Token、密码、证书和私钥不会回传到此界面。</p>
      {options.baseUrl && !options.connectionId ? <p>旧任务地址可继续读取；保存后新任务只记录连接 ID。</p> : null}
      <ActionButton busy={busy} disabled={!connectionDraft.baseUrl.trim()} onClick={() => void saveConnectionFromForm()}>保存连接</ActionButton>
      <ActionButton busy={busy} disabled={connectionDirty || !connectionDraft.connectionId || connectionDraft.credentialType === "none"} onClick={() => void importCredential()}>导入凭据</ActionButton>
      <ActionButton busy={busy} disabled={!connectionDraft.baseUrl.trim()} onClick={() => void inspect()}>测试连接</ActionButton>
      <ActionButton disabled={busy} onClick={() => { clearInspection(); setConnectionDraft(connectionDraftFor()); setConnectionDirty(true); setCredentialDirty(false); }}>新增连接</ActionButton>
    </details>
    <details><summary>导入 API Format JSON 模板</summary>
      <p>只接受审核核心节点。输入映射与 SaveImage 输出必须明确；首期不支持云端 API 或自定义节点。</p>
      <Field label="模板名称"><input value={label} onChange={event => setLabel(event.target.value)} /></Field>
      <Field label="SaveImage 输出节点 ID"><input value={outputNodeId} onChange={event => setOutputNodeId(event.target.value)} /></Field>
      <Field label="输入映射 JSON"><textarea aria-label="ComfyUI 输入映射 JSON" rows={5} value={mapping} onChange={event => setMapping(event.target.value)} /></Field>
      <ActionButton busy={busy} onClick={() => void importTemplate()}>选择 API JSON 并校验导入</ActionButton>
    </details>
  </section>;
}
