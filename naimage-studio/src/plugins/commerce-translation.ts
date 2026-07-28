export type CommerceLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
};

export const COMMERCE_LANGUAGES: CommerceLanguage[] = [
  { code: "en-US", label: "英语（美国）", nativeLabel: "English (US)" },
  { code: "en-GB", label: "英语（英国）", nativeLabel: "English (UK)" },
  { code: "de-DE", label: "德语", nativeLabel: "Deutsch" },
  { code: "fr-FR", label: "法语", nativeLabel: "Français" },
  { code: "es-ES", label: "西班牙语", nativeLabel: "Español" },
  { code: "it-IT", label: "意大利语", nativeLabel: "Italiano" },
  { code: "pt-BR", label: "葡萄牙语（巴西）", nativeLabel: "Português (Brasil)" },
  { code: "ja-JP", label: "日语", nativeLabel: "日本語" },
  { code: "ko-KR", label: "韩语", nativeLabel: "한국어" },
  { code: "ar-SA", label: "阿拉伯语", nativeLabel: "العربية" },
  { code: "ru-RU", label: "俄语", nativeLabel: "Русский" },
  { code: "th-TH", label: "泰语", nativeLabel: "ไทย" },
  { code: "vi-VN", label: "越南语", nativeLabel: "Tiếng Việt" },
  { code: "id-ID", label: "印度尼西亚语", nativeLabel: "Bahasa Indonesia" }
];

export const DEFAULT_COMMERCE_LANGUAGE_CODES = ["en-US", "de-DE", "fr-FR", "es-ES", "ja-JP"];
export const MAX_COMMERCE_TARGET_LANGUAGES = 10;

export function normalizeCommerceLanguageCodes(value: unknown): string[] {
  const supported = new Set(COMMERCE_LANGUAGES.map((language) => language.code));
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((code) => supported.has(code)))].slice(0, MAX_COMMERCE_TARGET_LANGUAGES);
}

export function commerceTranslationPrompt(languageCodes: unknown, sourceCount: number) {
  const normalized = normalizeCommerceLanguageCodes(languageCodes);
  if (!normalized.length) throw new Error("请至少选择一种目标语言。");
  const languages = normalized.map((code) => COMMERCE_LANGUAGES.find((language) => language.code === code)!);
  const languageLines = languages.map((language, index) => `${index + 1}. ${language.label} / ${language.nativeLabel}（${language.code}）`).join("\n");
  return [
    "执行跨境电商商品套图多语言本地化。当前选中的图片成果是本轮唯一 SOURCE，不要使用会话中的其他旧图片。",
    `SOURCE 范围：${Math.max(1, Math.floor(Number(sourceCount) || 1))} 个已选图片成果或图片容器。`,
    "目标语言：",
    languageLines,
    "执行规则：",
    "- 先逐张识别 SOURCE 中真实可见的标题、卖点、规格、按钮和说明文字；品牌名、商标、型号、SKU、尺寸、数字、单位和法律标识默认保持原文，除非语义明确要求本地化。",
    "- 翻译必须自然、简洁，符合目标市场电商表达；禁止添加原图不存在的功效、认证、折扣、承诺或商品卖点。",
    "- 只替换文字及为容纳译文所必需的字号、字距、换行和局部文本框宽度；保持商品身份、轮廓、颜色、材质、背景、构图、画幅、Logo 位置和整体设计不变。",
    "- 每种语言单独调用一次 image_gen；同一语言的全部成果归入该语言自己的批量结果组，组标题和每张结果提示词明确写出语言名称。不同语言不得混在同一个结果组。",
    "- 每个 SOURCE 在每种语言下生成一张对应成果；有 SOURCE 时使用 edit 或 replace，禁止用 generate 重画商品。总并发仍遵守 naimage 最多 10 路限制。",
    "- 阿拉伯语使用正确的从右到左排版；其他语言遵守当地标点、大小写和换行习惯。",
    "- 完成后按语言列出成功与失败数量；没有识别到文字的 SOURCE 不要伪造译文，应保留原图并说明。",
    "用户已经在本对话框明确勾选目标语言并授权直接批量执行，不需要再次询问语言或是否开始。"
  ].join("\n");
}
