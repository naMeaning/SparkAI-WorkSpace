import React, { useEffect, useMemo, useRef, useState } from "react";
import { creationResultStatus, creationSessionSummary, creationTargetKey } from "./creation-session";
import type { CreationSessionPanelProps } from "./creation-session";
import { ButtonBase } from "./ui/primitives";
import { creationRequirementsDraft as draftFor, creationRequirementsFromDraft as requirementsFor, creationLines as lines, newCreationRowId as fieldId } from "../runtime/creation-requirements-form.mjs";

export default function CreationSessionPanel({ creationSession: session, creationBusy = false, creationError = "", executionBusy = false,
  onUpdateCreationRequirements, onCreationDecision, onStartCreationRevision, onRegionRevision, onCheckCreationAcceptance }: CreationSessionPanelProps) {
  const requirements = session?.requirements;
  const [draft, setDraft] = useState(() => draftFor(requirements));
  const [draftRevision, setDraftRevision] = useState(requirements?.revision || 0);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preserve, setPreserve] = useState("");
  const [changes, setChanges] = useState("");
  const [targetChanges, setTargetChanges] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const revisionSubmission = useRef({ signature: "", submissionId: "" });
  const locatorKey = `${session?.projectId || ""}:${session?.conversationId || ""}`;
  useEffect(() => { setDraft(draftFor(requirements)); setDraftRevision(requirements?.revision || 0); setDirty(false); setSelected([]); setNotice(""); setPreserve(""); setChanges(""); setTargetChanges({}); revisionSubmission.current = { signature: "", submissionId: "" }; }, [locatorKey]);
  useEffect(() => {
    if (!dirty) { setDraft(draftFor(requirements)); setDraftRevision(requirements?.revision || 0); }
  }, [requirements?.revision, dirty]);
  const resultByKey = useMemo(() => new Map((session?.results || []).map(result => [creationTargetKey(result.target), result])), [session?.results]);
  if (!session) return null;
  const busy = creationBusy || pending;
  const staleDraft = draftRevision !== (requirements?.revision || 0);
  const selectionStale = selected.some(key => !resultByKey.get(key)?.saved);
  const targets = selected.flatMap(key => { const target = resultByKey.get(key)?.target; return target ? [{ ...target, ...(targetChanges[key]?.trim() ? { changes: lines(targetChanges[key]) } : {}) }] : []; });
  const locator = { expectedProjectId: session.projectId, conversationId: session.conversationId, ...(requirements ? { requirementId: requirements.requirementId } : {}) };
  const selectedLabels = selected.map(key => resultByKey.get(key)?.label || "已变化的成果");
  const assumed = requirements ? [requirements.goal, requirements.usage, ...requirements.slots, ...requirements.preserve, ...requirements.adjustable, ...requirements.conditions].filter(item => item.source === "assumption").length : 0;
  async function act(action: () => unknown) {
    setPending(true); setNotice("");
    try { const result = await action() as { ok?: boolean; error?: string } | undefined; if (result?.ok === false) setNotice(result.error || "操作未完成，请刷新后重试。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "操作未完成。"); }
    finally { setPending(false); }
  }
  function changeDraft(key: "formats" | "width" | "height" | "minWidth" | "minHeight" | "alpha", value: string) { setDirty(true); setDraft(current => ({ ...current, [key]: value })); }
  const fields = [{ key: "goal" as const, label: "创作目标", placeholder: "希望完成什么" }, { key: "usage" as const, label: "用途", placeholder: "作品的使用场景" }];
  const criterionFields = [{ key: "preserve" as const, label: "必须保留" }, { key: "adjustable" as const, label: "可调整内容" }, { key: "conditions" as const, label: "验收条件" }];
  return <details className="creation-session" data-creation-session>
    <summary><strong>创作要求与验收</strong><span data-creation-summary>{creationSessionSummary(session).text}</span></summary>
    <div className="creation-session-content">
      <details className="creation-requirements" open={!requirements}>
        <summary>{requirements ? `查看 / 编辑要求 · 第 ${requirements.revision} 版` : "设置结构化创作要求"}</summary>
        {assumed > 0 ? <p className="creation-notice">含 {assumed} 项 Agent 推测，请确认；编辑某项后，该项标为你的要求。</p> : null}
        {fields.map(field => <label className="creation-field" key={field.key}><span>{field.label} · {draft[field.key].source === "user" ? "你的要求" : "Agent 推测"}</span><textarea rows={2} value={draft[field.key].text} maxLength={200000} placeholder={field.placeholder} disabled={busy} onChange={event => { setDirty(true); setDraft(current => ({ ...current, [field.key]: { text: event.target.value, source: "user" } })); }} /></label>)}
        <div className="creation-slots"><p>交付清单</p>{draft.slots.map(slot => <div className="creation-slot-row" key={slot.slotId}><span className="creation-source">{slot.source === "user" ? "你的要求" : "Agent 推测"}</span><input aria-label="交付项名称" value={slot.label} maxLength={120} disabled={busy} onChange={event => { setDirty(true); setDraft(current => ({ ...current, slots: current.slots.map(item => item.slotId === slot.slotId ? { ...item, label: event.target.value, source: "user" } : item) })); }} /><ButtonBase type="button" aria-label={`移除交付项 ${slot.label}`} disabled={busy} onClick={() => { setDirty(true); setDraft(current => ({ ...current, slots: current.slots.filter(item => item.slotId !== slot.slotId) })); }}>移除</ButtonBase></div>)}<ButtonBase type="button" disabled={busy || draft.slots.length >= 200} onClick={() => { setDirty(true); setDraft(current => ({ ...current, slots: [...current.slots, { slotId: fieldId(), label: "", source: "user" }] })); }}>添加交付项</ButtonBase></div>
        {criterionFields.map(field => <div className="creation-criteria" key={field.key}><p>{field.label}</p>{draft[field.key].map(criterion => <div className="creation-criterion-row" key={criterion.criterionId}>
          <label className="creation-field"><span>{criterion.source === "user" ? "你的要求" : "Agent 推测"}{criterion.kind === "source_consistency" ? " · 与指定来源对照" : ""}</span><textarea rows={2} maxLength={4000} value={criterion.text} disabled={busy} onChange={event => { setDirty(true); setDraft(current => ({ ...current, [field.key]: current[field.key].map(item => item.criterionId === criterion.criterionId ? { ...item, text: event.target.value, source: "user" } : item) })); }} /></label>
          <ButtonBase type="button" disabled={busy} onClick={() => { setDirty(true); setDraft(current => ({ ...current, [field.key]: current[field.key].filter(item => item.criterionId !== criterion.criterionId) })); }}>移除此项</ButtonBase>
        </div>)}<ButtonBase type="button" disabled={busy || draft[field.key].length >= 200} onClick={() => { setDirty(true); setDraft(current => ({ ...current, [field.key]: [...current[field.key], { criterionId: fieldId(), text: "", source: "user", kind: "visual" }] })); }}>添加{field.label}</ButtonBase></div>)}
        <div className="creation-file-fields">
          <label className="creation-field"><span>文件格式</span><input value={draft.formats} placeholder="png, jpeg" disabled={busy} onChange={event => changeDraft("formats", event.target.value)} /></label>
          <label className="creation-field"><span>宽度 px</span><input inputMode="numeric" value={draft.width} placeholder="不限" disabled={busy} onChange={event => changeDraft("width", event.target.value)} /></label>
          <label className="creation-field"><span>高度 px</span><input inputMode="numeric" value={draft.height} placeholder="不限" disabled={busy} onChange={event => changeDraft("height", event.target.value)} /></label>
          <label className="creation-field"><span>最小宽度 px</span><input inputMode="numeric" value={draft.minWidth} placeholder="不限" disabled={busy} onChange={event => changeDraft("minWidth", event.target.value)} /></label>
          <label className="creation-field"><span>最小高度 px</span><input inputMode="numeric" value={draft.minHeight} placeholder="不限" disabled={busy} onChange={event => changeDraft("minHeight", event.target.value)} /></label>
          <label className="creation-field"><span>透明背景</span><select value={draft.alpha} disabled={busy} onChange={event => changeDraft("alpha", event.target.value)}><option value="any">不限</option><option value="required">需要透明</option><option value="forbidden">不透明</option></select></label>
        </div>
        {staleDraft ? <p className="creation-notice">要求已在另一处更新。<ButtonBase type="button" onClick={() => { setDraft(draftFor(requirements)); setDraftRevision(requirements?.revision || 0); setDirty(false); }}>载入最新要求</ButtonBase></p> : null}
        <ButtonBase type="button" disabled={busy || staleDraft || !draft.goal.text.trim() || !onUpdateCreationRequirements} onClick={() => void act(async () => { const result = await onUpdateCreationRequirements?.({ ...locator, expectedRevision: draftRevision, requirements: requirementsFor(draft) }); if ((result as { ok?: boolean } | undefined)?.ok !== false) setDirty(false); return result; })}>保存要求</ButtonBase>
      </details>
      {session.results.length ? <div className="creation-results" aria-label="成果验收">
        <div className="creation-results-toolbar"><span>选择需要修改的成果</span><ButtonBase type="button" disabled={busy || selectionStale || !requirements || !onCheckCreationAcceptance || (!selected.length && !session.results.some(result => result.saved || result.fileSaved))} onClick={() => void act(() => onCheckCreationAcceptance?.({ ...locator, expectedRevision: requirements!.revision, targets: selected.length ? targets.map(({ assetId, occurrenceId, contentHash }) => ({ assetId, occurrenceId, contentHash })) : session.results.filter(result => result.saved || result.fileSaved).map(result => result.target) }))}>本地检查</ButtonBase></div>
        {session.results.map((result, index) => {
          const key = creationTargetKey(result.target), status = creationResultStatus(result);
          const canAdopt = result.current && result.saved && result.fileCheck?.status === "passed";
          return <article className="creation-result" key={key} data-creation-result data-result-number={index + 1}>
            <label className="creation-result-select"><input type="checkbox" aria-label={`选择成果 ${index + 1} ${result.label}`} checked={selected.includes(key)} disabled={busy || !result.saved} onChange={event => setSelected(current => event.target.checked ? [...current, key] : current.filter(item => item !== key))} /><strong>{index + 1}. {result.label || `成果 ${index + 1}`}</strong></label>
            <div className="creation-result-states"><span>{status.generated}</span><span>{status.saved}</span><span data-status={status.localStatus}>{status.local}</span><span data-status={status.aiStatus}>{status.ai}</span><span data-status={result.decision.state}>{status.decision}</span></div>
            {result.previewUrl ? <div className="creation-comparison" key={`${key}:${result.baseline ? creationTargetKey(result.baseline.target) : "none"}`}>
              {result.baseline?.previewUrl ? <figure><img src={result.baseline.previewUrl} alt={`修改基准：${result.baseline.label}`} loading="lazy" /><figcaption>修改基准 · {result.baseline.label}</figcaption></figure> : null}
              <figure><img src={result.previewUrl} alt={result.label} loading="lazy" /><figcaption>{result.baseline ? "修改后" : "当前成果"} · {result.label}</figcaption></figure>
            </div> : null}
            {result.fileCheck?.issues.map(issue => <p className="creation-issue" key={issue.code}>{issue.message}</p>)}
            {result.visualReview?.summary ? <p>{result.visualReview.summary}</p> : null}
            {result.visualReview?.findings.length ? <details><summary>AI 审查依据</summary>{result.visualReview.findings.map((finding, findingIndex) => <p key={`${finding.criterionId}-${findingIndex}`}>{requirements?.conditions.find(item => item.criterionId === finding.criterionId)?.text || requirements?.preserve.find(item => item.criterionId === finding.criterionId)?.text || "验收条件"}：{finding.status === "pass" ? "通过" : finding.status === "fail" ? "需修改" : "无法确定"} · {finding.note}</p>)}</details> : null}
            {!result.current ? <p className="creation-notice">要求或文件已变化，重新检查后再决定。历史成果仍可作为修改基准。</p> : null}
            <div className="creation-result-actions">{([['adopt', '采用'], ['reject', '拒绝'], ['candidate', '待定']] as const).map(([decision, label]) => <ButtonBase type="button" key={decision} disabled={busy || !requirements || !onCreationDecision || (decision === "adopt" && !canAdopt)} onClick={() => void act(() => onCreationDecision?.({ ...locator, expectedRevision: requirements!.revision, target: result.target, decision }))}>{label}</ButtonBase>)}</div>
          </article>;
        })}
        <details className="creation-revision" open={selected.length > 0}>
          <summary>仅修改所选成果{selected.length ? ` · ${selected.length} 项` : ""}</summary>
          <p className="creation-baseline">修改基准：{selectedLabels.length ? selectedLabels.join("、") : "请先选择一个或多个成果"}。原图保留，新结果单独保存。</p>
          {selectionStale ? <p className="creation-notice">所选成果已变化，请<ButtonBase type="button" onClick={() => setSelected([])}>重新选择</ButtonBase>。</p> : null}
          {selected.map(key => <label className="creation-field" key={key}><span>仅此成果的修改要求 · {resultByKey.get(key)?.label || "已变化的成果"}</span><textarea rows={2} value={targetChanges[key] || ""} maxLength={200000} disabled={busy} onChange={event => setTargetChanges(current => ({ ...current, [key]: event.target.value }))} placeholder="只对这一项生效，可留空并使用共同要求" /></label>)}
          <label className="creation-field"><span>保留要求 · 每行一项</span><textarea rows={2} value={preserve} maxLength={200000} disabled={busy} onChange={event => setPreserve(event.target.value)} placeholder="本次修改必须保持的内容" /></label>
          <label className="creation-field"><span>共同修改要求 · 每行一项</span><textarea rows={3} value={changes} maxLength={200000} disabled={busy} onChange={event => setChanges(event.target.value)} placeholder="只应用到上方全部已选成果" /></label>
          <ButtonBase type="button" disabled={busy || executionBusy || !requirements || !targets.length || selectionStale || (!changes.trim() && targets.some(target => !target.changes?.length)) || !onStartCreationRevision} onClick={() => void act(() => {
            const lists = [lines(preserve), lines(changes), ...selected.map(key => lines(targetChanges[key] || ""))];
            if (lists.some(list => list.length > 200 || list.some(line => line.length > 2000))) throw new Error("每项修改要求最多 2000 字，每类最多 200 项。");
            const signature = JSON.stringify([locator, requirements!.revision, targets, lines(preserve), lines(changes)]);
            if (revisionSubmission.current.signature !== signature) revisionSubmission.current = { signature, submissionId: `revision-${crypto.randomUUID()}` };
            return onStartCreationRevision?.({ ...locator, requirementId: requirements!.requirementId, expectedRevision: requirements!.revision, submissionId: revisionSubmission.current.submissionId, targets, preserve: lines(preserve), changes: lines(changes) });
          })}>修改所选 {selected.length || ""} 项</ButtonBase>
          <ButtonBase type="button" disabled={busy || executionBusy || !requirements || targets.length !== 1 || selectionStale || !onRegionRevision} onClick={() => void act(() => {
            const lists = [lines(preserve), lines(changes), ...selected.map(key => lines(targetChanges[key] || ""))];
            if (lists.some(list => list.length > 200 || list.some(line => line.length > 2000))) throw new Error("每项修改要求最多 2000 字，每类最多 200 项。");
            return onRegionRevision?.({ ...locator, requirementId: requirements!.requirementId, expectedRevision: requirements!.revision,
              target: targets[0], preserve: lines(preserve), changes: lines(changes) });
          })}>精确区域修改</ButtonBase>
          {selected.length > 1 ? <p className="creation-notice">精确区域修改每次选择一个成果。</p> : null}
        </details>
      </div> : <p className="creation-notice">成果生成后将在这里分别显示保存、检查和采用状态。</p>}
      {creationError || notice ? <p className="creation-notice" role="status">{notice || creationError}</p> : null}
    </div>
  </details>;
}
