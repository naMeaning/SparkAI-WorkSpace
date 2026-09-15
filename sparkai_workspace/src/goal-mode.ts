import type { ImageAsset, TaskAssetReference, WorkflowNode } from "./core.ts";
import { stableIdentityHash } from "./asset-identity.ts";
import {
  buildGoalTaskScopeFromNodes,
  type GoalTaskAssetProjectionInput,
  type GoalTaskScopeExcludedReason,
  withGoalCommerceCatalogTargets,
} from "./goal-task-scope.ts";
import {
  commerceCatalogGoalTargetsForSources,
  type CommerceCatalogDocument,
} from "./commerce-catalog.ts";
import {
  COMMERCE_SET_MARKER,
  parseCommerceSetPromptPlan
} from "./plugins/commerce-set.ts";

export type GoalModePreview = {
  prompt: string;
  /** Minimal TaskScope identity used to detect source drift before dispatch. */
  snapshotHash: string;
  /** Random, one-time bearer populated only after the ledger issues it. */
  confirmationHash: string;
  taskScope: import("./core.ts").AgentTaskScope;
  containerCount: number;
  assetCount: number;
  /** Maximum provider image requests represented by this frozen plan. */
  requestCount: number;
  operationsPerAsset: number;
  /** Explicit Renderer-selected source boundaries; absent means all eligible canvas containers. */
  targetNodeIds?: string[];
  skipped: string[];
  probeContainerCount: number;
  concurrencyCap: number;
};

export type GoalConfirmationContext = {
  projectId: string;
  conversationId: string;
  /** Separates GUI, automation, and detached-window bearers. */
  issuerId?: string;
};

export type GoalConfirmationReceipt = Required<GoalConfirmationContext> & {
  confirmationHash: string;
  prompt: string;
  taskScopeSnapshotHash: string;
  authorizationFingerprint: string;
  issuedAt: number;
  expiresAt: number;
};

export type GoalConfirmationLedger = {
  issue(preview: GoalModePreview, context: GoalConfirmationContext): string;
  /** Atomically burns the bearer before live-scope, busy, and dispatch checks. */
  take(prompt: unknown, expectedConfirmationHash: string, context: GoalConfirmationContext): GoalConfirmationReceipt;
  consume(preview: GoalModePreview, expectedConfirmationHash: string, context: GoalConfirmationContext): GoalConfirmationReceipt;
  isActive(confirmationHash: string, context: GoalConfirmationContext): boolean;
  invalidate(confirmationHash: string): void;
  clear(): void;
  size(): number;
};

export type GoalModePreviewInput = {
  prompt: string;
  nodes: WorkflowNode[];
  canvasRevision: number;
  configuredConcurrency: number;
  /** Optional explicit image/container boundaries. Omit for the canvas-wide Goal. */
  targetNodeIds?: string[];
  /** Commerce and other matrix plans may request more than one output per SOURCE. */
  operationsPerAsset?: number;
  /** Current project Catalog snapshot; used only to freeze unambiguous Commerce destinations. */
  commerceCatalog?: CommerceCatalogDocument;
  projectAsset?: (input: GoalTaskAssetProjectionInput) => Partial<TaskAssetReference>;
};

const excludedReasonLabel: Record<GoalTaskScopeExcludedReason, string> = {
  "reference-only": "仅包含参考图",
  empty: "空容器",
  generating: "仍在生成"
};

const goalConfirmationHashPattern = /^goal-[a-f0-9]{32}$/;
export const GOAL_CONFIRMATION_TTL_MS = 10 * 60_000;

export function normalizeGoalModePrompt(value: unknown): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

