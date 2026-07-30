import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import commerceSetSchema from "../plugins/commerce-set-schema.json" with { type: "json" };
import {
  COMMERCE_LANGUAGES,
  COMMERCE_SET_LIMITS,
  DEFAULT_COMMERCE_SET_SLOTS,
  MAX_COMMERCE_TARGET_LANGUAGES,
  buildCommerceSetMatrix,
  commerceSetRequestCounts,
  normalizeCommerceLanguageCodes,
  normalizeCommerceSetPlan,
  normalizeCommerceSourceKeys,
  parseCommerceSetPromptPlan,
  serializeCommerceSetSnapshotMaterial
} from "../src/plugins/commerce-set.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginPrompts = require("../desktop/plugin-task-prompts.cjs") as {
  commerceLanguages: string[][];
  normalizeCommerceLanguageCodes: (value: unknown) => string[];
  composePluginTask: (payload: unknown) => {
    prompt: string;
    planHash: string;
    counts: { outputsPerSource: number; totalRequests: number };
  };
};
const commerceSetRuntime = require("../runtime/commerce-set-plan.cjs") as {
  normalizeCommerceSetPlan: (plan: unknown) => unknown;
  commerceSetRequestCounts: (plan: unknown, sourceCount: number) => unknown;
};
const { createAidebugBackend } = require("../desktop/aidebug-backend.cjs") as {
  createAidebugBackend: (options: { enabled: boolean; log: (message: string) => void }) => {
    chatCompletion: (payload: unknown) => { output: Array<{ type: string; name?: string; arguments?: string }> };
  };
};

const aidebugBackend = createAidebugBackend({ enabled: true, log: () => undefined });
const aidebugImageTool = [{ type: "function", function: { name: "image_gen", parameters: { type: "object" } } }];
function aidebugImageCall(prompt: string): Record<string, unknown> {
  const response = aidebugBackend.chatCompletion({
    messages: [{ role: "user", content: prompt }],
    tools: aidebugImageTool
  });
  const calls = response.output.filter((item) => item.type === "function_call");
  assert.equal(calls.length, 1, "A trusted commerce Goal must produce one image_gen call for all frozen sources");
  assert.equal(calls[0]?.name, "image_gen");
  return JSON.parse(String(calls[0]?.arguments || "{}")) as Record<string, unknown>;
}

assert.equal(commerceSetSchema.schemaVersion, 1);
assert.equal(COMMERCE_LANGUAGES.length, commerceSetSchema.languages.length);
assert.equal(DEFAULT_COMMERCE_SET_SLOTS.length, commerceSetSchema.defaultSlots.length);
assert.equal(MAX_COMMERCE_TARGET_LANGUAGES, commerceSetSchema.limits.maxTargetLanguages);
assert.ok(DEFAULT_COMMERCE_SET_SLOTS.length >= 7, "The default listing set should cover a complete commerce story");
assert.deepEqual(
  pluginPrompts.commerceLanguages.map((language) => language[0]),
  COMMERCE_LANGUAGES.map((language) => language.code),
  "Electron CJS and Renderer TypeScript must read the same language registry"
);

const normalizedCodes = normalizeCommerceLanguageCodes([
  "en-US", "de-DE", "en-US", "invalid", "ar-SA", ...Array(20).fill("fr-FR")
]);
assert.deepEqual(normalizedCodes, ["en-US", "de-DE", "ar-SA", "fr-FR"]);
assert.deepEqual(pluginPrompts.normalizeCommerceLanguageCodes(normalizedCodes), normalizedCodes);

const resized = normalizeCommerceSetPlan({
  mode: "generate",
  setSize: COMMERCE_SET_LIMITS.maxSlots + 8,
  slots: [
    { id: "hero", title: "  主图  ", prompt: "  主图要求  " },
    { id: "hero", title: "细节", prompt: "细节要求" }
  ],
  languageCodes: ["en-US", "de-DE", "en-US"]
});
assert.equal(resized.slots.length, COMMERCE_SET_LIMITS.maxSlots);
assert.equal(resized.slots[0].title, "主图");
assert.equal(resized.slots[0].prompt, "主图要求");
assert.equal(resized.slots[1].id, "hero-2", "Duplicate slot IDs must be made stable and unique");
assert.deepEqual(resized.targetLocales.map((locale) => locale.code), ["en-US", "de-DE"]);

