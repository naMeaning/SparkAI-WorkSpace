export type CreationSource = "user" | "assumption";
export type CreationText = { text: string; source: CreationSource };
export type CreationCriterion = CreationText & { criterionId: string; slotIds?: string[]; kind?: "visual" | "source_consistency"; sourceTargets?: CreationTarget[] };
export type CreationSlot = { slotId: string; label: string; source: CreationSource };
export type CreationFileRules = {
  formats?: ("png" | "jpeg" | "webp" | "avif" | "tiff")[];
  minWidth?: number; minHeight?: number; width?: number; height?: number;
  alpha?: "any" | "required" | "forbidden";
};
export type CreationRequirementsBody = {
  goal: CreationText; usage: CreationText; slots: CreationSlot[];
  preserve: CreationCriterion[]; adjustable: CreationCriterion[]; conditions: CreationCriterion[];
  fileRules?: CreationFileRules;
};
export type CreationRequirements = CreationRequirementsBody & {
  requirementId: string; conversationId: string; revision: number; fingerprint: string;
};
export type CreationRequirementRef = { requirementId: string; revision: number; fingerprint: string };
export type CreationTarget = { assetId: string; occurrenceId: string; contentHash: string };
export type CreationFileCheck = {
  status: "passed" | "failed"; checkedAt: string; contentHash: string;
  width?: number; height?: number; format?: string; hasAlpha?: boolean;
  issues: { code: string; message: string; hard: true }[];
};
export type CreationVisualReview = {
  reviewId: string; verdict: "pass" | "revise" | "uncertain"; reviewedAt: string;
  summary?: string; findings: { criterionId: string; status: "pass" | "fail" | "uncertain"; note: string }[];
  modelRoundId: string; runId: string;
};
export type CreationAcceptanceResult = {
  target: CreationTarget; label: string; generated: boolean; saved: boolean; slotId?: string;
  inProject?: boolean; fileSaved?: boolean;
  previewUrl?: string;
  baseline?: { target: CreationTarget; label: string; previewUrl?: string };
  fileCheck?: CreationFileCheck; visualReview?: CreationVisualReview;
  decision: { state: "candidate" | "approved" | "rejected"; reason?: string };
  current: boolean; invalidReasons: string[];
};
export type CreationSessionSnapshot = {
  projectId: string; conversationId: string; requirements: CreationRequirements | null;
  requirementRef?: CreationRequirementRef | null; results: CreationAcceptanceResult[];
};
export type CreationLocator = { expectedProjectId: string; conversationId: string; requirementId?: string; taskId?: string };
export type CreationRequirementsUpdate = CreationLocator & { expectedRevision: number; requirements: CreationRequirementsBody };
export type CreationDecisionInput = CreationLocator & {
  expectedRevision: number; target: CreationTarget; decision: "adopt" | "reject" | "candidate"; reason?: string;
};
export type CreationCheckInput = CreationLocator & { expectedRevision: number; targets: CreationTarget[] };
export type CreationRevisionTarget = CreationTarget & { preserve?: string[]; changes?: string[]; mask?: CreationTarget };
export type CreationRevisionInput = CreationLocator & {
  submissionId: string; requirementId: string; expectedRevision: number;
  targets: CreationRevisionTarget[]; preserve: string[]; changes: string[];
};
export type CreationRegionRevisionInput = CreationLocator & {
  requirementId: string; expectedRevision: number; target: CreationRevisionTarget;
  preserve: string[]; changes: string[];
};
export type CreationCommand = "creation.requirements.get" | "creation.requirements.update" | "creation.acceptance.get"
  | "creation.acceptance.check" | "creation.acceptance.decide" | "creation.revision.start";
export type CreationResponse = Partial<CreationSessionSnapshot> & {
  ok: boolean; error?: string; errorCode?: string; task?: import("./agent-task").AgentTaskReceipt;
  accepted?: boolean; requirementRef?: CreationRequirementRef | null;
};
export type CreationSessionPanelProps = {
  creationSession?: CreationSessionSnapshot | null; creationBusy?: boolean; creationError?: string;
  executionBusy?: boolean;
  onUpdateCreationRequirements?: (input: CreationRequirementsUpdate) => void | Promise<unknown>;
  onCreationDecision?: (input: CreationDecisionInput) => void | Promise<unknown>;
  onStartCreationRevision?: (input: CreationRevisionInput) => void | Promise<unknown>;
  onRegionRevision?: (input: CreationRegionRevisionInput) => void | Promise<unknown>;
  onCheckCreationAcceptance?: (input: CreationCheckInput) => void | Promise<unknown>;
};

export function creationTargetKey(target: CreationTarget) {
  return JSON.stringify([target.assetId, target.occurrenceId, target.contentHash]);
}

export { creationResultStatus, creationSessionSummary } from "../runtime/creation-session-status.mjs";
