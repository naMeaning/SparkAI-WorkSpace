import commerceSetSchema from "../../plugins/commerce-set-schema.json" with { type: "json" };

export type CommerceSetMode = "generate" | "translate";
export type CommerceSetSaveTarget = "none" | "requirement" | "skill";
export type CommerceSetFeeRisk = "none" | "low" | "medium" | "high" | "blocked";

export type CommerceLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  direction: "ltr" | "rtl";
  prompt: string;
};

export type CommerceSetSlot = {
  id: string;
  title: string;
  prompt: string;
};

export type CommerceSetTargetLocale = {
  code: string;
  prompt: string;
};

export type CommerceSetExecutionPolicy = {
  probeFirst: true;
  probeSourceCount: number;
  rampConcurrency: number[];
  maxConcurrency: number;
};

export type CommerceSetPlan = {
  schemaVersion: number;
  mode: CommerceSetMode;
  title: string;
  slots: CommerceSetSlot[];
  targetLocales: CommerceSetTargetLocale[];
  translatePrompt: string;
  saveTarget: CommerceSetSaveTarget;
  reusableName: string;
  executionPolicy: CommerceSetExecutionPolicy;
};

export type CommerceSetRequestCounts = {
  sourceCount: number;
  slotCount: number;
  languageCount: number;
  localeVariantCount: number;
  groupCount: number;
  outputsPerGroup: number;
  totalRequests: number;
  estimatedBillableRequests: number;
  probeRequests: number;
  maxTotalRequests: number;
  exceedsRequestLimit: boolean;
  sourceLimitExceeded: boolean;
  feeRisk: CommerceSetFeeRisk;
};

export type CommerceSetMatrixJob = {
  key: string;
  mode: CommerceSetMode;
  sourceKey: string;
  sourceIndex: number;
  groupKey: string;
  slotId: string;
  slotIndex: number;
  slotTitle: string;
  slotPrompt: string;
  localeCode: string;
  localePrompt: string;
};

export type CommerceSetSnapshotMaterial = {
  version: 1;
  sourceKeys: string[];
  plan: CommerceSetPlan;
};

export type CommerceSetPromptPlan = {
  schemaVersion: number;
  planHash: string;
  mode: CommerceSetMode;
  sourceCount: number;
  sourceNodeIds: string[];
  outputsPerSource: number;
  totalRequests: number;
  slots: CommerceSetSlot[];
  targetLocales: CommerceSetTargetLocale[];
  translatePrompt: string;
};

type CommerceSetSchemaDefinition = {
  schemaVersion: number;
  modes: Array<{ id: CommerceSetMode; label: string; description: string }>;
  limits: {
    maxSourceCount: number;
    minSlots: number;
    maxSlots: number;
    maxTargetLanguages: number;
    maxPlanTitleLength: number;
    maxSlotTitleLength: number;
    maxSlotPromptLength: number;
    maxLanguagePromptLength: number;
    maxTranslatePromptLength: number;
    maxTotalRequests: number;
  };
  execution: {
    probeSourceCount: number;
    rampConcurrency: number[];
    maxConcurrency: number;
    feeRiskMediumRequests: number;
    feeRiskHighRequests: number;
  };
  defaults: {
    mode: CommerceSetMode;
    planTitle: string;
    translatePrompt: string;
    translationLanguageCodes: string[];
    saveTarget: CommerceSetSaveTarget;
  };
  languages: CommerceLanguage[];
  defaultSlots: CommerceSetSlot[];
};

const schema = commerceSetSchema as CommerceSetSchemaDefinition;

export const COMMERCE_SET_SCHEMA_VERSION = schema.schemaVersion;
export const COMMERCE_SET_MARKER = "[NAIMAGE_COMMERCE_SET_V1]";
export const COMMERCE_SET_MODES = schema.modes.map((mode) => ({ ...mode }));
export const COMMERCE_SET_LIMITS = Object.freeze({ ...schema.limits });
export const COMMERCE_SET_EXECUTION = Object.freeze({
  ...schema.execution,
  rampConcurrency: Object.freeze([...schema.execution.rampConcurrency])
});
export const COMMERCE_LANGUAGES: CommerceLanguage[] = schema.languages.map((language) => ({ ...language }));
export const DEFAULT_COMMERCE_SET_SLOTS: CommerceSetSlot[] = schema.defaultSlots.map((slot) => ({ ...slot }));
export const DEFAULT_COMMERCE_LANGUAGE_CODES = [...schema.defaults.translationLanguageCodes];
export const MAX_COMMERCE_TARGET_LANGUAGES = COMMERCE_SET_LIMITS.maxTargetLanguages;