const defaultGenerate = normalizeCommerceSetPlan({ mode: "generate", languageCodes: [] });
const defaultGenerateCounts = commerceSetRequestCounts(defaultGenerate, 1);
assert.equal(defaultGenerateCounts.outputsPerGroup, DEFAULT_COMMERCE_SET_SLOTS.length);
assert.equal(defaultGenerateCounts.groupCount, 1);
assert.equal(defaultGenerateCounts.totalRequests, DEFAULT_COMMERCE_SET_SLOTS.length);
assert.equal(defaultGenerateCounts.localeVariantCount, 1, "No generate locale means one source-language group");

const twoSlotPlan = normalizeCommerceSetPlan({
  mode: "generate",
  setSize: 2,
  languageCodes: ["en-US", "ja-JP"]
});
const generatedCounts = commerceSetRequestCounts(twoSlotPlan, 3);
assert.deepEqual(
  {
    sources: generatedCounts.sourceCount,
    groups: generatedCounts.groupCount,
    perGroup: generatedCounts.outputsPerGroup,
    requests: generatedCounts.totalRequests,
    probe: generatedCounts.probeRequests
  },
  { sources: 3, groups: 6, perGroup: 2, requests: 12, probe: 2 }
);
const generatedMatrix = buildCommerceSetMatrix(twoSlotPlan, ["sku-a", "sku-b", "sku-c"]);
assert.equal(generatedMatrix.length, 12);
assert.equal(new Set(generatedMatrix.map((job) => job.key)).size, generatedMatrix.length);
assert.equal(new Set(generatedMatrix.map((job) => job.groupKey)).size, 6);
assert.deepEqual(generatedMatrix.slice(0, 2).map((job) => job.slotId), twoSlotPlan.slots.map((slot) => slot.id));

const translatePlan = normalizeCommerceSetPlan({
  mode: "translate",
  languageCodes: ["en-US", "ar-SA"]
});
const translatedCounts = commerceSetRequestCounts(translatePlan, 4);
assert.deepEqual(
  {
    groups: translatedCounts.groupCount,
    perGroup: translatedCounts.outputsPerGroup,
    requests: translatedCounts.totalRequests,
    probe: translatedCounts.probeRequests
  },
  { groups: 2, perGroup: 4, requests: 8, probe: 2 }
);
const translatedMatrix = buildCommerceSetMatrix(translatePlan, 4);
assert.equal(translatedMatrix.length, 8);
assert.equal(new Set(translatedMatrix.map((job) => job.groupKey)).size, 2);
assert.ok(translatedMatrix.filter((job) => job.localeCode === "ar-SA").every((job) => /阿拉伯语/.test(job.localePrompt)));

const blockedCounts = commerceSetRequestCounts({
  mode: "generate",
  setSize: COMMERCE_SET_LIMITS.maxSlots,
  languageCodes: COMMERCE_LANGUAGES.slice(0, MAX_COMMERCE_TARGET_LANGUAGES).map((language) => language.code)
}, 3);
assert.equal(blockedCounts.totalRequests, 360);
assert.equal(blockedCounts.exceedsRequestLimit, true);
assert.equal(blockedCounts.feeRisk, "blocked");

