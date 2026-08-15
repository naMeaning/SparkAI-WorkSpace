/*
naimage Core Map

File Contract
- core.ts is the compatibility-oriented shared domain module: bridge/types, image generation rules, prompt helpers, canvas utilities, and project/session normalization.
- Settings/storage, asset identity, and paste blocks have focused owners; import those modules directly for new code.
- It is allowed to define Electron/server bridge types, image sizing rules, and pure workflow data transforms.
- It must not render React UI and must not own long-running Agent execution state.

Region Index
01 Shared Types And Bridge Contracts
   Theme/app settings, workflow nodes, Agent tool traces, image assets, server/config/agent bridges, and AIDebug window hooks.
02 Settings And Local Persistence
   Moved to settings-persistence.ts; core.ts keeps shared setting types only.
03 Formatting And Labels
   Currency, durations, model labels, user-facing error cleanup, and prompt error splitting.
04 Image Generation Options, Model Capability, And Size Rules
   Model family/capability labels, frame/size/quality options, gpt-image-2 validation, image task defaults, size summaries, and reference limits.
05 Prompt Intent And Multi-Image Prompt Utilities
   Image intent heuristics, multi-image prompt splitting, and independent-image prompt guardrails.
05B Paste Block Utilities
   Pasted block formatting, cloning, line counts, and image-paste guards.
06 Workflow Clone Utilities
   Safe workflow, image task, asset, and reference-image cloning.
06B Conversation And Session Utilities
   Conversation snapshots, stored-message cleanup, and project/session normalization helpers.
07 Image Asset, Layer, And Canvas Utilities
   Asset URLs/names, MIME detection, local asset bridge reads, canvas image loading, layer compositing, and mask export.
08 Prompt Style Library
   Style-category data, selection lookup, style prompt composition, and prompt merge behavior.
*/

import {
  imageAssetIdentityFingerprint,
  reconcileImageAssetIdentityClaims,
  safeImageLocatorText,
  safeImageSourceRelativePath,
  stableIdentityHash,
  stableImageAssetId,
  stableImageOccurrenceId
} from "./asset-identity.ts";
import { collapseDuplicateToolTimelineMessages } from "./tool-timeline.ts";
import type { PluginInstallationState } from "./plugin-state.ts";
import type {
  CommerceCatalogAssetKind,
  CommerceCatalogAssetLocator,
  CommerceCatalogAssetOwnerType,
  CommerceCatalogGoalTarget,
  CommerceCatalogProductDraft,
  CommerceCatalogResult,
  CommerceCatalogResultState
} from "./commerce-catalog.ts";
import type {
  CommerceExportPackageResult,
  CommerceExportPreviewResult,
  CommerceExportRequest
} from "./commerce-export.ts";
import type { CommerceTemplateResult } from "./commerce-template.ts";
import type { CommerceSetPlan } from "./plugins/commerce-set.ts";
import { remoteAssetDisplaySource } from "./remote-asset-source.ts";
import type {
  GlassMaterialId,
  GlassParameters,
  GlassThemeId
} from "./glass-theme.ts";

export {
  imageAssetIdentityFingerprint,
  reconcileImageAssetIdentityClaims,
  safeImageLocatorText,
  safeImageSourceRelativePath,
  stableImageAssetId,
  stableImageOccurrenceId
} from "./asset-identity.ts";
export {
  blockImagePaste,
  clipboardHasImage,
  clonePasteBlocks,
  composePromptWithPasteBlocks,
  countTextLines,
  isOversizedPaste,
  pasteBlockMarkdown,
  pasteBlockSummary,
  shouldCreatePasteBlock,
  visiblePromptWithPasteBlocks
} from "./paste-blocks.ts";
export type {
  GlassAccentId,
  GlassMaterialId,
  GlassMaterialPresetId,
  GlassNumericParameterKey,
  GlassNumericParameters,
  GlassParameters,
  GlassThemeId,
  GlassThemeMode,
  GlassThemeSettings
} from "./glass-theme.ts";

// -----------------------------------------------------------------------------
// CORE 01 Shared Types And Bridge Contracts
// -----------------------------------------------------------------------------

export type ThemeChoice = "system" | "light" | "dark";
export type ThemePaletteChoice =
  | "default"
  | "anthropic"
  | "simple-large"
  | "underground"
  | "rose-garden"
  | "lake-view"
  | "sunset-glow"
  | "forest-whisper"
  | "ocean-breeze"
  | "lavender-dream"
  | "custom";
export type CustomThemeColorKey =
  | "--theme-bg"
  | "--theme-canvas"
  | "--theme-surface"
  | "--theme-surface-raised"
  | "--theme-ink"
  | "--theme-muted"
  | "--theme-line"
  | "--theme-accent"
  | "--theme-rose"
  | "--theme-green";
export type CustomThemeMode = Record<CustomThemeColorKey, string>;
export type CustomThemePreset = {
  schemaVersion: 1;
  type: "naimage-theme";
  name: string;
  light: CustomThemeMode;
  dark: CustomThemeMode;
};
export type AgentProviderChoice = "CODEX" | "CUSTOM";
export type AccessMode = "account" | "custom";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ContextStrategyId = "auto" | "codex" | "claude" | "naimage-balanced" | "custom";
export type MessageRole = "user" | "assistant" | "system";
export type AgentStatus = "idle" | "thinking" | "editing" | "error";
export type NodeStatus = "queued" | "working" | "review" | "done";
export type ImageModelFamily = "gpt-image-2" | "gpt-image-1.5" | "gpt-image-1" | "compatible";
export type ImageLayerBlendMode = "normal" | "multiply" | "screen" | "overlay" | "source-over";
export type WorkspaceAssetRailTabId = "results" | "layers" | "requirements" | "templates" | "history";

export type GlassBackgroundAssetMetadata = {
  mimeType: "image/webp";
  width: number;
  height: number;
  bytes: number;
};

export type GlassBackgroundAsset = GlassBackgroundAssetMetadata & {
  schemaVersion: 1;
  assetId: string;
  name?: string;
};

export type GlassBackgroundResult = {
  ok: boolean;
  canceled?: boolean;
  cleared?: boolean;
  retained?: boolean;
  retainedUntil?: number;
  garbageCollected?: number;
  assetId?: string;
  asset?: GlassBackgroundAsset;
  dataUrl?: string;
  errorCode?: string;
  error?: string;
};

export type ModelConnectionBinding = {
  model: string;
  customBaseUrl?: string;
  customApiKey?: string;
  accountTokenId?: string;
};

export type AgentModelBinding = ModelConnectionBinding;
export type ImageModelBinding = ModelConnectionBinding;

export type ImageFrameRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | "9:21" | "4:5";
export type ImageResolutionPreset = "1K" | "2K" | "4K";

export type ApiSettings = {
  accessMode: AccessMode;
  agentProvider: AgentProviderChoice;
  agentBaseUrl: string;
  agentApiKey: string;
  agentModel: string;
  agentModelPool: string[];
  agentModelBindings: AgentModelBinding[];
  compactModel: string;
  contextStrategy: ContextStrategyId;
  contextWindowTokens: number;
  contextEffectiveWindowPercent: number;
  contextAutoCompactPercent: number;
  contextRetainedUserTokens: number;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  timeoutSeconds: number;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageModelPool: string[];
  imageModelBindings: ImageModelBinding[];
  /** Default video model used by the future video execution path. */
  videoModel: string;
  /** Video models selected for later multi-model dispatch. */
  videoModelPool: string[];
  imageCount: number;
  /** Number of image requests dispatched together before the next ordered batch. */
  imageBatchSize: number;
  /** Default output frame used when the current image task does not override it. */
  imageRatio: ImageFrameRatio;
  /** User-facing output clarity tier. Legacy 720P/1080P values migrate to 1K. */
  imageResolution: ImageResolutionPreset;
  /** Legacy computed size retained for older projects and provider adapters. */
  imageSize: string;
  imageQuality: "low" | "medium" | "high" | "auto";
  accountBaseUrl: string;
  relayBaseUrl: string;
  updateBaseUrl: string;
  networkProxyUrl: string;
  serverToken: string;
  serverSessionCookie: string;
  serverUserId: string;
  selectedAccountTokenId: string;
  selectedAccountTokenName: string;
  selectedAccountTokenGroup: string;
  licenseDeviceId: string;
  licenseToken: string;
  licensePlan: string;
  licenseExpiresAt: number;
  licenseLastVerifiedAt: number;
};

export type AppSettings = ApiSettings & {
  modelGroup: string;
  /** Legacy light/dark and palette fields remain readable for project compatibility. */
  theme: ThemeChoice;
  themePalette: ThemePaletteChoice;
  customTheme: CustomThemePreset | null;
  glassTheme: GlassThemeId;
  glassMaterial: GlassMaterialId;
  glassParameters: GlassParameters;
  glassBackgroundEnabled: boolean;
  glassBackgroundAssetId: string;
  glassBackgroundAssetName: string;
  glassBackgroundAssetMetadata: GlassBackgroundAssetMetadata | null;
  glassBackgroundOverlay: number;
  glassBackgroundBlur: number;
  agentPanelPlacement: "right" | "left" | "top" | "bottom" | "floating";
  agentPanelWidth: number;
  agentPanelHeight: number;
  agentPanelX: number;
  agentPanelY: number;
  agentSkillAutoInstallTargets: AgentIntegrationTargetId[];
  workspacePluginDefaultsVersion: number;
  pluginStates: PluginInstallationState[];
  canvasToolDockMode: "expanded" | "hover";
  /** Commands hidden from visual tool surfaces; plugin execution and shortcuts stay enabled. */
  disabledCanvasToolCommands: string[];
  canvasToolShortcuts: Record<string, string>;
  visibleWorkspaceAssetRailTabs: WorkspaceAssetRailTabId[];
  /** Installation-level flags only; no user brief or generated content is stored here. */
  workflowOnboarding: WorkflowOnboardingState;
};

export type WorkflowOnboardingState = {
  social?: boolean;
  xiaohongshu?: boolean;
  douyin?: boolean;
  research?: boolean;
  commerce?: boolean;
};

export type AgentIntegrationTargetId = "codex" | "claude-code" | "opencode" | "openclaw";

export type AgentIntegrationTarget = {
  id: AgentIntegrationTargetId;
  label: string;
  configPath: string;
  skillsPath: string;
  detected: boolean;
  installed: boolean;
  installError?: string;
};

export type AgentIntegrationBridge = {
  detect(): Promise<{ ok: boolean; targets?: AgentIntegrationTarget[]; endpointPath?: string; error?: string }>;
  install(payload: { targets: AgentIntegrationTargetId[] }): Promise<{ ok: boolean; targets?: AgentIntegrationTarget[]; installed?: AgentIntegrationTargetId[]; errors?: string[]; error?: string }>;
  remove(payload: { targets: AgentIntegrationTargetId[] }): Promise<{ ok: boolean; targets?: AgentIntegrationTarget[]; removed?: AgentIntegrationTargetId[]; errors?: string[]; error?: string }>;
};

export type AutomationBridge = {
  ready(): Promise<{ ok: boolean; error?: string }>;
  onRequest(handler: (payload: { requestId: string; command: string; args?: Record<string, unknown> }) => void | Promise<unknown>): () => void;
  respond(payload: {
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    code?: string;
    details?: Record<string, unknown>;
  }): void;
};

export type AgentWindowBridge = {
  open(): Promise<{ ok: boolean; open?: boolean; reused?: boolean; windowId?: number; error?: string }>;
  close(): Promise<{ ok: boolean; open?: boolean; error?: string }>;
  status(): Promise<{ ok: boolean; open?: boolean; owner?: boolean; windowId?: number; error?: string }>;
  publishState(payload: unknown): void;
  onCommand(handler: (payload: unknown) => void | Promise<void>): () => void;
};

export type AgentMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: "done" | "running" | "error";
  meta?: string;
  hidden?: boolean;
  pasteBlocks?: PasteBlock[];
  attachments?: AgentMessageAttachments;
  collapsed?: boolean;
  toolTrace?: AgentToolTrace;
};

export type AgentToolTrace = {
  stage?: "start" | "result";
  operationId?: string;
  label: string;
  name: string;
  operation: string;
  params: string;
  brief: string;
  prompts?: { title?: string; prompt: string }[];
  completionText?: string;
};

export type AgentConversation = {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
};

export type PasteBlock = {
  id: string;
  text: string;
  createdAt: string;
};

export type CanvasRequirementInputBinding = {
  nodeId: string;
  role: AssetTaskRole;
};

export type CanvasSkill = {
  version: 1;
  /** Skill frontmatter name. Kept separately from the editable canvas title. */
  name: string;
  description?: string;
  /** File label only; absolute source paths are never persisted in a project. */
  sourceName?: string;
  /** Deterministic content identity used to recognize an exact re-import. */
  contentFingerprint: string;
  importedAt: string;
  /** Set when imported instructions are edited locally; the import fingerprint remains source identity. */
  locallyModifiedAt?: string;
};

export type ImportedCanvasSkill = CanvasSkill & {
  instructions: string;
};

export type SocialPlatform = "xiaohongshu" | "douyin";
export type SocialContentType = "brief" | "title" | "post" | "cover" | "card" | "script" | "shot" | "video" | "publish-package";
export type SocialContentStatus = "draft" | "approved" | "generated" | "exported";

export type SocialContentMetadata = {
  platform: SocialPlatform;
  contentType: SocialContentType;
  workflowId: string;
  slot?: string;
  variant?: number;
  status?: SocialContentStatus;
};

export type XiaohongshuSocialCard = {
  id: string;
  order: number;
  title: string;
  copy: string;
  prompt: string;
  status: SocialContentStatus;
};

export type XiaohongshuSocialPlan = {
  schemaVersion: 1;
  platform: "xiaohongshu";
  workflowId: string;
  planHash: string;
  contentKind: "product-seeding" | "tutorial" | "comparison" | "knowledge" | "list" | "experience-share" | "travel";
  brief: string;
  audience: string;
  objective: string;
  language: string;
  ratio: "3:4" | "4:5" | "1:1";
  cardCount: number;
  titleCandidateCount: number;
  titleCandidates: string[];
  recommendedTitle: string;
  body: string;
  tags: string[];
  cover: { enabled: boolean; title: string; prompt: string; status: SocialContentStatus };
  cards: XiaohongshuSocialCard[];
  status: SocialContentStatus;
};

export type DouyinSocialShot = {
  id: string;
  order: number;
  durationSeconds: number;
  narration: string;
  visual: string;
  prompt: string;
  status: SocialContentStatus;
};

export type DouyinSocialPlan = {
  schemaVersion: 1;
  platform: "douyin";
  workflowId: string;
  planHash: string;
  format: "image-to-video" | "product-showcase" | "voiceover-assets" | "knowledge" | "experience-share";
  brief: string;
  audience: string;
  objective: string;
  language: string;
  ratio: "9:16";
  durationSeconds: 15 | 30 | 60;
  subtitlesEnabled: boolean;
  shotCount: number;
  hooks: string[];
  title: string;
  script: string;
  subtitleText: string;
  tags: string[];
  shots: DouyinSocialShot[];
  cover: { title: string; prompt: string; status: SocialContentStatus };
  videoTaskId: string;
  videoNodeId: string;
  status: SocialContentStatus;
};

export type SocialContentPlan = XiaohongshuSocialPlan | DouyinSocialPlan;

export type ScientificFigureBackend = "python" | "r";
export type ScientificFigureType = "statistical-chart" | "multi-panel" | "schematic" | "workflow" | "image-comparison";
export type ScientificFigureArchetype = "quantitative-grid" | "schematic-led-composite" | "image-plate-quant" | "asymmetric-mixed-modality";
export type ScientificFigureOutputFormat = "png" | "tiff" | "svg" | "pdf";
export type ScientificFigureStatus = "planned" | "rendered" | "failed";

export type ScientificDataSource = {
  id: string;
  sourceName: string;
  contentHash: string;
  size: number;
  rowCount: number;
  columnCount: number;
  fields: string[];
  delimiter: "," | "\t";
};

export type ScientificFigurePanel = {
  id: string;
  label?: string;
  title?: string;
  chartType: "scatter" | "line" | "bar" | "box" | "violin" | "histogram" | "heatmap" | "image" | "schematic";
  sourceBindings: string[];
  description: string;
  xField: string;
  yFields: string[];
  groupField: string;
  status: ScientificFigureStatus;
};

export type ScientificFigurePlan = {
  schemaVersion: 1;
  workflowId: string;
  planHash: string;
  /** Null is allowed only while the UI is asking the blocking Python/R question. Persisted runnable plans require a backend. */
  backend: ScientificFigureBackend | null;
  figureType: ScientificFigureType;
  archetype: ScientificFigureArchetype;
  researchClaim: string;
  targetJournal: string;
  dimensions: { widthMm: number; heightMm: number; dpi: number };
  dataSources: ScientificDataSource[];
  panels: ScientificFigurePanel[];
  outputFormats: ScientificFigureOutputFormat[];
  stylePreset: string;
  evidenceHierarchy: {
    heroEvidence: string;
    validationEvidence: string;
    controlsRobustness: string;
  };
  statisticsNotes: string;
  sourceDataNotes: string;
  imageIntegrityNotes: string;
  reviewerRisks: string[];
  placeholderData: boolean;
  status: ScientificFigureStatus;
  taskId: string;
};

export type ScientificFigureMetadata = {
  workflowId: string;
  planHash: string;
  kind: "plan" | "panel" | "figure" | "preview";
  panelId?: string;
  backend?: ScientificFigureBackend;
  taskId?: string;
  scriptHash?: string;
  dataHashes?: string[];
  status?: ScientificFigureStatus;
};

export type SocialExportRequest = {
  expectedProjectId: string;
  requirementNodeId: string;
  expectedRequirementRevision?: number;
  workflowId?: string;
};

