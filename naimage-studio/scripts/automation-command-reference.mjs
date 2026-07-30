import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "integrations", "naimage-control", "references", "commands.schema.json");
const commerceSetSchemaPath = path.join(root, "plugins", "commerce-set-schema.json");
const referencePath = path.join(root, "integrations", "naimage-control", "references", "commands.md");
const registryPath = path.join(root, "src", "automation-command-registry.ts");

export function readAutomationCommandSchema() {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assertCommerceCommandSchemaParity(schema, JSON.parse(readFileSync(commerceSetSchemaPath, "utf8")));
  return schema;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSchemaValue(label, actual, expected) {
  if (!sameJsonValue(actual, expected)) {
    throw new Error(`commerce.compose-set schema drift at ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
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
  assertSchemaValue("sourceNodeIds.maxItems", command.parameters.properties.sourceNodeIds?.maxItems, limits.maxSourceCount);
  assertSchemaValue("plan.mode.enum", plan.mode?.enum, modes);
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
    "# naimage automation commands",
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
  const names = rendererCommands.map((command) => command.name);
  const definitions = Object.fromEntries(rendererCommands.map((command) => [command.name, {
    ...(command.parameters ? { parameters: command.parameters } : {}),
    ...(command.destructive === true ? { destructive: true } : {})
  }]));
  const enums = Object.fromEntries(commands.flatMap((command) => {
    const parameterEnums = Object.fromEntries(Object.entries(command.parameters?.properties || {})
      .filter(([, definition]) => Array.isArray(definition.enum))
      .map(([name, definition]) => [name, definition.enum]));
    return Object.keys(parameterEnums).length ? [[command.name, parameterEnums]] : [];
  }));
  return `// Generated from integrations/naimage-control/references/commands.schema.json.\n` +
    `// Run \`corepack pnpm run automation:generate\` after editing the schema.\n` +
    `export const AUTOMATION_RENDERER_COMMAND_NAMES = ${JSON.stringify(names, null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_DEFINITIONS = ${JSON.stringify(definitions, null, 2)} as const;\n\n` +
    `export const AUTOMATION_COMMAND_ENUMS = ${JSON.stringify(enums, null, 2)} as const;\n\n` +
    `export type AutomationRendererCommandName = typeof AUTOMATION_RENDERER_COMMAND_NAMES[number];\n\n` +
    `const automationRendererCommandNames = new Set<string>(AUTOMATION_RENDERER_COMMAND_NAMES);\n\n` +
    `export function isAutomationRendererCommandName(value: string): value is AutomationRendererCommandName {\n` +
    `  return automationRendererCommandNames.has(value);\n` +
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
