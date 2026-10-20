import { useMemo, useRef, useState } from "react";
import { ButtonBase } from "./ui/primitives";
import type { ProjectContextPanelProps, ProjectContextSnapshot, ProjectKnowledgeItem, ProjectResultItem } from "./project-context";
import type { CreationTarget } from "./creation-session";
import type { KnowledgeDraft, ResultSearchDraft } from "../runtime/project-context-presentation.mjs";
import { contextTargetKey, emptyKnowledgeDraft, emptyResultSearchDraft, knowledgeDraftFor, knowledgeInputFromDraft,
  knowledgeScopeLabel, knowledgeScopeOptions, knowledgeStatusLabel, knowledgeTypeLabel, resultAdoptionLabel,
  resultObservationLabel, resultReasonText, resultSearchInput } from "./project-context";

type Editor = { draft: KnowledgeDraft; revision: number; entry?: ProjectKnowledgeItem };
const typeOptions = ["brand_rule", "product_fact", "prohibited_expression", "style_reference", "preference"] as const;
const scopeKey = (scope: KnowledgeDraft["scope"]) => JSON.stringify(scope);

function ProjectContextPanelBody({ projectContext: context, contextBusy: busy, contextError, onContextCommand, onLocateResult, onUseResults, onCompareResults }: ProjectContextPanelProps & { projectContext: ProjectContextSnapshot }) {
  const [editor, setEditor] = useState<Editor | null>(null), [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<ResultSearchDraft>(emptyResultSearchDraft);
  const [applied, setApplied] = useState<ResultSearchDraft>(emptyResultSearchDraft);
  const [selected, setSelected] = useState<Map<string, ProjectResultItem>>(() => new Map());
  const [sourceName, setSourceName] = useState("");
  const [saving, setSaving] = useState(false);
  const actionPending = useRef(false);
  const working = Boolean(busy || saving), search = context.search, results = search?.results || [];
  const scopeOptions = useMemo(() => knowledgeScopeOptions(context), [context.scopeOptions, context.entries]);
  const stale = Boolean(editor && editor.revision !== context.revision);
  const chosen = [...selected.values()].map(item => results.find(current => contextTargetKey(current.target) === contextTargetKey(item.target)) || item), targets = chosen.map(item => item.target);
  const act = async (action: () => unknown | Promise<unknown>) => {
    if (working || actionPending.current) return false;
    actionPending.current = true; setNotice(""); setSaving(true);
    try { const value = await action(); if (value && typeof value === "object" && "ok" in value && value.ok === false) { setNotice("error" in value ? String(value.error) : "操作未完成。"); return false; } return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "操作未完成。"); return false; }
    finally { actionPending.current = false; setSaving(false); }
  };
  const command = (name: Parameters<NonNullable<typeof onContextCommand>>[0], args: Record<string, unknown>) => onContextCommand?.(name, { expectedProjectId: context.projectId, ...args });
  const updateDraft = (patch: Partial<KnowledgeDraft>) => setEditor(current => current ? { ...current, draft: { ...current.draft, ...patch } } : current);
  const startEdit = (entry?: ProjectKnowledgeItem) => { setNotice(""); setEditor({ revision: context.revision, ...(entry ? { entry } : {}), draft: knowledgeDraftFor(entry) }); };
  const query = async (value = draft, offset = 0) => { const ok = await act(() => command("project.results.search", resultSearchInput(value, context.projectId, offset))); if (ok) setApplied(value); };
  const scopes = scopeOptions.some(option => scopeKey(option.scope) === scopeKey(editor?.draft.scope || { type: "project" })) ? scopeOptions
    : [...scopeOptions, { scope: editor!.draft.scope, label: `${knowledgeScopeLabel(editor!.draft.scope)} · 当前范围` }];
  const sourceOptions = [...new Map<string, { target: CreationTarget; name: string }>([...(draft.source ? [[contextTargetKey(draft.source), { target: draft.source, name: sourceName || "所选来源" }] as const] : []), ...results.map(item => [contextTargetKey(item.target), item] as const)]).values()];

  return <details className="project-context" data-project-context="">
    <summary><strong>项目知识与成果检索</strong><span>{context.entries.filter(entry => entry.status === "active" && entry.usable !== false).length} 项知识生效</span></summary>
    <div className="project-context-content">
      <details className="project-context-knowledge">
        <summary>项目长期知识 · 第 {context.revision} 版</summary>
        <p className="project-context-note">仅对本项目生效。新任务采用当前版本，正在执行的任务保留原版本。</p>
        <div className="project-context-actions"><ButtonBase type="button" disabled={working || !onContextCommand} onClick={() => startEdit()}>新增知识</ButtonBase><ButtonBase type="button" disabled={working || !onContextCommand} onClick={() => void act(() => command("project.context.get", { conversationId: context.conversationId }))}>刷新</ButtonBase></div>
        {context.entries.map(entry => <article className="project-context-entry" key={entry.knowledgeId} data-knowledge-entry="">
          <strong>{entry.title}</strong><div className="project-context-badges"><span>{knowledgeTypeLabel(entry.type)}</span><span>{scopeOptions.find(option => scopeKey(option.scope) === scopeKey(entry.scope))?.label || knowledgeScopeLabel(entry.scope)}</span><span data-status={entry.status}>{knowledgeStatusLabel(entry.status)}</span><span>{entry.source === "assumption" ? "Agent 建议" : "用户确认"} · 第 {entry.revision} 版</span></div>
          <p>{entry.content}</p>
          {entry.usable === false ? <p className="project-context-note" data-status="stale">范围或基准素材已失效，本次不会采用。</p> : null}
          {entry.assetRefs.length ? <p className="project-context-note">关联 {entry.assetRefs.length} 项基准成果</p> : null}
          {entry.readOnly || entry.authority === "commerce_catalog" ? <p className="project-context-note">来自商品资料，请在商品资料中修改。</p> : <div className="project-context-actions">
            <ButtonBase type="button" disabled={working || !onContextCommand} onClick={() => startEdit(entry)}>编辑</ButtonBase>
            {entry.source === "assumption" ? <ButtonBase type="button" disabled={working || !onContextCommand || entry.usable === false} onClick={() => void act(() => command("project.knowledge.promote", { expectedRevision: context.revision, knowledgeId: entry.knowledgeId, expectedEntryRevision: entry.revision }))}>确认并长期采用</ButtonBase> : <ButtonBase type="button" disabled={working || !onContextCommand || entry.status !== "active" && entry.usable === false} onClick={() => void act(() => command("project.knowledge.status", { expectedRevision: context.revision, knowledgeId: entry.knowledgeId, expectedEntryRevision: entry.revision, status: entry.status === "active" ? "inactive" : "active" }))}>{entry.status === "active" ? "停用" : "启用"}</ButtonBase>}
            <ButtonBase type="button" disabled={working || !onContextCommand} onClick={() => void act(() => command("project.knowledge.status", { expectedRevision: context.revision, knowledgeId: entry.knowledgeId, expectedEntryRevision: entry.revision, status: "deleted" }))}>删除</ButtonBase>
          </div>}
        </article>)}
        {!context.entries.length ? <p className="project-context-note">还没有长期知识，可保存品牌规范、商品事实或创作偏好。</p> : null}
        {context.nextOffset !== undefined ? <ButtonBase type="button" disabled={working} onClick={() => void act(() => command("project.knowledge.list", { offset: context.nextOffset, limit: 100 }))}>载入更多知识</ButtonBase> : null}
        {editor ? <form className="project-context-editor" onSubmit={event => { event.preventDefault(); void (async () => { const ok = await act(() => command("project.knowledge.save", knowledgeInputFromDraft(editor.draft, { projectId: context.projectId, revision: editor.revision, entry: editor.entry }))); if (ok) setEditor(null); })(); }}>
          <strong>{editor.entry ? "编辑知识" : "新增长期知识"}</strong>
          <label className="project-context-field"><span>名称</span><input aria-label="知识名称" value={editor.draft.title} maxLength={120} disabled={working} onChange={event => updateDraft({ title: event.target.value })} /></label>
          <div className="project-context-fields"><label className="project-context-field"><span>类型</span><select value={editor.draft.type} disabled={working} onChange={event => updateDraft({ type: event.target.value as KnowledgeDraft["type"] })}>{typeOptions.map(type => <option key={type} value={type}>{knowledgeTypeLabel(type)}</option>)}</select></label>
            <label className="project-context-field"><span>适用范围</span><select value={String(scopes.findIndex(option => scopeKey(option.scope) === scopeKey(editor.draft.scope)))} disabled={working} onChange={event => updateDraft({ scope: scopes[Number(event.target.value)].scope })}>{scopes.map((option, index) => <option key={index} value={index}>{option.label}</option>)}</select></label></div>
          {context.scopeOptionsTruncated ? <p className="project-context-note">范围选项较多，当前显示前 200 项。</p> : null}
          <label className="project-context-field"><span>内容 · {editor.draft.source === "assumption" ? "保存后仍为建议，需明确确认" : "用户明确保存的长期要求"}</span><textarea aria-label="知识内容" rows={4} value={editor.draft.content} maxLength={4000} disabled={working} onChange={event => updateDraft({ content: event.target.value })} /></label>
          {editor.draft.type === "style_reference" ? <div className="project-context-reference"><p className="project-context-note">基准成果 {editor.draft.assetRefs.length} 项。先在下方检索并选择已采用成果。</p><ButtonBase type="button" disabled={working || !chosen.length || chosen.length > 8 || chosen.some(item => item.adoption.state !== "approved" || !item.adoption.current)} onClick={() => updateDraft({ assetRefs: targets })}>使用所选已采用成果作为基准</ButtonBase></div> : null}
          {stale ? <p className="project-context-note" role="status">知识已在另一窗口更新，草稿仍保留。<ButtonBase type="button" disabled={working} onClick={() => { const latest = editor.entry && context.entries.find(entry => entry.knowledgeId === editor.entry!.knowledgeId); if (editor.entry && !latest) { setNotice("这条知识已删除，请重新新增。"); return; } setEditor({ revision: context.revision, ...(latest ? { entry: latest } : {}), draft: latest ? knowledgeDraftFor(latest) : editor.draft }); }}>载入最新版本</ButtonBase></p> : null}
          <div className="project-context-actions"><ButtonBase type="submit" disabled={working || stale || !onContextCommand || !editor.draft.title.trim() || !editor.draft.content.trim()}>保存知识</ButtonBase><ButtonBase type="button" disabled={working} onClick={() => setEditor(null)}>取消编辑</ButtonBase></div>
        </form> : null}
      </details>
      {context.usedKnowledge ? <details className="project-context-used"><summary>上次保存任务实际采用 · {context.usedKnowledge.entries.length} 项知识</summary><p className="project-context-note">项目知识第 {context.usedKnowledge.revision} 版{context.usedKnowledge.revision !== context.revision ? "，当前版本已有更新。" : "。"}</p>{context.usedKnowledge.entries.map(entry => <p key={entry.knowledgeId}><strong>{entry.title} · 第 {entry.revision} 版</strong><br />{entry.content}</p>)}{context.usedKnowledge.budget.omittedEntries ? <p className="project-context-note">另有 {context.usedKnowledge.budget.omittedEntries} 项因上下文预算未采用。</p> : null}{context.usedTemplate ? <p className="project-context-note">同时使用需求模板第 {context.usedTemplate.revision} 版。</p> : null}</details> : null}
      <details className="project-context-search" data-result-search="">
        <summary>检索历史成果</summary>
        <form onSubmit={event => { event.preventDefault(); void query(); }}>
          <label className="project-context-field"><span>关键词</span><input aria-label="成果关键词" value={draft.text} maxLength={500} placeholder="名称、标签或描述" disabled={working} onChange={event => setDraft(current => ({ ...current, text: event.target.value }))} /></label>
          <div className="project-context-fields"><label className="project-context-field"><span>用途</span><input aria-label="成果用途" value={draft.usage} maxLength={240} placeholder="例如：场景图" disabled={working} onChange={event => setDraft(current => ({ ...current, usage: event.target.value }))} /></label><label className="project-context-field"><span>商品 / SKU</span><input aria-label="成果商品或SKU" value={draft.objectId} maxLength={180} placeholder="名称或 SKU 编码" disabled={working} onChange={event => setDraft(current => ({ ...current, objectId: event.target.value }))} /></label></div>
          <div className="project-context-fields"><label className="project-context-field"><span>采用状态</span><select aria-label="成果采用状态" value={draft.adoption} disabled={working} onChange={event => setDraft(current => ({ ...current, adoption: event.target.value as ResultSearchDraft["adoption"] }))}><option value="any">全部状态</option><option value="approved">已采用</option><option value="candidate">候选</option><option value="rejected">已拒绝</option></select></label><label className="project-context-field"><span>描述来源</span><select aria-label="成果描述来源" value={draft.descriptionSource} disabled={working} onChange={event => setDraft(current => ({ ...current, descriptionSource: event.target.value as ResultSearchDraft["descriptionSource"] }))}><option value="any">全部描述</option><option value="observed">AI 已观察描述</option><option value="intended">原创作要求</option></select></label></div>
          <label className="project-context-field"><span>描述关键词</span><input aria-label="成果描述关键词" value={draft.descriptionText} maxLength={500} placeholder="例如：暖色、木桌" disabled={working} onChange={event => setDraft(current => ({ ...current, descriptionText: event.target.value }))} /></label>
          <div className="project-context-fields"><label className="project-context-field"><span>指定来源成果</span><select aria-label="成果来源" value={draft.source ? String(sourceOptions.findIndex(item => contextTargetKey(item.target) === contextTargetKey(draft.source!))) : ""} disabled={working} onChange={event => { const item = event.target.value === "" ? null : sourceOptions[Number(event.target.value)]; setDraft(current => ({ ...current, source: item?.target || null })); setSourceName(item?.name || ""); }}><option value="">不限来源</option>{sourceOptions.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label><label className="project-context-field"><span>排序</span><select aria-label="成果排序" value={draft.sort} disabled={working} onChange={event => setDraft(current => ({ ...current, sort: event.target.value as ResultSearchDraft["sort"] }))}><option value="relevance">相关度</option><option value="newest">最新成果</option><option value="name">名称</option></select></label></div>
          <div className="project-context-actions"><ButtonBase type="submit" disabled={working || !onContextCommand}>{working ? "处理中…" : "检索成果"}</ButtonBase><ButtonBase type="button" disabled={working} onClick={() => { setDraft(emptyResultSearchDraft()); setSourceName(""); }}>清空筛选</ButtonBase></div>
        </form>
        {search ? <><div className="project-context-search-count" role="status">找到 {search.total} 项 · {search.total ? `${search.offset + 1}–${search.offset + results.length}` : "无匹配"}</div>
          {chosen.length ? <div className="project-context-selection"><p>已选 {chosen.length} 项：{chosen.map(item => item.name).join("、")}</p><div className="project-context-actions"><ButtonBase type="button" disabled={working || !onUseResults} onClick={() => void act(() => onUseResults?.(targets, "reference"))}>作为参考图</ButtonBase><ButtonBase type="button" disabled={working || !onUseResults} onClick={() => void act(() => onUseResults?.(targets, "source"))}>作为本次素材</ButtonBase><ButtonBase type="button" disabled={working || chosen.length !== 2 || !onCompareResults} onClick={() => void act(() => onCompareResults?.(targets))}>比较两项</ButtonBase><ButtonBase type="button" disabled={working} onClick={() => setSelected(new Map())}>取消选择</ButtonBase></div></div> : null}
          <div className="project-context-results">{results.map(item => { const key = contextTargetKey(item.target); return <article className="project-context-result" key={key} data-search-result=""><label className="project-context-select"><input type="checkbox" aria-label={`选择成果 ${item.name}`} checked={selected.has(key)} disabled={working || !selected.has(key) && selected.size >= 40} onChange={event => setSelected(current => { const next = new Map(current); if (event.target.checked) next.set(key, item); else next.delete(key); return next; })} /><strong>{item.name}</strong></label><div className="project-context-badges"><span data-status={item.adoption.state}>{resultAdoptionLabel(item.adoption)}</span><span data-status={item.observation.status}>{resultObservationLabel(item.observation)}</span>{item.usage.length ? <span>{item.usage.join("、")}</span> : null}</div>{item.observation.summary ? <p>AI 观察：{item.observation.summary}</p> : null}{item.intended ? <p>原要求：{item.intended}</p> : null}{item.tags.length ? <p className="project-context-note">用户标签：{item.tags.join("、")}</p> : null}<details className="project-context-reasons"><summary>匹配原因</summary>{item.matchReasons.map((reason, index) => <p key={index}>{resultReasonText(reason)}</p>)}</details><div className="project-context-actions"><ButtonBase type="button" disabled={working || !onLocateResult} onClick={() => void act(() => onLocateResult?.(item.target))}>画布定位</ButtonBase><ButtonBase type="button" disabled={working} onClick={() => { const value = { ...draft, source: item.target }; setDraft(value); setSourceName(item.name); void query(value); }}>查找衍生成果</ButtonBase></div></article>; })}</div>
          {!results.length ? <p className="project-context-note">没有符合全部条件的成果，可调整用途、商品或描述来源。</p> : null}<div className="project-context-actions"><ButtonBase type="button" disabled={working || !search.offset} onClick={() => void query(applied, Math.max(0, search.offset - search.limit))}>上一页</ButtonBase><ButtonBase type="button" disabled={working || !search.hasMore} onClick={() => void query(applied, search.offset + search.limit)}>下一页</ButtonBase></div></> : <p className="project-context-note">检索读取本地成果。名称、标签和原要求不会被当作 AI 观察。</p>}
      </details>
      {contextError || notice ? <p className="project-context-note project-context-error" role="status">{notice || contextError}</p> : null}
    </div>
  </details>;
}

export default function ProjectContextPanel(props: ProjectContextPanelProps) {
  if (!props.projectContext) return null;
  return <ProjectContextPanelBody key={`${props.projectContext.projectId}:${props.projectContext.conversationId}`} {...props} projectContext={props.projectContext} />;
}
