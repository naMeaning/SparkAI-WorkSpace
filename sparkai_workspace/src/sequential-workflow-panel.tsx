import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2, X } from "lucide-react";
import { ButtonBase, IconActionButton } from "./ui";
import type { ImageAsset } from "./core";
import { workflowAssetIdentity, workflowBindings, workflowIssues, workflowStepNames, workflowStepPrompt, type WorkflowAssetIdentity, type WorkflowBindings, type WorkflowDefinition, type WorkflowStep, type WorkflowStepKind } from "../runtime/sequential-workflow.mjs";

export type WorkflowDraft = { revision: number; definition: WorkflowDefinition; bindings: WorkflowBindings; libraryId?: string };
export type WorkflowLibraryEntry = { id: string; revision: number; definition: WorkflowDefinition; legacyId?: string };
export type WorkflowRun = {
  id: string;
  state: string;
  startedAt: string;
  definition: WorkflowDefinition;
  draftRevision: number;
  bindings: WorkflowBindings;
  sourceNodes: Record<string, string>;
  steps: { id: string; state: string; output?: ImageAsset; published?: boolean; error?: string }[];
};
export type WorkflowState = { draft: WorkflowDraft; running: boolean; runs: WorkflowRun[] };
export type WorkflowReply = Partial<WorkflowState> & { ok: boolean; error?: string; entry?: WorkflowLibraryEntry; entries?: WorkflowLibraryEntry[]; runId?: string };
export type WorkflowMaterial = WorkflowAssetIdentity & { label: string };

export async function sequentialWorkflow(projectId: string, action: string, data: Record<string, unknown> = {}) {
  const result = await window.naimageConfig?.sequentialWorkflow({ ...data, action, projectId });
  if (!result?.ok) throw new Error(result?.error || "工作流服务不可用。");
  return result;
}

const emptyDefinition: WorkflowDefinition = { version: 1, title: "未命名工作流", inputs: [], steps: [] };
const identifier = () => `item-${crypto.randomUUID()}`;
const runLabels: Record<string, string> = { queued: "等待", running: "运行中", done: "已完成", failed: "可重试", uncertain: "等待确认", recovering: "正在恢复", interrupted: "已中断" };