const commerceLanguageByCode = new Map(COMMERCE_LANGUAGES.map((language) => [language.code, language]));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function normalizedSlotId(value: unknown, fallback: string): string {
  const normalized = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uniqueSlotId(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  const unique = `${candidate}-${suffix}`;
  used.add(unique);
  return unique;
}

function genericSlot(index: number): CommerceSetSlot {
  return {
    id: `image-${index + 1}`,
    title: `商品图 ${index + 1}`,
    prompt: "围绕商品和用户提供的信息制作一张用途明确的电商图片；保持商品、品牌、数字和单位准确，不添加未经来源支持的卖点、认证、优惠或配件。"
  };
}

export function normalizeCommerceLanguageCodes(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const used = new Set<string>();
  for (const item of entries) {
    const code = cleanText(typeof item === "string" ? item : record(item).code, 32);
    if (!commerceLanguageByCode.has(code) || used.has(code)) continue;
    used.add(code);
    result.push(code);
    if (result.length >= MAX_COMMERCE_TARGET_LANGUAGES) break;
  }
  return result;
}

export function normalizeCommerceTargetLocales(value: unknown): CommerceSetTargetLocale[] {
  const entries = Array.isArray(value) ? value : [];
  const result: CommerceSetTargetLocale[] = [];
  const used = new Set<string>();
  for (const item of entries) {
    const source = record(item);
    const code = cleanText(typeof item === "string" ? item : source.code, 32);
    const language = commerceLanguageByCode.get(code);
    if (!language || used.has(code)) continue;
    used.add(code);
    result.push({
      code,
      prompt: typeof item === "string" || !("prompt" in source)
        ? language.prompt
        : cleanText(source.prompt, COMMERCE_SET_LIMITS.maxLanguagePromptLength)
    });
    if (result.length >= MAX_COMMERCE_TARGET_LANGUAGES) break;
  }
  return result;
}

export function normalizeCommerceSetSlots(value: unknown, requestedCount?: unknown): CommerceSetSlot[] {
  const entries = Array.isArray(value) ? value : [];
  const fallbackCount = entries.length || DEFAULT_COMMERCE_SET_SLOTS.length;
  const count = boundedInteger(
    requestedCount,
    COMMERCE_SET_LIMITS.minSlots,
    COMMERCE_SET_LIMITS.maxSlots,
    boundedInteger(fallbackCount, COMMERCE_SET_LIMITS.minSlots, COMMERCE_SET_LIMITS.maxSlots, DEFAULT_COMMERCE_SET_SLOTS.length)
  );
  const usedIds = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const fallback = DEFAULT_COMMERCE_SET_SLOTS[index] || genericSlot(index);
    const source = record(entries[index]);
    const candidateId = normalizedSlotId(source.id, fallback.id);
    return {
      id: uniqueSlotId(candidateId, usedIds),
      title: cleanText(source.title, COMMERCE_SET_LIMITS.maxSlotTitleLength) || fallback.title,
      prompt: cleanText(source.prompt, COMMERCE_SET_LIMITS.maxSlotPromptLength) || fallback.prompt
    };
  });
}

export function resizeCommerceSetSlots(value: unknown, requestedCount: unknown): CommerceSetSlot[] {
  return normalizeCommerceSetSlots(value, requestedCount);
}

