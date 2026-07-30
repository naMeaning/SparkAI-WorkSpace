import { useMemo, useState } from "react";
import { Boxes, Languages, ListChecks, Save, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  COMMERCE_LANGUAGES,
  COMMERCE_SET_LIMITS,
  COMMERCE_SET_MODES,
  DEFAULT_COMMERCE_LANGUAGE_CODES,
  commerceSetRequestCounts,
  commerceSetSnapshotMaterial,
  normalizeCommerceSetPlan,
  normalizeCommerceTargetLocales,
  resizeCommerceSetSlots,
  serializeCommerceSetSnapshotMaterial,
  type CommerceSetMode,
  type CommerceSetPlan,
  type CommerceSetRequestCounts,
  type CommerceSetSaveTarget,
  type CommerceSetSnapshotMaterial
} from "./plugins/commerce-set";
import {
  ActionButton,
  DialogShell,
  Field,
  InlineNotice,
  SegmentButton,
  SegmentedControl,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";

export type CommerceSetDialogSubmitPayload = {
  languageCodes: string[];
  plan: CommerceSetPlan;
  counts: CommerceSetRequestCounts;
  snapshotMaterial: CommerceSetSnapshotMaterial;
  snapshotJson: string;
};

export type CommerceSetDialogProps = {
  sourceCount: number;
  sourceLabel: string;
  sourceKeys?: readonly unknown[];
  executionBusy?: boolean;
  errorMessage?: string;
  initialMode?: CommerceSetMode;
  initialPlan?: unknown;
  allowModeSwitch?: boolean;
  allowPersistence?: boolean;
  close: () => void;
  submit: (payload: CommerceSetDialogSubmitPayload) => void;
};

const feeRiskCopy = {
  none: "当前计划没有可执行请求。",
  low: "请求量较小，但已被上游接受的请求仍可能计费。",
  medium: "请求量较多，建议先核对每组张数与语言数量，再确认执行。",
  high: "请求量较高，任何重复执行都可能产生明显费用；请仔细复核，并在需要复用时保存计划。",
  blocked: `请求量超过单次 ${COMMERCE_SET_LIMITS.maxTotalRequests} 个的安全上限，请减少母图、套图张数或目标语言。`
} as const;

function feeRiskTone(risk: CommerceSetRequestCounts["feeRisk"]): "neutral" | "info" | "warning" | "danger" {
  if (risk === "blocked") return "danger";
  if (risk === "high" || risk === "medium") return "warning";
  return risk === "low" ? "info" : "neutral";
}

export default function CommerceSetDialog({
  sourceCount,
  sourceLabel,
  sourceKeys,
  executionBusy = false,
  errorMessage = "",
  initialMode,
  initialPlan,
  allowModeSwitch = true,
  allowPersistence = true,
  close,
  submit
}: CommerceSetDialogProps) {
  const [plan, setPlan] = useState<CommerceSetPlan>(() => normalizeCommerceSetPlan({
    ...(initialPlan && typeof initialPlan === "object" ? initialPlan : {}),
    ...(initialMode ? { mode: initialMode } : {})
  }));
  const snapshotSources = sourceKeys ?? sourceCount;
  const counts = useMemo(() => commerceSetRequestCounts(plan, sourceCount), [plan, sourceCount]);
  const validationMessage = sourceCount <= 0
    ? "至少需要一个母图或已有商品图。"
    : plan.mode === "translate" && plan.targetLocales.length === 0
      ? "翻译模式至少选择一种目标语言。"
      : counts.exceedsRequestLimit
        ? feeRiskCopy.blocked
        : counts.totalRequests <= 0
          ? "当前计划没有生成任务。"
          : "";

  function updatePlan(patch: Partial<CommerceSetPlan>) {
    setPlan((current) => normalizeCommerceSetPlan({ ...current, ...patch }));
  }

  function changeMode(mode: CommerceSetMode) {
    setPlan((current) => normalizeCommerceSetPlan({
      ...current,
      mode,
      targetLocales: mode === "translate" && current.targetLocales.length === 0
        ? DEFAULT_COMMERCE_LANGUAGE_CODES
        : current.targetLocales
    }));
  }

  function toggleLanguage(code: string, checked: boolean) {
    setPlan((current) => normalizeCommerceSetPlan({
      ...current,
      targetLocales: checked
        ? normalizeCommerceTargetLocales([...current.targetLocales, code])
        : current.targetLocales.filter((locale) => locale.code !== code)
    }));
  }

  function updateLanguagePrompt(code: string, prompt: string) {
    updatePlan({
      targetLocales: plan.targetLocales.map((locale) => locale.code === code ? { ...locale, prompt } : locale)
    });
  }

  function updateSlot(index: number, patch: { title?: string; prompt?: string }) {
    updatePlan({
      slots: plan.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot)
    });
  }

  function changeSaveTarget(saveTarget: CommerceSetSaveTarget) {
    updatePlan({ saveTarget });
  }

  function submitPlan() {
    if (validationMessage || executionBusy) return;
    const normalized = normalizeCommerceSetPlan(plan);
    submit({
      languageCodes: normalized.targetLocales.map((locale) => locale.code),
      plan: normalized,
      counts: commerceSetRequestCounts(normalized, sourceCount),
      snapshotMaterial: commerceSetSnapshotMaterial(normalized, snapshotSources),
      snapshotJson: serializeCommerceSetSnapshotMaterial(normalized, snapshotSources)
    });
  }

  const modeDescription = COMMERCE_SET_MODES.find((mode) => mode.id === plan.mode)?.description || "";
  const localeGroupLabel = plan.mode === "generate" && plan.targetLocales.length === 0
    ? "沿用母图语言"
    : `${plan.targetLocales.length} 种语言`;
  const submitLabel = executionBusy
    ? "Agent 正在工作"
    : errorMessage
      ? "来源已变化，请重新配置"
      : counts.exceedsRequestLimit
        ? `超过 ${COMMERCE_SET_LIMITS.maxTotalRequests} 请求上限`
        : sourceCount <= 0
          ? "请选择至少一张母图"
          : plan.mode === "translate" && plan.targetLocales.length === 0
            ? "请选择目标语言"
            : counts.totalRequests <= 0
              ? "当前没有可执行请求"
              : `确认并执行 ${counts.totalRequests} 个请求`;

  return (
    <DialogShell surface="commerce-set" ariaLabel="跨境电商套图计划" className="commerce-set-dialog commerce-translation-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={plan.mode === "generate" ? "跨境电商套图生成计划" : "跨境电商套图翻译计划"}
            description="先确认输出矩阵、语言和费用边界，再交给 Agent 执行。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="commerce-set-body commerce-translation-body">
            <InlineNotice tone="info" icon={<Boxes size={15} />}>
              当前母图：{sourceLabel}，共 {counts.sourceCount} 个图片成果或容器。
            </InlineNotice>
            {errorMessage ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}

            {allowModeSwitch ? (
              <section className="commerce-set-section" aria-labelledby="commerce-set-mode-title">
                <div className="commerce-set-section-heading">
                  <div><strong id="commerce-set-mode-title">任务模式</strong><small>{modeDescription}</small></div>
                </div>
                <SegmentedControl className="commerce-set-mode-control" aria-label="套图任务模式">
                  {COMMERCE_SET_MODES.map((mode) => (
                    <SegmentButton key={mode.id} active={plan.mode === mode.id} onClick={() => changeMode(mode.id)}>
                      {mode.id === "generate" ? <Sparkles size={14} /> : <Languages size={14} />}
                      {mode.label}
                    </SegmentButton>
                  ))}
                </SegmentedControl>
              </section>
            ) : null}

            <section className="commerce-set-summary" aria-label="执行规模预览">
              <span><small>母图数</small><strong>{counts.sourceCount}</strong></span>
              <span><small>每组张数</small><strong>{counts.outputsPerGroup}</strong></span>
              <span><small>结果组</small><strong>{counts.groupCount}</strong></span>
              <span className={counts.feeRisk === "high" || counts.feeRisk === "blocked" ? "is-risk" : ""}>
                <small>总请求</small><strong>{counts.totalRequests}</strong>
              </span>
            </section>

            {plan.mode === "generate" ? (
              <section className="commerce-set-section" aria-labelledby="commerce-set-slots-title">
                <div className="commerce-set-section-heading commerce-set-slot-heading">
                  <div>
                    <strong id="commerce-set-slots-title">套图槽位</strong>
                    <small>每个母图按相同槽位生成一组；标题与 Prompt 可逐张修改。</small>
                  </div>
                  <label>
                    <span>整套张数</span>
                    <input
                      type="number"
                      min={COMMERCE_SET_LIMITS.minSlots}
                      max={COMMERCE_SET_LIMITS.maxSlots}
                      value={plan.slots.length}
                      onChange={(event) => updatePlan({ slots: resizeCommerceSetSlots(plan.slots, event.target.value) })}
                    />
                  </label>
                </div>
                <div className="commerce-set-slot-list">
                  {plan.slots.map((slot, index) => (
                    <article key={slot.id} className="commerce-set-slot-card">
                      <span className="commerce-set-slot-number">{String(index + 1).padStart(2, "0")}</span>
                      <Field label="图片标题" hint={`${slot.title.length}/${COMMERCE_SET_LIMITS.maxSlotTitleLength}`}>
                        <input
                          value={slot.title}
                          maxLength={COMMERCE_SET_LIMITS.maxSlotTitleLength}
                          onChange={(event) => updateSlot(index, { title: event.target.value })}
                        />
                      </Field>
                      <Field className="commerce-set-slot-prompt" label="图片 Prompt" hint={`${slot.prompt.length}/${COMMERCE_SET_LIMITS.maxSlotPromptLength}`}>
                        <textarea
                          value={slot.prompt}
                          maxLength={COMMERCE_SET_LIMITS.maxSlotPromptLength}
                          rows={3}
                          onChange={(event) => updateSlot(index, { prompt: event.target.value })}
                        />
                      </Field>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <section className="commerce-set-section" aria-labelledby="commerce-set-translate-title">
                <div className="commerce-set-section-heading">
                  <div>
                    <strong id="commerce-set-translate-title">翻译总要求</strong>
                    <small>应用于每一张母图；逐语言提示可在下方继续补充。</small>
                  </div>
                </div>
                <Field label="保留与翻译规则" hint={`${plan.translatePrompt.length}/${COMMERCE_SET_LIMITS.maxTranslatePromptLength}`}>
                  <textarea
                    value={plan.translatePrompt}
                    maxLength={COMMERCE_SET_LIMITS.maxTranslatePromptLength}
                    rows={4}
                    onChange={(event) => updatePlan({ translatePrompt: event.target.value })}
                  />
                </Field>
              </section>
            )}

            <section className="commerce-set-section" aria-labelledby="commerce-set-languages-title">
              <div className="commerce-set-section-heading commerce-language-header">
                <div>
                  <strong id="commerce-set-languages-title">{plan.mode === "translate" ? "目标语言" : "输出语言（可选）"}</strong>
                  <small>{plan.mode === "generate" ? "不选择时沿用母图语言；选择后每种语言分别生成完整一组。" : "每种语言建立独立结果组。"}</small>
                </div>
                <span>{plan.targetLocales.length}/{COMMERCE_SET_LIMITS.maxTargetLanguages}</span>
              </div>
              <div className="commerce-language-grid" role="group" aria-label="目标语言多选">
                {COMMERCE_LANGUAGES.map((language) => {
                  const checked = plan.targetLocales.some((locale) => locale.code === language.code);
                  const limitReached = !checked && plan.targetLocales.length >= COMMERCE_SET_LIMITS.maxTargetLanguages;
                  return (
                    <label key={language.code} className={`commerce-language-option ${checked ? "selected" : ""}`} dir={language.direction}>
                      <input type="checkbox" checked={checked} disabled={limitReached} onChange={(event) => toggleLanguage(language.code, event.target.checked)} />
                      <span>
                        <strong>{language.label}</strong>
                        <small>{language.nativeLabel}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              {plan.targetLocales.length ? (
                <details className="commerce-language-prompts">
                  <summary><span>逐语言提示</span><small>{plan.targetLocales.length} 项</small></summary>
                  <div>
                    {plan.targetLocales.map((locale) => {
                      const language = COMMERCE_LANGUAGES.find((candidate) => candidate.code === locale.code);
                      return (
                        <Field key={locale.code} label={`${language?.label || locale.code} · ${locale.code}`} hint={`${locale.prompt.length}/${COMMERCE_SET_LIMITS.maxLanguagePromptLength}`}>
                          <textarea
                            dir={language?.direction || "ltr"}
                            value={locale.prompt}
                            maxLength={COMMERCE_SET_LIMITS.maxLanguagePromptLength}
                            rows={2}
                            onChange={(event) => updateLanguagePrompt(locale.code, event.target.value)}
                          />
                        </Field>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </section>

            {allowPersistence ? (
              <section className="commerce-set-section" aria-labelledby="commerce-set-save-title">
                <div className="commerce-set-section-heading">
                  <div>
                    <strong id="commerce-set-save-title">复用方式</strong>
                    <small>执行时可同时把结构化套图计划保存为画布 Requirement 或 Skill。</small>
                  </div>
                </div>
                <SegmentedControl className="commerce-set-save-control" aria-label="套图计划保存方式">
                  <SegmentButton active={plan.saveTarget === "none"} onClick={() => changeSaveTarget("none")}>仅本次</SegmentButton>
                  <SegmentButton active={plan.saveTarget === "requirement"} onClick={() => changeSaveTarget("requirement")}>Requirement</SegmentButton>
                  <SegmentButton active={plan.saveTarget === "skill"} onClick={() => changeSaveTarget("skill")}>Skill</SegmentButton>
                </SegmentedControl>
                {plan.saveTarget !== "none" ? (
                  <Field label={plan.saveTarget === "skill" ? "Skill 名称" : "Requirement 名称"} hint={`${plan.reusableName.length}/${COMMERCE_SET_LIMITS.maxPlanTitleLength}`}>
                    <input
                      value={plan.reusableName}
                      maxLength={COMMERCE_SET_LIMITS.maxPlanTitleLength}
                      onChange={(event) => updatePlan({ reusableName: event.target.value })}
                    />
                  </Field>
                ) : null}
              </section>
            ) : null}

            <section className="commerce-set-section commerce-set-execution" aria-labelledby="commerce-set-execution-title">
              <div className="commerce-set-section-heading">
                <div>
                  <strong id="commerce-set-execution-title">执行前确认</strong>
                  <small>{localeGroupLabel} · 预计最多 {counts.estimatedBillableRequests} 个可计费请求</small>
                </div>
              </div>
              <InlineNotice tone="info" icon={<ListChecks size={15} />}>
                执行计划：先串行测试最多 {counts.probeRequests} 个不同母图的代表请求（实际数量受当前并发与母图数限制），确认落盘、完整解码和尺寸有效后，再按每波最多翻倍、且不超过用户配置并发的方式逐级放量；探测失败时不派发剩余请求。
              </InlineNotice>
              <InlineNotice tone={feeRiskTone(counts.feeRisk)} icon={<ShieldAlert size={15} />}>
                {feeRiskCopy[counts.feeRisk]}
              </InlineNotice>
              {validationMessage && validationMessage !== feeRiskCopy[counts.feeRisk]
                ? <InlineNotice tone="danger">{validationMessage}</InlineNotice>
                : null}
            </section>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton variant="ghost" onClick={() => requestClose("action")}>取消</ActionButton>
            {allowPersistence && plan.saveTarget !== "none" ? (
              <span className="commerce-set-save-summary"><Save size={13} /> 将保存为 {plan.saveTarget === "skill" ? "Skill" : "Requirement"}</span>
            ) : null}
            <ActionButton
              className="commerce-set-submit"
              variant="primary"
              busy={executionBusy}
              disabled={Boolean(validationMessage || errorMessage)}
              icon={<Send size={16} />}
              onClick={submitPlan}
            >
              {submitLabel}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
