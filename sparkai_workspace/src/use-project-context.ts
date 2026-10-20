import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectContextCommand, ProjectContextResponse, ProjectContextSnapshot, ProjectKnowledgeItem, ProjectResultSearchSnapshot } from "./project-context";

type ContextBridge = { projectContextCommand?: (command: ProjectContextCommand, input: Record<string, unknown>) => Promise<ProjectContextResponse> };
const bridge = () => (window.naimageAgent as ContextBridge | undefined)?.projectContextCommand;
const mergeEntries = (previous: ProjectKnowledgeItem[], entries: ProjectKnowledgeItem[]) => [...new Map([...previous, ...entries].map(entry => [entry.knowledgeId, entry])).values()];

/** Main owns knowledge and result validity. Polling never mutates materials. */
export function useProjectContext(projectId: string, conversationId: string, ready: boolean) {
  const [snapshot, setSnapshot] = useState<ProjectContextSnapshot | null>(null);
  const [searchResults, setSearchResults] = useState<ProjectResultSearchSnapshot | null>(null);
  const [busy, setBusy] = useState(false), [readError, setReadError] = useState(""), [operationError, setOperationError] = useState("");
  const generation = useRef(0), readSequence = useRef(0), searchSequence = useRef(0), inFlight = useRef(false);
  const lastSearchInput = useRef<Record<string, unknown> | null>(null);
  const scope = useRef({ projectId, conversationId }); scope.current = { projectId, conversationId };
  const refreshSearch = useCallback(async () => {
    const invoke = bridge(), input = lastSearchInput.current;
    if (!invoke || !input || inFlight.current || !ready) return;
    const token = generation.current, request = ++searchSequence.current;
    try {
      const result = await invoke("project.results.search", input);
      if (token !== generation.current || request !== searchSequence.current || scope.current.projectId !== projectId || scope.current.conversationId !== conversationId) return;
      if (!result.ok || result.projectId !== projectId || !Array.isArray(result.results)) { setReadError(result.error || "成果检索暂时无法刷新。"); return; }
      setSearchResults({ projectId, total: result.total || 0, offset: result.offset || 0, limit: result.limit || 20, hasMore: Boolean(result.hasMore), results: result.results });
    } catch { if (token === generation.current && request === searchSequence.current) setReadError("成果检索暂时无法刷新，已保留上次结果。"); }
  }, [projectId, conversationId, ready]);
  const read = useCallback(async () => {
    const invoke = bridge();
    if (!ready || !projectId || !conversationId || !invoke) return;
    const token = generation.current, request = ++readSequence.current;
    try {
      const result = await invoke("project.context.get", { expectedProjectId: projectId, conversationId });
      if (token !== generation.current || request !== readSequence.current || scope.current.projectId !== projectId || scope.current.conversationId !== conversationId) return;
      if (!result.ok) { setReadError(result.error || "项目知识读取失败。"); return; }
      if (result.projectId !== projectId || !Array.isArray(result.entries) || !Number.isSafeInteger(result.revision)) { setReadError("项目知识回执不匹配，请刷新后重试。"); return; }
      setSnapshot(previous => {
        const entries = previous && previous.revision === result.revision ? mergeEntries(previous.entries, result.entries!) : result.entries!;
        const total = result.total ?? entries.length;
        return { projectId, conversationId, revision: result.revision!, entries, total, objects: result.objects || [],
          scopeOptions: result.scopeOptions, scopeOptionsTruncated: result.scopeOptionsTruncated,
          ...(entries.length < total ? { nextOffset: entries.length } : {}), usedKnowledge: result.usedKnowledge, usedTemplate: result.usedTemplate };
      });
      setReadError("");
      await refreshSearch();
    } catch { if (token === generation.current && request === readSequence.current) setReadError("项目知识暂时无法读取，已保留最后确认的内容。"); }
  }, [projectId, conversationId, ready, refreshSearch]);
  useEffect(() => {
    generation.current++; readSequence.current++; searchSequence.current++; lastSearchInput.current = null;
    setSnapshot(null); setSearchResults(null); setReadError(""); setOperationError(""); setBusy(false); inFlight.current = false;
    let disposed = false, timer = 0;
    const poll = async () => { await read(); if (!disposed) timer = window.setTimeout(() => void poll(), 1500); };
    void poll();
    return () => { disposed = true; generation.current++; readSequence.current++; searchSequence.current++; window.clearTimeout(timer); };
  }, [read]);
  const execute = useCallback(async (command: ProjectContextCommand, args: Record<string, unknown> = {}): Promise<ProjectContextResponse> => {
    const token = generation.current, expected = { ...scope.current }, invoke = bridge();
    const invalid = args.expectedProjectId !== undefined && args.expectedProjectId !== expected.projectId || args.conversationId !== undefined && args.conversationId !== expected.conversationId;
    if (invalid || !ready || !expected.projectId || !expected.conversationId || !invoke) {
      const result = { ok: false, errorCode: "PROJECT_CONTEXT_SCOPE_STALE", error: "项目或会话已切换，请刷新后重试。" };
      setOperationError(result.error); return result;
    }
    if (inFlight.current) return { ok: false, errorCode: "PROJECT_CONTEXT_BUSY", error: "上一项操作仍在处理中。" };
    const input: Record<string, unknown> = { ...args, expectedProjectId: expected.projectId };
    if (["project.context.get", "project.results.use"].includes(command)) Object.assign(input, { conversationId: expected.conversationId });
    else delete input.conversationId;
    const searchRequest = command === "project.results.search" ? ++searchSequence.current : 0;
    inFlight.current = true; setBusy(true); setOperationError("");
    try {
      const result = await invoke(command, input);
      if (token !== generation.current || scope.current.projectId !== expected.projectId || scope.current.conversationId !== expected.conversationId) return result;
      if (!result.ok) setOperationError(result.error || "项目上下文操作未完成。");
      if (result.ok && result.projectId && result.projectId !== expected.projectId) {
        const failed = { ok: false, errorCode: "PROJECT_CONTEXT_SCOPE_STALE", error: "项目上下文回执不匹配，未更新当前界面。" };
        setOperationError(failed.error); return failed;
      }
      if (result.ok && command === "project.results.search" && Array.isArray(result.results) && searchRequest === searchSequence.current) {
        lastSearchInput.current = input;
        setSearchResults({ projectId: expected.projectId, total: result.total || 0, offset: result.offset || 0, limit: result.limit || 20, hasMore: Boolean(result.hasMore), results: result.results });
      }
      if (result.ok && command === "project.knowledge.list" && result.entries) setSnapshot(previous => previous ? {
        ...previous, revision: result.revision ?? previous.revision, entries: Number(input.offset) > 0 && result.revision === previous.revision ? mergeEntries(previous.entries, result.entries!) : result.entries!,
        total: result.total ?? result.entries!.length, nextOffset: result.nextOffset } : previous);
      if (command !== "project.results.search") await read();
      return result;
    } catch {
      const result = { ok: false, errorCode: "PROJECT_CONTEXT_DISCONNECTED", error: "操作回执中断，请刷新原记录；不会自动重发。" };
      if (token === generation.current) setOperationError(result.error);
      return result;
    } finally { if (token === generation.current) { inFlight.current = false; setBusy(false); } }
  }, [read, ready]);
  return { snapshot: snapshot ? { ...snapshot, ...(searchResults ? { search: searchResults } : {}) } : null,
    busy, error: operationError || readError, execute, refresh: read, searchResults };
}
