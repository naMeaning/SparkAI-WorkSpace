import type { RecipeStudioOptions } from "./core";

export const DEFAULT_SCENE_BRIEF = "干净高级的跨境电商美妆商品图，柔和棚拍光，真实材质，保留包装文字、品牌标识和产品比例。";

export type StudioOutputSlot = {
  slotId: string;
  label: string;
  dataType?: string;
  defaultDirection?: string;
};

export function initialStudioOptions(outputs: StudioOutputSlot[] = []): RecipeStudioOptions {
  return {
    sceneBrief: DEFAULT_SCENE_BRIEF,
    language: "zh-CN",
    slotDirections: Object.fromEntries(outputs.map((slot) => [
      slot.slotId,
      slot.defaultDirection || `${slot.label}，保持商品外观与包装识别一致。`,
    ])),
    ratio: "1:1",
    resolution: "1K",
    quality: "high",
  };
}

export function validateStudioOptions(options: RecipeStudioOptions, outputCount: number) {
  if (!options.sceneBrief.trim()) return "请填写场景文案。";
  if (options.sceneBrief.length > 1200) return "场景文案不能超过 1200 字。";
  if (!outputCount) return "Recipe 没有可运行的输出槽。";
  if (outputCount > 6) return "本批 Studio 最多支持六个输出槽。";
  for (const [slotId, direction] of Object.entries(options.slotDirections)) {
    if (!slotId || !direction.trim()) return "每个输出槽都需要画面方向。";
    if (direction.length > 320) return "单个输出槽方向不能超过 320 字。";
  }
  return "";
}

export function shortHash(value: string, head = 10) {
  const normalized = String(value || "").replace(/^sha256:/, "");
  return normalized ? normalized.slice(0, head) : "—";
}

export function shortRunId(runId: string) {
  return String(runId || "").replace(/^run\./, "").slice(0, 8) || "—";
}
