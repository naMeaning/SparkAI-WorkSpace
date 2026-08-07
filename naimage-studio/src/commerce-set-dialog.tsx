import { useMemo, useState } from "react";
import { BookMarked, Boxes, Copy, Eye, ImageIcon, Languages, ListChecks, PencilLine, Save, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  COMMERCE_LANGUAGES,
  COMMERCE_SET_LIMITS,
  COMMERCE_SET_MODES,
  COMMERCE_SET_PLATFORM_TEMPLATES,
  DEFAULT_COMMERCE_LANGUAGE_CODES,
  commerceSetSlotsForPlatform,
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
  ButtonBase,
  DeferredNumberInput,
  DialogShell,
  Field,
  InlineNotice,
  SegmentButton,
  SegmentedControl,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";

export type CommerceSetSourceItem = {
  key: string;
  label: string;
  previewUrl?: string;
  nodeId?: string;
  assetIndex?: number;
};

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
  sourceItems?: readonly CommerceSetSourceItem[];
  executionBusy?: boolean;
  errorMessage?: string;
  initialMode?: CommerceSetMode;
  initialPlan?: unknown;
  allowModeSwitch?: boolean;
  allowPersistence?: boolean;
  close: () => void;
  viewTemplate?: (templateId: string) => void;
  onFocusSource?: (source: CommerceSetSourceItem) => void;
  submit: (payload: CommerceSetDialogSubmitPayload) => void;
};

type TemplateSaveConflict = {
  id: string;
  title: string;
  source: "built-in" | "personal";
  currentRevision: number;
  suggestedCopyTitle?: string;
};

