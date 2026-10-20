import type {
  AgentConversation,
  AgentMessage,
  AgentProgress,
  AgentSteerTaskScopeMode,
  AgentStatus,
  AppSettings,
  WorkspaceDomain
} from "./core";
import {
  glassAppearanceProjection,
  type GlassAccentId,
  type GlassThemeMode,
  type GlassThemeSettings
} from "./glass-theme.ts";
import { workspaceDomainDefinition } from "./workspace-domain.ts";
import { runHasIncompleteModelReply } from "./model-ux.ts";
import type { AgentTaskCard, AgentTaskReceipt } from "./agent-task";
import type { CreationCheckInput, CreationDecisionInput, CreationRegionRevisionInput, CreationRequirementsUpdate, CreationRevisionInput, CreationSessionSnapshot } from "./creation-session";

const maximumPromptChars = 200_000;
const maximumMessageChars = 16_000;
const maximumToolPromptChars = 12_000;
const taskScopeSnapshotHashPattern = /^scope-[a-f0-9]{32}$/;
const goalConfirmationHashPattern = /^goal-[a-f0-9]{32}$/;

export type AgentWindowGoalState = {
  available: boolean;
  active: boolean;
  snapshotHash: string;
  containerCount: number;
  assetCount: number;
  operationsPerAsset: number;
  requestCount: number;
  skippedContainerCount: number;
  probeContainerCount: number;
  concurrencyCap: number;
  warning: string;
};

export type AgentWindowMessage = {
  id: string;
  role: AgentMessage["role"];
  content: string;
  createdAt: string;
  status: AgentMessage["status"];
  meta?: string;
  sourceCount: number;
  referenceCount: number;
  toolTrace?: {
    stage?: "start" | "result";
    label: string;
    operation: string;
    params: string;
    brief: string;
    prompts: { title: string; prompt: string }[];
    completionText?: string;
  };
};

export type AgentWindowGlassAppearance = GlassThemeSettings & {
  mode: GlassThemeMode;
  resolvedAccent: Exclude<GlassAccentId, "theme">;
  variables: Record<string, string>;
};

