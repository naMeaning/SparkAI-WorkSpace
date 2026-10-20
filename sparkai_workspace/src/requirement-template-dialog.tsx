import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Save, Trash2 } from "lucide-react";
import type { RequirementLibraryEntry, WorkflowNode } from "./core";
import {
  expandRequirementTemplate,
  normalizeRequirementTemplate,
  type RequirementTemplate,
  type RequirementTemplateImageBinding,
  type RequirementTemplateVariable,
} from "../runtime/requirement-template-contract.mjs";
import { ActionButton, ButtonBase, DialogShell, Field, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader, UnsavedChangesDialog } from "./ui";
import "./styles/04-requirement-template.css";

export type RequirementTemplateUseOptions = {
  expectedTemplateRevision: number;
  expectedProjectId: string;
  variableValues: Record<string, string | number>;
  imageBindings: RequirementTemplateImageBinding[];
  inputBindings: { nodeId: string; role: "source" | "reference" }[];
};

type VariableDraft = {
  key: string;
  type: RequirementTemplateVariable["type"];
  label: string;
  required: boolean;
  defaultValue: string;
  options: string;
  min: string;
  max: string;
  step: string;
  maxLength: string;
  role: "source" | "reference";
};

const variableTypeLabels = { text: "文字", enum: "选项", number: "数字", image: "图片" };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const toDraft = (variable: RequirementTemplateVariable): VariableDraft => ({
  key: variable.key, type: variable.type, label: variable.label || variable.key, required: variable.required !== false,
  defaultValue: "default" in variable && variable.default !== undefined ? String(variable.default) : "",
  options: variable.type === "enum" ? variable.options.join("\n") : "",
  min: variable.type === "number" && variable.min !== undefined ? String(variable.min) : "",
  max: variable.type === "number" && variable.max !== undefined ? String(variable.max) : "",
  step: variable.type === "number" && variable.step !== undefined ? String(variable.step) : "",
  maxLength: variable.type === "text" && variable.maxLength !== undefined ? String(variable.maxLength) : "",
  role: variable.type === "image" ? variable.role || "source" : "source",
});

function fromDraft(variable: VariableDraft): RequirementTemplateVariable {
  const common = { key: variable.key.trim(), label: variable.label.trim(), required: variable.required };
  if (variable.type === "image") return { ...common, type: "image", role: variable.role };
  if (variable.type === "enum") return { ...common, type: "enum", options: variable.options.split(/\r?\n/).map(value => value.trim()).filter(Boolean), ...(variable.defaultValue ? { default: variable.defaultValue } : {}) };
  if (variable.type === "number") return {
    ...common, type: "number",
    ...(variable.min !== "" ? { min: Number(variable.min) } : {}),
    ...(variable.max !== "" ? { max: Number(variable.max) } : {}),
    ...(variable.step !== "" ? { step: Number(variable.step) } : {}),
    ...(variable.defaultValue !== "" ? { default: Number(variable.defaultValue) } : {}),
  };
  return { ...common, type: "text", ...(variable.maxLength !== "" ? { maxLength: Number(variable.maxLength) } : {}), ...(variable.defaultValue ? { default: variable.defaultValue } : {}) };
}

