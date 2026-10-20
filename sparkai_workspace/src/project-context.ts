import type { ProjectKnowledgeEntry, ProjectKnowledgeScope, ProjectKnowledgeSnapshot } from "../runtime/project-knowledge-contract.mjs";
import type { RequirementTemplateSnapshot } from "../runtime/requirement-template-contract.mjs";
import type { CreationTarget } from "./creation-session";

export type ProjectContextCommand = "project.context.get" | "project.knowledge.list" | "project.knowledge.save"
  | "project.knowledge.status" | "project.knowledge.promote" | "project.knowledge.history"
  | "project.results.search" | "project.results.use";
export type ProjectKnowledgeItem = ProjectKnowledgeEntry & { usable?: boolean; invalidReasons?: string[] };
export type ProjectScopeOption = { scope: ProjectKnowledgeScope; label: string };
export type ProjectSearchQuery = {
  text?: string; usage?: string; objectId?: string; source?: Partial<CreationTarget> & { nodeId?: string };
  adoption?: "any" | "approved" | "candidate" | "rejected";
  description?: { text: string; source?: "any" | "observed" | "intended" };
};
export type ProjectResultItem = {
  target: CreationTarget; nodeId: string; assetIndex: number; name: string;
  locations: { nodeId: string; assetIndex: number }[]; tags: string[]; usage: string[];
  objects: { type: string; id: string; productId: string; label: string }[];
  sources: { target: CreationTarget; nodeId?: string; relation: string }[];
  intended: string; observation: { status: "observed" | "unobserved" | "stale"; summary?: string };
  adoption: { state: "approved" | "candidate" | "rejected"; current: boolean; recordedState?: string };
  summary: string; width?: number; height?: number; createdAt: string;
  matchReasons: { field: string; source: string; value: string }[];
};
export type ProjectResultSearchSnapshot = {
  projectId: string; total: number; offset: number; limit: number; hasMore: boolean; results: ProjectResultItem[];
};
export type ProjectContextSnapshot = {
  projectId: string; conversationId: string; revision: number; entries: ProjectKnowledgeItem[];
  total: number; objects: ProjectKnowledgeScope[]; nextOffset?: number;
  scopeOptions?: ProjectScopeOption[]; scopeOptionsTruncated?: boolean;
  usedKnowledge?: ProjectKnowledgeSnapshot; usedTemplate?: RequirementTemplateSnapshot;
  search?: ProjectResultSearchSnapshot;
};
export type ProjectContextResponse = Partial<ProjectContextSnapshot & ProjectResultSearchSnapshot> & {
  ok: boolean; error?: string; errorCode?: string; entry?: ProjectKnowledgeEntry;
};
export type ProjectContextPanelProps = {
  projectContext?: ProjectContextSnapshot | null; contextBusy?: boolean; contextError?: string;
  onContextCommand?: (command: ProjectContextCommand, args: Record<string, unknown>) => unknown | Promise<unknown>;
  onLocateResult?: (target: CreationTarget) => unknown | Promise<unknown>;
  onUseResults?: (targets: CreationTarget[], role: "source" | "reference") => unknown | Promise<unknown>;
  onCompareResults?: (targets: CreationTarget[]) => unknown | Promise<unknown>;
};

export { contextTargetKey, knowledgeTypeLabel, knowledgeStatusLabel, knowledgeScopeLabel, knowledgeScopeOptions,
  emptyKnowledgeDraft, knowledgeDraftFor, knowledgeInputFromDraft, emptyResultSearchDraft, resultSearchInput,
  resultObservationLabel, resultAdoptionLabel, resultReasonText, projectContextWindowProjection } from "../runtime/project-context-presentation.mjs";
