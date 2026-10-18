import { useEffect, useState } from "react";

export type AgentTaskReceipt = {
  taskId: string; projectId: string; conversationId: string; title: string;
  accepted: boolean; phase: string; stage: string | null; paused: boolean; version: number; cursor: number;
  runIds: string[]; currentRunId: string | null;
  scope: { snapshotHash: string; sourceNodeIds: string[] } | null;
  question: { requestId: string; kind: string; title: string; question: string; detail: string; allowCustomAnswer: boolean;
    options: { id: string; label: string; description: string; recommended: boolean }[] } | null;
  results: { assetId: string; occurrenceId: string; nodeId?: string; saved: boolean; inProject: boolean }[];
  savedCount: number;
  imageOperations: { key: string; state: string; stage: string; canRecover: boolean; savedCount: number }[];
  error: { code: string; message: string } | null;
  nextAction: string; createdAt: string; updatedAt: string;
};
export type TaskResponse = { ok?: boolean; error?: string; errorCode?: string; task?: AgentTaskReceipt; accepted?: boolean; runId?: string; answer?: string; optionId?: string };
export type AgentTaskCard = { title: string; phase: string; savedCount: number; question: string; error: string; action: "answer" | "recover" | "save" | "none" };

export function agentTaskCard(task: AgentTaskReceipt | null): AgentTaskCard | null {
  if (!task) return null;
  const phases: Record<string, string> = { preparing: "准备任务", accepted: "已受理", running: task.stage === "image" ? "处理图片" : task.stage === "tools" ? "使用工具" : "Agent 执行中",
    resuming: "正在续接", waiting: "等待你的回答", completed: "执行完成", partial: "部分完成", failed: "执行失败", interrupted: "执行已中断", stopped: "已结束", "save-failed": "等待保存" };
  return { title: task.title || "当前任务", phase: task.paused ? "已暂停" : phases[task.phase] || "状态待确认", savedCount: task.savedCount,
    question: task.question?.question || "", error: task.error?.message || "",
    action: task.nextAction === "answer" ? "answer" : task.nextAction === "recover-original-results" ? "recover" : task.nextAction === "save-project" ? "save" : "none" };
}

export function useAgentTaskReceipt(projectId: string, conversationId: string, ready: boolean) {
  const [task, setTask] = useState<AgentTaskReceipt | null>(null);
  useEffect(() => {
    setTask(null);
    if (!ready || !projectId || !conversationId || !window.naimageAgent?.taskCommand) return;
    let disposed = false, timer = 0;
    const read = async () => {
      try {
        const result = await window.naimageAgent!.taskCommand("agent.task.get", { expectedProjectId: projectId, conversationId });
        if (!disposed && result.ok !== false) setTask(current => result.task && result.task.version === current?.version && result.task.taskId === current.taskId ? current : result.task || null);
        else if (!disposed && result.errorCode === "TASK_NOT_FOUND") setTask(null);
      } catch { /* A disconnected renderer keeps the last confirmed receipt until reconnect. */ }
      finally { if (!disposed) timer = window.setTimeout(() => void read(), 650); }
    };
    void read();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [projectId, conversationId, ready]);
  return task;
}