export type SocialExportResult = {
  ok: boolean;
  canceled?: boolean;
  exported?: boolean;
  projectId?: string;
  requirementNodeId?: string;
  requirementRevision?: number;
  workflowId?: string;
  planHash?: string;
  platform?: SocialPlatform;
  title?: string;
  folderName?: string;
  manifest?: string;
  fileCount?: number;
  images?: number;
  videos?: number;
  summary?: { images: number; videos: number; missingSlots: string[] };
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type RequirementLibraryEntry = {
  version: 1;
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  text?: string;
  skill?: CanvasSkill;
  socialPlan?: SocialContentPlan;
  scientificPlan?: ScientificFigurePlan;
};

export type RequirementLibraryResult = {
  ok: boolean;
  schemaVersion?: 1;
  libraryRevision?: number;
  items?: RequirementLibraryEntry[];
  entry?: RequirementLibraryEntry;
  changed?: boolean;
  id?: string;
  deletedRevision?: number;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export function sanitizeCanvasSkill(value: unknown): CanvasSkill | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<CanvasSkill>;
  const clean = (input: unknown, maximum: number) => typeof input === "string"
    ? input.replace(/\u0000/g, "").trim().slice(0, maximum)
    : "";
  const name = clean(source.name, 120);
  const description = clean(source.description, 2_000);
  const sourceName = clean(clean(source.sourceName, 1_000).replace(/\\/g, "/").split("/").pop(), 180);
  const contentFingerprint = clean(source.contentFingerprint, 48).toLowerCase();
  const importedAt = clean(source.importedAt, 80);
  const locallyModifiedAt = clean(source.locallyModifiedAt, 80);
  if (source.version !== 1 || !name || !/^skill-[a-f0-9]{32}$/.test(contentFingerprint) || !importedAt) return undefined;
  return {
    version: 1,
    name,
    ...(description ? { description } : {}),
    ...(sourceName ? { sourceName } : {}),
    contentFingerprint,
    importedAt,
    ...(locallyModifiedAt ? { locallyModifiedAt } : {})
  };
}

export type CanvasRequirement = {
  version: 1 | 2;
  text: string;
  revision: number;
  createdFrom: "canvas" | "node" | "container" | "layer";
  /** Explicit reusable task inputs. Legacy single-source requirements fall back to WorkflowNode.parentId. */
  inputBindings?: CanvasRequirementInputBinding[];
  lastSourceSignature?: string;
  lastRunAt?: string;
  lastRunCount?: number;
  lastError?: string;
  /** Imported SKILL.md identity. Execution still uses the requirement/TaskScope path. */
  skill?: CanvasSkill;
  /** Structured social copy/shot plan; persisted on the existing Requirement primitive. */
  socialPlan?: SocialContentPlan;
  /** Structured claim/evidence/Panel plan; persisted on the existing Requirement primitive. */
  scientificPlan?: ScientificFigurePlan;
};

export type AgentTaskScopeType = "none" | "single" | "multi-source" | "container" | "container-group" | "layer" | "layer-group" | "mixed";
export type AgentTaskResultPolicy = "single" | "grouped-by-source" | "grouped-by-container" | "layer-variants";
export type AgentTaskConfirmationPolicy = "auto" | "preview-3" | "staged" | "direct";
export type AgentTaskRequirementSnapshot = {
  nodeId: string;
  revision: number;
  sourceSignature?: string;
};

/** Immutable execution boundary captured when Goal mode targets the canvas. */
export type AgentGoalTaskScopeMetadata = {
  version: 1;
  target: "all-image-containers";
  frozen: true;
  containerIds: string[];
  bindingIds: string[];
  containerCount: number;
  bindingCount: number;
  configuredConcurrency: number;
  probeContainerCount: number;
  /** User-confirmed provider operations for every frozen SOURCE binding. */
  operationsPerAsset: number;
  /** Immutable maximum provider requests: bindingCount * operationsPerAsset. */
  requestCount: number;
  /** Present only when the trusted task prompt contains a validated commerce plan. */
  commercePlanHash?: string;
  /** Unambiguous project Catalog destinations, ordered by frozen bindingIds. */
  commerceCatalogTargets?: CommerceCatalogGoalTarget[];
};

export type ImageTaskProvenance = {
  version: 1;
  taskScopeSnapshotHash: string;
  resultPolicy: AgentTaskResultPolicy;
  sourceBindingId?: string;
  sourceAssetId?: string;
  sourceOccurrenceId?: string;
  sourceNodeId?: string;
  sourceContainerId?: string;
  sourceDisplayCode?: string;
  requirementNodeId?: string;
  requirementRevision?: number;
  commercePlanHash?: string;
  commerceSlotId?: string;
  commerceSlotIndex?: number;
  commerceLocaleCode?: string;
  commerceCatalogTarget?: CommerceCatalogGoalTarget;
  commerceResultKey?: string;
  socialContent?: SocialContentMetadata;
  scientificFigure?: ScientificFigureMetadata;
};

export type AgentAskUserOption = {
  id: string;
  label: string;
  description?: string;
  answer: string;
  recommended?: boolean;
};

export type WorkflowNode = {
  id: string;
  /** Stable writer identity used to merge same-project saves from multiple Renderer windows. */
  persistenceOriginId?: string;
  displayCode?: string;
  assetSequence?: number;
  title: string;
  prompt: string;
  type: "intent" | "image" | "video" | "requirement" | "review" | "export" | "branch" | "post" | "agent";
  status: NodeStatus;
  x: number;
  y: number;
  parentId?: string;
  relationType?: "derived-from" | "referenced" | "variant" | "grouped";
  /** @deprecated Legacy Agent-node ownership. Read only for project migration. */
  agentOwnerId?: string;
  branch: string;
  outputs: number;
  createdAt: string;
  agentConversationId?: string;
  agentInitState?: "checking" | "awaiting-brief" | "ready" | "error";
  agentLastMemoryEntryId?: string;
  assets?: ImageAsset[];
  /** Managed local video result metadata. Video nodes do not use image assets. */
  videoAsset?: VideoAsset;
  videoState?: "empty" | "generating" | "ready" | "error";
  videoError?: string;
  videoModel?: string;
  /** Local durable video task identity used to reconnect journal state after restart. */
  videoTaskId?: string;
  videoTaskState?: VideoTaskState;
  videoProgress?: number;
  imageState?: "generating" | "done" | "empty" | "error";
  imageError?: string;
  imageParams?: ImageTaskDraft;
  imageProgress?: ImageNodeProgress;
  generationRunId?: string;
  layerGroup?: ImageLayerNodeGroup;
  /** @deprecated Legacy single-node layer stack. Migrated into independent layer nodes on load. */
  layerComposition?: ImageLayerComposition;
  imageContainer?: boolean;
  imageContainerRole?: AssetTaskRole;
  imageContainerSpec?: ImageContainerSpec;
  imageCollection?: ImageCollection;
  taskProvenance?: ImageTaskProvenance;
  /** Lightweight social identity for Requirement, image or video成果. */
  socialContent?: SocialContentMetadata;
  /** Lightweight scientific plan/result identity. Data, scripts and task journals remain project-managed Main assets. */
  scientificFigure?: ScientificFigureMetadata;
  requirement?: CanvasRequirement;
  width?: number;
  height?: number;
  /** Persistent canvas stacking order. Higher values render above lower values. */
  zOrder?: number;
};

/**
 * Renderer-authored node mutation persisted with the project session.
 * Electron assigns commitRevision when the event first reaches the serialized
 * project save queue. Delete events are tombstones: an older window cannot
 * resurrect the logical node, while an explicit local undo records a restore
 * event that causally references the tombstone it supersedes.
 */
export type NodeMutationEvent = {
  version: 1;
  eventId: string;
  writerId: string;
  writerSequence: number;
  baseRevision: number;
  commitRevision?: number;
  kind: "upsert" | "delete" | "restore";
  /** Top-level node fields changed by this mutation; legacy events imply "*". */
  fields?: string[];
  restoresEventId?: string;
  nodeOriginId: string;
  nodeId: string;
  createdAt: string;
};

/** A writer reports the last project revision it has actually observed. */
export type NodeMutationWriterCheckpoint = {
  version: 1;
  writerId: string;
  writerSequence: number;
  observedRevision: number;
  lastSeenAt: string;
};

/** Compact causal boundary retained after the corresponding journal tombstone is collected. */
export type NodeMutationBarrier = {
  version: 1;
  nodeOriginId: string;
  nodeId: string;
  eventId: string;
  kind: "delete" | "restore";
  commitRevision: number;
  createdAt: string;
};

export type ImageNodeProgress = {
  total: number;
  completed: number;
  failed?: number;
  failedSlots?: number[];
  activeIndex?: number;
  retryCount?: number;
  maxRetries?: number;
  stopped?: boolean;
  message?: string;
};

export type ImageGenerationParameterSnapshot = {
  model?: string;
  ratio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  background?: string;
  moderation?: string;
  inputFidelity?: string;
};

export type ImageGenerationResponseSnapshot = ImageGenerationParameterSnapshot & {
  createdAt?: string;
};

export type ImageAssetGenerationMetadata = {
  version: 1;
  request?: ImageGenerationParameterSnapshot;
  response?: ImageGenerationResponseSnapshot;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type ImageAsset = {
  assetId?: string;
  /** Logical user-visible occurrence. Multiple occurrences may share one assetId/blob. */
  occurrenceId?: string;
  /** Opaque import batch identity; never contains the user's absolute source directory. */
  importBatchId?: string;
  importRootId?: string;
  sourceRelativePath?: string;
  sourceRootLabel?: string;
  sourceRootKind?: "file" | "directory";
  displayCode?: string;
  /** Task-local role used by projected mixed containers; not a permanent ownership rule. */
  taskRole?: AssetTaskRole;
  /** Stable digest of the image bytes when the import or writer already computed one. */
  contentHash?: string;
  index?: number;
  type: "file" | "url";
  width?: number;
  height?: number;
  path?: string;
  relativePath?: string;
  url?: string;
  assetUrl?: string;
  originalName?: string;
  mimeType?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  revisedPrompt?: string;
  prompt?: string;
  title?: string;
  status?: "pending" | "done" | "error";
  error?: string;
  runId?: string;
  generation?: ImageAssetGenerationMetadata;
};

export type VideoAsset = {
  assetId?: string;
  occurrenceId?: string;
  contentHash?: string;
  type: "file" | "url";
  path?: string;
  relativePath?: string;
  url?: string;
  assetUrl?: string;
  originalName?: string;
  mimeType: "video/mp4" | "video/webm" | "video/quicktime";
  width?: number;
  height?: number;
  durationMs?: number;
};

export type VideoTaskState = "prepared" | "creating" | "create-unknown" | "queued" | "running" | "succeeded" | "ready" | "failed" | "cancelled";

export type VideoTask = {
  taskId: string;
  projectId: string;
  nodeId?: string;
  endpointFamily: "video-generations" | "videos";
  model: string;
  prompt: string;
  seconds: number;
  aspectRatio: string;
  resolution: string;
  placement: { x: number; y: number };
  state: VideoTaskState;
  createState: "not-started" | "started" | "confirmed" | "rejected" | "unknown";
  remoteTaskId?: string;
  progress?: number;
  createAttempts: number;
  pollAttempts: number;
  createdAt: string;
  updatedAt: string;
  lastPolledAt?: string;
  error?: string;
  pollError?: string;
  downloadError?: string;
  credentialLabel?: string;
  credentialBaseUrl?: string;
  socialContent?: SocialContentMetadata;
  output?: VideoAsset;
};

export type VideoTaskResult = {
  ok: boolean;
  reused?: boolean;
  ambiguous?: boolean;
  task?: VideoTask;
  tasks?: VideoTask[];
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type VideoTaskBridge = {
  create(payload: {
    expectedProjectId: string;
    nodeId: string;
    model: string;
    prompt: string;
    seconds: number;
    aspectRatio: string;
    resolution: string;
    placement: { x: number; y: number };
    idempotencyKey?: string;
    socialContent?: SocialContentMetadata;
    confirmed: true;
    endpointFamily?: "video-generations" | "videos";
    sourceImageUrl?: string;
    seed?: number;
  }): Promise<VideoTaskResult>;
  list(payload: { expectedProjectId: string }): Promise<VideoTaskResult>;
  get(payload: { expectedProjectId: string; taskId: string }): Promise<VideoTaskResult>;
  poll(payload: { expectedProjectId: string; taskId: string }): Promise<VideoTaskResult>;
  retryDownload(payload: { expectedProjectId: string; taskId: string }): Promise<VideoTaskResult>;
  onChanged(handler: (task: VideoTask) => void): () => void;
};

export type ScientificTaskState = "prepared" | "running" | "ready" | "failed" | "cancelled" | "interrupted";

export type ScientificTaskOutput = {
  outputId: string;
  kind: "panel" | "figure" | "script" | "log" | "qa" | "source-data";
  format: ScientificFigureOutputFormat | "py" | "r" | "json" | "txt" | "csv" | "tsv";
  name: string;
  relativePath: string;
  assetUrl?: string;
  mimeType: string;
  size: number;
  contentHash: string;
  panelId?: string;
  width?: number;
  height?: number;
};

export type ScientificTask = {
  taskId: string;
  projectId: string;
  workflowId: string;
  planHash: string;
  requirementNodeId?: string;
  requirementRevision?: number;
  backend: ScientificFigureBackend;
  state: ScientificTaskState;
  progress: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  exitCode?: number;
  scriptHash?: string;
  outputs: ScientificTaskOutput[];
  plan: ScientificFigurePlan;
};

export type ScientificDataImportResult = {
  ok: boolean;
  canceled?: boolean;
  dataSource?: ScientificDataSource;
  sampleRows?: Array<Record<string, string>>;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type ScientificTaskResult = {
  ok: boolean;
  canceled?: boolean;
  changed?: boolean;
  task?: ScientificTask;
  tasks?: ScientificTask[];
  dataSources?: ScientificDataSource[];
  exported?: boolean;
  folderName?: string;
  fileCount?: number;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type ScientificBridge = {
  importData(payload: { expectedProjectId: string }): Promise<ScientificDataImportResult>;
  listData(payload: { expectedProjectId: string }): Promise<ScientificTaskResult>;
  render(payload: {
    expectedProjectId: string;
    expectedCanvasRevision?: number;
    requirementNodeId?: string;
    expectedRequirementRevision?: number;
    plan: ScientificFigurePlan;
    timeoutMs?: number;
  }): Promise<ScientificTaskResult>;
  list(payload: { expectedProjectId: string }): Promise<ScientificTaskResult>;
  get(payload: { expectedProjectId: string; taskId: string }): Promise<ScientificTaskResult>;
  cancel(payload: { expectedProjectId: string; taskId: string }): Promise<ScientificTaskResult>;
  export(payload: { expectedProjectId: string; taskId: string; confirmed: true }): Promise<ScientificTaskResult>;
  onChanged(handler: (task: ScientificTask) => void): () => void;
};

export type AssetTaskRole = "source" | "reference";

export type TaskAssetReference = {
  bindingId?: string;
  assetId: string;
  occurrenceId?: string;
  importBatchId?: string;
  importRootId?: string;
  sourceRelativePath?: string;
  sourceRootLabel?: string;
  sourceRootKind?: "file" | "directory";
  displayCode: string;
  contentHash?: string;
  role: AssetTaskRole;
  name: string;
  /** Zero-based slot in the logical selected node/container projection. */
  assetIndex?: number;
  containerSlot?: number;
  ownerAssetIndex?: number;
  ownerNodeId?: string;
  nodeId?: string;
  containerId?: string;
  path?: string;
  relativePath?: string;
  assetUrl?: string;
  mimeType?: string;
  purpose?: string;
  referenceRole?: string;
};

export type AgentTaskScope = {
  version: 2;
  origin: "chat" | "canvas" | "node" | "container" | "layer" | "requirement" | "goal";
  scopeType: AgentTaskScopeType;
  /** Monotonic project-canvas revision at dispatch time. */
  canvasRevision: number;
  sourceNodeIds: string[];
  sourceContainerIds: string[];
  referenceContainerIds: string[];
  sourceBindingIds: string[];
  referenceBindingIds: string[];
  sourceAssets: TaskAssetReference[];
  referenceAssets: TaskAssetReference[];
  resultPolicy: AgentTaskResultPolicy;
  confirmationPolicy: AgentTaskConfirmationPolicy;
  requirement?: AgentTaskRequirementSnapshot;
  /** Present only for a frozen Goal-mode canvas-wide container snapshot. */
  goal?: AgentGoalTaskScopeMetadata;
  /** Immutable digest of material role, binding, policy and revision inputs. */
  snapshotHash: string;
  sourceAssetCount?: number;
  referenceAssetCount?: number;
  truncated?: boolean;
};

export type AgentSteerTaskScopeUpdate = {
  /** SOURCE bindings stay frozen unless the user explicitly replaces or clears them. */
  sourceMode: "keep" | "replace" | "merge" | "clear";
  /** REFERENCE bindings may be preserved, replaced, appended to, or cleared independently. */
  referenceMode: "keep" | "replace" | "merge" | "clear";
  /** Renderer-authored candidate. Electron normalizes and re-hashes it before queueing the steer. */
  taskScope?: AgentTaskScope;
  /** Fresh canvas projection required when a replacement introduces new SOURCE/REFERENCE nodes. */
  nodes?: WorkflowNode[];
};

export type AgentSteerTaskScopeMode =
  | "keep"
  | "replace-source"
  | "merge-source"
  | "replace-reference"
  | "merge-reference"
  | "clear-attachments";

export type PendingAgentExecution = {
  version: 2;
  requestId: string;
  projectId: string;
  conversationId: string;
  originalPrompt: string;
  /** Run-level frame selected in the Agent composer before the continuation paused. */
  imageRatio?: ImageFrameRatio;
  imageResolution?: ImageResolutionPreset;
  sourceNodeIds: string[];
  focusedNodeId?: string;
  taskOrigin: AgentTaskScope["origin"];
  taskScope: AgentTaskScope;
  requirementNodeId?: string;
  requirementRevision?: number;
  requirementInputNodeIds?: string[];
  requirementInputSignature?: string;
  /** Legacy single-input snapshot fields retained for persisted v2 continuations. */
  requirementSourceNodeId?: string;
  requirementSourceSignature?: string;
  kind: "clarify" | "confirm" | "source_images" | "reference_images";
  title: string;
  question: string;
  detail?: string;
  suggestedAnswer?: string;
  options?: AgentAskUserOption[];
  maxImages?: number;
  createdAt: string;
};

export type AgentExecutionBusySnapshot = {
  reservation: boolean;
  activeRun: boolean;
  activeImageRunCount: number;
  status: AgentStatus;
  pending: boolean;
};

/**
 * One execution gate shared by live refs and rendered controls. Keeping this
 * decision pure prevents a pending AskUser turn, a quota reservation, or a
 * direct image tool run from being treated as idle by only part of the app.
 */
export function isAgentExecutionBusy(snapshot: AgentExecutionBusySnapshot) {
  return Boolean(
    snapshot.reservation ||
    snapshot.activeRun ||
    Math.max(0, Number(snapshot.activeImageRunCount || 0)) > 0 ||
    snapshot.pending ||
    snapshot.status === "thinking" ||
    snapshot.status === "editing"
  );
}

export type AgentExecutionScopeSnapshot = {
  projectId: string;
  conversationId: string;
  taskSignature: string;
};

/** Rejects stale commits after any project, conversation, or task mutation. */
export function agentExecutionScopeMatches(
  frozen: AgentExecutionScopeSnapshot,
  current: AgentExecutionScopeSnapshot,
) {
  return frozen.projectId === current.projectId &&
    frozen.conversationId === current.conversationId &&
    frozen.taskSignature === current.taskSignature;
}

export type PendingRequirementContinuationIssue =
  | "missing-requirement"
  | "missing-snapshot"
  | "revision-changed"
  | "source-binding-changed"
  | "source-content-changed";

export type PendingRequirementContinuationValidation =
  | { ok: true }
  | { ok: false; issue: PendingRequirementContinuationIssue };

/**
 * Prevents a suspended AskUser turn from resuming against a Requirement that
 * was deleted or changed in another window while the modal was open.
 */
export function validatePendingRequirementContinuation(
  pending: PendingAgentExecution,
  requirementNode: WorkflowNode | null | undefined,
  currentInputNodeIds: string | readonly string[],
  currentInputSignature: string,
): PendingRequirementContinuationValidation {
  if (!pending.requirementNodeId) return { ok: true };
  if (
    !requirementNode ||
    requirementNode.id !== pending.requirementNodeId ||
    requirementNode.type !== "requirement" ||
    !requirementNode.requirement
  ) {
    return { ok: false, issue: "missing-requirement" };
  }
  const expectedInputNodeIds = pending.requirementInputNodeIds?.length
    ? [...pending.requirementInputNodeIds]
    : pending.requirementSourceNodeId
      ? [pending.requirementSourceNodeId]
      : [];
  const normalizedCurrentInputNodeIds = Array.isArray(currentInputNodeIds)
    ? [...currentInputNodeIds]
    : currentInputNodeIds ? [currentInputNodeIds] : [];
  const expectedInputSignature = pending.requirementInputSignature || pending.requirementSourceSignature || "";
  if (
    !Number.isInteger(pending.requirementRevision) ||
    Number(pending.requirementRevision) < 1 ||
    !expectedInputSignature
  ) {
    return { ok: false, issue: "missing-snapshot" };
  }
  if (requirementNode.requirement.revision !== pending.requirementRevision) {
    return { ok: false, issue: "revision-changed" };
  }
  if (
    normalizedCurrentInputNodeIds.length !== expectedInputNodeIds.length ||
    normalizedCurrentInputNodeIds.some((nodeId, index) => nodeId !== expectedInputNodeIds[index])
  ) {
    return { ok: false, issue: "source-binding-changed" };
  }
  if (!currentInputSignature || currentInputSignature !== expectedInputSignature) {
    return { ok: false, issue: "source-content-changed" };
  }
  return { ok: true };
}

export type AgentMessageAttachments = {
  sourceAssets?: TaskAssetReference[];
  referenceAssets?: TaskAssetReference[];
  sourceCount?: number;
  referenceCount?: number;
  truncated?: boolean;
};

export function agentTaskScopeSnapshotHash(scope: Omit<AgentTaskScope, "snapshotHash"> | AgentTaskScope) {
  const materialAsset = (item: TaskAssetReference) => ({
    bindingId: item.bindingId || "",
    assetId: item.assetId,
    occurrenceId: item.occurrenceId || "",
    contentHash: item.contentHash || "",
    role: item.role,
    nodeId: item.nodeId || "",
    containerId: item.containerId || "",
    assetIndex: Number.isInteger(item.assetIndex) ? item.assetIndex : null,
    containerSlot: Number.isInteger(item.containerSlot) ? item.containerSlot : null,
    ownerNodeId: item.ownerNodeId || "",
    ownerAssetIndex: Number.isInteger(item.ownerAssetIndex) ? item.ownerAssetIndex : null,
    relativePath: String(item.relativePath || "").replace(/\\/g, "/"),
    sourceRelativePath: String(item.sourceRelativePath || "").replace(/\\/g, "/"),
    referenceRole: item.referenceRole || "",
    purpose: item.purpose || ""
  });
  const material = {
    version: 2,
    origin: scope.origin,
    scopeType: scope.scopeType,
    canvasRevision: Math.max(0, Math.floor(Number(scope.canvasRevision) || 0)),
    sourceNodeIds: [...scope.sourceNodeIds],
    sourceContainerIds: [...scope.sourceContainerIds],
    referenceContainerIds: [...scope.referenceContainerIds],
    sourceBindingIds: [...scope.sourceBindingIds],
    referenceBindingIds: [...scope.referenceBindingIds],
    sourceAssets: scope.sourceAssets.map(materialAsset),
    referenceAssets: scope.referenceAssets.map(materialAsset),
    resultPolicy: scope.resultPolicy,
    confirmationPolicy: scope.confirmationPolicy,
    requirement: scope.requirement
      ? {
          nodeId: scope.requirement.nodeId,
          revision: Math.max(1, Math.floor(Number(scope.requirement.revision) || 1)),
          sourceSignature: scope.requirement.sourceSignature || ""
        }
      : null,
    goal: scope.goal
      ? {
          version: 1,
          target: scope.goal.target,
          frozen: scope.goal.frozen === true,
          containerIds: [...scope.goal.containerIds],
          bindingIds: [...scope.goal.bindingIds],
          containerCount: Math.max(0, Math.floor(Number(scope.goal.containerCount) || 0)),
          bindingCount: Math.max(0, Math.floor(Number(scope.goal.bindingCount) || 0)),
          configuredConcurrency: Math.max(1, Math.floor(Number(scope.goal.configuredConcurrency) || 1)),
          probeContainerCount: Math.max(1, Math.floor(Number(scope.goal.probeContainerCount) || 1)),
          operationsPerAsset: Math.max(1, Math.floor(Number(scope.goal.operationsPerAsset) || 1)),
          requestCount: Math.max(1, Math.floor(Number(scope.goal.requestCount) || 1)),
          commercePlanHash: /^commerce-[a-f0-9]{32}$/.test(String(scope.goal.commercePlanHash || "").trim().toLowerCase())
            ? String(scope.goal.commercePlanHash).trim().toLowerCase()
            : "",
          commerceCatalogTargets: (scope.goal.commerceCatalogTargets ?? []).map((target) => ({
            bindingId: target.bindingId,
            catalogId: target.catalogId,
            catalogRevision: Math.max(0, Math.floor(Number(target.catalogRevision) || 0)),
            productId: target.productId,
            productRevision: Math.max(1, Math.floor(Number(target.productRevision) || 1)),
            ownerType: target.ownerType,
            ownerId: target.ownerId,
            sourceLinkId: target.sourceLinkId,
            brandStyle: target.brandStyle
              ? {
                  version: 1,
                  enabled: target.brandStyle.enabled === true,
                  fontFamily: target.brandStyle.fontFamily || "",
                  colors: [...target.brandStyle.colors],
                  logoUsage: target.brandStyle.logoUsage || "",
                  modelAppearance: target.brandStyle.modelAppearance || "",
                  productAppearance: target.brandStyle.productAppearance || "",
                  visualStyle: target.brandStyle.visualStyle || "",
                  references: target.brandStyle.references.map((reference) => ({
                    linkId: reference.linkId,
                    assetId: reference.assetId,
                    contentHash: reference.contentHash,
                    nodeId: reference.nodeId,
                    assetIndex: reference.assetIndex,
                    role: reference.role,
                    purpose: reference.purpose,
                  }))
                }
              : null,
          }))
        }
      : null
  };
  return `scope-${stableIdentityHash(`task-scope:v2:${JSON.stringify(material)}`)}`;
}

export type ImageAssetIdentityClaim = Partial<ImageAsset> & {
  ownerId: string;
  /** Zero-based slot inside the owning node or attachment collection. */
  assetIndex: number;
};

export type ImageAssetIdentityResolution = {
  assetId: string;
};

export type ImageAssetExportItem = {
  asset: ImageAsset;
  order?: number;
  title?: string;
  role?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: ImageLayerBlendMode;
};

export type ImageAssetExportGroup = {
  id?: string;
  title?: string;
  groupNumber?: number;
  width?: number;
  height?: number;
};

export type ImageAssetExportResult = {
  ok: boolean;
  canceled?: boolean;
  skipped?: boolean;
  skippedReason?: "unchanged" | "conflict";
  path?: string;
  relativePath?: string;
  format?: ImageExportFormat;
  mimeType?: string;
  converted?: boolean;
  bytes?: number;
  fingerprint?: string;
  indexWarning?: string;
  files?: string[];
  count?: number;
  width?: number;
  height?: number;
  layerNames?: string[];
  cleanupWarning?: string;
  errorCode?: string;
  error?: string;
};

export type ImageExportFormat = "png" | "jpeg" | "webp" | "avif" | "tiff";
export type ExportCenterTarget = "image" | "collection" | "psd";
export type ExportCenterFormat = ImageExportFormat | "psd";
export type ExportConflictPolicy = "overwrite" | "keep-both" | "skip";

export type ExportCenterPreset = {
  id: string;
  name: string;
  target: ExportCenterTarget;
  format: ExportCenterFormat;
  filenameTemplate: string;
  conflictPolicy: ExportConflictPolicy;
  incremental: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExportCenterHistoryEntry = {
  id: string;
  jobId: string;
  target: ExportCenterTarget;
  status: "succeeded" | "failed" | "skipped";
  format: ExportCenterFormat;
  label: string;
  itemCount: number;
  exportedCount: number;
  skippedCount: number;
  totalBytes: number;
  relativePaths: string[];
  errorCode?: string;
  error?: string;
  startedAt?: string;
  finishedAt: string;
};

export type ExportCenterState = {
  format: "sparkai-export-center";
  version: 1;
  updatedAt: string;
  presets: ExportCenterPreset[];
  history: ExportCenterHistoryEntry[];
};

export type ExportCenterStateResult = {
  ok: boolean;
  projectId?: string;
  state?: ExportCenterState;
  preset?: ExportCenterPreset;
  entry?: ExportCenterHistoryEntry;
  deleted?: number;
  cleared?: number;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type ImageCollectionExportGroupStats = {
  collectionId: string;
  name: string;
  role: ImageCollectionRole;
  directoryName: string;
  imageCount: number;
  slotCount: number;
  failedSlotCount: number;
  pendingSlotCount: number;
  sourceBytes: number;
  estimatedBytes: number;
  action?: "export" | "skip-unchanged" | "skip-conflict";
  skippedReason?: "unchanged" | "conflict";
  contentFingerprint?: string;
};

export type ImageCollectionExportPreviewResult = {
  ok: boolean;
  projectId?: string;
  format?: ImageExportFormat;
  relativeRoot?: string;
  previewToken?: string;
  collectionCount?: number;
  imageCount?: number;
  slotCount?: number;
  failedSlotCount?: number;
  pendingSlotCount?: number;
  sourceBytes?: number;
  estimatedBytes?: number;
  filenameTemplate?: string;
  conflictPolicy?: ExportConflictPolicy;
  incremental?: boolean;
  skippedCount?: number;
  skippedImageCount?: number;
  groups?: ImageCollectionExportGroupStats[];
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type ImageCollectionExportResult = ImageCollectionExportPreviewResult & {
  exportedAt?: string;
  requestedImageCount?: number;
  imageBytes?: number;
  manifestBytes?: number;
  totalBytes?: number;
  convertedCount?: number;
  exported?: Array<{
    collectionId: string;
    name: string;
    role: ImageCollectionRole;
    directoryName: string;
    relativePath: string;
    imageCount: number;
    requestedImageCount?: number;
    skipped?: boolean;
    skippedReason?: "unchanged" | "conflict";
    contentFingerprint?: string;
    itemCount: number;
    failedSlotCount: number;
    pendingSlotCount: number;
    imageBytes: number;
    manifestBytes: number;
    totalBytes: number;
    convertedCount: number;
    manifest: string;
  }>;
};

export type SaveAssetAsPayload = {
  asset: ImageAsset;
  projectId?: string;
  suggestedName?: string;
  /** Preferred local export format. When omitted, Main asks for a format before opening a single-format Save dialog. */
  format?: ImageExportFormat;
  /** AIDebug only: bypasses the native picker and writes below .diagnostics. */
  aidebugName?: string;
};

export type ExportManagedAssetPayload = {
  asset: ImageAsset;
  projectId: string;
  suggestedName: string;
  format: ImageExportFormat;
  conflictPolicy: ExportConflictPolicy;
  incremental: boolean;
};

export type ExportAssetsToFolderPayload = {
  assets: (ImageAssetExportItem | ImageAsset)[];
  projectId?: string;
  folderName?: string;
  previewAsset?: ImageAsset;
  mergedAsset?: ImageAsset;
  group?: ImageAssetExportGroup;
  /** AIDebug only: bypasses the native picker and writes below .diagnostics. */
  aidebugName?: string;
};

export type ExportLayerGroupPsdPayload = {
  assets: (ImageAssetExportItem | ImageAsset)[];
  projectId?: string;
  suggestedName?: string;
  previewAsset?: ImageAsset;
  mergedAsset?: ImageAsset;
  group?: ImageAssetExportGroup;
  /** AIDebug only: bypasses the native picker and writes below .diagnostics. */
  aidebugName?: string;
};

export type ExportAssetPsdPayload = {
  asset: ImageAsset;
  assetIndex?: number;
  nodeTitle?: string;
  projectId?: string;
  suggestedName?: string;
  /** AIDebug only: bypasses the native picker and writes below .diagnostics. */
  aidebugName?: string;
  /** AIDebug only: verifies cancel happens before any source materialization. */
  aidebugCancelBeforeMaterialize?: boolean;
};

export type ImageCollectionKind = "batch" | "series";
export type ImageCollectionRole = "results" | "defects";

export type ImageCollectionItem = {
  id: string;
  assetId?: string;
  occurrenceId?: string;
  /** Index in the compact successful asset array; absent for failed request slots. */
  assetIndex?: number;
  /** Original one-based request slot, preserved across partial failures. */
  requestIndex?: number;
  prompt: string;
  title?: string;
  /** Human-readable reason retained when this result is moved to a defect group. */
  defectReason?: string;
  /** Stable identity of the replacement now occupying this request slot. */
  replacedByAssetId?: string;
  /** Original collection item that this repaired result replaced. */
  replacesItemId?: string;
  status: "pending" | "done" | "error";
  error?: string;
  /** Per-result identity for grouped Goal outputs such as Commerce slots. */
  taskProvenance?: ImageTaskProvenance;
};

export type ImageCollection = {
  id: string;
  /** User-facing export and organization name. */
  name?: string;
  kind: ImageCollectionKind;
  collectionRole?: ImageCollectionRole;
  generationMode: "parallel" | "sequential";
  items: ImageCollectionItem[];
  sourceNodeId?: string;
  /** Result collection that owns this independent defect history group. */
  sourceCollectionId?: string;
  /** Canvas node that owns the result collection. */
  defectOfNodeId?: string;
  createdAt?: string;
  autoFit?: boolean;
};

export type ImageContainerKind = "manual" | "folder" | "batch-result" | "container-group";

export type ImageContainerMemberBinding = {
  bindingId: string;
  assetId: string;
  occurrenceId?: string;
  nodeId: string;
  containerNodeId: string;
  assetIndex: number;
  role?: AssetTaskRole;
};

/**
 * Canonical persisted identity for every image-container presentation.
 *
 * `imageContainer`, `imageCollection`, and session-level `layoutGroups`
 * remain readable for migration and compatibility, but container boundaries
 * are owned here. Direct image members and child containers are separate so
 * grouping folders never flattens away their original boundaries.
 */
export type ImageContainerSpec = {
  version: 1;
  kind: ImageContainerKind;
  /** Direct ordinary image nodes presented by this container. The host is implicit. */
  memberNodeIds: string[];
  /** Nested container nodes whose own boundaries remain addressable. */
  childContainerNodeIds: string[];
  /** Stable asset-to-node/container bindings in presentation order. */
  memberBindings: ImageContainerMemberBinding[];
  /** Previous host content kind when a container becomes a container group. */
  hostContentKind?: Exclude<ImageContainerKind, "container-group">;
  sourceLabel?: string;
  importBatchId?: string;
  layoutId?: string;
  layoutOrigin?: "manual" | "auto" | "generation";
  autoFit?: boolean;
  /** Per-result prompts and generation metadata formerly stored only in imageCollection. */
  collection?: ImageCollection;
};

export type ImageLayoutGroup = {
  id: string;
  hostNodeId: string;
  memberNodeIds: string[];
  origin: "manual" | "auto" | "generation";
  autoFit?: boolean;
};

export type ImageLayerSpec = {
  id: string;
  title?: string;
  prompt?: string;
  role?: string;
  groupId?: string;
  order?: number;
  sourceNodeId?: string;
  assetIndex?: number;
  asset?: ImageAsset;
  extractionMode?: "direct" | "mask-from-preview" | "prepared";
  x?: number;
  y?: number;
  homeX?: number;
  homeY?: number;
  width?: number;
  height?: number;
  scale?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: ImageLayerBlendMode;
};

export type ImageLayerComposition = {
  id: string;
  title?: string;
  mode: "layer-stack";
  groupNumber?: number;
  layout?: "stacked" | "exploded";
  width: number;
  height: number;
  background?: string;
  layers: ImageLayerSpec[];
  previewAsset?: ImageAsset;
  mergedAsset?: ImageAsset;
  createdAt?: string;
  summary?: string;
};

export type ImageLayerNodeGroup = {
  id: string;
  /** Native Agent tool run that produced this layer group. Used for idempotent replay. */
  toolRunId?: string;
  title?: string;
  groupNumber: number;
  total: number;
  order: number;
  layerId: string;
  layerTitle: string;
  role: string;
  compositionWidth: number;
  compositionHeight: number;
  anchorX: number;
  anchorY: number;
  detached?: boolean;
  visible?: boolean;
  opacity?: number;
  blendMode?: ImageLayerBlendMode;
  sourceParentId?: string;
  previewAsset?: ImageAsset;
  mergedAsset?: ImageAsset;
  createdAt?: string;
  summary?: string;
  recovery?: {
    status: "partial" | "failed";
    stage: string;
    recoverable: boolean;
    failedLayerIds: string[];
    successfulLayerIds: string[];
    message: string;
    attempt: number;
    updatedAt: string;
    residualRatio?: number;
    residualLimit?: number;
  };
};

export type ReferenceImage = {
  assetId?: string;
  occurrenceId?: string;
  importBatchId?: string;
  importRootId?: string;
  sourceRelativePath?: string;
  sourceRootLabel?: string;
  sourceRootKind?: "file" | "directory";
  displayCode?: string;
  contentHash?: string;
  taskRole?: AssetTaskRole;
  name: string;
  path: string;
  relativePath?: string;
  mimeType?: string;
  assetUrl?: string;
  role?: string;
  purpose?: string;
};

export type ImageImportRoot = {
  importBatchId: string;
  importRootIndex: number;
  importRootId: string;
  sourceRootLabel: string;
  sourceRootKind: "file" | "directory";
};

export type ImageImportResult = {
  ok: boolean;
  assets?: ImageAsset[];
  roots?: ImageImportRoot[];
  importBatchId?: string;
  selectedCount?: number;
  uniqueAssetCount?: number;
  occurrenceCount?: number;
  skippedCount?: number;
  truncated?: boolean;
  duplicateCount?: number;
  reusedCount?: number;
  durationMs?: number;
  maxActiveFiles?: number;
  workerPid?: number;
  canceled?: boolean;
  errorCode?: string;
  error?: string;
};

export type VideoImportResult = {
  ok: boolean;
  assets?: VideoAsset[];
  selectedCount?: number;
  importedCount?: number;
  skippedCount?: number;
  truncated?: boolean;
  reusedCount?: number;
  canceled?: boolean;
  errors?: Array<{ name: string; errorCode: string; error: string }>;
  errorCode?: string;
  error?: string;
};

export function fileDragPayloadPresent(types: Iterable<string> = [], itemKinds: Iterable<string> = [], fileCount = 0) {
  const normalizedTypes = Array.from(types, (value) => String(value || "").trim().toLowerCase());
  if (normalizedTypes.includes("files") || normalizedTypes.includes("application/x-moz-file")) return true;
  if (Array.from(itemKinds, (value) => String(value || "").trim().toLowerCase()).includes("file")) return true;
  return Number(fileCount) > 0;
}

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  sessionPath?: string;
  updatedAt?: string;
  external?: boolean;
};

export type ProjectDataMigrationCandidate = {
  candidateId: string;
  projectId: string;
  name: string;
  sourceKind: "managed-project" | "unindexed-project" | "global-session";
  fileCount: number;
  totalBytes: number;
  memoryEntryCount: number;
  blockedReason?: string;
};

export type ProjectDataMigrationPreviewResult = {
  ok: boolean;
  previewToken?: string;
  candidateCount?: number;
  migratableCount?: number;
  blockedCount?: number;
  fileCount?: number;
  totalBytes?: number;
  memoryEntryCount?: number;
  pendingCleanupCount?: number;
  pendingCleanup?: Array<{
    migrationId: string;
    createdAt: string;
    projectCount: number;
    fileCount: number;
  }>;
  candidates?: ProjectDataMigrationCandidate[];
  errorCode?: string;
  error?: string;
};

export type ProjectDataMigrationResult = {
  ok: boolean;
  canceled?: boolean;
  migrationId?: string;
  cleanupAvailable?: boolean;
  migratedAt?: string;
  migratedProjectCount?: number;
  copiedFileCount?: number;
  copiedBytes?: number;
  project?: ProjectRecord | null;
  projects?: ProjectRecord[];
  activeProjectId?: string;
  session?: PersistedWorkflowSession;
  errorCode?: string;
  error?: string;
};

export type ProjectDataMigrationCleanupResult = {
  ok: boolean;
  migrationId?: string;
  cleanedAt?: string;
  alreadyCleaned?: boolean;
  removedProjectCount?: number;
  removedFileCount?: number;
  cleanupWarnings?: string[];
  errorCode?: string;
  error?: string;
};

export type WorkspaceDomain = "general" | "commerce" | "social" | "research";

export type WorkspaceDomainDefinition = {
  id: WorkspaceDomain;
  title: string;
  description: string;
  icon: string;
  pluginIds: string[];
  defaultPrompt?: string;
  availableTools: string[];
};

export type ProjectNameDraft = {
  mode: "create" | "create-folder" | "rename";
  id?: string;
  name: string;
  workspaceDomain?: WorkspaceDomain;
};

export type ConfirmDialogDraft = {
  id: string;
  eyebrow: string;
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  action: "remove-project" | "migrate-project-data" | "cleanup-migrated-project-data" | "new-conversation" | "clear-conversation" | "rerun-requirement" | "pause-agent" | "stop-agent";
};

export type WorkflowSession = {
  schemaVersion?: number;
  workspaceDomain?: WorkspaceDomain;
  nodeSequence?: number;
  canvasRevision?: number;
  messages?: AgentMessage[];
  conversations?: AgentConversation[];
  activeConversationId?: string;
  nodes?: WorkflowNode[];
  nodeMutationJournal?: NodeMutationEvent[];
  nodeMutationWriterCheckpoints?: NodeMutationWriterCheckpoint[];
  nodeMutationBarriers?: NodeMutationBarrier[];
  layoutGroups?: ImageLayoutGroup[];
  selectedNodeId?: string;
  pendingAgentExecution?: PendingAgentExecution | null;
};

export type PersistedWorkflowSession = WorkflowSession & {
  sessionRevision?: number;
};

export type CanvasViewport = {
  x: number;
  y: number;
  scale: number;
};

export type DeleteNodeDraft = {
  nodeId: string;
  descendantCount: number;
};

export type EdgeDraft = {
  sourceId: string;
  worldX: number;
  worldY: number;
};

export type CanvasMenuState =
  | { kind: "canvas"; x: number; y: number; worldX: number; worldY: number }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "selection"; x: number; y: number; nodeIds: string[]; primaryId: string };

export type ImageBatchMode = "parallel";

export type ImageTaskDraft = {
  prompt: string;
  ratio: string;
  resolution: string;
  size?: string;
  count: number;
  quality: AppSettings["imageQuality"];
  batchMode?: ImageBatchMode;
  referenceImages?: ReferenceImage[];
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  background?: "auto" | "transparent" | "opaque";
  moderation?: "auto" | "low";
  inputFidelity?: "low" | "high";
  model?: string;
  layerId?: string;
  layerRole?: string;
  layerGroupId?: string;
  transparentPreferred?: boolean;
};

export type ReferencePickerTarget =
  | { kind: "agent" }
  | { kind: "agent-source" }
  | { kind: "image-task" }
  | { kind: "selected-node"; nodeId: string }
  | {
      kind: "agent-request";
      requestId: string;
      role: AssetTaskRole;
      question: string;
      suggestedAnswer?: string;
    };

export type ReferencePickerDraft = {
  target: ReferencePickerTarget;
  title: string;
  detail?: string;
  images: ReferenceImage[];
  max: number;
};

export type AskUserDraft = {
  requestId: string;
  kind: "clarify" | "confirm";
  title: string;
  question: string;
  detail?: string;
  suggestedAnswer?: string;
  options?: AgentAskUserOption[];
};

export type PromptStyleOption = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
  visual: string;
  image?: string;
  tags: string[];
  negative?: string;
};

export type PromptStyleGroup = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  layer?: string;
  options: PromptStyleOption[];
};

export type PromptStyleCategory = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  hero: string;
  accent: string;
  groups: PromptStyleGroup[];
};

export type PromptStyleSelection = {
  category: PromptStyleCategory;
  group: PromptStyleGroup;
  option: PromptStyleOption;
};

export type OverflowTooltipState = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

export type ServerUser = {
  id: string;
  email: string;
  username?: string;
  account?: string;
  name: string;
  balanceCents: number;
  trialImagesRemaining?: number;
  trialUsed?: boolean;
  createdAt?: string;
};

export type CanvasArtifact = WorkflowNode;

export type ServerWallet = {
  balanceCents: number;
  balanceYuan: number;
  imageCostCents: number;
  imageCostYuan: number;
};

export type ModelCapabilityEvidence = "name-inferred" | "upstream-declared" | "runtime-verified";

export type ModelAccessCapability = {
  model: string;
  endpointTypes: string[];
  evidence: ModelCapabilityEvidence;
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
};

export type ModelAccessProfile = {
  id: string;
  label: string;
  baseUrl: string;
  credentialLabel: string;
  providers: ModelProvider[];
  capabilities: Record<string, ModelAccessCapability>;
  lastCheckedAt?: string;
  error?: string;
};

export type ModelServiceStatus = {
  state: "ready" | "catalog-only" | "unavailable";
  profileIds: string[];
  lastCheckedAt?: string;
  error?: string;
};

export type ServerPublicSettings = {
  imageCostCents?: number;
  imageCostYuan?: number;
  trialImages?: number;
  models?: string[];
  imageModel?: string;
  imageModels?: string[];
  agentModels?: string[];
  videoModel?: string;
  videoModels?: string[];
  modelGroup?: string;
  modelGroups?: Array<{
    id: string;
    label: string;
    description?: string;
    ratio?: string | number;
  }>;
  channelName?: string;
  serviceReady?: boolean;
  keyManaged?: boolean;
  modelAccessProfiles?: ModelAccessProfile[];
  serviceStatuses?: Partial<Record<ModelProvider, ModelServiceStatus>>;
  cacheSource?: "network" | "memory" | "disk" | "stale" | "settings";
  cacheAgeMs?: number;
  cacheTtlMs?: number;
};

export type ModelProvider = "agent" | "image" | "video";

export type ServerLogEntry = {
  id: string;
  type: string;
  createdAt: string;
  detail?: Record<string, unknown>;
};

export type AccountApiToken = {
  id: string;
  name: string;
  status: number;
  remainQuota: number;
  usedQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
  createdTime: number;
  accessedTime: number;
  group: string;
  modelLimitsEnabled: boolean;
  modelLimits: string;
  allowIps: string;
  crossGroupRetry: boolean;
  quotaPerR: number;
  usdToCnyRate: number;
  remainR: number;
  remainUsd: number;
  remainCnyCents: number;
  remainRDisplay: string;
  remainCnyDisplay: string;
  quotaAuditLabel: string;
};

export type AccountQuotaPolicy = {
  quotaPerR: number;
  usdToCnyRate: number;
};

export type AccountApiTokenListResult = {
  ok: boolean;
  tokens?: AccountApiToken[];
  selectedTokenId?: string;
  baseUrl?: string;
  quotaPolicy?: AccountQuotaPolicy;
  cached?: boolean;
  cacheAvailable?: boolean;
  cacheUpdatedAt?: number;
  createdTokenId?: string;
  updatedTokenId?: string;
  deletedTokenId?: string;
  error?: string;
};

export type AuthDraft = {
  email: string;
  password: string;
  name: string;
  mode: "login" | "register";
  accessMode: AccessMode;
  baseUrl: string;
  apiKey: string;
  agentModel: string;
  imageModel: string;
  activationCode: string;
};

export type LicenseStatus = {
  ok: boolean;
  active: boolean;
  required: boolean;
  scope?: "account" | "custom";
  supported?: boolean;
  grace?: boolean;
  plan?: string;
  requiredPlan?: string;
  expiresAt?: number;
  verifiedAt?: number;
  error?: string;
};

export type ImageViewerState = {
  nodeId: string;
  nodeTitle: string;
  assets: ImageAsset[];
  /** Maps each filtered viewer item back to its index in the owning node. */
  assetIndices?: number[];
  index: number;
};

export type ImageGenerationStats = {
  count: number;
  totalSeconds: number;
  lastSeconds: number;
  updatedAt?: string;
};

export type ImageQuotaDialogState = {
  requestedCount: number;
  trialImagesAvailable: number;
  trialImagesUsed: number;
  paidImages: number;
  imageCostCents: number;
  balanceCents: number;
  requiredCents: number;
  deficitCents: number;
};

export type SemanticLayerMattingRequest = {
  mode?: "semantic-matting" | "direct-alignment";
  width: number;
  height: number;
  previewSource: string;
  backgroundSource: string;
  layers: Array<{ id: string; role?: string; source: string; preserveGeometry?: boolean; directSubjectSeed?: boolean }>;
};

export type SemanticLayerMattingResult = {
  ok: boolean;
  width?: number;
  height?: number;
  engine?: string;
  layers?: Array<{ id: string; role?: string; source: string }>;
  reports?: Array<{
    id: string;
    role?: string;
    accepted?: boolean;
    reason?: string;
    inputVisiblePixels?: number;
    outputVisiblePixels?: number;
    blockerPixelsRemoved?: number;
    backgroundPlateRemovedPixels?: number;
    backgroundPlateRemovedRegions?: number;
    durationMs?: number;
    alignmentApplied?: boolean;
    alignmentX?: number;
    alignmentY?: number;
    alignmentScale?: number;
    alignmentBaseScore?: number;
    alignmentScore?: number;
    alignmentImprovement?: number;
    geometryPreserved?: boolean;
    geometryIou?: number;
    visibleRetention?: number;
  }>;
  errorCode?: string;
  error?: string;
};

export type BackgroundRemovalReport = {
  backgroundColor: [number, number, number];
  transparentRatio: number;
  visibleRatio: number;
  remainingChromaRatio: number;
  removedPixels: number;
  usedExistingAlpha: boolean;
  checkerboardDetected: boolean;
  checkerboardCellWidth?: number;
  checkerboardCellHeight?: number;
  checkerboardColumns?: number;
  checkerboardRows?: number;
  checkerboardPalette?: [[number, number, number], [number, number, number]];
  checkerboardBorderMatchRatio?: number;
  checkerboardConfidence?: number;
  checkerboardSuspiciousRemovedPixels: number;
  checkerboardProtectedPixels: number;
};

export type ProjectGraphConceptNode = {
  id: string;
  label: string;
  kind: string;
  sourceClass: string;
  parentIds: string[];
  position?: { x: number; y: number };
};

export type ProjectGraphConceptEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  directed: boolean;
  kind: string;
};

export type ProjectGraphDocument = {
  schemaVersion: 1;
  sourceFormat: string;
  sourceName: string;
  title: string;
  nodes: ProjectGraphConceptNode[];
  edges: ProjectGraphConceptEdge[];
  rootIds: string[];
  warnings: string[];
  stats: { nodeCount: number; edgeCount: number; sectionCount: number };
};

export type ConfigBridge = {
  loadSettings(): Promise<{ ok: boolean; path?: string; settings?: Partial<AppSettings> }>;
  saveSettings(settings: AppSettings): Promise<{ ok: boolean; path?: string; accountChanged?: boolean; error?: string }>;
  listRequirementLibrary?(payload?: { includeText?: boolean }): Promise<RequirementLibraryResult>;
  getRequirementLibraryEntry?(payload: { id: string }): Promise<RequirementLibraryResult>;
  saveRequirementLibraryEntry?(payload: {
    id?: string;
    expectedRevision?: number;
    title: string;
    text: string;
    skill?: CanvasSkill;
    socialPlan?: SocialContentPlan;
    scientificPlan?: ScientificFigurePlan;
  }): Promise<RequirementLibraryResult>;
  deleteRequirementLibraryEntry?(payload: {
    id: string;
    expectedRevision: number;
    confirmed: true;
  }): Promise<RequirementLibraryResult>;
  listCommerceTemplates?(): Promise<CommerceTemplateResult>;
  getCommerceTemplate?(payload: { id: string }): Promise<CommerceTemplateResult>;
  saveCommerceTemplate?(payload: {
    id?: string;
    expectedRevision?: number;
    conflictPolicy?: "overwrite" | "copy";
    title: string;
    description?: string;
    plan: CommerceSetPlan;
  }): Promise<CommerceTemplateResult>;
  deleteCommerceTemplate?(payload: {
    id: string;
    expectedRevision: number;
    confirmed: true;
  }): Promise<CommerceTemplateResult>;
  importCommerceTemplate?(): Promise<CommerceTemplateResult>;
  exportCommerceTemplate?(payload: { id: string; expectedRevision?: number }): Promise<CommerceTemplateResult>;
  onCommerceTemplateChanged?(handler: (payload: { libraryRevision?: number; id?: string }) => void): () => void;
  listCommerceCatalog?(payload: { expectedProjectId: string }): Promise<CommerceCatalogResult>;
  saveCommerceCatalogProduct?(payload: CommerceCatalogProductDraft & {
    expectedProjectId: string;
    expectedCatalogRevision: number;
  }): Promise<CommerceCatalogResult>;
  archiveCommerceCatalogProduct?(payload: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    archived?: boolean;
  }): Promise<CommerceCatalogResult>;
  assignCommerceCatalogAssets?(payload: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    kind: CommerceCatalogAssetKind;
    ownerType?: CommerceCatalogAssetOwnerType;
    ownerId?: string;
    role?: string;
    assets: CommerceCatalogAssetLocator[];
  }): Promise<CommerceCatalogResult>;
  removeCommerceCatalogAsset?(payload: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    linkId: string;
  }): Promise<CommerceCatalogResult>;
  updateCommerceCatalogResultState?(payload: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    linkId: string;
    state: CommerceCatalogResultState;
  }): Promise<CommerceCatalogResult>;
  listCommerceCatalogComparisons?(payload: {
    expectedProjectId: string;
    productId?: string;
  }): Promise<CommerceCatalogResult>;
  selectCommerceCatalogComparisonWinner?(payload: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    groupKey: string;
    winnerLinkId: string;
  }): Promise<CommerceCatalogResult>;
  reconcileCommerceCatalogGoalResults?(payload: {
    expectedProjectId: string;
    taskScopeSnapshotHash: string;
  }): Promise<CommerceCatalogResult>;
  previewCommerceExport?(payload: CommerceExportRequest): Promise<CommerceExportPreviewResult>;
  exportCommercePackage?(payload: CommerceExportRequest & { confirmed: true }): Promise<CommerceExportPackageResult>;
  previewSocialExport?(payload: SocialExportRequest): Promise<SocialExportResult>;
  exportSocialPackage?(payload: SocialExportRequest & { confirmed: true }): Promise<SocialExportResult>;
  onCommerceCatalogChanged?(handler: (payload: {
    projectId: string;
    catalogRevision: number;
  }) => void): () => void;
  loadSession(payload?: { projectId?: string }): Promise<{ ok: boolean; path?: string; session?: PersistedWorkflowSession; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string }>;
  saveSession(session: WorkflowSession & { projectId?: string; revision?: number; sessionRevision?: number }, options?: {
    revision?: number;
    nodeMutation?: {
      writerId: string;
      writerSequence?: number;
      observedRevision: number;
      baselineNodes: WorkflowNode[];
    };
  }): Promise<{
    ok: boolean;
    path?: string;
    appliedRevision?: number;
    requestedRevision?: number | null;
    skippedStale?: boolean;
    skipped?: boolean;
    applied?: boolean;
    reason?: string;
    nodeMutationJournal?: NodeMutationEvent[];
    nodeMutationWriterCheckpoints?: NodeMutationWriterCheckpoint[];
    nodeMutationBarriers?: NodeMutationBarrier[];
    nodeMutationWriterSequence?: number;
    error?: string;
  }>;
  newWindow?(payload?: { projectId?: string; newConversation?: boolean }): Promise<{ ok: boolean }>;
  windowControl?(payload: { action: "minimize" | "toggle-maximize" | "close" | "state" }): Promise<{ ok: boolean; action?: string; maximized?: boolean; minimized?: boolean; error?: string }>;
  listProjects?(): Promise<{ ok: boolean; projects?: ProjectRecord[]; activeProjectId?: string; error?: string }>;
  previewProjectDataMigration?(): Promise<ProjectDataMigrationPreviewResult>;
  migrateProjectData?(payload: { previewToken: string; candidateIds: string[]; confirmed: true }): Promise<ProjectDataMigrationResult>;
  cleanupMigratedProjectData?(payload: { migrationId: string; confirmedCleanup: true }): Promise<ProjectDataMigrationCleanupResult>;
  createProject?(payload: { name?: string; workspaceDomain?: WorkspaceDomain }): Promise<{ ok: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  createProjectFolder?(payload?: { name?: string; workspaceDomain?: WorkspaceDomain }): Promise<{ ok: boolean; canceled?: boolean; path?: string; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  switchProject?(payload: { id: string }): Promise<{ ok: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  renameProject?(payload: { id: string; name: string }): Promise<{ ok: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  openProject?(): Promise<{ ok: boolean; path?: string; canceled?: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  openCurrentProjectFolder?(payload?: { id?: string }): Promise<{ ok: boolean; path?: string; projectId?: string; error?: string }>;
  previewImageCollectionExport?(payload: {
    expectedProjectId: string;
    collectionIds: string[];
    format: ImageExportFormat;
    filenameTemplate?: string;
    conflictPolicy?: ExportConflictPolicy;
    incremental?: boolean;
  }): Promise<ImageCollectionExportPreviewResult>;
  exportImageCollections?(payload: {
    expectedProjectId: string;
    collectionIds: string[];
    format: ImageExportFormat;
    filenameTemplate?: string;
    conflictPolicy?: ExportConflictPolicy;
    incremental?: boolean;
    previewToken: string;
    confirmed: true;
  }): Promise<ImageCollectionExportResult>;
  openImageCollectionFolder?(payload: {
    expectedProjectId: string;
    collectionId: string;
  }): Promise<{
    ok: boolean;
    projectId?: string;
    collectionId?: string;
    directoryName?: string;
    errorCode?: string;
    error?: string;
    details?: Record<string, unknown>;
  }>;
  exportProject?(): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  importProject?(): Promise<{ ok: boolean; path?: string; canceled?: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  importProjectGraph?(): Promise<{ ok: boolean; canceled?: boolean; graph?: ProjectGraphDocument; task?: { prompt: string; visibleContent: string }; errorCode?: string; error?: string }>;
  importSkill?(): Promise<{ ok: boolean; canceled?: boolean; skill?: ImportedCanvasSkill; errorCode?: string; error?: string }>;
  parseSkill?(payload: { markdown: unknown; sourceName?: unknown }): Promise<{ ok: boolean; skill?: ImportedCanvasSkill; errorCode?: string; error?: string }>;
  importThemePreset?(): Promise<{ ok: boolean; canceled?: boolean; theme?: CustomThemePreset; sourceName?: string; errorCode?: string; error?: string }>;
  exportThemePreset?(theme: CustomThemePreset): Promise<{ ok: boolean; canceled?: boolean; fileName?: string; errorCode?: string; error?: string }>;
  pickGlassBackground?(): Promise<GlassBackgroundResult>;
  loadGlassBackground?(payload: { assetId: string; name?: string }): Promise<GlassBackgroundResult>;
  clearGlassBackground?(payload?: { assetId?: string }): Promise<GlassBackgroundResult>;
  composePluginTask?(payload: {
    command: string;
    languageCodes?: string[];
    sourceCount?: number;
    sourceNodeIds?: string[];
    plan?: unknown;
  }): Promise<{
    ok: boolean;
    task?: {
      prompt: string;
      visibleContent: string;
      languageCodes?: string[];
      planHash?: string;
      plan?: unknown;
      sourceNodeIds?: string[];
      counts?: {
        sourceCount?: number;
        outputsPerSource?: number;
        totalRequests?: number;
        probeRequests?: number;
        exceedsRequestLimit?: boolean;
      };
    };
    error?: string;
  }>;
  deleteProject?(payload: { id: string }): Promise<{ ok: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  deleteProjectFolder?(payload: { id: string }): Promise<{ ok: boolean; project?: ProjectRecord; projects?: ProjectRecord[]; activeProjectId?: string; session?: PersistedWorkflowSession; error?: string }>;
  pickReferenceImage?(): Promise<{ ok: boolean; canceled?: boolean; image?: ReferenceImage; error?: string }>;
  pickReferenceImages?(payload?: { max?: number; projectId?: string; title?: string }): Promise<{ ok: boolean; canceled?: boolean; images?: ReferenceImage[]; image?: ReferenceImage; truncated?: boolean; selectedCount?: number; error?: string }>;
  pickLocalImages?(payload?: { projectId?: string; maxFiles?: number }): Promise<ImageImportResult>;
  pickLocalVideos?(payload?: { projectId?: string; maxFiles?: number }): Promise<VideoImportResult>;
  pathForDroppedFile?(file: File): string;
  readAssetDataUrl?(payload: { path: string }): Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; name?: string; error?: string }>;
  refineSemanticLayers?(payload: SemanticLayerMattingRequest): Promise<SemanticLayerMattingResult>;
  isolateImageBackground?(payload: { source: string; width: number; height: number }): Promise<
    ({ ok: true; source: string; width: number; height: number; engine: string } & BackgroundRemovalReport) |
    { ok: false; source?: undefined; errorCode?: string; error?: string }
  >;
  thumbnailStats?(payload?: { reset?: boolean }): Promise<{
    ok: boolean;
    stats?: { requests: number; cacheHits: number; inflightJoins: number; workerStarts: number; workerJobs: number; workerReuses: number; workerFailures: number; generated: number; errors: number; recentErrors: { key: string; code: string; message: string }[]; maxActiveWorkers: number; maxConcurrent: number; activeWorkers: number; activeJobs: number; queuedJobs: number; inflight: number; closed: boolean };
    error?: string;
  }>;
  imageImportStatus?(payload?: { reset?: boolean }): Promise<{ ok: boolean; status?: { requests: number; completed: number; canceled: number; errors: number; active: number; maxActiveRequests: number; cancelRequests: number; lastDurationMs: number; lastSelectedCount: number; lastImportedCount: number; lastSkippedCount: number; lastMaxActiveFiles: number; lastWorkerPid: number; lastErrorCode: string; maxConcurrentFiles: number; mainProcessPid: number; recycling: boolean; available: boolean; quitting: boolean }; error?: string }>;
  cancelImageImports?(): Promise<{ ok: boolean; status?: Record<string, unknown>; error?: string }>;
  importLocalImage?(payload: { path: string; projectId?: string }): Promise<{ ok: boolean; asset?: ImageAsset; canceled?: boolean; errorCode?: string; error?: string }>;
  importLocalImages?(payload: { paths: string[]; projectId?: string; maxFiles?: number }): Promise<ImageImportResult>;
  importLocalVideos?(payload: { paths: string[]; projectId?: string; maxFiles?: number }): Promise<VideoImportResult>;
  saveOutputImage?(payload: { dataUrl: string; stem?: string; runId?: string; projectId?: string; bucket?: "imagegen" | "post"; subdir?: string }): Promise<{ ok: boolean; asset?: ImageAsset; error?: string }>;
  saveAssetAs?(payload: SaveAssetAsPayload): Promise<ImageAssetExportResult>;
  exportManagedAsset?(payload: ExportManagedAssetPayload): Promise<ImageAssetExportResult>;
  exportAssetPsd?(payload: ExportAssetPsdPayload): Promise<ImageAssetExportResult>;
  exportAssetsToFolder?(payload: ExportAssetsToFolderPayload): Promise<ImageAssetExportResult>;
  exportLayerGroupPsd?(payload: ExportLayerGroupPsdPayload): Promise<ImageAssetExportResult>;
  openAssetFolder?(payload: { path?: string; url?: string }): Promise<{ ok: boolean; error?: string }>;
  captureGuiScreenshot?(payload?: { label?: string; scope?: "window" | "page" }): Promise<{ ok: boolean; path?: string; width?: number; height?: number; source?: "window" | "page"; error?: string }>;
  exportCenterState?(payload: { expectedProjectId: string }): Promise<ExportCenterStateResult>;
  saveExportCenterPreset?(payload: { expectedProjectId: string; preset: Partial<ExportCenterPreset> & Pick<ExportCenterPreset, "name" | "target" | "format"> }): Promise<ExportCenterStateResult>;
  deleteExportCenterPreset?(payload: { expectedProjectId: string; presetId: string }): Promise<ExportCenterStateResult>;
  recordExportCenterHistory?(payload: { expectedProjectId: string; entry: Partial<ExportCenterHistoryEntry> & Pick<ExportCenterHistoryEntry, "jobId" | "target" | "status" | "format" | "label"> }): Promise<ExportCenterStateResult>;
  clearExportCenterHistory?(payload: { expectedProjectId: string }): Promise<ExportCenterStateResult>;
};

export type AgentRuntimeResult = {
  ok: boolean;
  content?: string;
  actions?: AgentRuntimeAction[];
  toolResults?: {
    ok?: boolean;
    tool?: string;
    summary?: string;
    externalized?: boolean;
    error?: string;
    errorCategory?: string;
    retriable?: boolean;
  }[];
  error?: string;
};

export type AgentProgress = {
  runId?: string;
  projectId?: string;
  conversationId?: string;
  modelRound?: number;
  phase: string;
  tool?: string;
  toolRunId?: string;
  operationId?: string;
  childTaskId?: string;
  retryCount?: number;
  maxRetries?: number;
  errorCategory?: string;
  summary?: string;
  detail?: unknown;
  brief?: string;
  operation?: string;
  params?: string;
  input?: Record<string, unknown> | unknown;
  delta?: string;
  text?: string;
  createdAt?: string;
  internalOnly?: boolean;
  nativeTool?: boolean;
  nativeEventType?: string;
  partialImage?: { dataUrl?: string; index?: number; total?: number; requestIndex?: number };
  workflowAction?: AgentRuntimeAction;
};

export type AgentRuntimeAction = {
  type: string;
  operationId?: string;
  toolRunId?: string;
  /** Main-owned image-collection mutation requested by the built-in workflow tool. */
  imageCollection?: {
    operation: "rename" | "replace" | "export";
    expectedProjectId?: string;
    expectedCanvasRevision?: number;
    confirmed?: boolean;
    format?: ImageExportFormat;
    requests?: Array<{
      collectionId?: string;
      name?: string;
      sourceCollectionId?: string;
      itemId?: string;
      requestIndex?: number;
      replacementNodeId?: string;
      replacementAssetIndex?: number;
      defectReason?: string;
    }>;
    collectionIds?: string[];
  };
  /** Existing recoverable PNG layer group that this action resumes in place. */
  resumeLayerGroupId?: string;
  /** Failed layer identities retried by this action. Successful layers are reused. */
  retryLayerIds?: string[];
  node?: {
    id?: string;
    displayCode?: string;
    title?: string;
    prompt?: string;
    nodeType?: WorkflowNode["type"];
    parentId?: string | null;
    relationType?: WorkflowNode["relationType"];
    x?: number | null;
    y?: number | null;
    outputs?: number | null;
    assets?: ImageAsset[];
    imageState?: WorkflowNode["imageState"];
    imageError?: string;
    imageParams?: ImageTaskDraft;
    status?: NodeStatus;
    imageProgress?: ImageNodeProgress;
    layerComposition?: ImageLayerComposition;
    imageContainerSpec?: ImageContainerSpec;
    imageCollection?: ImageCollection;
    taskProvenance?: ImageTaskProvenance;
  };
  composition?: ImageLayerComposition;
  parentId?: string | null;
  patch?: Partial<WorkflowNode> & { id?: string };
  /** Complete structured social plan written back to its locked Requirement. */
  socialPlan?: SocialContentPlan;
  expectedRequirementRevision?: number;
  request?: {
    requestId?: string;
    kind?: "clarify" | "confirm" | "source_images" | "reference_images";
    title?: string;
    question?: string;
    detail?: string;
    suggestedAnswer?: string;
    options?: AgentAskUserOption[];
    maxSourceImages?: number;
    maxReferenceImages?: number;
  };
  mode?: "only" | "branch" | "all";
  sourceId?: string;
  targetId?: string;
  relationType?: WorkflowNode["relationType"];
  sourceNodeId?: string;
  direction?: "input" | "output" | "both";
  kind?: "repaint" | "cutout";
  assetIndex?: number;
  prompt?: string;
  id?: string;
  reason?: string;
};

export type AgentBridge = {
  tools(): Promise<{ ok: boolean; tools?: unknown[] }>;
  listModels(payload: { provider: "agent" | "image" | "video"; settings: AppSettings }): Promise<{ ok: boolean; provider: string; models?: string[]; cacheSource?: ServerPublicSettings["cacheSource"]; cacheAgeMs?: number; cacheTtlMs?: number; error?: string }>;
  runTool(payload: { runId?: string; name: string; input: Record<string, unknown>; prompt?: string; nodes?: WorkflowNode[]; selectedNodeId?: string; selectedNodeIds?: string[]; canvasRevision?: number; referenceImages?: ReferenceImage[]; taskScope?: AgentTaskScope; projectId?: string; conversationId?: string }): Promise<{
    envelope?: {
      ok?: boolean;
      entryId?: string;
      tool?: string;
      summary?: string;
      visibleOutput?: string;
      externalized?: boolean;
    };
    actions?: AgentRuntimeAction[];
  }>;
  composeImagePrompt(payload: {
    runId?: string;
    request: string;
    currentPrompt: string;
    currentRatio: string;
    currentResolution: string;
    currentCount: number;
    currentQuality: AppSettings["imageQuality"];
  }): Promise<{ ok: boolean; draft?: Partial<ImageTaskDraft>; envelope?: { visibleOutput?: string; summary?: string }; error?: string }>;
  chat(payload: { runId?: string; prompt: string; messages: AgentMessage[]; nodes: WorkflowNode[]; referenceImages?: ReferenceImage[]; taskScope?: AgentTaskScope; projectId?: string; conversationId?: string; selectedNodeId?: string; selectedNodeIds?: string[]; canvasRevision?: number; workspaceDomain?: WorkspaceDomain; imageDefaults?: { ratio?: string; resolution?: string } }): Promise<AgentRuntimeResult>;
  onProgress?(handler: (payload: AgentProgress) => void): () => void;
  getMainPrompt(): Promise<{ ok: boolean; text?: string; defaultText?: string; isDefault?: boolean; currentPromptHash?: string; defaultPromptRevision?: number; defaultPromptHash?: string; baseDefaultPromptRevision?: number; baseDefaultPromptHash?: string; defaultUpdateAvailable?: boolean; maxChars?: number; updatedAt?: string; error?: string }>;
  saveMainPrompt(payload: { text: string }): Promise<{ ok: boolean; text?: string; defaultText?: string; isDefault?: boolean; currentPromptHash?: string; defaultPromptRevision?: number; defaultPromptHash?: string; baseDefaultPromptRevision?: number; baseDefaultPromptHash?: string; defaultUpdateAvailable?: boolean; maxChars?: number; updatedAt?: string; error?: string }>;
  resetMainPrompt(): Promise<{ ok: boolean; text?: string; defaultText?: string; isDefault?: boolean; currentPromptHash?: string; defaultPromptRevision?: number; defaultPromptHash?: string; baseDefaultPromptRevision?: number; baseDefaultPromptHash?: string; defaultUpdateAvailable?: boolean; maxChars?: number; updatedAt?: string; error?: string }>;
  getFastMemory(payload: { projectId: string; conversationId: string }): Promise<{ ok: boolean; text?: string; isEmpty?: boolean; isOversized?: boolean; maxChars?: number; contextMaxChars?: number; updatedAt?: string; error?: string }>;
  saveFastMemory(payload: { projectId: string; conversationId: string; text: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; conflict?: boolean; text?: string; isEmpty?: boolean; maxChars?: number; updatedAt?: string; error?: string }>;
  resetFastMemory(payload: { projectId: string; conversationId: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; conflict?: boolean; text?: string; isEmpty?: boolean; maxChars?: number; updatedAt?: string; cleared?: number; error?: string }>;
  clearConversation(payload: { projectId: string; conversationId: string }): Promise<{ ok?: boolean; clearedFastMemory?: number; clearedSummary?: boolean; summary?: string; error?: string }>;
  cancelPendingExecution(payload: { projectId: string; conversationId: string; requestId: string }): Promise<{ ok?: boolean; summary?: string; error?: string }>;
  pause(payload: { projectId: string; conversationId: string; runId?: string }): Promise<AgentRunControlSnapshot>;
  resume(payload: { projectId: string; conversationId: string; runId?: string }): Promise<AgentRunControlSnapshot>;
  stop(payload: { projectId: string; conversationId: string; runId?: string; reason?: string }): Promise<AgentRunControlSnapshot & { stopped?: number }>;
  steer(payload: {
    projectId: string;
    conversationId: string;
    runId?: string;
    prompt: string;
    taskScopeUpdate?: AgentSteerTaskScopeUpdate;
  }): Promise<AgentRunControlSnapshot & { accepted?: number; interrupted?: number; taskScopeSnapshotHash?: string }>;
  runStatus(payload?: { projectId?: string }): Promise<AgentRunControlSnapshot>;
  onRunState?(handler: (payload: AgentRunControlSnapshot) => void): () => void;
  smoke(): Promise<unknown>;
};

export type AgentRunControlSnapshot = {
  ok: boolean;
  runs?: Array<{
    runId: string;
    projectId: string;
    conversationId: string;
    ownerId?: string;
    nodeIds: string[];
    paused: boolean;
    steerable?: boolean;
    queuedSteerCount?: number;
    taskScopeSnapshotHash?: string;
    phase?: string;
    startedAt: number;
  }>;
  scopeCount?: number;
  lockedNodeIds?: string[];
  pausedScopes?: Array<{ projectId: string; conversationId: string; ownerId?: string }>;
  stopped?: number;
  accepted?: number;
  interrupted?: number;
  error?: string;
};

export type ServerBridge = {
  register(payload: { username: string; email?: string; password: string; name?: string }): Promise<{ ok: boolean; sessionId?: string; token?: string; user?: ServerUser; wallet?: ServerWallet; settings?: ServerPublicSettings; imageCostCents?: number; error?: string }>;
  login(payload: { username: string; email?: string; password: string }): Promise<{ ok: boolean; sessionId?: string; token?: string; user?: ServerUser; wallet?: ServerWallet; settings?: ServerPublicSettings; imageCostCents?: number; error?: string }>;
  logout(): Promise<{ ok: boolean; remoteLogout?: boolean }>;
  me(payload?: { preferCached?: boolean }): Promise<{ ok: boolean; stale?: boolean; cached?: boolean; user?: ServerUser; wallet?: ServerWallet; settings?: ServerPublicSettings; error?: string }>;
  logs(): Promise<{ ok: boolean; logs?: ServerLogEntry[]; error?: string }>;
  models?(payload?: { forceRefresh?: boolean; cacheOnly?: boolean; group?: string }): Promise<{ ok: boolean; settings?: ServerPublicSettings; error?: string }>;
  tokens?(payload?: { preferCached?: boolean }): Promise<AccountApiTokenListResult>;
  selectToken?(payload: { id: string }): Promise<AccountApiTokenListResult & { token?: AccountApiToken }>;
  createToken?(payload: {
    name: string;
    group?: string;
    unlimitedQuota?: boolean;
    remainQuota?: number;
    expiredTime?: number;
    modelLimitsEnabled?: boolean;
    modelLimits?: string;
    allowIps?: string;
    crossGroupRetry?: boolean;
    select?: boolean;
  }): Promise<AccountApiTokenListResult>;
  updateToken?(payload: Partial<AccountApiToken> & { id: string }): Promise<AccountApiTokenListResult>;
  deleteToken?(payload: { id: string }): Promise<AccountApiTokenListResult>;
  recharge(payload: { amountCents: number }): Promise<{ ok: boolean; user?: ServerUser; wallet?: ServerWallet; balanceCents?: number; error?: string }>;
  generateImage(payload: {
    runId?: string;
    operationId?: string;
    requestIndex?: number;
    projectId?: string;
    conversationId?: string;
    nodeIds?: string[];
    prompt: string;
    model?: string;
    ratio?: string;
    resolution?: string;
    size: string;
    quality: string;
    count: number;
    referenceImages?: ReferenceImage[];
    editImage?: ReferenceImage;
    maskImage?: ReferenceImage;
    maskDataUrl?: string;
    outputFormat?: "png" | "jpeg" | "webp";
    outputCompression?: number;
    background?: "auto" | "transparent" | "opaque";
    moderation?: "auto" | "low";
    inputFidelity?: "low" | "high";
  }): Promise<{
    ok: boolean;
    dryRun?: boolean;
    runId?: string;
    model?: string;
    count?: number;
    size?: string;
    quality?: string;
    returned?: number;
    referenceImageCount?: number;
    referenceImageDescriptors?: Array<Pick<ReferenceImage, "name" | "role" | "purpose">>;
    editImageDescriptor?: Pick<ReferenceImage, "name" | "role" | "purpose">;
    editImage?: boolean;
    maskImage?: boolean;
    outputFormat?: string;
    outputCompression?: number;
    background?: string;
    moderation?: string;
    inputFidelity?: string;
    assets?: ImageAsset[];
    balanceCents?: number;
    costCents?: number;
    providerUsage?: Array<{
      requestIndex?: number;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      image_tokens?: number;
      images?: number;
      cost?: number;
      cost_cents?: number;
      charged_cents?: number;
      quota?: number;
    }>;
    deficitCents?: number;
    paidImages?: number;
    trialImagesUsed?: number;
    trialImagesRemaining?: number;
    upstreamStatus?: number;
    upstreamErrorType?: string;
    upstreamErrorCode?: string;
    upstreamErrorMessage?: string;
    failed?: number;
    errors?: string[];
    message?: string;
    error?: string;
  }>;
  licenseStatus(payload?: { force?: boolean; scope?: "account" | "custom" }): Promise<LicenseStatus>;
  activateLicense(payload: { code: string }): Promise<LicenseStatus>;
  configureCustom(payload: { baseUrl: string; apiKey: string; agentModel?: string; imageModel?: string }): Promise<{ ok: boolean; user?: ServerUser; settings?: ServerPublicSettings; license?: LicenseStatus; warning?: string; error?: string }>;
};

export type DesktopUpdateArtifact = {
  kind: "restart" | "installer";
  filename: string;
  version: string;
  sha256: string;
  size: number;
};

export type DesktopUpdateInfo = {
  ok: boolean;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateType?: "none" | "restart" | "installer";
  requiresCaptcha?: boolean;
  channel?: string;
  publishedAt?: string;
  minimumVersion?: string;
  compatibility?: string;
  notes?: string[];
  packaged?: boolean;
  rollbackDetected?: boolean;
  recovery?: {
    active: true;
    version?: string;
    kind?: "restart" | "installer";
    reason?: string;
    detectedAt?: string;
  } | null;
  artifact?: DesktopUpdateArtifact | null;
  restart?: DesktopUpdateArtifact | null;
  installer?: DesktopUpdateArtifact | null;
  pending?: DesktopUpdateArtifact & { downloadedAt?: string } | null;
  failedPending?: DesktopUpdateArtifact & { downloadedAt?: string } | null;
  canApplyPending?: boolean;
  busy?: boolean;
  progress?: DesktopUpdateProgress | null;
  error?: string;
};

export type DesktopUpdateProgress = {
  stage: "checking" | "checked" | "downloading" | "retrying" | "verifying" | "ready" | "applying" | "error";
  message?: string;
  version?: string;
  kind?: "restart" | "installer";
  received?: number;
  total?: number;
  percent?: number;
  attempt?: number;
  createdAt?: string;
};

export type DesktopInstallerCaptcha = {
  ok: boolean;
  challengeId?: string;
  imageDataUrl?: string;
  expiresIn?: number;
  expiresAt?: string;
  installer?: DesktopUpdateArtifact;
  error?: string;
};

export type UpdaterBridge = {
  status(): Promise<DesktopUpdateInfo>;
  ready(): Promise<{ ok: boolean }>;
  check(): Promise<DesktopUpdateInfo>;
  createInstallerCaptcha(): Promise<DesktopInstallerCaptcha>;
  downloadRestart(): Promise<{ ok: boolean; pending?: DesktopUpdateInfo["pending"]; error?: string }>;
  downloadInstaller(payload: { challengeId: string; code: string }): Promise<{ ok: boolean; pending?: DesktopUpdateInfo["pending"]; error?: string }>;
  applyRestart(): Promise<{ ok: boolean; restarting?: boolean; version?: string; error?: string }>;
  launchInstaller(): Promise<{ ok: boolean; launching?: boolean; version?: string; installerPid?: number; error?: string }>;
  onProgress?(handler: (payload: DesktopUpdateProgress) => void): () => void;
};

declare global {
  interface Window {
    naimageRuntime?: {
      aidebugEnabled: boolean;
      isolatedConfig: boolean;
    };
    naimageConfig?: ConfigBridge;
    naimageAgent?: AgentBridge;
    naimageServer?: ServerBridge;
    naimageUpdater?: UpdaterBridge;
    naimageVideo?: VideoTaskBridge;
    naimageScientific?: ScientificBridge;
    naimageAgentIntegrations?: AgentIntegrationBridge;
    naimageAutomation?: AutomationBridge;
    naimageAgentWindow?: AgentWindowBridge;
    __naimageCanvasDebugReady?: boolean;
    __naimageCanvasImageCollectionProgress?: {
      status: "running" | "complete" | "failed";
      currentStep?: string;
      lastStep?: string;
      lastStepOk?: boolean;
      completedSteps: number;
      totalSteps?: number;
      visibilityState: DocumentVisibilityState;
      updatedAt: number;
    };
    __naimageCanvasImageCollectionLastResult?: unknown;
    __naimageDebugResizeNode?: (payload: { id?: string; width?: number; height?: number }) => boolean;
    __naimageDebugMoveNode?: (payload: { id?: string; x?: number; y?: number }) => boolean;
    __naimageDebugSetViewport?: (payload: { scale?: number; x?: number; y?: number; nodeId?: string }) => boolean;
    __naimageDebugConnectNodes?: (payload: { sourceId?: string; targetId?: string }) => boolean;
    __naimageDebugSendAgentPrompt?: (prompt: string, options?: { skipAsk?: boolean }) => Promise<boolean>;
    __naimageDebugAgentState?: () => {
      configReady?: boolean;
      agentStatus: AgentStatus;
      messageCount: number;
      progressCount: number;
      toolProgressCount: number;
      nodeCount: number;
      parentedNodeCount?: number;
     selectedNodeParentId?: string;
      sourceImageCount?: number;
      referenceImageCount?: number;
      canvasImageCollectionProgress?: Window["__naimageCanvasImageCollectionProgress"] | null;
      pendingAgentExecution?: PendingAgentExecution | null;
      askUserOpen?: boolean;
      referencePickerOpen?: boolean;
      referencePickerRole?: AssetTaskRole;
      lastAssistant: string;
      imageNodeViewportOk?: boolean;
      imagePreviewVisibleCountOk?: boolean;
      layerDetachAudit?: Array<{ at: number; action: "detach" | "explode" | "recompose" | "cancel"; source: string; nodeId: string; groupId?: string; pointerId?: number; pointerType?: string; eventType?: string; dx?: number; dy?: number }>;
      nodeLayouts?: { id: string; type: string; imageCollectionKind?: string; imageTileCount?: number; imageTileColumns?: number; imageTileRows?: number; layerGroupId?: string; layerGroupNumber?: number; layerOrder?: number; layerDetached?: boolean; layerStacked?: boolean; layerTabCount?: number; layerTransparentShell?: boolean; layerLayout?: string; layerSurfaceCount?: number; layerHandleCount?: number; width?: number; height: number; previewHeight: number; footerGap: number; bottomPadding: number }[];
      nodes?: { id: string; displayCode?: string; title?: string; prompt?: string; type: WorkflowNode["type"]; status: WorkflowNode["status"]; parentId?: string; relationType?: WorkflowNode["relationType"]; branch?: string; outputs?: number; imageState?: WorkflowNode["imageState"]; imageError?: string; imageProgress?: ImageNodeProgress; x?: number; y?: number; imageContainer?: boolean; imageContainerRole?: AssetTaskRole; imageContainerSpec?: ImageContainerSpec; imageCollection?: ImageCollection; taskProvenance?: ImageTaskProvenance; requirement?: CanvasRequirement; layerGroup?: ImageLayerNodeGroup; layerComposition?: ImageLayerComposition; width?: number; height?: number; assetCount?: number; assets?: ImageAsset[] }[];
      messages: Pick<AgentMessage, "role" | "content" | "status" | "meta" | "attachments">[];
      progress: Pick<AgentProgress, "runId" | "phase" | "tool" | "summary" | "brief" | "operation" | "input" | "detail" | "nativeTool" | "nativeEventType">[];
    };
    __naimageDebugOpenSurface?: (surface: string) => boolean;
    __naimageDebugSurfaceSaveDelayMs?: number;
    __naimageDebugLastSurfaceClose?: {
      surface: string;
      reason: string;
      policy: string;
      busy: boolean;
      dirty: boolean;
      allowed: boolean;
    };
   __naimageDebugCaptureGui?: (label?: string, scope?: "window" | "page") => Promise<{ ok: boolean; path?: string; width?: number; height?: number; source?: "window" | "page"; error?: string }>;
    __naimageDebugImportPathsToCanvas?: (payload: { paths: string[]; targetContainerId?: string; clientX?: number; clientY?: number }) => Promise<unknown>;
    __naimageDebugImportPathsAsSources?: (payload: { paths: string[] }) => Promise<unknown>;
    __naimageDebugImportPathsAsReferences?: (payload: { paths: string[] }) => Promise<unknown>;
    __naimageDebugCreateImageContainer?: (payload?: { worldX?: number; worldY?: number; role?: AssetTaskRole }) => Promise<unknown>;
    __naimageDebugMoveContainerAsset?: (payload: { sourceContainerId: string; assetKey: string; targetContainerId?: string; clientX?: number; clientY?: number }) => Promise<unknown>;
    __naimageDebugNativeAssetDrop?: (payload: { sourceNodeId: string; targetContainerId: string; assetIndex?: number; assetKey?: string }) => Promise<unknown>;
    __naimageDebugLayoutSnapshot?: () => Record<string, unknown>;
    __naimageResizeObserverMetrics?: {
      created: number;
      disconnected: number;
      callbacks: number;
      observed: number;
      unobserved: number;
      activeObservers: number;
      activeDialogs: number;
      maxActiveDialogs: number;
    };
    __naimagePerformanceProbe?: {
      profile: "production-like";
      snapshot(): Record<string, unknown>;
    };
    __naimageAIDebug?: {
      state(): unknown;
      performanceState(): {
        nodeCount: number;
        parentedNodeCount: number;
        messageCount: number;
        selectedNodeId: string;
        viewport: { x: number; y: number; scale: number };
      };
      layerState(): {
        selectedNodeId: string;
        detachAudit: Array<{ at: number; action: "detach" | "explode" | "recompose" | "cancel"; source: string; nodeId: string; groupId?: string; pointerId?: number; pointerType?: string; eventType?: string; dx?: number; dy?: number }>;
        nodes: Array<{
          id: string;
          assetCount: number;
          layerGroup?: ImageLayerNodeGroup;
        }>;
      };
      resetLayerDetachAudit(): { ok: boolean };
      renderCommits(): { app: number; canvas: number; agentFeed: number; composer: number };
      resetRenderCommits(): { app: number; canvas: number; agentFeed: number; composer: number };
      persistenceMetrics(): {
        mutationCount: number;
        scheduledWriteCount: number;
        coalescedWriteCount: number;
        writeCount: number;
        skippedWriteCount: number;
        failedWriteCount: number;
        totalFlushMs: number;
        maxFlushMs: number;
        lastFlushMs: number;
        flushMs: number;
        pendingWriteCount: number;
        source: string;
      };
      resetPersistenceMetrics(): Record<string, number>;
      tools(): Promise<unknown>;
      imageImportStatus(payload?: { reset?: boolean }): Promise<unknown>;
      cancelImageImports(): Promise<unknown>;
      addReferencePickerPaths(payload?: { paths?: string[] }): Promise<unknown>;
       seedCanvas(payload?: { count?: number; fileBacked?: boolean; duplicateContent?: boolean }): Promise<unknown>;
       seedSelectionCanvas(): Promise<unknown>;
       seedConnectionGeometryCanvas(): Promise<unknown>;
       selectNodes(payload: { ids: string[]; primaryId?: string }): Promise<unknown>;
      deleteSelectedNodes(): Promise<unknown>;
      mergeSelectedImages(): Promise<unknown>;
      createProbeImage(): Promise<unknown>;
      fitCanvas(): Promise<unknown>;
      resumeLayoutRefocus(): { ok: boolean };
      moveLayer(payload: { nodeId: string; layerId: string; x: number; y: number }): Promise<unknown>;
      recomposeLayer(payload: { id: string }): Promise<unknown>;
      nativeAssetDrop(payload: { sourceNodeId: string; targetContainerId: string; assetIndex?: number; assetKey?: string }): Promise<unknown>;
      openImageViewer(payload: { id: string; index?: number }): Promise<unknown>;
      openLayerViewer(payload: { id: string; mode?: "composite" | "solo" | "onion" }): Promise<unknown>;
      openNodeEditor(payload: { id: string; index?: number }): Promise<unknown>;
      toggleNodeEditorMaximized(): Promise<unknown>;
      openRequirementForSource(payload: { id: string }): Promise<unknown>;
      openRequirementAt(payload: { worldX?: number; worldY?: number }): Promise<unknown>;
      setContainerRole(payload: { id: string; role?: AssetTaskRole }): Promise<unknown>;
      openRequirementEditor(payload: { id: string }): Promise<unknown>;
      executeRequirement(payload: { id: string; confirmedUnchanged?: boolean }): Promise<unknown>;
      disconnectNodeInput(payload: { id: string }): Promise<unknown>;
      newConversation(): Promise<unknown>;
      selectNode(payload: { id: string }): Promise<unknown>;
      openNodeMenu(payload: { id: string; x?: number; y?: number }): Promise<unknown>;
      runTool(payload: { name: string; input?: Record<string, unknown>; selectedNodeId?: string; referenceImages?: ReferenceImage[] }): Promise<unknown>;
      chat(prompt: string, options?: { skipAsk?: boolean; timeoutMs?: number }): Promise<unknown>;
      runSuite(): Promise<unknown>;
      runRealAgentSuite(payload?: { liveImage?: boolean; skipImage?: boolean }): Promise<unknown>;
      runExperienceImageSuite(): Promise<unknown>;
      runImageSuite(payload?: { runs?: number }): Promise<unknown>;
      runImageRecoverySuite(): Promise<unknown>;
      runCanvasImageCollectionSuite(): Promise<unknown>;
      runLayerStackSuite(options?: { agentDriven?: boolean; liveImage?: boolean }): Promise<unknown>;
      runCutoutSuite(options?: { liveImage?: boolean }): Promise<unknown>;
      runRegionRedrawSuite(options?: { liveImage?: boolean }): Promise<unknown>;
      runPosterBatchSuite(payload?: { total?: number; agentCount?: number; directCount?: number; resolution?: string; quality?: string }): Promise<unknown>;
      runMixedStressSuite(payload?: { rounds?: number }): Promise<unknown>;
    };
    __naimageLastFloatingDrag?: Record<string, unknown>;
  }
}

// -----------------------------------------------------------------------------
// CORE 03 Formatting And Labels
// -----------------------------------------------------------------------------

export function yuan(cents?: number) {
  return `¥${((cents ?? 0) / 100).toFixed(2)}`;
}

export function friendlyAgentError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Agent 辅助执行失败。");
  if (/invalid token/i.test(raw)) return "登录已失效，请重新登录后再执行 Agent 辅助。";
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/\s*\(request id:[^)]+\)/i, "")
    .trim()
    .slice(0, 180) || "Agent 辅助执行失败。";
}

export function friendlyImageError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "生图失败。");
  const clean = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/\s*\(request id:[^)]+\)/i, "")
    .trim();
  if (/invalid token/i.test(clean)) return "登录已失效，请重新登录后再生成图片。";
  if (/openai_error/i.test(clean)) return "上游图片模型返回 openai_error。请检查生图渠道模型、余额/权限，或提示词限制。";
  if (/fetch failed|econnrefused|network/i.test(clean)) return "生图服务连接失败，请确认本地服务和远程渠道可用。";
  return clean.slice(0, 220) || "生图失败。";
}

