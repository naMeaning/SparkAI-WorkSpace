import { contextTargetKey, emptyKnowledgeDraft, emptyResultSearchDraft, knowledgeDraftFor, knowledgeInputFromDraft,
  knowledgeScopeLabel, knowledgeScopeOptions, knowledgeStatusLabel, knowledgeTypeLabel, resultAdoptionLabel,
  resultObservationLabel, resultReasonText, resultSearchInput } from "./project-context-presentation.mjs";

const element = (tag, className = "", text = "") => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const scopeKey = scope => JSON.stringify(scope);
const types = ["brand_rule", "product_fact", "prohibited_expression", "style_reference", "preference"];

export function createProjectContextWindowView(surface, command) {
  let state = null, identity = "", signature = "", editor = null, submitted = null, notice = "";
  let draft = emptyResultSearchDraft(), applied = emptyResultSearchDraft(), sourceName = "", selected = new Map();
  let knowledgeOpen = false, searchOpen = false, usedOpen = false;
  const reasonsOpen = new Set();
  const redraw = () => { signature = ""; render(state); };
  function render(nextState) {
    state = nextState;
    const context = state?.projectContext;
    surface.hidden = !context;
    if (!context) return;
    surface.classList.add("project-context"); surface.setAttribute("data-project-context", "");
    const nextIdentity = JSON.stringify([context.projectId, context.conversationId]);
    if (identity !== nextIdentity) {
      identity = nextIdentity; editor = null; submitted = null; notice = "";
      draft = emptyResultSearchDraft(); applied = emptyResultSearchDraft(); sourceName = ""; selected = new Map();
      knowledgeOpen = false; searchOpen = false; usedOpen = false; reasonsOpen.clear();
    }
    if (submitted && context.revision !== submitted.revision) {
      const saved = context.entries.find(entry => (!submitted.knowledgeId || entry.knowledgeId === submitted.knowledgeId) && JSON.stringify(knowledgeDraftFor(entry)) === submitted.draft);
      if (saved) { editor = null; submitted = null; }
    }
    const nextSignature = JSON.stringify([context, Boolean(state.contextBusy), state.contextError || ""]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const busy = Boolean(state.contextBusy), search = context.search, results = search?.results || [];
    const options = knowledgeScopeOptions(context), stale = editor && editor.revision !== context.revision;
    for (const item of results) if (selected.has(contextTargetKey(item.target))) selected.set(contextTargetKey(item.target), item);
    const chosen = [...selected.values()], targets = chosen.map(item => item.target);
    const locator = { expectedProjectId: context.projectId, conversationId: context.conversationId };
    const submit = (name, input = {}) => command({ type: "project-context-command", command: name, input: { expectedProjectId: context.projectId, ...input } });
    const resultAction = (type, actionTargets, role) => command({ type, ...locator, targets: actionTargets, ...(role ? { role } : {}) });
    const safeAction = action => { notice = ""; try { action(); } catch (error) { notice = error?.message || "操作未完成。"; redraw(); } };
    function button(label, action, disabled = false, submitButton = false) {
      const node = element("button", "ui-button-base", label); node.type = submitButton ? "submit" : "button"; node.disabled = busy || disabled;
      if (action) node.addEventListener("click", () => safeAction(action)); return node;
    }
    function field(parent, label, value, update, { rows = 1, maximum = 500, name = "", placeholder = "" } = {}) {
      const wrap = element("label", "project-context-field"), control = element(rows > 1 ? "textarea" : "input");
      control.value = value; control.disabled = busy; control.maxLength = maximum; control.placeholder = placeholder;
      if (rows > 1) control.rows = rows;
      control.setAttribute("aria-label", name || label); control.dataset.contextField = name || label;
      control.addEventListener("input", () => update(control.value)); wrap.append(element("span", "", label), control); parent.append(wrap); return control;
    }
    function select(parent, label, value, values, update, name = label) {
      const wrap = element("label", "project-context-field"), control = element("select"); control.disabled = busy;
      control.setAttribute("aria-label", name); control.dataset.contextField = name;
      for (const [key, caption] of values) { const option = element("option", "", caption); option.value = key; option.selected = key === value; control.append(option); }
      control.value = value; control.addEventListener("change", () => update(control.value)); wrap.append(element("span", "", label), control); parent.append(wrap); return control;
    }
    function details(className, label, open, changed) { const node = element("details", className); node.open = open; node.append(element("summary", "", label)); node.addEventListener("toggle", () => changed(node.open)); return node; }
    const actions = () => element("div", "project-context-actions");
    const summary = element("summary"), count = context.entries.filter(entry => entry.status === "active" && entry.usable !== false).length;
    summary.append(element("strong", "", "项目知识与成果检索"), element("span", "", `${count} 项知识生效`));
    const content = element("div", "project-context-content");
    const knowledge = details("project-context-knowledge", `项目长期知识 · 第 ${context.revision} 版`, knowledgeOpen, value => { knowledgeOpen = value; });
    knowledge.append(element("p", "project-context-note", "仅对本项目生效。新任务采用当前版本，正在执行的任务保留原版本。"));
    const startEdit = entry => { editor = { draft: knowledgeDraftFor(entry), revision: context.revision, ...(entry ? { entry } : {}) }; knowledgeOpen = true; notice = ""; redraw(); };
    const toolbar = actions(); toolbar.append(button("新增知识", () => startEdit()), button("刷新", () => submit("project.context.get", { conversationId: context.conversationId }))); knowledge.append(toolbar);
    for (const entry of context.entries) {
      const row = element("article", "project-context-entry"); row.setAttribute("data-knowledge-entry", ""); row.append(element("strong", "", entry.title));
      const badges = element("div", "project-context-badges");
      for (const label of [knowledgeTypeLabel(entry.type), options.find(option => scopeKey(option.scope) === scopeKey(entry.scope))?.label || knowledgeScopeLabel(entry.scope), knowledgeStatusLabel(entry.status), `${entry.source === "assumption" ? "Agent 建议" : "用户确认"} · 第 ${entry.revision} 版`]) badges.append(element("span", "", label));
      badges.children[2].dataset.status = entry.status; row.append(badges, element("p", "", entry.content));
      if (entry.usable === false) row.append(element("p", "project-context-note", "范围或基准素材已失效，本次不会采用。"));
      if (entry.assetRefs.length) row.append(element("p", "project-context-note", `关联 ${entry.assetRefs.length} 项基准成果`));
      if (entry.readOnly || entry.authority === "commerce_catalog") row.append(element("p", "project-context-note", "来自商品资料，请在商品资料中修改。"));
      else {
        const controls = actions(), input = { expectedRevision: context.revision, knowledgeId: entry.knowledgeId, expectedEntryRevision: entry.revision };
        controls.append(button("编辑", () => startEdit(entry)));
        if (entry.source === "assumption") controls.append(button("确认并长期采用", () => submit("project.knowledge.promote", input), entry.usable === false));
        else controls.append(button(entry.status === "active" ? "停用" : "启用", () => submit("project.knowledge.status", { ...input, status: entry.status === "active" ? "inactive" : "active" }), entry.status !== "active" && entry.usable === false));
        controls.append(button("删除", () => submit("project.knowledge.status", { ...input, status: "deleted" }))); row.append(controls);
      }
      knowledge.append(row);
    }
    if (!context.entries.length) knowledge.append(element("p", "project-context-note", "还没有长期知识，可保存品牌规范、商品事实或创作偏好。"));
    if (context.nextOffset !== undefined) knowledge.append(button("载入更多知识", () => submit("project.knowledge.list", { offset: context.nextOffset, limit: 100 })));
    if (editor) {
      const form = element("form", "project-context-editor"); form.append(element("strong", "", editor.entry ? "编辑知识" : "新增长期知识"));
      const save = () => {
        if (stale) throw new Error("知识已在另一窗口更新，请载入最新版本后重试。");
        const input = knowledgeInputFromDraft(editor.draft, { projectId: context.projectId, revision: editor.revision, entry: editor.entry });
        submitted = { draft: JSON.stringify(editor.draft), revision: editor.revision, knowledgeId: editor.entry?.knowledgeId };
        submit("project.knowledge.save", input);
      };
      form.addEventListener("submit", event => { event.preventDefault(); safeAction(save); });
      const title = field(form, "名称", editor.draft.title, value => { editor.draft.title = value; updateSave(); }, { maximum: 120, name: "知识名称" });
      const fields = element("div", "project-context-fields");
      select(fields, "类型", editor.draft.type, types.map(type => [type, knowledgeTypeLabel(type)]), value => { editor.draft.type = value; redraw(); });
      const scopes = options.some(option => scopeKey(option.scope) === scopeKey(editor.draft.scope)) ? options : [...options, { scope: editor.draft.scope, label: `${knowledgeScopeLabel(editor.draft.scope)} · 当前范围` }];
      select(fields, "适用范围", String(scopes.findIndex(option => scopeKey(option.scope) === scopeKey(editor.draft.scope))), scopes.map((option, index) => [String(index), option.label]), value => { editor.draft.scope = scopes[Number(value)].scope; }); form.append(fields);
      if (context.scopeOptionsTruncated) form.append(element("p", "project-context-note", "范围选项较多，当前显示前 200 项。"));
      field(form, `内容 · ${editor.draft.source === "assumption" ? "保存后仍为建议，需明确确认" : "用户明确保存的长期要求"}`, editor.draft.content, value => { editor.draft.content = value; updateSave(); }, { rows: 4, maximum: 4000, name: "知识内容" });
      if (editor.draft.type === "style_reference") {
        form.append(element("p", "project-context-note", `基准成果 ${editor.draft.assetRefs.length} 项。先在下方检索并选择已采用成果。`));
        form.append(button("使用所选已采用成果作为基准", () => { editor.draft.assetRefs = targets; redraw(); }, !chosen.length || chosen.length > 8 || chosen.some(item => item.adoption.state !== "approved" || !item.adoption.current)));
      }
      if (stale) {
        const warning = element("p", "project-context-note", "知识已在另一窗口更新，草稿仍保留。"); warning.setAttribute("role", "status");
        warning.append(button("载入最新版本", () => { const latest = editor.entry && context.entries.find(entry => entry.knowledgeId === editor.entry.knowledgeId); if (editor.entry && !latest) throw new Error("这条知识已删除，请重新新增。"); editor = { revision: context.revision, ...(latest ? { entry: latest } : {}), draft: latest ? knowledgeDraftFor(latest) : editor.draft }; redraw(); })); form.append(warning);
      }
      const controls = actions(), saveButton = button("保存知识", null, stale, true);
      const updateSave = () => { saveButton.disabled = busy || stale || !editor.draft.title.trim() || !editor.draft.content.trim(); };
      updateSave(); controls.append(saveButton, button("取消编辑", () => { editor = null; submitted = null; redraw(); })); form.append(controls); knowledge.append(form);
    }
    content.append(knowledge);
    if (context.usedKnowledge) {
      const used = details("project-context-used", `上次保存任务实际采用 · ${context.usedKnowledge.entries.length} 项知识`, usedOpen, value => { usedOpen = value; });
      used.append(element("p", "project-context-note", `项目知识第 ${context.usedKnowledge.revision} 版${context.usedKnowledge.revision !== context.revision ? "，当前版本已有更新。" : "。"}`));
      for (const entry of context.usedKnowledge.entries) used.append(element("p", "", `${entry.title} · 第 ${entry.revision} 版\n${entry.content}`));
      if (context.usedKnowledge.budget.omittedEntries) used.append(element("p", "project-context-note", `另有 ${context.usedKnowledge.budget.omittedEntries} 项因上下文预算未采用。`));
      if (context.usedTemplate) used.append(element("p", "project-context-note", `同时使用需求模板第 ${context.usedTemplate.revision} 版。`)); content.append(used);
    }
    const finder = details("project-context-search", "检索历史成果", searchOpen, value => { searchOpen = value; }); finder.setAttribute("data-result-search", "");
    const runSearch = (value = draft, offset = 0) => { applied = { ...value }; searchOpen = true; submit("project.results.search", resultSearchInput(value, context.projectId, offset)); };
    const searchForm = element("form"); searchForm.addEventListener("submit", event => { event.preventDefault(); safeAction(() => runSearch()); });
    field(searchForm, "关键词", draft.text, value => { draft.text = value; }, { name: "成果关键词", placeholder: "名称、标签或描述" });
    const usage = element("div", "project-context-fields"); field(usage, "用途", draft.usage, value => { draft.usage = value; }, { name: "成果用途", maximum: 240, placeholder: "例如：场景图" }); field(usage, "商品 / SKU", draft.objectId, value => { draft.objectId = value; }, { name: "成果商品或SKU", maximum: 180, placeholder: "名称或 SKU 编码" }); searchForm.append(usage);
    const filters = element("div", "project-context-fields");
    select(filters, "采用状态", draft.adoption, [["any", "全部状态"], ["approved", "已采用"], ["candidate", "候选"], ["rejected", "已拒绝"]], value => { draft.adoption = value; }, "成果采用状态");
    select(filters, "描述来源", draft.descriptionSource, [["any", "全部描述"], ["observed", "AI 已观察描述"], ["intended", "原创作要求"]], value => { draft.descriptionSource = value; }, "成果描述来源"); searchForm.append(filters);
    field(searchForm, "描述关键词", draft.descriptionText, value => { draft.descriptionText = value; }, { name: "成果描述关键词", placeholder: "例如：暖色、木桌" });
    const sourceOptions = [...new Map([...(draft.source ? [[contextTargetKey(draft.source), { target: draft.source, name: sourceName || "所选来源" }]] : []), ...results.map(item => [contextTargetKey(item.target), item])]).values()];
    const sources = element("div", "project-context-fields");
    select(sources, "指定来源成果", draft.source ? String(sourceOptions.findIndex(item => contextTargetKey(item.target) === contextTargetKey(draft.source))) : "", [["", "不限来源"], ...sourceOptions.map((item, index) => [String(index), item.name])], value => { const item = value === "" ? null : sourceOptions[Number(value)]; draft.source = item?.target || null; sourceName = item?.name || ""; }, "成果来源");
    select(sources, "排序", draft.sort, [["relevance", "相关度"], ["newest", "最新成果"], ["name", "名称"]], value => { draft.sort = value; }, "成果排序"); searchForm.append(sources);
    const searchActions = actions(); searchActions.append(button(busy ? "处理中…" : "检索成果", null, false, true), button("清空筛选", () => { draft = emptyResultSearchDraft(); sourceName = ""; redraw(); })); searchForm.append(searchActions); finder.append(searchForm);
    if (search) {
      const count = element("div", "project-context-search-count", `找到 ${search.total} 项 · ${search.total ? `${search.offset + 1}–${search.offset + results.length}` : "无匹配"}`); count.setAttribute("role", "status"); finder.append(count);
      if (chosen.length) {
        const selection = element("div", "project-context-selection"), controls = actions(); selection.append(element("p", "", `已选 ${chosen.length} 项：${chosen.map(item => item.name).join("、")}`));
        controls.append(button("作为参考图", () => resultAction("project-results-use", targets, "reference")), button("作为本次素材", () => resultAction("project-results-use", targets, "source")), button("比较两项", () => resultAction("project-results-compare", targets), chosen.length !== 2), button("取消选择", () => { selected.clear(); redraw(); })); selection.append(controls); finder.append(selection);
      }
      const list = element("div", "project-context-results");
      for (const item of results) {
        const key = contextTargetKey(item.target), row = element("article", "project-context-result"), label = element("label", "project-context-select"), checkbox = element("input");
        row.setAttribute("data-search-result", ""); checkbox.type = "checkbox"; checkbox.checked = selected.has(key); checkbox.disabled = busy || !selected.has(key) && selected.size >= 40; checkbox.setAttribute("aria-label", `选择成果 ${item.name}`);
        checkbox.addEventListener("change", () => { if (checkbox.checked) selected.set(key, item); else selected.delete(key); redraw(); }); label.append(checkbox, element("strong", "", item.name)); row.append(label);
        const badges = element("div", "project-context-badges"), adoption = element("span", "", resultAdoptionLabel(item.adoption)), observation = element("span", "", resultObservationLabel(item.observation)); adoption.dataset.status = item.adoption.state; observation.dataset.status = item.observation.status; badges.append(adoption, observation); if (item.usage.length) badges.append(element("span", "", item.usage.join("、"))); row.append(badges);
        if (item.observation.summary) row.append(element("p", "", `AI 观察：${item.observation.summary}`));
        if (item.intended) row.append(element("p", "", `原要求：${item.intended}`));
        if (item.tags.length) row.append(element("p", "project-context-note", `用户标签：${item.tags.join("、")}`));
        const reasons = details("project-context-reasons", "匹配原因", reasonsOpen.has(key), value => { if (value) reasonsOpen.add(key); else reasonsOpen.delete(key); }); for (const reason of item.matchReasons) reasons.append(element("p", "", resultReasonText(reason))); row.append(reasons);
        const controls = actions(); controls.append(button("画布定位", () => resultAction("project-result-locate", [item.target])), button("查找衍生成果", () => { draft = { ...draft, source: item.target }; sourceName = item.name; runSearch(draft); redraw(); })); row.append(controls); list.append(row);
      }
      finder.append(list);
      if (!results.length) finder.append(element("p", "project-context-note", "没有符合全部条件的成果，可调整用途、商品或描述来源。"));
      const pages = actions(); pages.append(button("上一页", () => runSearch(applied, Math.max(0, search.offset - search.limit)), !search.offset), button("下一页", () => runSearch(applied, search.offset + search.limit), !search.hasMore)); finder.append(pages);
    } else finder.append(element("p", "project-context-note", "检索读取本地成果。名称、标签和原要求不会被当作 AI 观察。"));
    content.append(finder);
    if (notice || state.contextError) { const error = element("p", "project-context-note project-context-error", notice || state.contextError); error.setAttribute("role", "status"); content.append(error); }
    const focused = document.activeElement, focusedName = focused?.dataset?.contextField, selectionStart = focused?.selectionStart, selectionEnd = focused?.selectionEnd;
    surface.replaceChildren(summary, content);
    if (focusedName) { const control = [...surface.querySelectorAll("[data-context-field]")].find(node => node.dataset.contextField === focusedName); control?.focus(); if (typeof selectionStart === "number" && typeof control?.setSelectionRange === "function") control.setSelectionRange(selectionStart, selectionEnd); }
  }
  return { render };
}