export function normalizeCommerceSetPlan(value: unknown = {}): CommerceSetPlan {
  const source = record(value);
  const mode: CommerceSetMode = source.mode === "translate" || source.mode === "generate"
    ? source.mode
    : schema.defaults.mode;
  const localeInput = Array.isArray(source.targetLocales)
    ? source.targetLocales
    : Array.isArray(source.languageCodes)
      ? source.languageCodes
      : mode === "translate"
        ? schema.defaults.translationLanguageCodes
        : [];
  const slotCount = source.setSize ?? source.slotCount ?? (Array.isArray(source.slots) ? source.slots.length : undefined);
  const saveTarget: CommerceSetSaveTarget = source.saveTarget === "requirement" || source.saveTarget === "skill" || source.saveTarget === "none"
    ? source.saveTarget
    : schema.defaults.saveTarget;
  const title = cleanText(source.title, COMMERCE_SET_LIMITS.maxPlanTitleLength) || schema.defaults.planTitle;
  return {
    schemaVersion: COMMERCE_SET_SCHEMA_VERSION,
    mode,
    title,
    slots: normalizeCommerceSetSlots(source.slots, slotCount),
    targetLocales: normalizeCommerceTargetLocales(localeInput),
    translatePrompt: cleanText(source.translatePrompt, COMMERCE_SET_LIMITS.maxTranslatePromptLength) || schema.defaults.translatePrompt,
    saveTarget,
    reusableName: cleanText(source.reusableName, COMMERCE_SET_LIMITS.maxPlanTitleLength) || title,
    executionPolicy: {
      probeFirst: true,
      probeSourceCount: COMMERCE_SET_EXECUTION.probeSourceCount,
      rampConcurrency: [...COMMERCE_SET_EXECUTION.rampConcurrency],
      maxConcurrency: COMMERCE_SET_EXECUTION.maxConcurrency
    }
  };
}

