import type { ModelAccessProfile, ModelConnectionSummary, ModelProvider } from "./core";

export function isExplicitImageModelId(value: string): boolean {
  const clean = String(value || "").trim();
  if (!clean) return false;
  return /(?:^|[\/:._+-])(?:image|images|imagen|flux|dall(?:[._+-]?e)?|midjourney|mj|stable[._+-]?diffusion|sdxl|sd3|recraft|ideogram|seedream|cogview|kolors|hidream|nano[._+-]?banana|grok[._+-]?imagine|wanx|wanxiang|jimeng)(?=$|[\/:._+-]|\d)/i.test(clean);
}

export function isExplicitVideoModelId(value: string): boolean {
  const clean = String(value || "").trim();
  if (!clean) return false;
  return /(?:^|[\/:._+-])(?:video|seedance|sora|veo|kling|runway|pixverse|hailuo|wan[._+-]?video|luma[._+-]?dream|pika)(?=$|[\/:._+-]|\d)/i.test(clean);
}

export function isExplicitChatModelId(value: string): boolean {
  const clean = String(value || "").trim();
  if (!clean || isExplicitImageModelId(clean) || isExplicitVideoModelId(clean)) return false;
  return /(?:^|[\/:._+-])(?:gpt|chatgpt|claude|gemini|grok|xai|deepseek|qwen|qwq|glm|llama|meta[._+-]?llama|mistral|mixtral|gemma|moonshot|kimi|ernie|baichuan|command[._+-]?r|cohere|doubao|hunyuan|minimax|codex|o[134])(?=$|[\/:._+-]|\d)/i.test(clean);
}

