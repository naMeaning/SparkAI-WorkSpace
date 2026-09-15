"use strict";

const { createHash } = require("node:crypto");
const schema = require("../plugins/commerce-set-schema.json");

const COMMERCE_SET_MARKER = "[NAIMAGE_COMMERCE_SET_V1]";
const COMMERCE_GENERATE_SET_COMMAND = "sparkai.commerce-toolkit.generate-listing-set";
const COMMERCE_TRANSLATION_COMMAND = "sparkai.commerce-toolkit.translate-listing-set";

const languageByCode = new Map(schema.languages.map((language) => [language.code, language]));
const platformTemplateById = new Map(schema.platformTemplates.map((template) => [template.id, template]));

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, maximum) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.floor(numeric)))
    : fallback;
}

function normalizedSlotId(value, fallback) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizeTargetLocales(value) {
  const items = Array.isArray(value) ? value : [];
  const used = new Set();
  const result = [];
  for (const item of items) {
    const source = record(item);
    const code = cleanText(typeof item === "string" ? item : source.code, 32);
    const language = languageByCode.get(code);
    if (!language || used.has(code)) continue;
    used.add(code);
    result.push({
      code,
      prompt: typeof item === "string" || !("prompt" in source)
        ? language.prompt
        : cleanText(source.prompt, schema.limits.maxLanguagePromptLength)
    });
    if (result.length >= schema.limits.maxTargetLanguages) break;
  }
  return result;
}

