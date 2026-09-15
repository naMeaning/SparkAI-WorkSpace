import { useMemo, useState } from "react";
import { Clapperboard, ImageIcon, Send, ShieldCheck, Sparkles, Subtitles } from "lucide-react";

import type { SocialContentPlan, SocialPlatform } from "./core";
import {
  SOCIAL_CONTENT_KINDS,
  SOCIAL_CONTENT_LIMITS,
  SOCIAL_DOUYIN_DURATIONS,
  SOCIAL_DOUYIN_FORMATS,
  SOCIAL_XIAOHONGSHU_RATIOS,
  normalizeDouyinPlan,
  normalizeSocialContentPlan,
  normalizeXiaohongshuPlan
} from "./plugins/social-content";
import {
  ActionButton,
  ButtonBase,
  DeferredNumberInput,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog
} from "./ui";

import "./styles/04g-social-content-dialog.css";

export type SocialContentSourceItem = {
  key: string;
  label: string;
  previewUrl?: string;
};

export type SocialContentDialogProps = {
  initialPlatform: SocialPlatform;
  initialPlan?: SocialContentPlan;
  sourceItems?: readonly SocialContentSourceItem[];
  firstUse?: boolean;
  executionBusy?: boolean;
  errorMessage?: string;
  close: () => void;
  submit: (plan: SocialContentPlan) => void;
};

function planForPlatform(platform: SocialPlatform, current?: SocialContentPlan): SocialContentPlan {
  const shared = current ? {
    brief: current.brief,
    audience: current.audience,
    objective: current.objective,
    language: current.language
  } : {};
  return platform === "douyin" ? normalizeDouyinPlan(shared) : normalizeXiaohongshuPlan(shared);
}