export type AgentWindowSnapshot = {
  creationSession?: CreationSessionSnapshot | null;
  creationBusy?: boolean;
  creationError?: string;
  taskCard?: AgentTaskCard | null;
  taskQuestion?: { taskId: string; projectId: string; conversationId: string; version: number; question: NonNullable<AgentTaskReceipt["question"]> } | null;
  version: 1;
  ready: boolean;
  projectName: string;
  workspaceDomain: { id: WorkspaceDomain; title: string };
  modelName: string;
  statusText: string;
  busy: boolean;
  paused: boolean;
  stopPending: boolean;
  prompt: string;
  messages: AgentWindowMessage[];
  conversations: { id: string; title: string; updatedAt: string; active: boolean }[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  goal: AgentWindowGoalState;
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
  customTheme: AppSettings["customTheme"];
  glassAppearance: AgentWindowGlassAppearance;
  updatedAt: number;
};

export type AgentWindowCommand =
  | { type: "creation-requirements-update"; input: CreationRequirementsUpdate }
  | { type: "creation-decision"; input: CreationDecisionInput }
  | { type: "creation-revision"; input: CreationRevisionInput }
  | { type: "creation-region-revision"; input: CreationRegionRevisionInput }
  | { type: "creation-check"; input: CreationCheckInput }
  | { type: "task-action" }
  | { type: "task-answer"; taskId: string; projectId: string; conversationId: string; questionId: string; expectedVersion: number; answer?: string; optionId?: string }
  | { type: "request-state" | "closed" | "pause-confirmed" | "resume" | "stop-confirmed" | "new-conversation-confirmed" | "clear-conversation-confirmed" | "edit-sources" | "edit-references" | "edit-image-config" | "edit-memory" }
  | { type: "set-prompt"; prompt: string }
  | { type: "send"; prompt: string; taskScopeMode: AgentSteerTaskScopeMode | "auto"; taskMode: "standard" }
  | { type: "send"; prompt: string; taskScopeMode: "auto"; taskMode: "goal"; goalConfirmed: true; expectedSnapshotHash: string }
  | { type: "switch-conversation"; conversationId: string }
  | { type: "dock"; placement: "right" | "left" | "top" | "bottom" | "floating" };

export type AgentWindowSnapshotInput = {
  creationSession?: CreationSessionSnapshot | null;
  creationBusy?: boolean;
  creationError?: string;
  taskCard?: AgentTaskCard | null;
  taskQuestion?: AgentWindowSnapshot["taskQuestion"];
  ready: boolean;
  projectName: string;
  workspaceDomain: WorkspaceDomain;
  modelName: string;
  agentStatus: AgentStatus;
  busy: boolean;
  paused: boolean;
  stopPending: boolean;
  runElapsedSeconds: number;
  prompt: string;
  messages: AgentMessage[];
  conversations: AgentConversation[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  goal: AgentWindowGoalState;
  agentProgress: AgentProgress[];
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
  customTheme: AppSettings["customTheme"];
  glassTheme?: AppSettings["glassTheme"];
  glassMaterial?: AppSettings["glassMaterial"];
  glassParameters?: AppSettings["glassParameters"];
};

function boundedText(value: unknown, maximumChars: number) {
  const text = String(value ?? "");
  if (text.length <= maximumChars) return text;
  return `${text.slice(0, maximumChars)}\n…内容已在独立窗口截断，请回到主窗口查看完整记录。`;
}

function boundedCount(value: unknown, maximum = 999) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function creationWindowProjection(session?: CreationSessionSnapshot | null): CreationSessionSnapshot | null {
  if (!session) return null;
  const target = (value: import("./creation-session").CreationTarget) => ({ assetId: boundedText(value.assetId, 180), occurrenceId: boundedText(value.occurrenceId, 180), contentHash: boundedText(value.contentHash, 64) });
  const preview = (value?: string) => typeof value === "string" && value.startsWith("naimage-asset:") && value.length <= 2048 && !/[\u0000-\u0020]/.test(value) ? value : undefined;
  const sourceText = (value: import("./creation-session").CreationText) => ({ text: boundedText(value.text, 200000), source: value.source === "user" ? "user" as const : "assumption" as const });
  const criteria = (values: import("./creation-session").CreationCriterion[]) => values.slice(0, 200).map(value => ({ ...sourceText(value), text: boundedText(value.text, 4000), criterionId: boundedText(value.criterionId, 180),
    ...(value.slotIds ? { slotIds: value.slotIds.slice(0, 200).map(value => boundedText(value, 180)) } : {}),
    ...(value.kind ? { kind: value.kind === "source_consistency" ? "source_consistency" as const : "visual" as const } : {}),
    ...(value.sourceTargets ? { sourceTargets: value.sourceTargets.slice(0, 200).map(target) } : {}) }));
  const requirements = session.requirements;
  return {
    projectId: boundedText(session.projectId, 180), conversationId: boundedText(session.conversationId, 180),
    requirementRef: session.requirementRef ? { requirementId: boundedText(session.requirementRef.requirementId, 180), revision: boundedCount(session.requirementRef.revision, Number.MAX_SAFE_INTEGER), fingerprint: boundedText(session.requirementRef.fingerprint, 100) } : null,
    requirements: requirements ? { requirementId: boundedText(requirements.requirementId, 180), conversationId: boundedText(requirements.conversationId, 180), revision: boundedCount(requirements.revision, Number.MAX_SAFE_INTEGER), fingerprint: boundedText(requirements.fingerprint, 100),
      goal: sourceText(requirements.goal), usage: sourceText(requirements.usage), slots: requirements.slots.slice(0, 200).map(value => ({ slotId: boundedText(value.slotId, 180), label: boundedText(value.label, 120), source: value.source === "user" ? "user" : "assumption" })),
      preserve: criteria(requirements.preserve), adjustable: criteria(requirements.adjustable), conditions: criteria(requirements.conditions),
      ...(requirements.fileRules ? { fileRules: { formats: requirements.fileRules.formats?.filter(value => ["png", "jpeg", "webp", "avif", "tiff"].includes(value)).slice(0, 5),
        width: requirements.fileRules.width, height: requirements.fileRules.height, minWidth: requirements.fileRules.minWidth, minHeight: requirements.fileRules.minHeight,
        alpha: requirements.fileRules.alpha } } : {}) } : null,
    results: session.results.slice(0, 200).map(value => ({ target: target(value.target), label: boundedText(value.label, 200), generated: Boolean(value.generated), saved: Boolean(value.saved), inProject: Boolean(value.inProject), fileSaved: Boolean(value.fileSaved),
      ...(value.slotId ? { slotId: boundedText(value.slotId, 180) } : {}), ...(preview(value.previewUrl) ? { previewUrl: preview(value.previewUrl) } : {}),
      ...(value.baseline ? { baseline: { target: target(value.baseline.target), label: boundedText(value.baseline.label, 200), previewUrl: preview(value.baseline.previewUrl) } } : {}),
      ...(value.fileCheck ? { fileCheck: { status: value.fileCheck.status, checkedAt: boundedText(value.fileCheck.checkedAt, 80), contentHash: boundedText(value.fileCheck.contentHash, 64), width: value.fileCheck.width, height: value.fileCheck.height, format: boundedText(value.fileCheck.format, 12), hasAlpha: value.fileCheck.hasAlpha,
        issues: value.fileCheck.issues.slice(0, 40).map(issue => ({ code: boundedText(issue.code, 80), message: boundedText(issue.message, 1000), hard: true as const })) } } : {}),
      ...(value.visualReview ? { visualReview: { reviewId: boundedText(value.visualReview.reviewId, 180), verdict: value.visualReview.verdict, reviewedAt: boundedText(value.visualReview.reviewedAt, 80), summary: boundedText(value.visualReview.summary, 4000),
        findings: value.visualReview.findings.slice(0, 400).map(finding => ({ criterionId: boundedText(finding.criterionId, 180), status: finding.status, note: boundedText(finding.note, 2000) })),
        modelRoundId: boundedText(value.visualReview.modelRoundId, 180), runId: boundedText(value.visualReview.runId, 180) } } : {}),
      decision: { state: value.decision.state, ...(value.decision.reason ? { reason: boundedText(value.decision.reason, 2000) } : {}) }, current: Boolean(value.current), invalidReasons: value.invalidReasons.slice(0, 40).map(reason => boundedText(reason, 1000)) }))
  };
}

function agentWindowGoalState(value: AgentWindowGoalState): AgentWindowGoalState {
  const snapshotHash = boundedText(value?.snapshotHash, 80).trim().toLowerCase();
  const active = Boolean(value?.active);
  const hashIsValid = active
    ? taskScopeSnapshotHashPattern.test(snapshotHash)
    : goalConfirmationHashPattern.test(snapshotHash);
  const containerCount = boundedCount(value?.containerCount, 200);
  const assetCount = boundedCount(value?.assetCount, 200);
  const operationsPerAsset = boundedCount(value?.operationsPerAsset, 200);
  const requestCount = boundedCount(value?.requestCount, 200);
  const probeContainerCount = boundedCount(value?.probeContainerCount, 2);
  const concurrencyCap = boundedCount(value?.concurrencyCap, 10);
  const available = Boolean(
    value?.available &&
    containerCount > 0 &&
    assetCount > 0 &&
    operationsPerAsset > 0 &&
    requestCount === assetCount * operationsPerAsset &&
    probeContainerCount > 0 &&
    concurrencyCap >= probeContainerCount &&
    hashIsValid
  );
  return {
    available,
    active: Boolean(active && taskScopeSnapshotHashPattern.test(snapshotHash)),
    snapshotHash: hashIsValid ? snapshotHash : "",
    containerCount,
    assetCount,
    operationsPerAsset,
    requestCount,
    skippedContainerCount: boundedCount(value?.skippedContainerCount, 200),
    probeContainerCount,
    concurrencyCap,
    warning: boundedText(value?.warning, 1_000)
  };
}

function agentWindowMessage(message: AgentMessage): AgentWindowMessage {
  const trace = message.toolTrace;
  const sourceCount = message.attachments?.sourceAssets?.length ?? message.attachments?.sourceCount ?? 0;
  const referenceCount = message.attachments?.referenceAssets?.length ?? message.attachments?.referenceCount ?? 0;
  return {
    id: boundedText(message.id, 256),
    role: message.role,
    content: boundedText(message.content, maximumMessageChars),
    createdAt: boundedText(message.createdAt, 128),
    status: message.status,
    meta: message.meta ? boundedText(message.meta, 128) : undefined,
    sourceCount: boundedCount(sourceCount),
    referenceCount: boundedCount(referenceCount),
    toolTrace: trace ? {
      stage: trace.stage,
      label: boundedText(trace.label, 256),
      operation: boundedText(trace.operation, 256),
      params: boundedText(trace.params, 2_000),
      brief: boundedText(trace.brief, 8_000),
      prompts: (trace.prompts ?? []).slice(0, 2).map((item, index) => ({
        title: boundedText(item.title || `提示词 ${index + 1}`, 256),
        prompt: boundedText(item.prompt, maximumToolPromptChars)
      })),
      completionText: trace.completionText ? boundedText(trace.completionText, 8_000) : undefined
    } : undefined
  };
}

export function agentWindowStatusText({
  messages,
  agentProgress,
  agentStatus,
  busy,
  paused,
  stopPending,
  runElapsedSeconds
}: Pick<AgentWindowSnapshotInput, "messages" | "agentProgress" | "agentStatus" | "busy" | "paused" | "stopPending" | "runElapsedSeconds">) {
  const visibleMessages = messages.filter((message) => !message.hidden);
  const latestProgress = agentProgress[agentProgress.length - 1];
  const latestRunningMessage = [...visibleMessages].reverse().find((message) => message.status === "running");
  const progressPhase = String(latestProgress?.phase || "");
  const progressActive = [
    "runtime-request",
    "runtime-start",
    "model-request",
    "model-thinking-delta",
    "assistant-message-delta",
    "steer-queued",
    "steer-applied",
    "tool-start",
    "tool-poll",
    "image-request",
    "image-retry",
    "memory-start"
  ].includes(progressPhase);
  const base = stopPending
    ? "Agent 正在确认结束"
    : paused
    ? "Agent 已暂停"
    : agentStatus === "error" || /error|失败/i.test(progressPhase)
    ? "Agent 遇到问题"
    : !busy && runHasIncompleteModelReply(agentProgress)
    ? "图片成果已保留，后续对话未完成"
    : latestRunningMessage?.meta === "assistant-stream"
      ? "Agent 正在输出"
      : latestRunningMessage?.meta === "thinking" || progressPhase === "model-request" || progressPhase === "model-thinking-delta"
        ? "Agent 正在思考"
        : progressActive || busy
          ? "Agent 正在工作"
          : agentProgress.length > 0
            ? "Agent 思考完成"
            : "等待指令";
  return !paused && !stopPending && (busy || progressActive) && runElapsedSeconds > 0 ? `${base} ${Math.floor(runElapsedSeconds)}s` : base;
}

export function buildAgentWindowSnapshot(input: AgentWindowSnapshotInput): AgentWindowSnapshot {
  const messages = input.messages
    .filter((message) => !message.hidden)
    .slice(-40)
    .map(agentWindowMessage);
  const conversations = [
    {
      id: input.activeConversationId,
      title: input.conversations.find((item) => item.id === input.activeConversationId)?.title || "当前会话",
      updatedAt: input.conversations.find((item) => item.id === input.activeConversationId)?.updatedAt || ""
    },
    ...input.conversations.filter((item) => item.id !== input.activeConversationId)
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 24);
  const appearance = glassAppearanceProjection({
    glassTheme: input.glassTheme ?? (input.theme === "dark" ? "dark-rose" : undefined),
    glassMaterial: input.glassMaterial,
    glassParameters: input.glassParameters
  });
  const domain = workspaceDomainDefinition(input.workspaceDomain);
  return {
    version: 1,
    creationSession: creationWindowProjection(input.creationSession),
    creationBusy: Boolean(input.creationBusy),
    creationError: boundedText(input.creationError, 2000),
    taskCard: input.taskCard || null,
    taskQuestion: input.taskQuestion || null,
    ready: Boolean(input.ready),
    projectName: boundedText(input.projectName || "项目", 256),
    workspaceDomain: { id: domain.id, title: boundedText(domain.title, 64) },
    modelName: boundedText(input.modelName, 256),
    statusText: agentWindowStatusText(input),
    busy: Boolean(input.busy),
    paused: Boolean(input.paused),
    stopPending: Boolean(input.stopPending),
    prompt: boundedText(input.prompt, maximumPromptChars),
    messages,
    conversations: conversations.map((item) => ({
      id: boundedText(item.id, 256),
      title: boundedText(item.title || "未命名会话", 512),
      updatedAt: boundedText(item.updatedAt, 128),
      active: item.id === input.activeConversationId
    })),
    activeConversationId: boundedText(input.activeConversationId, 256),
    selectedArtifactCount: boundedCount(input.selectedArtifactCount),
    sourceImageCount: boundedCount(input.sourceImageCount),
    referenceImageCount: boundedCount(input.referenceImageCount),
    goal: agentWindowGoalState(input.goal),
    theme: input.theme,
    themePalette: input.themePalette,
    customTheme: input.customTheme,
    glassAppearance: {
      ...appearance.settings,
      mode: appearance.mode,
      resolvedAccent: appearance.resolvedAccent,
      variables: appearance.variables
    },
    updatedAt: Date.now()
  };
}

export function normalizeAgentWindowCommand(value: unknown): AgentWindowCommand | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const type = String(payload.type || "");
  if (["creation-requirements-update", "creation-decision", "creation-revision", "creation-region-revision", "creation-check"].includes(type)) {
    const input = payload.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 2_000_000) return null;
    const validId = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 180 && !/[\\/\u0000-\u001f]/.test(value);
    if (!validId(input.expectedProjectId) || !validId(input.conversationId) || (input.requirementId !== undefined && !validId(input.requirementId))
      || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) return null;
    const changesValid = (list: unknown) => Array.isArray(list) && list.length <= 200 && list.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 2000);
    const identityValid = (value: unknown) => { const target = value as Record<string, unknown>; return target && typeof target === "object" && !Array.isArray(target) && Object.keys(target).every(key => ["assetId", "occurrenceId", "contentHash"].includes(key))
      && validId(target.assetId) && validId(target.occurrenceId) && typeof target.contentHash === "string" && /^[a-f0-9]{64}$/.test(target.contentHash); };
    const targetValid = (value: unknown) => { const target = value as Record<string, unknown>; return target && typeof target === "object" && !Array.isArray(target) && Object.keys(target).every(key => ["assetId", "occurrenceId", "contentHash", ...(["creation-revision", "creation-region-revision"].includes(type) ? ["preserve", "changes"] : []), ...(type === "creation-revision" ? ["mask"] : [])].includes(key))
      && validId(target.assetId) && validId(target.occurrenceId) && typeof target.contentHash === "string" && /^[a-f0-9]{64}$/.test(target.contentHash)
      && (target.preserve === undefined || changesValid(target.preserve)) && (target.changes === undefined || changesValid(target.changes)) && (target.mask === undefined || identityValid(target.mask)); };
    if (type === "creation-decision" && (!targetValid(input.target) || !["adopt", "reject", "candidate"].includes(String(input.decision)) || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 2000)))) return null;
    if (["creation-revision", "creation-check"].includes(type) && (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 200 || !input.targets.every(targetValid))) return null;
    if (type === "creation-revision" && (!validId(input.requirementId) || !validId(input.submissionId) || !/^[a-zA-Z0-9_.:@-]+$/.test(String(input.submissionId))
      || ![input.preserve, input.changes].every(changesValid) || (!(input.changes as unknown[]).length && !(input.targets as Record<string, unknown>[]).every(target => (target.changes as unknown[] | undefined)?.length)))) return null;
    if (type === "creation-revision" && (input.targets as Record<string, unknown>[]).some(target => target.mask !== undefined) && (input.targets as unknown[]).length !== 1) return null;
    if (type === "creation-region-revision" && (!validId(input.requirementId) || !targetValid(input.target) || ![input.preserve, input.changes].every(changesValid)
      || Object.keys(input).some(key => !["expectedProjectId", "conversationId", "requirementId", "expectedRevision", "target", "preserve", "changes"].includes(key)))) return null;
    if (type === "creation-requirements-update" && (!input.requirements || typeof input.requirements !== "object" || Array.isArray(input.requirements))) return null;
    return { type, input } as AgentWindowCommand;
  }
  if ([
    "request-state",
    "closed",
    "pause-confirmed",
    "resume",
    "stop-confirmed",
    "new-conversation-confirmed",
    "clear-conversation-confirmed",
    "edit-sources",
    "edit-references",
    "edit-memory",
    "edit-image-config",
    "task-action"
  ].includes(type)) return { type } as AgentWindowCommand;
  if (type === "task-answer") {
    if (!["taskId", "projectId", "conversationId", "questionId"].every(key => typeof payload[key] === "string" && String(payload[key]).trim().length > 0 && String(payload[key]).length <= 180)
      || !Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1) return null;
    return { type, taskId: String(payload.taskId), projectId: String(payload.projectId), conversationId: String(payload.conversationId),
      questionId: String(payload.questionId), expectedVersion: Number(payload.expectedVersion),
      ...(payload.optionId ? { optionId: boundedText(payload.optionId, 80) } : {}), ...(payload.answer ? { answer: boundedText(payload.answer, 4000) } : {}) };
  }
  if (type === "set-prompt") {
    return { type, prompt: boundedText(payload.prompt, maximumPromptChars) };
  }
  if (type === "send") {
    const allowedModes = new Set<AgentSteerTaskScopeMode | "auto">([
      "auto",
      "keep",
      "replace-source",
      "merge-source",
      "replace-reference",
      "merge-reference",
      "clear-attachments"
    ]);
    const taskScopeMode = String(payload.taskScopeMode || "auto") as AgentSteerTaskScopeMode | "auto";
    const taskMode = payload.taskMode === "goal" ? "goal" : "standard";
    if (taskMode === "goal") {
      const expectedSnapshotHash = boundedText(payload.expectedSnapshotHash, 80).trim().toLowerCase();
      if (payload.goalConfirmed !== true || !goalConfirmationHashPattern.test(expectedSnapshotHash)) return null;
      return {
        type,
        prompt: boundedText(payload.prompt, maximumPromptChars),
        taskScopeMode: "auto",
        taskMode,
        goalConfirmed: true,
        expectedSnapshotHash
      };
    }
    return {
      type,
      prompt: boundedText(payload.prompt, maximumPromptChars),
      taskScopeMode: allowedModes.has(taskScopeMode) ? taskScopeMode : "auto",
      taskMode
    };
  }
  if (type === "switch-conversation") {
    const conversationId = boundedText(payload.conversationId, 256).trim();
    return conversationId ? { type, conversationId } : null;
  }
  if (type === "dock" && ["right", "left", "top", "bottom", "floating"].includes(String(payload.placement || ""))) {
    return { type, placement: String(payload.placement) as Extract<AgentWindowCommand, { type: "dock" }>["placement"] };
  }
  return null;
}