export default function RequirementTemplateDialog({ templateId, mode: initialMode, projectId, nodes, selectedNodeId, onClose, onChanged, onUse }: {
  templateId: string;
  mode: "use" | "edit";
  projectId: string;
  nodes: WorkflowNode[];
  selectedNodeId: string;
  onClose: () => void;
  onChanged: () => void;
  onUse: (templateId: string, options: RequirementTemplateUseOptions) => Promise<unknown>;
}) {
  const [entry, setEntry] = useState<RequirementLibraryEntry | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [scenario, setScenario] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [variables, setVariables] = useState<VariableDraft[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [baseline, setBaseline] = useState("");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const editable = JSON.stringify({ title, text, scenario, materialNotes, styleNotes, variables });
  const dirty = Boolean(entry) && editable !== baseline;
  const imageChoices = useMemo(() => nodes.filter(node => node.type === "image" && node.assets?.some(asset => asset.status !== "error" && asset.status !== "pending")), [nodes]);

  function setLoadedEntry(next: RequirementLibraryEntry) {
    const template = next.template || { version: 2 as const, variables: [] };
    const nextVariables = template.variables.map(toDraft);
    setEntry(next); setTitle(next.title); setText(next.text || "");
    setScenario(template.scenario || ""); setMaterialNotes(template.materialNotes || ""); setStyleNotes(template.styleNotes || "");
    setVariables(nextVariables);
    setBaseline(JSON.stringify({ title: next.title, text: next.text || "", scenario: template.scenario || "", materialNotes: template.materialNotes || "", styleNotes: template.styleNotes || "", variables: nextVariables }));
    setValues(Object.fromEntries(template.variables.flatMap(variable => variable.type !== "image" && "default" in variable && variable.default !== undefined ? [[variable.key, String(variable.default)]] : [])));
    setImages({});
  }

  async function reload() {
    setBusy(true); setError("");
    try {
      const response = await window.naimageConfig?.getRequirementLibraryEntry?.({ id: templateId });
      if (!response?.ok || !response.entry) throw new Error(response?.error || "无法读取这个模板。");
      setLoadedEntry(response.entry);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void reload(); }, [templateId]);

  function currentTemplate(): RequirementTemplate {
    return normalizeRequirementTemplate({ version: 2, variables: variables.map(fromDraft),
      ...(scenario.trim() ? { scenario: scenario.trim() } : {}),
      ...(materialNotes.trim() ? { materialNotes: materialNotes.trim() } : {}),
      ...(styleNotes.trim() ? { styleNotes: styleNotes.trim() } : {}),
      ...(entry?.template?.acceptance ? { acceptance: entry.template.acceptance } : {}),
    }, text);
  }

  function updateVariable(index: number, patch: Partial<VariableDraft>) {
    setError(""); setNotice("");
    setVariables(current => current.map((variable, position) => position === index ? { ...variable, ...patch } : variable));
  }

  function addVariable() {
    let index = variables.length + 1;
    while (variables.some(variable => variable.key === `value_${index}`)) index++;
    setVariables(current => [...current, toDraft({ key: `value_${index}`, label: "新变量", type: "text", required: true, maxLength: 2000 })]);
  }

  async function save(closeAfter = false) {
    if (!entry || busy) return false;
    setError(""); setNotice("");
    try {
      if (!title.trim() || !text.trim()) throw new Error("请填写模板名称和创作要求。");
      const template = currentTemplate();
      setBusy(true);
      const response = await window.naimageConfig?.saveRequirementLibraryEntry?.({
        id: entry.id, expectedRevision: entry.revision, title, text, template,
        ...(entry.skill ? { skill: entry.skill } : {}), ...(entry.socialPlan ? { socialPlan: entry.socialPlan } : {}),
        ...(entry.scientificPlan ? { scientificPlan: entry.scientificPlan } : {}),
      });
      if (!response?.ok || !response.entry) throw new Error(response?.error || "模板保存失败，原版本已保留。");
      setLoadedEntry(response.entry); onChanged();
      setNotice(`已保存第 ${response.entry.revision} 版。已插入画布的需求保留原版本。`);
      if (closeAfter) onClose();
      return true;
    } catch (cause) { setError(errorText(cause)); return false; }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!entry || busy) return;
    setError(""); setNotice("");
    try {
      const variableValues: Record<string, string | number> = {};
      const imageBindings: RequirementTemplateImageBinding[] = [];
      for (const variable of entry.template?.variables || []) {
        const value = values[variable.key];
        if (variable.type === "image") {
          const nodeId = images[variable.key];
          if (nodeId) imageBindings.push({ key: variable.key, nodeId, role: variable.role || "source" });
        } else if (value !== undefined && value !== "") variableValues[variable.key] = variable.type === "number" ? Number(value) : value;
      }
      expandRequirementTemplate(entry, { expectedTemplateRevision: entry.revision, variableValues, imageBindings });
      setBusy(true);
      await onUse(entry.id, { expectedTemplateRevision: entry.revision, expectedProjectId: projectId, variableValues, imageBindings,
        inputBindings: imageBindings.filter((binding, index) => imageBindings.findIndex(candidate => candidate.nodeId === binding.nodeId) === index).map(binding => ({ nodeId: binding.nodeId, role: binding.role })) });
      onClose();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function exportTemplate() {
    if (!entry || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await window.naimageConfig?.exportRequirementLibraryEntry?.({ id: entry.id, expectedRevision: entry.revision });
      if (!response?.ok) throw new Error(response?.error || "模板导出失败。");
      if (!response.canceled) setNotice(`已导出 ${response.fileName || "模板文件"}。`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  function close() { if (dirty) setClosePromptOpen(true); else onClose(); }
  const templateVariables = entry?.template?.variables || [];
  const missingImages = templateVariables.filter(variable => variable.type === "image" && variable.required !== false && !images[variable.key]);
  const acceptance = entry?.template?.acceptance;
  const acceptanceCount = acceptance ? acceptance.preserve.length + acceptance.adjustable.length + acceptance.conditions.length : 0;

  return <>
    <DialogShell surface="requirement-template" ariaLabel={mode === "edit" ? "编辑创作模板" : "使用创作模板"} className="requirement-template-dialog" busy={busy} dirty={dirty} onRequestClose={close}>
      {({ requestClose }) => <>
        <SurfaceHeader title={mode === "edit" ? "编辑创作模板" : title || "使用创作模板"}
          description={mode === "edit" ? "用 {{变量名}} 在要求中引用变量；图片在每次使用时重新选择。" : "填写本次内容并选择当前项目素材，然后插入需求。"}
          onClose={() => requestClose("close-button")} />
        <SurfaceBody className="requirement-template-body">
          {entry ? <>
            <nav className="requirement-template-mode" aria-label="模板操作">
              <ButtonBase type="button" aria-pressed={mode === "use"} disabled={busy || dirty} onClick={() => setMode("use")}>使用模板</ButtonBase>
              <ButtonBase type="button" aria-pressed={mode === "edit"} disabled={busy} onClick={() => setMode("edit")}>编辑变量与要求</ButtonBase>
              <span>第 {entry.revision} 版</span>
            </nav>
            {mode === "edit" ? <>
              <Field label="模板名称"><input data-requirement-template-title value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></Field>
              <Field label="创作要求" hint="示例：为 {{product}} 创建 {{count}} 张 {{tone}} 场景图。">
                <textarea data-requirement-template-text className="requirement-template-text" value={text} maxLength={24000} onChange={event => setText(event.target.value)} />
              </Field>
              <div className="requirement-template-notes">
                <Field label="适用场景"><input data-requirement-template-scenario value={scenario} maxLength={2000} onChange={event => setScenario(event.target.value)} /></Field>
                <Field label="素材要求"><input data-requirement-template-material value={materialNotes} maxLength={2000} onChange={event => setMaterialNotes(event.target.value)} /></Field>
                <Field label="风格说明"><input data-requirement-template-style value={styleNotes} maxLength={2000} onChange={event => setStyleNotes(event.target.value)} /></Field>
              </div>
              <div className="requirement-template-section-heading"><strong>变量 {variables.length}/24</strong><ActionButton data-requirement-template-add disabled={busy || variables.length >= 24} icon={<Plus size={13} />} onClick={addVariable}>添加变量</ActionButton></div>
              {variables.map((variable, index) => <section className="requirement-template-variable" data-requirement-template-variable={index} key={index}>
                <div className="requirement-template-variable-heading"><strong>{variable.label || variable.key || `变量 ${index + 1}`}</strong><ButtonBase type="button" aria-label={`删除变量 ${index + 1}`} disabled={busy} onClick={() => setVariables(current => current.filter((_, position) => position !== index))}><Trash2 size={14} /></ButtonBase></div>
                <div className="requirement-template-variable-fields">
                  <Field label="变量名" hint="英文字母开头，可用数字和下划线"><input data-template-variable-field="key" value={variable.key} maxLength={40} onChange={event => updateVariable(index, { key: event.target.value })} /></Field>
                  <Field label="显示名称"><input data-template-variable-field="label" value={variable.label} maxLength={120} onChange={event => updateVariable(index, { label: event.target.value })} /></Field>
                  <Field label="类型"><select data-template-variable-field="type" value={variable.type} onChange={event => updateVariable(index, { type: event.target.value as VariableDraft["type"], defaultValue: "", options: "", min: "", max: "", step: "", maxLength: "" })}>{Object.entries(variableTypeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></Field>
                  <label className="requirement-template-check"><input data-template-variable-field="required" type="checkbox" checked={variable.required} onChange={event => updateVariable(index, { required: event.target.checked })} />必填</label>
                  {variable.type === "image" ? <Field label="图片用途"><select data-template-variable-field="role" value={variable.role} onChange={event => updateVariable(index, { role: event.target.value as "source" | "reference" })}><option value="source">要修改的原图</option><option value="reference">风格或内容参考</option></select></Field> : <>
                    {variable.type === "enum" ? <Field className="requirement-template-options" label="可选值" hint="每行一个，最多 24 个"><textarea data-template-variable-field="options" value={variable.options} onChange={event => updateVariable(index, { options: event.target.value })} /></Field> : null}
                    {variable.type === "text" ? <Field label="字数上限"><input data-template-variable-field="maxLength" type="number" min={1} max={2000} placeholder="2000" value={variable.maxLength} onChange={event => updateVariable(index, { maxLength: event.target.value })} /></Field> : null}
                    {variable.type === "number" ? ([ ["min", "最小值"], ["max", "最大值"], ["step", "步长"] ] as const).map(([key, label]) => <Field label={label} key={key}><input data-template-variable-field={key} type="number" step="any" value={variable[key]} onChange={event => updateVariable(index, { [key]: event.target.value })} /></Field>) : null}
                    <Field label="默认值"><input data-template-variable-field="default" type={variable.type === "number" ? "number" : "text"} step={variable.type === "number" ? "any" : undefined} value={variable.defaultValue} maxLength={2000} onChange={event => updateVariable(index, { defaultValue: event.target.value })} /></Field>
                  </>}
                </div>
              </section>)}
              {acceptance ? <p className="requirement-template-summary">已保留 {acceptance.slots.length} 个交付槽位和 {acceptanceCount} 条验收要求；素材一致性要求会使用本次图片变量。</p> : null}
            </> : <>
              {entry.template?.scenario ? <p className="requirement-template-summary">{entry.template.scenario}</p> : null}
              {entry.template?.materialNotes ? <p className="requirement-template-summary">素材：{entry.template.materialNotes}</p> : null}
              {entry.template?.styleNotes ? <p className="requirement-template-summary">风格：{entry.template.styleNotes}</p> : null}
              {templateVariables.map(variable => <Field key={variable.key} label={`${variable.label || variable.key}${variable.required !== false ? " *" : ""}`} hint={variable.type === "image" ? variable.role === "reference" ? "作为参考图；只可选择当前项目图片。" : "作为要修改的原图；只可选择当前项目图片。" : undefined}>
                {variable.type === "image" ? <select data-requirement-template-value={variable.key} value={images[variable.key] || ""} onChange={event => setImages(current => ({ ...current, [variable.key]: event.target.value }))}>
                  <option value="">稍后绑定，先创建草稿</option>
                  {imageChoices.map(node => <option key={node.id} value={node.id}>{node.title || "图片素材"}{node.id === selectedNodeId ? " · 当前选中" : ""}{(node.assets?.length || 0) > 1 ? ` · ${node.assets!.length} 张` : ""}</option>)}
                </select> : variable.type === "enum" ? <select data-requirement-template-value={variable.key} value={values[variable.key] || ""} onChange={event => setValues(current => ({ ...current, [variable.key]: event.target.value }))}><option value="">请选择</option>{variable.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
                  : <input data-requirement-template-value={variable.key} type={variable.type === "number" ? "number" : "text"} value={values[variable.key] || ""} min={variable.type === "number" ? variable.min : undefined} max={variable.type === "number" ? variable.max : undefined} step={variable.type === "number" ? variable.step || "any" : undefined} maxLength={variable.type === "text" ? variable.maxLength || 2000 : undefined} onChange={event => setValues(current => ({ ...current, [variable.key]: event.target.value }))} />}
              </Field>)}
              {missingImages.length ? <InlineNotice tone="neutral">有 {missingImages.length} 个必需图片尚未绑定，可以先插入草稿；补齐素材后才能执行。</InlineNotice> : null}
              <details className="requirement-template-preview"><summary>查看创作要求{acceptance ? ` · ${acceptance.slots.length} 个交付槽位 · ${acceptanceCount} 条验收要求` : ""}</summary><pre>{entry.text}</pre></details>
            </>}
          </> : !error ? <p aria-live="polite">正在读取模板…</p> : null}
          {error ? <InlineNotice tone="danger" data-requirement-template-error>{error}<ButtonBase type="button" disabled={busy} onClick={() => { void reload(); }}>读取最新版本</ButtonBase></InlineNotice> : null}
          {notice ? <InlineNotice tone="success" data-requirement-template-notice>{notice}</InlineNotice> : null}
        </SurfaceBody>
        <SurfaceFooter>
          <ActionButton variant="ghost" disabled={busy || !entry || dirty} icon={<Download size={14} />} data-requirement-template-export onClick={() => { void exportTemplate(); }}>导出</ActionButton>
          <ActionButton variant="ghost" disabled={busy} onClick={() => requestClose("action")}>关闭</ActionButton>
          {mode === "edit" ? <ActionButton variant="primary" disabled={!entry || !dirty} busy={busy} icon={<Save size={14} />} data-requirement-template-save onClick={() => { void save(); }}>保存模板</ActionButton>
            : <ActionButton variant="primary" disabled={!entry} busy={busy} data-requirement-template-apply onClick={() => { void apply(); }}>插入需求</ActionButton>}
        </SurfaceFooter>
      </>}
    </DialogShell>
    {closePromptOpen ? <UnsavedChangesDialog surface="requirement-template-unsaved" ariaLabel="保存模板修改" title="关闭前保存模板修改吗？" description="模板名称、要求或变量还有未保存的修改。" onContinueEditing={() => setClosePromptOpen(false)} onDiscard={onClose} onSave={() => { void save(true).then(saved => { if (!saved) setClosePromptOpen(false); }); }} saveLabel="保存并关闭" saveDisabled={busy} /> : null}
  </>;
}
