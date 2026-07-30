// Compatibility surface for the original translation-only plugin UI. The
// canonical language catalog and limits now live in the shared commerce-set
// schema so Electron CJS and Renderer TypeScript consume the same contract.
export {
  COMMERCE_LANGUAGES,
  DEFAULT_COMMERCE_LANGUAGE_CODES,
  MAX_COMMERCE_TARGET_LANGUAGES,
  normalizeCommerceLanguageCodes
} from "./commerce-set.ts";

export type { CommerceLanguage } from "./commerce-set.ts";
