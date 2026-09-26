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
