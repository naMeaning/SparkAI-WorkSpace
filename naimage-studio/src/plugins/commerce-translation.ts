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