function balancedJsonObjectAfterMarker(text: string, marker: string): string | null {
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

export function parseCommerceSetPromptPlan(value: unknown): CommerceSetPromptPlan | null {
  const text = String(value ?? "");
  const markerIndex = text.lastIndexOf(COMMERCE_SET_MARKER);
  const planJsonMarkerIndex = text.lastIndexOf("COMMERCE_SET_PLAN_JSON:");
  if (markerIndex < 0 || planJsonMarkerIndex <= markerIndex) return null;
  const declaredPlanHashes = [...text.slice(markerIndex, planJsonMarkerIndex).matchAll(/^PLAN_HASH:\s*(commerce-[a-f0-9]{32})\s*$/gm)];
  const json = balancedJsonObjectAfterMarker(text, "COMMERCE_SET_PLAN_JSON:");
  if (declaredPlanHashes.length !== 1 || !json) return null;
  try {
    const source = record(JSON.parse(json));
    if (source.mode !== "generate" && source.mode !== "translate") return null;
    const mode = source.mode;
    const rawSlots = Array.isArray(source.slots) ? source.slots : [];
    const slots = mode === "generate" ? normalizeCommerceSetSlots(rawSlots, rawSlots.length) : [];
    if (
      (mode === "generate" && (
        rawSlots.length < COMMERCE_SET_LIMITS.minSlots || rawSlots.length > COMMERCE_SET_LIMITS.maxSlots ||
        slots.length !== rawSlots.length || slots.some((slot, index) => {
          const raw = record(rawSlots[index]);
          return raw.id !== slot.id || raw.title !== slot.title || raw.prompt !== slot.prompt;
        })
      )) ||
      (mode === "translate" && rawSlots.length !== 0)
    ) return null;
    const rawTargetLocales = Array.isArray(source.targetLocales) ? source.targetLocales : [];
    const targetLocales = normalizeCommerceTargetLocales(rawTargetLocales);
    if (
      targetLocales.length !== rawTargetLocales.length ||
      targetLocales.some((locale, index) => {
        const raw = record(rawTargetLocales[index]);
        return raw.code !== locale.code || raw.prompt !== locale.prompt;
      }) ||
      (mode === "translate" && targetLocales.length === 0)
    ) return null;
    const translatePrompt = cleanText(source.translatePrompt, COMMERCE_SET_LIMITS.maxTranslatePromptLength);
    if (typeof source.translatePrompt !== "string" || source.translatePrompt !== translatePrompt) return null;
    const expectedOutputsPerSource = mode === "generate"
      ? slots.length * Math.max(1, targetLocales.length)
      : targetLocales.length;
    const sourceCount = typeof source.sourceCount === "number" ? source.sourceCount : Number.NaN;
    const outputsPerSource = typeof source.outputsPerSource === "number" ? source.outputsPerSource : Number.NaN;
    const totalRequests = typeof source.totalRequests === "number" ? source.totalRequests : Number.NaN;
    const planHash = cleanText(source.planHash, 48).toLowerCase();
    const rawSourceNodeIds = Array.isArray(source.sourceNodeIds) ? source.sourceNodeIds : [];
    const sourceNodeIds = rawSourceNodeIds.map((item) => cleanText(item, 160));
    if (
      source.schemaVersion !== COMMERCE_SET_SCHEMA_VERSION ||
      source.planHash !== planHash || declaredPlanHashes[0][1] !== planHash ||
      !/^commerce-[a-f0-9]{32}$/.test(planHash) ||
      !Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > COMMERCE_SET_LIMITS.maxSourceCount ||
      !Number.isSafeInteger(outputsPerSource) || outputsPerSource !== expectedOutputsPerSource || outputsPerSource < 1 || outputsPerSource > COMMERCE_SET_LIMITS.maxTotalRequests ||
      !Number.isSafeInteger(totalRequests) || totalRequests !== sourceCount * outputsPerSource || totalRequests > COMMERCE_SET_LIMITS.maxTotalRequests ||
      rawSourceNodeIds.some((item, index) => typeof item !== "string" || !sourceNodeIds[index] || item !== sourceNodeIds[index]) ||
      new Set(sourceNodeIds).size !== sourceNodeIds.length || sourceNodeIds.length > sourceCount
    ) return null;
    return {
      schemaVersion: COMMERCE_SET_SCHEMA_VERSION,
      planHash,
      mode,
      sourceCount,
      sourceNodeIds,
      outputsPerSource,
      totalRequests,
      slots,
      targetLocales,
      translatePrompt
    };
  } catch {
    return null;
  }
}

export function commerceSetFeeRisk(totalRequests: number, exceedsRequestLimit = false): CommerceSetFeeRisk {
  if (exceedsRequestLimit) return "blocked";
  if (totalRequests <= 0) return "none";
  if (totalRequests >= COMMERCE_SET_EXECUTION.feeRiskHighRequests) return "high";
  if (totalRequests >= COMMERCE_SET_EXECUTION.feeRiskMediumRequests) return "medium";
  return "low";
}

export function commerceSetRequestCounts(value: unknown, sourceCountValue: unknown): CommerceSetRequestCounts {
  const plan = normalizeCommerceSetPlan(value);
  const rawSourceCount = Number(sourceCountValue);
  const finiteSourceCount = Number.isFinite(rawSourceCount) ? Math.max(0, Math.floor(rawSourceCount)) : 0;
  const sourceLimitExceeded = finiteSourceCount > COMMERCE_SET_LIMITS.maxSourceCount;
  const sourceCount = Math.min(finiteSourceCount, COMMERCE_SET_LIMITS.maxSourceCount);
  const languageCount = plan.targetLocales.length;
  const localeVariantCount = plan.mode === "generate" ? Math.max(1, languageCount) : languageCount;
  const slotCount = plan.mode === "generate" ? plan.slots.length : sourceCount;
  const groupCount = plan.mode === "generate" ? sourceCount * localeVariantCount : languageCount;
  const outputsPerGroup = plan.mode === "generate" ? plan.slots.length : sourceCount;
  const totalRequests = groupCount * outputsPerGroup;
  const exceedsRequestLimit = sourceLimitExceeded || totalRequests > COMMERCE_SET_LIMITS.maxTotalRequests;
  return {
    sourceCount,
    slotCount,
    languageCount,
    localeVariantCount,
    groupCount,
    outputsPerGroup,
    totalRequests,
    estimatedBillableRequests: totalRequests,
    probeRequests: totalRequests > 0 ? Math.min(totalRequests, Math.min(sourceCount, COMMERCE_SET_EXECUTION.probeSourceCount)) : 0,
    maxTotalRequests: COMMERCE_SET_LIMITS.maxTotalRequests,
    exceedsRequestLimit,
    sourceLimitExceeded,
    feeRisk: commerceSetFeeRisk(totalRequests, exceedsRequestLimit)
  };
}

export function normalizeCommerceSourceKeys(value: number | readonly unknown[]): string[] {
  const entries = typeof value === "number"
    ? Array.from({ length: boundedInteger(value, 0, COMMERCE_SET_LIMITS.maxSourceCount, 0) }, () => undefined)
    : Array.isArray(value)
      ? value.slice(0, COMMERCE_SET_LIMITS.maxSourceCount)
      : [];
  const used = new Set<string>();
  return entries.map((item, index) => {
    const source = record(item);
    const raw = typeof item === "string"
      ? item
      : source.bindingId ?? source.sourceBindingId ?? source.nodeId ?? source.id;
    const base = cleanText(raw, 180) || `source-${String(index + 1).padStart(3, "0")}`;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let suffix = 2;
    while (used.has(`${base}#${suffix}`)) suffix += 1;
    const unique = `${base}#${suffix}`;
    used.add(unique);
    return unique;
  });
}

function normalizeCommerceSnapshotSourceKeys(value: number | readonly unknown[]): string[] {
  if (typeof value === "number") return normalizeCommerceSourceKeys(value);
  const used = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const source = record(item);
    const raw = typeof item === "string"
      ? item
      : source.bindingId ?? source.sourceBindingId ?? source.nodeId ?? source.id;
    const id = cleanText(raw, 160);
    if (!id || used.has(id)) continue;
    used.add(id);
    result.push(id);
    if (result.length >= COMMERCE_SET_LIMITS.maxSourceCount) break;
  }
  return result;
}

