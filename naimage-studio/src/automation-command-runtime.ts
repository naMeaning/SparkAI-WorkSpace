import {
  AUTOMATION_COMMAND_DEFINITIONS,
  AUTOMATION_COMMAND_ENUMS,
  type AutomationRendererCommandName,
} from "./automation-command-registry.ts";
import { automationCommandError } from "./automation-command-errors.ts";
import type {
  AgentSteerTaskScopeMode,
  AgentSteerTaskScopeUpdate,
  AssetTaskRole,
  CanvasRequirementInputBinding,
  CanvasSkill,
  ImageAssetExportResult,
  ImageExportFormat,
  ImageFrameRatio,
  ImageResolutionPreset,
  ImportedCanvasSkill,
  ScientificDataImportResult,
  ScientificDataSource,
  ScientificFigurePlan,
  ScientificTask,
  SocialContentPlan,
  SocialPlatform,
  WorkspaceDomain,
  WorkflowNode,
} from "./core";
import {
  DEFAULT_WORKSPACE_DOMAIN,
  normalizeWorkspaceDomain,
  publicWorkspaceDomainDefinition,
  workspaceDomainDefinitions,
} from "./workspace-domain.ts";
import { imageContainerSpecForNode } from "./image-container-spec.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";
import { flattenImageContainerBindings } from "./image-container-graph.ts";
import { commerceSetRequestCounts, normalizeCommerceSetPlan, type CommerceSetPlan } from "./plugins/commerce-set.ts";
import {
  normalizeDouyinPlan,
  normalizeSocialContentPlan,
  normalizeXiaohongshuPlan,
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_XIAOHONGSHU_COMMAND,
  socialContentWritebackIssues,
} from "./plugins/social-content.ts";
import {
  normalizeScientificFigurePlan,
  SCIENTIFIC_FIGURE_START_COMMAND,
  scientificFigurePlanIssues,
} from "./plugins/scientific-figure.ts";
import { requirementInputBindings } from "./requirement-graph.ts";
import { stableRequirementInputSignature } from "./requirement-signature.ts";
import type {
  CommerceCatalogAssetKind,
  CommerceCatalogAssetOwnerType,
  CommerceCatalogProductDraft,
  CommerceCatalogResult,
  CommerceCatalogResultState
} from "./commerce-catalog.ts";
import type { CommerceExportFormat, CommerceExportRequest } from "./commerce-export.ts";

