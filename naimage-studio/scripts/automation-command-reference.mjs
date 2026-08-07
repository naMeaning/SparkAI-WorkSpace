import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "integrations", "naimage-control", "references", "commands.schema.json");
const commerceSetSchemaPath = path.join(root, "plugins", "commerce-set-schema.json");
const commerceCatalogSchemaPath = path.join(root, "plugins", "commerce-catalog-schema.json");
const commerceTemplateSchemaPath = path.join(root, "plugins", "commerce-template-schema.json");
const socialContentSchemaPath = path.join(root, "plugins", "social-content-schema.json");
const scientificFigureSchemaPath = path.join(root, "plugins", "scientific-figure-schema.json");
const referencePath = path.join(root, "integrations", "naimage-control", "references", "commands.md");
const registryPath = path.join(root, "src", "automation-command-registry.ts");

export function readAutomationCommandSchema() {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assertCommerceCommandSchemaParity(schema, JSON.parse(readFileSync(commerceSetSchemaPath, "utf8")));
  assertCommerceCatalogSchemaParity(schema, JSON.parse(readFileSync(commerceCatalogSchemaPath, "utf8")));
  assertCommerceTemplateSchemaParity(
    schema,
    JSON.parse(readFileSync(commerceTemplateSchemaPath, "utf8")),
    JSON.parse(readFileSync(commerceSetSchemaPath, "utf8"))
  );
  assertSocialContentSchemaParity(schema, JSON.parse(readFileSync(socialContentSchemaPath, "utf8")));
  assertScientificFigureSchemaParity(schema, JSON.parse(readFileSync(scientificFigureSchemaPath, "utf8")));
  return schema;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSchemaValue(label, actual, expected) {
  if (!sameJsonValue(actual, expected)) {
    throw new Error(`automation command schema drift at ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

export function assertSocialContentSchemaParity(schema, socialSchema) {
  const commands = new Map((schema.sections || [])
    .flatMap((section) => section.commands || [])
    .map((command) => [command.name, command]));
  const xiaohongshu = commands.get("social.xiaohongshu.plan")?.parameters?.properties;
  const douyin = commands.get("social.douyin.plan")?.parameters?.properties;
  if (!xiaohongshu || !douyin) throw new Error("social content commands are missing their structured schemas.");
  const limits = socialSchema?.limits || {};
  assertSchemaValue("social.xiaohongshu.brief.maxLength", xiaohongshu.brief?.maxLength, limits.maxBriefLength);
  assertSchemaValue("social.xiaohongshu.audience.maxLength", xiaohongshu.audience?.maxLength, limits.maxAudienceLength);
  assertSchemaValue("social.xiaohongshu.objective.maxLength", xiaohongshu.objective?.maxLength, limits.maxObjectiveLength);
  assertSchemaValue("social.xiaohongshu.contentKind.enum", xiaohongshu.contentKind?.enum, (socialSchema?.xiaohongshu?.contentKinds || []).map((item) => item.id));
  assertSchemaValue("social.xiaohongshu.contentKind.default", xiaohongshu.contentKind?.default, socialSchema?.xiaohongshu?.defaultContentKind);
  assertSchemaValue("social.xiaohongshu.ratio.enum", xiaohongshu.ratio?.enum, socialSchema?.xiaohongshu?.ratios || []);
  assertSchemaValue("social.xiaohongshu.ratio.default", xiaohongshu.ratio?.default, socialSchema?.xiaohongshu?.defaultRatio);
  assertSchemaValue("social.xiaohongshu.cardCount.minimum", xiaohongshu.cardCount?.minimum, limits.minXiaohongshuCards);
  assertSchemaValue("social.xiaohongshu.cardCount.maximum", xiaohongshu.cardCount?.maximum, limits.maxXiaohongshuCards);
  assertSchemaValue("social.xiaohongshu.cardCount.default", xiaohongshu.cardCount?.default, socialSchema?.xiaohongshu?.defaultCardCount);
  assertSchemaValue("social.xiaohongshu.titleCandidateCount.maximum", xiaohongshu.titleCandidateCount?.maximum, limits.maxTitleCandidates);
  assertSchemaValue("social.xiaohongshu.titleCandidateCount.default", xiaohongshu.titleCandidateCount?.default, socialSchema?.xiaohongshu?.defaultTitleCandidateCount);
  assertSchemaValue("social.douyin.brief.maxLength", douyin.brief?.maxLength, limits.maxBriefLength);
  assertSchemaValue("social.douyin.format.enum", douyin.format?.enum, (socialSchema?.douyin?.formats || []).map((item) => item.id));
  assertSchemaValue("social.douyin.format.default", douyin.format?.default, socialSchema?.douyin?.defaultFormat);
  assertSchemaValue("social.douyin.durationSeconds.enum", douyin.durationSeconds?.enum, socialSchema?.douyin?.durations || []);
  assertSchemaValue("social.douyin.durationSeconds.default", douyin.durationSeconds?.default, socialSchema?.douyin?.defaultDuration);
  assertSchemaValue("social.douyin.shotCount.minimum", douyin.shotCount?.minimum, limits.minDouyinShots);
  assertSchemaValue("social.douyin.shotCount.maximum", douyin.shotCount?.maximum, limits.maxDouyinShots);
  assertSchemaValue("social.douyin.shotCount.default", douyin.shotCount?.default, socialSchema?.douyin?.defaultShotCount);
  return schema;
}

export function assertScientificFigureSchemaParity(schema, scientificSchema) {
  const commands = new Map((schema.sections || [])
    .flatMap((section) => section.commands || [])
    .map((command) => [command.name, command]));
  const planCommand = commands.get("research.figure.plan")?.parameters;
  const renderCommand = commands.get("research.figure.render")?.parameters;
  const dataImportCommand = commands.get("research.data.import")?.parameters;
  const dataListCommand = commands.get("research.data.list")?.parameters;
  if (!planCommand?.properties?.panels?.items?.properties || !renderCommand?.properties || !dataImportCommand || !dataListCommand) {
    throw new Error("research figure commands are missing their structured schemas.");
  }
  const limits = scientificSchema?.limits || {};
  const defaults = scientificSchema?.defaults || {};
  const plan = planCommand.properties;
  const panel = plan.panels.items.properties;
  assertSchemaValue("research.plan.backend.enum", plan.backend?.enum, (scientificSchema?.backends || []).map((item) => item.id));
  assertSchemaValue("research.plan.figureType.enum", plan.figureType?.enum, (scientificSchema?.figureTypes || []).map((item) => item.id));
  assertSchemaValue("research.plan.archetype.enum", plan.archetype?.enum, (scientificSchema?.archetypes || []).map((item) => item.id));
  assertSchemaValue("research.plan.archetype.default", plan.archetype?.default, defaults.archetype);
  assertSchemaValue("research.plan.researchClaim.maxLength", plan.researchClaim?.maxLength, limits.maxResearchClaimLength);
  assertSchemaValue("research.plan.targetJournal.default", plan.targetJournal?.default, defaults.targetJournal);
  assertSchemaValue("research.plan.dataSourceIds.maxItems", plan.dataSourceIds?.maxItems, limits.maxDataSources);
  assertSchemaValue("research.plan.panels.maxItems", plan.panels?.maxItems, limits.maxPanels);
  assertSchemaValue("research.plan.panel.title.maxLength", panel.title?.maxLength, limits.maxPanelTitleLength);
  assertSchemaValue("research.plan.panel.chartType.enum", panel.chartType?.enum, (scientificSchema?.chartTypes || []).map((item) => item.id));
  assertSchemaValue("research.plan.panel.sourceBindings.maxItems", panel.sourceBindings?.maxItems, limits.maxDataSources);
  assertSchemaValue("research.plan.panel.description.maxLength", panel.description?.maxLength, limits.maxTextLength);
  assertSchemaValue("research.plan.panel.xField.maxLength", panel.xField?.maxLength, limits.maxFieldLength);
  assertSchemaValue("research.plan.panel.yFields.maxItems", panel.yFields?.maxItems, limits.maxYFields);
  assertSchemaValue("research.plan.panel.groupField.maxLength", panel.groupField?.maxLength, limits.maxFieldLength);
  assertSchemaValue("research.plan.outputFormats.items.enum", plan.outputFormats?.items?.enum, scientificSchema?.outputFormats || []);
  assertSchemaValue("research.plan.outputFormats.default", plan.outputFormats?.default, defaults.outputFormats);
  assertSchemaValue("research.plan.stylePreset.enum", plan.stylePreset?.enum, (scientificSchema?.stylePresets || []).map((item) => item.id));
  assertSchemaValue("research.plan.stylePreset.default", plan.stylePreset?.default, defaults.stylePreset);
  assertSchemaValue("research.plan.widthMm.default", plan.widthMm?.default, defaults.widthMm);
  assertSchemaValue("research.plan.heightMm.default", plan.heightMm?.default, defaults.heightMm);
  assertSchemaValue("research.plan.dpi.default", plan.dpi?.default, defaults.dpi);
  assertSchemaValue("research.plan.statisticsNotes.maxLength", plan.statisticsNotes?.maxLength, limits.maxTextLength);
  assertSchemaValue("research.plan.sourceDataNotes.maxLength", plan.sourceDataNotes?.maxLength, limits.maxTextLength);
  assertSchemaValue("research.plan.imageIntegrityNotes.maxLength", plan.imageIntegrityNotes?.maxLength, limits.maxTextLength);
  assertSchemaValue("research.plan.reviewerRisks.maxItems", plan.reviewerRisks?.maxItems, limits.maxReviewerRisks);
  assertSchemaValue("research.render.timeoutMs.default", renderCommand.properties.timeoutMs?.default, limits.defaultTimeoutMs);
  assertSchemaValue("research.render.timeoutMs.maximum", renderCommand.properties.timeoutMs?.maximum, limits.maxTimeoutMs);
  assertSchemaValue("research.data.import.additionalProperties", dataImportCommand.additionalProperties, false);
  assertSchemaValue("research.data.list.additionalProperties", dataListCommand.additionalProperties, false);
  return schema;
}

export function assertCommerceCommandSchemaParity(schema, commerceSetSchema) {
  const command = (schema.sections || [])
    .flatMap((section) => section.commands || [])
    .find((candidate) => candidate.name === "commerce.compose-set");
  if (!command?.parameters?.properties?.plan?.properties) {
    throw new Error("commerce.compose-set is missing its structured plan schema.");
  }
  const limits = commerceSetSchema?.limits || {};
  const plan = command.parameters.properties.plan.properties;
  const languageCodes = (commerceSetSchema?.languages || []).map((language) => language.code);
  const modes = (commerceSetSchema?.modes || []).map((mode) => mode.id);
  const platformTemplateIds = (commerceSetSchema?.platformTemplates || []).map((template) => template.id);
  assertSchemaValue("sourceNodeIds.maxItems", command.parameters.properties.sourceNodeIds?.maxItems, limits.maxSourceCount);
  assertSchemaValue("plan.mode.enum", plan.mode?.enum, modes);
  assertSchemaValue("plan.platformTemplateId.enum", plan.platformTemplateId?.enum, platformTemplateIds);
  assertSchemaValue("plan.platformTemplateId.default", plan.platformTemplateId?.default, commerceSetSchema?.defaults?.platformTemplateId);
  assertSchemaValue("plan.setSize.minimum", plan.setSize?.minimum, limits.minSlots);
  assertSchemaValue("plan.setSize.maximum", plan.setSize?.maximum, limits.maxSlots);
  assertSchemaValue("plan.slots.minItems", plan.slots?.minItems, limits.minSlots);
  assertSchemaValue("plan.slots.maxItems", plan.slots?.maxItems, limits.maxSlots);
  assertSchemaValue("plan.languageCodes.maxItems", plan.languageCodes?.maxItems, limits.maxTargetLanguages);
  assertSchemaValue("plan.languageCodes.items.enum", plan.languageCodes?.items?.enum, languageCodes);
  assertSchemaValue("plan.targetLocales.maxItems", plan.targetLocales?.maxItems, limits.maxTargetLanguages);
  assertSchemaValue("plan.targetLocales.items.properties.code.enum", plan.targetLocales?.items?.properties?.code?.enum, languageCodes);
  assertSchemaValue("plan.title.maxLength", plan.title?.maxLength, limits.maxPlanTitleLength);
  assertSchemaValue("plan.reusableName.maxLength", plan.reusableName?.maxLength, limits.maxPlanTitleLength);
  assertSchemaValue("plan.slots.items.properties.title.maxLength", plan.slots?.items?.properties?.title?.maxLength, limits.maxSlotTitleLength);
  assertSchemaValue("plan.slots.items.properties.prompt.maxLength", plan.slots?.items?.properties?.prompt?.maxLength, limits.maxSlotPromptLength);
  assertSchemaValue("plan.targetLocales.items.properties.prompt.maxLength", plan.targetLocales?.items?.properties?.prompt?.maxLength, limits.maxLanguagePromptLength);
  assertSchemaValue("plan.translatePrompt.maxLength", plan.translatePrompt?.maxLength, limits.maxTranslatePromptLength);
  assertSchemaValue("plan.translationItems.maxItems", plan.translationItems?.maxItems, limits.maxTotalRequests);
  assertSchemaValue("plan.translationItems.items.properties.sourceIndex.maximum", plan.translationItems?.items?.properties?.sourceIndex?.maximum, limits.maxSourceCount - 1);
  assertSchemaValue("plan.translationItems.items.properties.localeCode.enum", plan.translationItems?.items?.properties?.localeCode?.enum, languageCodes);
  assertSchemaValue("plan.translationItems.items.properties.prompt.maxLength", plan.translationItems?.items?.properties?.prompt?.maxLength, limits.maxTranslationItemPromptLength);
  return schema;
}

export function assertCommerceCatalogSchemaParity(schema, catalogSchema) {
  const commands = new Map((schema.sections || [])
    .flatMap((section) => section.commands || [])
    .map((command) => [command.name, command]));
  const upsert = commands.get("commerce.catalog.upsert")?.parameters?.properties;
  const assign = commands.get("commerce.catalog.assign")?.parameters?.properties;
  const review = commands.get("commerce.catalog.review")?.parameters?.properties;
  const compare = commands.get("commerce.catalog.compare")?.parameters?.properties;
  const select = commands.get("commerce.catalog.select")?.parameters?.properties;
  if (!upsert?.product?.properties || !assign || !review || !compare || !select) {
    throw new Error("commerce catalog commands are missing their structured schemas.");
  }
  const limits = catalogSchema?.limits || {};
  const platformIds = (catalogSchema?.platforms || []).map((item) => item.id);
  const assetKindIds = (catalogSchema?.assetKinds || []).map((item) => item.id);
  const brandStyle = upsert.product.properties.brandStyle?.properties;
  if (!brandStyle) throw new Error("commerce.catalog.upsert is missing the shared brandStyle schema.");
  assertSchemaValue("catalog.product.title.maxLength", upsert.product.properties.title?.maxLength, limits.maxTitleLength);
  assertSchemaValue("catalog.product.productCode.maxLength", upsert.product.properties.productCode?.maxLength, limits.maxCodeLength);
  assertSchemaValue("catalog.product.brandStyle.colors.maxItems", brandStyle.colors?.maxItems, limits.maxBrandColors);
  assertSchemaValue("catalog.product.brandStyle.fontFamily.maxLength", brandStyle.fontFamily?.maxLength, limits.maxBrandFontLength);
  assertSchemaValue("catalog.product.brandStyle.logoUsage.maxLength", brandStyle.logoUsage?.maxLength, limits.maxBrandRuleLength);
  assertSchemaValue("catalog.product.brandStyle.modelAppearance.maxLength", brandStyle.modelAppearance?.maxLength, limits.maxBrandRuleLength);
  assertSchemaValue("catalog.product.brandStyle.productAppearance.maxLength", brandStyle.productAppearance?.maxLength, limits.maxBrandRuleLength);
  assertSchemaValue("catalog.product.brandStyle.visualStyle.maxLength", brandStyle.visualStyle?.maxLength, limits.maxBrandRuleLength);
  assertSchemaValue("catalog.product.platforms.items.enum", upsert.product.properties.platforms?.items?.enum, platformIds);
  assertSchemaValue("catalog.product.variants.maxItems", upsert.product.properties.variants?.maxItems, limits.maxVariantsPerProduct);
  assertSchemaValue("catalog.product.skus.maxItems", upsert.product.properties.skus?.maxItems, limits.maxSkusPerProduct);
  assertSchemaValue("catalog.assign.kind.enum", assign.kind?.enum, assetKindIds);
  assertSchemaValue("catalog.assign.ownerType.enum", assign.ownerType?.enum, catalogSchema?.ownerTypes || []);
  assertSchemaValue("catalog.assign.role.maxLength", assign.role?.maxLength, limits.maxRoleLength);
  assertSchemaValue("catalog.assign.assets.maxItems", assign.assets?.maxItems, limits.maxAssignmentBatch);
  assertSchemaValue("catalog.review.linkIds.maxItems", review.linkIds?.maxItems, limits.maxAssignmentBatch);
  assertSchemaValue("catalog.review.state.enum", review.state?.enum, catalogSchema?.resultStates || []);
  assertSchemaValue("catalog.compare.productId.pattern", compare.productId?.pattern, "^product-[a-f0-9]{32}$");
  assertSchemaValue("catalog.select.groupKey.pattern", select.groupKey?.pattern, "^comparison-[a-f0-9]{32}$");
  assertSchemaValue("catalog.select.winnerLinkId.pattern", select.winnerLinkId?.pattern, "^result-[a-f0-9]{32}$");
  return schema;
}

export function assertCommerceTemplateSchemaParity(schema, templateSchema, commerceSetSchema) {
  const commands = new Map((schema.sections || [])
    .flatMap((section) => section.commands || [])
    .map((command) => [command.name, command]));
  const save = commands.get("commerce.template.save")?.parameters?.properties;
  const remove = commands.get("commerce.template.delete")?.parameters?.properties;
  const exportCommand = commands.get("commerce.template.export")?.parameters?.properties;
  if (!save?.plan?.properties || !remove || !exportCommand) {
    throw new Error("commerce template commands are missing their structured schemas.");
  }
  const limits = templateSchema?.limits || {};
  const setLimits = commerceSetSchema?.limits || {};
  const plan = save.plan.properties;
  const languages = (commerceSetSchema?.languages || []).map((language) => language.code);
  const modes = (commerceSetSchema?.modes || []).map((mode) => mode.id);
  const platforms = (commerceSetSchema?.platformTemplates || []).map((template) => template.id);
  assertSchemaValue("template.title.maxLength", save.title?.maxLength, limits.maxTitleLength);
  assertSchemaValue("template.description.maxLength", save.description?.maxLength, limits.maxDescriptionLength);
  assertSchemaValue("template.plan.mode.enum", plan.mode?.enum, modes);
  assertSchemaValue("template.plan.platformTemplateId.enum", plan.platformTemplateId?.enum, platforms);
  assertSchemaValue("template.plan.title.maxLength", plan.title?.maxLength, setLimits.maxPlanTitleLength);
  assertSchemaValue("template.plan.slots.maxItems", plan.slots?.maxItems, setLimits.maxSlots);
  assertSchemaValue("template.plan.slots.items.title.maxLength", plan.slots?.items?.properties?.title?.maxLength, setLimits.maxSlotTitleLength);
  assertSchemaValue("template.plan.slots.items.prompt.maxLength", plan.slots?.items?.properties?.prompt?.maxLength, setLimits.maxSlotPromptLength);
  assertSchemaValue("template.plan.targetLocales.maxItems", plan.targetLocales?.maxItems, setLimits.maxTargetLanguages);
  assertSchemaValue("template.plan.targetLocales.code.enum", plan.targetLocales?.items?.properties?.code?.enum, languages);
  assertSchemaValue("template.plan.targetLocales.prompt.maxLength", plan.targetLocales?.items?.properties?.prompt?.maxLength, setLimits.maxLanguagePromptLength);
  assertSchemaValue("template.plan.translatePrompt.maxLength", plan.translatePrompt?.maxLength, setLimits.maxTranslatePromptLength);
  assertSchemaValue("template.delete.templateId.pattern", remove.templateId?.pattern, "^commerce-template-[a-f0-9]{32}$");
  assertSchemaValue("template.export.templateId.pattern", exportCommand.templateId?.pattern, "^(?:commerce-builtin-(?:amazon|aliexpress)|commerce-template-[a-f0-9]{32})$");
  return schema;
}

function schemaValueExample(definition, name, index = 0) {
  if (definition.default !== undefined) return definition.default;
  if (Array.isArray(definition.enum) && definition.enum.length) return definition.enum[0];
  if (definition.type === "object") {
    const properties = definition.properties && typeof definition.properties === "object" ? definition.properties : {};
    const required = Array.isArray(definition.required) ? definition.required : [];
    const propertyNames = [...required];
    const minimum = Math.max(0, Number(definition.minProperties) || 0);
    for (const propertyName of Object.keys(properties)) {
      if (propertyNames.length >= minimum) break;
      if (!propertyNames.includes(propertyName)) propertyNames.push(propertyName);
    }
    return Object.fromEntries(propertyNames.map((propertyName) => [
      propertyName,
      schemaValueExample(properties[propertyName] || {}, propertyName, index),
    ]));
  }
  if (definition.type === "array") {
    const count = Math.max(0, Number(definition.minItems) || 0);
    return Array.from({ length: count }, (_item, itemIndex) => schemaValueExample(
      definition.items || {},
      name,
      definition.uniqueItems ? itemIndex + 1 : index,
    ));
  }
  if (definition.type === "integer" || definition.type === "number") {
    const minimum = Number.isFinite(Number(definition.minimum)) ? Number(definition.minimum) : -Infinity;
    const maximum = Number.isFinite(Number(definition.maximum)) ? Number(definition.maximum) : Infinity;
    return minimum <= 0 && maximum >= 0 ? 0 : Number.isFinite(minimum) ? minimum : maximum;
  }
  if (definition.type === "boolean") return false;
  const suffix = index > 0 ? `-${index}` : "";
  return `${name}${suffix}`;
}

function schemaArgumentExample(command) {
  if (Array.isArray(command.examples) && command.examples.length) return JSON.stringify(command.examples[0]);
  const parameters = command.parameters;
  const properties = parameters?.properties;
  if (!properties || typeof properties !== "object") return command.args || "";
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  const included = Object.entries(properties).filter(([name, definition]) => required.has(name) || definition.default !== undefined);
  return JSON.stringify(Object.fromEntries(included.map(([name, definition]) => [name, schemaValueExample(definition, name)])));
}

export function renderAutomationCommandReference(schema) {
  const lines = [
    "# SparkAI WorkSpace automation commands",
    "",
    "> Generated from `commands.schema.json`; do not edit this file directly.",
    "",
    "Invoke commands with `scripts/naimage.ps1 <command> -ArgsJson '<json>'`.",
    ""
  ];
  for (const section of schema.sections || []) {
    lines.push(`## ${section.title}`, "");
    for (const command of section.commands || []) {
      const commandArgs = schemaArgumentExample(command);
      const args = commandArgs ? `: \`${commandArgs}\`` : "";
      lines.push(`- \`${command.name}\`${args}. ${command.description}`);
    }
    lines.push("");
  }
  for (const note of schema.notes || []) lines.push(`## ${note.title}`, "", note.body, "");
  return `${lines.join("\n").trim()}\n`;
}

export function renderAutomationCommandRegistry(schema) {
  const commands = (schema.sections || []).flatMap((section) => section.commands || []);
  const rendererCommands = commands.filter((command) => command.surface === "renderer");
  const serviceCommands = commands.filter((command) => command.surface === "service");
  const names = rendererCommands.map((command) => command.name);
  const serviceNames = serviceCommands.map((command) => command.name);
  const definitions = Object.fromEntries(commands.map((command) => [command.name, {
    ...(command.parameters ? { parameters: command.parameters } : {}),
    ...(command.destructive === true ? { destructive: true } : {})
  }]));
  const surfaces = Object.fromEntries(commands.map((command) => [command.name, command.surface]));
  const enums = Object.fromEntries(commands.flatMap((command) => {
    const parameterEnums = Object.fromEntries(Object.entries(command.parameters?.properties || {})
      .filter(([, definition]) => Array.isArray(definition.enum))
      .map(([name, definition]) => [name, definition.enum]));
    return Object.keys(parameterEnums).length ? [[command.name, parameterEnums]] : [];
  }));
  return `// Generated from integrations/naimage-control/references/commands.schema.json.\n` +
    `// Run \`corepack pnpm run automation:generate\` after editing the schema.\n` +
    `export const AUTOMATION_RENDERER_COMMAND_NAMES = ${JSON.stringify(names, null, 2)} as const;\n\n` +
    `export const AUTOMATION_SERVICE_COMMAND_NAMES = ${JSON.stringify(serviceNames, null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_NAMES = ${JSON.stringify(commands.map((command) => command.name), null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_DEFINITIONS = ${JSON.stringify(definitions, null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_SURFACES = ${JSON.stringify(surfaces, null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_ENUMS = ${JSON.stringify(enums, null, 2)} as const;\n\n` +
    `export type AutomationRendererCommandName = typeof AUTOMATION_RENDERER_COMMAND_NAMES[number];\n\n` +
    `export type AutomationServiceCommandName = typeof AUTOMATION_SERVICE_COMMAND_NAMES[number];\n\n` +
    `const automationRendererCommandNames = new Set<string>(AUTOMATION_RENDERER_COMMAND_NAMES);\n\n` +
    `const automationServiceCommandNames = new Set<string>(AUTOMATION_SERVICE_COMMAND_NAMES);\n\n` +
    `export function isAutomationRendererCommandName(value: string): value is AutomationRendererCommandName {\n` +
    `  return automationRendererCommandNames.has(value);\n` +
    `}\n\n` +
    `export function isAutomationServiceCommandName(value: string): value is AutomationServiceCommandName {\n` +
    `  return automationServiceCommandNames.has(value);\n` +
    `}\n`;
}

export function generatedAutomationCommandArtifacts(schema = readAutomationCommandSchema()) {
  return {
    [referencePath]: renderAutomationCommandReference(schema),
    [registryPath]: renderAutomationCommandRegistry(schema)
  };
}

function main() {
  const check = process.argv.includes("--check");
  let changed = false;
  for (const [target, content] of Object.entries(generatedAutomationCommandArtifacts())) {
    const current = readFileSync(target, "utf8");
    if (current === content) continue;
    changed = true;
    if (!check) writeFileSync(target, content, "utf8");
    else process.stderr.write(`generated automation artifact is stale: ${path.relative(root, target)}\n`);
  }
  if (check && changed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