export function compactModelName(model: string) {
  const clean = String(model || "").trim();
  if (!clean) return "默认";
  return clean.length > 18 ? `${clean.slice(0, 16)}...` : clean;
}

export function splitPromptError(prompt: unknown) {
  const raw = typeof prompt === "string" ? prompt : "";
  const match = raw.match(/\n\s*error:\s*([\s\S]+)$/i);
  if (!match) return { prompt: raw, error: "" };
  return {
    prompt: raw.slice(0, match.index).trimEnd(),
    error: match[1]?.trim() ?? ""
  };
}

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

// -----------------------------------------------------------------------------
// CORE 04 Image Generation Options And Size Rules
// -----------------------------------------------------------------------------

const IMAGE2_MAX_EDGE = 3840;
const IMAGE2_MIN_PIXELS = 655_360;
const IMAGE2_MAX_PIXELS = 8_294_400;
export const IMAGE2_SOURCE_REQUEST_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

export type ImageModelCapability = {
  family: ImageModelFamily;
  label: string;
  supportsTransparentBackground: boolean;
  supportsInputFidelity: boolean;
  supportsImage2SizeRules: boolean;
  note: string;
};

export function imageModelFamily(model?: string): ImageModelFamily {
  const clean = String(model || "").trim().toLowerCase();
  if (/^gpt-image-2\b/.test(clean)) return "gpt-image-2";
  if (/^gpt-image-1\.5\b/.test(clean)) return "gpt-image-1.5";
  if (/^gpt-image-1\b/.test(clean)) return "gpt-image-1";
  return "compatible";
}

