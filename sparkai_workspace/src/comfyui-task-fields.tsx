import { useEffect, useState } from "react";
import type { ComfyUiTaskOptions, ComfyUiTemplate, ImageTaskDraft } from "./core";
import { ActionButton, Field, InlineNotice } from "./ui";

export default function ComfyUiTaskFields({ draft, update }: { draft: ImageTaskDraft; update: (patch: Partial<ImageTaskDraft>) => void }) {
  const [templates, setTemplates] = useState<ComfyUiTemplate[]>([]);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState("");
  const [outputNodeId, setOutputNodeId] = useState("9");
  const [label, setLabel] = useState("");
  const options = draft.comfyui || { templateId: "", templateHash: "", baseUrl: "http://127.0.0.1:8188", checkpoint: "", seed: -1, width: 1024, height: 1024 };
  const selected = templates.find(template => template.id === options.templateId);
  function patch(value: Partial<ComfyUiTaskOptions>) { update({ provider: "comfyui", count: 1, comfyui: { ...options, ...value } }); }
  function select(template: ComfyUiTemplate) {
    patch({ templateId: template.id, templateHash: template.templateHash });
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
  async function inspect() {
    setBusy(true); setStatus("");
    try {
      const result = await window.naimageServer?.comfyui({ action: "inspect", baseUrl: options.baseUrl });
      if (!result?.ok) throw new Error(result?.error || "未连接本机 ComfyUI。");
      setCheckpoints(result.checkpoints || []);
      if (!options.checkpoint && result.checkpoints?.[0]) patch({ checkpoint: result.checkpoints[0] });
      setStatus(`已连接 · ${result.checkpoints?.length || 0} 个模型 · ${result.devices?.map(device => device.name).join("、") || "本机设备"}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
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
  return <section className="comfyui-task-fields" aria-label="ComfyUI 本地生图配置">
    <div className="manual-image-task-controls">
      <Field label="本机服务"><input aria-label="ComfyUI 地址" value={options.baseUrl} onChange={event => patch({ baseUrl: event.target.value })} /></Field>
      <ActionButton busy={busy} onClick={() => void inspect()}>检查环境</ActionButton>
      <Field label="审核模板"><select aria-label="ComfyUI 模板" value={options.templateId} onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) select(template); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.label} · v{template.version}</option>)}</select></Field>
      <Field label="本机模型"><input aria-label="ComfyUI 模型" list="comfyui-checkpoint-options" value={options.checkpoint} onChange={event => patch({ checkpoint: event.target.value })} placeholder="检查环境后选择 checkpoint" /><datalist id="comfyui-checkpoint-options">{checkpoints.map(name => <option key={name} value={name} />)}</datalist></Field>
      <Field label="宽度"><input aria-label="ComfyUI 宽度" type="number" min={64} max={4096} step={8} disabled={selected?.operation === "img2img"} value={options.width} onChange={event => patch({ width: Number(event.target.value) })} /></Field>
      <Field label="高度"><input aria-label="ComfyUI 高度" type="number" min={64} max={4096} step={8} disabled={selected?.operation === "img2img"} value={options.height} onChange={event => patch({ height: Number(event.target.value) })} /></Field>
      <Field label="种子（-1 随机）"><input aria-label="ComfyUI 种子" type="number" min={-1} step={1} value={options.seed} onChange={event => patch({ seed: Number(event.target.value) })} /></Field>
      <Field label="负面提示词"><input aria-label="ComfyUI 负面提示词" value={options.negativePrompt || ""} onChange={event => patch({ negativePrompt: event.target.value })} /></Field>
    </div>
    <p>{selected?.operation === "img2img" ? `图生图需要 ${selected.imageInputs} 张受管素材，按素材尺寸执行。` : "文生图模板无需参考素材。"} 本地生图使用现有 localhost 服务；Agent 对话仍使用当前连接。</p>
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
