import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  Database,
  Download,
  FileCode2,
  FlaskConical,
  Grid2X2,
  Import,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";

import type {
  ScientificDataSource,
  ScientificFigurePanel,
  ScientificFigurePlan,
  ScientificFigureOutputFormat,
  ScientificTask
} from "./core";
import {
  SCIENTIFIC_FIGURE_BACKENDS,
  SCIENTIFIC_FIGURE_CHART_TYPES,
  SCIENTIFIC_FIGURE_OUTPUT_FORMATS,
  SCIENTIFIC_FIGURE_STYLE_PRESETS,
  SCIENTIFIC_FIGURE_TYPES,
  normalizeScientificFigurePlan,
  scientificFigurePlanIssues
} from "./plugins/scientific-figure";
import {
  ActionButton,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog
} from "./ui";
import "./styles/04h-scientific-figure-dialog.css";

export type ScientificSavedPlan = {
  plan: ScientificFigurePlan;
  requirementNodeId: string;
  requirementRevision: number;
};

export type ScientificFigureDialogProps = {
  projectId: string;
  initialPlan?: ScientificFigurePlan;
  initialTaskId?: string;
  initialAction?: "plan" | "import" | "render" | "export";
  firstUse?: boolean;
  errorMessage?: string;
  close: () => void;
  savePlan: (plan: ScientificFigurePlan) => Promise<ScientificSavedPlan>;
  submitAgentPlan: (saved: ScientificSavedPlan) => Promise<void>;
  onRendered: (task: ScientificTask, saved: ScientificSavedPlan) => void;
};

const quantitativeTypes = new Set<ScientificFigurePlan["figureType"]>(["statistical-chart", "multi-panel"]);

function taskStateLabel(state: ScientificTask["state"]) {
  if (state === "ready") return "已完成";
  if (state === "running") return "执行中";
  if (state === "prepared") return "准备中";
  if (state === "cancelled") return "已取消";
  if (state === "interrupted") return "已中断";
  return "失败";
}

function nextPanel(plan: ScientificFigurePlan): ScientificFigurePanel {
  const index = plan.panels.length;
  const source = plan.dataSources[0];
  return {
    id: `panel-${index + 1}`,
    label: String.fromCharCode(65 + Math.min(index, 25)),
    title: `Panel ${String.fromCharCode(65 + Math.min(index, 25))}`,
    chartType: "scatter",
    sourceBindings: source ? [source.id] : [],
    description: "",
    xField: source?.fields[0] || "",
    yFields: source?.fields[1] ? [source.fields[1]] : [],
    groupField: "",
    status: "planned"
  };
}

function panelSource(panel: ScientificFigurePanel, sources: ScientificDataSource[]) {
  return sources.find((source) => panel.sourceBindings.includes(source.id));
}