export function isImage1Model(model?: string) {
  return imageModelFamily(model) === "gpt-image-1";
}

export function isImage15Model(model?: string) {
  return imageModelFamily(model) === "gpt-image-1.5";
}

export function isImage2Model(model?: string) {
  return imageModelFamily(model) === "gpt-image-2";
}

export function imageModelCapability(model?: string): ImageModelCapability {
  const family = imageModelFamily(model);
  if (family === "gpt-image-2") {
    return {
      family,
      label: "Image 2",
      supportsTransparentBackground: true,
      supportsInputFidelity: true,
      supportsImage2SizeRules: true,
      note: "使用稳定基础画幅生成，并校验透明与最终交付尺寸。"
    };
  }
  if (family === "gpt-image-1.5") {
    return {
      family,
      label: "Image 1.5",
      supportsTransparentBackground: true,
      supportsInputFidelity: true,
      supportsImage2SizeRules: false,
      note: "适合透明 PNG、图层素材和编辑任务。"
    };
  }
  if (family === "gpt-image-1") {
    return {
      family,
      label: "Image 1.0",
      supportsTransparentBackground: true,
      supportsInputFidelity: true,
      supportsImage2SizeRules: false,
      note: "兼容旧版图像接口和编辑任务。"
    };
  }
  return {
    family,
    label: "Image API",
    supportsTransparentBackground: true,
    supportsInputFidelity: true,
    supportsImage2SizeRules: false,
    note: "兼容渠道模型，能力由上游决定。"
  };
}

