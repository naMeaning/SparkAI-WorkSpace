import { creationRequirementsDraft as draftFor, creationRequirementsFromDraft as bodyFor, creationDraftSignature as draftSignature, creationLines as lines, newCreationRowId as userId } from "./creation-requirements-form.mjs";
import { creationResultStatus, creationSessionSummary } from "./creation-session-status.mjs";
const keyOf = target => JSON.stringify([target.assetId, target.occurrenceId, target.contentHash]);
const identity = target => ({ assetId: target.assetId, occurrenceId: target.occurrenceId, contentHash: target.contentHash });
function element(tag, className = "", text = "") { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }

export function createCreationWindowView(surface, command) {
  let context = "", draft = null, draftRevision = 0, dirty = false, signature = "", state = null;
  let selected = new Set(), preserve = "", changes = "", targetChanges = {}, requirementsOpen = false, revisionOpen = false, notice = "";
  let submittedDraft = "", submission = { signature: "", id: "" };
  function redraw() { signature = ""; render(state); }
  function render(nextState) {
    state = nextState;
    const session = state?.creationSession;
    surface.hidden = !session;
    if (!session) return;
    const requirements = session.requirements, revision = requirements?.revision || 0;
    const nextContext = JSON.stringify([session.projectId, session.conversationId]);
    if (context !== nextContext) { context = nextContext; draft = draftFor(requirements); draftRevision = revision; dirty = false; selected = new Set(); preserve = ""; changes = ""; targetChanges = {}; requirementsOpen = !requirements; revisionOpen = false; notice = ""; submittedDraft = ""; submission = { signature: "", id: "" }; }
    if (submittedDraft && revision !== draftRevision && requirements && submittedDraft === draftSignature(draftFor(requirements))) dirty = false;
    if (!dirty) { draft = draftFor(requirements); draftRevision = revision; }
    const projection = JSON.stringify([session, Boolean(state.creationBusy), state.creationError || "", Boolean(state.busy)]);
    if (signature === projection) return;
    signature = projection;
    const busy = Boolean(state.creationBusy), stale = revision !== draftRevision;
    const results = session.results || [], byKey = new Map(results.map(result => [keyOf(result.target), result]));
    const selectionStale = [...selected].some(key => !byKey.get(key)?.saved);
    const locator = { expectedProjectId: session.projectId, conversationId: session.conversationId, ...(requirements ? { requirementId: requirements.requirementId } : {}) };
    const submit = (type, input) => command({ type, input });
    function button(text, action, disabled = false) { const node = element("button", "ui-button-base", text); node.type = "button"; node.disabled = disabled || busy; node.addEventListener("click", () => { try { action(); } catch (error) { notice = error.message || "操作未完成。"; redraw(); } }); return node; }
    function field(parent, label, value, update, rows = 2, input = false) { const wrapper = element("label", "creation-field"), caption = element("span", "", label), control = element(input ? "input" : "textarea"); control.value = value; control.disabled = busy; control.maxLength = 200000; if (!input) control.rows = rows; control.addEventListener("input", () => update(control.value)); wrapper.append(caption, control); parent.append(wrapper); return control; }
    const summary = element("summary"), summaryCounts = element("span", "", creationSessionSummary(session).text); summaryCounts.setAttribute("data-creation-summary", ""); summary.append(element("strong", "", "创作要求与验收"), summaryCounts);
    const content = element("div", "creation-session-content"), editor = element("details", "creation-requirements");
    editor.open = requirementsOpen; editor.addEventListener("toggle", () => { requirementsOpen = editor.open; });
    editor.append(element("summary", "", requirements ? `查看 / 编辑要求 · 第 ${revision} 版` : "设置结构化创作要求"));
    const assumed = requirements ? [requirements.goal, requirements.usage, ...requirements.slots, ...requirements.preserve, ...requirements.adjustable, ...requirements.conditions].filter(item => item.source === "assumption").length : 0;
    if (assumed) editor.append(element("p", "creation-notice", `含 ${assumed} 项 Agent 推测，请确认；编辑某项后，该项标为你的要求。`));
    for (const [key, label] of [["goal", "创作目标"], ["usage", "用途"]]) { const control = field(editor, `${label} · ${draft[key].source === "user" ? "你的要求" : "Agent 推测"}`, draft[key].text, value => { draft[key] = { text: value, source: "user" }; dirty = true; control.previousElementSibling.textContent = `${label} · 你的要求`; }, 2); }
    const slots = element("div", "creation-slots"); slots.append(element("p", "", "交付清单"));
    for (const slot of draft.slots) {
      const row = element("div", "creation-slot-row"), input = element("input"), source = element("span", "creation-source", slot.source === "user" ? "你的要求" : "Agent 推测"); input.value = slot.label; input.maxLength = 120; input.disabled = busy; input.setAttribute("aria-label", "交付项名称");
      input.addEventListener("input", () => { slot.label = input.value; slot.source = "user"; source.textContent = "你的要求"; dirty = true; });
      row.append(source, input, button("移除", () => { draft.slots = draft.slots.filter(item => item.slotId !== slot.slotId); dirty = true; redraw(); })); slots.append(row);
    }
    slots.append(button("添加交付项", () => { draft.slots.push({ slotId: userId(), label: "", source: "user" }); dirty = true; redraw(); }, draft.slots.length >= 200)); editor.append(slots);
    for (const [key, label] of [["preserve", "必须保留"], ["adjustable", "可调整内容"], ["conditions", "验收条件"]]) {
      const group = element("div", "creation-criteria"); group.append(element("p", "", label));
      for (const criterion of draft[key]) {
        const row = element("div", "creation-criterion-row");
        const control = field(row, `${criterion.source === "user" ? "你的要求" : "Agent 推测"}${criterion.kind === "source_consistency" ? " · 与指定来源对照" : ""}`, criterion.text, value => { criterion.text = value; criterion.source = "user"; dirty = true; control.previousElementSibling.textContent = `你的要求${criterion.kind === "source_consistency" ? " · 与指定来源对照" : ""}`; }); control.maxLength = 4000;
        row.append(button("移除此项", () => { draft[key] = draft[key].filter(item => item.criterionId !== criterion.criterionId); dirty = true; redraw(); })); group.append(row);
      }
      group.append(button(`添加${label}`, () => { draft[key].push({ criterionId: userId(), text: "", source: "user", kind: "visual" }); dirty = true; redraw(); }, draft[key].length >= 200)); editor.append(group);
    }
    const files = element("div", "creation-file-fields");
    for (const [key, label] of [["formats", "文件格式"], ["width", "宽度 px"], ["height", "高度 px"], ["minWidth", "最小宽度 px"], ["minHeight", "最小高度 px"]]) field(files, label, draft[key], value => { draft[key] = value; dirty = true; }, 1, true);
    const alphaField = element("label", "creation-field"), alpha = element("select"); alpha.disabled = busy;
    for (const [value, label] of [["any", "不限"], ["required", "需要透明"], ["forbidden", "不透明"]]) { const option = element("option", "", label); option.value = value; option.selected = draft.alpha === value; alpha.append(option); }
    alpha.addEventListener("change", () => { draft.alpha = alpha.value; dirty = true; }); alphaField.append(element("span", "", "透明背景"), alpha); files.append(alphaField); editor.append(files);
    if (stale) { const warning = element("p", "creation-notice", "要求已在另一处更新。"); warning.append(button("载入最新要求", () => { dirty = false; draftRevision = revision; draft = draftFor(requirements); redraw(); })); editor.append(warning); }
    const save = button("保存要求", () => { const body = bodyFor(draft); submittedDraft = draftSignature(draft); submit("creation-requirements-update", { ...locator, expectedRevision: draftRevision, requirements: body }); }, stale);
    editor.append(save); content.append(editor);
    const resultList = element("div", "creation-results"); resultList.setAttribute("aria-label", "成果验收");
    if (results.length) {
      const toolbar = element("div", "creation-results-toolbar"); toolbar.append(element("span", "", "选择需要修改的成果"), button("本地检查", () => submit("creation-check", { ...locator, expectedRevision: revision, targets: selected.size ? [...selected].map(key => identity(byKey.get(key).target)) : results.filter(result => result.saved || result.fileSaved).map(result => identity(result.target)) }), !requirements || selectionStale || (!selected.size && !results.some(result => result.saved || result.fileSaved)))); resultList.append(toolbar);
      results.forEach((result, index) => {
        const key = keyOf(result.target), row = element("article", "creation-result"); row.dataset.creationResult = ""; row.dataset.resultNumber = String(index + 1);
        const label = element("label", "creation-result-select"), checkbox = element("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(key); checkbox.disabled = busy || !result.saved; checkbox.setAttribute("aria-label", `选择成果 ${index + 1} ${result.label}`);
        checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(key); else selected.delete(key); revisionOpen = selected.size > 0; redraw(); }); label.append(checkbox, element("strong", "", `${index + 1}. ${result.label || `成果 ${index + 1}`}`)); row.append(label);
        const statuses = element("div", "creation-result-states");
        const status = creationResultStatus(result);
        const statusItems = [[status.generated], [status.saved], [status.local, status.localStatus], [status.ai, status.aiStatus], [status.decision, result.decision.state]];
        for (const [text, status] of statusItems) { const badge = element("span", "", text); if (status) badge.dataset.status = status; statuses.append(badge); } row.append(statuses);
        if (result.previewUrl?.startsWith("naimage-asset:")) {
          const comparison = element("div", "creation-comparison");
          for (const entry of [result.baseline ? { url: result.baseline.previewUrl, label: `修改基准 · ${result.baseline.label}` } : null, { url: result.previewUrl, label: `${result.baseline ? "修改后" : "当前成果"} · ${result.label}` }].filter(Boolean)) {
            if (!entry.url?.startsWith("naimage-asset:")) continue;
            const figure = element("figure"), image = element("img"); image.src = entry.url; image.alt = entry.label; image.loading = "lazy"; figure.append(image, element("figcaption", "", entry.label)); comparison.append(figure);
          } row.append(comparison);
        }
        for (const issue of result.fileCheck?.issues || []) row.append(element("p", "creation-issue", issue.message));
        if (result.visualReview?.summary) row.append(element("p", "", result.visualReview.summary));
        if (result.visualReview?.findings?.length) { const findings = element("details"); findings.append(element("summary", "", "AI 审查依据")); for (const finding of result.visualReview.findings) { const criterion = [...(requirements?.conditions || []), ...(requirements?.preserve || [])].find(item => item.criterionId === finding.criterionId); findings.append(element("p", "", `${criterion?.text || "验收条件"}：${finding.status === "pass" ? "通过" : finding.status === "fail" ? "需修改" : "无法确定"} · ${finding.note}`)); } row.append(findings); }
        if (!result.current) row.append(element("p", "creation-notice", "要求或文件已变化，重新检查后再决定。历史成果仍可作为修改基准。"));
        const actions = element("div", "creation-result-actions");
        for (const [decision, text] of [["adopt", "采用"], ["reject", "拒绝"], ["candidate", "待定"]]) actions.append(button(text, () => submit("creation-decision", { ...locator, expectedRevision: revision, target: identity(result.target), decision }), !requirements || (decision === "adopt" && (!result.current || !result.saved || result.fileCheck?.status !== "passed")))); row.append(actions); resultList.append(row);
      });
      const revisionPanel = element("details", "creation-revision"); revisionPanel.open = revisionOpen; revisionPanel.addEventListener("toggle", () => { revisionOpen = revisionPanel.open; });
      revisionPanel.append(element("summary", "", `仅修改所选成果${selected.size ? ` · ${selected.size} 项` : ""}`), element("p", "creation-baseline", `修改基准：${selected.size ? [...selected].map(key => byKey.get(key)?.label || "已变化的成果").join("、") : "请先选择一个或多个成果"}。原图保留，新结果单独保存。`));
      if (selectionStale) { const warning = element("p", "creation-notice", "所选成果已变化，请"); warning.append(button("重新选择", () => { selected.clear(); redraw(); })); revisionPanel.append(warning); }
      const updateRevisionDisabled = () => { revise.disabled = busy || state.busy || !requirements || !selected.size || selectionStale || (!changes.trim() && [...selected].some(key => !targetChanges[key]?.trim())); };
      for (const key of selected) field(revisionPanel, `仅此成果的修改要求 · ${byKey.get(key)?.label || "已变化的成果"}`, targetChanges[key] || "", value => { targetChanges[key] = value; updateRevisionDisabled(); });
      field(revisionPanel, "保留要求 · 每行一项", preserve, value => { preserve = value; });
      field(revisionPanel, "共同修改要求 · 每行一项", changes, value => { changes = value; updateRevisionDisabled(); }, 3);
      const revise = button(`修改所选 ${selected.size || ""} 项`, () => {
        const lists = [lines(preserve), lines(changes), ...[...selected].map(key => lines(targetChanges[key]))];
        if (lists.some(list => list.length > 200 || list.some(item => item.length > 2000))) throw new Error("每项修改要求最多 2000 字，每类最多 200 项。");
        const targets = [...selected].map(key => ({ ...identity(byKey.get(key).target), ...(lines(targetChanges[key]).length ? { changes: lines(targetChanges[key]) } : {}) }));
        const input = { ...locator, requirementId: requirements.requirementId, expectedRevision: revision, targets, preserve: lines(preserve), changes: lines(changes) };
        const requestSignature = JSON.stringify(input);
        if (submission.signature !== requestSignature) submission = { signature: requestSignature, id: `revision-${crypto.randomUUID()}` };
        submit("creation-revision", { ...input, submissionId: submission.id });
      }); updateRevisionDisabled(); revisionPanel.append(revise);
      revisionPanel.append(button("精确区域修改", () => {
        const target = byKey.get([...selected][0])?.target;
        const lists = [lines(preserve), lines(changes), lines(targetChanges[[...selected][0]] || "")];
        if (lists.some(list => list.length > 200 || list.some(item => item.length > 2000))) throw new Error("每项修改要求最多 2000 字，每类最多 200 项。");
        submit("creation-region-revision", { ...locator, requirementId: requirements.requirementId, expectedRevision: revision,
          target: { ...identity(target), ...(lists[2].length ? { changes: lists[2] } : {}) }, preserve: lists[0], changes: lists[1] });
      }, state.busy || !requirements || selected.size !== 1 || selectionStale));
      if (selected.size > 1) revisionPanel.append(element("p", "creation-notice", "精确区域修改每次选择一个成果。"));
      resultList.append(revisionPanel);
      content.append(resultList);
    } else content.append(element("p", "creation-notice", "成果生成后将在这里分别显示保存、检查和采用状态。"));
    if (notice || state.creationError) content.append(element("p", "creation-notice", notice || state.creationError));
    surface.replaceChildren(summary, content);
  }
  return { render };
}
