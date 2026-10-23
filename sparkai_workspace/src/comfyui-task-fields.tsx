import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMFYUI_PARAMETER_RANGES } from "../runtime/comfyui-options.mjs";
import type { ComfyUiAssetIdentity, ComfyUiInputMapping, ComfyUiManagedMask, ComfyUiParameterRanges, ComfyUiTaskOptions, ComfyUiTemplate, ComfyUiWorkflowCapability, ComfyUiWorkflowImportPreview, ImageTaskDraft, ServerBridge } from "./core";
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
const capabilityLabels: Record<ComfyUiWorkflowCapability, string> = { generate: "文生图", img2img: "图生图", inpaint: "蒙版重绘", cutout: "蒙版抠图" };
const mappingLabels: Record<string, string> = { prompt: "提示词", negative: "负面提示词", model: "服务模型", width: "宽度", height: "高度", seed: "种子", steps: "步数", cfg: "CFG", sampler: "采样器", scheduler: "调度器", denoise: "强度", sourceImage: "源图", maskImage: "受管蒙版", referenceImages: "参考图", image: "素材" };
const sameImage = (a?: ComfyUiAssetIdentity, b?: Partial<ComfyUiAssetIdentity>) => Boolean(a && b && a.assetId === b.assetId && a.occurrenceId === b.occurrenceId && a.contentHash === b.contentHash);
const ComfyUiRuntimeManager = lazy(() => import("./comfyui-runtime-manager"));

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
  field = ({ negativePrompt: "negative", checkpoint: "model" } as Record<string, string>)[field] || field;
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