export function imageModelCapabilitySummary(model?: string) {
  const capability = imageModelCapability(model);
  const flags = [
    capability.supportsTransparentBackground ? "透明" : "非透明",
    capability.supportsImage2SizeRules ? "Image2 尺寸" : "兼容尺寸"
  ];
  return `${capability.label} · ${flags.join(" · ")} · ${capability.note}`;
}

export function uniqueImageModels(models: unknown[] = []) {
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

export function normalizeModelConnectionBindings(value: unknown): ModelConnectionBinding[] {
  if (!Array.isArray(value)) return [];
  const bindings: ModelConnectionBinding[] = [];
  const bindingByModel = new Map<string, ModelConnectionBinding>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const model = String(source.model || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 180);
    if (!model) continue;
    const modelKey = model.toLowerCase();
    let binding = bindingByModel.get(modelKey);
    if (!binding) {
      binding = { model };
      bindingByModel.set(modelKey, binding);
      bindings.push(binding);
    }
    const customBaseUrl = typeof (source.customBaseUrl ?? source.baseUrl) === "string"
      ? String(source.customBaseUrl ?? source.baseUrl)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 2_048)
      : "";
    const customApiKey = typeof source.customApiKey === "string"
      ? source.customApiKey.trim().slice(0, 8_192)
      : "";
    const accountTokenId = String(source.accountTokenId || "").trim();
    if (customBaseUrl) binding.customBaseUrl = customBaseUrl;
    if (customApiKey) binding.customApiKey = customApiKey;
    if (/^[1-9]\d{0,31}$/.test(accountTokenId)) binding.accountTokenId = accountTokenId;
  }
  return bindings;
}

export function normalizeAgentModelBindings(value: unknown): AgentModelBinding[] {
  return normalizeModelConnectionBindings(value);
}

export function normalizeImageModelBindings(value: unknown): ImageModelBinding[] {
  return normalizeModelConnectionBindings(value);
}

export function modelConnectionBindingFor(bindings: unknown, model: unknown): ModelConnectionBinding | undefined {
  const modelKey = String(model || "").trim().toLowerCase();
  if (!modelKey) return undefined;
  return normalizeModelConnectionBindings(bindings)
    .find((binding) => binding.model.toLowerCase() === modelKey);
}

export function agentModelBindingFor(settings: { agentModelBindings?: unknown }, model: unknown): AgentModelBinding | undefined {
  return modelConnectionBindingFor(settings.agentModelBindings, model);
}

export function imageModelBindingFor(settings: { imageModelBindings?: unknown }, model: unknown): ImageModelBinding | undefined {
  return modelConnectionBindingFor(settings.imageModelBindings, model);
}

