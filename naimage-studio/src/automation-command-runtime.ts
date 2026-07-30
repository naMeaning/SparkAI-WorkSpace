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
  ImportedCanvasSkill,
  WorkflowNode,
} from "./core";
import { imageContainerSpecForNode } from "./image-container-spec.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";
import { flattenImageContainerBindings } from "./image-container-graph.ts";
import { commerceSetRequestCounts, normalizeCommerceSetPlan } from "./plugins/commerce-set.ts";
import { requirementInputBindings } from "./requirement-graph.ts";
import { stableRequirementInputSignature } from "./requirement-signature.ts";

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
type AutomationGoalPreview = {
  requiresConfirmation: boolean;
  snapshot: unknown;
  counts: unknown;
};
type AutomationGoalScopeOptions = {
  sourceNodeIds: string[];
  operationsPerAsset: number;
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

export type AutomationCommandContext = {
  activeProjectId(): string;
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
  createProject(name: string): Promise<unknown>;
  renameProject(name: string): Promise<unknown>;
  selectNodes(ids: string[], primaryId: string): void;
  fitCanvas(): void;
  removeFailedNodes(ids: string[]): void;
  clearCanvas(): Promise<unknown>;
  deleteSelectedNodes(): boolean;
  createContainer(role: "source" | "reference" | undefined, x: number, y: number): string;
  importPaths(paths: string[], targetContainerId: string, x: number, y: number): Promise<unknown>;
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
  sendPrompt(prompt: string, sourceNodeIds: string[]): Promise<boolean | void>;
  steerAgent(prompt: string, options?: {
    taskScopeMode?: AgentSteerTaskScopeMode;
    sourceMode?: AgentSteerTaskScopeUpdate["sourceMode"];
    referenceMode?: AgentSteerTaskScopeUpdate["referenceMode"];
    sourceNodeIds?: string[];
    referenceNodeIds?: string[];
    useComposerAttachments?: boolean;
  }): Promise<boolean>;
  previewGoal(prompt: string, options?: AutomationGoalScopeOptions): Promise<AutomationGoalPreview>;
  executeGoal(
    prompt: string,
    expectedSnapshotHash: string,
    issuerId?: "automation",
    options?: AutomationGoalScopeOptions
  ): Promise<unknown>;
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

function jsonDeepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  const confirmationArgs = jsonDeepClone({
    sourceNodeIds: value.sourceNodeIds,
    plan: rawPlan,
  });
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
    confirmationArgs,
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
      const generationBusy = node.status === "working" || node.imageState === "generating" || Boolean(node.generationRunId);
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
  throw new Error("等待 naimage Agent 完成超时。");
}

type Handler = (args: JsonObject) => unknown | Promise<unknown>;

export async function executeAutomationCommand(command: string, args: JsonObject, context: AutomationCommandContext) {
  const handlers: Record<AutomationRendererCommandName, Handler> = {
    "app.state": () => appState(context),
    "canvas.state": () => canvasState(context),
    "project.list": () => ({ activeProjectId: context.activeProjectId(), projects: context.projects() }),
    "project.switch": async (value) => {
      const id = String(value.id || "");
      if (!context.projects().some((project) => project.id === id)) throw new Error("目标项目不存在。");
      await context.switchProject(id);
      return appState(context);
    },
    "project.create": async (value) => {
      await context.createProject(String(value.name || "").trim());
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
    "agent.chat": async (value) => {
      const prompt = String(value.prompt || "").trim();
      if (!prompt) throw new Error("Agent 任务不能为空。");
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
      if (await context.sendPrompt(prompt, sourceNodeIds) === false) {
        throw new Error("当前 Agent 任务没有接收 agent.chat 要求。");
      }
      return waitForAgent(context);
    },
    "agent.goal": async (value) => {
      const prompt = String(value.prompt || "").trim();
      if (!prompt) throw new Error("Goal prompt cannot be empty.");
      const sourceNodeIds = strictNodeIds(value.sourceNodeIds, "sourceNodeIds", context);
      const operationsPerAsset = Number(value.operationsPerAsset ?? 1);
      const scopeOptions = { sourceNodeIds, operationsPerAsset };
      if (value.confirmed !== true) {
        const preview = await context.previewGoal(prompt, scopeOptions);
        return { ...preview, requiresConfirmation: true };
      }
      const expectedSnapshotHash = String(value.expectedSnapshotHash || "").trim();
      if (!expectedSnapshotHash) throw new Error("agent.goal with confirmed=true requires expectedSnapshotHash from the latest preview.");
      await context.executeGoal(prompt, expectedSnapshotHash, "automation", scopeOptions);
      return waitForAgent(context);
    },
    "commerce.compose-set": async (value) => {
      const composed = await commerceSetGoal(value, context);
      const scopeOptions = {
        sourceNodeIds: composed.sourceNodeIds,
        operationsPerAsset: composed.operationsPerAsset,
      };
      if (value.confirmed !== true) {
        const preview = await context.previewGoal(composed.prompt, scopeOptions);
        return {
          ...preview,
          requiresConfirmation: true,
          confirmationArgs: composed.confirmationArgs,
          composition: {
            plan: composed.plan,
            normalizedPlan: composed.plan,
            counts: composed.counts,
            planHash: composed.planHash,
            sourceNodeIds: composed.sourceNodeIds,
            operationsPerAsset: composed.operationsPerAsset,
          },
        };
      }
      const expectedSnapshotHash = String(value.expectedSnapshotHash || "").trim();
      if (!expectedSnapshotHash) {
        throw new Error("commerce.compose-set with confirmed=true requires expectedSnapshotHash from its latest preview.");
      }
      const saveTarget = composed.plan.saveTarget;
      if ((saveTarget === "requirement" || saveTarget === "skill") && !context.createCommerceReusableNode) {
        throw new Error("当前 Renderer 无法创建跨境电商 Requirement/Skill 节点，命令未执行。");
      }
      await context.executeGoal(composed.prompt, expectedSnapshotHash, "automation", scopeOptions);
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
      return reusableNode ? { ...result, reusableNode } : result;
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
  if (!Object.prototype.hasOwnProperty.call(handlers, command)) throw new Error(`不支持的 naimage 自动化命令：${command}`);
  return handlers[command as AutomationRendererCommandName](validateCommandArgs(command, args));
}