assert.deepEqual(
  normalizeCommerceSourceKeys(["sku-a", "sku-a", { bindingId: "binding-c" }]),
  ["sku-a", "sku-a#2", "binding-c"]
);
const stableOne = serializeCommerceSetSnapshotMaterial({
  mode: "generate",
  title: " 套图计划 ",
  setSize: 2,
  slots: [
    { id: "hero", title: "主图", prompt: "主图" },
    { id: "detail", title: "细节", prompt: "细节" }
  ],
  languageCodes: ["en-US", "de-DE", "en-US"],
  saveTarget: "requirement",
  reusableName: " 商品套图 "
}, ["sku-a", "sku-b"]);
const stableTwo = serializeCommerceSetSnapshotMaterial({
  mode: "generate",
  title: "套图计划",
  slots: [
    { id: "hero", title: "主图", prompt: "主图" },
    { id: "detail", title: "细节", prompt: "细节" }
  ],
  targetLocales: ["en-US", "de-DE"],
  saveTarget: "requirement",
  reusableName: "商品套图"
}, [{ nodeId: "sku-a" }, { nodeId: "sku-b" }]);
assert.equal(stableOne, stableTwo, "Equivalent plans must yield byte-stable snapshot material");
assert.deepEqual(
  commerceSetRuntime.normalizeCommerceSetPlan(twoSlotPlan),
  normalizeCommerceSetPlan(twoSlotPlan),
  "Renderer and Electron must normalize the same shared plan identically"
);
assert.deepEqual(
  commerceSetRuntime.commerceSetRequestCounts(twoSlotPlan, 3),
  {
    sourceCount: 3,
    slotCount: 2,
    languageCount: 2,
    outputsPerSource: 4,
    groupCount: 6,
    totalRequests: 12,
    probeRequests: 2,
    maxTotalRequests: 200,
    sourceLimitExceeded: false,
    exceedsRequestLimit: false
  },
  "Electron request counts must match the Renderer matrix"
);
const singleTrustedTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.generate-listing-set",
  sourceCount: 1,
  sourceNodeIds: ["SOURCE-A"],
  plan: { mode: "generate", setSize: 1 }
});
assert.match(singleTrustedTask.prompt, /每个 SOURCE 只输出一张：省略 items/);
assert.match(singleTrustedTask.prompt, /顶层设置 slotId=/);
assert.match(singleTrustedTask.planHash, /^commerce-[a-f0-9]{32}$/);
const aidebugSingleArgs = aidebugImageCall(singleTrustedTask.prompt);
assert.equal(aidebugSingleArgs.count, 1);
assert.equal(aidebugSingleArgs.commercePlanHash, singleTrustedTask.planHash);
assert.equal(aidebugSingleArgs.slotId, DEFAULT_COMMERCE_SET_SLOTS[0]?.id);
assert.equal(aidebugSingleArgs.slotIndex, 0);
assert.equal(aidebugSingleArgs.localeCode, "source-language");
assert.equal("items" in aidebugSingleArgs, false, "A one-output commerce plan must keep provenance at the top level and omit items");
const twelveSlotTrustedTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.generate-listing-set",
  sourceCount: 1,
  sourceNodeIds: ["SOURCE-A"],
  plan: { mode: "generate", setSize: COMMERCE_SET_LIMITS.maxSlots }
});
assert.equal(twelveSlotTrustedTask.counts.outputsPerSource, 12);
assert.equal(twelveSlotTrustedTask.counts.totalRequests, 12);
const parsedTrustedPlan = parseCommerceSetPromptPlan(twelveSlotTrustedTask.prompt);
assert.equal(parsedTrustedPlan?.outputsPerSource, 12, "Reusable commerce nodes must recover the original Goal operation count after runtime metadata is appended");
assert.equal(parsedTrustedPlan?.totalRequests, 12);
assert.equal(parseCommerceSetPromptPlan(`${twelveSlotTrustedTask.prompt}\ntrailing text`)?.outputsPerSource, 12);
assert.equal(
  parseCommerceSetPromptPlan(twelveSlotTrustedTask.prompt.replace('"outputsPerSource":12', '"outputsPerSource":11')),
  null,
  "Tampered reusable plan counts must be rejected"
);
assert.equal(
  parseCommerceSetPromptPlan(twelveSlotTrustedTask.prompt.replace(/PLAN_HASH: commerce-[a-f0-9]{32}/, `PLAN_HASH: commerce-${"f".repeat(32)}`)),
  null,
  "The visible PLAN_HASH and structured plan hash must remain identical"
);
assert.equal(
  parseCommerceSetPromptPlan(twelveSlotTrustedTask.prompt.replace('"sourceNodeIds":["SOURCE-A"]', '"sourceNodeIds":[]'))?.outputsPerSource,
  12,
  "Plans composed without explicit node IDs remain compatible"
);
const multiAssetContainerTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.generate-listing-set",
  sourceCount: 2,
  sourceNodeIds: ["CONTAINER-A"],
  plan: { mode: "generate", setSize: 1 }
});
assert.equal(
  parseCommerceSetPromptPlan(multiAssetContainerTask.prompt)?.sourceCount,
  2,
  "One container node may legitimately represent multiple mother-image bindings"
);
assert.equal(
  parseCommerceSetPromptPlan(twelveSlotTrustedTask.prompt.replace('"sourceCount":1', '"sourceCount":1.5')),
  null,
  "Fractional source counts must not be rounded into a valid reusable plan"
);
const aidebugTwelveSlotArgs = aidebugImageCall(twelveSlotTrustedTask.prompt);
assert.equal(aidebugTwelveSlotArgs.scopeExecution, "all-goal-sources");
assert.equal(aidebugTwelveSlotArgs.generationMode, "parallel");
assert.equal(aidebugTwelveSlotArgs.commercePlanHash, twelveSlotTrustedTask.planHash);
assert.equal(aidebugTwelveSlotArgs.count, COMMERCE_SET_LIMITS.maxSlots);
const aidebugTwelveSlotItems = aidebugTwelveSlotArgs.items as Array<Record<string, unknown>>;
assert.equal(aidebugTwelveSlotItems.length, COMMERCE_SET_LIMITS.maxSlots);
assert.deepEqual(
  aidebugTwelveSlotItems.slice(0, 2).map((item) => [item.slotId, item.slotIndex, item.localeCode]),
  DEFAULT_COMMERCE_SET_SLOTS.slice(0, 2).map((slot, index) => [slot.id, index, "source-language"])
);
assert.ok(aidebugTwelveSlotItems.every((item) => /SOURCE 母图/.test(String(item.prompt || ""))), "Every item must carry a complete product-invariant prompt");

const localizedGenerateTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.generate-listing-set",
  sourceCount: 2,
  sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
  plan: { mode: "generate", setSize: 2, languageCodes: ["en-US", "ja-JP"] }
});
const localizedGenerateArgs = aidebugImageCall(localizedGenerateTask.prompt);
const localizedGenerateItems = localizedGenerateArgs.items as Array<Record<string, unknown>>;
assert.equal(localizedGenerateArgs.count, 4);
assert.deepEqual(
  localizedGenerateItems.map((item) => [item.slotIndex, item.localeCode]),
  [[0, "en-US"], [1, "en-US"], [0, "ja-JP"], [1, "ja-JP"]],
  "AIDebug generate expansion must use locale outer order and slot inner order"
);

const localeWithoutExtraPromptTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.generate-listing-set",
  sourceCount: 1,
  sourceNodeIds: ["SOURCE-A"],
  plan: { mode: "generate", setSize: 1, targetLocales: [{ code: "en-US", prompt: "" }] }
});
const localeWithoutExtraPromptArgs = aidebugImageCall(localeWithoutExtraPromptTask.prompt);
assert.equal(localeWithoutExtraPromptArgs.localeCode, "en-US", "An intentionally empty locale hint must remain a valid commerce plan");

const translationTask = pluginPrompts.composePluginTask({
  command: "sparkai.commerce-toolkit.translate-listing-set",
  sourceCount: 2,
  sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
  plan: { mode: "translate", languageCodes: ["en-US", "ar-SA"] }
});
const translationArgs = aidebugImageCall(translationTask.prompt);
const translationItems = translationArgs.items as Array<Record<string, unknown>>;
assert.equal(translationArgs.count, 2);
assert.deepEqual(
  translationItems.map((item) => [item.slotId, item.slotIndex, item.localeCode]),
  [["translation", 0, "en-US"], ["translation", 0, "ar-SA"]]
);
assert.ok(translationItems.every((item) => /Logo 与整体设计不变/.test(String(item.prompt || ""))));
assert.notEqual(
  stableOne,
  serializeCommerceSetSnapshotMaterial(twoSlotPlan, ["sku-b", "sku-a"]),
  "Ordered source bindings are part of the frozen snapshot"
);