export function imageModelsWithPreferredFallback(models: string[] = [], preferred?: string, selectedModels: string[] = []) {
  const ordered = [preferred, ...selectedModels, ...models]
    .map((model) => String(model || "").trim())
    .filter(Boolean);
  return ordered.filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

export function modelsWithPreferred(models: string[] = [], preferred?: string, selectedModels: string[] = []) {
  const ordered = [preferred, ...selectedModels, ...models]
    .map((model) => String(model || "").trim())
    .filter(Boolean);
  return ordered.filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

export function selectedAgentModelsFromSettings(
  settings: Pick<ApiSettings, "agentModel" | "agentModelPool"> & Partial<Pick<ApiSettings, "agentModelBindings">>
) {
  return uniqueImageModels([
    settings.agentModel,
    ...(Array.isArray(settings.agentModelPool) ? settings.agentModelPool : []),
    ...(Array.isArray(settings.agentModelBindings) ? settings.agentModelBindings.map((binding) => binding.model) : [])
  ]);
}

export function selectedImageModelsFromSettings(settings: Pick<ApiSettings, "imageModel" | "imageModelPool">) {
  return uniqueImageModels([settings.imageModel, ...(Array.isArray(settings.imageModelPool) ? settings.imageModelPool : [])]);
}

export function selectedVideoModelsFromSettings(settings: Pick<ApiSettings, "videoModel" | "videoModelPool">) {
  return uniqueImageModels([settings.videoModel, ...(Array.isArray(settings.videoModelPool) ? settings.videoModelPool : [])]);
}

export function normalizeAgentModelPoolSelection(settings: AppSettings, availableModels: string[] = []): AppSettings {
  const available = modelsWithPreferred(availableModels, settings.agentModel, settings.agentModelPool);
  const selected = selectedAgentModelsFromSettings(settings);
  const modelPool = selected.length ? selected : available.slice(0, 1);
  const agentModel = settings.agentModel && modelPool.some((model) => model.toLowerCase() === settings.agentModel.toLowerCase())
    ? settings.agentModel
    : modelPool[0] || "";
  return {
    ...settings,
    agentModel,
    agentModelPool: uniqueImageModels([agentModel, ...modelPool])
  };
}

export function normalizeImageModelPoolSelection(settings: AppSettings, availableModels: string[] = []): AppSettings {
  const available = imageModelsWithPreferredFallback(availableModels, settings.imageModel, settings.imageModelPool);
  const selected = selectedImageModelsFromSettings(settings);
  const modelPool = selected.length ? selected : available.slice(0, 1);
  const imageModel = settings.imageModel && modelPool.some((model) => model.toLowerCase() === settings.imageModel.toLowerCase())
    ? settings.imageModel
    : modelPool[0] || "";
  return {
    ...settings,
    imageModel,
    imageModelPool: uniqueImageModels([imageModel, ...modelPool])
  };
}

export function normalizeVideoModelPoolSelection(settings: AppSettings, availableModels: string[] = []): AppSettings {
  const available = modelsWithPreferred(availableModels, settings.videoModel, settings.videoModelPool);
  const selected = selectedVideoModelsFromSettings(settings);
  const modelPool = selected.length ? selected : available.slice(0, 1);
  const videoModel = settings.videoModel && modelPool.some((model) => model.toLowerCase() === settings.videoModel.toLowerCase())
    ? settings.videoModel
    : modelPool[0] || "";
  return {
    ...settings,
    videoModel,
    videoModelPool: uniqueImageModels([videoModel, ...modelPool])
  };
}

export function normalizeModelPoolSelections(
  settings: AppSettings,
  availableAgentModels: string[] = [],
  availableImageModels: string[] = [],
  availableVideoModels: string[] = []
): AppSettings {
  return normalizeVideoModelPoolSelection(
    normalizeImageModelPoolSelection(normalizeAgentModelPoolSelection(settings, availableAgentModels), availableImageModels),
    availableVideoModels
  );
}

export function toggleImageModelSelection(settings: AppSettings, model: string): AppSettings {
  const clean = String(model || "").trim();
  if (!clean) return normalizeImageModelPoolSelection(settings);
  const selected = selectedImageModelsFromSettings(settings);
  const exists = selected.some((item) => item.toLowerCase() === clean.toLowerCase());
  const nextPool = exists && selected.length > 1
    ? selected.filter((item) => item.toLowerCase() !== clean.toLowerCase())
    : exists
      ? selected
      : uniqueImageModels([clean, ...selected]);
  const imageModel = nextPool.some((item) => item.toLowerCase() === settings.imageModel.toLowerCase()) ? settings.imageModel : nextPool[0] || clean;
  return normalizeImageModelPoolSelection({ ...settings, imageModel, imageModelPool: nextPool });
}

export function setPrimaryImageModelSelection(settings: AppSettings, model: string): AppSettings {
  const clean = String(model || "").trim();
  if (!clean) return normalizeImageModelPoolSelection(settings);
  return normalizeImageModelPoolSelection({
    ...settings,
    imageModel: clean,
    imageModelPool: uniqueImageModels([clean, ...selectedImageModelsFromSettings(settings)])
  });
}

export function setPrimaryAgentModelSelection(settings: AppSettings, model: string): AppSettings {
  const clean = String(model || "").trim();
  if (!clean) return normalizeAgentModelPoolSelection(settings);
  return normalizeAgentModelPoolSelection({
    ...settings,
    agentModel: clean,
    agentModelPool: uniqueImageModels([clean, ...selectedAgentModelsFromSettings(settings)])
  });
}

export const FRAME_OPTIONS = [
  { ratio: "1:1", label: "方图", use: "头像 / 商品 / 社媒封面", previewClass: "square" },
  { ratio: "16:9", label: "横屏宽图", use: "横版海报 / 桌面壁纸", previewClass: "wide" },
  { ratio: "9:16", label: "竖屏长图", use: "手机壁纸 / 短视频封面", previewClass: "tall" },
  { ratio: "4:3", label: "经典横图", use: "插画 / 展示图 / 打印草图", previewClass: "classic" },
  { ratio: "3:4", label: "经典竖图", use: "人物设定 / 竖版海报", previewClass: "portrait" },
  { ratio: "3:2", label: "相机横图", use: "摄影感 / 画册 / 场景图", previewClass: "photo-wide" },
  { ratio: "2:3", label: "相机竖图", use: "人物写真 / 竖版构图", previewClass: "photo-tall" },
  { ratio: "21:9", label: "电影宽屏", use: "电影感 / 大场景 / 横幅", previewClass: "cinema" },
  { ratio: "9:21", label: "超长竖屏", use: "手机长图 / 竖屏长海报", previewClass: "scroll" },
  { ratio: "4:5", label: "社媒竖图", use: "小红书 / Instagram / 电商", previewClass: "social" }
] as const satisfies readonly { ratio: ImageFrameRatio; label: string; use: string; previewClass: string }[];

export const SIZE_PRESETS = [
  {
    id: "1k",
    resolution: "1K",
    longEdge: 1280,
    squareEdge: 1024,
    label: "1K 标准",
    detail: "日常预览和快速出图；实际像素会按所选比例计算。",
    badge: "推荐"
  },
  {
    id: "2k",
    resolution: "2K",
    longEdge: 2048,
    squareEdge: 2048,
    label: "2K 高清",
    detail: "更适合细节审稿、人物设定和后期调整。",
    badge: "高清"
  },
  {
    id: "4k",
    resolution: "4K",
    longEdge: 3840,
    squareEdge: 2880,
    label: "4K 成片",
    detail: "最终输出和大图裁切，生成会更慢、成本更高。",
    badge: "成片"
  }
] as const satisfies readonly {
  id: string;
  resolution: ImageResolutionPreset;
  longEdge: number;
  squareEdge: number;
  label: string;
  detail: string;
  badge: string;
}[];

export const QUALITY_OPTIONS = [
  { value: "auto", label: "自动", detail: "服务端按模型默认选择" },
  { value: "low", label: "草稿", detail: "更快，适合抽卡试方向" },
  { value: "medium", label: "标准", detail: "常规成图平衡档" },
  { value: "high", label: "精细", detail: "最终图和复杂细节" }
] as const satisfies readonly { value: AppSettings["imageQuality"]; label: string; detail: string }[];
export const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const IMAGE_BATCH_MODE_OPTIONS: { value: ImageBatchMode; label: string; detail: string }[] = [
  { value: "parallel", label: "并行", detail: "多张图同时请求，合并在一个节点中显示，可随时拆分。" }
];
export const MAX_REFERENCE_IMAGES = 9;
export const MAX_AGENT_REFERENCE_IMAGES = 40;
export const MAX_AGENT_SOURCE_IMAGES = 200;

export function normalizeImageFrameRatio(value: unknown, fallback: ImageFrameRatio = "1:1"): ImageFrameRatio {
  const ratio = String(value || "").trim().replace("：", ":") as ImageFrameRatio;
  return FRAME_OPTIONS.some((option) => option.ratio === ratio) ? ratio : fallback;
}

export function normalizeImageResolutionPreset(value: unknown, fallback: ImageResolutionPreset = "1K"): ImageResolutionPreset {
  const resolution = String(value || "").trim().toUpperCase();
  if (resolution === "2K" || resolution === "4K") return resolution;
  if (resolution === "1K" || resolution === "720P" || resolution === "1080P") return "1K";
  return fallback;
}

export function imageResolutionPresetFromSize(value: unknown): ImageResolutionPreset {
  const text = String(value || "").trim().toUpperCase();
  if (text === "4K" || text.includes("3840") || text.includes("2160")) return "4K";
  if (text === "2K" || text.includes("2048")) return "2K";
  return "1K";
}

export function imageFrameRatioFromSize(value: unknown, fallback: ImageFrameRatio = "1:1"): ImageFrameRatio {
  const parsed = parseImageSizeValue(String(value || ""));
  if (!parsed || parsed.width <= 0 || parsed.height <= 0) return fallback;
  const target = parsed.width / parsed.height;
  let nearest: ImageFrameRatio = FRAME_OPTIONS[0].ratio;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const option of FRAME_OPTIONS) {
    const parsedOption = parseRatio(option.ratio);
    const distance = Math.abs((parsedOption.width / parsedOption.height) - target);
    if (distance >= nearestDistance) continue;
    nearest = option.ratio;
    nearestDistance = distance;
  }
  return nearestDistance <= 0.035 ? nearest : fallback;
}

export function defaultImageTaskDraft(settings: AppSettings): ImageTaskDraft {
  const ratio = normalizeImageFrameRatio(settings.imageRatio, imageFrameRatioFromSize(settings.imageSize));
  const resolution = normalizeImageResolutionPreset(settings.imageResolution, imageResolutionPresetFromSize(settings.imageSize));
  return {
    prompt: "",
    ratio,
    resolution,
    size: "",
    count: settings.imageCount,
    quality: settings.imageQuality,
    batchMode: "parallel",
    model: settings.imageModel || ""
  };
}

function parseRatio(ratio: string) {
  const [rawW, rawH] = ratio.split(":").map((item) => Number(item));
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;
  const max = Math.max(width, height);
  const min = Math.min(width, height);
  if (max / min > 3) return { width: 1, height: 1 };
  return { width, height };
}

function roundToImageStep(value: number) {
  return Math.max(512, Math.round(value / 16) * 16);
}

function sizePresetForResolution(resolution: string) {
  const normalized = normalizeImageResolutionPreset(resolution);
  return SIZE_PRESETS.find((item) => item.resolution === normalized) ?? SIZE_PRESETS[0];
}

export function computedSizeFor(ratio: string, resolution: string) {
  const preset = sizePresetForResolution(resolution);
  const parsed = parseRatio(ratio);
  if (parsed.width === parsed.height) {
    const edge = roundToImageStep(preset.squareEdge);
    return `${edge}x${edge}`;
  }
  const landscape = parsed.width > parsed.height;
  const longUnits = Math.max(parsed.width, parsed.height);
  const shortUnits = Math.min(parsed.width, parsed.height);
  const pixelLimitedLongEdge = Math.floor(Math.sqrt((IMAGE2_MAX_PIXELS * longUnits) / shortUnits) / 16) * 16;
  let longEdge = Math.min(roundToImageStep(preset.longEdge), IMAGE2_MAX_EDGE, pixelLimitedLongEdge);
  const dimensionsForLongEdge = (value: number) => {
    const shortEdge = roundToImageStep((value * shortUnits) / longUnits);
    return landscape ? { width: value, height: shortEdge } : { width: shortEdge, height: value };
  };
  let dimensions = dimensionsForLongEdge(longEdge);
  while (dimensions.width * dimensions.height > IMAGE2_MAX_PIXELS && longEdge > 512) {
    longEdge -= 16;
    dimensions = dimensionsForLongEdge(longEdge);
  }
  return `${dimensions.width}x${dimensions.height}`;
}

export function parseImageSizeValue(size: string) {
  const match = String(size || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function isImage2DeliverySize(size: string) {
  const parsed = parseImageSizeValue(size);
  if (!parsed) return false;
  const { width, height } = parsed;
  const pixels = width * height;
  const maxEdge = Math.max(width, height);
  const minEdge = Math.min(width, height);
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    maxEdge <= IMAGE2_MAX_EDGE &&
    maxEdge / minEdge <= 3 &&
    pixels >= IMAGE2_MIN_PIXELS &&
    pixels <= IMAGE2_MAX_PIXELS
  );
}

export function image2SourceRequestSizeForDelivery(size: string) {
  const parsed = parseImageSizeValue(size);
  if (!parsed || parsed.width === parsed.height) return IMAGE2_SOURCE_REQUEST_SIZES[0];
  return parsed.width > parsed.height ? IMAGE2_SOURCE_REQUEST_SIZES[1] : IMAGE2_SOURCE_REQUEST_SIZES[2];
}

export function isImage2DeliveryFrame(ratio: string, resolution: string) {
  return isImage2DeliverySize(computedSizeFor(ratio, resolution));
}

export function frameOptionsForModel(resolution: string, imageModel?: string) {
  if (!isImage2Model(imageModel)) return FRAME_OPTIONS;
  return FRAME_OPTIONS.filter((option) => isImage2DeliveryFrame(option.ratio, resolution));
}

export function sizePresetsForModel(ratio: string, imageModel?: string) {
  if (!isImage2Model(imageModel)) return SIZE_PRESETS;
  return SIZE_PRESETS.filter((option) => isImage2DeliveryFrame(ratio, option.resolution));
}

export function sizeFromDraft(draft: ImageTaskDraft, settings: AppSettings) {
  if (["1K", "2K", "4K", "720P", "1080P"].includes(String(draft.resolution).toUpperCase())) {
    return computedSizeFor(draft.ratio, draft.resolution);
  }
  return draft.size || settings.imageSize || "1024x1024";
}

export function frameOptionFor(ratio: string) {
  return FRAME_OPTIONS.find((item) => item.ratio === ratio) ?? FRAME_OPTIONS[0];
}

export function sizePresetFor(draft: ImageTaskDraft) {
  return sizePresetForResolution(draft.resolution);
}

export function badgeFor(option: (typeof SIZE_PRESETS)[number]) {
  return "badge" in option ? option.badge : undefined;
}

export function frameSummary(draft: ImageTaskDraft) {
  const frame = frameOptionFor(draft.ratio);
  return `${frame.label} · ${draft.ratio} · ${computedSizeFor(draft.ratio, draft.resolution)}`;
}

export function qualityLabel(value?: AppSettings["imageQuality"] | string) {
  return QUALITY_OPTIONS.find((option) => option.value === value)?.label ?? String(value || "自动");
}

export function batchModeLabel(value?: ImageBatchMode | string) {
  return IMAGE_BATCH_MODE_OPTIONS.find((option) => option.value === value)?.label ?? "并行";
}

// -----------------------------------------------------------------------------
// CORE 05 Prompt Intent And Multi-Image Prompt Utilities
// -----------------------------------------------------------------------------

export function shouldAskImageParams(prompt: string) {
  const text = prompt.toLowerCase();
  const wantsImage = wantsImageWork(prompt);
  if (!wantsImage) return false;
  const hasSize = /1:1|16:9|9:16|4:3|3:4|2k|4k|1024|1536|2048|2160|3840|比例|分辨率|尺寸|张/.test(text);
  return !hasSize;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function requestedImageCountFromText(prompt: string) {
  const text = String(prompt || "");
  const digit = text.match(/(?:生成|画|出|做|绘制)?\s*(\d{1,2})\s*(张|版|个版本|个方案)/i) || text.match(/\bn\s*[:=]\s*(\d{1,2})\b/i);
  if (digit) return clamp(Number(digit[1]), 1, 10);
  const chineseMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const chinese = text.match(/(?:生成|画|出|做|绘制)?\s*([一二两三四五六七八九十])\s*(张|版|个版本|个方案)/);
  return chinese ? chineseMap[chinese[1]] ?? 1 : 1;
}

export function explicitCollageRequested(prompt: string) {
  return /(拼接|拼图|合并成一张|同一张图|同一画布|九宫格|三联图|四宫格|分镜|拼贴|长图|contact\s*sheet|collage|diptych|triptych)/i.test(prompt);
}

export function stripMultiImageCountDirective(prompt: string) {
  return String(prompt || "")
    .replace(/(请|帮我|给我|麻烦)?\s*(生成|画|出|做|绘制|创作)\s*([一二两三四五六七八九十\d]{1,3})\s*(张|版|个版本|个方案)\s*/gi, "")
    .replace(/([一二两三四五六七八九十\d]{1,3})\s*(张|版|个版本|个方案)\s*(不同)?\s*(风格|版本|方案|图片|图像)?/gi, "")
    .replace(/\b(count|n)\s*[:=]\s*\d{1,2}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function promptForIndependentImage(prompt: string, count: number, index: number) {
  const raw = prompt.trim();
  if (count <= 1 || explicitCollageRequested(raw)) return raw;
  const singlePrompt = stripMultiImageCountDirective(raw) || raw;
  return [
    singlePrompt,
    "",
    `独立图片 ${index + 1}/${count}：只生成一张完整画面。不要把多张图片拼接到同一张画布中；不要三联图、九宫格、分镜、拼贴、contact sheet、before/after 对比图。`
  ].join("\n");
}

export function wantsImageWork(prompt: string) {
  const text = prompt.toLowerCase();
  return /生图|生成图|出图|画一张|图片|画面|插画|照片|图像|image|draw|generate|image_gen|askuser/.test(text);
}

// -----------------------------------------------------------------------------
// CORE 05B Paste Block Utilities
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// CORE 06 Workflow Clone Utilities
// -----------------------------------------------------------------------------

export function cloneReferenceImages(images?: ReferenceImage[]) {
  return (images ?? []).map((image) => ({ ...image }));
}

export function mergeReferenceImages(current: ReferenceImage[], incoming: ReferenceImage[], max = MAX_REFERENCE_IMAGES) {
  const candidates = [...current, ...incoming].filter((image) => Boolean(
    image && (
      image.path || image.relativePath || image.assetUrl || image.contentHash || image.assetId
    )
  ));
  const resolutions = reconcileImageAssetIdentityClaims(candidates.map((image, index) => ({
    ...image,
    ownerId: "reference-list",
    assetIndex: index,
    index: index + 1
  })));
  const next: ReferenceImage[] = [];
  const indexByLogicalId = new Map<string, number>();
  for (const [index, image] of candidates.entries()) {
    const assetId = resolutions[index].assetId;
    const occurrenceId = typeof image.occurrenceId === "string" && /^occ-[a-f0-9]{16,64}$/i.test(image.occurrenceId.trim())
      ? image.occurrenceId.trim().toLowerCase()
      : undefined;
    const logicalId = occurrenceId ? `occurrence:${occurrenceId}` : `asset:${assetId}`;
    const existingIndex = indexByLogicalId.get(logicalId);
    if (existingIndex !== undefined) {
      next[existingIndex] = { ...next[existingIndex], ...image, assetId, occurrenceId };
      continue;
    }
    if (next.length >= max) continue;
    indexByLogicalId.set(logicalId, next.length);
    next.push({ ...image, assetId, occurrenceId });
  }
  return next;
}

export function cloneImageTaskDraft(draft: ImageTaskDraft): ImageTaskDraft {
  return {
    ...draft,
    referenceImages: cloneReferenceImages(draft.referenceImages)
  };
}

export function cloneImageAssets(assets?: ImageAsset[]) {
  return (assets ?? []).map(cloneImageAsset);
}

function cloneImageAsset(asset: ImageAsset): ImageAsset {
  return {
    ...asset,
    generation: asset.generation ? {
      ...asset.generation,
      request: asset.generation.request ? { ...asset.generation.request } : undefined,
      response: asset.generation.response ? { ...asset.generation.response } : undefined
    } : undefined
  };
}

export function cloneImageLayerComposition(composition?: ImageLayerComposition): ImageLayerComposition | undefined {
  if (!composition) return undefined;
  return {
    ...composition,
    previewAsset: composition.previewAsset ? cloneImageAsset(composition.previewAsset) : undefined,
    mergedAsset: composition.mergedAsset ? cloneImageAsset(composition.mergedAsset) : undefined,
    layers: composition.layers.map((layer) => ({
      ...layer,
      asset: layer.asset ? cloneImageAsset(layer.asset) : undefined
    }))
  };
}

export function cloneImageLayerNodeGroup(group?: ImageLayerNodeGroup): ImageLayerNodeGroup | undefined {
  if (!group) return undefined;
  return {
    ...group,
    previewAsset: group.previewAsset ? cloneImageAsset(group.previewAsset) : undefined,
    mergedAsset: group.mergedAsset ? cloneImageAsset(group.mergedAsset) : undefined,
    recovery: group.recovery ? {
      ...group.recovery,
      failedLayerIds: [...group.recovery.failedLayerIds],
      successfulLayerIds: [...group.recovery.successfulLayerIds]
    } : undefined
  };
}

export function cloneImageCollection(collection?: ImageCollection): ImageCollection | undefined {
  if (!collection) return undefined;
  return {
    ...collection,
    items: collection.items.map((item) => ({
      ...item,
      ...(item.taskProvenance ? {
        taskProvenance: {
          ...item.taskProvenance,
          commerceCatalogTarget: item.taskProvenance.commerceCatalogTarget
            ? structuredClone(item.taskProvenance.commerceCatalogTarget)
            : undefined,
          socialContent: item.taskProvenance.socialContent ? { ...item.taskProvenance.socialContent } : undefined,
          scientificFigure: item.taskProvenance.scientificFigure
            ? structuredClone(item.taskProvenance.scientificFigure)
            : undefined
        }
      } : {})
    }))
  };
}

export function cloneImageContainerSpec(spec?: ImageContainerSpec): ImageContainerSpec | undefined {
  if (!spec) return undefined;
  return {
    ...spec,
    memberNodeIds: [...spec.memberNodeIds],
    childContainerNodeIds: [...spec.childContainerNodeIds],
    memberBindings: spec.memberBindings.map((binding) => ({ ...binding })),
    collection: cloneImageCollection(spec.collection)
  };
}

export function cloneWorkflowNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    assets: cloneImageAssets(node.assets),
    videoAsset: node.videoAsset ? { ...node.videoAsset } : undefined,
    imageParams: node.imageParams ? cloneImageTaskDraft(node.imageParams) : undefined,
    imageProgress: node.imageProgress ? { ...node.imageProgress } : undefined,
    layerGroup: cloneImageLayerNodeGroup(node.layerGroup),
    layerComposition: cloneImageLayerComposition(node.layerComposition),
    imageContainerSpec: cloneImageContainerSpec(node.imageContainerSpec),
    imageCollection: cloneImageCollection(node.imageCollection),
    taskProvenance: node.taskProvenance ? {
      ...node.taskProvenance,
      socialContent: node.taskProvenance.socialContent ? { ...node.taskProvenance.socialContent } : undefined,
      scientificFigure: node.taskProvenance.scientificFigure
        ? structuredClone(node.taskProvenance.scientificFigure)
        : undefined
    } : undefined,
    socialContent: node.socialContent ? { ...node.socialContent } : undefined,
    scientificFigure: node.scientificFigure ? structuredClone(node.scientificFigure) : undefined,
    requirement: node.requirement ? {
      ...node.requirement,
      inputBindings: node.requirement.inputBindings?.map((binding) => ({ ...binding })),
      socialPlan: node.requirement.socialPlan ? structuredClone(node.requirement.socialPlan) : undefined,
      scientificPlan: node.requirement.scientificPlan ? structuredClone(node.requirement.scientificPlan) : undefined
    } : undefined
  };
}

// -----------------------------------------------------------------------------
// CORE 06B Conversation And Session Utilities
// -----------------------------------------------------------------------------

const shortTimeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

function nowLabel() {
  return shortTimeFormatter.format(new Date());
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

export function sanitizeAgentVisibleText(value: unknown) {
  const source = String(value ?? "");
  return source
    .replace(
      /experience\s*完成\s*[：:]?\s*fastmemory\s*已写入\s*(?:fmem-[a-z0-9_-]+)?[。.]?/gi,
      "记录经验成功。"
    )
    .replace(/fastmemory\s*已写入\s*(?:fmem-[a-z0-9_-]+)?[。.]?/gi, "记录经验成功。")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:entry[_ ]?ids?|entryId|memoryRef|toolmemoryEntryId|selector|keywords|sourceEntryIds|selectedEntryIds)\s*[:=]/i.test(line))
    .map((line) => line.replace(/\b(?:fmem|ent|pmt|mctx|toolmem)-[a-z0-9_-]+\b/gi, "").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/记录经验成功。[。.]*/g, "记录经验成功。")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeStoredAgentMessageContent(role: MessageRole, value: unknown) {
  const source = String(value ?? "");
  return role === "user" ? source : sanitizeAgentVisibleText(source);
}

export function validMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  const messages = (value as AgentMessage[])
    .filter((message) => message?.id !== "welcome" && !String(message?.content ?? "").toLocaleLowerCase().includes("naimage 已就绪"))
    .map((message) => {
      const pasteBlocks = Array.isArray(message.pasteBlocks)
        ? message.pasteBlocks
            .filter((block) => block && typeof block.text === "string")
            .map((block) => ({
              id: typeof block.id === "string" && block.id ? block.id : uid("paste"),
              text: String(block.text),
              createdAt: typeof block.createdAt === "string" ? block.createdAt : nowLabel()
            }))
            .slice(0, 8)
        : undefined;
      const role: MessageRole = message.role === "user" || message.role === "system" ? message.role : "assistant";
      const sanitizeAttachmentItems = (items: unknown, taskRole: AssetTaskRole): TaskAssetReference[] => Array.isArray(items)
        ? items
            .filter((item) => item && typeof item === "object")
            .map((item, index) => {
              const candidate = item as Partial<TaskAssetReference>;
              const rawPath = typeof candidate.path === "string" ? candidate.path.trim() : "";
              const rawRelativePath = typeof candidate.relativePath === "string" ? candidate.relativePath.trim() : "";
              const rawAssetUrl = typeof candidate.assetUrl === "string" ? candidate.assetUrl.trim() : "";
              const path = rawPath && !/^data:/i.test(rawPath) ? safeImageLocatorText(rawPath) : undefined;
              const relativePath = rawRelativePath && !/^data:/i.test(rawRelativePath) ? safeImageLocatorText(rawRelativePath)?.replace(/\\/g, "/") : undefined;
              const assetUrl = rawAssetUrl && !/^data:image\//i.test(rawAssetUrl) ? safeImageLocatorText(rawAssetUrl) : undefined;
              const contentHash = typeof candidate.contentHash === "string" && /^[a-f0-9]{32,128}$/i.test(candidate.contentHash.trim())
                ? candidate.contentHash.trim().toLowerCase()
                : undefined;
              const assetId = typeof candidate.assetId === "string" && candidate.assetId.trim()
                ? candidate.assetId.trim().slice(0, 160)
                : stableImageAssetId({ contentHash, path, relativePath, assetUrl, originalName: candidate.name }, index + 1);
              return {
                bindingId: typeof candidate.bindingId === "string" && candidate.bindingId.trim() ? candidate.bindingId.trim().slice(0, 520) : undefined,
                assetId,
                occurrenceId: typeof candidate.occurrenceId === "string" && /^occ-[a-f0-9]{16,64}$/i.test(candidate.occurrenceId.trim()) ? candidate.occurrenceId.trim().toLowerCase() : undefined,
                importBatchId: typeof candidate.importBatchId === "string" && candidate.importBatchId.trim() ? candidate.importBatchId.trim().slice(0, 160) : undefined,
                importRootId: typeof candidate.importRootId === "string" && candidate.importRootId.trim() ? candidate.importRootId.trim().slice(0, 80) : undefined,
                sourceRelativePath: safeImageSourceRelativePath(candidate.sourceRelativePath),
                sourceRootLabel: typeof candidate.sourceRootLabel === "string" && candidate.sourceRootLabel.trim() ? candidate.sourceRootLabel.trim().slice(0, 260) : undefined,
                sourceRootKind: candidate.sourceRootKind === "directory" ? "directory" as const : candidate.sourceRootKind === "file" ? "file" as const : undefined,
                displayCode: typeof candidate.displayCode === "string" && candidate.displayCode.trim() ? candidate.displayCode.trim().slice(0, 32) : `${taskRole === "source" ? "SRC" : "REF"}${index + 1}`,
                contentHash,
                role: taskRole,
                name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 260) : `${taskRole === "source" ? "原图" : "参考图"} ${index + 1}`,
                assetIndex: Number.isInteger(Number(candidate.assetIndex)) && Number(candidate.assetIndex) >= 0
                  ? Math.floor(Number(candidate.assetIndex))
                  : undefined,
                containerSlot: Number.isInteger(Number(candidate.containerSlot)) && Number(candidate.containerSlot) >= 0
                  ? Math.floor(Number(candidate.containerSlot))
                  : Number.isInteger(Number(candidate.assetIndex)) && Number(candidate.assetIndex) >= 0
                    ? Math.floor(Number(candidate.assetIndex))
                    : undefined,
                ownerAssetIndex: Number.isInteger(Number(candidate.ownerAssetIndex)) && Number(candidate.ownerAssetIndex) >= 0
                  ? Math.floor(Number(candidate.ownerAssetIndex))
                  : undefined,
                ownerNodeId: typeof candidate.ownerNodeId === "string" && candidate.ownerNodeId.trim() ? candidate.ownerNodeId.trim().slice(0, 160) : undefined,
                nodeId: typeof candidate.nodeId === "string" && candidate.nodeId.trim() ? candidate.nodeId.trim().slice(0, 160) : undefined,
                containerId: typeof candidate.containerId === "string" && candidate.containerId.trim() ? candidate.containerId.trim().slice(0, 160) : undefined,
                path,
                relativePath,
                assetUrl,
                mimeType: typeof candidate.mimeType === "string" && candidate.mimeType.trim() ? candidate.mimeType.trim().slice(0, 120) : undefined,
                purpose: typeof candidate.purpose === "string" && candidate.purpose.trim() ? candidate.purpose.trim().slice(0, 500) : undefined,
                referenceRole: taskRole === "reference" && typeof candidate.referenceRole === "string" && candidate.referenceRole.trim() ? candidate.referenceRole.trim().slice(0, 80) : undefined
              };
            })
            .slice(0, 40)
        : [];
      const sourceAssets = sanitizeAttachmentItems(message.attachments?.sourceAssets, "source");
      const referenceAssets = sanitizeAttachmentItems(message.attachments?.referenceAssets, "reference");
      const sourceCount = Math.max(sourceAssets.length, Math.floor(Number(message.attachments?.sourceCount ?? sourceAssets.length) || sourceAssets.length));
      const referenceCount = Math.max(referenceAssets.length, Math.floor(Number(message.attachments?.referenceCount ?? referenceAssets.length) || referenceAssets.length));
      const attachments = sourceCount || referenceCount ? {
        sourceAssets,
        referenceAssets,
        sourceCount,
        referenceCount,
        truncated: message.attachments?.truncated === true || sourceCount > sourceAssets.length || referenceCount > referenceAssets.length
      } : undefined;
      const toolTrace = message.toolTrace
        ? {
            stage: message.toolTrace.stage === "result" ? "result" as const : message.toolTrace.stage === "start" ? "start" as const : undefined,
            operationId: typeof message.toolTrace.operationId === "string" ? message.toolTrace.operationId.slice(0, 180) : undefined,
            label: sanitizeStoredAgentMessageContent("assistant", message.toolTrace.label).slice(0, 80),
            name: sanitizeStoredAgentMessageContent("assistant", message.toolTrace.name).slice(0, 80),
            operation: sanitizeStoredAgentMessageContent("assistant", message.toolTrace.operation).slice(0, 120),
            params: sanitizeStoredAgentMessageContent("assistant", message.toolTrace.params),
            brief: sanitizeStoredAgentMessageContent("assistant", message.toolTrace.brief),
            prompts: Array.isArray(message.toolTrace.prompts)
              ? message.toolTrace.prompts.slice(0, 10).map((item) => ({
                  title: item.title ? String(item.title).slice(0, 120) : undefined,
                  prompt: String(item.prompt || "").slice(0, 24_000)
                })).filter((item) => item.prompt)
              : undefined,
            // Streaming image previews are intentionally transient. Never copy
            // their multi-megabyte data URLs into project conversation history.
            completionText: message.toolTrace.completionText === undefined
              ? undefined
              : sanitizeStoredAgentMessageContent("assistant", message.toolTrace.completionText)
          }
        : undefined;
      const normalized: AgentMessage = {
        ...message,
        role,
        content: sanitizeStoredAgentMessageContent(role, message.content),
        toolTrace,
        pasteBlocks,
        attachments,
        collapsed: message.collapsed === true
      };
      if (normalized.status !== "running") return normalized;
      const interrupted: AgentMessage = {
        ...normalized,
        status: "error",
        meta: "interrupted",
        content: normalized.role === "assistant" ? "上次运行已中断。" : normalized.content
      };
      return interrupted;
    });
  const visibleMessages = messages.filter((message, index) => {
    if (message.meta !== "interrupted" || message.role !== "assistant") return true;
    const next = messages[index + 1];
    return next?.meta !== "interrupted" || next.role !== "assistant";
  });
  return collapseDuplicateToolTimelineMessages(visibleMessages);
}

export function conversationTitleFromMessages(messages: AgentMessage[], fallback = "新会话") {
  const visible = messages.filter((message) => !message.hidden);
  const source = [...visible].reverse().find((message) => message.role === "user" && message.content.trim()) ?? visible.find((message) => message.content.trim());
  const text = source?.content.replace(/\s+/g, " ").trim() ?? "";
  return text ? text.slice(0, 28) : fallback;
}

export function createConversationSnapshot(messages: AgentMessage[], id = uid("conv")): AgentConversation {
  const now = new Date().toISOString();
  return {
    id,
    title: conversationTitleFromMessages(messages),
    messages: validMessages(messages),
    createdAt: now,
    updatedAt: now
  };
}

export function validConversations(value: unknown): AgentConversation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Partial<AgentConversation>;
      const messages = validMessages(source.messages);
      const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : uid("conv");
      const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString();
      return {
        id,
        title: typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 48) : conversationTitleFromMessages(messages),
        messages,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : updatedAt,
        updatedAt
      } satisfies AgentConversation;
    })
    .filter((item): item is AgentConversation => Boolean(item));
}

export function upsertConversation(conversations: AgentConversation[], conversation: AgentConversation) {
  const next = conversations.filter((item) => item.id !== conversation.id);
  return [conversation, ...next].slice(0, 30);
}

// -----------------------------------------------------------------------------
// CORE 07 Image Asset And Canvas Utilities
// -----------------------------------------------------------------------------

export function imageAssetSrc(asset: ImageAsset) {
  return remoteAssetDisplaySource(asset.assetUrl || asset.url || "");
}

export function imageAssetThumbnailSrc(asset: ImageAsset, maxEdge = 512) {
  const source = imageAssetSrc(asset);
  if (!source || !source.startsWith("naimage-asset:")) return source;
  try {
    const url = new URL(source);
    const requestedEdge = clamp(Math.round(Number(maxEdge) || 512), 128, 1024);
    const bucketedEdge = requestedEdge <= 256 ? 256 : requestedEdge <= 512 ? 512 : 1024;
    url.searchParams.set("preview", "thumbnail");
    url.searchParams.set("max", String(bucketedEdge));
    return url.toString();
  } catch {
    return source;
  }
}

export async function imageAssetCanvasSrc(asset: ImageAsset) {
  if (asset.path && window.naimageConfig?.readAssetDataUrl) {
    const result = await window.naimageConfig.readAssetDataUrl({ path: asset.path });
    if (result.ok && result.dataUrl) return result.dataUrl;
    throw new Error(result.error ?? "无法读取本地图片。");
  }
  return imageAssetSrc(asset);
}

export function layerCompositionSummary(composition?: ImageLayerComposition) {
  if (!composition) return "";
  return `图层合成 · ${composition.layers.length} 层 · ${composition.width}x${composition.height}`;
}