function matrixKey(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export function buildCommerceSetMatrix(value: unknown, sources: number | readonly unknown[]): CommerceSetMatrixJob[] {
  const plan = normalizeCommerceSetPlan(value);
  const sourceKeys = normalizeCommerceSourceKeys(sources);
  if (!sourceKeys.length) return [];
  if (plan.mode === "translate") {
    return plan.targetLocales.flatMap((locale) => sourceKeys.map((sourceKey, sourceIndex) => ({
      key: matrixKey("translate", locale.code, sourceKey),
      mode: plan.mode,
      sourceKey,
      sourceIndex,
      groupKey: matrixKey("locale", locale.code),
      slotId: sourceKey,
      slotIndex: sourceIndex,
      slotTitle: `来源图 ${sourceIndex + 1}`,
      slotPrompt: plan.translatePrompt,
      localeCode: locale.code,
      localePrompt: locale.prompt
    })));
  }
  const locales = plan.targetLocales.length
    ? plan.targetLocales
    : [{ code: "source-language", prompt: "沿用母图语言与用户提供的文字要求。" }];
  return sourceKeys.flatMap((sourceKey, sourceIndex) => locales.flatMap((locale) => plan.slots.map((slot, slotIndex) => ({
    key: matrixKey("generate", sourceKey, locale.code, slot.id),
    mode: plan.mode,
    sourceKey,
    sourceIndex,
    groupKey: matrixKey("source", sourceKey, locale.code),
    slotId: slot.id,
    slotIndex,
    slotTitle: slot.title,
    slotPrompt: slot.prompt,
    localeCode: locale.code,
    localePrompt: locale.prompt
  }))));
}

export function commerceSetSnapshotMaterial(value: unknown, sources: number | readonly unknown[]): CommerceSetSnapshotMaterial {
  const plan = normalizeCommerceSetPlan(value);
  return {
    version: 1,
    sourceKeys: normalizeCommerceSnapshotSourceKeys(sources),
    plan
  };
}

function canonicalCommerceSetJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCommerceSetJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalCommerceSetJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function serializeCommerceSetSnapshotMaterial(value: unknown, sources: number | readonly unknown[]): string {
  return canonicalCommerceSetJson(commerceSetSnapshotMaterial(value, sources));
}
