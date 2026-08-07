import React from "react";
import { Send } from "lucide-react";

import { ActionButton, DialogShell, Field, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export type ManualVideoTaskDraft = {
  prompt: string;
  model: string;
  seconds: number;
  aspectRatio: string;
  resolution: string;
};

export type ManualVideoTaskDialogState = {
  draft: ManualVideoTaskDraft;
  worldX: number;
  worldY: number;
  projectId: string;
};

export default function ManualVideoTaskDialog({ state, setState, models, busy, close, submit }: {
  state: ManualVideoTaskDialogState;
  setState: React.Dispatch<React.SetStateAction<ManualVideoTaskDialogState | null>>;
  models: string[];
  busy?: boolean;
  close: () => void;
  submit: () => void;
}) {
  const draft = state.draft;

  function updateDraft(patch: Partial<ManualVideoTaskDraft>) {
    setState((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current);
  }

  return (
    <DialogShell
      surface="manual-video-task"
      ariaLabel="创建视频工作"
      layerClassName="manual-video-task-layer"
      className="manual-video-task-dialog"
      busy={busy}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="创建视频工作"
            description="创建独立视频任务；关闭软件后仍会根据项目 journal 恢复轮询。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="manual-video-task-body">
            <div className="manual-video-task-controls">
              <Field label="视频模型">
                <select value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })}>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </Field>
              <Field label="时长">
                <select value={String(draft.seconds)} onChange={(event) => updateDraft({ seconds: Number(event.target.value) })}>
                  {[5, 10, 15].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
                </select>
              </Field>
              <Field label="比例">
                <select value={draft.aspectRatio} onChange={(event) => updateDraft({ aspectRatio: event.target.value })}>
                  {["16:9", "9:16", "1:1", "4:3", "3:4"].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                </select>
              </Field>
              <Field label="清晰度">
                <select value={draft.resolution} onChange={(event) => updateDraft({ resolution: event.target.value })}>
                  {["720p", "1080p"].map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                </select>
              </Field>
            </div>
            <Field className="manual-video-task-prompt" label="视频画面要求">
              <textarea
                value={draft.prompt}
                onChange={(event) => updateDraft({ prompt: event.target.value })}
                placeholder="描述主体动作、镜头运动、场景、节奏、光线和需要保持一致的商品细节…"
                rows={8}
                autoFocus
              />
            </Field>
            <InlineNotice tone="neutral">
              提交后会直接调用所选上游视频模型，费用由 Base URL / Token 所属服务结算。创建结果不明时，SparkAI WorkSpace 不会自动重试，避免重复扣费。
            </InlineNotice>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant="primary"
              icon={<Send size={15} />}
              onClick={submit}
              busy={busy}
              disabled={!draft.prompt.trim() || !draft.model.trim()}
            >
              创建视频
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
