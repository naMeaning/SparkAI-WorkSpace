import React, { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Check, Goal, ImageIcon, Import, MessageSquare, Pause, Play, Send, ShieldCheck, X } from "lucide-react";

import { clipboardHasImage, type AgentSteerTaskScopeMode, yuan } from "./core";
import { ActionButton, DialogShell, IconActionButton, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export type ProjectAgentComposerArtifact = {
  id: string;
  name: string;
};

export type AgentComposerTaskMode = "standard" | "goal";

export type GoalConfirmationDraft = {
  prompt: string;
  snapshotHash: string;
  containerCount: number;
  assetCount: number;
  requestCount: number;
  skipped: string[];
  probeContainerCount: number;
  concurrencyCap: number;
  trialImagesUsed: number;
  paidImages: number;
  estimatedMaxCostCents?: number;
};

export type ProjectAgentComposerProps = {
  selectedArtifacts: ProjectAgentComposerArtifact[];
  sourceImageCount: number;
  referenceImageCount: number;
  prompt: string;
  executionBusy: boolean;
  paused: boolean;
  stopPending: boolean;
  goalActive: boolean;
  goalContainerCount: number;
  goalAssetCount: number;
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  setPrompt: (value: string) => void;
  sendPrompt: (
    prompt?: string,
    taskScopeMode?: AgentSteerTaskScopeMode | "auto",
    taskMode?: AgentComposerTaskMode
  ) => void | Promise<unknown>;
  pauseAgentRun: () => void;
  resumeAgentRun: () => void;
  stopAgentRun: () => void;
  clearSelection: () => void;
  editSourceImages: () => void;
  editReferenceImages: () => void;
};

export default function ProjectAgentComposer({
  selectedArtifacts,
  sourceImageCount,
  referenceImageCount,
  prompt,
  executionBusy,
  paused,
  stopPending,
  goalActive,
  goalContainerCount,
  goalAssetCount,
  inputRef,
  setPrompt,
  sendPrompt,
  pauseAgentRun,
  resumeAgentRun,
  stopAgentRun,
  clearSelection,
  editSourceImages,
  editReferenceImages
}: ProjectAgentComposerProps) {
  const [taskScopeMode, setTaskScopeMode] = useState<AgentSteerTaskScopeMode | "auto">("auto");
  const [taskMode, setTaskMode] = useState<AgentComposerTaskMode>("standard");

  useEffect(() => {
    if (!executionBusy) setTaskScopeMode("auto");
  }, [executionBusy]);

  async function dispatchPrompt() {
    if (stopPending) return;
    await sendPrompt(undefined, goalActive ? "keep" : taskScopeMode, taskMode);
    if (executionBusy) setTaskScopeMode("auto");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    void dispatchPrompt();
  }

  const selectionLabel = selectedArtifacts.length === 1
    ? selectedArtifacts[0].name
    : `${selectedArtifacts.length} 个选中成果`;
  const goalAvailable = goalContainerCount > 0 && goalAssetCount > 0;
  const goalSelected = !executionBusy && taskMode === "goal";

  return (
    <form className="project-agent-composer" onSubmit={submit} aria-busy={stopPending || undefined}>
      {!executionBusy ? (
        <div className="project-agent-task-mode" role="group" aria-label="Agent 任务模式">
          <button
            type="button"
            className={`ui-button-base${taskMode === "standard" ? " active" : ""}`}
            aria-pressed={taskMode === "standard"}
            onClick={() => setTaskMode("standard")}
          >
            <MessageSquare size={13} />
            <span>普通</span>
          </button>
          <button
            type="button"
            className={`ui-button-base${taskMode === "goal" ? " active" : ""}`}
            aria-pressed={taskMode === "goal"}
            disabled={!goalAvailable}
            onClick={() => setTaskMode("goal")}
          >
            <Goal size={13} />
            <span>Goal</span>
          </button>
          <small>{goalAvailable ? `${goalContainerCount} 个容器 · ${goalAssetCount} 张图` : "画布暂无可执行图片容器"}</small>
        </div>
      ) : null}
      <div className={`project-agent-composer-meta${goalSelected || goalActive ? " goal" : ""}`}>
        {goalSelected || goalActive ? (
          <div className="project-agent-goal-context" aria-label={`Goal 范围 ${goalContainerCount} 个容器 ${goalAssetCount} 张图`}>
            <Goal size={14} />
            <strong>{goalActive ? "Goal 运行中" : "全部图片容器"}</strong>
            <span>{goalContainerCount} 个容器 · {goalAssetCount} 张图</span>
          </div>
        ) : (
          <>
            <ActionButton className="project-agent-sources" variant="secondary" onClick={editSourceImages} disabled={stopPending} icon={<Import size={14} />}>
              {sourceImageCount ? `${sourceImageCount} 张原图` : "添加原图"}
            </ActionButton>
            <ActionButton className="project-agent-references" variant="secondary" onClick={editReferenceImages} disabled={stopPending} icon={<ImageIcon size={14} />}>
              {referenceImageCount ? `${referenceImageCount} 张参考图` : "添加参考图"}
            </ActionButton>
          </>
        )}
        {!goalSelected && !goalActive && selectedArtifacts.length ? (
          <div
            className="project-agent-composer-context has-artifact"
            data-selection-kind={selectedArtifacts.length > 1 ? "multiple" : "single"}
            data-selection-count={selectedArtifacts.length}
            data-selection-ids={selectedArtifacts.map((artifact) => artifact.id).join(" ")}
            title={selectedArtifacts.length > 1 ? selectedArtifacts.map((artifact) => artifact.name).join("、") : undefined}
            aria-label={`将基于 ${selectionLabel}`}
          >
            <ImageIcon size={13} />
            <span>将基于</span>
            <strong>{selectionLabel}</strong>
            <IconActionButton label="取消当前选中" onClick={clearSelection} disabled={stopPending} icon={<X size={12} />} />
          </div>
        ) : null}
      </div>
      <textarea
        ref={inputRef}
        value={prompt}
        disabled={stopPending}
        onChange={(event) => setPrompt(event.target.value.slice(0, 36000))}
        onPaste={(event) => {
          if (clipboardHasImage(event)) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void dispatchPrompt();
          }
        }}
        placeholder={executionBusy
          ? goalActive ? "修改 Goal 的处理要求，冻结容器范围保持不变..." : "输入修改要求，发送后 Agent 会停止旧计划并重新规划..."
          : goalSelected ? "描述要对画布全部图片容器执行的操作..." : selectedArtifacts.length ? "描述如何继续处理选中的成果..." : "告诉 Agent 你想完成什么..."}
        rows={4}
      />
      {executionBusy ? (
        <label className="project-agent-steer-mode">
          <span>本次 TaskScope</span>
          {goalActive ? <strong>冻结全部容器，只修改文字</strong> : (
            <select
              value={taskScopeMode}
              disabled={stopPending}
              onChange={(event) => setTaskScopeMode(event.target.value as AgentSteerTaskScopeMode | "auto")}
              aria-label="运行中素材修改方式"
            >
              <option value="auto">自动：选中替换 SOURCE，参考图追加</option>
              <option value="keep">仅修改文字，保留 SOURCE / REFERENCE</option>
              <option value="replace-source">替换 SOURCE</option>
              <option value="merge-source">追加 SOURCE</option>
              <option value="replace-reference">替换 REFERENCE</option>
              <option value="merge-reference">追加 REFERENCE</option>
              <option value="clear-attachments">清空 SOURCE / REFERENCE</option>
            </select>
          )}
        </label>
      ) : null}
      <footer>
        <span>{stopPending ? "正在等待底层确认；当前任务状态保持不变" : paused ? "已暂停，可先发送修改要求" : executionBusy ? "Ctrl + Enter 修改当前任务" : goalSelected ? "发送前确认冻结范围与费用" : "Ctrl + Enter 发送"}</span>
        {executionBusy ? (
          <div className="project-agent-run-controls">
            <ActionButton
              className="project-agent-steer"
              variant="primary"
              type="submit"
              disabled={stopPending || !prompt.trim()}
              aria-label="修改当前任务"
              title="中断当前阶段并按新要求重新规划"
              icon={<Send size={15} />}
            >
              修改
            </ActionButton>
            <ActionButton
              className="project-agent-pause"
              variant="secondary"
              type="button"
              onClick={paused ? resumeAgentRun : pauseAgentRun}
              disabled={stopPending}
              aria-label={paused ? "恢复处理" : "暂停处理"}
              title={paused ? "恢复后继续派发下一批" : "确认后暂停后续批次"}
              icon={paused ? <Play size={15} /> : <Pause size={15} />}
            >
              {paused ? "恢复" : "暂停"}
            </ActionButton>
            <ActionButton
              className="project-agent-stop"
              variant="danger"
              type="button"
              onClick={stopAgentRun}
              busy={stopPending}
              aria-label={stopPending ? "正在确认结束" : "结束处理"}
              title={stopPending ? "正在等待底层确认；当前任务状态保持不变" : "确认后取消思考、生图和未开始批次"}
              icon={<X size={16} />}
            >
              {stopPending ? "正在结束" : "结束"}
            </ActionButton>
          </div>
        ) : (
          <ActionButton
            className="project-agent-send"
            variant="primary"
            type="submit"
            disabled={!prompt.trim()}
            aria-label="发送"
            title="发送"
            icon={<Send size={16} />}
          >
            发送
          </ActionButton>
        )}
      </footer>
    </form>
  );
}