const compatibilitySource = fs.readFileSync(path.join(root, "src", "commerce-translation-dialog.tsx"), "utf8");
const fullDialogSource = fs.readFileSync(path.join(root, "src", "commerce-set-dialog.tsx"), "utf8");
const dialogCssSource = fs.readFileSync(path.join(root, "src", "styles", "04a-commerce-set-dialog.css"), "utf8");
const commerceGuiSuiteSource = fs.readFileSync(path.join(root, "scripts", "aidebug-commerce-set-suite.mjs"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
assert.match(compatibilitySource, /CommerceSetDialog/);
assert.match(compatibilitySource, /initialMode="translate"/);
assert.match(fullDialogSource, /整套张数/);
assert.match(fullDialogSource, /逐语言提示/);
assert.match(fullDialogSource, /Requirement/);
assert.match(fullDialogSource, /Skill/);
assert.match(fullDialogSource, /probeRequests/);
assert.match(mainSource, /React\.lazy\(\(\) => import\("\.\/commerce-(?:translation|set)-dialog"\)\)/, "The commerce configuration surface must remain a natural lazy boundary");
assert.match(mainSource, /command: payload\.plan\.mode === "generate"/, "The final dialog mode must choose the trusted command");
assert.match(mainSource, /套图配置期间母图范围已发生变化/, "A stale cross-Renderer SOURCE selection must not silently execute");
assert.match(mainSource, /createCommerceReusableNode\(pending\)/, "Confirmed plans may create reusable Requirement or Skill nodes");
assert.match(mainSource, /parseCommerceSetPromptPlan/, "Reusable commerce execution must recover its matrix size from the trusted plan block");
assert.match(fullDialogSource, /errorMessage/, "Stale SOURCE rejection must remain visible inside the commerce dialog");
assert.match(fullDialogSource, /validationMessage && validationMessage !== feeRiskCopy\[counts\.feeRisk\]/, "A blocked request plan must not render the same danger notice twice");
assert.match(fullDialogSource, /disabled=\{Boolean\(validationMessage \|\| errorMessage\)\}/, "A stale SOURCE snapshot must disable repeated submission");
assert.match(fullDialogSource, /className="commerce-set-submit"/, "The commerce submit action needs a stable selector independent of its changing label");
assert.match(fullDialogSource, /`超过 \$\{COMMERCE_SET_LIMITS\.maxTotalRequests\} 请求上限`/, "Over-limit plans must explain the disabled action directly on the button");
assert.match(fullDialogSource, /来源已变化，请重新配置/, "Stale SOURCE snapshots must explain why the action is disabled");
assert.match(fullDialogSource, /请选择至少一张母图/);
assert.match(fullDialogSource, /请选择目标语言/);
assert.match(dialogCssSource, /\.commerce-set-submit\.ui-action-button:disabled:not\(\[aria-busy="true"\]\)/, "Invalid commerce submissions need a scoped neutral disabled style");
assert.match(dialogCssSource, /opacity:\s*1;/, "The disabled commerce action must not rely on opacity alone");
assert.match(commerceGuiSuiteSource, /dialog\.querySelector\('\.commerce-set-submit'\)/, "GUI coverage must locate submit by its stable selector");
assert.doesNotMatch(commerceGuiSuiteSource, /find\(\(button\) => String\(button\.textContent \|\| ''\)\.includes\('确认并执行'\)\)/, "GUI coverage must not depend on the happy-path submit copy");

process.stdout.write(`${JSON.stringify({
  ok: true,
  schemaVersion: commerceSetSchema.schemaVersion,
  languages: COMMERCE_LANGUAGES.length,
  defaultSlots: DEFAULT_COMMERCE_SET_SLOTS.length,
  generateRequests: generatedCounts.totalRequests,
  translateRequests: translatedCounts.totalRequests,
  blockedRequests: blockedCounts.totalRequests
})}\n`);