/** Internal deterministic binding. This is deliberately not an executable bearer. */
export function goalModeAuthorizationFingerprint(preview: GoalModePreview): string {
  const material = {
    version: 2,
    prompt: normalizeGoalModePrompt(preview.prompt),
    taskScopeSnapshotHash: String(preview.snapshotHash || "").trim().toLowerCase(),
    containerCount: preview.containerCount,
    assetCount: preview.assetCount,
    requestCount: preview.requestCount,
    operationsPerAsset: preview.operationsPerAsset,
    targetNodeIds: preview.targetNodeIds ?? null,
    probeContainerCount: preview.probeContainerCount,
    concurrencyCap: preview.concurrencyCap
  };
  return `goal-binding-${stableIdentityHash(`goal-confirmation:v2:${JSON.stringify(material)}`)}`;
}

function createRandomGoalConfirmationHash() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("当前运行环境无法安全签发 Goal 确认值。");
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return `goal-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createGoalConfirmationLedger(
  maxEntries = 32,
  options: { ttlMs?: number; now?: () => number; tokenFactory?: () => string } = {}
): GoalConfirmationLedger {
  const grants = new Map<string, GoalConfirmationReceipt>();
  const issuedHashes = new Set<string>();
  const limit = Math.max(1, Math.min(256, Math.floor(Number(maxEntries) || 32)));
  const ttlMs = Math.max(1, Math.min(60 * 60_000, Math.floor(Number(options.ttlMs) || GOAL_CONFIRMATION_TTL_MS)));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const tokenFactory = typeof options.tokenFactory === "function" ? options.tokenFactory : createRandomGoalConfirmationHash;
  const normalizedContext = (context: GoalConfirmationContext): Required<GoalConfirmationContext> => {
    const projectId = String(context?.projectId || "").trim();
    const conversationId = String(context?.conversationId || "").trim();
    if (!projectId) throw new Error("Goal 授权必须绑定当前项目。");
    if (!conversationId) throw new Error("Goal 授权必须绑定当前对话。");
    return {
      projectId,
      conversationId,
      issuerId: String(context?.issuerId || "").trim() || "renderer"
    };
  };
  const sameContext = (grant: GoalConfirmationReceipt, context: Required<GoalConfirmationContext>) => (
    grant.projectId === context.projectId &&
    grant.conversationId === context.conversationId &&
    grant.issuerId === context.issuerId
  );
  const purgeExpired = () => {
    const currentTime = now();
    for (const [confirmationHash, grant] of grants) {
      if (grant.expiresAt <= currentTime) grants.delete(confirmationHash);
    }
  };
  const revokeMatchingAttempt = (context: Required<GoalConfirmationContext>, prompt: string) => {
    for (const [confirmationHash, grant] of grants) {
      if (sameContext(grant, context) && grant.prompt === prompt) grants.delete(confirmationHash);
    }
  };
  const take = (promptValue: unknown, expectedConfirmationHash: string, context: GoalConfirmationContext) => {
    purgeExpired();
    const confirmationHash = String(expectedConfirmationHash || "").trim().toLowerCase();
    const grant = grants.get(confirmationHash);
    // Delete first. Changed prompt/context, expiry, and every later failure all
    // consume this execution attempt and require a fresh preview.
    if (confirmationHash) grants.delete(confirmationHash);
    const currentContext = normalizedContext(context);
    const prompt = normalizeGoalModePrompt(promptValue);
    if (!grant) revokeMatchingAttempt(currentContext, prompt);
    if (
      !goalConfirmationHashPattern.test(confirmationHash) || !grant || grant.prompt !== prompt ||
      !sameContext(grant, currentContext) || grant.expiresAt <= now()
    ) {
      throw new Error("Goal 确认已失效、过期、已使用或与当前 prompt/项目/会话/入口不一致；请重新预览并再次确认。");
    }
    return { ...grant };
  };
  return {
    issue(preview, context) {
      purgeExpired();
      const currentContext = normalizedContext(context);
      const prompt = normalizeGoalModePrompt(preview.prompt);
      if (!prompt || !String(preview.snapshotHash || "").startsWith("scope-")) {
        throw new Error("Goal 预览缺少有效要求或可执行来源，必须重新预览。");
      }
      // Each issuer has one current bearer. Re-previewing revokes that surface's
      // older token without touching another surface or Renderer.
      for (const [confirmationHash, grant] of grants) {
        if (sameContext(grant, currentContext)) grants.delete(confirmationHash);
      }
      let confirmationHash = "";
      for (let attempt = 0; attempt < 8 && !confirmationHash; attempt += 1) {
        const candidate = String(tokenFactory() || "").trim().toLowerCase();
        if (!goalConfirmationHashPattern.test(candidate)) throw new Error("Goal 确认值生成器返回了无效格式。");
        if (!issuedHashes.has(candidate)) confirmationHash = candidate;
      }
      if (!confirmationHash) throw new Error("Goal 确认值发生冲突，请重新预览。");
      issuedHashes.add(confirmationHash);
      const issuedAt = now();
      grants.set(confirmationHash, {
        ...currentContext,
        confirmationHash,
        prompt,
        taskScopeSnapshotHash: preview.snapshotHash,
        authorizationFingerprint: goalModeAuthorizationFingerprint(preview),
        issuedAt,
        expiresAt: issuedAt + ttlMs
      });
      while (grants.size > limit) grants.delete(grants.keys().next().value as string);
      return confirmationHash;
    },
    take,
    consume(preview, expectedConfirmationHash, context) {
      const grant = take(preview.prompt, expectedConfirmationHash, context);
      if (
        grant.taskScopeSnapshotHash !== preview.snapshotHash ||
        grant.authorizationFingerprint !== goalModeAuthorizationFingerprint(preview)
      ) {
        throw new Error("Goal 的来源范围或执行计划已变化；请重新预览并再次确认。");
      }
      return grant;
    },
    isActive(confirmationHash, context) {
      purgeExpired();
      const normalizedHash = String(confirmationHash || "").trim().toLowerCase();
      const grant = grants.get(normalizedHash);
      return Boolean(grant && sameContext(grant, normalizedContext(context)) && grant.expiresAt > now());
    },
    invalidate(confirmationHash) {
      grants.delete(String(confirmationHash || "").trim().toLowerCase());
    },
    clear() {
      grants.clear();
    },
    size() {
      purgeExpired();
      return grants.size;
    }
  };
}

export function createGoalModePreview(input: GoalModePreviewInput): GoalModePreview {
  const prompt = normalizeGoalModePrompt(input.prompt);
  if (!prompt) throw new Error("Goal 任务不能为空。");
  const hasCommerceMarker = prompt.includes(COMMERCE_SET_MARKER);
  const commercePlan = hasCommerceMarker ? parseCommerceSetPromptPlan(prompt) : null;
  if (hasCommerceMarker && !commercePlan) {
    throw new Error("跨境电商 Goal 的结构化计划已损坏，无法确认可靠的执行矩阵。请重新创建计划。");
  }
  const requestedOperationsPerAsset = input.operationsPerAsset ?? commercePlan?.outputsPerSource ?? 1;
  const operationsPerAsset = Number(requestedOperationsPerAsset);
  if (!Number.isSafeInteger(operationsPerAsset) || operationsPerAsset < 1 || operationsPerAsset > 200) {
    throw new Error("Goal 每张母图的操作数必须是 1-200 的整数。");
  }
  if (commercePlan && operationsPerAsset !== commercePlan.outputsPerSource) {
    throw new Error(`跨境电商计划要求每张母图 ${commercePlan.outputsPerSource} 个输出，当前执行矩阵为 ${operationsPerAsset} 个；请重新预览。`);
  }
  const configuredConcurrency = Math.max(1, Math.min(10, Math.floor(Number(input.configuredConcurrency) || 1)));
  const built = buildGoalTaskScopeFromNodes(input.nodes, {
    canvasRevision: input.canvasRevision,
    configuredConcurrency,
    probeContainerCount: Math.min(2, configuredConcurrency),
    confirmationPolicy: "direct",
    targetNodeIds: input.targetNodeIds,
    operationsPerAsset,
    commercePlanHash: commercePlan?.planHash,
    projectAsset: input.projectAsset
  });
  if (!built.ok) {
    throw new Error(built.preflight.issues[0]?.message || "当前画布没有可执行的图片容器。");
  }
  const { preflight } = built;
  const catalogTargets = commercePlan && input.commerceCatalog
    ? commerceCatalogGoalTargetsForSources(input.commerceCatalog, built.scope.sourceAssets)
    : [];
  const scope = catalogTargets.length
    ? withGoalCommerceCatalogTargets(built.scope, catalogTargets)
    : built.scope;
  const requestCount = scope.goal?.requestCount ?? 0;
  if (commercePlan) {
    const targetNodeIds = [...new Set((input.targetNodeIds ?? []).map(String).filter(Boolean))];
    if (
      commercePlan.sourceCount !== preflight.eligibleBindingCount ||
      commercePlan.totalRequests !== requestCount ||
      (commercePlan.sourceNodeIds.length > 0 && (
        commercePlan.sourceNodeIds.length !== targetNodeIds.length ||
        commercePlan.sourceNodeIds.some((nodeId, index) => nodeId !== targetNodeIds[index])
      ))
    ) {
      throw new Error("跨境电商计划中的母图范围或请求总数与当前画布不一致；请重新选择母图并创建计划。");
    }
  }
  return {
    prompt,
    snapshotHash: scope.snapshotHash,
    confirmationHash: "",
    taskScope: scope,
    containerCount: preflight.eligibleContainerCount,
    assetCount: preflight.eligibleBindingCount,
    requestCount,
    operationsPerAsset,
    ...(input.targetNodeIds?.length ? { targetNodeIds: [...new Set(input.targetNodeIds.map(String).filter(Boolean))] } : {}),
    skipped: preflight.excludedContainers.map((item) => `${item.containerId}：${excludedReasonLabel[item.reason]}`),
    probeContainerCount: preflight.probeContainerCount,
    concurrencyCap: preflight.configuredConcurrency
  };
}

export function publicGoalModePreview(preview: GoalModePreview) {
  if (!goalConfirmationHashPattern.test(String(preview.confirmationHash || "").trim().toLowerCase())) {
    throw new Error("Goal 预览尚未签发一次性确认值。");
  }
  return {
    requiresConfirmation: true,
    snapshot: {
      snapshotHash: preview.confirmationHash,
      taskScopeSnapshotHash: preview.snapshotHash,
      canvasRevision: preview.taskScope.canvasRevision,
      imageContainerIds: [...(preview.taskScope.goal?.containerIds || [])],
      bindingIds: [...(preview.taskScope.goal?.bindingIds || [])]
    },
    counts: {
      imageContainers: preview.containerCount,
      assets: preview.assetCount,
      requests: preview.requestCount,
      skippedContainers: preview.skipped.length
    },
    snapshotHash: preview.confirmationHash,
    taskScopeSnapshotHash: preview.snapshotHash,
    containerCount: preview.containerCount,
    assetCount: preview.assetCount,
    requestCount: preview.requestCount,
    operationsPerAsset: preview.operationsPerAsset,
    targetNodeIds: preview.targetNodeIds ? [...preview.targetNodeIds] : undefined,
    skipped: [...preview.skipped],
    probeContainerCount: preview.probeContainerCount,
    concurrencyCap: preview.concurrencyCap,
    warning: "本次确认只绑定当前要求和来源范围，有效期十分钟且只能使用一次；不预估费用，完成后仅记录上游实际返回的用量。"
  };
}

export function goalProjectAssetMetadata({ asset }: { asset: ImageAsset }) {
  return {
    mimeType: String(asset.path || asset.relativePath || "").toLowerCase().endsWith(".jpg") || String(asset.path || asset.relativePath || "").toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : String(asset.path || asset.relativePath || "").toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/png"
  };
}