export function GoalConfirmationDialog({
  draft,
  busy,
  notice,
  close,
  submit
}: {
  draft: GoalConfirmationDraft;
  busy: boolean;
  notice?: string;
  close: () => void;
  submit: () => void | Promise<void>;
}) {
  const costText = typeof draft.estimatedMaxCostCents === "number"
    ? `预计计费上限 ${yuan(draft.estimatedMaxCostCents)}`
    : "费用以服务端实际账单为准";
  return (
    <DialogShell
      surface="goal-confirmation"
      ariaLabel="确认 Goal 批量执行"
      className="goal-confirmation-dialog"
      busy={busy}
      closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle" }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="GOAL"
            title="确认批量图片任务"
            description="确认后冻结本次来源范围与费用估算；后续新增或变化的图片不会自动加入。"
            onClose={() => requestClose("close-button")}
            closeDisabled={busy}
          />
          <SurfaceBody className="goal-confirmation-body">
            <div className="goal-confirmation-scope">
              <Goal size={18} />
              <div>
                <strong>{draft.containerCount} 个来源边界 · {draft.assetCount} 张母图</strong>
                <span>最多 {draft.requestCount} 次图片请求</span>
              </div>
              <code>{draft.snapshotHash.slice(0, 18)}</code>
            </div>
            {notice ? (
              <div className="goal-confirmation-notice" role="status">
                <AlertTriangle size={15} />
                <span>{notice}</span>
              </div>
            ) : null}
            <ul className="goal-confirmation-policy">
              <li><ShieldCheck size={15} /><span>多个窗口共享 Main 准入容量；先串行探测 {draft.probeContainerCount} 个不同母图代表项，等待探测时暂停其他 Goal 新放量。</span></li>
              <li><Check size={15} /><span>请求、落盘和技术校验通过后公平共享最高 {draft.concurrencyCap} 路；服务重试会暂停新波次，保护性失败会跨 Goal 熔断。</span></li>
              <li><AlertTriangle size={15} /><span>已发出或已被上游接受的请求仍可能计费；暂停、结束和熔断不能追回已产生费用。</span></li>
            </ul>
            <div className="goal-confirmation-cost">
              <strong>{costText}</strong>
              <span>试用抵扣 {draft.trialImagesUsed} 张 · 预计付费 {draft.paidImages} 张</span>
            </div>
            {draft.skipped.length ? (
              <details className="goal-confirmation-skipped">
                <summary>{draft.skipped.length} 个容器不会执行</summary>
                <p>{draft.skipped.slice(0, 12).join("；")}</p>
              </details>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton variant="primary" onClick={submit} busy={busy} icon={<Goal size={16} />}>
              冻结并执行
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