export default function ScientificFigureDialog({
  projectId,
  initialPlan,
  initialTaskId,
  initialAction = "plan",
  firstUse = false,
  errorMessage = "",
  close,
  savePlan,
  submitAgentPlan,
  onRendered
}: ScientificFigureDialogProps) {
  const normalizedInitialPlan = useMemo(() => normalizeScientificFigurePlan(initialPlan || {}), [initialPlan]);
  const [plan, setPlan] = useState(() => normalizedInitialPlan);
  const [savedPlanSignature, setSavedPlanSignature] = useState(() => JSON.stringify(normalizedInitialPlan));
  const [dataSources, setDataSources] = useState<ScientificDataSource[]>([]);
  const [tasks, setTasks] = useState<ScientificTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState(initialTaskId || "");
  const [busy, setBusy] = useState<"load" | "import" | "save" | "render" | "export" | "cancel" | "">("load");
  const [notice, setNotice] = useState(errorMessage);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const initialActionHandled = useRef(false);
  const isQuantitative = quantitativeTypes.has(plan.figureType);
  const selectedTask = tasks.find((task) => task.taskId === activeTaskId) || tasks[0];
  const dirty = JSON.stringify(normalizeScientificFigurePlan(plan)) !== savedPlanSignature;

  const refresh = async () => {
    const bridge = window.naimageScientific;
    if (!bridge) throw new Error("当前桌面运行时尚未加载科研绘图服务，请重启 SparkAI WorkSpace 后重试。");
    const [dataResult, taskResult] = await Promise.all([
      bridge.listData({ expectedProjectId: projectId }),
      bridge.list({ expectedProjectId: projectId })
    ]);
    if (!dataResult.ok) throw new Error(dataResult.error || "科研数据读取失败。");
    if (!taskResult.ok) throw new Error(taskResult.error || "科研任务读取失败。");
    const sources = dataResult.dataSources || [];
    setDataSources(sources);
    setTasks(taskResult.tasks || []);
    if (!activeTaskId && taskResult.tasks?.[0]) setActiveTaskId(taskResult.tasks[0].taskId);
    setPlan((current) => normalizeScientificFigurePlan({
      ...current,
      dataSources: current.dataSources.filter((source) => sources.some((item) => item.id === source.id && item.contentHash === source.contentHash))
    }));
  };

  const importData = async () => {
    const bridge = window.naimageScientific;
    if (!bridge) throw new Error("科研数据导入服务当前不可用。");
    setBusy("import");
    setNotice("");
    try {
      const result = await bridge.importData({ expectedProjectId: projectId });
      if (result.canceled) return;
      if (!result.ok || !result.dataSource) throw new Error(result.error || "科研数据导入失败。");
      await refresh();
      setPlan((current) => {
        const sources = [...current.dataSources.filter((item) => item.id !== result.dataSource!.id), result.dataSource!];
        const panels = current.panels.map((panel, index) => index || panel.sourceBindings.length ? panel : {
          ...panel,
          sourceBindings: [result.dataSource!.id],
          xField: result.dataSource!.fields[0] || "",
          yFields: result.dataSource!.fields[1] ? [result.dataSource!.fields[1]] : []
        });
        return normalizeScientificFigurePlan({ ...current, dataSources: sources, panels });
      });
      setNotice(`已导入 ${result.dataSource.sourceName}：${result.dataSource.rowCount.toLocaleString()} 行 × ${result.dataSource.columnCount} 列。`);
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setBusy(""); });
    const dispose = window.naimageScientific?.onChanged((task) => {
      if (task.projectId !== projectId) return;
      setTasks((current) => [task, ...current.filter((item) => item.taskId !== task.taskId)]);
      setActiveTaskId(task.taskId);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  // The dialog is keyed by project; refreshing on local draft changes would discard edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (busy || initialActionHandled.current) return;
    initialActionHandled.current = true;
    if (initialAction === "import") void importData().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, initialAction]);

  const visibleIssues = useMemo(() => scientificFigurePlanIssues(plan, { forRender: isQuantitative }), [isQuantitative, plan]);

  const patchPanel = (panelId: string, patch: Partial<ScientificFigurePanel>) => {
    setPlan((current) => normalizeScientificFigurePlan({
      ...current,
      panels: current.panels.map((panel) => panel.id === panelId ? { ...panel, ...patch, status: "planned" } : panel)
    }));
  };

  const toggleDataSource = (source: ScientificDataSource) => {
    setPlan((current) => {
      const selected = current.dataSources.some((item) => item.id === source.id);
      const dataSources = selected ? current.dataSources.filter((item) => item.id !== source.id) : [...current.dataSources, source];
      const panels = current.panels.map((panel) => selected && panel.sourceBindings.includes(source.id)
        ? { ...panel, sourceBindings: [], xField: "", yFields: [], groupField: "" }
        : panel);
      return normalizeScientificFigurePlan({ ...current, dataSources, panels });
    });
  };

  const persist = async (execute: boolean, closeAfterSave = false): Promise<boolean> => {
    setBusy(execute ? "render" : "save");
    setNotice("");
    try {
      const canonical = normalizeScientificFigurePlan(plan);
      const planIssues = scientificFigurePlanIssues(canonical, { forRender: execute && isQuantitative });
      if (planIssues.length) throw new Error(planIssues.join("；"));
      const saved = await savePlan(canonical);
      setPlan(saved.plan);
      setSavedPlanSignature(JSON.stringify(normalizeScientificFigurePlan(saved.plan)));
      if (!execute) {
        setNotice("科研绘图计划已保存为画布 Requirement，可稍后继续完善或执行。");
        if (closeAfterSave) close();
        return true;
      }
      if (!isQuantitative) {
        await submitAgentPlan(saved);
        close();
        return true;
      }
      const result = await window.naimageScientific?.render({
        expectedProjectId: projectId,
        requirementNodeId: saved.requirementNodeId,
        expectedRequirementRevision: saved.requirementRevision,
        plan: saved.plan
      });
      if (!result?.ok || !result.task) throw new Error(result?.error || "科研图执行失败。");
      onRendered(result.task, saved);
      setTasks((current) => [result.task!, ...current.filter((item) => item.taskId !== result.task!.taskId)]);
      setActiveTaskId(result.task.taskId);
      setPlan(result.task.plan);
      setSavedPlanSignature(JSON.stringify(normalizeScientificFigurePlan(result.task.plan)));
      setNotice("论文图与 Panel 预览已生成，并放入当前画布。");
      return true;
    } finally {
      setBusy("");
    }
  };

  const exportSelected = async () => {
    if (!selectedTask) throw new Error("当前没有可导出的科研任务。");
    setBusy("export");
    setNotice("");
    try {
      const result = await window.naimageScientific?.export({ expectedProjectId: projectId, taskId: selectedTask.taskId, confirmed: true });
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || "论文图导出失败。");
      setNotice(`已导出 ${result.fileCount || 0} 个文件到 ${result.folderName || "论文图目录"}。`);
    } finally {
      setBusy("");
    }
  };

  const cancelSelected = async () => {
    if (!selectedTask || !["prepared", "running"].includes(selectedTask.state)) return;
    setBusy("cancel");
    try {
      const result = await window.naimageScientific?.cancel({ expectedProjectId: projectId, taskId: selectedTask.taskId });
      if (!result?.ok || !result.task) throw new Error(result?.error || "任务取消失败。");
      setTasks((current) => [result.task!, ...current.filter((item) => item.taskId !== result.task!.taskId)]);
    } finally {
      setBusy("");
    }
  };

  const guarded = (operation: () => Promise<unknown>) => void operation().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));

  const requestDialogClose = () => {
    if (busy) return;
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  };

  return (
    <>
      <DialogShell
        surface="scientific-figure"
        ariaLabel="科研绘图工作台"
        className="scientific-figure-dialog"
        busy={Boolean(busy)}
        dirty={dirty}
        closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle", action: "when-idle" }}
        onRequestClose={requestDialogClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader
            title="科研绘图工作台"
            description="结构化计划、受控 Python/R 执行、Panel 预览与投稿资产一次完成。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="scientific-figure-body">
            <section className="scientific-hero" aria-label="科研工作流说明">
              <span className="scientific-hero-icon"><FlaskConical size={19} /></span>
              <div>
                <strong>先讲清结论，再选择证据和图形</strong>
                <p>SparkAI WorkSpace 不推断显著性、样本量或实验结论；真实数据、脚本哈希和导出资产都会保留。</p>
              </div>
              <span className="scientific-safe-badge"><ShieldCheck size={14} /> 受控执行</span>
            </section>

            {firstUse ? (
              <section className="scientific-onboarding" aria-label="首次使用提示">
                <span><i>1</i>导入数据</span><span><i>2</i>确认结论与 Panel</span><span><i>3</i>选择 Python/R 后生成</span>
              </section>
            ) : null}

            <div className="scientific-workspace-grid">
              <main className="scientific-plan-column">
                <section className="scientific-glass-section">
                  <header><span><Sparkles size={15} /> 图件目标</span><small>同一个任务只使用一种后端</small></header>
                  <div className="scientific-type-grid">
                    {SCIENTIFIC_FIGURE_TYPES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={plan.figureType === item.id ? "active" : ""}
                        aria-pressed={plan.figureType === item.id}
                        onClick={() => setPlan((current) => normalizeScientificFigurePlan({
                          ...current,
                          figureType: item.id,
                          archetype: item.id === "multi-panel" ? "quantitative-grid" : current.archetype
                        }))}
                      >
                        {item.id === "multi-panel" ? <Grid2X2 size={15} /> : item.id === "statistical-chart" ? <BarChart3 size={15} /> : <Sparkles size={15} />}
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                  <Field label="这张图需要支撑的核心结论" hint="只写已由数据或事实支持的结论；不确定处请明确标注。">
                    <textarea
                      value={plan.researchClaim}
                      rows={3}
                      placeholder="例如：处理组在三个独立重复中均表现出更高的迁移能力……"
                      onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, researchClaim: event.target.value }))}
                    />
                  </Field>
                  <div className="scientific-inline-fields">
                    <Field label="绘图后端">
                      <div className="scientific-backend-switch">
                        {SCIENTIFIC_FIGURE_BACKENDS.map((item) => (
                          <button key={item.id} type="button" className={plan.backend === item.id ? "active" : ""} onClick={() => setPlan((current) => normalizeScientificFigurePlan({ ...current, backend: item.id }))}>
                            <FileCode2 size={14} /><span>{item.label}</span><small>{item.description}</small>
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="视觉规范">
                      <select value={plan.stylePreset} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, stylePreset: event.target.value }))}>
                        {SCIENTIFIC_FIGURE_STYLE_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </Field>
                  </div>
                </section>

                {isQuantitative ? (
                  <section className="scientific-glass-section">
                    <header>
                      <span><Database size={15} /> 受管数据</span>
                      <ActionButton variant="secondary" icon={<Import size={14} />} disabled={Boolean(busy)} onClick={() => guarded(importData)}>导入 CSV / TSV</ActionButton>
                    </header>
                    {dataSources.length ? (
                      <div className="scientific-data-grid">
                        {dataSources.map((source) => {
                          const selected = plan.dataSources.some((item) => item.id === source.id);
                          return (
                            <button key={source.id} type="button" className={selected ? "active" : ""} aria-pressed={selected} onClick={() => toggleDataSource(source)}>
                              <span className="scientific-data-check">{selected ? <Check size={12} /> : null}</span>
                              <strong>{source.sourceName}</strong>
                              <small>{source.rowCount.toLocaleString()} 行 · {source.columnCount} 列 · {Math.max(1, Math.round(source.size / 1024))} KB</small>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <button type="button" className="scientific-data-empty" onClick={() => guarded(importData)}>
                        <Import size={18} /><strong>导入第一份数据</strong><small>数据只复制到当前项目；界面仅保留字段和摘要。</small>
                      </button>
                    )}
                  </section>
                ) : (
                  <InlineNotice tone="info" title="此类图件将交给画布 Agent">
                    计划仍保存为 Requirement；Agent 只使用你提供的事实和素材，不会把占位内容当作科研结果。
                  </InlineNotice>
                )}

                {isQuantitative ? (
                  <section className="scientific-glass-section scientific-panel-section">
                    <header>
                      <span><Grid2X2 size={15} /> Panel 规划</span>
                      <ActionButton variant="secondary" icon={<Plus size={14} />} disabled={plan.panels.length >= 12} onClick={() => setPlan((current) => normalizeScientificFigurePlan({ ...current, panels: [...current.panels, nextPanel(current)] }))}>增加 Panel</ActionButton>
                    </header>
                    <div className="scientific-panel-list">
                      {plan.panels.map((panel, index) => {
                        const source = panelSource(panel, plan.dataSources);
                        const fields = source?.fields || [];
                        return (
                          <article className="scientific-panel-card" key={panel.id}>
                            <header>
                              <span className="scientific-panel-label">{panel.label || String.fromCharCode(65 + index)}</span>
                              <input aria-label={`Panel ${index + 1} 标题`} value={panel.title || ""} onChange={(event) => patchPanel(panel.id, { title: event.target.value })} />
                              <button type="button" aria-label={`删除 Panel ${index + 1}`} disabled={plan.panels.length <= 1} onClick={() => setPlan((current) => normalizeScientificFigurePlan({ ...current, panels: current.panels.filter((item) => item.id !== panel.id) }))}><Trash2 size={14} /></button>
                            </header>
                            <div className="scientific-panel-fields">
                              <label><span>图表</span><select value={panel.chartType} onChange={(event) => patchPanel(panel.id, { chartType: event.target.value as ScientificFigurePanel["chartType"] })}>{SCIENTIFIC_FIGURE_CHART_TYPES.filter((item) => !["image", "schematic"].includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                              <label><span>数据</span><select value={source?.id || ""} onChange={(event) => {
                                const selected = plan.dataSources.find((item) => item.id === event.target.value);
                                patchPanel(panel.id, { sourceBindings: selected ? [selected.id] : [], xField: selected?.fields[0] || "", yFields: selected?.fields[1] ? [selected.fields[1]] : [], groupField: "" });
                              }}><option value="">请选择</option>{plan.dataSources.map((item) => <option key={item.id} value={item.id}>{item.sourceName}</option>)}</select></label>
                              <label><span>{panel.chartType === "histogram" ? "数值字段" : "X 字段"}</span><select value={panel.xField} onChange={(event) => patchPanel(panel.id, { xField: event.target.value })}><option value="">请选择</option>{fields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
                              <label className="scientific-y-field"><span>{panel.chartType === "heatmap" ? "热图字段（可多选）" : "Y 字段（可多选）"}</span><select multiple size={Math.min(4, Math.max(2, fields.length))} value={panel.yFields} onChange={(event) => patchPanel(panel.id, { yFields: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>{fields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
                              <label><span>分组（可选）</span><select value={panel.groupField} onChange={(event) => patchPanel(panel.id, { groupField: event.target.value })}><option value="">不分组</option>{fields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="scientific-glass-section scientific-output-section">
                  <header><span><Download size={15} /> 论文图输出</span><small>画布始终使用清晰 PNG 预览</small></header>
                  <div className="scientific-output-row">
                    <div className="scientific-format-picker">
                      {SCIENTIFIC_FIGURE_OUTPUT_FORMATS.map((format) => {
                        const formatId = format as ScientificFigureOutputFormat;
                        const selected = plan.outputFormats.includes(formatId);
                        return <button key={format} type="button" className={selected ? "active" : ""} onClick={() => setPlan((current) => normalizeScientificFigurePlan({ ...current, outputFormats: selected ? current.outputFormats.filter((item) => item !== formatId) : [...current.outputFormats, formatId] }))}>{selected ? <Check size={12} /> : null}{format.toUpperCase()}</button>;
                      })}
                    </div>
                    <label><span>宽 mm</span><input type="number" min={40} max={500} value={plan.dimensions.widthMm} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, dimensions: { ...current.dimensions, widthMm: Number(event.target.value) } }))} /></label>
                    <label><span>高 mm</span><input type="number" min={40} max={500} value={plan.dimensions.heightMm} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, dimensions: { ...current.dimensions, heightMm: Number(event.target.value) } }))} /></label>
                    <label><span>DPI</span><input type="number" min={150} max={1200} step={50} value={plan.dimensions.dpi} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, dimensions: { ...current.dimensions, dpi: Number(event.target.value) } }))} /></label>
                  </div>
                  <details className="scientific-review-details">
                    <summary>补充统计、source-data 与审稿风险</summary>
                    <div>
                      <Field label="统计说明"><textarea rows={2} value={plan.statisticsNotes} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, statisticsNotes: event.target.value }))} /></Field>
                      <Field label="Source data 说明"><textarea rows={2} value={plan.sourceDataNotes} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, sourceDataNotes: event.target.value }))} /></Field>
                      <Field label="图像完整性说明"><textarea rows={2} value={plan.imageIntegrityNotes} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, imageIntegrityNotes: event.target.value }))} /></Field>
                      <Field label="审稿风险（每行一项）"><textarea rows={2} value={plan.reviewerRisks.join("\n")} onChange={(event) => setPlan((current) => normalizeScientificFigurePlan({ ...current, reviewerRisks: event.target.value.split(/\r?\n/) }))} /></Field>
                    </div>
                  </details>
                </section>
              </main>

              <aside className="scientific-status-column">
                <section className="scientific-glass-section scientific-checklist">
                  <header><span><ShieldCheck size={15} /> 执行检查</span></header>
                  {visibleIssues.length ? <ul>{visibleIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="scientific-ready"><Check size={15} />计划可以执行</p>}
                  <p>不会联网安装依赖，不读取 API Key，也不会在重启后自动重复执行。</p>
                </section>
                <section className="scientific-glass-section scientific-task-history">
                  <header><span><RefreshCw size={15} /> 最近任务</span><button type="button" aria-label="刷新任务" disabled={Boolean(busy)} onClick={() => guarded(refresh)}><RefreshCw size={13} /></button></header>
                  {tasks.length ? tasks.slice(0, 8).map((task) => (
                    <button key={task.taskId} type="button" className={selectedTask?.taskId === task.taskId ? "active" : ""} onClick={() => setActiveTaskId(task.taskId)}>
                      <span className={`scientific-task-state is-${task.state}`}>{taskStateLabel(task.state)}</span>
                      <strong>{task.plan.researchClaim || "科研图任务"}</strong>
                      <small>{task.backend.toUpperCase()} · {task.outputs.filter((output) => output.kind === "figure" || output.kind === "panel").length} 个图件资产</small>
                    </button>
                  )) : <p className="scientific-empty-history">完成第一次绘图后，任务状态和导出入口会显示在这里。</p>}
                  {selectedTask?.error ? <InlineNotice tone="danger" title="执行信息">{selectedTask.error}</InlineNotice> : null}
                  <div className="scientific-task-actions">
                    <ActionButton variant="secondary" icon={<Download size={14} />} disabled={!selectedTask || selectedTask.state !== "ready" || Boolean(busy)} onClick={() => guarded(exportSelected)}>导出选中任务</ActionButton>
                    {["prepared", "running"].includes(selectedTask?.state || "") ? <ActionButton variant="danger" disabled={Boolean(busy)} onClick={() => guarded(cancelSelected)}>取消任务</ActionButton> : null}
                  </div>
                </section>
              </aside>
            </div>

            {notice ? <InlineNotice tone={notice.includes("失败") || notice.includes("缺少") || notice.includes("不可") ? "danger" : "info"} title="科研工作台">{notice}</InlineNotice> : null}
          </SurfaceBody>
          <SurfaceFooter className="scientific-figure-footer">
            <ActionButton variant="secondary" onClick={() => requestClose("action")} disabled={Boolean(busy)}>关闭</ActionButton>
            <span className="scientific-footer-spacer" />
            <ActionButton variant="secondary" disabled={Boolean(busy)} onClick={() => guarded(() => persist(false))}>{busy === "save" ? <Loader2 className="spin" size={15} /> : null}保存计划</ActionButton>
            <ActionButton variant="primary" icon={busy === "render" ? <Loader2 className="spin" size={15} /> : isQuantitative ? <BarChart3 size={15} /> : <Sparkles size={15} />} disabled={Boolean(busy) || visibleIssues.length > 0} onClick={() => guarded(() => persist(true))}>
              {isQuantitative ? "生成论文图" : "交给 Agent 生成"}
            </ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="scientific-figure-unsaved"
          ariaLabel="保存科研绘图计划"
          title="关闭前要保存科研绘图计划吗？"
          description="图件目标、数据或 Panel 规划还有未保存修改。"
          detail={<p>保存会把计划写入当前画布的 Requirement，但不会运行 Python/R、调用模型或产生费用。</p>}
          busy={Boolean(busy)}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={close}
          onSave={() => {
            void persist(false, true).catch((error) => {
              setNotice(error instanceof Error ? error.message : String(error));
              setClosePromptOpen(false);
            });
          }}
        />
      ) : null}
    </>
  );
}
