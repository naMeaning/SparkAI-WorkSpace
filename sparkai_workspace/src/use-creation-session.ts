import { useCallback, useEffect, useRef, useState } from "react";
import type { CreationCommand, CreationResponse, CreationSessionSnapshot } from "./creation-session";

/** Main owns requirements/reviews; renderer snapshots are disposable projections. */
export function useCreationSession(projectId: string, conversationId: string, ready: boolean) {
  const [snapshot, setSnapshot] = useState<CreationSessionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const generation = useRef(0);
  const scope = useRef({ projectId, conversationId });
  scope.current = { projectId, conversationId };
  const read = useCallback(async () => {
    if (!ready || !projectId || !conversationId || !window.naimageAgent?.creationCommand) return;
    const token = generation.current;
    try {
      const result = await window.naimageAgent.creationCommand("creation.acceptance.get", { expectedProjectId: projectId, conversationId });
      if (token !== generation.current) return;
      if (!result.ok) { setReadError(result.error || "创作记录读取失败。"); return; }
      setSnapshot({ projectId, conversationId, requirements: result.requirements || null,
        requirementRef: result.requirementRef, results: result.results || [] });
      setReadError("");
    } catch { /* Keep the last confirmed snapshot through a temporary reconnect. */ }
  }, [projectId, conversationId, ready]);
  useEffect(() => {
    generation.current++;
    setSnapshot(null); setReadError(""); setOperationError(""); setBusy(false);
    let disposed = false, timer = 0;
    const poll = async () => { await read(); if (!disposed) timer = window.setTimeout(() => void poll(), 1000); };
    void poll();
    return () => { disposed = true; generation.current++; window.clearTimeout(timer); };
  }, [read]);
  const execute = useCallback(async (command: CreationCommand, args: Record<string, unknown>): Promise<CreationResponse> => {
    const token = generation.current;
    const expected = { ...scope.current };
    if (args.expectedProjectId !== expected.projectId || args.conversationId !== expected.conversationId) {
      const result = { ok: false, error: "项目或会话已切换，请重新选择成果。", errorCode: "CREATION_SCOPE_STALE" };
      setOperationError(result.error);
      return result;
    }
    setBusy(true); setOperationError("");
    try {
      const result = await window.naimageAgent!.creationCommand(command, args);
      if (token === generation.current) {
        if (!result.ok) setOperationError(result.error || "创作操作未完成。");
        await read();
      }
      return result;
    } catch {
      const result = { ok: false, errorCode: "CREATION_DISCONNECTED", error: "操作回执中断，请查询原记录；不会自动重发。" };
      if (token === generation.current) setOperationError(result.error);
      return result;
    } finally { if (token === generation.current) setBusy(false); }
  }, [read]);
  return { snapshot, busy, error: operationError || readError, execute, refresh: read };
}