export default function SocialContentDialog({
  initialPlatform,
  initialPlan,
  sourceItems = [],
  firstUse = false,
  executionBusy = false,
  errorMessage = "",
  close,
  submit
}: SocialContentDialogProps) {
  const [plan, setPlan] = useState<SocialContentPlan>(() => initialPlan
    ? normalizeSocialContentPlan(initialPlan)
    : planForPlatform(initialPlatform));
  const [touched, setTouched] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const expectedImages = plan.platform === "xiaohongshu"
    ? plan.cardCount + (plan.cover.enabled ? 1 : 0)
    : plan.shotCount + 1;
  const validationMessage = !plan.brief.trim() ? "请先说明这次内容主要介绍什么。" : "";
  const sourceSummary = useMemo(() => sourceItems.length
    ? `使用当前选中的 ${sourceItems.length} 个图片素材范围`
    : "不绑定原图，Agent 将按 Brief 从文字开始创作", [sourceItems.length]);

  function changePlatform(platform: SocialPlatform) {
    if (platform === plan.platform) return;
    setPlan(planForPlatform(platform, plan));
    setTouched(true);
  }

  function updateShared(patch: Partial<Pick<SocialContentPlan, "brief" | "audience" | "objective" | "language">>) {
    setPlan((current) => normalizeSocialContentPlan({ ...current, ...patch }));
    setTouched(true);
  }

  function submitPlan() {
    setTouched(true);
    if (validationMessage || executionBusy) return;
    submit(normalizeSocialContentPlan(plan));
  }

  function requestDialogClose() {
    if (executionBusy) return;
    if (touched) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  return (
    <>
      <DialogShell
        surface="social-content"
        ariaLabel="社媒内容工作流"
        className="social-content-dialog"
        busy={executionBusy}
        dirty={touched}
        closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle", action: "when-idle" }}
        onRequestClose={requestDialogClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader
            eyebrow="SOCIAL STUDIO"
            title={plan.platform === "xiaohongshu" ? "新建小红书图文" : "新建抖音短视频"}
            description="先确定内容方向和交付规模，再由项目 Agent 完成文案与视觉成果。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="social-content-body">
            <div className="social-platform-switch" role="tablist" aria-label="社媒平台">
              <ButtonBase className={plan.platform === "xiaohongshu" ? "active" : ""} aria-pressed={plan.platform === "xiaohongshu"} onClick={() => changePlatform("xiaohongshu")}>
                <Sparkles size={16} /><span><strong>小红书图文</strong><small>标题、正文、封面与卡片</small></span>
              </ButtonBase>
              <ButtonBase className={plan.platform === "douyin" ? "active" : ""} aria-pressed={plan.platform === "douyin"} onClick={() => changePlatform("douyin")}>
                <Clapperboard size={16} /><span><strong>抖音短视频</strong><small>Hook、脚本、分镜与视频</small></span>
              </ButtonBase>
            </div>

            {firstUse ? (
              <InlineNotice tone="info" icon={<ShieldCheck size={16} />}>
                这是第一次使用该工作流。只需填写关键方向；缺少真正影响结果的信息时，Agent 会一次只追问一个问题。
              </InlineNotice>
            ) : null}
            {errorMessage ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}

            <section className="social-content-section social-brief-section">
              <Field label="内容 Brief" hint={`${plan.brief.length}/${SOCIAL_CONTENT_LIMITS.maxBriefLength}`} error={touched && !plan.brief.trim() ? validationMessage : undefined}>
                <textarea
                  data-autofocus
                  rows={4}
                  maxLength={SOCIAL_CONTENT_LIMITS.maxBriefLength}
                  value={plan.brief}
                  placeholder={plan.platform === "xiaohongshu" ? "例如：分享夏季通勤防晒经验，希望读者收藏并尝试。" : "例如：30 秒展示新品咖啡杯，突出杯口设计和保温体验。"}
                  onChange={(event) => updateShared({ brief: event.target.value })}
                />
              </Field>
              <div className="social-content-field-grid">
                <Field label="目标读者" hint="可留空，由 Agent 合理推断">
                  <input value={plan.audience} maxLength={SOCIAL_CONTENT_LIMITS.maxAudienceLength} placeholder="例如：20–35 岁通勤人群" onChange={(event) => updateShared({ audience: event.target.value })} />
                </Field>
                <Field label="希望读者做什么" hint="可留空">
                  <input value={plan.objective} maxLength={SOCIAL_CONTENT_LIMITS.maxObjectiveLength} placeholder="例如：收藏、咨询或了解产品" onChange={(event) => updateShared({ objective: event.target.value })} />
                </Field>
              </div>
            </section>

            {plan.platform === "xiaohongshu" ? (
              <section className="social-content-section">
                <div className="social-content-field-grid three">
                  <Field label="内容类型">
                    <select value={plan.contentKind} onChange={(event) => { setPlan(normalizeXiaohongshuPlan({ ...plan, contentKind: event.target.value })); setTouched(true); }}>
                      {SOCIAL_CONTENT_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </Field>
                  <Field label="画面比例">
                    <select value={plan.ratio} onChange={(event) => { setPlan(normalizeXiaohongshuPlan({ ...plan, ratio: event.target.value })); setTouched(true); }}>
                      {SOCIAL_XIAOHONGSHU_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                    </select>
                  </Field>
                  <Field label="卡片数量" hint="支持 6–9 页">
                    <DeferredNumberInput min={SOCIAL_CONTENT_LIMITS.minXiaohongshuCards} max={SOCIAL_CONTENT_LIMITS.maxXiaohongshuCards} value={plan.cardCount} onValueChange={(cardCount) => { setPlan(normalizeXiaohongshuPlan({ ...plan, cardCount })); setTouched(true); }} />
                  </Field>
                </div>
                <label className="social-content-toggle">
                  <input type="checkbox" checked={plan.cover.enabled} onChange={(event) => { setPlan(normalizeXiaohongshuPlan({ ...plan, cover: { ...plan.cover, enabled: event.target.checked } })); setTouched(true); }} />
                  <span><ImageIcon size={15} /><strong>生成封面</strong><small>默认开启；封面与卡片分别归档</small></span>
                </label>
              </section>
            ) : (
              <section className="social-content-section">
                <div className="social-content-field-grid four">
                  <Field label="视频形式">
                    <select value={plan.format} onChange={(event) => { setPlan(normalizeDouyinPlan({ ...plan, format: event.target.value })); setTouched(true); }}>
                      {SOCIAL_DOUYIN_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </Field>
                  <Field label="画面比例" hint="固定竖屏">
                    <input aria-label="抖音画面比例" value={plan.ratio} readOnly />
                  </Field>
                  <Field label="时长">
                    <select value={plan.durationSeconds} onChange={(event) => { setPlan(normalizeDouyinPlan({ ...plan, durationSeconds: Number(event.target.value) })); setTouched(true); }}>
                      {SOCIAL_DOUYIN_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
                    </select>
                  </Field>
                  <Field label="分镜数量" hint="支持 5–8 镜">
                    <DeferredNumberInput min={SOCIAL_CONTENT_LIMITS.minDouyinShots} max={SOCIAL_CONTENT_LIMITS.maxDouyinShots} value={plan.shotCount} onValueChange={(shotCount) => { setPlan(normalizeDouyinPlan({ ...plan, shotCount })); setTouched(true); }} />
                  </Field>
                </div>
                <label className="social-content-toggle">
                  <input type="checkbox" checked={plan.subtitlesEnabled} onChange={(event) => { setPlan(normalizeDouyinPlan({ ...plan, subtitlesEnabled: event.target.checked })); setTouched(true); }} />
                  <span><Subtitles size={15} /><strong>生成字幕文本</strong><small>默认开启，进入发布包与剪辑素材目录</small></span>
                </label>
              </section>
            )}

            <section className="social-source-summary" aria-label="本次素材范围">
              <div><strong>素材范围</strong><small>{sourceSummary}</small></div>
              {sourceItems.length ? (
                <div className="social-source-strip">
                  {sourceItems.slice(0, 8).map((item) => (
                    <span key={item.key} title={item.label}>{item.previewUrl ? <img src={item.previewUrl} alt="" /> : <ImageIcon size={14} />}</span>
                  ))}
                  {sourceItems.length > 8 ? <em>+{sourceItems.length - 8}</em> : null}
                </div>
              ) : null}
            </section>

            <InlineNotice tone="warning">
              本次预计生成约 {expectedImages} 张视觉素材{plan.platform === "douyin" ? "，后续还可能创建 1 个视频任务" : ""}。点击执行即授权调用当前 Base URL；软件不再弹出二次费用确认。
            </InlineNotice>
          </SurfaceBody>
          <SurfaceFooter leading={<span className="social-content-footer-summary">{plan.platform === "xiaohongshu" ? `${plan.cardCount} 页图文` : `${plan.durationSeconds} 秒 · ${plan.shotCount} 镜`} · {expectedImages} 张素材</span>}>
            <ActionButton variant="ghost" onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" icon={<Send size={15} />} busy={executionBusy} disabled={Boolean(validationMessage)} onClick={submitPlan}>创建并交给 Agent</ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="social-content-unsaved"
          ariaLabel="放弃社媒计划修改"
          title="要放弃这次社媒计划吗？"
          description="当前 Brief、平台和交付规模尚未提交给 Agent。"
          detail={<p>这类执行草稿没有独立保存记录；继续编辑可以保留当前内容，放弃后将回到工作台。</p>}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={() => {
            setClosePromptOpen(false);
            close();
          }}
          discardLabel="放弃计划"
        />
      ) : null}
    </>
  );
}