export default function ComfyUiTaskFields({ draft, update, projectId, conversationId, onValidityChange }: { draft: ImageTaskDraft; update: (patch: Partial<ImageTaskDraft>) => void; projectId: string; conversationId: string; onValidityChange: (valid: boolean) => void }) {
  const [templates, setTemplates] = useState<ComfyUiTemplate[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [capabilities, setCapabilities] = useState<InspectCapabilities | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<ComfyUiWorkflowImportPreview | null>(null);
  const [importCapability, setImportCapability] = useState<ComfyUiWorkflowCapability>("generate");
  const [importMappings, setImportMappings] = useState<ComfyUiInputMapping[]>([]);
  const [masks, setMasks] = useState<ComfyUiManagedMask[]>([]);
  const [outputNodeId, setOutputNodeId] = useState("9");
  const [runtimeManagerOpen, setRuntimeManagerOpen] = useState(false);
  const [label, setLabel] = useState("");
  const options: ComfyUiTaskOptions = draft.comfyui || {
    templateId: "", templateHash: "", checkpoint: "", seed: -1, width: 1024, height: 1024
  };
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(() => connectionDraftFor(undefined, options.baseUrl));
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [credentialDirty, setCredentialDirty] = useState(false);
  const inspectRevision = useRef(0);
  const latestOptions = useRef(options);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  latestOptions.current = options;
  const refreshRuntimeConnections = useCallback(() => {
    void window.naimageServer?.comfyui({ action: "connections-list" }).then(result => {
      if (!mounted.current) return;
      if (!result.ok) { setStatus(result.error || "读取本机环境连接失败。"); return; }
      setConnections(result.connections || []);
    }).catch(error => { if (mounted.current) setStatus(error instanceof Error ? error.message : String(error)); });
  }, []);
  const activeConnectionId = options.connectionId || options.profileId;
  const selectedConnection = connections.find(connection => connection.connectionId === activeConnectionId);
  const networkScope = selectedConnection?.networkScope || options.networkScope || (activeConnectionId ? "unknown" : "local");
  const selected = templates.find(template => template.id === options.templateId);
  const capability = selected?.capability || selected?.operation || "generate";
  const sourceRequired = selected?.inputRoles?.sourceImage?.required ?? capability !== "generate";
  const maskRequired = selected?.inputRoles?.maskImage?.required ?? ["inpaint", "cutout"].includes(capability);
  const referenceLimit = selected?.inputRoles ? selected.inputRoles.referenceImages?.maxCount || 0 : Math.max(0, (selected?.imageInputs || 0) - 1);
  const referenceMinimum = selected?.inputRoles?.referenceImages?.minCount ?? (selected?.inputRoles?.referenceImages?.required ? referenceLimit : 0);
  const managedImages = (draft.referenceImages || []).filter((image): image is typeof image & ComfyUiAssetIdentity => Boolean(image.assetId && image.occurrenceId && image.contentHash));
  const sourceAvailable = managedImages.some(image => sameImage(options.sourceImage, image));
  const ready = Boolean(!busy && !connectionDirty && !credentialDirty && selected && options.templateHash === selected.templateHash && activeConnectionId && selectedConnection?.enabled !== false && selectedConnection
    && (selected.requiresCheckpoint === false || options.checkpoint) && (!sourceRequired || sourceAvailable)
    && (options.referenceImages?.length || 0) >= referenceMinimum && (options.referenceImages?.length || 0) <= referenceLimit
    && (options.referenceImages || []).every(reference => !sameImage(reference, options.sourceImage) && managedImages.some(image => sameImage(reference, image)))
    && (!maskRequired || masks.some(mask => sameImage(options.maskImage, mask) && mask.revision === options.maskImage?.revision)));
  useEffect(() => { onValidityChange(ready); }, [ready, onValidityChange]);
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
    if (!mounted.current) return;
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
      templateId: template.id, workflowId: template.id, templateHash: template.templateHash,
      checkpoint: template.requiresCheckpoint === false ? undefined : latestOptions.current.checkpoint,
      steps: undefined, cfg: undefined, sampler: undefined, scheduler: undefined, denoise: undefined, strength: undefined,
      sourceImage: undefined, maskImage: undefined, referenceImages: undefined
    };
    for (const field of ["steps", "cfg", "sampler", "scheduler", "denoise"] as const) {
      const templateValue = template.defaults?.[field];
      if (templateSupports(template, field) && templateValue !== undefined) Object.assign(value, { [field]: templateValue });
    }
    patch(value);
  }
  useEffect(() => {
    let stopped = false;
    void window.naimageServer?.comfyui({ action: "list" }).then(result => {
      if (stopped) return;
      if (!result.ok) { setStatus(result.error || "读取本地模板失败。"); return; }
      setTemplates(result.templates || []);
      const first = result.templates?.find(template => template.id === options.templateId) || result.templates?.[0];
      if (first) {
        if (!options.templateId) select(first);
      }
    });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    let stopped = false;
    setMasks([]);
    if (!sourceAvailable || !options.sourceImage || !maskRequired) return;
    void window.naimageServer?.comfyui({ action: "masks-list", projectId, conversationId, sourceImage: options.sourceImage }).then(result => {
      if (stopped) return;
      if (!result.ok) { setStatus(result.error || "读取受管蒙版失败。"); return; }
      setMasks(result.masks || []);
    }).catch(error => { if (!stopped) setStatus(error instanceof Error ? error.message : String(error)); });
    return () => { stopped = true; };
  }, [projectId, conversationId, options.sourceImage?.assetId, options.sourceImage?.occurrenceId, options.sourceImage?.contentHash, sourceAvailable, maskRequired]);
  async function importMask() {
    if (!options.sourceImage || !sourceAvailable) return;
    const sourceImage = { ...options.sourceImage };
    setBusy(true); setStatus("");
    try {
      const result = await window.naimageServer?.comfyui({ action: "masks-import", projectId, conversationId, sourceImage, confirmed: true });
      if (!result?.ok) throw new Error(result?.error || "蒙版导入失败。");
      if (result.canceled || !sameImage(sourceImage, latestOptions.current.sourceImage)) return;
      if (!result.mask) throw new Error("未返回受管蒙版身份。");
      const mask = result.mask;
      setMasks(current => [...current.filter(item => !sameImage(mask, item)), mask]);
      patch({ maskImage: { assetId: mask.assetId, occurrenceId: mask.occurrenceId, contentHash: mask.contentHash, revision: mask.revision } });
      setStatus(`蒙版已保存 · ${mask.width} × ${mask.height} · revision ${mask.revision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
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
      if (selected?.requiresCheckpoint !== false && !latestOptions.current.checkpoint && inspected.checkpoints[0]) patch({ checkpoint: inspected.checkpoints[0] });
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
      const result = await window.naimageServer?.comfyui({ action: "workflow-preview-import", ...(label.trim() ? { label: label.trim() } : {}) });
      if (!result?.ok) throw new Error(result?.error || "工作流预检失败。");
      if (result.canceled) return;
      if (!result.draftId || !result.nodes) throw new Error("工作流预检未返回有效草稿。");
      const preview: ComfyUiWorkflowImportPreview = { draftId: result.draftId, blocked: Boolean(result.blocked), issues: result.issues || [], nodes: result.nodes, candidateCapabilities: result.candidateCapabilities || [] };
      setImportPreview(preview); setImportMappings([]);
      setImportCapability(preview.candidateCapabilities[0] || "generate");
      setOutputNodeId(preview.nodes.find(node => node.outputNode && node.approved)?.nodeId || "");
      setStatus(preview.blocked ? "工作流含未审核节点或输入，已阻止执行。" : "预检通过。请配置能力、输出节点和输入映射后保存。");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function approveTemplate() {
    if (!importPreview || importPreview.blocked) return;
    setBusy(true); setStatus("");
    try {
      const result = await window.naimageServer?.comfyui({ action: "workflow-approve-import", draftId: importPreview.draftId, ...(label.trim() ? { label: label.trim() } : {}), capability: importCapability, outputNodeId, inputMappings: importMappings, confirmed: true });
      if (!result?.ok) throw new Error(result?.error || "输入映射未通过审核。");
      setTemplates(result.templates || []);
      if (result.template) select(result.template);
      setImportPreview(null);
      setStatus("审核工作流已保存。执行前仍会检查服务节点与模型依赖。");
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
      <Field label="审核工作流"><select aria-label="ComfyUI 模板" value={options.templateId} disabled={busy} onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) select(template); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.label} · {capabilityLabels[template.capability || template.operation]} · v{template.version}</option>)}</select></Field>
      <Field label="服务模型"><input aria-label="ComfyUI 模型" list="comfyui-checkpoint-options" value={options.checkpoint || ""} disabled={selected?.requiresCheckpoint === false} onChange={event => patch({ checkpoint: event.target.value })} placeholder={selected?.requiresCheckpoint === false ? "此工作流无需模型" : "检查环境后选择 checkpoint"} /><datalist id="comfyui-checkpoint-options">{(capabilities?.checkpoints || []).map(name => <option key={name} value={name} />)}</datalist></Field>
      <Field label={`采样步数（${ranges.steps.min}–${ranges.steps.max}）`}><input aria-label="ComfyUI steps" type="number" min={ranges.steps.min} max={ranges.steps.max} step={ranges.steps.step} disabled={!templateSupports(selected, "steps")} value={sampling.steps} onChange={event => patch({ steps: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
      <Field label={`CFG（${ranges.cfg.min}–${ranges.cfg.max}）`}><input aria-label="ComfyUI cfg" type="number" min={ranges.cfg.min} max={ranges.cfg.max} step={ranges.cfg.step} disabled={!templateSupports(selected, "cfg")} value={sampling.cfg} onChange={event => patch({ cfg: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
      <Field label="采样器"><select aria-label="ComfyUI sampler" value={sampling.sampler} disabled={!capabilities || !templateSupports(selected, "sampler")} onChange={event => patch({ sampler: event.target.value })}>{samplerOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      <Field label="调度器"><select aria-label="ComfyUI scheduler" value={sampling.scheduler} disabled={!capabilities || !templateSupports(selected, "scheduler")} onChange={event => patch({ scheduler: event.target.value })}>{schedulerOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      <Field label={`去噪强度（${ranges.denoise.min}–${ranges.denoise.max}）`}><input aria-label="ComfyUI denoise" type="number" min={ranges.denoise.min} max={ranges.denoise.max} step={ranges.denoise.step} disabled={!supportsDenoise} value={sampling.denoise} onChange={event => patch({ denoise: event.target.value === "" ? undefined : Number(event.target.value), strength: undefined })} /></Field>
      <Field label="宽度"><input aria-label="ComfyUI 宽度" type="number" min={64} max={4096} step={8} disabled={sourceRequired} value={options.width} onChange={event => patch({ width: Number(event.target.value) })} /></Field>
      <Field label="高度"><input aria-label="ComfyUI 高度" type="number" min={64} max={4096} step={8} disabled={sourceRequired} value={options.height} onChange={event => patch({ height: Number(event.target.value) })} /></Field>
      <Field label="种子（-1 随机）"><input aria-label="ComfyUI 种子" type="number" min={-1} step={1} disabled={!templateSupports(selected, "seed")} value={options.seed} onChange={event => patch({ seed: Number(event.target.value) })} /></Field>
      <Field label="负面提示词"><input aria-label="ComfyUI 负面提示词" disabled={!templateSupports(selected, "negativePrompt")} value={options.negativePrompt || ""} onChange={event => patch({ negativePrompt: event.target.value })} /></Field>
    </div>
    <p data-comfyui-capability={capability}>{capabilityLabels[capability]} · {sourceRequired ? "按源图尺寸执行，原图和蒙版均保留。" : "按设定尺寸生成新成果。"}{capability === "cutout" ? "使用你提供的蒙版移除背景，并校验输出的真实透明像素。" : ""}</p>
    {sourceRequired ? <Field label="源图"><select aria-label="ComfyUI 源图" value={sourceAvailable ? options.sourceImage?.occurrenceId || "" : ""} disabled={busy} onChange={event => {
      const image = managedImages.find(item => item.occurrenceId === event.target.value);
      patch({ sourceImage: image ? { assetId: image.assetId, occurrenceId: image.occurrenceId, contentHash: image.contentHash } : undefined, maskImage: undefined, referenceImages: undefined });
    }}><option value="">请从下方素材入口添加图片，再选择源图</option>{managedImages.map(image => <option key={image.occurrenceId} value={image.occurrenceId}>{image.name || "项目图片"}</option>)}</select></Field> : null}
    {maskRequired ? <div data-comfyui-mask-fields>
      <Field label="受管蒙版"><select aria-label="ComfyUI 蒙版" value={masks.some(mask => sameImage(options.maskImage, mask)) ? options.maskImage?.occurrenceId || "" : ""} disabled={busy || !sourceAvailable} onChange={event => {
        const mask = masks.find(item => item.occurrenceId === event.target.value);
        patch({ maskImage: mask ? { assetId: mask.assetId, occurrenceId: mask.occurrenceId, contentHash: mask.contentHash, revision: mask.revision } : undefined });
      }}><option value="">请选择与当前源图绑定的蒙版</option>{masks.map((mask, index) => <option key={mask.occurrenceId} value={mask.occurrenceId}>蒙版 {index + 1} · {mask.width} × {mask.height} · r{mask.revision}</option>)}</select></Field>
      <p>导入与源图同尺寸的透明 PNG；透明区域{capability === "cutout" ? "将被移除" : "允许修改"}，不透明区域保留。黑白颜色本身不代表蒙版范围。</p>
      <ActionButton busy={busy} disabled={!sourceAvailable} onClick={() => void importMask()}>导入 PNG 蒙版</ActionButton>
    </div> : null}
    {referenceLimit > 0 ? <Field label={referenceMinimum === referenceLimit ? `额外参考图（需选择 ${referenceLimit} 张）` : `额外参考图（最多 ${referenceLimit} 张）`}><div data-comfyui-reference-fields>{managedImages.filter(image => !sameImage(options.sourceImage, image)).map(image => <label key={image.occurrenceId}>
      <input type="checkbox" aria-label={`ComfyUI 参考图 ${image.name}`} checked={Boolean(options.referenceImages?.some(item => sameImage(item, image)))} disabled={busy || !options.referenceImages?.some(item => sameImage(item, image)) && (options.referenceImages?.length || 0) >= referenceLimit} onChange={event => patch({ referenceImages: event.target.checked ? [...(options.referenceImages || []), { assetId: image.assetId, occurrenceId: image.occurrenceId, contentHash: image.contentHash }] : options.referenceImages?.filter(item => !sameImage(item, image)) })} />{image.name || "项目图片"}
    </label>)}</div></Field> : null}
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
    <details data-comfyui-runtime-manager-entry onToggle={event => setRuntimeManagerOpen(event.currentTarget.open)}><summary>本机运行环境和模型</summary>
      {runtimeManagerOpen ? <Suspense fallback={<InlineNotice>正在打开运行环境管理…</InlineNotice>}><ComfyUiRuntimeManager onConnectionsChanged={refreshRuntimeConnections} /></Suspense> : null}
    </details>
    <details data-comfyui-workflow-import><summary>导入 API Format JSON 工作流</summary>
      <p>选择本地文件后先审核节点，再配置输入映射。未审核节点、脚本和任意文件读取不能执行。</p>
      <Field label="工作流名称"><input aria-label="ComfyUI 工作流名称" value={label} onChange={event => setLabel(event.target.value)} /></Field>
      <ActionButton busy={busy} onClick={() => void importTemplate()}>选择 API JSON 并预检</ActionButton>
      {importPreview ? <div data-comfyui-mapping-wizard>
        {importPreview.issues.length ? <InlineNotice tone="warning">{importPreview.issues.map(issue => `${issue.code}${issue.nodeId ? ` · 节点 ${issue.nodeId}` : ""}${issue.classType ? ` (${issue.classType})` : ""}`).join("；")}</InlineNotice> : null}
        <p>{importPreview.nodes.map(node => `${node.nodeId} · ${node.classType}${node.approved ? "" : "（未审核）"}`).join(" / ")}</p>
        <Field label="工作流能力"><select aria-label="ComfyUI 导入能力" value={importCapability} disabled={busy || importPreview.blocked} onChange={event => setImportCapability(event.target.value as ComfyUiWorkflowCapability)}>{importPreview.candidateCapabilities.map(value => <option key={value} value={value}>{capabilityLabels[value]}</option>)}</select></Field>
        <Field label="成果输出"><select aria-label="ComfyUI 导入输出" value={outputNodeId} disabled={busy || importPreview.blocked} onChange={event => setOutputNodeId(event.target.value)}>{importPreview.nodes.filter(node => node.outputNode && node.approved).map(node => <option key={node.nodeId} value={node.nodeId}>节点 {node.nodeId} · {node.classType}</option>)}</select></Field>
        {importPreview.nodes.filter(node => node.approved).flatMap(node => node.inputs.filter(input => input.allowedKinds.length).map(input => {
          const current = importMappings.find(mapping => mapping.nodeId === node.nodeId && mapping.inputName === input.inputName);
          return <Field key={`${node.nodeId}:${input.inputName}`} label={`${node.nodeId} · ${input.inputName} (${input.type})`}><select aria-label={`ComfyUI 映射 ${node.nodeId} ${input.inputName}`} value={current ? `${current.kind}:${current.index ?? ""}` : ""} disabled={busy || importPreview.blocked} onChange={event => {
            const [kind, index] = event.target.value.split(":");
            setImportMappings(mappings => [...mappings.filter(mapping => mapping.nodeId !== node.nodeId || mapping.inputName !== input.inputName), ...(kind ? [{ nodeId: node.nodeId, inputName: input.inputName, kind, ...(index ? { index: Number(index) } : {}) }] : [])]);
          }}><option value="">保留工作流固定值或已有连接</option>{input.allowedKinds.filter(kind => kind !== "fixed").flatMap(kind => ["image", "referenceImages"].includes(kind) ? Array.from({ length: 4 }, (_, index) => <option key={`${kind}:${index}`} value={`${kind}:${index}`}>{mappingLabels[kind] || kind} {index + 1}</option>) : <option key={kind} value={`${kind}:`}>{mappingLabels[kind] || kind}</option>)}</select></Field>;
        }))}
        <ActionButton busy={busy} disabled={importPreview.blocked || !outputNodeId || !importMappings.length} onClick={() => void approveTemplate()}>审核并保存工作流</ActionButton>
      </div> : null}
    </details>
  </section>;
}