const feeRiskCopy = {
  none: "当前计划没有可执行请求。",
  low: "请求量较小，将先完成代表项测试，再继续执行。",
  medium: "请求量较多，将按小批量探测结果逐步放量。",
  high: "请求量较高，将严格分批执行；探测失败时停止尚未派发的请求。",
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
  sourceItems,
  executionBusy = false,
  errorMessage = "",
  initialMode,
  initialPlan,
  allowModeSwitch = true,
  allowPersistence = true,
  close,
  viewTemplate,
  onFocusSource,
  submit
}: CommerceSetDialogProps) {
  const [plan, setPlan] = useState<CommerceSetPlan>(() => normalizeCommerceSetPlan({
    ...(initialPlan && typeof initialPlan === "object" ? initialPlan : {}),
    ...(initialMode ? { mode: initialMode } : {})
  }));
  const [activeTranslationCell, setActiveTranslationCell] = useState<{ sourceIndex: number; localeCode: string } | null>(null);
  const [templateSaveBusy, setTemplateSaveBusy] = useState(false);
  const [templateSaveNotice, setTemplateSaveNotice] = useState<{ tone: "success" | "danger"; text: string; templateId?: string } | null>(null);
  const [templateSaveConflict, setTemplateSaveConflict] = useState<TemplateSaveConflict | null>(null);
  const snapshotSources = sourceKeys ?? sourceCount;
  const matrixSources = useMemo<CommerceSetSourceItem[]>(() => {
    if (sourceItems?.length === sourceCount) return sourceItems.map((item) => ({ ...item }));
    const keys = Array.isArray(sourceKeys) ? sourceKeys : [];
    return Array.from({ length: sourceCount }, (_item, index) => ({
      key: String(keys[index] || `source-${index + 1}`),
      label: `来源图 ${index + 1}`
    }));
  }, [sourceCount, sourceItems, sourceKeys]);
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

  function changePlatformTemplate(platformTemplateId: CommerceSetPlan["platformTemplateId"]) {
    const template = COMMERCE_SET_PLATFORM_TEMPLATES.find((candidate) => candidate.id === platformTemplateId);
    if (!template) return;
    setPlan((current) => {
      const title = platformTemplateId === "general" ? "跨境电商商品套图" : `${template.label} 商品套图`;
      return normalizeCommerceSetPlan({
        ...current,
        platformTemplateId,
        title,
        reusableName: current.reusableName === current.title ? title : current.reusableName,
        slots: commerceSetSlotsForPlatform(platformTemplateId)
      });
    });
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

  function updateTranslationItem(sourceIndex: number, localeCode: string, prompt: string) {
    setPlan((current) => normalizeCommerceSetPlan({
      ...current,
      translationItems: [
        ...current.translationItems.filter((item) => item.sourceIndex !== sourceIndex || item.localeCode !== localeCode),
        ...(prompt.trim() ? [{ sourceIndex, localeCode, prompt }] : [])
      ]
    }));
  }

  async function saveToTemplateMarket(conflictPolicy?: "overwrite" | "copy") {
    const saveTemplate = window.naimageConfig?.saveCommerceTemplate;
    if (!saveTemplate) {
      setTemplateSaveNotice({ tone: "danger", text: "当前桌面运行时未提供套图模板市场，请重启应用后再试。" });
      return;
    }
    setTemplateSaveBusy(true);
    setTemplateSaveNotice(null);
    try {
      const title = plan.reusableName.trim() || plan.title;
      const result = await saveTemplate({
        ...(conflictPolicy === "overwrite" && templateSaveConflict?.source === "personal"
          ? {
              id: templateSaveConflict.id,
              expectedRevision: templateSaveConflict.currentRevision,
              conflictPolicy: "overwrite" as const
            }
          : conflictPolicy === "copy"
            ? { conflictPolicy: "copy" as const }
            : {}),
        title,
        description: `${selectedPlatformTemplate.label} · ${plan.mode === "generate" ? `${plan.slots.length} 张套图` : `${plan.targetLocales.length} 种语言`}`,
        plan
      });
      if (!result?.ok || !result.entry) {
        if (result?.errorCode === "TEMPLATE_NAME_CONFLICT") {
          const details = result.details || {};
          const id = String(details.id || "");
          const source = details.source === "built-in" ? "built-in" : "personal";
          const currentRevision = Math.max(1, Math.floor(Number(details.currentRevision) || 1));
          setTemplateSaveConflict({
            id,
            title: String(details.title || title),
            source,
            currentRevision,
            suggestedCopyTitle: String(details.suggestedCopyTitle || "") || undefined
          });
          return;
        }
        throw new Error(result?.error || "保存套图模板失败。");
      }
      setTemplateSaveConflict(null);
      setTemplateSaveNotice({ tone: "success", text: `已保存到模板市场：${result.entry.title}`, templateId: result.entry.id });
    } catch (cause) {
      setTemplateSaveNotice({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setTemplateSaveBusy(false);
    }
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
  const selectedPlatformTemplate = COMMERCE_SET_PLATFORM_TEMPLATES.find((template) => template.id === plan.platformTemplateId)
    ?? COMMERCE_SET_PLATFORM_TEMPLATES[0];
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
            description="确认输出矩阵与语言后，将直接交给 Agent 分批执行。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="commerce-set-body commerce-translation-body">
            <InlineNotice tone="info" icon={<Boxes size={15} />}>
              当前母图：{sourceLabel}，共 {counts.sourceCount} 个图片成果或容器。
            </InlineNotice>
            {matrixSources.length ? (
              <div className="commerce-set-source-strip" aria-label="本次母图预览">
                {matrixSources.slice(0, 12).map((source, index) => (
                  <ButtonBase
                    key={source.key}
                    type="button"
                    disabled={!source.nodeId || !onFocusSource}
                    aria-label={`在画布中定位${source.label}`}
                    title={`${source.label} · 点击后在画布中选中并聚焦`}
                    onClick={() => onFocusSource?.(source)}
                  >
                    <span>{source.previewUrl ? <img src={source.previewUrl} alt="" draggable={false} /> : <ImageIcon size={16} />}</span>
                    <small>{index + 1}</small>
                  </ButtonBase>
                ))}
                {matrixSources.length > 12 ? <span className="commerce-set-source-more">+{matrixSources.length - 12}</span> : null}
              </div>
            ) : null}
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

            {(
              <section className="commerce-set-section" aria-labelledby="commerce-set-platform-title">
                <div className="commerce-set-section-heading">
                  <div>
                    <strong id="commerce-set-platform-title">平台模板</strong>
                    <small>{plan.mode === "generate"
                      ? "选择后载入完整套图槽位，仍可继续修改整套张数和每张 Prompt。"
                      : "标记本地化的目标平台；切回生成模式时沿用该平台的完整套图。"}</small>
                  </div>
                </div>
                <SegmentedControl className="commerce-set-platform-control" aria-label="套图平台模板">
                  {COMMERCE_SET_PLATFORM_TEMPLATES.map((template) => (
                    <SegmentButton
                      key={template.id}
                      active={plan.platformTemplateId === template.id}
                      onClick={() => changePlatformTemplate(template.id)}
                    >
                      {template.label}
                    </SegmentButton>
                  ))}
                </SegmentedControl>
                <p className="commerce-set-platform-summary">
                  <strong>{plan.mode === "generate" ? `${selectedPlatformTemplate.slots.length} 张默认套图` : `${selectedPlatformTemplate.label} 本地化`}</strong>
                  <span>{selectedPlatformTemplate.description}</span>
                </p>
              </section>
            )}

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
                    <DeferredNumberInput
                      min={COMMERCE_SET_LIMITS.minSlots}
                      max={COMMERCE_SET_LIMITS.maxSlots}
                      value={plan.slots.length}
                      onValueChange={(value) => updatePlan({ slots: resizeCommerceSetSlots(plan.slots, value, plan.platformTemplateId) })}
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

            {plan.mode === "translate" && plan.targetLocales.length ? (
              <section className="commerce-set-section commerce-translation-matrix-section" aria-labelledby="commerce-translation-matrix-title">
                <div className="commerce-set-section-heading commerce-translation-matrix-heading">
                  <div>
                    <strong id="commerce-translation-matrix-title">图片 × 语言翻译矩阵</strong>
                    <small>{counts.totalRequests} 个待生成单元格，逐项要求会随对应图片和语言执行。</small>
                  </div>
                  <span>{plan.translationItems.length} 项已定制</span>
                </div>
                <div className="commerce-translation-matrix-scroll">
                  <table className="commerce-translation-matrix" style={{ minWidth: `${176 + plan.targetLocales.length * 132}px` }}>
                    <thead>
                      <tr>
                        <th scope="col">来源图片</th>
                        {plan.targetLocales.map((locale) => {
                          const language = COMMERCE_LANGUAGES.find((candidate) => candidate.code === locale.code);
                          return <th scope="col" key={locale.code}><strong>{language?.label || locale.code}</strong><small>{locale.code}</small></th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {matrixSources.map((source, sourceIndex) => (
                        <tr key={source.key}>
                          <th scope="row">
                            <ButtonBase
                              type="button"
                              className="commerce-translation-source-preview"
                              disabled={!source.nodeId || !onFocusSource}
                              aria-label={`在画布中定位${source.label}`}
                              title="在画布中选中并聚焦这张原图"
                              onClick={() => onFocusSource?.(source)}
                            >
                              {source.previewUrl ? <img src={source.previewUrl} alt="" draggable={false} /> : <ImageIcon size={15} />}
                            </ButtonBase>
                            <span><strong>{source.label}</strong><small>图片 {sourceIndex + 1}</small></span>
                          </th>
                          {plan.targetLocales.map((locale) => {
                            const customPrompt = plan.translationItems.find((item) => item.sourceIndex === sourceIndex && item.localeCode === locale.code)?.prompt || "";
                            const active = activeTranslationCell?.sourceIndex === sourceIndex && activeTranslationCell.localeCode === locale.code;
                            return (
                              <td key={locale.code}>
                                <ButtonBase
                                  type="button"
                                  className={`commerce-translation-cell ${active ? "active" : ""} ${customPrompt ? "custom" : ""}`}
                                  aria-pressed={active}
                                  aria-label={`编辑${source.label}的${locale.code}翻译要求`}
                                  onClick={() => setActiveTranslationCell({ sourceIndex, localeCode: locale.code })}
                                >
                                  <span><strong>待生成</strong><small>{customPrompt ? "有逐项要求" : "使用通用要求"}</small></span>
                                  <PencilLine size={13} />
                                </ButtonBase>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activeTranslationCell && matrixSources[activeTranslationCell.sourceIndex] && plan.targetLocales.some((locale) => locale.code === activeTranslationCell.localeCode) ? (
                  <div className="commerce-translation-cell-editor">
                    <div>
                      <strong>{matrixSources[activeTranslationCell.sourceIndex].label}</strong>
                      <small>{COMMERCE_LANGUAGES.find((language) => language.code === activeTranslationCell.localeCode)?.label || activeTranslationCell.localeCode} · {activeTranslationCell.localeCode}</small>
                    </div>
                    <Field
                      label="逐项翻译要求"
                      hint={`${plan.translationItems.find((item) => item.sourceIndex === activeTranslationCell.sourceIndex && item.localeCode === activeTranslationCell.localeCode)?.prompt.length || 0}/${COMMERCE_SET_LIMITS.maxTranslationItemPromptLength}`}
                    >
                      <textarea
                        value={plan.translationItems.find((item) => item.sourceIndex === activeTranslationCell.sourceIndex && item.localeCode === activeTranslationCell.localeCode)?.prompt || ""}
                        maxLength={COMMERCE_SET_LIMITS.maxTranslationItemPromptLength}
                        rows={3}
                        placeholder="例如：只翻译顶部标题；底部尺寸表保留英文单位。"
                        onChange={(event) => updateTranslationItem(activeTranslationCell.sourceIndex, activeTranslationCell.localeCode, event.target.value)}
                      />
                    </Field>
                  </div>
                ) : null}
              </section>
            ) : null}

            {allowPersistence ? (
              <section className="commerce-set-section" aria-labelledby="commerce-set-save-title">
                <div className="commerce-set-section-heading">
                  <div>
                    <strong id="commerce-set-save-title">执行后保存到画布</strong>
                    <small>这里创建可再次执行的需求节点或 Skill 节点；与下方“保存到模板市场”是两种不同的保存方式。</small>
                  </div>
                </div>
                <SegmentedControl className="commerce-set-save-control" aria-label="套图计划保存方式">
                  <SegmentButton active={plan.saveTarget === "none"} onClick={() => changeSaveTarget("none")}>仅执行</SegmentButton>
                  <SegmentButton active={plan.saveTarget === "requirement"} onClick={() => changeSaveTarget("requirement")}>需求节点</SegmentButton>
                  <SegmentButton active={plan.saveTarget === "skill"} onClick={() => changeSaveTarget("skill")}>Skill 节点</SegmentButton>
                </SegmentedControl>
                {plan.saveTarget !== "none" ? (
                  <Field label={plan.saveTarget === "skill" ? "Skill 节点名称" : "需求节点名称"} hint={`${plan.reusableName.length}/${COMMERCE_SET_LIMITS.maxPlanTitleLength}`}>
                    <input
                      value={plan.reusableName}
                      maxLength={COMMERCE_SET_LIMITS.maxPlanTitleLength}
                      onChange={(event) => updatePlan({ reusableName: event.target.value })}
                    />
                  </Field>
                ) : null}
                {templateSaveConflict ? (
                  <InlineNotice className="commerce-template-save-feedback" tone="warning">
                    <span>
                      已存在同名模板“{templateSaveConflict.title}”。
                      {templateSaveConflict.suggestedCopyTitle ? ` 另存时将命名为“${templateSaveConflict.suggestedCopyTitle}”。` : ""}
                    </span>
                    <span className="commerce-template-save-actions">
                      {templateSaveConflict.source === "personal" ? (
                        <ButtonBase disabled={templateSaveBusy} onClick={() => void saveToTemplateMarket("overwrite")}>覆盖原模板</ButtonBase>
                      ) : null}
                      <ButtonBase disabled={templateSaveBusy} onClick={() => void saveToTemplateMarket("copy")}><Copy size={13} />另存副本</ButtonBase>
                    </span>
                  </InlineNotice>
                ) : null}
                {templateSaveNotice ? (
                  <InlineNotice className="commerce-template-save-feedback" tone={templateSaveNotice.tone}>
                    <span>{templateSaveNotice.text}</span>
                    {templateSaveNotice.templateId && viewTemplate ? (
                      <ButtonBase onClick={() => viewTemplate(templateSaveNotice.templateId!)}><Eye size={13} />立即查看模板</ButtonBase>
                    ) : null}
                  </InlineNotice>
                ) : null}
              </section>
            ) : null}

            <section className="commerce-set-section commerce-set-execution" aria-labelledby="commerce-set-execution-title">
              <div className="commerce-set-section-heading">
                <div>
                  <strong id="commerce-set-execution-title">执行前确认</strong>
                  <small>{localeGroupLabel} · 共 {counts.totalRequests} 个上游请求</small>
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
            {allowPersistence ? (
              <ActionButton
                variant="secondary"
                busy={templateSaveBusy}
                disabled={executionBusy}
                icon={<BookMarked size={14} />}
                onClick={() => void saveToTemplateMarket()}
              >
                保存到模板市场
              </ActionButton>
            ) : null}
            {allowPersistence && plan.saveTarget !== "none" ? (
              <span className="commerce-set-save-summary"><Save size={13} /> 执行后创建{plan.saveTarget === "skill" ? " Skill 节点" : "需求节点"}</span>
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