function normalizeTranslationItems(value, targetLocales) {
  const items = Array.isArray(value) ? value : [];
  const localeOrder = normalizeTargetLocales(targetLocales);
  const localeEntries = localeOrder.length ? localeOrder : schema.languages;
  const allowedLocales = new Set(localeEntries.map((locale) => locale.code));
  const localeIndex = new Map(localeEntries.map((locale, index) => [locale.code, index]));
  const used = new Set();
  const result = [];
  for (const item of items) {
    const source = record(item);
    const sourceIndex = Number(source.sourceIndex);
    const localeCode = cleanText(source.localeCode, 32);
    const prompt = cleanText(source.prompt, schema.limits.maxTranslationItemPromptLength);
    const key = `${sourceIndex}:${localeCode}`;
    if (
      !Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= schema.limits.maxSourceCount ||
      !allowedLocales.has(localeCode) || !prompt || used.has(key)
    ) continue;
    used.add(key);
    result.push({ sourceIndex, localeCode, prompt });
    if (result.length >= schema.limits.maxTotalRequests) break;
  }
  return result.sort((left, right) => (
    left.sourceIndex - right.sourceIndex ||
    (localeIndex.get(left.localeCode) ?? Number.MAX_SAFE_INTEGER) - (localeIndex.get(right.localeCode) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function genericSlot(index) {
  return {
    id: `image-${index + 1}`,
    title: `商品图 ${index + 1}`,
    prompt: "围绕商品和用户提供的信息制作一张用途明确的电商图片；保持商品、品牌、数字和单位准确，不添加未经来源支持的卖点、认证、优惠或配件。"
  };
}

function normalizePlatformTemplateId(value) {
  const id = cleanText(value, 32).toLowerCase();
  return platformTemplateById.has(id) ? id : schema.defaults.platformTemplateId;
}

function slotsForPlatform(value) {
  const template = platformTemplateById.get(normalizePlatformTemplateId(value));
  return Array.isArray(template?.slots) && template.slots.length ? template.slots : schema.defaultSlots;
}

function normalizeSlots(value, requestedCount, platformTemplateId = schema.defaults.platformTemplateId) {
  const items = Array.isArray(value) ? value : [];
  const templateSlots = slotsForPlatform(platformTemplateId);
  const fallbackCount = items.length || templateSlots.length;
  const count = boundedInteger(
    requestedCount,
    schema.limits.minSlots,
    schema.limits.maxSlots,
    boundedInteger(fallbackCount, schema.limits.minSlots, schema.limits.maxSlots, templateSlots.length)
  );
  const used = new Set();
  return Array.from({ length: count }, (_item, index) => {
    const source = record(items[index]);
    const fallback = templateSlots[index] || genericSlot(index);
    const baseId = normalizedSlotId(source.id, fallback.id);
    let id = baseId;
    let suffix = 2;
    while (used.has(id)) id = `${baseId}-${suffix++}`;
    used.add(id);
    return {
      id,
      title: cleanText(source.title, schema.limits.maxSlotTitleLength) || fallback.title,
      prompt: cleanText(source.prompt, schema.limits.maxSlotPromptLength) || fallback.prompt
    };
  });
}

function normalizeCommerceSetPlan(value = {}) {
  const source = record(value);
  const mode = source.mode === "translate" ? "translate" : "generate";
  const localeInput = Array.isArray(source.targetLocales)
    ? source.targetLocales
    : Array.isArray(source.languageCodes)
      ? source.languageCodes
      : mode === "translate"
        ? schema.defaults.translationLanguageCodes
        : [];
  const title = cleanText(source.title, schema.limits.maxPlanTitleLength) || schema.defaults.planTitle;
  const saveTarget = ["none", "requirement", "skill"].includes(source.saveTarget)
    ? source.saveTarget
    : schema.defaults.saveTarget;
  const platformTemplateId = normalizePlatformTemplateId(source.platformTemplateId);
  const slotCount = source.setSize ?? source.slotCount ?? (Array.isArray(source.slots) ? source.slots.length : undefined);
  const targetLocales = normalizeTargetLocales(localeInput);
  return {
    schemaVersion: schema.schemaVersion,
    mode,
    platformTemplateId,
    title,
    slots: normalizeSlots(source.slots, slotCount, platformTemplateId),
    targetLocales,
    translatePrompt: cleanText(source.translatePrompt, schema.limits.maxTranslatePromptLength) || schema.defaults.translatePrompt,
    translationItems: mode === "translate" ? normalizeTranslationItems(source.translationItems, targetLocales) : [],
    saveTarget,
    reusableName: cleanText(source.reusableName, schema.limits.maxPlanTitleLength) || title,
    executionPolicy: {
      probeFirst: true,
      probeSourceCount: schema.execution.probeSourceCount,
      rampConcurrency: [...schema.execution.rampConcurrency],
      maxConcurrency: schema.execution.maxConcurrency
    }
  };
}

function normalizeSourceNodeIds(value) {
  const used = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 160))
    .filter((id) => id && !used.has(id) && used.add(id))
    .slice(0, schema.limits.maxSourceCount);
}

function commerceSetRequestCounts(value, sourceCountValue) {
  const plan = normalizeCommerceSetPlan(value);
  const rawSourceCount = Number(sourceCountValue);
  const finiteSourceCount = Number.isFinite(rawSourceCount) ? Math.max(0, Math.floor(rawSourceCount)) : 0;
  const sourceLimitExceeded = finiteSourceCount > schema.limits.maxSourceCount;
  const sourceCount = Math.min(finiteSourceCount, schema.limits.maxSourceCount);
  const languageCount = plan.targetLocales.length;
  const localeVariantCount = plan.mode === "generate" ? Math.max(1, languageCount) : languageCount;
  const outputsPerSource = plan.mode === "generate" ? plan.slots.length * localeVariantCount : languageCount;
  const totalRequests = sourceCount * outputsPerSource;
  return {
    sourceCount,
    slotCount: plan.mode === "generate" ? plan.slots.length : sourceCount,
    languageCount,
    outputsPerSource,
    groupCount: plan.mode === "generate" ? sourceCount * localeVariantCount : languageCount,
    totalRequests,
    probeRequests: totalRequests > 0 ? Math.min(sourceCount, schema.execution.probeSourceCount) : 0,
    maxTotalRequests: schema.limits.maxTotalRequests,
    sourceLimitExceeded,
    exceedsRequestLimit: sourceLimitExceeded || totalRequests > schema.limits.maxTotalRequests
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// This small deterministic digest is available in both Renderer and CJS. It
// fingerprints the visible prompt material without changing the legacy
// Node-based commerce-* plan identifier.
function stableCommerceMaterialHash(value) {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ (code + index), 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ (code + hashes[0]), 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ (code + hashes[1]), 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function commerceSetPromptMaterial(plan, sourceNodeIds = []) {
  const normalized = normalizeCommerceSetPlan(plan);
  return {
    version: 1,
    sourceNodeIds: normalizeSourceNodeIds(sourceNodeIds),
    plan: {
      mode: normalized.mode,
      platformTemplateId: normalized.platformTemplateId,
      title: normalized.title,
      slots: normalized.mode === "generate" ? normalized.slots : [],
      targetLocales: normalized.targetLocales,
      translatePrompt: normalized.mode === "translate" ? normalized.translatePrompt : "",
      translationItems: normalized.mode === "translate" ? normalized.translationItems : []
    }
  };
}

function commerceSetPromptMaterialHash(plan, sourceNodeIds = []) {
  return stableCommerceMaterialHash(canonicalJson(commerceSetPromptMaterial(plan, sourceNodeIds)));
}

function commerceSetPlanHash(plan, sourceNodeIds = []) {
  const material = canonicalJson({
    version: 1,
    sourceNodeIds: normalizeSourceNodeIds(sourceNodeIds),
    plan: normalizeCommerceSetPlan(plan)
  });
  return `commerce-${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

function balancedJsonObjectAfterMarker(text, marker) {
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

function parseCommerceSetPromptPlan(value) {
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
    const platformTemplateId = normalizePlatformTemplateId(source.platformTemplateId);
    const rawSlots = Array.isArray(source.slots) ? source.slots : [];
    const slots = mode === "generate" ? normalizeSlots(rawSlots, rawSlots.length, platformTemplateId) : [];
    if (
      (mode === "generate" && (
        rawSlots.length < schema.limits.minSlots || rawSlots.length > schema.limits.maxSlots ||
        slots.length !== rawSlots.length || slots.some((slot, index) => {
          const raw = record(rawSlots[index]);
          return raw.id !== slot.id || raw.title !== slot.title || raw.prompt !== slot.prompt;
        })
      )) ||
      (mode === "translate" && rawSlots.length !== 0)
    ) return null;
    const rawTargetLocales = Array.isArray(source.targetLocales) ? source.targetLocales : [];
    const targetLocales = normalizeTargetLocales(rawTargetLocales);
    if (
      targetLocales.length !== rawTargetLocales.length ||
      targetLocales.some((locale, index) => {
        const raw = record(rawTargetLocales[index]);
        return raw.code !== locale.code || raw.prompt !== locale.prompt;
      }) ||
      (mode === "translate" && targetLocales.length === 0)
    ) return null;
    const translatePrompt = cleanText(source.translatePrompt, schema.limits.maxTranslatePromptLength);
    if (typeof source.translatePrompt !== "string" || source.translatePrompt !== translatePrompt) return null;
    const expectedOutputsPerSource = mode === "generate"
      ? slots.length * Math.max(1, targetLocales.length)
      : targetLocales.length;
    const sourceCount = source.sourceCount;
    const outputsPerSource = source.outputsPerSource;
    const totalRequests = source.totalRequests;
    const planHash = cleanText(source.planHash, 48).toLowerCase();
    const rawSourceNodeIds = Array.isArray(source.sourceNodeIds) ? source.sourceNodeIds : [];
    const sourceNodeIds = rawSourceNodeIds.map((item) => cleanText(item, 160));
    const hasMaterialHash = Object.prototype.hasOwnProperty.call(source, "planMaterialHash");
    const planMaterialHash = cleanText(source.planMaterialHash, 64).toLowerCase();
    const rawTranslationItems = Array.isArray(source.translationItems) ? source.translationItems : [];
    const translationItems = mode === "translate"
      ? normalizeTranslationItems(rawTranslationItems, targetLocales)
      : [];
    if (
      source.schemaVersion !== schema.schemaVersion ||
      ("platformTemplateId" in source && source.platformTemplateId !== platformTemplateId) ||
      source.planHash !== planHash || declaredPlanHashes[0][1] !== planHash ||
      !/^commerce-[a-f0-9]{32}$/.test(planHash) ||
      !Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > schema.limits.maxSourceCount ||
      !Number.isSafeInteger(outputsPerSource) || outputsPerSource !== expectedOutputsPerSource || outputsPerSource < 1 || outputsPerSource > schema.limits.maxTotalRequests ||
      !Number.isSafeInteger(totalRequests) || totalRequests !== sourceCount * outputsPerSource || totalRequests > schema.limits.maxTotalRequests ||
      rawSourceNodeIds.some((item, index) => typeof item !== "string" || !sourceNodeIds[index] || item !== sourceNodeIds[index]) ||
      new Set(sourceNodeIds).size !== sourceNodeIds.length || sourceNodeIds.length > sourceCount ||
      (mode === "generate" && rawTranslationItems.length !== 0) ||
      translationItems.length !== rawTranslationItems.length ||
      translationItems.some((item, index) => {
        const raw = record(rawTranslationItems[index]);
        return raw.sourceIndex !== item.sourceIndex || raw.localeCode !== item.localeCode || raw.prompt !== item.prompt || item.sourceIndex >= sourceCount;
      }) ||
      (hasMaterialHash && (
        !/^[a-f0-9]{32}$/.test(planMaterialHash) ||
        planMaterialHash !== commerceSetPromptMaterialHash({
          mode,
          platformTemplateId,
          title: cleanText(source.title, schema.limits.maxPlanTitleLength) || schema.defaults.planTitle,
          slots,
          targetLocales,
          translatePrompt,
          translationItems
        }, sourceNodeIds)
      ))
    ) return null;
    return {
      schemaVersion: schema.schemaVersion,
      planHash,
      ...(hasMaterialHash ? { planMaterialHash } : {}),
      mode,
      platformTemplateId,
      sourceCount,
      sourceNodeIds,
      outputsPerSource,
      totalRequests,
      slots,
      targetLocales,
      translatePrompt,
      translationItems
    };
  } catch {
    return null;
  }
}

function commerceSetPromptPlanItemMetadata(plan) {
  if (!plan || typeof plan !== "object") return [];
  if (plan.mode === "translate") {
    return plan.targetLocales.map((locale) => ({
      slotId: "translation",
      slotIndex: 0,
      localeCode: locale.code
    }));
  }
  const locales = plan.targetLocales.length
    ? plan.targetLocales
    : [{ code: "source-language" }];
  return locales.flatMap((locale) => plan.slots.map((slot, slotIndex) => ({
    slotId: slot.id,
    slotIndex,
    localeCode: locale.code
  })));
}

function localeLabel(code) {
  const language = languageByCode.get(code);
  return language ? `${language.label} / ${language.nativeLabel}` : code;
}

function commerceSetTranslationItemPrompt(plan, sourceIndex, localeCode) {
  const items = Array.isArray(plan?.translationItems) ? plan.translationItems : [];
  const match = items.find((item) => item?.sourceIndex === sourceIndex && item?.localeCode === localeCode);
  return match ? cleanText(match.prompt, schema.limits.maxTranslationItemPromptLength) : "";
}

function commerceSetPrompt(planValue, sourceCountValue, sourceNodeIds = []) {
  const plan = normalizeCommerceSetPlan(planValue);
  const counts = commerceSetRequestCounts(plan, sourceCountValue);
  if (!counts.sourceCount) throw new Error("请至少选择一张可用的母图。");
  if (plan.mode === "translate" && !plan.targetLocales.length) throw new Error("请至少选择一种目标语言。");
  if (counts.exceedsRequestLimit) {
    throw new Error(`当前计划需要 ${counts.totalRequests} 个图片请求，超过单次 ${schema.limits.maxTotalRequests} 个的安全上限。`);
  }
  const planHash = commerceSetPlanHash(plan, sourceNodeIds);
  const normalizedSourceNodeIds = normalizeSourceNodeIds(sourceNodeIds);
  const commonRules = [
    "当前冻结 TaskScope 中的每个 SOURCE binding 都是一张独立母图；不得使用会话里的其他旧图。",
    "商品身份、几何结构、比例、轮廓、颜色、材质、标签、Logo、包装与可核对文字是高优先级不变量。",
    "不得虚构来源未支持的卖点、功效、认证、销量、评分、优惠、赠品、配件或法律承诺。",
    "这是用户已明确确认的批量计划；不要再次询问张数、语言或是否执行。"
  ];
  const operationRules = plan.mode === "generate"
    ? [
        `对每个 SOURCE 生成 ${counts.outputsPerSource} 张，严格按语言与套图槽位的给定顺序展开。`,
        "仅调用一次 image_gen：operation=variants、scopeExecution=all-goal-sources、generationMode=parallel；count 必须等于每个 SOURCE 的输出数，items 必须与下方展开顺序一一对应。",
        "items 中每项都要写完整纯视觉 Prompt，重复商品不变量，并只改变当前槽位的用途、构图与语言。"
      ]
    : [
        `对每个 SOURCE 生成 ${counts.outputsPerSource} 张，每种目标语言一张。`,
        "仅调用一次 image_gen：operation=variants、scopeExecution=all-goal-sources、generationMode=parallel；count 等于语言数，items 严格按语言顺序一一对应。",
        "只翻译真实可见文字并做必要排版；保持商品、背景、构图、画幅、Logo 与整体设计，不得用 generate 重画商品。"
      ];
  const promptPlan = {
    schemaVersion: 1,
    planHash,
    mode: plan.mode,
    platformTemplateId: plan.platformTemplateId,
    title: plan.title,
    sourceCount: counts.sourceCount,
    sourceNodeIds: normalizedSourceNodeIds,
    outputsPerSource: counts.outputsPerSource,
    totalRequests: counts.totalRequests,
    slots: plan.mode === "generate" ? plan.slots : [],
    targetLocales: plan.targetLocales.map((locale) => ({
      code: locale.code,
      label: localeLabel(locale.code),
      direction: languageByCode.get(locale.code)?.direction || "ltr",
      prompt: locale.prompt
    })),
    translatePrompt: plan.mode === "translate" ? plan.translatePrompt : "",
    translationItems: plan.mode === "translate" ? plan.translationItems : [],
    planMaterialHash: commerceSetPromptMaterialHash(plan, normalizedSourceNodeIds),
    executionPolicy: plan.executionPolicy
  };
  return [
    COMMERCE_SET_MARKER,
    `PLAN_HASH: ${planHash}`,
    plan.mode === "generate" ? "执行跨境电商一键套图生成。" : "执行跨境电商一键多国语言套图本地化。",
    ...commonRules.map((rule) => `- ${rule}`),
    ...operationRules.map((rule) => `- ${rule}`),
    "- 运行时必须先串行探测不同母图的代表项；只有请求、落盘、完整解码与尺寸验证都通过才可逐步放量。任一保护性失败都要停止未派发项。",
    "- 已被上游接受的请求仍可能计费；完成后按母图与槽位/语言列出成功、失败和未派发数量，不得把有效子集静默宣称为全部成功。",
    "COMMERCE_SET_PLAN_JSON:",
    JSON.stringify(promptPlan)
  ].join("\n");
}

function composeCommerceSetTask(payload = {}) {
  const command = cleanText(payload.command, 160);
  const mode = command === COMMERCE_TRANSLATION_COMMAND ? "translate" : "generate";
  const plan = normalizeCommerceSetPlan({ ...record(payload.plan), mode });
  const sourceNodeIds = normalizeSourceNodeIds(payload.sourceNodeIds);
  const counts = commerceSetRequestCounts(plan, payload.sourceCount);
  const prompt = commerceSetPrompt(plan, payload.sourceCount, sourceNodeIds);
  return {
    prompt,
    visibleContent: mode === "translate"
      ? `为 ${counts.sourceCount} 张商品图生成 ${plan.targetLocales.length} 种多国语言版本（共 ${counts.totalRequests} 张）`
      : `为 ${counts.sourceCount} 张母图生成跨境电商套图（每张 ${counts.outputsPerSource} 张，共 ${counts.totalRequests} 张）`,
    plan,
    counts,
    planHash: commerceSetPlanHash(plan, sourceNodeIds),
    sourceNodeIds,
    languageCodes: plan.targetLocales.map((locale) => locale.code)
  };
}

module.exports = {
  COMMERCE_SET_MARKER,
  COMMERCE_GENERATE_SET_COMMAND,
  COMMERCE_TRANSLATION_COMMAND,
  commerceSetPlanHash,
  commerceSetPromptMaterialHash,
  commerceSetPromptPlanItemMetadata,
  commerceSetTranslationItemPrompt,
  commerceSetPrompt,
  commerceSetRequestCounts,
  composeCommerceSetTask,
  normalizeCommerceSetPlan,
  normalizeSourceNodeIds,
  parseCommerceSetPromptPlan,
  schema
};
