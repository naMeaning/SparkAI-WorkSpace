import { useEffect, useMemo, useRef, useState } from "react";
import { COMFYUI_PARAMETER_RANGES } from "../runtime/comfyui-options.mjs";
import type { ComfyUiParameterRanges, ComfyUiTaskOptions, ComfyUiTemplate, ImageTaskDraft } from "./core";
import { ActionButton, Field, InlineNotice } from "./ui";

type InspectCapabilities = {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  parameterRanges: ComfyUiParameterRanges;
  capabilitiesHash?: string;
  devices?: Array<{ name: string; type: string }>;
};

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
  const [capabilities, setCapabilities] = useState<InspectCapabilities | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState("");
  const [outputNodeId, setOutputNodeId] = useState("9");
  const [label, setLabel] = useState("");
  const options = draft.comfyui || {
    templateId: "", templateHash: "", baseUrl: "http://127.0.0.1:8188", checkpoint: "", seed: -1, width: 1024, height: 1024
  };
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const currentBaseUrl = useRef(options.baseUrl);
  currentBaseUrl.current = options.baseUrl;
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
    update({ provider: "comfyui", count: 1, comfyui: { ...latestOptions.current, ...value } });
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
  useEffect(() => { setCapabilities(null); setStatus(""); }, [options.baseUrl]);
  async function inspect() {
    setBusy(true); setStatus("");
    const inspectedBaseUrl = options.baseUrl;
    try {
      const result = await window.naimageServer?.comfyui({ action: "inspect", baseUrl: inspectedBaseUrl });
      if (currentBaseUrl.current !== inspectedBaseUrl) return;
      if (!result?.ok) throw new Error(result?.error || "未连接本机 ComfyUI。");
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
      setStatus(`已连接 · ${inspected.checkpoints.length} 个模型 · ${inspected.samplers.length} 个采样器 · ${inspected.schedulers.length} 个调度器 · ${inspected.devices?.map(device => device.name).join("、") || "本机设备"}`);
    } catch (error) {
      if (currentBaseUrl.current !== inspectedBaseUrl) return;
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
      setStatus("模板已校验并保存。执行前仍会检查本机节点与模型依赖。");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="comfyui-task-fields" aria-label="ComfyUI 本地生图配置" data-comfyui-inspected={capabilities ? "true" : "false"}>
    <div className="manual-image-task-controls">
      <Field label="本机服务"><input aria-label="ComfyUI 地址" value={options.baseUrl} onChange={event => { currentBaseUrl.current = event.target.value; setCapabilities(null); setStatus(""); patch({ baseUrl: event.target.value }); }} /></Field>
      <ActionButton busy={busy} onClick={() => void inspect()}>检查环境</ActionButton>
      <Field label="审核模板"><select aria-label="ComfyUI 模板" value={options.templateId} onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) select(template); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.label} · v{template.version}</option>)}</select></Field>
      <Field label="本机模型"><input aria-label="ComfyUI 模型" list="comfyui-checkpoint-options" value={options.checkpoint} onChange={event => patch({ checkpoint: event.target.value })} placeholder="检查环境后选择 checkpoint" /><datalist id="comfyui-checkpoint-options">{(capabilities?.checkpoints || []).map(name => <option key={name} value={name} />)}</datalist></Field>
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
    <p>{selected?.operation === "img2img" ? `图生图需要 ${selected.imageInputs} 张受管素材，按素材尺寸执行。` : "文生图模板无需参考素材。"} 本地生图使用现有 localhost 服务；Agent 对话仍使用当前连接。</p>
    {!capabilities ? <InlineNotice tone="warning">尚未检查本机能力，将显示模板默认值；提交前会再次验证参数是否受支持。</InlineNotice> : null}
    {status ? <InlineNotice>{status}</InlineNotice> : null}
    <details><summary>导入 API Format JSON 模板</summary>
      <p>只接受审核核心节点。输入映射与 SaveImage 输出必须明确；首期不支持云端 API 或自定义节点。</p>
      <Field label="模板名称"><input value={label} onChange={event => setLabel(event.target.value)} /></Field>
      <Field label="SaveImage 输出节点 ID"><input value={outputNodeId} onChange={event => setOutputNodeId(event.target.value)} /></Field>
      <Field label="输入映射 JSON"><textarea aria-label="ComfyUI 输入映射 JSON" rows={5} value={mapping} onChange={event => setMapping(event.target.value)} /></Field>
      <ActionButton busy={busy} onClick={() => void importTemplate()}>选择 API JSON 并校验导入</ActionButton>
    </details>
  </section>;
}