export function imageAssetName(asset: ImageAsset) {
  if (asset.originalName?.trim()) return asset.originalName.trim();
  if (asset.path) return asset.path.split(/[\\/]/).pop() || `image-${asset.index ?? 1}.png`;
  const source = asset.url || asset.assetUrl || "";
  if (/^data:image\//i.test(source)) return `image-${asset.index ?? 1}.png`;
  return source.split("/").pop()?.split("?")[0] || `image-${asset.index ?? 1}.png`;
}

export function mimeTypeFromPath(filePath?: string) {
  const ext = String(filePath || "").split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  return "image/png";
}

// -----------------------------------------------------------------------------
// CORE 08 Prompt Style Library
// -----------------------------------------------------------------------------

export const PROMPT_STYLE_LIBRARY: PromptStyleCategory[] = [
  {
    id: "product-visual",
    title: "产品图",
    subtitle: "展示 / 宣传 / 发布 / 研发",
    description: "先定义产品图的商业任务，再选择布局、文字区和后期语言。适合用户已有自定义主体时，用来把提示词提升到商业级表达。",
    hero: "ui/style-library/categories/product-visual.png",
    accent: "mint",
    groups: [
      {
        id: "product-purpose",
        title: "用途方向",
        subtitle: "二级菜单",
        layer: "二级",
        description: "不是选择具体商品，而是选择这张产品图承担的任务。",
        options: [
          { id: "product-display", title: "产品展示", subtitle: "清楚呈现主体", description: "适合主视觉、官网首屏、产品资产图。", prompt: "产品展示图，主体轮廓完整，材质与结构清楚，背景服务产品，不抢主视觉，商业级精修", visual: "mint", tags: ["展示", "主体清楚", "商拍"], negative: "避免主体被遮挡、比例失真、廉价装饰" },
          { id: "product-campaign", title: "产品宣传", subtitle: "情绪与卖点并重", description: "适合品牌 KV、广告图、活动视觉。", prompt: "产品宣传视觉，产品作为核心记忆点，画面有品牌情绪和传播感，预留广告文案空间，卖点自然融入场景", visual: "gold", tags: ["宣传", "KV", "卖点"], negative: "避免文字乱入、背景喧宾夺主" },
          { id: "product-explainer", title: "产品介绍", subtitle: "结构 / 参数 / 使用方式", description: "适合详情页、功能说明、说明书式画面。", prompt: "产品介绍图，结构和使用关系清楚，适合加入功能注释与参数说明，画面信息层级明确，专业可信", visual: "blue", tags: ["介绍", "参数", "说明"] },
          { id: "product-launch", title: "产品发布", subtitle: "新品 / 首发 / 仪式感", description: "适合发布会、新品官宣、预热视频封面。", prompt: "新品发布视觉，产品居于发布舞台或核心光位，强仪式感，轮廓光明确，标题区留白，期待感强", visual: "ink", tags: ["发布", "新品", "仪式感"] },
          { id: "product-design", title: "产品设计", subtitle: "概念 / CMF / 方案感", description: "适合产品概念、工业设计、方案提案。", prompt: "产品设计概念图，强调形体比例、CMF 材质色彩工艺、设计细节和方案感，背景简洁像设计提案", visual: "steel", tags: ["设计", "CMF", "概念"] },
          { id: "product-rnd", title: "产品研发", subtitle: "工程 / 实验 / 原型", description: "适合研发叙事、实验室、技术白皮书。", prompt: "产品研发场景图，原型机或技术组件清楚，实验室或工程工作台氛围，理性可信，体现测试与迭代过程", visual: "cyan", tags: ["研发", "原型", "工程"] }
        ]
      },
      {
        id: "product-layout",
        title: "布局风格",
        subtitle: "三级菜单",
        layer: "三级",
        description: "决定产品、背景和留白之间的关系。",
        options: [
          { id: "product-layout-poster", title: "海报主视觉", subtitle: "中心主体 / 大留白", description: "适合发布、宣传和首屏。", prompt: "海报式产品主视觉，主体居中或黄金分割位，背景有层次但干净，顶部或侧边保留大标题空间", visual: "gold", tags: ["海报", "主视觉", "留白"] },
          { id: "product-layout-western", title: "欧美商业", subtitle: "DTC / 高级 / 大气", description: "适合消费品牌、官网、投放广告。", prompt: "欧美 DTC 商业视觉，简洁大气，材质真实，构图直接，品牌感强，适合官网和社媒投放", visual: "slate", tags: ["欧美", "DTC", "高级"] },
          { id: "product-layout-eastern", title: "东方留白", subtitle: "克制 / 静物 / 意境", description: "适合香氛、茶饮、护肤、家居。", prompt: "东方留白产品视觉，构图克制，轻微自然材质点缀，安静高级，留白充足，画面有呼吸感", visual: "sage", tags: ["东方", "留白", "克制"] },
          { id: "product-layout-tech", title: "科技发布", subtitle: "光带 / 舞台 / 未来", description: "适合电子硬件、软件服务、智能设备。", prompt: "科技发布会式布局，冷色舞台光，产品轮廓清晰，背景有细腻科技线条和空间深度，专业未来感", visual: "blue", tags: ["科技", "发布", "未来"] },
          { id: "product-layout-editorial", title: "杂志编辑", subtitle: "图文关系 / 高级审美", description: "适合品牌故事、画册、产品介绍页。", prompt: "杂志编辑式产品图，图文关系高级，边距统一，主体和辅助物有节奏，适合后期加入标题与短文案", visual: "rose", tags: ["杂志", "编辑", "图文"] }
        ]
      },
      {
        id: "product-typography",
        title: "文字排版",
        subtitle: "四级菜单",
        layer: "四级",
        description: "这里不是让模型生成准确文字，而是预留清晰可用的排版区域。",
        options: [
          { id: "product-type-hero-title", title: "大标题留白", subtitle: "一眼标题区", description: "适合后期添加品牌名和主标题。", prompt: "画面保留明确大标题区域，主体不遮挡文字区，留白干净，标题区背景低噪且对比稳定", visual: "mint", tags: ["标题区", "留白", "排版"] },
          { id: "product-type-selling-points", title: "卖点标签", subtitle: "角标 / 气泡 / 贴纸区", description: "适合功能点、促销点、亮点说明。", prompt: "预留多个卖点标签位置，标签区域与主体保持距离，信息块层级清楚，适合加入短卖点文案", visual: "coral", tags: ["卖点", "标签", "角标"] },
          { id: "product-type-spec-card", title: "参数卡片", subtitle: "规格 / 图标 / 数字", description: "适合电子产品、工具、专业产品。", prompt: "预留参数卡片和图标说明区域，视觉像专业产品规格页，背景整洁，参数区有秩序", visual: "cyan", tags: ["参数", "规格", "卡片"] },
          { id: "product-type-split-copy", title: "图文分栏", subtitle: "左图右字 / 右图左字", description: "适合横版广告和产品介绍页。", prompt: "图文分栏布局，一侧是产品主视觉，一侧是干净文案区，网格边距统一，适合后期排版", visual: "slate", tags: ["分栏", "网格", "文案区"] },
          { id: "product-type-no-text", title: "无字资产", subtitle: "纯图 / 可延展", description: "适合后续自由裁切和多平台复用。", prompt: "无文字纯图资产，画面干净完整，保留可裁切空间，不出现任何乱码文字、logo 或水印", visual: "steel", tags: ["无字", "资产", "可裁切"], negative: "不要出现不可控文字、水印、伪 logo" }
        ]
      },
      {
        id: "product-post",
        title: "后期风格",
        subtitle: "五级菜单",
        layer: "五级",
        description: "决定成片质感，帮助模型理解精修方向。",
        options: [
          { id: "product-post-studio-retouch", title: "棚拍精修", subtitle: "干净 / 锐利 / 商业", description: "适合绝大多数产品成片。", prompt: "商业棚拍精修，细节锐利但不过度，灰尘和瑕疵清理，真实柔和阴影，高级反射", visual: "mint", tags: ["棚拍", "精修", "锐利"] },
          { id: "product-post-premium-glow", title: "高级柔光", subtitle: "柔雾 / 微高光 / 温润", description: "适合护肤、香氛、家居、礼品。", prompt: "高级柔光后期，柔雾高光，低噪点，边缘干净，材质温润，整体高级克制", visual: "gold", tags: ["柔光", "高级", "低噪"] },
          { id: "product-post-material-sharp", title: "材质锐化", subtitle: "纹理 / 边缘 / 结构", description: "适合硬件、服饰、家具、材料。", prompt: "材质锐化后期，纹理清晰，边缘高光准确，结构线条稳定，细节真实不过曝", visual: "steel", tags: ["材质", "纹理", "锐化"] },
          { id: "product-post-film-ad", title: "广告胶片", subtitle: "颗粒 / 情绪 / 品牌片", description: "适合品牌故事和生活方式宣传。", prompt: "广告胶片质感，轻微颗粒，柔和高光，真实暗部层次，品牌故事感，不影响产品清晰度", visual: "sun", tags: ["胶片", "广告", "情绪"] },
          { id: "product-post-clay-render", title: "设计渲染", subtitle: "KeyShot / Clay / 概念", description: "适合未量产产品、设计提案。", prompt: "产品设计渲染质感，类似高质量工业设计渲染，轮廓清晰，材质准确，干净背景，方案感强", visual: "slate", tags: ["渲染", "设计", "概念"] }
        ]
      }
    ]
  },
  {
    id: "commerce-visual",
    title: "商品图",
    subtitle: "淘宝 / 拼多多 / 亚马逊 / 种草",
    description: "选择热门电商平台语境、转化结构和画面密度，让用户的自定义商品提示词更接近真实电商图。",
    hero: "ui/style-library/categories/commerce-visual.png",
    accent: "coral",
    groups: [
      {
        id: "commerce-platform",
        title: "平台语境",
        subtitle: "二级菜单",
        layer: "二级",
        description: "平台风格会影响画面密度、背景、卖点表达和信任感。",
        options: [
          { id: "commerce-taobao-main", title: "淘宝主图", subtitle: "搜索列表 / 转化", description: "商品清楚，卖点明确，适合中文电商主图。", prompt: "淘宝主图风格，商品正面清晰，主体占比高，背景干净，卖点区明确，适合搜索列表快速识别", visual: "mint", tags: ["淘宝", "主图", "转化"] },
          { id: "commerce-tmall-brand", title: "天猫品牌", subtitle: "高级 / 品牌感", description: "比淘宝主图更克制，更强调品牌形象。", prompt: "天猫品牌商品图，高级商业摄影，品牌感强，背景干净有质感，促销信息克制，商品可信", visual: "gold", tags: ["天猫", "品牌", "高级"] },
          { id: "commerce-pdd-hot", title: "拼多多爆款", subtitle: "强利益点 / 抓眼", description: "高冲击、高转化，适合低价活动图。", prompt: "拼多多爆款商品图，强利益点视觉，颜色抓眼，商品大而清楚，预留价格和优惠标签区，转化导向", visual: "red", tags: ["拼多多", "爆款", "促销"] },
          { id: "commerce-amazon-listing", title: "Amazon Listing", subtitle: "白底 / 可信 / 跨境", description: "适合跨境电商主图和详情页图。", prompt: "Amazon listing style product image, clean white or light background, product accurate and centered, trustworthy e-commerce photography, no fake text", visual: "slate", tags: ["Amazon", "跨境", "白底"], negative: "avoid fake badges, random text, wrong scale" },
          { id: "commerce-xhs-seeding", title: "小红书种草", subtitle: "生活方式 / 想买", description: "适合封面、笔记图、生活场景带货。", prompt: "小红书种草商品图，生活方式场景，商品自然融入日常，画面好看、有想买感，标题区清晰", visual: "rose", tags: ["小红书", "种草", "生活"] }
        ]
      },
      {
        id: "commerce-conversion",
        title: "转化结构",
        subtitle: "三级菜单",
        layer: "三级",
        description: "决定商品图是主图、场景图、对比图还是合集图。",
        options: [
          { id: "commerce-structure-white", title: "白底主图", subtitle: "清楚 / 合规 / 直接", description: "适合搜索列表和跨境平台。", prompt: "白底商品主图，商品轮廓完整，真实阴影，主体居中，比例准确，背景无杂物", visual: "slate", tags: ["白底", "合规", "主图"] },
          { id: "commerce-structure-lifestyle", title: "场景种草", subtitle: "使用场景 / 情绪", description: "让商品被放进真实生活里。", prompt: "商品使用场景种草图，真实环境中自然摆放或使用，场景服务商品卖点，生活感强", visual: "sun", tags: ["场景", "种草", "使用"] },
          { id: "commerce-structure-compare", title: "前后对比", subtitle: "效果 / 差异 / 可信", description: "适合功能效果、清洁、护肤、工具。", prompt: "前后对比商品图，左右对照关系清楚，效果差异直观，主体一致，适合后期加入说明文字", visual: "cyan", tags: ["对比", "效果", "可信"] },
          { id: "commerce-structure-bundle", title: "套装平铺", subtitle: "多件 / 组合 / 礼盒", description: "适合套装、配件、礼盒组合。", prompt: "套装商品平铺图，多件商品有序排列，组合关系清楚，包装和配件完整，俯拍商业摄影", visual: "gold", tags: ["套装", "平铺", "组合"] },
          { id: "commerce-structure-detail", title: "细节特写", subtitle: "材质 / 工艺 / 局部", description: "适合突出做工和高客单价理由。", prompt: "商品细节特写，材质纹理、接口、边缘或工艺清楚，浅景深，焦点准确，细节说服力强", visual: "steel", tags: ["特写", "材质", "工艺"] }
        ]
      },
      {
        id: "commerce-copy-zone",
        title: "文案区域",
        subtitle: "四级菜单",
        layer: "四级",
        description: "给优惠、榜单、参数、卖点留出可读区域。",
        options: [
          { id: "commerce-copy-promo", title: "大促角标", subtitle: "促销 / 价格 / 优惠", description: "适合双十一、限时活动和爆款图。", prompt: "预留大促角标和价格信息区域，角标醒目但不遮挡商品，画面适合加入优惠券和限时文案", visual: "red", tags: ["大促", "角标", "价格"] },
          { id: "commerce-copy-benefits", title: "三卖点区", subtitle: "3 个核心利益点", description: "适合详情页首图和投放图。", prompt: "预留三个核心卖点信息块，卖点与商品一一对应，层级清楚，适合短文案和小图标", visual: "mint", tags: ["卖点", "信息块", "详情页"] },
          { id: "commerce-copy-rating", title: "榜单背书", subtitle: "Top / 评分 / 信任", description: "适合信任感和购买理由。", prompt: "预留榜单、评分或信任背书区域，视觉可信，适合加入 Top、销量、用户评价等短信息", visual: "gold", tags: ["背书", "评分", "信任"] },
          { id: "commerce-copy-spec", title: "参数说明", subtitle: "尺寸 / 容量 / 材料", description: "适合硬件、家居、工具、服饰。", prompt: "预留参数说明区域，适合展示尺寸、容量、材质、规格，画面像专业商品详情图", visual: "blue", tags: ["参数", "规格", "说明"] },
          { id: "commerce-copy-clean", title: "无字平台图", subtitle: "干净 / 可上传", description: "适合平台限制严格或后期统一排版。", prompt: "无文字商品图，干净合规，无水印、无伪 logo、无随机字符，商品清晰可直接后期排版", visual: "slate", tags: ["无字", "合规", "干净"], negative: "不要出现随机文字、平台 logo、二维码" }
        ]
      },
      {
        id: "commerce-density",
        title: "视觉密度",
        subtitle: "五级菜单",
        layer: "五级",
        description: "控制画面是高级克制还是强促销高信息量。",
        options: [
          { id: "commerce-density-premium", title: "干净高级", subtitle: "低噪 / 大留白", description: "适合品牌型商品和高客单价。", prompt: "干净高级的电商视觉，大面积留白，低噪背景，商品质感突出，信息少而准", visual: "mint", tags: ["高级", "留白", "品牌"] },
          { id: "commerce-density-hot-sale", title: "强促销", subtitle: "醒目 / 高冲击", description: "适合活动图、爆品图、低价刺激。", prompt: "强促销视觉密度，颜色醒目，利益点区域突出，商品占比大，画面冲击强但层级清楚", visual: "red", tags: ["促销", "爆品", "冲击"] },
          { id: "commerce-density-info", title: "信息密集", subtitle: "多卖点 / 多模块", description: "适合详情页和解释型商品。", prompt: "信息密集但有秩序的商品图，多模块布局，卖点、参数和场景关系清楚，阅读路径明确", visual: "blue", tags: ["信息密集", "模块", "详情页"] },
          { id: "commerce-density-crossborder", title: "跨境简洁", subtitle: "英文区 / 白净 / 信任", description: "适合 Amazon、独立站、海外投放。", prompt: "跨境电商简洁视觉，白净背景，可信摄影，英文文案区留白，商品细节真实", visual: "slate", tags: ["跨境", "简洁", "可信"] },
          { id: "commerce-density-social", title: "社媒封面", subtitle: "种草 / 生活 / 好看", description: "适合小红书、抖音和信息流封面。", prompt: "社媒封面式商品图，生活感强，第一眼好看，主体清楚，标题区醒目，适合移动端浏览", visual: "rose", tags: ["社媒", "封面", "种草"] }
        ]
      }
    ]
  },
  {
    id: "photo-style",
    title: "照片风格",
    subtitle: "景别 / 器材 / 地点 / 后期",
    description: "用真实摄影语言配置照片，而不是只写“真实照片”。适合自拍、人像、网红照、艺术照、日常照和自媒体封面。",
    hero: "ui/style-library/categories/photo-style.png",
    accent: "blue",
    groups: [
      {
        id: "photo-framing",
        title: "景别",
        subtitle: "二级菜单",
        layer: "二级",
        description: "近景、远景和特写会直接决定照片可用性。",
        options: [
          { id: "photo-closeup", title: "特写", subtitle: "脸部 / 手部 / 细节", description: "适合头像、美妆、产品细节、情绪表达。", prompt: "特写摄影，主体细节占据画面，焦点准确，背景柔和虚化，皮肤或材质细节真实", visual: "rose", tags: ["特写", "细节", "浅景深"] },
          { id: "photo-near", title: "近景", subtitle: "头肩 / 半身", description: "适合自拍、人像、社媒头像。", prompt: "近景摄影，头肩或半身构图，人物表情清楚，背景保留少量环境信息，焦点在主体", visual: "mint", tags: ["近景", "半身", "头像"] },
          { id: "photo-medium", title: "中景", subtitle: "人物 + 场景", description: "适合穿搭、生活方式、自媒体封面。", prompt: "中景摄影，主体与环境关系清楚，人物或物体完整展示关键部分，构图自然，有生活场景叙事", visual: "sun", tags: ["中景", "场景", "叙事"] },
          { id: "photo-longshot", title: "远景", subtitle: "环境 / 氛围 / 空间", description: "适合旅行、风景、城市、人文。", prompt: "远景摄影，环境占比高，主体作为视觉焦点但不拥挤，空间层次清楚，氛围感强", visual: "blue", tags: ["远景", "环境", "氛围"] },
          { id: "photo-wide", title: "全景", subtitle: "大场面 / 完整空间", description: "适合建筑、场景、海边、活动现场。", prompt: "全景摄影，完整空间或大场面，前中后景层次明确，透视稳定，画面有开阔感", visual: "ink", tags: ["全景", "大场面", "空间"] }
        ]
      },
      {
        id: "photo-device",
        title: "拍摄仪器",
        subtitle: "三级菜单",
        layer: "三级",
        description: "设备选项会写成视觉倾向，不伪造 EXIF。",
        options: [
          { id: "photo-device-iphone", title: "iPhone 自拍", subtitle: "真实 / 轻便 / 社媒", description: "适合自拍、日常照和随手拍。", prompt: "iPhone 手机摄影感，真实随手拍，轻微广角透视，自然肤色，社媒自拍质感，不过度棚拍", visual: "slate", tags: ["iPhone", "自拍", "真实"] },
          { id: "photo-device-fuji", title: "Fujifilm X100VI", subtitle: "胶片模拟 / 日常", description: "适合小红书、咖啡馆、街拍和旅行。", prompt: "Fujifilm X100VI 风格，胶片模拟色彩，日常街拍感，柔和颗粒，轻便相机视角", visual: "sun", tags: ["Fujifilm", "胶片", "日常"] },
          { id: "photo-device-leica", title: "Leica M11", subtitle: "街拍 / 微反差", description: "适合人文、街头、高级生活方式。", prompt: "Leica M11 风格摄影，微反差细腻，街拍纪实感，真实环境光，高级克制色彩", visual: "red", tags: ["Leica", "街拍", "纪实"] },
          { id: "photo-device-sony", title: "Sony A7R V", subtitle: "高解析 / 商业", description: "适合人像、产品、城市、风景。", prompt: "Sony A7R V 高解析摄影风格，细节锐利，动态范围好，现代数码质感，商业级清晰度", visual: "blue", tags: ["Sony", "高解析", "商业"] },
          { id: "photo-device-hasselblad", title: "Hasselblad X2D", subtitle: "中画幅 / 色彩深", description: "适合高级人像、商拍、风景大片。", prompt: "Hasselblad X2D 中画幅摄影质感，色彩层次丰富，宽容度高，细节扎实，高级商业摄影", visual: "gold", tags: ["Hasselblad", "中画幅", "高级"] }
        ]
      },
      {
        id: "photo-genre",
        title: "拍摄风格",
        subtitle: "四级菜单",
        layer: "四级",
        description: "这些是用户最常说但最容易写空的照片类型。",
        options: [
          { id: "photo-genre-selfie", title: "自拍", subtitle: "亲近 / 真实 / 手持", description: "适合头像、生活照、社交账号。", prompt: "真实自拍风格，手持视角，距离亲近，表情自然，轻微环境杂讯但画面干净，像真实社交照片", visual: "rose", tags: ["自拍", "手持", "真实"] },
          { id: "photo-genre-xhs", title: "小红书照片", subtitle: "清透 / 种草 / 好看", description: "适合生活方式、美妆、穿搭和探店。", prompt: "小红书风格照片，清透自然光，画面好看有种草感，主体清楚，背景生活化且干净", visual: "mint", tags: ["小红书", "清透", "种草"] },
          { id: "photo-genre-vlog", title: "自媒体封面", subtitle: "抓眼 / 人物 / 标题区", description: "适合 B 站、抖音、视频封面。", prompt: "自媒体视频封面照片，人物或主体表情动作抓眼，背景有内容线索，预留大标题区，移动端可读", visual: "coral", tags: ["自媒体", "封面", "抓眼"] },
          { id: "photo-genre-art", title: "艺术照", subtitle: "布光 / 姿态 / 情绪", description: "适合写真、海报、人像作品。", prompt: "艺术照摄影，专业布光，姿态设计感强，情绪明确，背景简洁高级，皮肤与材质真实", visual: "ink", tags: ["艺术照", "布光", "情绪"] },
          { id: "photo-genre-daily", title: "日常照", subtitle: "自然 / 不摆拍", description: "适合生活方式和真实人物照片。", prompt: "自然日常照片，非摆拍感，真实环境光，动作自然，保留生活细节，画面亲近可信", visual: "sun", tags: ["日常", "自然", "生活"] },
          { id: "photo-genre-influencer", title: "网红照", subtitle: "精致 / 打卡 / 流行", description: "适合探店、旅行、穿搭和社媒头像。", prompt: "网红打卡照片，构图精致，地点有记忆点，人物或主体状态好，色彩流行，画面适合社媒发布", visual: "violet", tags: ["网红", "打卡", "流行"] }
        ]
      },
      {
        id: "photo-location",
        title: "背景地点",
        subtitle: "五级菜单",
        layer: "五级",
        description: "地点让照片从抽象风格变成具体可生成的场景。",
        options: [
          { id: "photo-location-cafe", title: "咖啡馆窗边", subtitle: "暖光 / 桌面 / 生活", description: "适合小红书、日常照和产品种草。", prompt: "咖啡馆窗边背景，柔和自然光，桌面小物，生活方式氛围，背景干净不过度装饰", visual: "sun", tags: ["咖啡馆", "窗光", "生活"] },
          { id: "photo-location-street", title: "城市街头", subtitle: "街拍 / 建筑 / 人文", description: "适合穿搭、人文、旅行。", prompt: "城市街头背景，真实建筑和行人氛围，街拍感，主体突出，环境信息自然", visual: "slate", tags: ["街头", "城市", "街拍"] },
          { id: "photo-location-neon", title: "霓虹夜景", subtitle: "夜晚 / 反光 / 电影", description: "适合网红照、赛博、人像海报。", prompt: "霓虹夜景背景，湿润反光地面，彩色灯牌散景，暗部有层次，电影感夜景", visual: "ink", tags: ["霓虹", "夜景", "电影"] },
          { id: "photo-location-home", title: "居家窗边", subtitle: "自然 / 安静 / 真实", description: "适合日常、家居、轻写真。", prompt: "居家窗边背景，柔和室内自然光，真实家居细节，安静舒适，人物或主体自然融入", visual: "mint", tags: ["居家", "窗边", "自然"] },
          { id: "photo-location-studio", title: "专业影棚", subtitle: "布光 / 干净 / 控制", description: "适合艺术照、商业人像、产品。", prompt: "专业影棚背景，布光精确，背景纸或简洁布景，主体轮廓清楚，商业摄影质感", visual: "steel", tags: ["影棚", "布光", "商业"] }
        ]
      },
      {
        id: "photo-post",
        title: "后期风格",
        subtitle: "六级菜单",
        layer: "六级",
        description: "用轻后期语言控制照片味道。",
        options: [
          { id: "photo-post-film", title: "胶片颗粒", subtitle: "怀旧 / 柔和", description: "适合日常、街拍、旅行。", prompt: "胶片后期，轻微颗粒，柔和高光，暗部不过黑，色彩有真实胶片味道", visual: "sun", tags: ["胶片", "颗粒", "怀旧"] },
          { id: "photo-post-blur", title: "模糊抓拍", subtitle: "动态 / 氛围 / 真实", description: "适合街拍、派对、运动感。", prompt: "轻微动态模糊抓拍感，主体仍可识别，背景有运动轨迹，照片真实有现场感", visual: "red", tags: ["模糊", "抓拍", "动态"] },
          { id: "photo-post-clean-skin", title: "清透肤色", subtitle: "自然 / 干净 / 不假", description: "适合人像、自拍、艺术照。", prompt: "清透自然肤色后期，皮肤质感保留，亮部干净，颜色通透，不过度磨皮", visual: "rose", tags: ["肤色", "清透", "自然"] },
          { id: "photo-post-bw", title: "高级黑白", subtitle: "对比 / 情绪 / 经典", description: "适合肖像、街拍、艺术图。", prompt: "高级黑白摄影后期，灰阶层次丰富，面部或主体对比清楚，情绪克制，经典摄影感", visual: "ink", tags: ["黑白", "高级", "情绪"] },
          { id: "photo-post-pastel", title: "日系淡彩", subtitle: "低饱和 / 清新", description: "适合旅行、生活、小红书。", prompt: "日系淡彩后期，低饱和，天空和肤色柔和，画面清新轻盈，亮部不过曝", visual: "cyan", tags: ["日系", "淡彩", "清新"] }
        ]
      }
    ]
  },
  {
    id: "anime-style",
    title: "二次元",
    subtitle: "基本风格 / 景别 / 角色 / 氛围",
    description: "从二次元卡片进入后，按画风、景别、绘画语言、角色细节和后期氛围逐层配置，适合角色图、头像、封面和场景插画。",
    hero: "ui/style-library/categories/anime-style.png",
    accent: "violet",
    groups: [
      {
        id: "anime-base",
        title: "基本风格",
        subtitle: "二级菜单",
        layer: "二级",
        description: "先决定二次元底层画风。",
        options: [
          { id: "anime-base-cel", title: "日系赛璐璐", subtitle: "干净线条 / 明确阴影", description: "适合立绘、头像和轻动画感画面。", prompt: "日系赛璐璐二次元画风，干净线条，明确阴影块，角色轮廓清晰，眼睛高光精致", visual: "cyan", tags: ["赛璐璐", "日系", "立绘"] },
          { id: "anime-base-painterly", title: "WLOP 光感替代", subtitle: "电影级光影 / 精修", description: "适合高完成度封面和角色卡，用可执行语言替代直接画师名。", prompt: "高精度奇幻厚涂二次元插画，电影级光影，面部和服装精修，材质层次丰富，氛围高级", visual: "violet", tags: ["厚涂", "高精度", "电影光影"] },
          { id: "anime-base-otome", title: "乙女游戏", subtitle: "柔光 / 华丽 / 浪漫", description: "适合女性向角色和恋爱感封面。", prompt: "乙女游戏角色插画，柔和梦幻光，精致面部，华丽服装，浪漫氛围，构图优雅", visual: "rose", tags: ["乙女", "浪漫", "华丽"] },
          { id: "anime-base-ln", title: "轻小说封面", subtitle: "标题区 / 青春 / 冒险", description: "适合主角、同伴和故事封面。", prompt: "轻小说封面风格，角色组合醒目，标题区域留白，青春冒险感，背景与人物关系清楚", visual: "blue", tags: ["轻小说", "封面", "青春"] },
          { id: "anime-base-2d5", title: "2.5D 渲染", subtitle: "立体 / 游戏 / 质感", description: "适合游戏角色、潮玩感头像和虚拟人。", prompt: "2.5D 二次元角色渲染，立体体积感，材质柔和，面部精致，游戏宣传图质感", visual: "steel", tags: ["2.5D", "游戏", "渲染"] }
        ]
      },
      {
        id: "anime-shot",
        title: "景别镜头",
        subtitle: "三级菜单",
        layer: "三级",
        description: "近景、远景和中景会决定角色还是世界观占主导。",
        options: [
          { id: "anime-shot-close", title: "头像特写", subtitle: "脸部 / 眼睛 / 发丝", description: "适合头像和表情展示。", prompt: "二次元头像特写，面部居中，眼睛高光精致，发丝清楚，背景简洁，识别度高", visual: "rose", tags: ["特写", "头像", "眼睛"] },
          { id: "anime-shot-near", title: "近景半身", subtitle: "头肩到腰部", description: "适合角色介绍和社媒头像延展。", prompt: "近景半身角色构图，头肩到腰部清楚，表情明确，上半身服装细节丰富，背景不抢主体", visual: "mint", tags: ["近景", "半身", "角色"] },
          { id: "anime-shot-medium", title: "中景全身", subtitle: "服装 / 姿态 / 比例", description: "适合设定图和角色展示。", prompt: "中景全身角色图，人体比例准确，姿态自然，服装全貌清楚，配饰细节完整", visual: "slate", tags: ["中景", "全身", "设定"] },
          { id: "anime-shot-wide", title: "远景场景", subtitle: "角色 + 世界", description: "适合封面和世界观场景。", prompt: "远景二次元场景，角色与环境关系清楚，空间层次丰富，世界观氛围强，主体仍可识别", visual: "blue", tags: ["远景", "场景", "世界观"] },
          { id: "anime-shot-action", title: "动态战斗", subtitle: "速度线 / 特效 / 姿态", description: "适合热血封面和游戏宣传。", prompt: "二次元动态战斗构图，动作姿态夸张但合理，速度线和技能特效清楚，角色轮廓不糊", visual: "red", tags: ["动态", "战斗", "特效"] }
        ]
      },
      {
        id: "anime-render",
        title: "绘画风格",
        subtitle: "四级菜单",
        layer: "四级",
        description: "把“热门风格”转成更稳的模型语言。",
        options: [
          { id: "anime-render-real", title: "写实动漫", subtitle: "真实光影 / 动漫脸", description: "适合高级头像和角色封面。", prompt: "写实动漫风格，动漫角色面部美型，真实光影和材质，背景有摄影级空间感，细节精修", visual: "steel", tags: ["写实", "动漫", "真实光影"] },
          { id: "anime-render-fantasy", title: "奇幻厚涂", subtitle: "高精度 / 魔法 / 华丽", description: "替代画师名指令，写成可执行风格描述。", prompt: "高精度奇幻厚涂，华丽服装与发丝细节，魔法光效，电影级明暗，画面完成度高", visual: "violet", tags: ["奇幻", "厚涂", "高完成度"] },
          { id: "anime-render-flat", title: "清爽平涂", subtitle: "干净 / 明亮 / 轻插画", description: "适合头像、轻小说和可爱角色。", prompt: "清爽平涂二次元插画，线条干净，色块明亮，阴影简洁，画面轻盈，适合头像和封面", visual: "cyan", tags: ["平涂", "清爽", "轻插画"] },
          { id: "anime-render-gacha", title: "手游卡面", subtitle: "稀有度 / 光效 / 构图", description: "适合游戏角色卡和宣传图。", prompt: "手游角色卡面风格，角色稀有度感强，特效围绕主体，构图华丽，服装与武器细节丰富", visual: "gold", tags: ["手游", "卡面", "光效"] },
          { id: "anime-render-retro", title: "复古动画", subtitle: "胶片 / 90s / 怀旧", description: "适合怀旧头像和复古封面。", prompt: "复古动画风格，90 年代动画色彩，轻微胶片颗粒，线条柔和，怀旧氛围", visual: "sun", tags: ["复古", "动画", "胶片"] }
        ]
      },
      {
        id: "anime-character",
        title: "角色细节",
        subtitle: "五级菜单",
        layer: "五级",
        description: "给发色、服装和身份一个强记忆点。",
        options: [
          { id: "anime-char-black-hair", title: "黑长直 + 制服", subtitle: "经典 / 校园 / 清冷", description: "适合校园和青春角色。", prompt: "黑色长直发角色，发丝顺滑，制服细节清楚，气质清冷，眼神有记忆点", visual: "ink", tags: ["黑长直", "制服", "校园"] },
          { id: "anime-char-silver-tech", title: "银短发 + 机能服", subtitle: "科幻 / 未来 / 冷感", description: "适合赛博和科幻角色。", prompt: "银白短发角色，机能服多层结构，冷色高光，未来科技感，轮廓锐利", visual: "steel", tags: ["银发", "机能服", "科幻"] },
          { id: "anime-char-pink-idol", title: "粉金发 + 偶像装", subtitle: "甜美 / 舞台 / 流行", description: "适合偶像、头像和梦幻封面。", prompt: "粉金渐变发色，偶像舞台服装，蝴蝶结与亮片细节，甜美梦幻，表情有感染力", visual: "rose", tags: ["粉金", "偶像", "梦幻"] },
          { id: "anime-char-hanfu", title: "国风汉服", subtitle: "刺绣 / 飘带 / 东方", description: "适合古风、仙侠和国潮图。", prompt: "国风汉服角色，刺绣纹样清晰，飘带自然，东方幻想气质，布料层次流动", visual: "gold", tags: ["汉服", "国风", "刺绣"] },
          { id: "anime-char-lolita", title: "洛丽塔礼服", subtitle: "蕾丝 / 华丽 / 乙女", description: "适合乙女和精致头像。", prompt: "洛丽塔礼服角色，蕾丝、蝴蝶结和裙摆层次丰富，华丽甜美，材质细节清楚", visual: "violet", tags: ["洛丽塔", "蕾丝", "华丽"] }
        ]
      },
      {
        id: "anime-mood",
        title: "后期氛围",
        subtitle: "六级菜单",
        layer: "六级",
        description: "给最终画面加环境光和情绪。",
        options: [
          { id: "anime-mood-campus", title: "樱花校园", subtitle: "晨光 / 青春", description: "适合校园和日常。", prompt: "樱花校园氛围，清晨柔光，粉白花瓣，青春日常感，背景明亮干净", visual: "mint", tags: ["校园", "樱花", "青春"] },
          { id: "anime-mood-cyber", title: "赛博霓虹", subtitle: "夜景 / 反光 / 科技", description: "适合科幻和潮流角色。", prompt: "赛博霓虹后期，夜景彩色灯光，反光街面，冷暖对比，未来都市氛围", visual: "ink", tags: ["赛博", "霓虹", "夜景"] },
          { id: "anime-mood-magic", title: "魔法光粒", subtitle: "符文 / 光效 / 幻想", description: "适合奇幻角色和法师。", prompt: "魔法光粒后期，发光符文，漂浮粒子，柔和体积光，奇幻空间深度", visual: "violet", tags: ["魔法", "光粒", "幻想"] },
          { id: "anime-mood-healing", title: "治愈暖光", subtitle: "室内 / 植物 / 安静", description: "适合温柔头像和日常封面。", prompt: "治愈暖光氛围，室内植物和小物点缀，柔和光线，角色表情温柔，画面安静", visual: "sun", tags: ["治愈", "暖光", "日常"] },
          { id: "anime-mood-rain", title: "雨夜反光", subtitle: "情绪 / 街灯 / 电影", description: "适合故事感封面。", prompt: "雨夜二次元氛围，街灯反光，湿润地面，角色情绪突出，电影感色彩", visual: "blue", tags: ["雨夜", "反光", "故事"] }
        ]
      }
    ]
  },
  {
    id: "poster-campaign",
    title: "海报宣传",
    subtitle: "KV / 展览 / 活动 / 招募",
    description: "为海报和宣传图配置类型、构图、字体区、色彩和后期，让模型生成更接近可排版的素材。",
    hero: "ui/style-library/categories/poster-campaign.png",
    accent: "gold",
    groups: [
      {
        id: "poster-kind",
        title: "海报类型",
        subtitle: "二级菜单",
        layer: "二级",
        description: "先确定海报的传播场景。",
        options: [
          { id: "poster-kind-kv", title: "品牌 KV", subtitle: "主视觉 / 延展", description: "适合品牌活动、官网和线下物料。", prompt: "品牌关键视觉 KV，核心视觉记忆点明确，适合多尺寸延展，主体和标题区关系清楚", visual: "gold", tags: ["KV", "品牌", "延展"] },
          { id: "poster-kind-film", title: "电影海报", subtitle: "主角 / 戏剧 / 片名区", description: "适合故事、人像、视觉概念。", prompt: "电影海报视觉，主角或核心物体强烈突出，戏剧化光影，片名区域留白，大片氛围", visual: "ink", tags: ["电影", "主角", "戏剧"] },
          { id: "poster-kind-exhibition", title: "展览海报", subtitle: "艺术 / 网格 / 留白", description: "适合展览、摄影、艺术活动。", prompt: "展览海报视觉，网格秩序清楚，留白高级，作品或主题成为焦点，适合加入展讯文字", visual: "sage", tags: ["展览", "网格", "留白"] },
          { id: "poster-kind-music", title: "音乐节", subtitle: "舞台 / 节奏 / 热烈", description: "适合演出、活动、派对。", prompt: "音乐节海报视觉，舞台灯光，节奏感强，现场氛围热烈，预留阵容与时间信息区域", visual: "violet", tags: ["音乐", "舞台", "节奏"] },
          { id: "poster-kind-recruit", title: "招募招生", subtitle: "行动 / 明确 / 可信", description: "适合招聘、课程、社群招募。", prompt: "招募海报视觉，行动感强，人物或场景积极，标题和报名信息区域明确，可信且清楚", visual: "blue", tags: ["招募", "招生", "行动"] }
        ]
      },
      {
        id: "poster-composition-new",
        title: "构图结构",
        subtitle: "三级菜单",
        layer: "三级",
        description: "控制主体、留白和文字区。",
        options: [
          { id: "poster-comp-center", title: "中心主视觉", subtitle: "强识别 / 稳", description: "最通用的海报构图。", prompt: "中心主视觉构图，主体在画面核心位置，标题区和辅助信息区清楚，视觉稳定", visual: "gold", tags: ["中心", "主视觉", "稳定"] },
          { id: "poster-comp-top-title", title: "上方大标题", subtitle: "标题先行", description: "适合竖版海报和展览。", prompt: "上方保留大标题区域，下方主体或场景展开，边距统一，适合竖版海报排版", visual: "sage", tags: ["标题", "竖版", "边距"] },
          { id: "poster-comp-split", title: "左右分栏", subtitle: "图文分区", description: "适合横版和信息型海报。", prompt: "左右分栏海报构图，一侧主体，一侧文字信息区，网格清楚，适合广告和活动说明", visual: "mint", tags: ["分栏", "图文", "网格"] },
          { id: "poster-comp-collage", title: "拼贴网格", subtitle: "多元素 / 层次", description: "适合作品集、活动回顾和潮流海报。", prompt: "拼贴网格海报，多元素层次清楚，纸张叠放或图像组合有秩序，适合内容集合", visual: "rose", tags: ["拼贴", "网格", "集合"] },
          { id: "poster-comp-cinema-wide", title: "电影宽屏", subtitle: "横幅 / 大场景", description: "适合横版 KV 和封面。", prompt: "电影宽屏海报构图，横向空间开阔，大场景层次丰富，主体位置精确，适合横版标题", visual: "ink", tags: ["宽屏", "横版", "大场景"] }
        ]
      },
      {
        id: "poster-type-style",
        title: "字体排版区",
        subtitle: "四级菜单",
        layer: "四级",
        description: "重点是预留字区和字体性格，不要求模型生成准确文字。",
        options: [
          { id: "poster-type-big-bold", title: "大字报", subtitle: "粗体 / 冲击", description: "适合活动、促销、年轻传播。", prompt: "预留大字报式粗体标题区，标题区域占比高，背景对比稳定，适合加入强冲击短标题", visual: "red", tags: ["大字", "粗体", "冲击"] },
          { id: "poster-type-editorial", title: "杂志排版", subtitle: "标题 / 副文 / 边距", description: "适合品牌、展览、文化内容。", prompt: "杂志式排版空间，标题、副标题、说明文字区域层级明确，边距统一，高级编辑感", visual: "slate", tags: ["杂志", "边距", "层级"] },
          { id: "poster-type-minimal", title: "极简小字", subtitle: "留白 / 克制", description: "适合艺术、品牌和高级活动。", prompt: "极简小字排版区，大面积留白，文字区域克制，视觉焦点明确，适合高级海报", visual: "mint", tags: ["极简", "小字", "留白"] },
          { id: "poster-type-tech-ui", title: "科技 UI", subtitle: "数据 / HUD / 参数", description: "适合科技、科幻、发布会。", prompt: "科技 UI 式文字信息区，适合数据、参数和界面元素，线条细腻，层级清楚，不遮挡主体", visual: "blue", tags: ["科技", "UI", "参数"] },
          { id: "poster-type-calligraphy", title: "东方字区", subtitle: "竖排 / 印章 / 国风", description: "适合国潮、茶饮、文化活动。", prompt: "东方海报文字区，适合竖排标题、印章和短句，留白讲究，国风气质克制高级", visual: "gold", tags: ["国风", "竖排", "印章"] }
        ]
      },
      {
        id: "poster-color-new",
        title: "色彩风格",
        subtitle: "五级菜单",
        layer: "五级",
        description: "快速确定海报主情绪。",
        options: [
          { id: "poster-color-black-gold", title: "黑金", subtitle: "高级 / 奢华", description: "适合发布会、礼盒、晚宴和高端服务。", prompt: "黑金色彩系统，深色背景，金色高光，高级奢华，低噪，主体边缘清楚", visual: "gold", tags: ["黑金", "奢华", "高级"] },
          { id: "poster-color-red-blue", title: "红蓝撞色", subtitle: "冲突 / 视觉强", description: "适合潮流、音乐、运动。", prompt: "红蓝撞色海报，强视觉冲突，主体轮廓清晰，动态构图，层级不乱", visual: "red", tags: ["撞色", "红蓝", "动感"] },
          { id: "poster-color-muted", title: "低饱和", subtitle: "安静 / 编辑感", description: "适合艺术、文化、生活方式。", prompt: "低饱和色彩系统，柔和灰调，高级编辑感，适合文字排版，画面安静", visual: "slate", tags: ["低饱和", "编辑", "安静"] },
          { id: "poster-color-pop", title: "波普鲜色", subtitle: "年轻 / 趣味", description: "适合社媒、活动和年轻消费品。", prompt: "波普鲜艳色彩，图形块面清楚，年轻趣味，主体醒目，适合社媒传播", visual: "coral", tags: ["波普", "鲜色", "趣味"] },
          { id: "poster-color-oriental", title: "东方淡彩", subtitle: "米白 / 墨色 / 朱砂", description: "适合文化、国潮、茶饮和展览。", prompt: "东方淡彩系统，米白、墨色、朱砂点缀，留白高级，材质像宣纸或细腻纸张", visual: "sage", tags: ["东方", "淡彩", "朱砂"] }
        ]
      }
    ]
  },
  {
    id: "painting-style",
    title: "绘画插画",
    subtitle: "媒介 / 构图 / 笔触 / 输出",
    description: "为绘画和插画选择媒介、笔触、主题和输出用途，适合封面、包装、概念图和儿童绘本。",
    hero: "ui/style-library/categories/painting-style.png",
    accent: "sage",
    groups: [
      {
        id: "painting-medium-new",
        title: "绘画媒介",
        subtitle: "二级菜单",
        layer: "二级",
        description: "媒介决定纹理、边缘和色彩。",
        options: [
          { id: "paint-medium-oil", title: "油画", subtitle: "厚重 / 画布 / 收藏感", description: "适合肖像、风景和史诗主题。", prompt: "油画媒介，细腻画布纹理，颜料层次丰富，光影扎实，艺术收藏感", visual: "gold", tags: ["油画", "画布", "厚重"] },
          { id: "paint-medium-watercolor", title: "水彩", subtitle: "透明 / 晕染 / 纸纹", description: "适合植物、旅行、温柔插画。", prompt: "透明水彩媒介，柔和晕染，纸张纹理清晰，边缘自然渗化，清新轻盈", visual: "cyan", tags: ["水彩", "纸纹", "晕染"] },
          { id: "paint-medium-ink", title: "水墨", subtitle: "墨韵 / 留白 / 东方", description: "适合山水、花鸟、国风意境。", prompt: "水墨国画风格，墨色层次，留白讲究，笔触轻重变化，东方意境", visual: "ink", tags: ["水墨", "留白", "东方"] },
          { id: "paint-medium-pencil", title: "铅笔素描", subtitle: "线条 / 明暗 / 草图", description: "适合概念草图和结构表达。", prompt: "铅笔素描，线条清晰，明暗关系准确，纸面质感，结构明确，草图但精致", visual: "slate", tags: ["素描", "线条", "结构"] },
          { id: "paint-medium-vector", title: "矢量插画感", subtitle: "平面 / 品牌 / 清楚", description: "不是输出矢量文件，而是生成矢量风格画面。", prompt: "矢量插画风格，清晰块面，边缘干净，色彩统一，适合品牌视觉和信息插画", visual: "coral", tags: ["矢量感", "品牌", "平面"] }
        ]
      },
      {
        id: "painting-subject-new",
        title: "主题构图",
        subtitle: "三级菜单",
        layer: "三级",
        description: "从常见插画用途选择画面骨架。",
        options: [
          { id: "paint-subject-portrait", title: "人物肖像", subtitle: "脸部 / 眼神 / 气质", description: "适合封面、头像和人物设定。", prompt: "人物肖像插画，面部结构准确，眼神有叙事，发丝和服装细节丰富，背景简洁", visual: "rose", tags: ["人物", "肖像", "眼神"] },
          { id: "paint-subject-botanical", title: "植物自然", subtitle: "花草 / 标本 / 清新", description: "适合包装、家居画和自然主题。", prompt: "植物自然插画，花草细节丰富，标本式构图，柔和色彩，清新安静", visual: "mint", tags: ["植物", "自然", "标本"] },
          { id: "paint-subject-city", title: "城市建筑", subtitle: "街区 / 立面 / 生活", description: "适合旅行海报和空间插画。", prompt: "城市建筑插画，街区层次，建筑立面清楚，生活细节点缀，空间深度明确", visual: "blue", tags: ["城市", "建筑", "空间"] },
          { id: "paint-subject-fantasy", title: "奇幻大场景", subtitle: "世界观 / 史诗", description: "适合概念图、书封和游戏美术。", prompt: "奇幻大场景插画，宏大空间，前中后景层次，魔法或幻想元素，史诗氛围", visual: "violet", tags: ["奇幻", "大场景", "史诗"] },
          { id: "paint-subject-food", title: "食品包装", subtitle: "食材 / 可爱 / 商品", description: "适合食品包装和品牌插画。", prompt: "食品包装插画，食材清楚好看，画面有食欲，图形化构图，适合包装正面视觉", visual: "sun", tags: ["食品", "包装", "食欲"] }
        ]
      },
      {
        id: "painting-brush-new",
        title: "笔触线条",
        subtitle: "四级菜单",
        layer: "四级",
        description: "控制画面是精细、厚涂还是图形化。",
        options: [
          { id: "paint-brush-impasto", title: "厚涂笔触", subtitle: "堆叠 / 强光影", description: "适合奇幻、肖像和高完成度画面。", prompt: "厚涂笔触，颜料堆叠感，强光影塑造，边缘有手绘变化，画面有重量", visual: "rose", tags: ["厚涂", "笔触", "光影"] },
          { id: "paint-brush-lineart", title: "精细线稿", subtitle: "轮廓 / 结构 / 设定", description: "适合角色设定和产品概念。", prompt: "精细线稿，轮廓干净，线条粗细有变化，结构清楚，适合设定图和后续上色", visual: "slate", tags: ["线稿", "结构", "设定"] },
          { id: "paint-brush-flat", title: "平涂色块", subtitle: "现代 / 简洁", description: "适合品牌插画和海报。", prompt: "平涂色块插画，边缘干净，图形化构成，色彩明快，现代插画感", visual: "coral", tags: ["平涂", "色块", "现代"] },
          { id: "paint-brush-grain", title: "颗粒纸纹", subtitle: "复古 / 印刷", description: "适合书封、海报、包装。", prompt: "颗粒纸纹插画，轻微复古印刷质感，色彩柔和，边缘自然，画面有温度", visual: "sage", tags: ["颗粒", "纸纹", "复古"] },
          { id: "paint-brush-clean", title: "干净无描边", subtitle: "高级 / 插画感", description: "适合运营图和高端品牌插画。", prompt: "干净无描边插画，形状边缘柔和，色彩层次克制，现代高级，适合品牌视觉", visual: "mint", tags: ["无描边", "高级", "品牌"] }
        ]
      },
      {
        id: "painting-output",
        title: "输出用途",
        subtitle: "五级菜单",
        layer: "五级",
        description: "让模型知道这张插画最终用在哪里。",
        options: [
          { id: "paint-output-book", title: "书籍封面", subtitle: "标题区 / 叙事", description: "适合小说、绘本和杂志。", prompt: "书籍封面插画，标题区留白清楚，主体有叙事，画面适合竖版封面排版", visual: "ink", tags: ["书封", "标题区", "叙事"] },
          { id: "paint-output-packaging", title: "包装插画", subtitle: "正面 / 识别 / 商品", description: "适合食品、美妆、礼盒。", prompt: "包装正面插画，主体识别强，边缘干净，适合印刷和商品货架展示", visual: "gold", tags: ["包装", "印刷", "货架"] },
          { id: "paint-output-childbook", title: "儿童绘本", subtitle: "温暖 / 可读 / 安全", description: "适合儿童故事和教育插图。", prompt: "儿童绘本插画，温暖友好，角色表情清楚，画面可读性强，色彩柔和", visual: "sun", tags: ["绘本", "儿童", "温暖"] },
          { id: "paint-output-game", title: "游戏概念", subtitle: "世界观 / 设定", description: "适合概念设计和场景方案。", prompt: "游戏概念插画，世界观明确，设计细节丰富，主体和环境关系清楚，适合美术设定", visual: "violet", tags: ["游戏", "概念", "设定"] },
          { id: "paint-output-editorial", title: "杂志配图", subtitle: "主题 / 留白 / 编辑感", description: "适合文章、专栏、品牌内容。", prompt: "杂志配图插画，主题明确，留白舒适，画面有编辑感，适合搭配标题和正文", visual: "slate", tags: ["杂志", "配图", "编辑"] }
        ]
      }
    ]
  }
];

const STYLE_LIBRARY_BLOCK_START = "【风格库】";
const STYLE_LIBRARY_BLOCK_END = "【/风格库】";

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function styleSelectionsFromIds(optionIds: string[]): PromptStyleSelection[] {
  const idSet = new Set(optionIds);
  const selections: PromptStyleSelection[] = [];
  for (const category of PROMPT_STYLE_LIBRARY) {
    for (const group of category.groups) {
      for (const option of group.options) {
        if (idSet.has(option.id)) selections.push({ category, group, option });
      }
    }
  }
  return selections;
}

export function compositeStyleOptionIdsFromPrompt(prompt: string) {
  const text = String(prompt || "");
  if (!text.trim()) return [];
  const blockMatch = text.match(new RegExp(`${STYLE_LIBRARY_BLOCK_START}[\\s\\S]*?${STYLE_LIBRARY_BLOCK_END}`));
  const source = blockMatch?.[0] || text;
  const ids: string[] = [];
  for (const category of PROMPT_STYLE_LIBRARY) {
    for (const group of category.groups) {
      for (const option of group.options) {
        const legacyPath = `${category.title} / ${group.layer ? `${group.layer} ` : ""}${group.title} / ${option.title}`;
        const compactPath = `${category.title} / ${group.title} / ${option.title}`;
        if (source.includes(legacyPath) || source.includes(compactPath)) ids.push(option.id);
      }
    }
  }
  return uniqueText(ids);
}

export function composeStylePrompt(optionIds: string[]) {
  const selections = styleSelectionsFromIds(optionIds);
  if (!selections.length) return "";
  const categories = uniqueText(selections.map((item) => item.category.title));
  const keywords = uniqueText(selections.flatMap((item) => item.option.tags)).slice(0, 20);
  const paths = selections.map((item) => `- ${item.category.title} / ${item.group.layer ? `${item.group.layer} ` : ""}${item.group.title} / ${item.option.title}：${item.option.description}`);
  const promptLines = uniqueText(selections.map((item) => item.option.prompt)).map((prompt) => `- 可适度参考：${prompt}`);
  const negatives = uniqueText(selections.map((item) => item.option.negative ?? "")).map((prompt) => `- 尽量减少：${prompt}`);
  return [
    STYLE_LIBRARY_BLOCK_START,
    `应用方向：${categories.join("、")}`,
    keywords.length ? `风格关键词：${keywords.join("、")}` : "",
    "使用方式：以下内容是风格靠拢参考，不是硬性模板；请保留用户原始主体、用途、构图和明确要求，只把这些选择作为画面气质、镜头语言、排版或后期方向的倾向。",
    "选择路径：",
    ...paths,
    "靠拢建议：",
    ...promptLines,
    negatives.length ? "可弱化的偏离项：" : "",
    ...negatives,
    "基础质量倾向：优先保持主体明确、构图完整、材质可信和光影一致；如无明确文字需求，只预留干净排版空间；尽量减少水印、伪 logo、明显畸变、低清晰度和杂乱背景。若与用户输入冲突，以用户输入为准。",
    STYLE_LIBRARY_BLOCK_END
  ]
    .filter(Boolean)
    .join("\n");
}

export function mergeStylePrompt(existing: string, styleBlock: string) {
  const withoutOldStyle = String(existing || "")
    .replace(new RegExp(`\\n*${STYLE_LIBRARY_BLOCK_START}[\\s\\S]*?${STYLE_LIBRARY_BLOCK_END}`, "g"), "")
    .trim();
  return [withoutOldStyle, styleBlock.trim()].filter(Boolean).join("\n\n");
}