function uniqueModelIds(models: Array<string | null | undefined> = []): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const model of models) {
    const clean = String(model || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

export function filterImagePickerModels(models: Array<string | null | undefined> = []): string[] {
  return uniqueModelIds(models).filter((model) => !isExplicitVideoModelId(model) && !isExplicitChatModelId(model));
}

export function filterAgentPickerModels(models: Array<string | null | undefined> = []): string[] {
  return uniqueModelIds(models).filter((model) => !isExplicitImageModelId(model) && !isExplicitVideoModelId(model));
}

const modelEvidencePriority = {
  "name-inferred": 1,
  "upstream-declared": 2,
  "runtime-verified": 3,
} as const;

export function modelAccessSummary(accessProfiles: ModelAccessProfile[], kind: ModelProvider, model: string, active?: ModelConnectionSummary) {
  const key = model.toLowerCase();
  const candidates = accessProfiles.flatMap((profile) => {
    if (!profile.providers.includes(kind)) return [];
    if (active && (!active.connectionId || active.connectionId !== profile.id)) return [];
    const capability = profile.capabilities[key];
    if (!capability) return [];
    const observations = (capability.observations || []).filter(item => !active || item.protocol === active.protocol && item.transport === active.transport);
    const latestObservation = [...observations]
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
    const evidence = observations.some(item => item.outcome === "success") ? capability.evidence
      : capability.evidence === "runtime-verified" ? "name-inferred" : capability.evidence;
    return {
      profile,
      capability,
      latestObservation,
      evidence,
      observationAt: Date.parse(latestObservation?.observedAt || "") || 0,
    };
  }).sort((left, right) => {
    const observationDelta = right.observationAt - left.observationAt;
    if (observationDelta) return observationDelta;
    const evidenceDelta = modelEvidencePriority[right.evidence] - modelEvidencePriority[left.evidence];
    if (evidenceDelta) return evidenceDelta;
    const rightTime = Date.parse(right.capability.lastVerifiedAt || right.capability.lastCheckedAt || "") || 0;
    const leftTime = Date.parse(left.capability.lastVerifiedAt || left.capability.lastCheckedAt || "") || 0;
    return rightTime - leftTime;
  });
  const selected = candidates[0];
  if (!selected) return active ? { status: "当前配置待验证", observedAt: "", sourceLabel: "当前连接", baseUrl: "", detail: "未找到同连接、协议与结果方式的运行证据", operationSummary: "文生图待验证 · 编辑待验证" } : null;
  const { profile, capability, latestObservation } = selected;
  const latestFailure = latestObservation?.outcome === "failure";
  const status = latestFailure
    ? latestObservation.stage === "asset-delivery" ? "最近成果保存失败"
      : `最近${latestObservation.operation === "edit" ? "编辑" : latestObservation.operation === "generate" ? "文生图" : "请求"}失败`
    : selected.evidence === "runtime-verified"
      ? latestObservation?.operation === "generate" ? "文生图曾成功"
        : latestObservation?.operation === "edit" ? "图片编辑曾成功" : "真实验证"
      : selected.evidence === "upstream-declared" ? "上游声明 · 当前操作待验证" : "当前操作待验证";
  const observedAt = latestFailure ? latestObservation.observedAt
    : selected.evidence === "runtime-verified" ? latestObservation?.observedAt || capability.lastVerifiedAt || ""
      : capability.lastCheckedAt || "";
  const scope = Object.entries(latestObservation?.scope || {})
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
  const detail = latestObservation
    ? `${latestObservation.protocol} / ${latestObservation.transport} / ${latestObservation.operation} / ${latestObservation.stage}${latestObservation.category ? ` / ${latestObservation.category}` : ""}${scope ? ` / ${scope}` : ""}`
    : "";
  const operationStatus = (operation: string, label: string) => {
    const observation = [...(capability.observations || [])].filter(item => item.operation === operation
      && (!active || item.protocol === active.protocol && item.transport === active.transport))
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return observation ? `${label}${observation.outcome === "failure" ? observation.stage === "asset-delivery" ? "保存失败" : "最近失败" : "曾成功"}` : `${label}待验证`;
  };
  return {
    status,
    observedAt,
    sourceLabel: profile.label,
    baseUrl: profile.baseUrl,
    detail,
    operationSummary: [profile.catalogReadAt ? "目录可读" : "目录待验证", operationStatus("generate", "文生图"), operationStatus("edit", "编辑")].join(" · "),
  };
}

export type IdleComposerPrimaryAction = "generate" | "send";

export function idleComposerPrimaryAction(input: {
  executionBusy?: boolean;
  goalSelected?: boolean;
  canGenerate?: boolean;
} = {}): IdleComposerPrimaryAction {
  // Agent submission is the stable keyboard action. Direct image generation is
  // still available as an explicit button, but must not intercept Enter/Ctrl+Enter
  // when the composer also has a regenerate callback.
  return "send";
}

export function runCompletedImageGen(
  progress: Array<{ tool?: string; phase?: string } | null | undefined> = []
): boolean {
  return progress.some((item) => {
    const tool = String(item?.tool || "");
    const phase = String(item?.phase || "");
    return (tool === "image_gen" || phase.startsWith("image-")) && (
      phase === "tool-done" ||
      phase === "image-response" ||
      phase === "image-result"
    );
  });
}

export function runHasIncompleteModelReply(progress: Array<{ runId?: string; phase?: string }> = []): boolean {
  const runId = progress[progress.length - 1]?.runId;
  return progress.some((item) => item.phase === "runtime-partial" && item.runId === runId);
}

function cleanFailureDetail(errorMessage: string): string {
  return String(errorMessage || "")
    .replace(/^\s*(?:Agent 调用失败|Agent 失败|对话模型调用失败|对话模型暂时不可用)\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "上游对话服务不可用";
}

export function agentRunFailureCopy(input: {
  imageGenCompleted?: boolean;
  errorMessage?: string;
} = {}): { statusLine: string; message: string } {
  const detail = cleanFailureDetail(String(input.errorMessage || ""));
  if (input.imageGenCompleted) {
    return {
      statusLine: "图片已生成。",
      message: `图片已生成。对话模型暂时不可用：${detail}`
    };
  }
  return {
    statusLine: "对话模型调用失败。",
    message: `对话模型调用失败：${detail}`
  };
}

export function agentFailureMessageToAppend(input: {
  imageGenCompleted?: boolean;
  errorMessage?: string;
  existingContents?: string[];
} = {}): string {
  const copy = agentRunFailureCopy(input);
  const existing = new Set(
    (input.existingContents || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  if (existing.has(copy.message)) return "";
  if (input.imageGenCompleted) {
    const detail = `对话模型暂时不可用：${cleanFailureDetail(String(input.errorMessage || ""))}`;
    if (existing.has(detail)) return "";
    if (existing.has(copy.statusLine) || existing.has("图片已生成")) return detail;
    return copy.message;
  }
  if (
    existing.has(copy.statusLine) ||
    existing.has("Agent 失败") ||
    existing.has(`Agent 调用失败：${cleanFailureDetail(String(input.errorMessage || ""))}`)
  ) {
    return "";
  }
  return copy.message;
}

export function agentFailureVisibleLines(input: {
  imageGenCompleted?: boolean;
  errorMessage?: string;
} = {}): string[] {
  const copy = agentRunFailureCopy(input);
  const timeline = copy.statusLine;
  const appended = agentFailureMessageToAppend({
    ...input,
    existingContents: [timeline]
  });
  return appended ? [timeline, appended] : [timeline];
}
