import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  GraduationCap,
  ImagePlus,
  Loader2,
  PackageCheck,
  PartyPopper,
  Play,
  Settings,
  ShoppingBag,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

import { ButtonBase } from "./ui";
import type { WorkspaceDomain } from "./core";
import "./styles/04i-commerce-tutorial.css";

export type CommerceTutorialStage = "welcome" | "import" | "select" | "workspace" | "tool" | "agent" | "consent" | "running" | "complete";

export const COMMERCE_TUTORIAL_AGENT_PROMPT = "请基于当前选中的商品母图，为 Amazon 生成一套 7 张上架套图：1 张纯白主图、2 张卖点图、2 张真实使用场景图、1 张尺寸信息图、1 张包装清单图。保持商品外观、颜色、Logo 和结构一致，文案简洁，先说明你的套图计划再执行。";

export type CommerceTutorialSnapshot = {
  imageCount: number;
  initialImageCount: number;
  selectedImageCount: number;
  workspaceDomain: WorkspaceDomain;
  agentExecutionBusy: boolean;
  commerceResultCount: number;
  baselineResultCount: number;
};

export function resolveCommerceTutorialStage(stage: CommerceTutorialStage, snapshot: CommerceTutorialSnapshot): CommerceTutorialStage {
  if (snapshot.commerceResultCount > snapshot.baselineResultCount) return "complete";
  if (snapshot.agentExecutionBusy && (stage === "tool" || stage === "agent" || stage === "consent")) return "running";
  if (stage === "import" && snapshot.imageCount > snapshot.initialImageCount) return "select";
  if (stage === "select" && snapshot.selectedImageCount > 0) return "workspace";
  if (stage === "workspace" && snapshot.workspaceDomain === "commerce") return "tool";
  return stage;
}

type TutorialProgress = {
  stage: CommerceTutorialStage;
  initialImageCount: number;
  baselineResultCount: number;
};

const TUTORIAL_STAGES = new Set<CommerceTutorialStage>(["welcome", "import", "select", "workspace", "tool", "agent", "consent", "running", "complete"]);
const SET_TOOL_COMMAND = "sparkai.commerce-toolkit.generate-listing-set";

function readProgress(storageKey: string, imageCount: number, resultCount: number): TutorialProgress {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<TutorialProgress> | null;
    if (value && TUTORIAL_STAGES.has(value.stage as CommerceTutorialStage)) {
      return {
        stage: value.stage as CommerceTutorialStage,
        initialImageCount: Math.max(0, Math.floor(Number(value.initialImageCount) || 0)),
        baselineResultCount: Math.max(0, Math.floor(Number(value.baselineResultCount) || 0)),
      };
    }
  } catch {
    // A malformed convenience snapshot must never block the tutorial.
  }
  return { stage: "welcome", initialImageCount: imageCount, baselineResultCount: resultCount };
}

function visibleTarget(selectors: readonly string[]) {
  for (const selector of selectors) {
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      if (rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden") return candidate;
    }
  }
  return null;
}

function targetSelectors(stage: CommerceTutorialStage) {
  if (stage === "import") return [".workspace-asset-rail-header button", ".canvas-panel"];
  if (stage === "select") return [".flow-node.image.selected", ".flow-node.image"];
  if (stage === "workspace") return [".workspace-domain-switcher-trigger"];
  if (stage === "tool" || stage === "consent") return [`[data-domain-tool-command=\"${SET_TOOL_COMMAND}\"]`, `[data-plugin-command=\"${SET_TOOL_COMMAND}\"]`, "[data-domain-tools-launcher]"];
  if (stage === "agent") return [".project-agent-composer textarea", ".project-agent-composer"];
  if (stage === "running") return [".project-agent-panel"];
  if (stage === "complete") return [".workspace-direction-switcher"];
  return [];
}

function targetLabel(stage: CommerceTutorialStage) {
  if (stage === "import") return "第 1 步 · 导入母图";
  if (stage === "select") return "第 2 步 · 选中商品";
  if (stage === "workspace") return "第 3 步 · 切换电商工作台";
  if (stage === "tool" || stage === "consent") return "第 4 步 · 打开套图工具";
  if (stage === "agent") return "Agent 输入区";
  if (stage === "running") return "查看执行进度";
  if (stage === "complete") return "查看套图成果";
  return "";
}