type JsonObject = Record<string, unknown>;
type JsonSchema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  required?: readonly string[];
  additionalProperties?: boolean;
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
  enum?: readonly unknown[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
type AutomationCommandDefinition = { parameters?: JsonSchema; destructive?: boolean };
const automationCommandDefinitions = AUTOMATION_COMMAND_DEFINITIONS as unknown as Readonly<Record<string, AutomationCommandDefinition>>;
const imageExportFormats = new Set<string>(AUTOMATION_COMMAND_ENUMS["canvas.export-image"].format);
const steerTaskScopeModes = new Set<string>(AUTOMATION_COMMAND_ENUMS["agent.steer"].taskScopeMode);
const steerSourceModes = new Set<string>(AUTOMATION_COMMAND_ENUMS["agent.steer"].sourceMode);
const steerReferenceModes = new Set<string>(AUTOMATION_COMMAND_ENUMS["agent.steer"].referenceMode);
const agentImageRatios = new Set<string>(AUTOMATION_COMMAND_ENUMS["agent.chat"].ratio);
const agentImageResolutions = new Set<string>(AUTOMATION_COMMAND_ENUMS["agent.chat"].resolution);
type AutomationGoalScopeOptions = {
  sourceNodeIds: string[];
  operationsPerAsset: number;
  ratio?: ImageFrameRatio;
  resolution?: ImageResolutionPreset;
};
type Project = { id: string; name: string; updatedAt?: string };
type MessageSummarySource = {
  id: string;
  role: string;
  content: string;
  status?: string;
  createdAt: string;
  hidden?: boolean;
};

function promptWithImageOutputSpec(prompt: string, value: Record<string, unknown>) {
  const ratio = String(value.ratio || "").trim().replace("：", ":");
  const resolution = String(value.resolution || "").trim().toUpperCase();
  const specifications = [
    agentImageRatios.has(ratio) ? `画面比例 ${ratio}` : "",
    agentImageResolutions.has(resolution) ? `清晰度 ${resolution}` : ""
  ].filter(Boolean);
  if (!specifications.length) return prompt;
  return `${prompt}\n\n[图片输出规格] ${specifications.join("；")}。生成图片时必须将这些规格传给 image_gen；清晰度与 quality 质量档位是不同参数。`;
}

function imageOutputDefaults(value: Record<string, unknown>) {
  const ratio = String(value.ratio || "").trim().replace("：", ":");
  const resolution = String(value.resolution || "").trim().toUpperCase();
  return {
    ...(agentImageRatios.has(ratio) ? { ratio: ratio as ImageFrameRatio } : {}),
    ...(agentImageResolutions.has(resolution) ? { resolution: resolution as ImageResolutionPreset } : {})
  };
}

export type AutomationCommandContext = {
  activeProjectId(): string;
  workspaceDomain(): WorkspaceDomain;
  setWorkspaceDomain(domain: WorkspaceDomain): boolean | void;
  activeConversationId(): string;
  agentStatus(): string;
  activeRunId(): string;
  agentPaused(): boolean;
  viewport(): JsonObject;
  selection(): { primaryId: string; ids: string[] };
  canvasRevision(): number;
  lockedNodeIds(): string[];
  mutationLocks(nodeIds: string[]): string[];
  projects(): Project[];
  nodes(): WorkflowNode[];
  layoutGroups(): ImageLayoutGroup[];
  messages(): MessageSummarySource[];
  switchProject(id: string): Promise<unknown>;
  createProject(name: string, workspaceDomain?: WorkspaceDomain): Promise<unknown>;
  renameProject(name: string): Promise<unknown>;
  selectNodes(ids: string[], primaryId: string): void;
  fitCanvas(): void;
  removeFailedNodes(ids: string[]): void;
  clearCanvas(): Promise<unknown>;
  deleteSelectedNodes(): boolean;
  createContainer(role: "source" | "reference" | undefined, x: number, y: number): string;
  importPaths(paths: string[], targetContainerId: string, x: number, y: number): Promise<unknown>;
  importVideoPaths(paths: string[], x: number, y: number): Promise<unknown>;
  generateVideo(input: {
    expectedProjectId: string;
    prompt: string;
    model?: string;
    seconds: number;
    aspectRatio: string;
    resolution: string;
    x: number;
    y: number;
  }): Promise<unknown>;
  exportImage(nodeId: string, assetIndex: number, format: ImageExportFormat): Promise<ImageAssetExportResult>;
  parseSkill(markdown: unknown, sourceName?: unknown): Promise<ImportedCanvasSkill>;
  createSkillNode(skill: ImportedCanvasSkill, x: number, y: number): {
    id: string;
    created: boolean;
    skill: CanvasSkill;
    exact?: boolean;
    conflict?: "locally-modified";
  };
  connectCanvas(input: {
    edges: Array<{ sourceId: string; targetId: string; relationType?: WorkflowNode["relationType"]; inputRole?: AssetTaskRole }>;
    replaceExisting: boolean;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  disconnectCanvas(input: {
    edges: Array<{ sourceId: string; targetId: string }>;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  groupCanvas(input: {
    nodeIds: string[];
    primaryId?: string;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  dissolveCanvas(input: {
    containerIds: string[];
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  nudgeCanvas(input: {
    nodeIds: string[];
    dx: number;
    dy: number;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  createRequirement(input: {
    title?: string;
    text: string;
    inputBindings: CanvasRequirementInputBinding[];
    x?: number;
    y?: number;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
    socialPlan?: SocialContentPlan;
    scientificPlan?: ScientificFigurePlan;
  }): unknown;
  createCommerceReusableNode?(input: {
    title: string;
    text: string;
    sourceNodeIds: string[];
    kind: "requirement" | "skill";
  }): WorkflowNode | null;
  updateRequirement(input: {
    nodeId: string;
    expectedRevision: number;
    patch: { title?: string; text?: string; inputBindings?: CanvasRequirementInputBinding[] };
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): unknown;
  executeRequirement(input: {
    nodeId: string;
    expectedRevision: number;
    confirmedUnchanged: boolean;
    expectedProjectId: string;
  }): Promise<unknown>;
  listRequirementLibrary(includeText: boolean): Promise<unknown>;
  saveRequirementLibrary(input: {
    nodeId: string;
    expectedRequirementRevision: number;
    templateId?: string;
    expectedTemplateRevision?: number;
    expectedProjectId: string;
  }): Promise<unknown>;
  deleteRequirementLibrary(input: {
    templateId: string;
    expectedTemplateRevision: number;
    confirmed: true;
  }): Promise<unknown>;
  useRequirementLibrary(input: {
    templateId: string;
    expectedTemplateRevision: number;
    inputBindings: CanvasRequirementInputBinding[];
    x?: number;
    y?: number;
    expectedProjectId: string;
    expectedCanvasRevision?: number;
  }): Promise<unknown>;
  listCommerceTemplates(): Promise<unknown>;
  saveCommerceTemplate(input: {
    id?: string;
    expectedRevision?: number;
    conflictPolicy?: "overwrite" | "copy";
    title: string;
    description?: string;
    plan: CommerceSetPlan;
  }): Promise<unknown>;
  deleteCommerceTemplate(input: { id: string; expectedRevision: number; confirmed: true }): Promise<unknown>;
  importCommerceTemplate(): Promise<unknown>;
  exportCommerceTemplate(input: { id: string; expectedRevision?: number }): Promise<unknown>;
  listCommerceCatalog(input: {
    expectedProjectId: string;
    includeArchived: boolean;
  }): Promise<unknown>;
  saveCommerceCatalogProduct(input: CommerceCatalogProductDraft & {
    expectedProjectId: string;
    expectedCatalogRevision: number;
  }): Promise<unknown>;
  archiveCommerceCatalogProduct(input: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    archived: boolean;
  }): Promise<unknown>;
  assignCommerceCatalogAssets(input: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    expectedCanvasRevision: number;
    productId: string;
    expectedProductRevision: number;
    kind: CommerceCatalogAssetKind;
    ownerType: CommerceCatalogAssetOwnerType;
    ownerId?: string;
    role: string;
    assets: Array<{ nodeId: string; assetIndex: number }>;
  }): Promise<unknown>;
  removeCommerceCatalogAsset(input: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    linkId: string;
  }): Promise<unknown>;
  updateCommerceCatalogResultState(input: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    linkId: string;
    state: CommerceCatalogResultState;
  }): Promise<CommerceCatalogResult>;
  listCommerceCatalogComparisons(input: { expectedProjectId: string; productId?: string }): Promise<CommerceCatalogResult>;
  selectCommerceCatalogComparisonWinner(input: {
    expectedProjectId: string;
    expectedCatalogRevision: number;
    productId: string;
    expectedProductRevision: number;
    groupKey: string;
    winnerLinkId: string;
  }): Promise<CommerceCatalogResult>;
  previewCommerceExport(input: CommerceExportRequest): Promise<unknown>;
  exportCommercePackage(input: CommerceExportRequest & { confirmed: true }): Promise<unknown>;
  exportSocialPackage(input: {
    expectedProjectId: string;
    requirementNodeId: string;
    expectedRequirementRevision: number;
    workflowId: string;
    confirmed: true;
  }): Promise<unknown>;
  importScientificData(input: { expectedProjectId: string }): Promise<ScientificDataImportResult>;
  listScientificData(input: { expectedProjectId: string }): Promise<ScientificDataSource[]>;
  renderScientificTask(input: {
    expectedProjectId: string;
    expectedCanvasRevision: number;
    requirementNodeId: string;
    expectedRequirementRevision: number;
    plan: ScientificFigurePlan;
    timeoutMs: number;
  }): Promise<ScientificTask>;
  landScientificTask(task: ScientificTask, saved: {
    plan: ScientificFigurePlan;
    requirementNodeId: string;
    requirementRevision: number;
  }): {
    landed: boolean;
    createdNodeIds: string[];
    existingNodeId?: string;
    reason?: string;
  };
  listScientificTasks(input: { expectedProjectId: string }): Promise<ScientificTask[]>;
  cancelScientificTask(input: { expectedProjectId: string; taskId: string }): Promise<ScientificTask>;
  exportScientificTask(input: { expectedProjectId: string; taskId: string; confirmed: true }): Promise<unknown>;
  composePluginTask?(payload: {
    command: string;
    sourceCount: number;
    sourceNodeIds: string[];
    plan: unknown;
  }): Promise<{
    ok: boolean;
    task?: {
      prompt: string;
      visibleContent: string;
      plan?: unknown;
      planHash?: string;
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
  sendPrompt(prompt: string, sourceNodeIds: string[], imageDefaults?: { ratio?: ImageFrameRatio; resolution?: ImageResolutionPreset }): Promise<boolean | void>;
  steerAgent(prompt: string, options?: {
    taskScopeMode?: AgentSteerTaskScopeMode;
    sourceMode?: AgentSteerTaskScopeUpdate["sourceMode"];
    referenceMode?: AgentSteerTaskScopeUpdate["referenceMode"];
    sourceNodeIds?: string[];
    referenceNodeIds?: string[];
    useComposerAttachments?: boolean;
  }): Promise<boolean>;
  executeAuthorizedGoal(prompt: string, options?: AutomationGoalScopeOptions): Promise<unknown>;
  pauseAgent(): Promise<boolean>;
  resumeAgent(): Promise<boolean>;
  stopAgent(): Promise<boolean>;
  newConversation(): void;
  agentBusy(): boolean;
  wait?(milliseconds: number): Promise<unknown>;
};

function number(value: unknown, fallback: number) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function socialPlannedRequestCounts(planValue: SocialContentPlan) {
  const plan = normalizeSocialContentPlan(planValue);
  const imageRequests = plan.platform === "xiaohongshu"
    ? plan.cardCount + (plan.cover.enabled ? 1 : 0)
    : plan.shotCount + 1;
  const videoRequests = plan.platform === "douyin" ? 1 : 0;
  return {
    imageRequests,
    videoRequests,
    totalRequests: imageRequests + videoRequests,
  };
}

function requireSocialRequirement(value: JsonObject, platform: SocialPlatform, context: AutomationCommandContext) {
  assertExpectedProject(value, context);
  const nodeId = String(value.nodeId || "").trim();
  const node = context.nodes().find((candidate) => candidate.id === nodeId);
  if (node?.type !== "requirement" || !node.requirement?.socialPlan) {
    throw automationCommandError("UNSUPPORTED_NODE", "目标节点不是社媒 Requirement。", { nodeId });
  }
  const plan = normalizeSocialContentPlan(node.requirement.socialPlan);
  if (plan.platform !== platform) {
    throw automationCommandError("SOCIAL_PLATFORM_MISMATCH", `目标 Requirement 不属于${platform === "douyin" ? "抖音" : "小红书"}工作流。`, {
      nodeId,
      expectedPlatform: platform,
      currentPlatform: plan.platform,
    });
  }
  return { node, plan };
}

function socialWorkflowStatus(node: WorkflowNode, context: AutomationCommandContext) {
  if (node.type !== "requirement" || !node.requirement?.socialPlan) {
    throw automationCommandError("UNSUPPORTED_NODE", "目标节点不是社媒 Requirement。", { nodeId: node.id });
  }
  const plan = normalizeSocialContentPlan(node.requirement.socialPlan);
  const workflowId = plan.workflowId;
  const outcomes = context.nodes().flatMap((candidate) => {
    if (candidate.type !== "image" && candidate.type !== "video") return [];
    const metadata = candidate.socialContent || candidate.taskProvenance?.socialContent;
    const belongsToWorkflow = metadata?.workflowId === workflowId || (
      plan.platform === "douyin" && candidate.type === "video" && (
        candidate.id === plan.videoNodeId || candidate.videoTaskId === plan.videoTaskId
      )
    );
    if (!belongsToWorkflow) return [];
    return [{
      nodeId: candidate.id,
      nodeType: candidate.type,
      nodeStatus: candidate.status,
      outputs: Number(candidate.outputs || candidate.assets?.length || (candidate.videoAsset ? 1 : 0)),
      contentType: metadata?.contentType || (candidate.type === "video" ? "video" : undefined),
      slot: metadata?.slot,
      contentStatus: metadata?.status,
      ...(candidate.type === "video" ? {
        videoTaskId: candidate.videoTaskId,
        videoTaskState: candidate.videoTaskState,
        videoState: candidate.videoState,
        progress: candidate.videoProgress,
        ambiguous: candidate.videoTaskState === "create-unknown",
        error: candidate.videoError,
      } : {}),
    }];
  });
  const images = outcomes.filter((outcome) => outcome.nodeType === "image");
  const videos = outcomes.filter((outcome) => outcome.nodeType === "video");
  const issues = socialContentWritebackIssues(plan);
  return {
    activeProjectId: context.activeProjectId(),
    requirement: {
      nodeId: node.id,
      title: node.title,
      revision: node.requirement.revision,
    },
    platform: plan.platform,
    workflowId,
    planHash: plan.planHash,
    planStatus: plan.status,
    ready: issues.length === 0,
    issues,
    plan,
    plannedRequests: socialPlannedRequestCounts(plan),
    outcomes: { images, videos },
    dispatched: outcomes.length > 0,
    ambiguous: videos.some((video) => video.ambiguous === true),
  };
}

async function createSocialRequirement(value: JsonObject, platform: SocialPlatform, context: AutomationCommandContext) {
  assertExpectedProject(value, context);
  const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
  const invalidSourceNodeIds = sourceNodeIds.filter((nodeId) => context.nodes().find((node) => node.id === nodeId)?.type !== "image");
  if (invalidSourceNodeIds.length) {
    throw automationCommandError("INVALID_ARGUMENT", "社媒计划的 SOURCE 必须是图片成果或图片容器。", { nodeIds: invalidSourceNodeIds });
  }
  const plan = platform === "xiaohongshu"
    ? normalizeXiaohongshuPlan({ ...value, platform, cover: { enabled: value.coverEnabled !== false } })
    : normalizeDouyinPlan({ ...value, platform });
  const command = platform === "xiaohongshu" ? SOCIAL_XIAOHONGSHU_COMMAND : SOCIAL_DOUYIN_COMMAND;
  const composed = await context.composePluginTask?.({
    command,
    sourceCount: sourceNodeIds.reduce((count, nodeId) => count + Number(context.nodes().find((node) => node.id === nodeId)?.assets?.length || 0), 0),
    sourceNodeIds,
    plan,
  });
  if (!composed?.ok || !composed.task?.prompt) {
    throw automationCommandError("SOCIAL_COMPOSE_FAILED", composed?.error || "社媒计划生成失败。");
  }
  const canonicalPlan = normalizeSocialContentPlan(composed.task.plan ?? plan);
  if (canonicalPlan.platform !== platform || canonicalPlan.workflowId !== plan.workflowId) {
    throw automationCommandError("SOCIAL_IDENTITY_MISMATCH", "社媒计划的工作流身份发生变化，未创建 Requirement。", {
      expectedWorkflowId: plan.workflowId,
      currentWorkflowId: canonicalPlan.workflowId,
    });
  }
  const result = context.createRequirement({
    title: `${platform === "xiaohongshu" ? "小红书" : "抖音"} · ${canonicalPlan.brief.slice(0, 32)}`,
    text: composed.task.prompt,
    inputBindings: sourceNodeIds.map((nodeId) => ({ nodeId, role: "source" as const })),
    x: value.x === undefined ? undefined : number(value.x, 0),
    y: value.y === undefined ? undefined : number(value.y, 0),
    expectedProjectId: String(value.expectedProjectId),
    expectedCanvasRevision: value.expectedCanvasRevision as number,
    socialPlan: canonicalPlan,
  });
  return {
    ...(isJsonObject(result) ? result : { result }),
    platform,
    workflowId: canonicalPlan.workflowId,
    planHash: canonicalPlan.planHash,
    plan: canonicalPlan,
    plannedRequests: socialPlannedRequestCounts(canonicalPlan),
    dispatched: false,
    mayProduceCharges: false,
  };
}

async function executeSocialRequirement(value: JsonObject, platform: SocialPlatform, context: AutomationCommandContext) {
  const { node, plan } = requireSocialRequirement(value, platform, context);
  const expectedRevision = value.expectedRevision as number;
  if (node.requirement!.revision !== expectedRevision) {
    throw automationCommandError("REQUIREMENT_REVISION_CONFLICT", "社媒 Requirement 已发生变化，请读取最新 revision 后重试。", {
      nodeId: node.id,
      expectedRevision,
      currentRevision: node.requirement!.revision,
    });
  }
  const result = await context.executeRequirement({
    nodeId: node.id,
    expectedRevision,
    confirmedUnchanged: value.confirmedUnchanged === true,
    expectedProjectId: String(value.expectedProjectId),
  });
  const state = await waitForAgent(context);
  const latest = context.nodes().find((candidate) => candidate.id === node.id) || node;
  const status = socialWorkflowStatus(latest, context);
  const plannedRequests = socialPlannedRequestCounts(plan);
  return {
    ...(isJsonObject(result) ? result : { result }),
    state,
    status,
    billing: {
      requestCount: plannedRequests.totalRequests,
      ...plannedRequests,
      dispatched: status.dispatched,
      mayProduceCharges: true,
      ambiguous: status.ambiguous,
    },
  };
}

async function exportSocialRequirement(value: JsonObject, platform: SocialPlatform, context: AutomationCommandContext) {
  const { node, plan } = requireSocialRequirement(value, platform, context);
  const expectedRevision = value.expectedRevision as number;
  if (node.requirement!.revision !== expectedRevision) {
    throw automationCommandError("REQUIREMENT_REVISION_CONFLICT", "社媒 Requirement 已发生变化，请读取最新 revision 后重试。", {
      nodeId: node.id,
      expectedRevision,
      currentRevision: node.requirement!.revision,
    });
  }
  if (value.confirmed !== true) {
    throw automationCommandError("CONFIRMATION_REQUIRED", "导出社媒发布包必须显式传入 confirmed=true。");
  }
  const result = await context.exportSocialPackage({
    expectedProjectId: String(value.expectedProjectId),
    requirementNodeId: node.id,
    expectedRequirementRevision: expectedRevision,
    workflowId: plan.workflowId,
    confirmed: true,
  });
  const latest = context.nodes().find((candidate) => candidate.id === node.id) || node;
  return {
    ...(isJsonObject(result) ? result : { result }),
    status: socialWorkflowStatus(latest, context),
  };
}

function requireScientificRequirement(
  value: JsonObject,
  context: AutomationCommandContext,
  expectedRevision?: number,
) {
  assertExpectedProject(value, context);
  const nodeId = String(value.nodeId || "").trim();
  const node = context.nodes().find((candidate) => candidate.id === nodeId);
  if (node?.type !== "requirement" || !node.requirement?.scientificPlan) {
    throw automationCommandError("UNSUPPORTED_NODE", "目标节点不是科研绘图 Requirement。", { nodeId });
  }
  if (expectedRevision !== undefined && node.requirement.revision !== expectedRevision) {
    throw automationCommandError("REQUIREMENT_REVISION_CONFLICT", "科研 Requirement 已发生变化，请读取最新 revision 后重试。", {
      nodeId,
      expectedRevision,
      currentRevision: node.requirement.revision,
    });
  }
  const plan = normalizeScientificFigurePlan(node.requirement.scientificPlan);
  if (
    (node.scientificFigure?.workflowId && node.scientificFigure.workflowId !== plan.workflowId)
    || (node.scientificFigure?.planHash && node.scientificFigure.planHash !== plan.planHash)
  ) {
    throw automationCommandError("SCIENTIFIC_PLAN_IDENTITY_CONFLICT", "科研计划身份与节点元数据不一致，未执行任务。", {
      nodeId,
      workflowId: plan.workflowId,
      planHash: plan.planHash,
    });
  }
  return { node, plan };
}

function publicScientificTask(task: ScientificTask) {
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    workflowId: task.workflowId,
    planHash: task.planHash,
    requirementNodeId: task.requirementNodeId,
    requirementRevision: task.requirementRevision,
    backend: task.backend,
    state: task.state,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
    exitCode: task.exitCode,
    scriptHash: task.scriptHash,
    outputs: task.outputs.map(({ assetUrl: _assetUrl, ...output }) => output),
    plan: normalizeScientificFigurePlan(task.plan),
  };
}

async function createScientificRequirement(value: JsonObject, context: AutomationCommandContext) {
  assertExpectedProject(value, context);
  assertExpectedCanvasRevision(value, context);
  const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
  const invalidSourceNodeIds = sourceNodeIds.filter((nodeId) => context.nodes().find((node) => node.id === nodeId)?.type !== "image");
  if (invalidSourceNodeIds.length) {
    throw automationCommandError("INVALID_ARGUMENT", "科研计划的画布 SOURCE 必须是图片成果、图片容器或分层图片。", {
      nodeIds: invalidSourceNodeIds,
    });
  }
  const availableData = await context.listScientificData({ expectedProjectId: String(value.expectedProjectId) });
  const dataById = new Map(availableData.map((item) => [item.id, item]));
  const requestedDataIds = [...new Set((Array.isArray(value.dataSourceIds) ? value.dataSourceIds : []).map(String))];
  const missingDataSourceIds = requestedDataIds.filter((id) => !dataById.has(id));
  if (missingDataSourceIds.length) {
    throw automationCommandError("SCIENTIFIC_DATA_STALE", "科研计划引用了不存在或已变化的受管数据，请重新读取 research.data.list。", {
      dataSourceIds: missingDataSourceIds,
    });
  }
  const plan = normalizeScientificFigurePlan({
    backend: value.backend,
    figureType: value.figureType,
    archetype: value.archetype,
    researchClaim: value.researchClaim,
    targetJournal: value.targetJournal,
    dataSources: requestedDataIds.map((id) => dataById.get(id)),
    panels: value.panels,
    outputFormats: value.outputFormats,
    stylePreset: value.stylePreset,
    dimensions: {
      widthMm: value.widthMm,
      heightMm: value.heightMm,
      dpi: value.dpi,
    },
    statisticsNotes: value.statisticsNotes,
    sourceDataNotes: value.sourceDataNotes,
    imageIntegrityNotes: value.imageIntegrityNotes,
    reviewerRisks: value.reviewerRisks,
  });
  const issues = scientificFigurePlanIssues(plan, { forRender: false });
  if (issues.length) {
    throw automationCommandError("SCIENTIFIC_PLAN_INCOMPLETE", `科研绘图计划尚不能保存：${issues.join("；")}。`, { issues });
  }
  const composed = await context.composePluginTask?.({
    command: SCIENTIFIC_FIGURE_START_COMMAND,
    sourceCount: sourceNodeIds.reduce((count, nodeId) => count + Number(context.nodes().find((node) => node.id === nodeId)?.assets?.length || 0), 0),
    sourceNodeIds,
    plan,
  });
  if (!composed?.ok || !composed.task?.prompt) {
    throw automationCommandError("SCIENTIFIC_COMPOSE_FAILED", composed?.error || "科研绘图计划生成失败。");
  }
  const canonicalPlan = normalizeScientificFigurePlan(composed.task.plan ?? plan);
  if (canonicalPlan.workflowId !== plan.workflowId || canonicalPlan.planHash !== plan.planHash) {
    throw automationCommandError("SCIENTIFIC_PLAN_IDENTITY_CONFLICT", "科研计划在写入 Requirement 前发生了变化，未创建节点。", {
      expectedWorkflowId: plan.workflowId,
      currentWorkflowId: canonicalPlan.workflowId,
      expectedPlanHash: plan.planHash,
      currentPlanHash: canonicalPlan.planHash,
    });
  }
  assertExpectedProject(value, context);
  assertExpectedCanvasRevision(value, context);
  const result = context.createRequirement({
    title: `科研图 · ${canonicalPlan.researchClaim.slice(0, 36)}`,
    text: composed.task.prompt,
    inputBindings: sourceNodeIds.map((nodeId) => ({ nodeId, role: "source" as const })),
    x: value.x === undefined ? undefined : number(value.x, 0),
    y: value.y === undefined ? undefined : number(value.y, 0),
    expectedProjectId: String(value.expectedProjectId),
    expectedCanvasRevision: value.expectedCanvasRevision as number,
    scientificPlan: canonicalPlan,
  });
  return {
    ...canvasMutationResponse(result, context),
    workflowId: canonicalPlan.workflowId,
    planHash: canonicalPlan.planHash,
    plan: canonicalPlan,
    dispatched: false,
    mayProduceCharges: false,
  };
}

async function renderScientificRequirement(value: JsonObject, context: AutomationCommandContext) {
  assertExpectedProject(value, context);
  assertExpectedCanvasRevision(value, context);
  const expectedRevision = value.expectedRevision as number;
  const { node, plan } = requireScientificRequirement(value, context, expectedRevision);
  const issues = scientificFigurePlanIssues(plan, { forRender: true });
  if (issues.length) {
    throw automationCommandError("SCIENTIFIC_PLAN_INCOMPLETE", `科研绘图计划尚不能执行：${issues.join("；")}。`, { issues });
  }
  const task = await context.renderScientificTask({
    expectedProjectId: String(value.expectedProjectId),
    expectedCanvasRevision: value.expectedCanvasRevision as number,
    requirementNodeId: node.id,
    expectedRequirementRevision: expectedRevision,
    plan,
    timeoutMs: number(value.timeoutMs, 120_000),
  });
  if (task.state !== "ready") {
    throw automationCommandError("SCIENTIFIC_TASK_NOT_READY", "科研任务没有完成，未向画布写入任何成果。", {
      taskId: task.taskId,
      state: task.state,
    });
  }
  assertExpectedProject(value, context);
  assertExpectedCanvasRevision(value, context, {
    taskId: task.taskId,
    taskState: task.state,
    managedOutputsPersisted: true,
  });
  const latest = requireScientificRequirement(value, context, expectedRevision);
  if (latest.plan.workflowId !== task.workflowId || latest.plan.planHash !== task.planHash) {
    throw automationCommandError("SCIENTIFIC_PLAN_IDENTITY_CONFLICT", "科研任务完成后 Requirement 计划身份已变化；输出已受管保存，但未写入画布。", {
      taskId: task.taskId,
      requirementNodeId: node.id,
    });
  }
  const landing = context.landScientificTask(task, {
    plan: latest.plan,
    requirementNodeId: node.id,
    requirementRevision: expectedRevision,
  });
  if (!landing.landed) {
    throw automationCommandError("SCIENTIFIC_OUTPUT_NOT_LANDED", "科研输出已受管保存，但画布前置条件已变化，未伪造写入成功。", {
      taskId: task.taskId,
      reason: landing.reason,
      managedOutputsPersisted: true,
    });
  }
  return {
    task: publicScientificTask(task),
    landing,
    state: canvasState(context),
  };
}

async function scientificTaskStatus(value: JsonObject, context: AutomationCommandContext) {
  assertExpectedProject(value, context);
  const requestedNodeId = String(value.nodeId || "").trim();
  if (requestedNodeId) requireScientificRequirement({ ...value, nodeId: requestedNodeId }, context);
  const requestedTaskId = String(value.taskId || "").trim();
  const tasks = (await context.listScientificTasks({ expectedProjectId: String(value.expectedProjectId) }))
    .filter((task) => !requestedTaskId || task.taskId === requestedTaskId)
    .filter((task) => !requestedNodeId || task.requirementNodeId === requestedNodeId);
  if (requestedTaskId && !tasks.length) {
    throw automationCommandError("SCIENTIFIC_TASK_NOT_FOUND", "科研绘图任务不存在。", { taskId: requestedTaskId });
  }
  return {
    activeProjectId: context.activeProjectId(),
    tasks: tasks.map(publicScientificTask),
  };
}

async function commerceSetGoal(value: JsonObject, context: AutomationCommandContext) {
  const rawPlan = value.plan;
  if (
    isJsonObject(rawPlan)
    && Object.prototype.hasOwnProperty.call(rawPlan, "languageCodes")
    && Object.prototype.hasOwnProperty.call(rawPlan, "targetLocales")
  ) {
    throw automationCommandError(
      "INVALID_ARGUMENT",
      "commerce.compose-set plan cannot include both languageCodes and targetLocales.",
      { fields: ["plan.languageCodes", "plan.targetLocales"] },
    );
  }
  const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
  if (!sourceNodeIds.length) throw new Error("commerce.compose-set 需要至少一个有效 sourceNodeId。");
  const nodes = context.nodes();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const invalidSourceNodeIds = sourceNodeIds.filter((nodeId) => {
    const node = nodeById.get(nodeId);
    return node?.type !== "image" || Boolean(node.layerGroup);
  });
  if (invalidSourceNodeIds.length) {
    throw automationCommandError("INVALID_ARGUMENT", `commerce.compose-set 的 SOURCE 必须是图片成果或图片容器：${invalidSourceNodeIds.join(", ")}。`, {
      nodeIds: invalidSourceNodeIds,
    });
  }
  const sourceBindingIds = new Set<string>();
  for (const nodeId of sourceNodeIds) {
    for (const binding of flattenImageContainerBindings(nodes, nodeId)) {
      if (binding.role !== "reference" && binding.bindingId) sourceBindingIds.add(binding.bindingId);
    }
  }
  const sourceCount = sourceBindingIds.size;
  if (!sourceCount) throw new Error("commerce.compose-set 选择的节点中没有可执行的 SOURCE 图片。");
  const plan = normalizeCommerceSetPlan(rawPlan);
  const rawTranslationItems = isJsonObject(rawPlan) && Array.isArray(rawPlan.translationItems) ? rawPlan.translationItems : [];
  if (
    rawTranslationItems.length !== plan.translationItems.length ||
    (plan.mode !== "translate" && rawTranslationItems.length > 0) ||
    plan.translationItems.some((item) => item.sourceIndex >= sourceCount)
  ) {
    throw automationCommandError(
      "INVALID_ARGUMENT",
      "commerce.compose-set 的 translationItems 必须唯一对应当前 SOURCE 序号与已选择语言。",
      { field: "plan.translationItems", sourceCount },
    );
  }
  const counts = commerceSetRequestCounts(plan, sourceCount);
  if (plan.mode === "translate" && plan.targetLocales.length === 0) {
    throw new Error("commerce.compose-set 翻译计划需要至少一种有效目标语言。");
  }
  if (counts.exceedsRequestLimit) {
    throw new Error(`commerce.compose-set 需要 ${counts.totalRequests} 个图片请求，超过单次 ${counts.maxTotalRequests} 个的安全上限。`);
  }
  const operationsPerAsset = counts.sourceCount > 0 ? Math.floor(counts.totalRequests / counts.sourceCount) : 0;
  if (operationsPerAsset < 1 || operationsPerAsset > 200) {
    throw new Error("commerce.compose-set 没有产生可执行的每图操作数。");
  }
  if (!context.composePluginTask) throw new Error("当前桌面运行时没有提供可信的跨境电商计划编排器。");
  const command = plan.mode === "translate"
    ? "sparkai.commerce-toolkit.translate-listing-set"
    : "sparkai.commerce-toolkit.generate-listing-set";
  const composed = await context.composePluginTask({ command, sourceCount, sourceNodeIds, plan });
  if (!composed?.ok || !composed.task?.prompt) {
    throw new Error(composed?.error || "跨境电商计划编排失败。");
  }
  const planHash = String(composed.task.planHash || "").trim().toLowerCase();
  if (!/^commerce-[a-f0-9]{32}$/.test(planHash)) {
    throw new Error("可信跨境电商计划缺少有效 planHash，命令未执行。");
  }
  const trustedOutputsPerSource = Math.floor(Number(composed.task.counts?.outputsPerSource) || 0);
  const trustedTotalRequests = Math.floor(Number(composed.task.counts?.totalRequests) || 0);
  if (trustedOutputsPerSource !== operationsPerAsset || trustedTotalRequests !== counts.totalRequests) {
    throw new Error("跨境电商计划编排结果与当前 SOURCE 矩阵不一致，命令未执行。");
  }
  return {
    prompt: composed.task.prompt,
    plan,
    planHash,
    counts,
    sourceNodeIds,
    operationsPerAsset,
  };
}

function invalidArgument(command: string, path: string, reason: string, details: JsonObject = {}): never {
  throw automationCommandError("INVALID_ARGUMENT", `${command} 参数 ${path || "$"} ${reason}。`, {
    command,
    path: path || "$",
    reason,
    ...details,
  });
}

function validateSchemaValue(command: string, schema: JsonSchema, value: unknown, path = "$" ): void {
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    invalidArgument(command, path, "不在允许的枚举值中", { allowed: [...schema.enum], received: value });
  }
  if (schema.type === "object") {
    if (!isJsonObject(value)) invalidArgument(command, path, "必须是对象");
    const objectValue = value as JsonObject;
    const properties = schema.properties ?? {};
    const missing = (schema.required ?? []).filter((key) => !Object.prototype.hasOwnProperty.call(objectValue, key));
    if (missing.length) invalidArgument(command, path, "缺少必填字段", { missing });
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(objectValue).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unexpected.length) invalidArgument(command, path, "包含未知字段", { unexpected });
    }
    if (schema.minProperties !== undefined && Object.keys(objectValue).length < schema.minProperties) {
      invalidArgument(command, path, `至少需要 ${schema.minProperties} 个字段`, { minimum: schema.minProperties });
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(objectValue, key)) validateSchemaValue(command, childSchema, objectValue[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) invalidArgument(command, path, "必须是数组");
    const arrayValue = value as unknown[];
    if (schema.minItems !== undefined && arrayValue.length < schema.minItems) {
      invalidArgument(command, path, `至少需要 ${schema.minItems} 项`, { minimum: schema.minItems, received: arrayValue.length });
    }
    if (schema.maxItems !== undefined && arrayValue.length > schema.maxItems) {
      invalidArgument(command, path, `最多允许 ${schema.maxItems} 项`, { maximum: schema.maxItems, received: arrayValue.length });
    }
    if (schema.uniqueItems) {
      const seen = new Set<string>();
      const duplicateIndexes: number[] = [];
      arrayValue.forEach((item, index) => {
        const identity = canonicalJson(item);
        if (seen.has(identity)) duplicateIndexes.push(index);
        else seen.add(identity);
      });
      if (duplicateIndexes.length) invalidArgument(command, path, "不能包含重复项", { duplicateIndexes });
    }
    if (schema.items) arrayValue.forEach((item, index) => validateSchemaValue(command, schema.items!, item, `${path}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") invalidArgument(command, path, "必须是字符串");
    const stringValue = value as string;
    if (schema.minLength !== undefined && stringValue.length < schema.minLength) {
      invalidArgument(command, path, `长度不能小于 ${schema.minLength}`, { minimum: schema.minLength });
    }
    if (schema.maxLength !== undefined && stringValue.length > schema.maxLength) {
      invalidArgument(command, path, `长度不能超过 ${schema.maxLength}`, { maximum: schema.maxLength });
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(stringValue))) invalidArgument(command, path, "格式不匹配", { pattern: schema.pattern });
    return;
  }
  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) invalidArgument(command, path, "必须是整数");
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalidArgument(command, path, "必须是有限数字");
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    invalidArgument(command, path, "必须是布尔值");
  }
  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) invalidArgument(command, path, `不能小于 ${schema.minimum}`, { minimum: schema.minimum });
    if (schema.maximum !== undefined && value > schema.maximum) invalidArgument(command, path, `不能大于 ${schema.maximum}`, { maximum: schema.maximum });
  }
}

function validateCommandArgs(command: string, args: unknown): JsonObject {
  if (!isJsonObject(args)) invalidArgument(command, "$", "必须是 JSON 对象");
  const parameters = automationCommandDefinitions[command]?.parameters;
  if (parameters) validateSchemaValue(command, parameters, args);
  return args;
}

function assertExpectedProject(value: JsonObject, context: AutomationCommandContext): void {
  if (value.expectedProjectId === undefined) return;
  const expectedProjectId = String(value.expectedProjectId);
  const activeProjectId = context.activeProjectId();
  if (expectedProjectId !== activeProjectId) {
    throw automationCommandError("PROJECT_MISMATCH", "当前项目与命令预期项目不一致，命令未执行。", {
      expectedProjectId,
      activeProjectId,
    });
  }
}

function assertExpectedCanvasRevision(
  value: JsonObject,
  context: AutomationCommandContext,
  extraDetails: JsonObject = {},
): void {
  if (value.expectedCanvasRevision === undefined) return;
  const expectedCanvasRevision = Number(value.expectedCanvasRevision);
  const currentCanvasRevision = context.canvasRevision();
  if (expectedCanvasRevision !== currentCanvasRevision) {
    throw automationCommandError("CANVAS_REVISION_CONFLICT", "画布已发生变化，请读取最新 canvas.state 后重试。", {
      expectedCanvasRevision,
      currentCanvasRevision,
      ...extraDetails,
    });
  }
}

function strictNodeIds(value: unknown, label: string, context: AutomationCommandContext): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw automationCommandError("INVALID_ARGUMENT", `${label} 必须是节点 ID 数组。`, { field: label });
  const ids = [...new Set(value.map((item) => String(item || "").trim()))];
  if (ids.some((id) => !id)) throw automationCommandError("INVALID_ARGUMENT", `${label} 不能包含空节点 ID。`, { field: label });
  const available = new Set(context.nodes().map((node) => node.id));
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length) throw automationCommandError("NODE_NOT_FOUND", `${label} 包含不存在的节点：${missing.join(", ")}。命令未执行。`, { nodeIds: missing });
  return ids;
}

function canvasState(context: AutomationCommandContext) {
  const nodes = context.nodes();
  const layoutGroups = typeof context.layoutGroups === "function" ? context.layoutGroups() : [];
  const directlyLockedNodeIds = typeof context.lockedNodeIds === "function" ? context.lockedNodeIds() : [];
  const directlyLocked = new Set(directlyLockedNodeIds);
  return {
    activeProjectId: context.activeProjectId(),
    workspaceDomain: context.workspaceDomain(),
    activeConversationId: context.activeConversationId(),
    canvasRevision: typeof context.canvasRevision === "function" ? context.canvasRevision() : 0,
    agentStatus: context.agentStatus(),
    activeRunId: context.activeRunId(),
    agentPaused: context.agentPaused(),
    viewport: context.viewport(),
    selection: context.selection(),
    locks: { lockedNodeIds: [...directlyLockedNodeIds] },
    nodes: nodes.map((node) => {
      const spec = imageContainerSpecForNode(node);
      const layoutGroup = layoutGroups.find((group) => group.hostNodeId === node.id || group.memberNodeIds.includes(node.id));
      const blockingNodeIds = typeof context.mutationLocks === "function"
        ? context.mutationLocks([node.id])
        : directlyLocked.has(node.id) ? [node.id] : [];
      const generationBusy = node.status === "working" || node.imageState === "generating" || node.videoState === "generating" || Boolean(node.generationRunId);
      const busyReasons = [
        ...(generationBusy ? ["generation"] : []),
        ...(blockingNodeIds.length ? ["mutation-lock"] : []),
      ];
      const inputBindings = node.type === "requirement" ? requirementInputBindings(node, nodes) : [];
      return {
        id: node.id,
        type: node.type,
        title: node.title,
        status: node.status,
        imageState: node.imageState,
        assetCount: node.assets?.length || 0,
        video: node.type === "video" ? {
          state: node.videoState,
          mimeType: node.videoAsset?.mimeType,
          originalName: node.videoAsset?.originalName,
          width: node.videoAsset?.width,
          height: node.videoAsset?.height,
          durationMs: node.videoAsset?.durationMs,
          model: node.videoModel,
          taskId: node.videoTaskId,
          taskState: node.videoTaskState,
          progress: node.videoProgress,
        } : undefined,
        relation: {
          parentId: node.parentId || null,
          relationType: node.relationType || null,
        },
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        requirement: node.requirement ? {
          version: node.requirement.version,
          revision: node.requirement.revision,
          text: node.requirement.text,
          createdFrom: node.requirement.createdFrom,
          inputBindings,
          inputSignature: stableRequirementInputSignature(node, nodes),
          lastRunAt: node.requirement.lastRunAt,
          lastRunCount: node.requirement.lastRunCount,
          lastError: node.requirement.lastError,
          skill: node.requirement.skill ? {
            name: node.requirement.skill.name,
            description: node.requirement.skill.description,
            sourceName: node.requirement.skill.sourceName,
            contentFingerprint: node.requirement.skill.contentFingerprint,
            importedAt: node.requirement.skill.importedAt,
            locallyModifiedAt: node.requirement.skill.locallyModifiedAt,
          } : undefined,
        } : undefined,
        container: spec || layoutGroup ? {
          kind: spec?.kind,
          role: node.imageContainerRole,
          memberNodeIds: [...(spec?.memberNodeIds ?? [])],
          childContainerNodeIds: [...(spec?.childContainerNodeIds ?? [])],
          bindingCount: spec?.memberBindings.length ?? 0,
          layoutGroup: layoutGroup ? {
            id: layoutGroup.id,
            hostNodeId: layoutGroup.hostNodeId,
            memberNodeIds: [...layoutGroup.memberNodeIds],
          } : undefined,
        } : undefined,
        activity: {
          busy: busyReasons.length > 0,
          busyReasons,
          locked: blockingNodeIds.length > 0,
          directlyLocked: directlyLocked.has(node.id),
          blockingNodeIds,
          generationRunId: node.generationRunId,
        },
      };
    }),
  };
}

function appState(context: AutomationCommandContext) {
  return {
    ...canvasState(context),
    projects: context.projects().map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
    recentMessages: context.messages().filter((message) => !message.hidden).slice(-20).map(({ id, role, content, status, createdAt }) => ({
      id,
      role,
      content,
      status,
      createdAt
    }))
  };
}

function canvasMutationResponse(result: unknown, context: AutomationCommandContext) {
  return {
    ...(isJsonObject(result) ? result : { result }),
    state: canvasState(context),
  };
}

async function waitForAgent(context: AutomationCommandContext) {
  const deadline = Date.now() + 15 * 60_000;
  const wait = context.wait ?? ((milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)));
  let observedBusy = ["thinking", "editing"].includes(context.agentStatus());
  if (!observedBusy) return appState(context);
  while (Date.now() < deadline) {
    const status = context.agentStatus();
    if (["thinking", "editing"].includes(status)) observedBusy = true;
    if (observedBusy && ["idle", "error"].includes(status)) return appState(context);
    await wait(120);
  }
  throw new Error("等待 SparkAI WorkSpace Agent 完成超时。");
}

type Handler = (args: JsonObject) => unknown | Promise<unknown>;

export async function executeAutomationCommand(command: string, args: JsonObject, context: AutomationCommandContext) {
  const handlers: Record<AutomationRendererCommandName, Handler> = {
    "app.state": () => appState(context),
    "canvas.state": () => canvasState(context),
    "workspace.domain.list": () => ({
      defaultDomain: DEFAULT_WORKSPACE_DOMAIN,
      domains: workspaceDomainDefinitions.map((definition) => publicWorkspaceDomainDefinition(definition.id))
    }),
    "workspace.domain.get": () => ({
      activeProjectId: context.activeProjectId(),
      domain: publicWorkspaceDomainDefinition(context.workspaceDomain())
    }),
    "workspace.domain.set": (value) => {
      assertExpectedProject(value, context);
      const domain = normalizeWorkspaceDomain(value.domain);
      const changed = context.setWorkspaceDomain(domain) !== false;
      return {
        activeProjectId: context.activeProjectId(),
        changed,
        domain: publicWorkspaceDomainDefinition(context.workspaceDomain())
      };
    },
    "project.list": () => ({ activeProjectId: context.activeProjectId(), projects: context.projects() }),
    "project.switch": async (value) => {
      const id = String(value.id || "");
      if (!context.projects().some((project) => project.id === id)) throw new Error("目标项目不存在。");
      await context.switchProject(id);
      return appState(context);
    },
    "project.create": async (value) => {
      await context.createProject(
        String(value.name || "").trim(),
        value.workspaceDomain === undefined ? context.workspaceDomain() : normalizeWorkspaceDomain(value.workspaceDomain)
      );
      return appState(context);
    },
    "project.rename": async (value) => {
      await context.renameProject(String(value.name || "").trim());
      return appState(context);
    },
    "canvas.select": (value) => {
      assertExpectedProject(value, context);
      const ids = strictNodeIds(value.ids, "ids", context);
      const primaryId = value.primaryId === undefined ? ids[0] || "" : String(value.primaryId).trim();
      if (primaryId && !ids.includes(primaryId)) {
        throw automationCommandError("INVALID_ARGUMENT", "primaryId 必须包含在 ids 中，选择未改变。", {
          field: "primaryId",
          primaryId,
          ids,
        });
      }
      if (!ids.length && primaryId) {
        throw automationCommandError("INVALID_ARGUMENT", "清空选择时不能指定 primaryId，选择未改变。", { field: "primaryId" });
      }
      context.selectNodes(ids, primaryId);
      return canvasState(context);
    },
    "canvas.connect": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.connectCanvas({
        edges: (value.edges as JsonObject[]).map((edge) => ({
          sourceId: String(edge.sourceId),
          targetId: String(edge.targetId),
          relationType: edge.relationType as WorkflowNode["relationType"],
          inputRole: edge.inputRole as AssetTaskRole | undefined,
        })),
        replaceExisting: value.replaceExisting === true,
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.disconnect": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.disconnectCanvas({
        edges: (value.edges as JsonObject[]).map((edge) => ({
          sourceId: String(edge.sourceId),
          targetId: String(edge.targetId),
        })),
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.group": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.groupCanvas({
        nodeIds: (value.nodeIds as string[]).map(String),
        primaryId: value.primaryId === undefined ? undefined : String(value.primaryId),
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.dissolve": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.dissolveCanvas({
        containerIds: (value.containerIds as string[]).map(String),
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.nudge": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.nudgeCanvas({
        nodeIds: (value.nodeIds as string[]).map(String),
        dx: value.dx as number,
        dy: value.dy as number,
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.create-requirement": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.createRequirement({
        title: value.title === undefined ? undefined : String(value.title),
        text: String(value.text),
        inputBindings: (value.inputBindings as JsonObject[] | undefined ?? []).map((binding) => ({
          nodeId: String(binding.nodeId),
          role: binding.role as AssetTaskRole,
        })),
        x: value.x as number | undefined,
        y: value.y as number | undefined,
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.update-requirement": async (value) => {
      assertExpectedProject(value, context);
      const rawPatch = value.patch as JsonObject;
      const result = await context.updateRequirement({
        nodeId: String(value.nodeId),
        expectedRevision: value.expectedRevision as number,
        patch: {
          ...(rawPatch.title !== undefined ? { title: String(rawPatch.title) } : {}),
          ...(rawPatch.text !== undefined ? { text: String(rawPatch.text) } : {}),
          ...(rawPatch.inputBindings !== undefined ? {
            inputBindings: (rawPatch.inputBindings as JsonObject[]).map((binding) => ({
              nodeId: String(binding.nodeId),
              role: binding.role as AssetTaskRole,
            })),
          } : {}),
        },
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "canvas.execute-requirement": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.executeRequirement({
        nodeId: String(value.nodeId),
        expectedRevision: value.expectedRevision as number,
        confirmedUnchanged: value.confirmedUnchanged === true,
        expectedProjectId: String(value.expectedProjectId),
      });
      const state = await waitForAgent(context);
      return { ...(isJsonObject(result) ? result : { result }), state };
    },
    "requirement-library.list": (value) => context.listRequirementLibrary(value.includeText === true),
    "requirement-library.save": async (value) => {
      assertExpectedProject(value, context);
      const nodeId = String(value.nodeId);
      const node = context.nodes().find((candidate) => candidate.id === nodeId);
      if (node?.type !== "requirement" || !node.requirement) {
        throw automationCommandError("UNSUPPORTED_NODE", "只能将当前存在的需求节点保存到个人模板库。", { nodeId });
      }
      const expectedRequirementRevision = value.expectedRequirementRevision as number;
      if (node.requirement.revision !== expectedRequirementRevision) {
        throw automationCommandError("REQUIREMENT_REVISION_CONFLICT", "需求已发生变化，请读取最新 revision 后重试。", {
          nodeId,
          expectedRevision: expectedRequirementRevision,
          currentRevision: node.requirement.revision,
        });
      }
      const templateId = value.templateId === undefined ? undefined : String(value.templateId);
      const expectedTemplateRevision = value.expectedTemplateRevision as number | undefined;
      if (Boolean(templateId) !== (expectedTemplateRevision !== undefined)) {
        throw automationCommandError("INVALID_ARGUMENT", "覆盖个人需求模板时必须同时提供 templateId 和 expectedTemplateRevision。", {
          fields: ["templateId", "expectedTemplateRevision"],
        });
      }
      return context.saveRequirementLibrary({
        nodeId,
        expectedRequirementRevision,
        templateId,
        expectedTemplateRevision,
        expectedProjectId: String(value.expectedProjectId),
      });
    },
    "requirement-library.delete": (value) => {
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "删除个人需求模板需要 confirmed=true。", { field: "confirmed" });
      }
      return context.deleteRequirementLibrary({
        templateId: String(value.templateId),
        expectedTemplateRevision: value.expectedTemplateRevision as number,
        confirmed: true,
      });
    },
    "requirement-library.use": async (value) => {
      assertExpectedProject(value, context);
      const inputBindings = (value.inputBindings as JsonObject[] | undefined ?? []).map((binding) => ({
        nodeId: String(binding.nodeId),
        role: binding.role as AssetTaskRole,
      }));
      strictNodeIds(inputBindings.map((binding) => binding.nodeId), "inputBindings.nodeId", context);
      const result = await context.useRequirementLibrary({
        templateId: String(value.templateId),
        expectedTemplateRevision: value.expectedTemplateRevision as number,
        inputBindings,
        x: value.x as number | undefined,
        y: value.y as number | undefined,
        expectedProjectId: String(value.expectedProjectId),
        expectedCanvasRevision: value.expectedCanvasRevision as number | undefined,
      });
      return canvasMutationResponse(result, context);
    },
    "commerce.template.list": () => context.listCommerceTemplates(),
    "commerce.template.save": (value) => {
      if (Boolean(value.templateId) !== (value.expectedTemplateRevision !== undefined)) {
        throw automationCommandError("INVALID_ARGUMENT", "覆盖个人套图模板时必须同时提供 templateId 和 expectedTemplateRevision。", {
          fields: ["templateId", "expectedTemplateRevision"],
        });
      }
      if (value.conflictPolicy === "overwrite" && !value.templateId) {
        throw automationCommandError("INVALID_ARGUMENT", "选择 overwrite 时必须同时提供同名个人模板的 templateId 和 expectedTemplateRevision。", {
          fields: ["conflictPolicy", "templateId", "expectedTemplateRevision"],
        });
      }
      if (value.conflictPolicy === "copy" && value.templateId) {
        throw automationCommandError("INVALID_ARGUMENT", "选择 copy 时不能同时指定 templateId；软件会自动生成不重复的副本名称。", {
          fields: ["conflictPolicy", "templateId"],
        });
      }
      const plan = normalizeCommerceSetPlan(value.plan);
      if (plan.mode === "translate" && plan.targetLocales.length === 0) {
        throw automationCommandError("INVALID_ARGUMENT", "翻译套图模板至少需要一种目标语言。", { field: "plan.targetLocales" });
      }
      return context.saveCommerceTemplate({
        ...(value.templateId ? { id: String(value.templateId), expectedRevision: value.expectedTemplateRevision as number } : {}),
        ...(value.conflictPolicy ? { conflictPolicy: value.conflictPolicy as "overwrite" | "copy" } : {}),
        title: String(value.title),
        ...(value.description !== undefined ? { description: String(value.description) } : {}),
        plan: { ...plan, translationItems: [], saveTarget: "none", reusableName: plan.title },
      });
    },
    "commerce.template.delete": (value) => {
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "删除个人套图模板需要 confirmed=true。", { field: "confirmed" });
      }
      return context.deleteCommerceTemplate({
        id: String(value.templateId),
        expectedRevision: value.expectedTemplateRevision as number,
        confirmed: true,
      });
    },
    "commerce.template.import": () => context.importCommerceTemplate(),
    "commerce.template.export": (value) => context.exportCommerceTemplate({
      id: String(value.templateId),
      ...(value.expectedTemplateRevision !== undefined ? { expectedRevision: value.expectedTemplateRevision as number } : {}),
    }),
    "commerce.catalog.list": (value) => {
      assertExpectedProject(value, context);
      return context.listCommerceCatalog({
        expectedProjectId: String(value.expectedProjectId),
        includeArchived: value.includeArchived === true,
      });
    },
    "commerce.catalog.upsert": (value) => {
      assertExpectedProject(value, context);
      const product = value.product as JsonObject;
      if (Boolean(product.productId) !== (product.expectedProductRevision !== undefined)) {
        throw automationCommandError("INVALID_ARGUMENT", "更新商品时必须同时提供 productId 和 expectedProductRevision。", {
          fields: ["product.productId", "product.expectedProductRevision"],
        });
      }
      return context.saveCommerceCatalogProduct({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        ...(product as CommerceCatalogProductDraft),
      });
    },
    "commerce.catalog.delete": (value) => {
      assertExpectedProject(value, context);
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "归档商品需要 confirmed=true。", { field: "confirmed" });
      }
      return context.archiveCommerceCatalogProduct({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        productId: String(value.productId),
        expectedProductRevision: value.expectedProductRevision as number,
        archived: true,
      });
    },
    "commerce.catalog.assign": (value) => {
      assertExpectedProject(value, context);
      const assets = (value.assets as JsonObject[]).map((asset) => ({
        nodeId: String(asset.nodeId),
        assetIndex: asset.assetIndex as number,
      }));
      strictNodeIds(assets.map((asset) => asset.nodeId), "assets.nodeId", context);
      return context.assignCommerceCatalogAssets({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        expectedCanvasRevision: value.expectedCanvasRevision as number,
        productId: String(value.productId),
        expectedProductRevision: value.expectedProductRevision as number,
        kind: value.kind as CommerceCatalogAssetKind,
        ownerType: value.ownerType as CommerceCatalogAssetOwnerType,
        ...(value.ownerId !== undefined ? { ownerId: String(value.ownerId) } : {}),
        role: String(value.role),
        assets,
      });
    },
    "commerce.catalog.remove": (value) => {
      assertExpectedProject(value, context);
      return context.removeCommerceCatalogAsset({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        productId: String(value.productId),
        expectedProductRevision: value.expectedProductRevision as number,
        linkId: String(value.linkId),
      });
    },
    "commerce.catalog.review": async (value) => {
      assertExpectedProject(value, context);
      const linkIds = (value.linkIds as unknown[]).map(String);
      let expectedCatalogRevision = value.expectedCatalogRevision as number;
      let expectedProductRevision = value.expectedProductRevision as number;
      let productId = String(value.productId);
      let result: CommerceCatalogResult | undefined;
      for (const linkId of linkIds) {
        result = await context.updateCommerceCatalogResultState({
          expectedProjectId: String(value.expectedProjectId),
          expectedCatalogRevision,
          productId,
          expectedProductRevision,
          linkId,
          state: value.state as CommerceCatalogResultState,
        });
        if (!result.ok || !result.product) {
          throw automationCommandError(result.errorCode || "COMMERCE_CATALOG_FAILED", result.error || "复核翻译结果失败。", result.details);
        }
        expectedCatalogRevision = Number(result.catalogRevision ?? expectedCatalogRevision);
        expectedProductRevision = result.product.revision;
        productId = result.product.productId;
      }
      return { ...result, reviewed: linkIds.length, state: value.state };
    },
    "commerce.catalog.compare": (value) => {
      assertExpectedProject(value, context);
      return context.listCommerceCatalogComparisons({
        expectedProjectId: String(value.expectedProjectId),
        ...(value.productId !== undefined ? { productId: String(value.productId) } : {}),
      });
    },
    "commerce.catalog.select": (value) => {
      assertExpectedProject(value, context);
      return context.selectCommerceCatalogComparisonWinner({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        productId: String(value.productId),
        expectedProductRevision: value.expectedProductRevision as number,
        groupKey: String(value.groupKey),
        winnerLinkId: String(value.winnerLinkId),
      });
    },
    "commerce.export.preview": (value) => {
      assertExpectedProject(value, context);
      return context.previewCommerceExport({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        platform: value.platform as CommerceExportRequest["platform"],
        format: value.format as CommerceExportFormat,
        includeCandidates: value.includeCandidates === true,
        ...(value.productIds !== undefined ? { productIds: (value.productIds as unknown[]).map(String) } : {}),
        ...(value.skuIds !== undefined ? { skuIds: (value.skuIds as unknown[]).map(String) } : {}),
      });
    },
    "commerce.export.package": (value) => {
      assertExpectedProject(value, context);
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "平台打包导出需要 confirmed=true。", { field: "confirmed" });
      }
      return context.exportCommercePackage({
        expectedProjectId: String(value.expectedProjectId),
        expectedCatalogRevision: value.expectedCatalogRevision as number,
        platform: value.platform as CommerceExportRequest["platform"],
        format: value.format as CommerceExportFormat,
        includeCandidates: value.includeCandidates === true,
        ...(value.productIds !== undefined ? { productIds: (value.productIds as unknown[]).map(String) } : {}),
        ...(value.skuIds !== undefined ? { skuIds: (value.skuIds as unknown[]).map(String) } : {}),
        confirmed: true,
      });
    },
    "canvas.fit": () => {
      context.fitCanvas();
      return canvasState(context);
    },
    "canvas.clear": async (value) => {
      const mode = value.mode === "failed" ? "failed" : "all";
      if (mode === "all" && value.confirmed !== true) throw new Error("清空全部画布需要 confirmed=true。");
      if (mode === "failed") {
        context.removeFailedNodes(context.nodes().filter((node) => node.imageState === "error" || node.status === "review").map((node) => node.id));
      } else await context.clearCanvas();
      return canvasState(context);
    },
    "canvas.delete-selected": (value) => {
      if (value.confirmed !== true) throw new Error("删除所选节点需要 confirmed=true。");
      if (!context.deleteSelectedNodes()) throw new Error("当前选择中没有可删除节点。");
      return canvasState(context);
    },
    "canvas.create-container": (value) => {
      const role = value.role === "source" || value.role === "reference" ? value.role : undefined;
      const id = context.createContainer(role, number(value.x, 180), number(value.y, 160));
      return { id, state: canvasState(context) };
    },
    "canvas.import": async (value) => {
      const paths = (Array.isArray(value.paths) ? value.paths : []).map(String).filter(Boolean);
      if (!paths.length) throw new Error("请提供至少一个导入路径。");
      await context.importPaths(paths, String(value.targetContainerId || ""), number(value.x, 240), number(value.y, 180));
      return canvasState(context);
    },
    "canvas.import-video": async (value) => {
      const paths = (Array.isArray(value.paths) ? value.paths : []).map(String).filter(Boolean);
      if (!paths.length) throw new Error("请提供至少一个视频导入路径。");
      await context.importVideoPaths(paths, number(value.x, 240), number(value.y, 180));
      return canvasState(context);
    },
    "canvas.generate-video": async (value) => {
      const expectedProjectId = String(value.expectedProjectId || "").trim();
      if (expectedProjectId !== context.activeProjectId()) {
        throw automationCommandError("PROJECT_REVISION_CONFLICT", "当前项目已变化，请重新读取 canvas.state 后再创建视频任务。", {
          expectedProjectId,
          activeProjectId: context.activeProjectId()
        });
      }
      if (value.confirmed !== true) throw new Error("创建视频任务需要 confirmed=true；调用后可能由上游扣费。");
      const prompt = String(value.prompt || "").trim();
      if (!prompt) throw new Error("请提供视频画面要求。");
      return context.generateVideo({
        expectedProjectId,
        prompt,
        model: String(value.model || "").trim() || undefined,
        seconds: number(value.seconds, 5),
        aspectRatio: String(value.aspectRatio || "16:9"),
        resolution: String(value.resolution || "720p"),
        x: number(value.x, 240),
        y: number(value.y, 180)
      });
    },
    "canvas.import-skill": async (value) => {
      const skill = await context.parseSkill(value.markdown, value.sourceName);
      const result = context.createSkillNode(skill, number(value.x, 240), number(value.y, 180));
      return {
        ...result,
        state: canvasState(context)
      };
    },
    "canvas.export-image": async (value) => {
      const nodeId = String(value.nodeId || "").trim();
      const node = context.nodes().find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error("目标画布节点不存在。");
      const assetIndex = Number(value.assetIndex ?? 0);
      if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex >= (node.assets?.length || 0)) {
        throw new Error("assetIndex 没有指向该节点中的有效图片。");
      }
      const format = String(value.format || "png").trim().toLowerCase() as ImageExportFormat;
      if (!imageExportFormats.has(format)) {
        throw new Error(`不支持的图片导出格式：${format}`);
      }
      const result = await context.exportImage(nodeId, assetIndex, format);
      if (!result.ok && !result.canceled) throw new Error(result.error || "图片导出失败。");
      return { nodeId, assetIndex, requestedFormat: format, result };
    },
    "research.data.import": async (value) => {
      assertExpectedProject(value, context);
      const result = await context.importScientificData({ expectedProjectId: String(value.expectedProjectId) });
      assertExpectedProject(value, context);
      return result;
    },
    "research.data.list": async (value) => {
      assertExpectedProject(value, context);
      return {
        activeProjectId: context.activeProjectId(),
        dataSources: await context.listScientificData({ expectedProjectId: String(value.expectedProjectId) }),
      };
    },
    "research.figure.plan": (value) => createScientificRequirement(value, context),
    "research.figure.render": (value) => renderScientificRequirement(value, context),
    "research.figure.status": (value) => scientificTaskStatus(value, context),
    "research.figure.export": async (value) => {
      assertExpectedProject(value, context);
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "导出科研图资产必须显式传入 confirmed=true。");
      }
      return context.exportScientificTask({
        expectedProjectId: String(value.expectedProjectId),
        taskId: String(value.taskId),
        confirmed: true,
      });
    },
    "research.figure.cancel": async (value) => {
      assertExpectedProject(value, context);
      if (value.confirmed !== true) {
        throw automationCommandError("CONFIRMATION_REQUIRED", "取消科研绘图任务必须显式传入 confirmed=true。");
      }
      const task = await context.cancelScientificTask({
        expectedProjectId: String(value.expectedProjectId),
        taskId: String(value.taskId),
      });
      return { task: publicScientificTask(task) };
    },
    "social.xiaohongshu.plan": (value) => createSocialRequirement(value, "xiaohongshu", context),
    "social.xiaohongshu.execute": (value) => executeSocialRequirement(value, "xiaohongshu", context),
    "social.xiaohongshu.export": (value) => exportSocialRequirement(value, "xiaohongshu", context),
    "social.douyin.plan": (value) => createSocialRequirement(value, "douyin", context),
    "social.douyin.execute": (value) => executeSocialRequirement(value, "douyin", context),
    "social.douyin.status": (value) => {
      const { node } = requireSocialRequirement(value, "douyin", context);
      return socialWorkflowStatus(node, context);
    },
    "social.douyin.export": (value) => exportSocialRequirement(value, "douyin", context),
    "agent.chat": async (value) => {
      const basePrompt = String(value.prompt || "").trim();
      if (!basePrompt) throw new Error("Agent 任务不能为空。");
      const prompt = promptWithImageOutputSpec(basePrompt, value);
      const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
      if (context.agentBusy()) {
        if (sourceNodeIds.length) {
          throw new Error("运行中的 agent.chat 只修改文字要求且保持当前 TaskScope；如需替换 SOURCE，请显式使用 agent.steer。");
        }
        const accepted = await context.steerAgent(prompt, {
          taskScopeMode: "keep",
          sourceMode: "keep",
          referenceMode: "keep",
          sourceNodeIds: [],
          referenceNodeIds: [],
          useComposerAttachments: false
        });
        if (!accepted) throw new Error("当前 Agent 任务没有接收 agent.chat 修改要求。");
        return { accepted: true, steered: true, state: appState(context) };
      }
      if (await context.sendPrompt(prompt, sourceNodeIds, imageOutputDefaults(value)) === false) {
        throw new Error("当前 Agent 任务没有接收 agent.chat 要求。");
      }
      return waitForAgent(context);
    },
    "agent.goal": async (value) => {
      const basePrompt = String(value.prompt || "").trim();
      if (!basePrompt) throw new Error("Goal prompt cannot be empty.");
      const prompt = promptWithImageOutputSpec(basePrompt, value);
      const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
      const operationsPerAsset = Number(value.operationsPerAsset ?? 1);
      const scopeOptions = { sourceNodeIds, operationsPerAsset, ...imageOutputDefaults(value) };
      const goal = await context.executeAuthorizedGoal(prompt, scopeOptions);
      return { ...(await waitForAgent(context)), goal };
    },
    "commerce.compose-set": async (value) => {
      const composed = await commerceSetGoal(value, context);
      const scopeOptions = {
        sourceNodeIds: composed.sourceNodeIds,
        operationsPerAsset: composed.operationsPerAsset,
      };
      const saveTarget = composed.plan.saveTarget;
      if ((saveTarget === "requirement" || saveTarget === "skill") && !context.createCommerceReusableNode) {
        throw new Error("当前 Renderer 无法创建跨境电商 Requirement/Skill 节点，命令未执行。");
      }
      const goal = await context.executeAuthorizedGoal(composed.prompt, scopeOptions);
      let reusableNode: { created: boolean; nodeId?: string; kind?: "requirement" | "skill"; error?: string } | undefined;
      if (saveTarget === "requirement" || saveTarget === "skill") {
        try {
          const node = context.createCommerceReusableNode?.({
            title: composed.plan.reusableName || composed.plan.title,
            text: composed.prompt,
            sourceNodeIds: composed.sourceNodeIds,
            kind: saveTarget,
          });
          reusableNode = node
            ? { created: true, nodeId: node.id, kind: saveTarget }
            : { created: false, kind: saveTarget, error: "Goal 已派发，但可复用节点未能创建。" };
        } catch (error) {
          reusableNode = {
            created: false,
            kind: saveTarget,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const result = await waitForAgent(context);
      return reusableNode ? { ...result, goal, reusableNode } : { ...result, goal };
    },
    "agent.steer": async (value) => {
      const prompt = String(value.prompt || "").trim();
      if (!prompt) throw new Error("运行中修改要求不能为空。");
      if (!context.agentBusy()) throw new Error("当前没有正在运行的 Agent 任务。");
      const requestedMode = String(value.taskScopeMode || "keep") as AgentSteerTaskScopeMode;
      if (!steerTaskScopeModes.has(requestedMode)) throw new Error(`不支持的 TaskScope 修改模式：${requestedMode}`);
      const sourceMode = value.sourceMode === undefined ? undefined : String(value.sourceMode) as AgentSteerTaskScopeUpdate["sourceMode"];
      const referenceMode = value.referenceMode === undefined ? undefined : String(value.referenceMode) as AgentSteerTaskScopeUpdate["referenceMode"];
      if (sourceMode && !steerSourceModes.has(sourceMode)) throw new Error(`不支持的 SOURCE 修改模式：${sourceMode}`);
      if (referenceMode && !steerReferenceModes.has(referenceMode)) throw new Error(`不支持的 REFERENCE 修改模式：${referenceMode}`);
      const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
      const referenceNodeIds = strictNodeIds(value.referenceNodeIds, "referenceNodeIds", context);
      const effectiveSourceMode = sourceMode ?? (
        requestedMode === "replace-source" ? "replace" : requestedMode === "merge-source" ? "merge" : requestedMode === "clear-attachments" ? "clear" : "keep"
      );
      const effectiveReferenceMode = referenceMode ?? (
        requestedMode === "replace-reference" ? "replace" : requestedMode === "merge-reference" ? "merge" : requestedMode === "clear-attachments" ? "clear" : "keep"
      );
      if ((effectiveSourceMode === "replace" || effectiveSourceMode === "merge") && sourceNodeIds.length === 0) {
        throw new Error(`SOURCE ${effectiveSourceMode} 需要至少一个有效 sourceNodeId；如需移除请使用 clear。`);
      }
      if ((effectiveReferenceMode === "replace" || effectiveReferenceMode === "merge") && referenceNodeIds.length === 0) {
        throw new Error(`REFERENCE ${effectiveReferenceMode} 需要至少一个有效 referenceNodeId；如需移除请使用 clear。`);
      }
      if (!await context.steerAgent(prompt, {
        taskScopeMode: requestedMode,
        sourceMode,
        referenceMode,
        sourceNodeIds,
        referenceNodeIds,
        useComposerAttachments: false
      })) throw new Error("当前 Agent 任务没有接收修改要求。");
      return { accepted: true, state: appState(context) };
    },
    "agent.pause": async () => {
      if (!context.agentBusy()) throw new Error("当前没有正在运行的 Agent 任务。");
      if (!context.agentPaused() && !await context.pauseAgent()) throw new Error("当前 Agent 任务暂停失败。");
      return { paused: true, state: { ...appState(context), agentPaused: true } };
    },
    "agent.resume": async () => {
      if (!context.agentPaused()) throw new Error("当前 Agent 任务没有暂停。");
      if (!await context.resumeAgent()) throw new Error("当前 Agent 任务恢复失败。");
      return { paused: false, state: { ...appState(context), agentPaused: false } };
    },
    "agent.stop": async () => {
      if (!context.agentBusy() && !context.agentPaused()) throw new Error("当前没有可结束的 Agent 任务。");
      if (!await context.stopAgent()) throw new Error("当前 Agent 任务的底层取消失败。");
      return appState(context);
    },
    "agent.new-conversation": () => {
      context.newConversation();
      return appState(context);
    }
  };
  if (!Object.prototype.hasOwnProperty.call(handlers, command)) throw new Error(`不支持的 SparkAI WorkSpace 自动化命令：${command}`);
  return handlers[command as AutomationRendererCommandName](validateCommandArgs(command, args));
}