export default function SequentialWorkflowPanel({ state, projectId, conversationId, materials, selectedMaterial, ensureSaved, saveBeforeExit, close, openLegacy }: {
  state: WorkflowState;
  projectId: string;
  conversationId: string;
  materials: WorkflowMaterial[];
  selectedMaterial?: WorkflowMaterial;
  ensureSaved: () => Promise<void>;
  saveBeforeExit: { current: (() => Promise<void>) | null };
  close: () => void;
  openLegacy: () => void;
}) {
  const [draft, setDraft] = useState(state.draft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"draft" | "library" | "runs">("draft");
  const [entries, setEntries] = useState<WorkflowLibraryEntry[]>([]);
  const [description, setDescription] = useState("");
  const [showAgent, setShowAgent] = useState(false);
  const [stepKind, setStepKind] = useState<WorkflowStepKind>("generate");
  const [openStep, setOpenStep] = useState("");
  const [draggedStep, setDraggedStep] = useState("");
  const availableMaterials = new Map(materials.map(material => [material.occurrenceId, material]));
  const activeBindings = Object.fromEntries(Object.entries(draft.bindings).map(([id, value]) => {
    const asset = workflowAssetIdentity(value);
    const current = asset && availableMaterials.get(asset.occurrenceId);
    return [id, asset && (!current || current.contentHash !== asset.contentHash || current.assetId !== asset.assetId) ? null : value];
  }));
  const issues = workflowIssues(draft.definition, activeBindings);

  function accept(next: WorkflowReply) {
    if (next.draft) { setDraft(next.draft); setDirty(false); }
    return next.draft || draft;
  }

  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (error) { setError(error instanceof Error ? error.message : "工作流操作失败。"); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!dirty && !busy && state.draft.revision > draft.revision) setDraft(state.draft);
  }, [busy, dirty, draft.revision, state.draft]);

  async function persist() {
    if (!dirty) return draft;
    return accept(await sequentialWorkflow(projectId, "edit", { definition: draft.definition, bindings: draft.bindings, libraryId: draft.libraryId, expectedRevision: draft.revision }));
  }

  useEffect(() => {
    saveBeforeExit.current = async () => {
      if (busy) throw new Error("请等待工作流编辑器完成当前操作。");
      await persist();
    };
    return () => { saveBeforeExit.current = null; };
  });

  function requestClose() { void act(async () => { await persist(); close(); }); }

  function update(definition: WorkflowDefinition, values = draft.bindings) {
    setDraft({ ...draft, definition, bindings: workflowBindings(definition, values) });
    setDirty(true);
  }

  function fresh() {
    setDraft({ revision: draft.revision, definition: emptyDefinition, bindings: {} });
    setDirty(true);
    setOpenStep("");
    setShowAgent(false);
    setTab("draft");
  }

  function addStep() {
    let definition = draft.definition;
    const id = identifier();
    const previous = definition.steps[definition.steps.length - 1];
    if (definition.inputs.length >= 24 && stepKind !== "generate" && !previous && !definition.inputs.some(item => item.type === "image")) {
      setError("请先移除一个输入，再添加图片输入。");
      return;
    }
    let input = definition.inputs.find(item => item.type === "image");
    let values = draft.bindings;
    if (stepKind !== "generate" && !previous && !input) {
      input = { id: identifier(), type: "image", label: "原图" };
      definition = { ...definition, inputs: [...definition.inputs, input] };
      if (selectedMaterial) values = { ...values, [input.id]: selectedMaterial };
    }
    const source = stepKind === "generate" ? null : previous ? { type: "step" as const, id: previous.id } : input ? { type: "input" as const, id: input.id } : null;
    update({ ...definition, steps: [...definition.steps, { id, kind: stepKind, prompt: "", source }] }, values);
    setOpenStep(id);
  }

  function changeStep(id: string, changes: Partial<WorkflowStep>) {
    update({ ...draft.definition, steps: draft.definition.steps.map(step => step.id === id ? { ...step, ...changes } : step) });
  }

  function moveStep(id: string, to: number) {
    const steps = [...draft.definition.steps];
    const from = steps.findIndex(step => step.id === id);
    if (from < 0 || from === to || to < 0 || to >= steps.length) return;
    const [step] = steps.splice(from, 1);
    steps.splice(to, 0, step);
    update({ ...draft.definition, steps });
  }

  async function suggest() {
    const saved = await persist();
    const reply = await sequentialWorkflow(projectId, "suggest", { description, expectedRevision: saved.revision, confirm: true });
    const next = accept(reply);
    if (selectedMaterial) {
      const input = next.definition.inputs.find(item => item.type === "image" && !next.bindings[item.id]);
      if (input) {
        setDraft({ ...next, bindings: { ...next.bindings, [input.id]: selectedMaterial } });
        setDirty(true);
      }
    }
    setOpenStep(next.definition.steps[0]?.id || "");
    setShowAgent(false);
  }

  return <aside className="sequential-workflow" aria-label="工作流编辑器" onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); requestClose(); }
  }}>
    <header className="sequential-workflow-header">
      <h2>工作流</h2>
      <IconActionButton icon={<X size={16} />} label="关闭工作流" onClick={requestClose} disabled={busy} />
    </header>
    <nav className="sequential-workflow-tabs" aria-label="工作流导航">
      <ButtonBase aria-pressed={tab === "draft"} disabled={busy} onClick={() => setTab("draft")}>草稿</ButtonBase>
      <ButtonBase aria-pressed={tab === "library"} disabled={busy} onClick={() => void act(async () => { await persist(); setEntries((await sequentialWorkflow(projectId, "library")).entries || []); setTab("library"); })}>我的工作流</ButtonBase>
      <ButtonBase aria-pressed={tab === "runs"} disabled={busy} onClick={() => setTab("runs")}>运行记录</ButtonBase>
    </nav>
    <div className="sequential-workflow-body" aria-busy={busy}>
      {error ? <p role="alert" className="workflow-error">{error}</p> : null}
      {tab === "draft" ? <fieldset disabled={busy}>
        <div className="workflow-row">
          <ButtonBase onClick={() => void act(async () => { await persist(); fresh(); })}>{draft.definition.steps.length ? "新建工作流" : "从空白开始"}</ButtonBase>
          <ButtonBase onClick={() => setShowAgent(!showAgent)} aria-expanded={showAgent}>{draft.definition.steps.length ? "让 Agent 修改" : "描述你想做什么"}</ButtonBase>
        </div>
        {showAgent ? <div className="workflow-group">
          <label>告诉 Agent 要创建或修改什么<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={8000} /></label>
          <ButtonBase disabled={!description.trim()} onClick={() => void act(suggest)}>让 Agent 起草</ButtonBase>
        </div> : null}
        <label>名称<input value={draft.definition.title} onChange={event => update({ ...draft.definition, title: event.target.value })} maxLength={120} /></label>
        <div className="workflow-group">
          <h3>输入</h3>
          {draft.definition.inputs.map(input => <div key={input.id} className="workflow-input">
            <label>{input.label}{input.type === "image" ? <select value={(draft.bindings[input.id] as WorkflowAssetIdentity | null)?.occurrenceId || ""}
              onChange={event => update(draft.definition, { ...draft.bindings, [input.id]: materials.find(material => material.occurrenceId === event.target.value) || null })}>
              <option value="">选择项目图片</option>
              {!activeBindings[input.id] && workflowAssetIdentity(draft.bindings[input.id]) ? <option value={workflowAssetIdentity(draft.bindings[input.id])?.occurrenceId} disabled>原图片已不可用</option> : null}
              {materials.map(material => <option key={material.occurrenceId} value={material.occurrenceId}>{material.label}</option>)}
            </select> : <input value={String(draft.bindings[input.id] ?? "")} onChange={event => update(draft.definition, { ...draft.bindings, [input.id]: event.target.value })} maxLength={2000} />}</label>
            {input.type === "text" ? <label>默认值<input value={input.defaultValue} onChange={event => update({ ...draft.definition, inputs: draft.definition.inputs.map(item => item.id === input.id ? { ...input, defaultValue: event.target.value } : item) })} /></label> : null}
            <IconActionButton icon={<Trash2 size={15} />} label={`移除${input.label}`} onClick={() => update({ ...draft.definition, inputs: draft.definition.inputs.filter(item => item.id !== input.id) })} />
          </div>)}
          <div className="workflow-row">
            <ButtonBase disabled={draft.definition.inputs.length >= 24} onClick={() => update({ ...draft.definition, inputs: [...draft.definition.inputs, { id: identifier(), type: "image", label: `图片 ${draft.definition.inputs.length + 1}` }] })}>添加图片输入</ButtonBase>
            <ButtonBase disabled={draft.definition.inputs.length >= 24} onClick={() => {
              let index = draft.definition.inputs.length + 1;
              while (draft.definition.inputs.some(item => item.id === `text${index}`)) index++;
              update({ ...draft.definition, inputs: [...draft.definition.inputs, { id: `text${index}`, type: "text", label: `文字 ${index} · {{text${index}}}`, defaultValue: "", required: false }] });
            }}>添加文字参数</ButtonBase>
          </div>
        </div>
        <div className="workflow-group">
          <h3>步骤</h3>
          <ol className="workflow-steps">
            {draft.definition.steps.map((step, index) => <li key={step.id} onDragOver={event => { if (draggedStep) event.preventDefault(); }} onDrop={event => {
              event.preventDefault(); moveStep(draggedStep, index); setDraggedStep("");
            }}>
              <div className="workflow-step-header">
                <span title="拖动调整顺序" draggable onDragStart={event => { setDraggedStep(step.id); event.dataTransfer.setData("text/plain", step.id); }} onDragEnd={() => setDraggedStep("")}><GripVertical size={15} /></span>
                <ButtonBase aria-expanded={openStep === step.id} onClick={() => setOpenStep(openStep === step.id ? "" : step.id)} onKeyDown={event => {
                  if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveStep(step.id, index + (event.key === "ArrowUp" ? -1 : 1)); }
                }}>{index + 1}. {workflowStepNames[step.kind]}</ButtonBase>
                <IconActionButton icon={<ArrowUp size={15} />} label={`上移步骤 ${index + 1}`} onClick={() => moveStep(step.id, index - 1)} disabled={index === 0} />
                <IconActionButton icon={<ArrowDown size={15} />} label={`下移步骤 ${index + 1}`} onClick={() => moveStep(step.id, index + 1)} disabled={index === draft.definition.steps.length - 1} />
                <IconActionButton icon={<Trash2 size={15} />} label={`删除步骤 ${index + 1}`} onClick={() => update({ ...draft.definition, steps: draft.definition.steps.filter(item => item.id !== step.id) })} />
              </div>
              {openStep === step.id ? <div className="workflow-step-fields">
                {step.kind !== "generate" ? <label>来源<select value={step.source ? `${step.source.type}:${step.source.id}` : ""} onChange={event => {
                  const [type, id] = event.target.value.split(":");
                  changeStep(step.id, { source: type === "input" || type === "step" ? { type, id } : null });
                }}>
                  <option value="">选择图片来源</option>
                  {step.source && (step.source.type === "step" ? !draft.definition.steps.slice(0, index).some(item => item.id === step.source?.id) : !draft.definition.inputs.some(item => item.type === "image" && item.id === step.source?.id))
                    ? <option value={`${step.source.type}:${step.source.id}`} disabled>原来源不可用</option> : null}
                  {draft.definition.inputs.filter(input => input.type === "image").map(input => <option key={input.id} value={`input:${input.id}`}>{input.label}</option>)}
                  {draft.definition.steps.slice(0, index).map((prior, position) => <option key={prior.id} value={`step:${prior.id}`}>步骤 {position + 1} 的结果</option>)}
                </select></label> : null}
                <label>{step.kind === "background" ? "背景描述" : step.kind === "cutout" ? "主体说明（可选）" : "图片描述"}<textarea rows={2} maxLength={24000} value={step.prompt} onChange={event => changeStep(step.id, { prompt: event.target.value })} /></label>
              </div> : null}
              {issues.filter(issue => issue.stepId === step.id).map(issue => <p className="workflow-error" key={issue.message}>{issue.message}</p>)}
            </li>)}
          </ol>
          <div className="workflow-row">
            <select aria-label="步骤类型" value={stepKind} onChange={event => setStepKind(event.target.value as WorkflowStepKind)}>
              {Object.entries(workflowStepNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
            </select>
            <ButtonBase onClick={addStep} disabled={draft.definition.steps.length >= 24}>添加步骤</ButtonBase>
          </div>
        </div>
        <div className="workflow-group"><h3>输出</h3><p>每步保存一张图片，最终成果显示在项目画布。</p></div>
      </fieldset> : null}
      {tab === "library" ? <div className="workflow-group">
        {entries.length ? entries.map(entry => <ButtonBase key={entry.id} disabled={busy} onClick={() => void act(async () => {
          accept(await sequentialWorkflow(projectId, "open", { libraryId: entry.id, expectedRevision: draft.revision }));
          setOpenStep(""); setTab("draft");
        })}>{entry.definition.title} · {entry.definition.steps.length} 步</ButtonBase>) : <p>保存的工作流会显示在此处。</p>}
        <ButtonBase disabled={busy} onClick={() => void act(async () => { await persist(); openLegacy(); })}>旧需求模板</ButtonBase>
      </div> : null}
      {tab === "runs" ? <div className="workflow-group">
        {!state.runs.length ? <p>暂无运行记录。</p> : null}
        {state.runs.map((run, index) => <details key={run.id} open={index === 0 || undefined}>
          <summary>{run.definition.title} · {runLabels[run.state] || run.state}</summary>
          <p>{new Date(run.startedAt).toLocaleString()} · 草稿版本 {run.draftRevision}</p>
          {run.definition.inputs.length ? <dl>{run.definition.inputs.map(input => {
            const value = run.bindings[input.id];
            const asset = workflowAssetIdentity(value);
            return <div key={input.id}><dt>{input.label}</dt><dd>{asset ? availableMaterials.get(asset.occurrenceId)?.label || asset.assetId : typeof value === "string" ? value || "空" : "未绑定"}</dd></div>;
          })}</dl> : null}
          <ol>{run.steps.map((step, position) => {
            const definition = run.definition.steps[position];
            return <li key={step.id}>{workflowStepNames[definition.kind]} · {runLabels[step.state] || step.state}
              <p>{workflowStepPrompt(definition, run.bindings)}</p>
              {step.error ? <p className="workflow-error">{step.error}</p> : null}
            </li>;
          })}</ol>
          {["failed", "uncertain", "interrupted"].includes(run.state) ? <ButtonBase disabled={busy || state.running} onClick={() => void act(async () => {
            await sequentialWorkflow(projectId, "resume", { runId: run.id, confirm: true });
          })}>{run.state === "uncertain" ? "查询原结果" : "继续运行"}</ButtonBase> : null}
        </details>)}
      </div> : null}
    </div>
    {tab === "draft" ? <footer className="sequential-workflow-footer">
      <ButtonBase disabled={busy || !dirty} onClick={() => void act(async () => { await persist(); })}>保存草稿</ButtonBase>
      <ButtonBase disabled={busy || workflowIssues(draft.definition).length > 0} onClick={() => void act(async () => {
        const saved = await persist(); accept(await sequentialWorkflow(projectId, "save", { expectedRevision: saved.revision }));
      })}>保存到我的工作流</ButtonBase>
      <ButtonBase className="workflow-primary" disabled={busy || state.running || issues.length > 0} onClick={() => void act(async () => {
        const saved = await persist(); await ensureSaved();
        await sequentialWorkflow(projectId, "start", { expectedRevision: saved.revision, runId: `wf-${crypto.randomUUID()}`, conversationId, confirm: true });
        setTab("runs");
      })}>运行</ButtonBase>
    </footer> : null}
  </aside>;
}