function stageOrdinal(stage: CommerceTutorialStage) {
  if (stage === "welcome") return 0;
  if (stage === "import") return 1;
  if (stage === "select") return 2;
  if (stage === "workspace") return 3;
  if (stage === "tool" || stage === "agent") return 4;
  if (stage === "consent" || stage === "running") return 5;
  return 6;
}

export default function CommerceTutorial({
  projectId,
  imageCount,
  selectedImageCount,
  workspaceDomain,
  agentExecutionBusy,
  commerceDialogOpen,
  commerceResultCount,
  commerceToolAvailable,
  commerceToolLoading,
  completedBefore = false,
  onClose,
  onImport,
  onSelectLatestImage,
  onSwitchCommerce,
  onOpenSetTool,
  onOpenToolsSettings,
  onPrepareAgent,
  onViewResults,
  onOpenExport,
  onCompleted,
}: {
  projectId: string;
  imageCount: number;
  selectedImageCount: number;
  workspaceDomain: WorkspaceDomain;
  agentExecutionBusy: boolean;
  commerceDialogOpen: boolean;
  commerceResultCount: number;
  commerceToolAvailable: boolean;
  commerceToolLoading: boolean;
  completedBefore?: boolean;
  onClose: () => void;
  onImport: () => void;
  onSelectLatestImage: () => void;
  onSwitchCommerce: () => void;
  onOpenSetTool: () => void;
  onOpenToolsSettings: () => void;
  onPrepareAgent: (prompt: string) => void;
  onViewResults: () => void;
  onOpenExport: () => void;
  onCompleted: () => void;
}) {
  const storageKey = `naimage.commerceTutorial.v1:${projectId}`;
  const initial = useMemo(() => readProgress(storageKey, imageCount, commerceResultCount), [storageKey]);
  const [stage, setStage] = useState<CommerceTutorialStage>(initial.stage);
  const [initialImageCount, setInitialImageCount] = useState(initial.initialImageCount);
  const [baselineResultCount, setBaselineResultCount] = useState(initial.baselineResultCount);
  const [notice, setNotice] = useState("");
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const completionReportedRef = useRef(false);
  const highlightedTargetRef = useRef<HTMLElement | null>(null);

  const resolvedStage = resolveCommerceTutorialStage(stage, {
    imageCount,
    initialImageCount,
    selectedImageCount,
    workspaceDomain,
    agentExecutionBusy,
    commerceResultCount,
    baselineResultCount,
  });

  useEffect(() => {
    if (resolvedStage !== stage) setStage(resolvedStage);
  }, [resolvedStage, stage]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ stage, initialImageCount, baselineResultCount } satisfies TutorialProgress));
    } catch {
      // Tutorial persistence is a convenience only.
    }
  }, [baselineResultCount, initialImageCount, stage, storageKey]);

  useEffect(() => {
    if (stage !== "complete" || completionReportedRef.current) return;
    completionReportedRef.current = true;
    onCompleted();
  }, [onCompleted, stage]);

  useEffect(() => {
    const selectors = targetSelectors(stage);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = visibleTarget(selectors);
        if (highlightedTargetRef.current !== target) {
          highlightedTargetRef.current?.removeAttribute("data-commerce-tutorial-highlight");
          target?.setAttribute("data-commerce-tutorial-highlight", "true");
          highlightedTargetRef.current = target;
        }
        setTargetRect(target?.getBoundingClientRect() ?? null);
      });
    };
    update();
    const timer = window.setInterval(update, 600);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      highlightedTargetRef.current?.removeAttribute("data-commerce-tutorial-highlight");
      highlightedTargetRef.current = null;
    };
  }, [commerceDialogOpen, commerceToolAvailable, stage, workspaceDomain]);

  const restart = () => {
    completionReportedRef.current = false;
    setInitialImageCount(imageCount);
    setBaselineResultCount(commerceResultCount);
    setNotice("");
    setStage("welcome");
  };
  const openSetTool = () => {
    if (commerceToolLoading) return;
    if (!commerceToolAvailable) {
      setNotice("跨境插件尚未启用，已为你打开对应设置。启用并保存后，教学会继续保留。");
      onOpenToolsSettings();
      return;
    }
    setNotice("");
    setStage("consent");
    onOpenSetTool();
  };
  const prepareAgent = () => {
    onPrepareAgent(COMMERCE_TUTORIAL_AGENT_PROMPT);
    setNotice("示例要求已填入右侧 Agent，但尚未发送、尚未扣费。你可以先修改，再亲自点击发送。");
    setStage("agent");
  };
  const ordinal = stageOrdinal(stage);

  return (
    <div className={`commerce-tutorial-layer stage-${stage}`} role="dialog" aria-modal="false" aria-label="跨境电商套图 AI 示例教学">
      {targetRect ? (
        <div
          className="commerce-tutorial-spotlight"
          aria-hidden="true"
          style={{
            left: Math.max(4, targetRect.left - 7),
            top: Math.max(4, targetRect.top - 7),
            width: Math.min(window.innerWidth - 8, targetRect.width + 14),
            height: Math.min(window.innerHeight - 8, targetRect.height + 14),
          }}
        >
          <span>{targetLabel(stage)}</span>
        </div>
      ) : null}
      <section className={`commerce-tutorial-coach ${stage === "agent" || stage === "running" ? "is-left" : ""}`} aria-live="polite">
        <header>
          <span className="commerce-tutorial-avatar"><GraduationCap size={19} /></span>
          <div><strong>SparkAI WorkSpace AI 陪练</strong><small>Amazon / 速卖通套图实操</small></div>
          <ButtonBase type="button" className="commerce-tutorial-close" aria-label="稍后继续教学" title="关闭后会保留当前进度" onClick={onClose}><X size={16} /></ButtonBase>
        </header>
        <div className="commerce-tutorial-progress" aria-label={`教学进度 ${ordinal}/6`}>
          {Array.from({ length: 6 }, (_, index) => <i key={index} className={index < ordinal ? "done" : index === ordinal ? "active" : ""} />)}
        </div>

        {stage === "welcome" ? (
          <div className="commerce-tutorial-content is-welcome">
            <span className="commerce-tutorial-hero-icon"><ShoppingBag size={25} /></span>
            <div><h3>{completedBefore ? "再练一次完整套图流程" : "做出你的第一套跨境商品图"}</h3><p>我会看着当前画布逐步提示：导入或粘贴母图、选择商品、找到套图工具、学会向 Agent 表达，最后由你决定是否发起可能扣费的真实生成。</p></div>
            <div className="commerce-tutorial-safety"><Sparkles size={14} /><span>教学本身零费用；只有你点击“生成套图”或亲自发送 Agent 请求后才可能扣费。</span></div>
            <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={() => {
              setInitialImageCount(imageCount);
              setBaselineResultCount(commerceResultCount);
              setStage("import");
            }}><Play size={15} /><span>开始实操</span></ButtonBase>
          </div>
        ) : null}

        {stage === "import" ? (
          <div className="commerce-tutorial-content">
            <h3>第 1 步：放入商品母图</h3>
            <p>最快是复制图片后在画布按 <kbd>Ctrl + V</kbd>；也可以点击左侧“+”选择图片。SparkAI WorkSpace 只复制到当前项目，不修改原文件。</p>
            <div className="commerce-tutorial-actions">
              <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={onImport}><ImagePlus size={15} /><span>打开图片导入</span></ButtonBase>
              {imageCount > 0 ? <ButtonBase type="button" className="commerce-tutorial-action" onClick={() => { onSelectLatestImage(); setStage("select"); }}><ClipboardPaste size={15} /><span>使用画布现有图片</span></ButtonBase> : null}
            </div>
            <small>粘贴或导入成功后，我会自动进入下一步。</small>
          </div>
        ) : null}

        {stage === "select" ? (
          <div className="commerce-tutorial-content">
            <h3>第 2 步：选中要处理的商品</h3>
            <p>单击图片或图片容器。选中高亮同时会把它交给右侧 Agent 作为当前商品上下文。</p>
            <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={onSelectLatestImage}><WandSparkles size={15} /><span>帮我选中最近图片</span></ButtonBase>
          </div>
        ) : null}

        {stage === "workspace" ? (
          <div className="commerce-tutorial-content">
            <h3>第 3 步：进入电商创作</h3>
            <p>四个工作台共用同一画布，切换不会清空图片，也不会调用模型。电商模式会显示 Amazon / 速卖通相关工具。</p>
            <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={onSwitchCommerce}><ShoppingBag size={15} /><span>切换到电商创作</span></ButtonBase>
          </div>
        ) : null}

        {stage === "tool" ? (
          <div className="commerce-tutorial-content">
            <h3>第 4 步：选择一种生成方式</h3>
            <p>推荐用左侧或底部的“套图”工具逐张配置；也可以把自然语言示例交给右侧 Agent。两条路最终都复用真实画布与生成链路。</p>
            <div className="commerce-tutorial-actions">
              <ButtonBase type="button" className="commerce-tutorial-action primary" disabled={commerceToolLoading} onClick={openSetTool}>{commerceToolLoading ? <Loader2 className="spin" size={15} /> : <ShoppingBag size={15} />}<span>{commerceToolAvailable ? "打开一键套图" : commerceToolLoading ? "工具载入中" : "启用跨境工具"}</span></ButtonBase>
              <ButtonBase type="button" className="commerce-tutorial-action" onClick={prepareAgent}><Bot size={15} /><span>试试 Agent 说法</span></ButtonBase>
            </div>
          </div>
        ) : null}

        {stage === "agent" ? (
          <div className="commerce-tutorial-content">
            <h3>Agent 示例已经填好</h3>
            <blockquote>{COMMERCE_TUTORIAL_AGENT_PROMPT}</blockquote>
            <p>先按你的商品修改，再亲自点击发送。发送代表允许 Agent 调用已配置上游；教学不会替你按下发送。</p>
            <div className="commerce-tutorial-actions">
              <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={prepareAgent}><Bot size={15} /><span>重新填入 Agent</span></ButtonBase>
              <ButtonBase type="button" className="commerce-tutorial-action" onClick={openSetTool}><ShoppingBag size={15} /><span>改用套图工具</span></ButtonBase>
            </div>
          </div>
        ) : null}

        {stage === "consent" ? (
          <div className="commerce-tutorial-content">
            <h3>第 5 步：配置并由你授权生成</h3>
            <p>{commerceDialogOpen ? "套图窗口已经打开。选择张数、逐图要求和画幅后，点击窗口里的“一键生成”；这次点击就是对上游可能扣费的明确授权。" : "如果刚才关闭了套图窗口，可以再次打开。教学不会自动替你扣费。"}</p>
            {!commerceDialogOpen ? <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={openSetTool}><ShoppingBag size={15} /><span>重新打开套图配置</span></ButtonBase> : null}
          </div>
        ) : null}

        {stage === "running" ? (
          <div className="commerce-tutorial-content">
            <h3>正在生成你的第一套商品图</h3>
            <p>{agentExecutionBusy ? "SparkAI WorkSpace 会先进行小批量探测，再逐步放量。你可以在右侧 Agent 时间线查看进度，失败不会伪装成成功。" : "当前执行已经结束，但还没有检测到新的套图成果。可以重新打开套图配置或检查右侧 Agent 的错误说明。"}</p>
            {agentExecutionBusy ? <div className="commerce-tutorial-running"><Loader2 className="spin" size={16} /><span>等待受管成果回到画布…</span></div> : <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={openSetTool}><ShoppingBag size={15} /><span>重新打开套图配置</span></ButtonBase>}
          </div>
        ) : null}

        {stage === "complete" ? (
          <div className="commerce-tutorial-content is-complete">
            <div className="commerce-tutorial-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ left: `${5 + (index * 29) % 90}%`, animationDelay: `${(index % 6) * 70}ms` }} />)}</div>
            <span className="commerce-tutorial-success"><PartyPopper size={27} /></span>
            <h3>第一套跨境商品图完成！</h3>
            <p>你已经学会“母图 → 套图配置 / Agent → 明确授权 → 画布成果”的完整路径。下一次可以直接选中商品后调用套图工具。</p>
            <div className="commerce-tutorial-reward"><CheckCircle2 size={16} /><span>新手任务完成 · 套图创作者徽章</span></div>
            <div className="commerce-tutorial-actions">
              <ButtonBase type="button" className="commerce-tutorial-action primary" onClick={onViewResults}><Eye size={15} /><span>在专注中看整组</span></ButtonBase>
              <ButtonBase type="button" className="commerce-tutorial-action" onClick={onOpenExport}><PackageCheck size={15} /><span>前往平台导出</span></ButtonBase>
            </div>
            <ButtonBase type="button" className="commerce-tutorial-restart" onClick={restart}><Sparkles size={13} /><span>从头再练一次</span></ButtonBase>
          </div>
        ) : null}

        {notice ? <p className="commerce-tutorial-notice"><Settings size={13} />{notice}</p> : null}
      </section>
    </div>
  );
}
