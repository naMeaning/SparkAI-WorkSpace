"use strict";

const assert = require("node:assert/strict");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createAutomationService } = require("../desktop/automation-service.cjs");
const { composePluginTask } = require("../desktop/plugin-task-prompts.cjs");
const { createRequirementLibraryService } = require("../desktop/requirement-library.cjs");

function assertRequirementLibraryStorageContract() {
  let reads = 0;
  let writes = 0;
  let stored;
  let second = 0;
  const service = createRequirementLibraryService({
    libraryPath: "fixture-requirement-library.json",
    readJson: (_path, fallback) => {
      reads += 1;
      return stored ?? fallback;
    },
    writeJson: (_path, value) => {
      writes += 1;
      stored = JSON.parse(JSON.stringify(value));
    },
    now: () => `2026-07-30T00:00:${String(second++).padStart(2, "0")}.000Z`,
    createId: () => "reqtpl-0123456789abcdef0123456789abcdef"
  });
  assert.equal(reads, 0, "The personal library must remain lazy until first use");
  assert.deepEqual(service.list(), { ok: true, schemaVersion: 1, libraryRevision: 0, items: [] });
  assert.equal(reads, 1);
  const created = service.save({
    title: " Product hero\u0000 ",
    text: "Keep the exact product identity.\nCreate a clean marketplace hero.",
    inputBindings: [{ nodeId: "must-not-persist", role: "source" }],
    lastRunAt: "must-not-persist",
    skill: {
      version: 1,
      name: "product-photo",
      description: "Reusable product photo instructions",
      sourceName: "C:\\private\\SKILL.md",
      contentFingerprint: "skill-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      importedAt: "2026-07-29T00:00:00.000Z"
    }
  });
  assert.equal(created.changed, true);
  assert.equal(created.entry.id, "reqtpl-0123456789abcdef0123456789abcdef");
  assert.equal(created.entry.title, "Product hero");
  assert.equal(created.entry.skill.sourceName, "SKILL.md");
  assert.equal(stored.items[0].inputBindings, undefined);
  assert.equal(stored.items[0].lastRunAt, undefined);
  assert.equal(writes, 1);
  const summaries = service.list();
  assert.equal(summaries.items[0].text, undefined, "Default list must not transfer complete instructions");
  assert.match(summaries.items[0].summary, /exact product identity/);
  const full = service.get({ id: created.entry.id });
  assert.match(full.entry.text, /marketplace hero/);
  assert.throws(
    () => service.save({ id: created.entry.id, expectedRevision: 9, title: "Changed", text: full.entry.text }),
    (error) => error.code === "TEMPLATE_REVISION_CONFLICT" && error.details?.currentRevision === 1
  );
  const updated = service.save({
    id: created.entry.id,
    expectedRevision: 1,
    title: "Marketplace hero",
    text: full.entry.text,
    skill: full.entry.skill
  });
  assert.equal(updated.entry.revision, 2);
  assert.equal(updated.libraryRevision, 2);
  assert.throws(
    () => service.remove({ id: created.entry.id, expectedRevision: 2 }),
    (error) => error.code === "CONFIRMATION_REQUIRED"
  );
  assert.throws(
    () => service.remove({ id: created.entry.id, expectedRevision: 1, confirmed: true }),
    (error) => error.code === "TEMPLATE_REVISION_CONFLICT" && error.details?.currentRevision === 2
  );
  const removed = service.remove({ id: created.entry.id, expectedRevision: 2, confirmed: true });
  assert.equal(removed.libraryRevision, 3);
  assert.equal(service.list({ includeText: true }).items.length, 0);
}

function runCli(skillRoot, command, argsJson = "{}") {
  return new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
      command,
      "-ArgsJson", argsJson,
      "-TimeoutSeconds", "30"
    ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
    });
  });
}

async function main() {
  assertRequirementLibraryStorageContract();
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-automation-"));
  const destroyedHandlers = [];
  let autoRespond = true;
  let rendererFailureCommand = "";
  let focusedRendererId = 77;
  const rendererRequests = [];
  const mockRendererResult = (payload) => ({ command: payload.command, args: payload.args });
  const webContents = {
    id: 77,
    isDestroyed: () => false,
    once: (_event, handler) => destroyedHandlers.push(handler),
    send(_channel, payload) {
      if (!autoRespond) return;
      rendererRequests.push({ webContentsId: webContents.id, command: payload.command, args: payload.args });
      setImmediate(() => service.resolveRendererResponse(webContents, {
        requestId: payload.requestId,
        ok: payload.command !== rendererFailureCommand,
        result: mockRendererResult(payload),
        error: payload.command === rendererFailureCommand ? "disk target became unavailable" : undefined,
        code: payload.command === rendererFailureCommand ? "NODE_LOCKED" : undefined,
        details: payload.command === rendererFailureCommand ? { nodeIds: ["IMAGE-A"] } : undefined
      }));
    }
  };
  const window = { isDestroyed: () => false, isFocused: () => focusedRendererId === webContents.id, webContents };
  const windows = [window];
  const service = createAutomationService({
    BrowserWindow: { getAllWindows: () => windows },
    configDir: root,
    version: "1.0.6",
    executablePath: "C:\\Program Files\\naimage\\naimage.exe",
    log: () => {}
  });
  try {
    await service.start();
    assert.equal(service.rendererReady(webContents).ok, true);
    assert.equal(service.rendererReady(webContents).ok, true);
    assert.equal(destroyedHandlers.length, 1, "Renderer readiness must register one lifecycle listener");
    const endpoint = JSON.parse(readFileSync(service.endpointPath, "utf8"));
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "canvas.state", args: {} })
    });
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.result.command, "canvas.state");
    rendererFailureCommand = "canvas.select";
    const structuredFailureResponse = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "canvas.select", args: { ids: ["IMAGE-A"] } })
    });
    rendererFailureCommand = "";
    const structuredFailure = await structuredFailureResponse.json();
    assert.equal(structuredFailure.ok, false);
    assert.equal(structuredFailure.code, "NODE_LOCKED");
    assert.deepEqual(structuredFailure.details, { nodeIds: ["IMAGE-A"] });
    const denied = await fetch(`http://127.0.0.1:${endpoint.port}/v1/status`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(denied.status, 401);

    const webContentsB = {
      id: 78,
      isDestroyed: () => false,
      once: (_event, handler) => destroyedHandlers.push(handler),
      send(_channel, payload) {
        if (!autoRespond) return;
        rendererRequests.push({ webContentsId: webContentsB.id, command: payload.command, args: payload.args });
        setImmediate(() => service.resolveRendererResponse(webContentsB, {
          requestId: payload.requestId,
          ok: true,
          result: mockRendererResult(payload)
        }));
      }
    };
    const windowB = { isDestroyed: () => false, isFocused: () => focusedRendererId === webContentsB.id, webContents: webContentsB };
    windows.push(windowB);
    assert.equal(service.rendererReady(webContentsB).ok, true);
    const routedGoalPrompt = "Apply one approved change to every current source container";
    focusedRendererId = webContents.id;
    const routedGoalA = await service.dispatch("agent.goal", { prompt: routedGoalPrompt });
    assert.deepEqual(routedGoalA.args, { prompt: routedGoalPrompt });
    const routedRequestA = rendererRequests.filter((item) => item.command === "agent.goal").at(-1);
    assert.equal(routedRequestA.webContentsId, webContents.id);

    focusedRendererId = webContentsB.id;
    const scopedGoal = await service.dispatch("agent.goal", {
      prompt: routedGoalPrompt,
      sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
      operationsPerAsset: 3
    });
    assert.deepEqual(scopedGoal.args, {
      prompt: routedGoalPrompt,
      sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
      operationsPerAsset: 3
    });
    const routedRequestB = rendererRequests.filter((item) => item.command === "agent.goal").at(-1);
    assert.equal(routedRequestB.webContentsId, webContentsB.id,
      "Each explicit Goal invocation must route to the Renderer focused when that invocation starts");

    const commerceArgs = {
      sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
      plan: { mode: "generate", setSize: 2, languageCodes: ["en-US", "de-DE"] }
    };
    const acceptedCommerce = await service.dispatch("commerce.compose-set", commerceArgs);
    assert.deepEqual(acceptedCommerce.args, commerceArgs,
      "One commerce.compose-set invocation must carry the complete authorized plan without confirmation fields");
    service.rendererGone(webContentsB.id);
    focusedRendererId = webContents.id;

    const skillRoot = path.join(root, "naimage-control");
    cpSync(path.resolve(__dirname, "..", "integrations", "naimage-control"), skillRoot, { recursive: true });
    writeFileSync(path.join(skillRoot, ".naimage-connection.json"), `${JSON.stringify({
      version: 1,
      endpointPath: service.endpointPath,
      executablePath: "unused"
    })}\n`, "utf8");
    const cli = await new Promise((resolve) => {
      execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
        "canvas.state",
        "-ArgsJson", "{}",
        "-TimeoutSeconds", "30"
      ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
      });
    });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const cliResult = JSON.parse(cli.stdout.trim());
    assert.equal(cliResult.ok, true);
    assert.equal(cliResult.result.command, "canvas.state");
    const steerCli = await new Promise((resolve) => {
      execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
        "agent.steer",
        "-ArgsJson", '{"prompt":"keep the product and append the new sources and references","taskScopeMode":"merge-source","sourceMode":"merge","referenceMode":"merge","sourceNodeIds":["SRC-B"],"referenceNodeIds":["REF-A","REF-B"]}',
        "-TimeoutSeconds", "30"
      ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
      });
    });
    assert.equal(steerCli.status, 0, steerCli.stderr || steerCli.stdout);
    const steerCliResult = JSON.parse(steerCli.stdout.trim());
    assert.equal(steerCliResult.result.command, "agent.steer");
    assert.equal(steerCliResult.result.args.prompt, "keep the product and append the new sources and references");
    assert.equal(steerCliResult.result.args.taskScopeMode, "merge-source");
    assert.equal(steerCliResult.result.args.sourceMode, "merge");
    assert.equal(steerCliResult.result.args.referenceMode, "merge");
    assert.deepEqual(steerCliResult.result.args.sourceNodeIds, ["SRC-B"]);
    assert.deepEqual(steerCliResult.result.args.referenceNodeIds, ["REF-A", "REF-B"]);
    for (const command of ["agent.pause", "agent.resume", "agent.stop"]) {
      const runControlCli = await runCli(skillRoot, command);
      assert.equal(runControlCli.status, 0, runControlCli.stderr || runControlCli.stdout);
      const runControlResult = JSON.parse(runControlCli.stdout.trim());
      assert.equal(runControlResult.result.command, command);
    }
    rendererFailureCommand = "agent.stop";
    const failedStopCli = await runCli(skillRoot, "agent.stop");
    rendererFailureCommand = "";
    assert.notEqual(failedStopCli.status, 0, "A failed backend stop must make the CLI exit non-zero");
    assert.match(JSON.parse(failedStopCli.stdout.trim()).error, /disk target became unavailable/);
    const exportCli = await new Promise((resolve) => {
      execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
        "canvas.export-image",
        "-ArgsJson", '{"nodeId":"IMAGE-A","assetIndex":0,"format":"webp"}',
        "-TimeoutSeconds", "30"
      ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
      });
    });
    assert.equal(exportCli.status, 0, exportCli.stderr || exportCli.stdout);
    const exportCliResult = JSON.parse(exportCli.stdout.trim());
    assert.equal(exportCliResult.result.command, "canvas.export-image");
    assert.deepEqual(exportCliResult.result.args, { nodeId: "IMAGE-A", assetIndex: 0, format: "webp" });
    rendererFailureCommand = "canvas.export-image";
    const failedExportCli = await new Promise((resolve) => {
      execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
        "canvas.export-image",
        "-ArgsJson", '{"nodeId":"IMAGE-A","assetIndex":0,"format":"png"}',
        "-TimeoutSeconds", "30"
      ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
      });
    });
    rendererFailureCommand = "";
    assert.notEqual(failedExportCli.status, 0, "A failed export must make the CLI exit non-zero");
    const failedExportCliResult = JSON.parse(failedExportCli.stdout.trim());
    assert.equal(failedExportCliResult.ok, false);
    assert.match(failedExportCliResult.error, /disk target became unavailable/);
    assert.equal(failedExportCliResult.code, "NODE_LOCKED");
    assert.deepEqual(failedExportCliResult.details, { nodeIds: ["IMAGE-A"] });
    const skillMarkdown = "---\nname: cli-product-photo\ndescription: CLI import contract\n---\n\nKeep the product identity.";
    const skillFixturePath = path.join(root, "private", "client-a", "CLI-SKILL.md");
    mkdirSync(path.dirname(skillFixturePath), { recursive: true });
    writeFileSync(skillFixturePath, skillMarkdown, "utf8");
    const importSkillCli = await new Promise((resolve) => {
      execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(skillRoot, "scripts", "naimage.ps1"),
        "canvas.import-skill",
        "-SkillPath", skillFixturePath,
        "-ArgsJson", JSON.stringify({ x: 260, y: 190 }),
        "-TimeoutSeconds", "30"
      ], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        resolve({ status: error ? Number(error.code || 1) : 0, stdout, stderr });
      });
    });
    assert.equal(importSkillCli.status, 0, importSkillCli.stderr || importSkillCli.stdout);
    const importSkillCliResult = JSON.parse(importSkillCli.stdout.trim());
    assert.equal(importSkillCliResult.result.command, "canvas.import-skill");
    assert.equal(importSkillCliResult.result.args.markdown, skillMarkdown);
    assert.equal(importSkillCliResult.result.args.sourceName, "CLI-SKILL.md", "CLI must send only the Skill file label, never its absolute path");
    assert.equal(JSON.stringify(importSkillCliResult.result.args).includes(skillFixturePath), false);

    const rendererSource = readFileSync(path.resolve(__dirname, "..", "src", "main.tsx"), "utf8");
    const runtimeSource = readFileSync(path.resolve(__dirname, "..", "src", "automation-command-runtime.ts"), "utf8");
    const composerSource = readFileSync(path.resolve(__dirname, "..", "src", "project-agent-composer.tsx"), "utf8");
    const commandSchema = JSON.parse(readFileSync(path.join(skillRoot, "references", "commands.schema.json"), "utf8"));
    const commerceSetContract = JSON.parse(readFileSync(path.resolve(__dirname, "..", "plugins", "commerce-set-schema.json"), "utf8"));
    const scientificFigureContract = JSON.parse(readFileSync(path.resolve(__dirname, "..", "plugins", "scientific-figure-schema.json"), "utf8"));
    const rendererCommands = new Set(commandSchema.sections.flatMap((section) =>
      section.commands.filter((command) => command.surface === "renderer").map((command) => command.name)
    ));
    const commandReference = readFileSync(path.join(skillRoot, "references", "commands.md"), "utf8");
    const generatedExample = (commandName) => {
      const line = commandReference.split(/\r?\n/).find((candidate) => candidate.startsWith(`- \`${commandName}\`:`));
      const match = line?.match(/: `(\{.*\})`\./);
      assert.ok(match, `Generated reference is missing a JSON example for ${commandName}`);
      return JSON.parse(match[1]);
    };
    const graphCommands = [
      "canvas.connect", "canvas.disconnect", "canvas.group", "canvas.dissolve", "canvas.nudge",
      "canvas.create-requirement", "canvas.update-requirement", "canvas.execute-requirement"
    ];
    const requirementLibraryCommands = [
      "requirement-library.list", "requirement-library.save", "requirement-library.delete", "requirement-library.use"
    ];
    const workspaceCommands = ["workspace.domain.list", "workspace.domain.get", "workspace.domain.set"];
    const commerceTemplateCommands = [
      "commerce.template.list", "commerce.template.save", "commerce.template.delete",
      "commerce.template.import", "commerce.template.export"
    ];
    const commerceComparisonCommands = ["commerce.catalog.compare", "commerce.catalog.select"];
    const socialCommands = [
      "social.xiaohongshu.plan", "social.xiaohongshu.execute", "social.xiaohongshu.export",
      "social.douyin.plan", "social.douyin.execute", "social.douyin.status", "social.douyin.export"
    ];
    const researchCommands = [
      "research.data.import", "research.data.list", "research.figure.plan", "research.figure.render",
      "research.figure.status", "research.figure.export", "research.figure.cancel"
    ];
    for (const command of [
      ...workspaceCommands, "canvas.import-video", "canvas.generate-video", "canvas.import-skill", "canvas.export-image", ...graphCommands, ...requirementLibraryCommands,
      ...commerceTemplateCommands, ...commerceComparisonCommands, ...socialCommands, ...researchCommands,
      "commerce.export.preview", "commerce.export.package", "agent.chat", "agent.goal", "commerce.compose-set",
      "agent.steer", "agent.pause", "agent.resume", "agent.stop"
    ]) {
      assert.equal(rendererCommands.has(command), true, `${command} must be registered in the shared command schema`);
      assert.match(commandReference, new RegExp("`" + command.replace(".", "\\.") + "`"));
    }
    const workspaceDomainListSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "workspace.domain.list");
    const workspaceDomainGetSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "workspace.domain.get");
    const workspaceDomainSetSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "workspace.domain.set");
    const projectCreateSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "project.create");
    assert.equal(workspaceDomainListSchema.parameters.additionalProperties, false);
    assert.equal(workspaceDomainGetSchema.parameters.additionalProperties, false);
    assert.deepEqual(workspaceDomainSetSchema.parameters.required, ["domain", "expectedProjectId"]);
    assert.deepEqual(workspaceDomainSetSchema.parameters.properties.domain.enum, ["general", "commerce", "social", "research"]);
    assert.deepEqual(projectCreateSchema.parameters.properties.workspaceDomain.enum, ["general", "commerce", "social", "research"]);
    assert.deepEqual(generatedExample("workspace.domain.set"), { domain: "commerce", expectedProjectId: "PROJECT_ID" });
    assert.deepEqual(generatedExample("project.create"), { name: "Amazon launch", workspaceDomain: "commerce" });
    const goalSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "agent.goal");
    assert.deepEqual(goalSchema.parameters.required, ["prompt"]);
    assert.equal(goalSchema.parameters.properties.confirmed, undefined);
    assert.equal(goalSchema.parameters.properties.expectedSnapshotHash, undefined);
    assert.equal(goalSchema.parameters.properties.operationsPerAsset.default, 1);
    assert.equal(goalSchema.parameters.properties.operationsPerAsset.maximum, 200);
    assert.equal(goalSchema.parameters.properties.sourceNodeIds.maxItems, 200);
    assert.match(goalSchema.description, /sourceNodeIds/);
    assert.match(goalSchema.description, /operationsPerAsset/);
    assert.match(goalSchema.description, /explicit authorization/);
    assert.match(goalSchema.description, /one-time authorization receipt/);
    const commerceSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.compose-set");
    assert.deepEqual(commerceSchema.parameters.required, ["sourceNodeIds", "plan"]);
    assert.equal(commerceSchema.parameters.properties.sourceNodeIds.minItems, 1);
    assert.equal(commerceSchema.parameters.properties.plan.additionalProperties, false);
    const commerceLanguageCodes = commerceSetContract.languages.map((language) => language.code);
    const commercePlatformTemplateIds = commerceSetContract.platformTemplates.map((template) => template.id);
    const commerceExportPreviewSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.export.preview");
    const commerceExportPackageSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.export.package");
    const commerceCatalogReviewSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.catalog.review");
    const commerceTemplateSaveSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.template.save");
    const commerceTemplateDeleteSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.template.delete");
    const commerceTemplateExportSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.template.export");
    const commerceCatalogSelectSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.catalog.select");
    assert.deepEqual(commerceExportPreviewSchema.parameters.properties.platform.enum, ["amazon", "aliexpress"]);
    assert.deepEqual(commerceExportPreviewSchema.parameters.properties.format.enum, ["jpeg", "png"]);
    assert.equal(commerceExportPreviewSchema.parameters.properties.destinationPath, undefined);
    assert.equal(commerceExportPackageSchema.parameters.properties.destinationPath, undefined);
    assert.equal(commerceExportPackageSchema.parameters.required.includes("confirmed"), true);
    assert.deepEqual(commerceCatalogReviewSchema.parameters.properties.state.enum, ["candidate", "approved", "rejected"]);
    assert.equal(commerceCatalogReviewSchema.parameters.properties.linkIds.maxItems, 200);
    assert.equal(commerceCatalogReviewSchema.parameters.properties.linkIds.items.pattern, "^result-[a-f0-9]{32}$");
    assert.deepEqual(commerceTemplateSaveSchema.parameters.required, ["title", "plan"]);
    assert.deepEqual(commerceTemplateSaveSchema.parameters.properties.conflictPolicy.enum, ["overwrite", "copy"]);
    assert.match(commerceTemplateSaveSchema.description, /TEMPLATE_NAME_CONFLICT/);
    assert.match(commerceTemplateSaveSchema.description, /automatically numbered copy/);
    assert.equal(commerceTemplateSaveSchema.parameters.properties.plan.additionalProperties, false);
    assert.equal(commerceTemplateSaveSchema.parameters.properties.plan.properties.translationItems, undefined);
    assert.equal(commerceTemplateSaveSchema.parameters.properties.plan.properties.saveTarget, undefined);
    assert.equal(commerceTemplateDeleteSchema.destructive, true);
    assert.deepEqual(commerceTemplateDeleteSchema.parameters.required, ["templateId", "expectedTemplateRevision", "confirmed"]);
    assert.match(commerceTemplateExportSchema.parameters.properties.templateId.pattern, /commerce-builtin/);
    assert.deepEqual(commerceCatalogSelectSchema.parameters.required, [
      "expectedProjectId", "expectedCatalogRevision", "productId", "expectedProductRevision", "groupKey", "winnerLinkId"
    ]);
    const commercePlanProperties = commerceSchema.parameters.properties.plan.properties;
    assert.deepEqual(commercePlanProperties.platformTemplateId.enum, commercePlatformTemplateIds,
      "CLI platformTemplateId must contain the complete canonical commerce platform template registry");
    assert.equal(commercePlanProperties.platformTemplateId.default, commerceSetContract.defaults.platformTemplateId,
      "CLI platformTemplateId default must match the canonical commerce platform template registry");
    assert.deepEqual(commercePlanProperties.languageCodes.items.enum, commerceLanguageCodes,
      "CLI languageCodes must contain the complete canonical commerce language registry");
    assert.deepEqual(commercePlanProperties.targetLocales.items.properties.code.enum, commerceLanguageCodes,
      "CLI targetLocales codes must contain the complete canonical commerce language registry");
    assert.equal(commerceSchema.parameters.properties.confirmed, undefined);
    assert.equal(commerceSchema.parameters.properties.expectedSnapshotHash, undefined);
    assert.match(commerceSchema.description, /explicit authorization/);
    assert.match(commerceSchema.description, /one-time authorization receipt/);
    assert.equal(commerceSchema.examples.length, 3, "Commerce CLI schema must document Amazon, AliExpress, and translate plans");
    assert.equal(commerceSchema.examples[0].plan.mode, "generate");
    assert.equal(commerceSchema.examples[0].plan.platformTemplateId, "amazon");
    assert.equal(commerceSchema.examples[0].plan.saveTarget, "requirement");
    assert.equal(commerceSchema.examples[1].plan.platformTemplateId, "aliexpress");
    assert.ok(commerceSchema.examples[1].plan.slots.every((slot) => Boolean(slot.prompt)),
      "AliExpress example must demonstrate per-slot prompt overrides");
    assert.equal(commerceSchema.examples[2].plan.mode, "translate");
    assert.ok(commerceSchema.examples[2].plan.targetLocales.every((locale) => Boolean(locale.prompt)),
      "Translate example must demonstrate per-locale prompts");
    assert.equal(commerceSchema.examples[2].plan.saveTarget, "skill");
    assert.deepEqual(generatedExample("commerce.compose-set"), commerceSchema.examples[0],
      "Generated CLI reference must use the command-level commerce example");
    const goalSafetyNote = commandSchema.notes.find((note) => note.title === "Goal dispatch safety");
    assert.match(goalSafetyNote?.body || "", /Main-process Goal admission controller/);
    assert.match(goalSafetyNote?.body || "", /queued probes take priority over new ramp waves/);
    assert.match(goalSafetyNote?.body || "", /real provider Promise drains/);
    assert.match(goalSafetyNote?.body || "", /not a cost guarantee/);
    const rendererLifecycleNote = commandSchema.notes.find((note) => note.title === "Renderer lifecycle");
    assert.match(rendererLifecycleNote?.body || "", /immediately rejects its pending CLI commands/);
    assert.match(rendererLifecycleNote?.body || "", /without affecting other Renderer owners/);
    assert.match(rendererLifecycleNote?.body || "", /before transports are dismantled/);
    const steerSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "agent.steer");
    assert.deepEqual(steerSchema.parameters.properties.taskScopeMode.enum, [
      "keep", "replace-source", "merge-source", "replace-reference", "merge-reference", "clear-attachments"
    ]);
    assert.deepEqual(steerSchema.parameters.properties.sourceMode.enum, ["keep", "replace", "merge", "clear"]);
    assert.deepEqual(steerSchema.parameters.properties.referenceMode.enum, ["keep", "replace", "merge", "clear"]);
    assert.match(steerSchema.description, /never executes a valid subset/);
    const importVideoSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.import-video");
    assert.deepEqual(importVideoSchema.parameters.required, ["paths"]);
    assert.equal(importVideoSchema.parameters.additionalProperties, false);
    assert.equal(importVideoSchema.parameters.properties.paths.maxItems, 100);
    assert.match(importVideoSchema.description, /does not call a video model/);
    assert.match(importVideoSchema.description, /does not.*incur generation charges/);
    const generateVideoSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.generate-video");
    assert.deepEqual(generateVideoSchema.parameters.required, ["prompt", "expectedProjectId", "confirmed"]);
    assert.equal(generateVideoSchema.parameters.additionalProperties, false);
    assert.equal(generateVideoSchema.parameters.properties.seconds.maximum, 60);
    assert.deepEqual(generateVideoSchema.parameters.properties.aspectRatio.enum, ["16:9", "9:16", "1:1", "4:3", "3:4"]);
    assert.match(generateVideoSchema.description, /project journal before provider dispatch/);
    assert.match(generateVideoSchema.description, /never automatically recreates an ambiguous POST/);
    const importSkillSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.import-skill");
    assert.match(importSkillSchema.args, /markdown/);
    assert.match(importSkillSchema.description, /Skill-backed requirement node/);
    const exportImageSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.export-image");
    assert.equal(exportImageSchema.parameters.additionalProperties, false, "Export command JSON must reject arbitrary destination paths");
    assert.deepEqual(exportImageSchema.parameters?.properties?.format?.enum, ["png", "jpeg", "webp", "avif", "tiff"]);
    assert.deepEqual(Object.keys(exportImageSchema.formatDefinitions || {}), exportImageSchema.parameters.properties.format.enum);
    assert.match(commandReference, /PNG, JPEG, WebP, AVIF, or TIFF/);
    assert.match(exportImageSchema.description, /native Save dialog/);
    assert.match(exportImageSchema.description, /does not call an image model/);
    const connectSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.connect");
    assert.deepEqual(connectSchema.parameters.required, ["edges", "expectedProjectId"]);
    assert.equal(connectSchema.parameters.additionalProperties, false);
    const updateRequirementSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "canvas.update-requirement");
    assert.deepEqual(updateRequirementSchema.parameters.required, ["nodeId", "expectedRevision", "patch", "expectedProjectId"]);
    const libraryListSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "requirement-library.list");
    const librarySaveSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "requirement-library.save");
    const libraryDeleteSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "requirement-library.delete");
    const libraryUseSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "requirement-library.use");
    assert.equal(libraryListSchema.parameters.properties.includeText.default, false);
    assert.deepEqual(librarySaveSchema.parameters.required, ["nodeId", "expectedRequirementRevision", "expectedProjectId"]);
    assert.equal(librarySaveSchema.parameters.properties.templateId.pattern, "^reqtpl-[a-f0-9]{32}$");
    assert.equal(libraryDeleteSchema.destructive, true);
    assert.deepEqual(generatedExample("requirement-library.delete"), {
      templateId: "reqtpl-0123456789abcdef0123456789abcdef",
      expectedTemplateRevision: 1,
      confirmed: true
    });
    assert.match(libraryUseSchema.description, /never executes the Requirement/);
    assert.match(libraryUseSchema.description, /never spends image quota/);
    assert.equal(generatedExample("requirement-library.use").inputBindings[0].role, "source");
    assert.equal(generatedExample("canvas.connect").edges.length, 1, "Nested edge examples must satisfy minItems");
    assert.equal(generatedExample("canvas.group").nodeIds.length, 2, "Unique node examples must satisfy minItems without duplicates");
    assert.equal(Object.keys(generatedExample("canvas.update-requirement").patch).length, 1, "Nested patch examples must satisfy minProperties");
    assert.deepEqual(Object.keys(generatedExample("canvas.export-image")).sort(), ["assetIndex", "format", "nodeId"]);
    assert.deepEqual(generatedExample("canvas.import-video"), { paths: ["C:\\path\\video.mp4"], x: 240, y: 180 });
    assert.equal(generatedExample("canvas.generate-video").confirmed, true);
    assert.equal(generatedExample("canvas.generate-video").expectedProjectId, "PROJECT_ID");
    const xiaohongshuPlanSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "social.xiaohongshu.plan");
    const douyinPlanSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "social.douyin.plan");
    const douyinExecuteSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "social.douyin.execute");
    const socialExportSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "social.douyin.export");
    assert.deepEqual(xiaohongshuPlanSchema.parameters.properties.ratio.enum, ["3:4", "4:5", "1:1"]);
    assert.equal(xiaohongshuPlanSchema.parameters.properties.cardCount.default, 7);
    assert.deepEqual(douyinPlanSchema.parameters.properties.durationSeconds.enum, [15, 30, 60]);
    assert.equal(douyinPlanSchema.parameters.properties.shotCount.default, 6);
    assert.match(douyinExecuteSchema.description, /possible upstream billing/);
    assert.match(douyinExecuteSchema.description, /never retried automatically/);
    assert.equal(socialExportSchema.parameters.additionalProperties, false);
    assert.equal(socialExportSchema.parameters.properties.destinationPath, undefined);
    assert.deepEqual(generatedExample("social.xiaohongshu.plan").sourceNodeIds, ["A"]);
    assert.equal(generatedExample("social.douyin.plan").durationSeconds, 30);
    const researchPlanSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "research.figure.plan");
    const researchRenderSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "research.figure.render");
    const researchExportSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "research.figure.export");
    assert.deepEqual(researchPlanSchema.parameters.properties.backend.enum, scientificFigureContract.backends.map((item) => item.id));
    assert.deepEqual(researchPlanSchema.parameters.properties.figureType.enum, scientificFigureContract.figureTypes.map((item) => item.id));
    assert.deepEqual(researchPlanSchema.parameters.properties.panels.items.properties.chartType.enum, scientificFigureContract.chartTypes.map((item) => item.id));
    assert.deepEqual(researchPlanSchema.parameters.properties.outputFormats.items.enum, scientificFigureContract.outputFormats);
    assert.equal(researchPlanSchema.parameters.properties.researchClaim.maxLength, scientificFigureContract.limits.maxResearchClaimLength);
    assert.equal(researchRenderSchema.parameters.properties.timeoutMs.default, scientificFigureContract.limits.defaultTimeoutMs);
    assert.equal(researchExportSchema.parameters.properties.destinationPath, undefined);
    assert.deepEqual(generatedExample("research.figure.plan"), researchPlanSchema.examples[0]);
    assert.match(runtimeSource, /"canvas\.import-video"/);
    assert.match(runtimeSource, /context\.importVideoPaths/);
    assert.match(runtimeSource, /"canvas\.generate-video"/);
    assert.match(runtimeSource, /context\.generateVideo/);
    assert.match(runtimeSource, /"canvas\.import-skill"/);
    assert.match(runtimeSource, /context\.parseSkill/);
    assert.match(runtimeSource, /"canvas\.export-image"/);
    assert.match(runtimeSource, /context\.exportImage/);
    assert.match(runtimeSource, /context\.executeAuthorizedGoal\(prompt, scopeOptions\)/);
    assert.match(runtimeSource, /context\.executeAuthorizedGoal\(composed\.prompt, scopeOptions\)/);
    assert.match(runtimeSource, /"commerce\.compose-set"/);
    assert.match(runtimeSource, /"social\.xiaohongshu\.plan"/);
    assert.match(runtimeSource, /"social\.douyin\.status"/);
    assert.match(runtimeSource, /"research\.figure\.render"/);
    assert.match(runtimeSource, /context\.renderScientificTask/);
    const registryModule = await import(`${pathToFileURL(path.resolve(__dirname, "..", "src", "automation-command-registry.ts")).href}?automation-selftest=${Date.now()}`);
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("agent.goal"), true,
      "Generated Renderer command registry must contain agent.goal");
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("commerce.compose-set"), true,
      "Generated Renderer command registry must contain commerce.compose-set");
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("requirement-library.use"), true,
      "Generated Renderer command registry must contain the personal Requirement library commands");
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("canvas.import-video"), true,
      "Generated Renderer command registry must contain the local video import command");
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("canvas.generate-video"), true,
      "Generated Renderer command registry must contain the asynchronous video generation command");
    for (const command of workspaceCommands) {
      assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes(command), true,
        `Generated Renderer command registry must contain ${command}`);
    }
    for (const command of [...commerceTemplateCommands, ...commerceComparisonCommands]) {
      assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes(command), true,
        `Generated Renderer command registry must contain ${command}`);
    }
    for (const command of socialCommands) {
      assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes(command), true,
        `Generated Renderer command registry must contain ${command}`);
    }
    for (const command of researchCommands) {
      assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes(command), true,
        `Generated Renderer command registry must contain ${command}`);
    }
    assert.deepEqual([...registryModule.AUTOMATION_COMMAND_ENUMS["canvas.export-image"].format], exportImageSchema.parameters.properties.format.enum,
      "Renderer format validation must be generated from the shared command schema");
    assert.deepEqual([...registryModule.AUTOMATION_COMMAND_ENUMS["agent.steer"].taskScopeMode], steerSchema.parameters.properties.taskScopeMode.enum,
      "Renderer steer-mode validation must be generated from the shared command schema");
    const runtimeModule = await import(`${pathToFileURL(path.resolve(__dirname, "..", "src", "automation-command-runtime.ts")).href}?automation-selftest=${Date.now()}`);
    const exportCalls = [];
    const exportResult = await runtimeModule.executeAutomationCommand("canvas.export-image", {
      nodeId: "image-a",
      assetIndex: 0,
      format: "avif"
    }, {
      nodes: () => [{ id: "image-a", assets: [{ id: "asset-a" }] }],
      exportImage: async (nodeId, assetIndex, format) => {
        exportCalls.push({ nodeId, assetIndex, format });
        return { ok: true, path: "C:\\exports\\image.avif", format };
      }
    });
    assert.deepEqual(exportCalls, [{ nodeId: "image-a", assetIndex: 0, format: "avif" }]);
    assert.equal(exportResult.requestedFormat, "avif");
    assert.equal(exportResult.result.format, "avif");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.export-image", { nodeId: "image-a", assetIndex: 0, format: "bmp" }, {
        nodes: () => [{ id: "image-a", assets: [{ id: "asset-a" }] }],
        exportImage: async () => ({ ok: true })
      }),
      (error) => error.code === "INVALID_ARGUMENT" && /format.*枚举值/.test(error.message)
    );
    const exportCallCountBeforeUnsafePath = exportCalls.length;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.export-image", {
        nodeId: "image-a",
        assetIndex: 0,
        format: "png",
        destinationPath: "C:\\sensitive\\forced.png"
      }, {
        nodes: () => [{ id: "image-a", assets: [{ id: "asset-a" }] }],
        exportImage: async () => ({ ok: true })
      }),
      (error) => error.code === "INVALID_ARGUMENT" && error.details?.unexpected?.includes("destinationPath"),
      "The shared schema must reject an arbitrary export destination before opening a picker"
    );
    assert.equal(exportCalls.length, exportCallCountBeforeUnsafePath);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.export-image", { nodeId: "image-a", assetIndex: 0, format: "png" }, {
        nodes: () => [{ id: "image-a", assets: [{ id: "asset-a" }] }],
        exportImage: async () => ({ ok: false, error: "disk target became unavailable" })
      }),
      /disk target became unavailable/,
      "A real export failure must propagate to the CLI response instead of being nested below ok:true"
    );
    const canceledExport = await runtimeModule.executeAutomationCommand("canvas.export-image", { nodeId: "image-a", assetIndex: 0, format: "png" }, {
      nodes: () => [{ id: "image-a", assets: [{ id: "asset-a" }] }],
      exportImage: async () => ({ ok: true, canceled: true })
    });
    assert.equal(canceledExport.result.canceled, true, "User cancellation remains a successful non-mutating command outcome");

    let canvasRevision = 17;
    let automationWorkspaceDomain = "general";
    let automationSelection = { primaryId: "", ids: [] };
    const canvasNodes = [
      { id: "A", title: "A", prompt: "", type: "image", status: "done", x: 10, y: 20, branch: "test", outputs: 1, createdAt: "now", assets: [{ assetId: "asset-a", path: "A.png" }] },
      { id: "B", title: "B", prompt: "", type: "image", status: "done", x: 30, y: 40, branch: "test", outputs: 1, createdAt: "now", assets: [{ assetId: "asset-b", path: "B.png" }] },
      {
        id: "REQ", title: "Requirement", prompt: "Edit", type: "requirement", status: "done", x: 80, y: 40,
        branch: "test", outputs: 0, createdAt: "now", parentId: "A", relationType: "referenced",
        requirement: { version: 2, revision: 3, text: "Edit", createdFrom: "node", inputBindings: [{ nodeId: "A", role: "source" }] }
      },
      {
        id: "VIDEO", title: "Video", prompt: "Orbit", type: "video", status: "running", x: 120, y: 40,
        branch: "test", outputs: 0, createdAt: "now", videoModel: "doubao-seedance-2-0-260128",
        videoTaskId: "video-task-existing", videoTaskState: "running", videoProgress: 42
      }
    ];
    const graphCalls = [];
    const libraryCalls = [];
    const commerceTemplateCalls = [];
    const catalogCalls = [];
    const commerceComparisonCalls = [];
    const commerceExportCalls = [];
    const projectCreateCalls = [];
    const videoImportCalls = [];
    const videoGenerateCalls = [];
    const canvasRuntimeContext = {
      activeProjectId: () => "PROJECT",
      workspaceDomain: () => automationWorkspaceDomain,
      setWorkspaceDomain: (domain) => {
        if (domain === automationWorkspaceDomain) return false;
        automationWorkspaceDomain = domain;
        return true;
      },
      activeConversationId: () => "CONVERSATION",
      agentStatus: () => "idle",
      activeRunId: () => "",
      agentPaused: () => false,
      viewport: () => ({ x: 0, y: 0, scale: 1 }),
      selection: () => automationSelection,
      canvasRevision: () => canvasRevision,
      lockedNodeIds: () => ["B"],
      mutationLocks: (ids) => ids.includes("B") ? ["B"] : [],
      projects: () => [{ id: "PROJECT", name: "Project" }],
      createProject: async (name, workspaceDomain) => {
        projectCreateCalls.push({ name, workspaceDomain });
        return { ok: true };
      },
      nodes: () => canvasNodes,
      layoutGroups: () => [],
      messages: () => [],
      selectNodes: (ids, primaryId) => { automationSelection = { primaryId, ids }; },
      parseSkill: async () => ({
        version: 1,
        name: "product-photo",
        instructions: "Keep product identity.",
        contentFingerprint: "skill-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        importedAt: "2026-07-29T00:00:00.000Z"
      }),
      createSkillNode: () => ({
        id: "REQ",
        created: false,
        exact: false,
        conflict: "locally-modified",
        skill: {
          version: 1,
          name: "product-photo",
          contentFingerprint: "skill-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          importedAt: "2026-07-29T00:00:00.000Z",
          locallyModifiedAt: "2026-07-29T01:00:00.000Z"
        }
      }),
      importVideoPaths: async (paths, x, y) => {
        videoImportCalls.push({ paths, x, y });
        return { ok: true, ids: ["VIDEO-1"] };
      },
      generateVideo: async (input) => {
        videoGenerateCalls.push(input);
        return {
          ok: true,
          task: {
            taskId: "video-task-new",
            projectId: input.expectedProjectId,
            state: "queued",
            model: input.model || "doubao-seedance-2-0-260128"
          },
          nodeId: "VIDEO-NEW"
        };
      },
      connectCanvas: (input) => { graphCalls.push({ command: "connect", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      disconnectCanvas: (input) => { graphCalls.push({ command: "disconnect", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      groupCanvas: (input) => { graphCalls.push({ command: "group", input }); canvasRevision += 1; return { changed: true, hostNodeId: "A", canvasRevision }; },
      dissolveCanvas: (input) => { graphCalls.push({ command: "dissolve", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      nudgeCanvas: (input) => { graphCalls.push({ command: "nudge", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      createRequirement: (input) => { graphCalls.push({ command: "create-requirement", input }); canvasRevision += 1; return { changed: true, nodeId: "REQ-2", canvasRevision }; },
      updateRequirement: (input) => { graphCalls.push({ command: "update-requirement", input }); canvasRevision += 1; return { changed: true, nodeId: input.nodeId, canvasRevision }; },
      executeRequirement: async (input) => { graphCalls.push({ command: "execute-requirement", input }); return { accepted: true, nodeId: input.nodeId }; },
      listRequirementLibrary: async (includeText) => {
        libraryCalls.push({ command: "list", includeText });
        return { ok: true, libraryRevision: 4, items: [{ id: "reqtpl-0123456789abcdef0123456789abcdef", revision: 2, title: "Hero" }] };
      },
      saveRequirementLibrary: async (input) => {
        libraryCalls.push({ command: "save", input });
        return { ok: true, changed: true, libraryRevision: 5, entry: { id: "reqtpl-0123456789abcdef0123456789abcdef", revision: 1 } };
      },
      deleteRequirementLibrary: async (input) => {
        libraryCalls.push({ command: "delete", input });
        return { ok: true, changed: true, libraryRevision: 6, id: input.templateId };
      },
      useRequirementLibrary: async (input) => {
        libraryCalls.push({ command: "use", input });
        canvasRevision += 1;
        return { changed: true, nodeId: "REQ-LIB", canvasRevision };
      },
      listCommerceTemplates: async () => {
        commerceTemplateCalls.push({ command: "list" });
        return { ok: true, schemaVersion: 1, libraryRevision: 3, items: [{ id: "commerce-builtin-amazon", source: "builtin", title: "Amazon" }] };
      },
      saveCommerceTemplate: async (input) => {
        commerceTemplateCalls.push({ command: "save", input });
        return {
          ok: true,
          changed: true,
          libraryRevision: 4,
          entry: {
            id: input.id || `commerce-template-${(input.conflictPolicy === "copy" ? "c" : "a").repeat(32)}`,
            revision: (input.expectedRevision || 0) + 1,
            title: input.title,
            plan: input.plan
          }
        };
      },
      deleteCommerceTemplate: async (input) => {
        commerceTemplateCalls.push({ command: "delete", input });
        return { ok: true, changed: true, libraryRevision: 5, id: input.id };
      },
      importCommerceTemplate: async () => {
        commerceTemplateCalls.push({ command: "import" });
        return { ok: true, changed: true, libraryRevision: 6, entry: { id: `commerce-template-${"b".repeat(32)}`, revision: 1 } };
      },
      exportCommerceTemplate: async (input) => {
        commerceTemplateCalls.push({ command: "export", input });
        return { ok: true, canceled: false, fileName: "amazon-template.json" };
      },
      listCommerceCatalog: async (input) => {
        catalogCalls.push({ command: "list", input });
        return { ok: true, catalogRevision: 0, catalog: { products: [] } };
      },
      saveCommerceCatalogProduct: async (input) => {
        catalogCalls.push({ command: "upsert", input });
        return { ok: true, changed: true, catalogRevision: 1, product: { productId: "product-11111111111111111111111111111111", revision: 1 } };
      },
      archiveCommerceCatalogProduct: async (input) => {
        catalogCalls.push({ command: "delete", input });
        return { ok: true, changed: true, catalogRevision: 2, product: { productId: input.productId, revision: 2, status: "archived" } };
      },
      assignCommerceCatalogAssets: async (input) => {
        catalogCalls.push({ command: "assign", input });
        return { ok: true, changed: true, catalogRevision: 3 };
      },
      removeCommerceCatalogAsset: async (input) => {
        catalogCalls.push({ command: "remove", input });
        return { ok: true, changed: true, catalogRevision: 4 };
      },
      updateCommerceCatalogResultState: async (input) => {
        catalogCalls.push({ command: "review", input });
        return {
          ok: true,
          changed: true,
          catalogRevision: Number(input.expectedCatalogRevision) + 1,
          product: {
            productId: input.productId,
            revision: Number(input.expectedProductRevision) + 1,
            assets: [{ linkId: input.linkId, state: input.state }]
          }
        };
      },
      listCommerceCatalogComparisons: async (input) => {
        commerceComparisonCalls.push({ command: "compare", input });
        return { ok: true, catalogRevision: 6, groups: [{ groupKey: `comparison-${"c".repeat(32)}`, candidates: [{}, {}] }] };
      },
      selectCommerceCatalogComparisonWinner: async (input) => {
        commerceComparisonCalls.push({ command: "select", input });
        return { ok: true, changed: true, catalogRevision: input.expectedCatalogRevision + 1, selectedLinkId: input.winnerLinkId };
      },
      previewCommerceExport: async (input) => {
        commerceExportCalls.push({ command: "preview", input });
        return { ok: true, catalogRevision: input.expectedCatalogRevision, summary: { packages: 1, images: 2, validImages: 2, warnings: 0, blockingIssues: 0 } };
      },
      exportCommercePackage: async (input) => {
        commerceExportCalls.push({ command: "package", input });
        return { ok: true, canceled: true };
      },
      agentBusy: () => false
    };
    const listedDomains = await runtimeModule.executeAutomationCommand("workspace.domain.list", {}, canvasRuntimeContext);
    assert.equal(listedDomains.defaultDomain, "general");
    assert.deepEqual(listedDomains.domains.map((domain) => domain.id), ["general", "commerce", "social", "research"]);
    assert.equal(listedDomains.domains.some((domain) => Object.hasOwn(domain, "defaultPrompt")), false,
      "Public domain inspection must not expose injected Agent prompt text");
    const initialDomain = await runtimeModule.executeAutomationCommand("workspace.domain.get", {}, canvasRuntimeContext);
    assert.equal(initialDomain.domain.id, "general");
    const switchedDomain = await runtimeModule.executeAutomationCommand("workspace.domain.set", {
      domain: "commerce",
      expectedProjectId: "PROJECT"
    }, canvasRuntimeContext);
    assert.equal(switchedDomain.changed, true);
    assert.equal(switchedDomain.domain.id, "commerce");
    const unchangedDomain = await runtimeModule.executeAutomationCommand("workspace.domain.set", {
      domain: "commerce",
      expectedProjectId: "PROJECT"
    }, canvasRuntimeContext);
    assert.equal(unchangedDomain.changed, false);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("workspace.domain.set", {
        domain: "research",
        expectedProjectId: "STALE-PROJECT"
      }, canvasRuntimeContext),
      (error) => error.code === "PROJECT_MISMATCH"
    );
    assert.equal(automationWorkspaceDomain, "commerce", "A stale project guard must not change the workspace domain");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("workspace.domain.set", {
        domain: "unknown",
        expectedProjectId: "PROJECT"
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT"
    );
    await runtimeModule.executeAutomationCommand("project.create", { name: "Inherited" }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("project.create", {
      name: "Research",
      workspaceDomain: "research"
    }, canvasRuntimeContext);
    assert.deepEqual(projectCreateCalls, [
      { name: "Inherited", workspaceDomain: "commerce" },
      { name: "Research", workspaceDomain: "research" }
    ]);
    const authoritativeState = await runtimeModule.executeAutomationCommand("canvas.state", {}, canvasRuntimeContext);
    assert.equal(authoritativeState.canvasRevision, 17);
    assert.equal(authoritativeState.workspaceDomain, "commerce");
    assert.deepEqual(authoritativeState.locks.lockedNodeIds, ["B"]);
    assert.equal(authoritativeState.nodes.find((node) => node.id === "REQ").requirement.revision, 3);
    assert.equal(authoritativeState.nodes.find((node) => node.id === "REQ").relation.parentId, "A");
    assert.equal(authoritativeState.nodes.find((node) => node.id === "B").activity.locked, true);
    assert.deepEqual(authoritativeState.nodes.find((node) => node.id === "VIDEO").video, {
      state: undefined,
      mimeType: undefined,
      originalName: undefined,
      width: undefined,
      height: undefined,
      durationMs: undefined,
      model: "doubao-seedance-2-0-260128",
      taskId: "video-task-existing",
      taskState: "running",
      progress: 42
    });
    const importConflict = await runtimeModule.executeAutomationCommand("canvas.import-skill", { markdown: "ignored" }, canvasRuntimeContext);
    assert.equal(importConflict.created, false);
    assert.equal(importConflict.exact, false);
    assert.equal(importConflict.conflict, "locally-modified");
    await runtimeModule.executeAutomationCommand("canvas.import-video", {
      paths: ["C:\\media\\hero.mp4", "C:\\media\\detail.webm"],
      x: 360,
      y: 220
    }, canvasRuntimeContext);
    assert.deepEqual(videoImportCalls, [{
      paths: ["C:\\media\\hero.mp4", "C:\\media\\detail.webm"],
      x: 360,
      y: 220
    }]);
    const generatedVideo = await runtimeModule.executeAutomationCommand("canvas.generate-video", {
      prompt: "Slow orbit around the exact product.",
      model: "doubao-seedance-2-0-260128",
      seconds: 5,
      aspectRatio: "16:9",
      resolution: "720p",
      x: 420,
      y: 260,
      expectedProjectId: "PROJECT",
      confirmed: true
    }, canvasRuntimeContext);
    assert.equal(generatedVideo.task.taskId, "video-task-new");
    assert.deepEqual(videoGenerateCalls, [{
      expectedProjectId: "PROJECT",
      prompt: "Slow orbit around the exact product.",
      model: "doubao-seedance-2-0-260128",
      seconds: 5,
      aspectRatio: "16:9",
      resolution: "720p",
      x: 420,
      y: 260
    }]);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.generate-video", {
        prompt: "Do not dispatch without confirmation.",
        expectedProjectId: "PROJECT",
        confirmed: false
      }, canvasRuntimeContext),
      /confirmed=true/
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.generate-video", {
        prompt: "Do not dispatch into a stale project.",
        expectedProjectId: "STALE-PROJECT",
        confirmed: true
      }, canvasRuntimeContext),
      (error) => error.code === "PROJECT_REVISION_CONFLICT"
    );
    assert.equal(videoGenerateCalls.length, 1, "Invalid video commands must never reach the provider task bridge");
    await runtimeModule.executeAutomationCommand("canvas.select", { ids: ["A", "B"], primaryId: "B", expectedProjectId: "PROJECT" }, canvasRuntimeContext);
    assert.deepEqual(automationSelection, { primaryId: "B", ids: ["A", "B"] });
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.select", { ids: ["A", "STALE"], primaryId: "A" }, canvasRuntimeContext),
      (error) => error.code === "NODE_NOT_FOUND" && error.details?.nodeIds?.includes("STALE")
    );
    assert.deepEqual(automationSelection, { primaryId: "B", ids: ["A", "B"] }, "A stale mixed selection must not partially commit");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("canvas.select", { ids: ["A"], primaryId: "B" }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT"
    );
    await runtimeModule.executeAutomationCommand("canvas.connect", {
      edges: [{ sourceId: "A", targetId: "REQ", relationType: "referenced", inputRole: "source" }],
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: 17
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("canvas.disconnect", {
      edges: [{ sourceId: "A", targetId: "REQ" }], expectedProjectId: "PROJECT", expectedCanvasRevision: 18
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("canvas.group", {
      nodeIds: ["A", "B"], primaryId: "A", expectedProjectId: "PROJECT", expectedCanvasRevision: 19
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("canvas.dissolve", {
      containerIds: ["A"], expectedProjectId: "PROJECT", expectedCanvasRevision: 20
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("canvas.nudge", {
      nodeIds: ["A"], dx: 12, dy: -8, expectedProjectId: "PROJECT", expectedCanvasRevision: 21
    }, canvasRuntimeContext);
    const createdRequirement = await runtimeModule.executeAutomationCommand("canvas.create-requirement", {
      title: "New", text: "Create a variant", inputBindings: [{ nodeId: "A", role: "source" }],
      expectedProjectId: "PROJECT", expectedCanvasRevision: 22
    }, canvasRuntimeContext);
    assert.equal(createdRequirement.nodeId, "REQ-2");
    await runtimeModule.executeAutomationCommand("canvas.update-requirement", {
      nodeId: "REQ", expectedRevision: 3, patch: { text: "Updated" },
      expectedProjectId: "PROJECT", expectedCanvasRevision: 23
    }, canvasRuntimeContext);
    const executedRequirement = await runtimeModule.executeAutomationCommand("canvas.execute-requirement", {
      nodeId: "REQ", expectedRevision: 3, expectedProjectId: "PROJECT"
    }, canvasRuntimeContext);
    assert.equal(executedRequirement.accepted, true);
    assert.deepEqual(graphCalls.map((call) => call.command), [
      "connect", "disconnect", "group", "dissolve", "nudge", "create-requirement", "update-requirement", "execute-requirement"
    ]);
    assert.equal(graphCalls[0].input.expectedCanvasRevision, 17);
    assert.deepEqual(graphCalls[0].input.edges[0], { sourceId: "A", targetId: "REQ", relationType: "referenced", inputRole: "source" });
    assert.equal(graphCalls.at(-1).input.confirmedUnchanged, false);

    const listedLibrary = await runtimeModule.executeAutomationCommand("requirement-library.list", {}, canvasRuntimeContext);
    assert.equal(listedLibrary.items[0].title, "Hero");
    const savedLibrary = await runtimeModule.executeAutomationCommand("requirement-library.save", {
      nodeId: "REQ",
      expectedRequirementRevision: 3,
      expectedProjectId: "PROJECT"
    }, canvasRuntimeContext);
    assert.equal(savedLibrary.entry.revision, 1);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("requirement-library.save", {
        nodeId: "REQ",
        expectedRequirementRevision: 3,
        templateId: "reqtpl-0123456789abcdef0123456789abcdef",
        expectedProjectId: "PROJECT"
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && /expectedTemplateRevision/.test(error.message)
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("requirement-library.delete", {
        templateId: "reqtpl-0123456789abcdef0123456789abcdef",
        expectedTemplateRevision: 1,
        confirmed: false
      }, canvasRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    await runtimeModule.executeAutomationCommand("requirement-library.delete", {
      templateId: "reqtpl-0123456789abcdef0123456789abcdef",
      expectedTemplateRevision: 1,
      confirmed: true
    }, canvasRuntimeContext);
    const usedLibrary = await runtimeModule.executeAutomationCommand("requirement-library.use", {
      templateId: "reqtpl-0123456789abcdef0123456789abcdef",
      expectedTemplateRevision: 1,
      inputBindings: [{ nodeId: "A", role: "source" }],
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: 24
    }, canvasRuntimeContext);
    assert.equal(usedLibrary.nodeId, "REQ-LIB");
    assert.equal(usedLibrary.state.canvasRevision, 25);
    assert.deepEqual(libraryCalls.map((call) => call.command), ["list", "save", "delete", "use"]);
    assert.equal(libraryCalls[0].includeText, false);
    assert.equal(libraryCalls.at(-1).input.expectedTemplateRevision, 1);

    let socialCanvasRevision = 1;
    const socialNodes = canvasNodes.slice(0, 2).map((node) => structuredClone(node));
    const socialCalls = [];
    const socialRuntimeContext = {
      ...canvasRuntimeContext,
      canvasRevision: () => socialCanvasRevision,
      lockedNodeIds: () => [],
      mutationLocks: () => [],
      nodes: () => socialNodes,
      createRequirement: (input) => {
        socialCalls.push({ command: "plan", input });
        const nodeId = input.socialPlan.platform === "xiaohongshu" ? "SOCIAL-XHS" : "SOCIAL-DY";
        socialNodes.push({
          id: nodeId,
          title: input.title,
          prompt: input.text,
          type: "requirement",
          status: "done",
          x: input.x || 200,
          y: input.y || 160,
          branch: "project-agent",
          outputs: 0,
          createdAt: "now",
          requirement: {
            version: 2,
            revision: 1,
            text: input.text,
            createdFrom: input.inputBindings.length ? "node" : "canvas",
            inputBindings: input.inputBindings,
            socialPlan: input.socialPlan
          }
        });
        socialCanvasRevision += 1;
        return { changed: true, nodeId, requirementRevision: 1, canvasRevision: socialCanvasRevision };
      },
      composePluginTask: async (payload) => {
        socialCalls.push({ command: "compose", payload });
        return { ok: true, task: composePluginTask(payload) };
      },
      executeRequirement: async (input) => {
        socialCalls.push({ command: "execute", input });
        const requirement = socialNodes.find((node) => node.id === input.nodeId);
        const plan = requirement.requirement.socialPlan;
        if (plan.platform === "xiaohongshu") {
          socialNodes.push({
            id: "SOCIAL-XHS-COVER",
            title: "小红书封面",
            prompt: "fixture",
            type: "image",
            status: "done",
            x: 400,
            y: 160,
            branch: "project-agent",
            outputs: 1,
            createdAt: "now",
            assets: [{ assetId: "social-cover" }],
            socialContent: { platform: "xiaohongshu", contentType: "cover", workflowId: plan.workflowId, slot: "cover", status: "generated" }
          });
        } else {
          socialNodes.push({
            id: "SOCIAL-DY-VIDEO",
            title: "抖音视频",
            prompt: "fixture",
            type: "video",
            status: "review",
            x: 400,
            y: 260,
            branch: "video-generation",
            outputs: 0,
            createdAt: "now",
            videoTaskId: "video-task-social",
            videoTaskState: "create-unknown",
            videoState: "error",
            videoError: "provider response was ambiguous",
            socialContent: { platform: "douyin", contentType: "video", workflowId: plan.workflowId, slot: "video", status: "draft" }
          });
        }
        return { accepted: true, nodeId: input.nodeId };
      },
      exportSocialPackage: async (input) => {
        socialCalls.push({ command: "export", input });
        return { ok: true, exported: true, folderName: "social-package", images: 1, videos: input.requirementNodeId === "SOCIAL-DY" ? 1 : 0 };
      }
    };
    const xiaohongshuPlan = await runtimeModule.executeAutomationCommand("social.xiaohongshu.plan", {
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: 1,
      sourceNodeIds: ["A"],
      brief: "通勤防晒经验",
      contentKind: "experience-share",
      ratio: "3:4",
      cardCount: 7
    }, socialRuntimeContext);
    assert.equal(xiaohongshuPlan.nodeId, "SOCIAL-XHS");
    assert.equal(xiaohongshuPlan.dispatched, false);
    assert.equal(xiaohongshuPlan.mayProduceCharges, false);
    assert.deepEqual(xiaohongshuPlan.plannedRequests, { imageRequests: 8, videoRequests: 0, totalRequests: 8 });
    const xiaohongshuExecution = await runtimeModule.executeAutomationCommand("social.xiaohongshu.execute", {
      expectedProjectId: "PROJECT",
      nodeId: "SOCIAL-XHS",
      expectedRevision: 1
    }, socialRuntimeContext);
    assert.equal(xiaohongshuExecution.billing.requestCount, 8);
    assert.equal(xiaohongshuExecution.billing.dispatched, true);
    assert.equal(xiaohongshuExecution.billing.mayProduceCharges, true);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("social.xiaohongshu.export", {
        expectedProjectId: "PROJECT",
        nodeId: "SOCIAL-XHS",
        expectedRevision: 1,
        confirmed: false
      }, socialRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    const xiaohongshuExport = await runtimeModule.executeAutomationCommand("social.xiaohongshu.export", {
      expectedProjectId: "PROJECT",
      nodeId: "SOCIAL-XHS",
      expectedRevision: 1,
      confirmed: true
    }, socialRuntimeContext);
    assert.equal(xiaohongshuExport.exported, true);

    const douyinPlan = await runtimeModule.executeAutomationCommand("social.douyin.plan", {
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: socialCanvasRevision,
      sourceNodeIds: ["A"],
      brief: "新品咖啡杯展示",
      format: "product-showcase",
      durationSeconds: 30,
      shotCount: 6
    }, socialRuntimeContext);
    assert.equal(douyinPlan.nodeId, "SOCIAL-DY");
    assert.deepEqual(douyinPlan.plannedRequests, { imageRequests: 7, videoRequests: 1, totalRequests: 8 });
    const douyinExecution = await runtimeModule.executeAutomationCommand("social.douyin.execute", {
      expectedProjectId: "PROJECT",
      nodeId: "SOCIAL-DY",
      expectedRevision: 1
    }, socialRuntimeContext);
    assert.equal(douyinExecution.billing.requestCount, 8);
    assert.equal(douyinExecution.billing.dispatched, true);
    assert.equal(douyinExecution.billing.ambiguous, true);
    const douyinStatus = await runtimeModule.executeAutomationCommand("social.douyin.status", {
      expectedProjectId: "PROJECT",
      nodeId: "SOCIAL-DY"
    }, socialRuntimeContext);
    assert.equal(douyinStatus.ambiguous, true);
    assert.equal(douyinStatus.outcomes.videos[0].videoTaskState, "create-unknown");
    assert.equal(JSON.stringify(douyinStatus).includes("provider.example"), false);
    const socialExportCallsBeforeUnsafePath = socialCalls.filter((call) => call.command === "export").length;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("social.douyin.export", {
        expectedProjectId: "PROJECT",
        nodeId: "SOCIAL-DY",
        expectedRevision: 1,
        confirmed: true,
        destinationPath: "C:\\private\\forced-export"
      }, socialRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && error.details?.unexpected?.includes("destinationPath")
    );
    assert.equal(socialCalls.filter((call) => call.command === "export").length, socialExportCallsBeforeUnsafePath);
    const douyinExport = await runtimeModule.executeAutomationCommand("social.douyin.export", {
      expectedProjectId: "PROJECT",
      nodeId: "SOCIAL-DY",
      expectedRevision: 1,
      confirmed: true
    }, socialRuntimeContext);
    assert.equal(douyinExport.exported, true);
    assert.equal(socialCalls.filter((call) => call.command === "compose").length, 2);
    assert.equal(socialCalls.filter((call) => call.command === "execute").length, 2);
    assert.equal(socialCalls.filter((call) => call.command === "export").length, 2);

    let researchCanvasRevision = 1;
    const researchDataSource = {
      id: `scientific-data-${"1".repeat(32)}`,
      sourceName: "measurements.csv",
      contentHash: "2".repeat(64),
      size: 128,
      rowCount: 3,
      columnCount: 3,
      fields: ["time", "control", "treated"],
      delimiter: ","
    };
    const researchNodes = [structuredClone(canvasNodes[0])];
    const researchTasks = [];
    const researchCalls = [];
    let researchTaskSequence = 0;
    const makeResearchTask = (input) => {
      const digit = String((researchTaskSequence++ % 8) + 1);
      return {
        taskId: `scientific-task-${digit.repeat(32)}`,
        projectId: input.expectedProjectId,
        workflowId: input.plan.workflowId,
        planHash: input.plan.planHash,
        requirementNodeId: input.requirementNodeId,
        requirementRevision: input.expectedRequirementRevision,
        backend: input.plan.backend,
        state: "ready",
        progress: 100,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:01.000Z",
        finishedAt: "2026-08-03T00:00:01.000Z",
        scriptHash: "3".repeat(64),
        outputs: [{
          outputId: `scientific-output-${"4".repeat(32)}`,
          kind: "figure",
          format: "png",
          name: "figure-preview.png",
          relativePath: ".naimage/scientific/output/figure-preview.png",
          assetUrl: "naimage-test://C%3A%5Cprivate%5Cfigure-preview.png",
          mimeType: "image/png",
          size: 256,
          contentHash: "4".repeat(64)
        }],
        plan: input.plan
      };
    };
    const researchRuntimeContext = {
      ...canvasRuntimeContext,
      canvasRevision: () => researchCanvasRevision,
      lockedNodeIds: () => [],
      mutationLocks: () => [],
      nodes: () => researchNodes,
      importScientificData: async (input) => {
        researchCalls.push({ command: "import", input });
        return { ok: true, canceled: true };
      },
      listScientificData: async (input) => {
        researchCalls.push({ command: "list-data", input });
        return [researchDataSource];
      },
      composePluginTask: async (payload) => {
        researchCalls.push({ command: "compose", payload });
        return { ok: true, task: composePluginTask(payload) };
      },
      createRequirement: (input) => {
        researchCalls.push({ command: "plan", input });
        const nodeId = "RESEARCH-REQ";
        researchNodes.push({
          id: nodeId,
          title: input.title,
          prompt: input.text,
          type: "requirement",
          status: "done",
          x: input.x || 200,
          y: input.y || 160,
          branch: "project-agent",
          outputs: 0,
          createdAt: "now",
          requirement: {
            version: 2,
            revision: 1,
            text: input.text,
            createdFrom: input.inputBindings.length ? "node" : "canvas",
            inputBindings: input.inputBindings,
            scientificPlan: input.scientificPlan
          },
          scientificFigure: {
            workflowId: input.scientificPlan.workflowId,
            planHash: input.scientificPlan.planHash,
            kind: "plan",
            backend: input.scientificPlan.backend,
            status: "planned"
          }
        });
        researchCanvasRevision += 1;
        return { changed: true, nodeId, requirementRevision: 1, canvasRevision: researchCanvasRevision };
      },
      renderScientificTask: async (input) => {
        researchCalls.push({ command: "render", input });
        const task = makeResearchTask(input);
        researchTasks.unshift(task);
        return task;
      },
      landScientificTask: (task, saved) => {
        researchCalls.push({ command: "land", taskId: task.taskId, saved });
        const requirement = researchNodes.find((node) => node.id === saved.requirementNodeId);
        requirement.requirement.revision += 1;
        requirement.requirement.scientificPlan = { ...saved.plan, status: "rendered", taskId: task.taskId };
        researchNodes.push({
          id: "RESEARCH-FIGURE",
          title: "论文图",
          prompt: saved.plan.researchClaim,
          type: "image",
          status: "done",
          x: 420,
          y: 160,
          branch: "scientific-figure",
          outputs: 1,
          createdAt: "now",
          assets: [{ assetId: task.outputs[0].outputId }],
          scientificFigure: { workflowId: task.workflowId, planHash: task.planHash, kind: "figure", taskId: task.taskId, status: "rendered" }
        });
        researchCanvasRevision += 1;
        return { landed: true, createdNodeIds: ["RESEARCH-FIGURE"] };
      },
      listScientificTasks: async (input) => {
        researchCalls.push({ command: "list-tasks", input });
        return researchTasks;
      },
      exportScientificTask: async (input) => {
        researchCalls.push({ command: "export", input });
        return { ok: true, exported: true, folderName: "SparkAI-scientific", fileCount: 5 };
      },
      cancelScientificTask: async (input) => {
        researchCalls.push({ command: "cancel", input });
        const current = researchTasks.find((task) => task.taskId === input.taskId) || researchTasks[0];
        return { ...current, state: "cancelled", updatedAt: "2026-08-03T00:00:02.000Z" };
      }
    };
    const canceledResearchImport = await runtimeModule.executeAutomationCommand("research.data.import", {
      expectedProjectId: "PROJECT"
    }, researchRuntimeContext);
    assert.equal(canceledResearchImport.canceled, true);
    const listedResearchData = await runtimeModule.executeAutomationCommand("research.data.list", {
      expectedProjectId: "PROJECT"
    }, researchRuntimeContext);
    assert.equal(listedResearchData.dataSources[0].id, researchDataSource.id);
    const researchPlan = await runtimeModule.executeAutomationCommand("research.figure.plan", {
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: 1,
      sourceNodeIds: ["A"],
      backend: "python",
      figureType: "statistical-chart",
      researchClaim: "处理组随时间呈现更高的测量值，不在此处推断显著性。",
      dataSourceIds: [researchDataSource.id],
      panels: [{
        id: "panel-a",
        label: "A",
        chartType: "line",
        sourceBindings: [researchDataSource.id],
        xField: "time",
        yFields: ["control", "treated"]
      }]
    }, researchRuntimeContext);
    assert.equal(researchPlan.nodeId, "RESEARCH-REQ");
    assert.equal(researchPlan.dispatched, false);
    assert.equal(researchPlan.mayProduceCharges, false);
    assert.equal(researchPlan.state.canvasRevision, 2);
    let driftLandingCalls = 0;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("research.figure.render", {
        expectedProjectId: "PROJECT",
        expectedCanvasRevision: 2,
        nodeId: "RESEARCH-REQ",
        expectedRevision: 1
      }, {
        ...researchRuntimeContext,
        renderScientificTask: async (input) => {
          const task = makeResearchTask(input);
          researchTasks.unshift(task);
          researchCanvasRevision += 1;
          return task;
        },
        landScientificTask: () => {
          driftLandingCalls += 1;
          return { landed: true, createdNodeIds: [] };
        }
      }),
      (error) => error.code === "CANVAS_REVISION_CONFLICT" && error.details?.managedOutputsPersisted === true
    );
    assert.equal(driftLandingCalls, 0, "A completed Runner task must not land after canvas revision drift");
    researchCanvasRevision = 2;
    const renderedResearch = await runtimeModule.executeAutomationCommand("research.figure.render", {
      expectedProjectId: "PROJECT",
      expectedCanvasRevision: 2,
      nodeId: "RESEARCH-REQ",
      expectedRevision: 1,
      timeoutMs: 120000
    }, researchRuntimeContext);
    assert.equal(renderedResearch.landing.landed, true);
    assert.deepEqual(renderedResearch.landing.createdNodeIds, ["RESEARCH-FIGURE"]);
    assert.equal(renderedResearch.state.canvasRevision, 3);
    assert.equal(JSON.stringify(renderedResearch).includes("C%3A%5Cprivate"), false, "Scientific CLI results must remove internal asset URLs");
    const researchStatus = await runtimeModule.executeAutomationCommand("research.figure.status", {
      expectedProjectId: "PROJECT",
      nodeId: "RESEARCH-REQ"
    }, researchRuntimeContext);
    assert.ok(researchStatus.tasks.length >= 1);
    assert.equal(JSON.stringify(researchStatus).includes("assetUrl"), false);
    const readyResearchTaskId = renderedResearch.task.taskId;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("research.figure.export", {
        expectedProjectId: "PROJECT",
        taskId: readyResearchTaskId,
        confirmed: false
      }, researchRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    const exportedResearch = await runtimeModule.executeAutomationCommand("research.figure.export", {
      expectedProjectId: "PROJECT",
      taskId: readyResearchTaskId,
      confirmed: true
    }, researchRuntimeContext);
    assert.equal(exportedResearch.exported, true);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("research.figure.cancel", {
        expectedProjectId: "PROJECT",
        taskId: readyResearchTaskId,
        confirmed: false
      }, researchRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    const cancelledResearch = await runtimeModule.executeAutomationCommand("research.figure.cancel", {
      expectedProjectId: "PROJECT",
      taskId: readyResearchTaskId,
      confirmed: true
    }, researchRuntimeContext);
    assert.equal(cancelledResearch.task.state, "cancelled");

    const personalCommerceTemplateId = `commerce-template-${"a".repeat(32)}`;
    const listedCommerceTemplates = await runtimeModule.executeAutomationCommand("commerce.template.list", {}, canvasRuntimeContext);
    assert.equal(listedCommerceTemplates.items[0].id, "commerce-builtin-amazon");
    const savedCommerceTemplate = await runtimeModule.executeAutomationCommand("commerce.template.save", {
      title: "Amazon summer set",
      description: "Reusable seven-image listing plan",
      plan: {
        mode: "generate",
        platformTemplateId: "amazon",
        title: "Amazon summer set",
        slots: [{ id: "hero", title: "Hero", prompt: "White background hero image" }]
      }
    }, canvasRuntimeContext);
    assert.equal(savedCommerceTemplate.entry.id, personalCommerceTemplateId);
    assert.equal(commerceTemplateCalls[1].input.plan.saveTarget, "none",
      "Reusable templates must discard canvas-specific save targets");
    assert.deepEqual(commerceTemplateCalls[1].input.plan.translationItems, [],
      "Reusable templates must discard source-specific translation cells");
    const copiedCommerceTemplate = await runtimeModule.executeAutomationCommand("commerce.template.save", {
      conflictPolicy: "copy",
      title: "Amazon summer set",
      plan: { mode: "generate", platformTemplateId: "amazon" }
    }, canvasRuntimeContext);
    assert.equal(copiedCommerceTemplate.entry.id, `commerce-template-${"c".repeat(32)}`);
    assert.equal(commerceTemplateCalls[2].input.conflictPolicy, "copy");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.template.save", {
        conflictPolicy: "overwrite",
        title: "Missing overwrite target",
        plan: { mode: "generate", platformTemplateId: "amazon" }
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && /templateId/.test(error.message)
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.template.save", {
        templateId: personalCommerceTemplateId,
        expectedTemplateRevision: 1,
        conflictPolicy: "copy",
        title: "Invalid copy target",
        plan: { mode: "generate", platformTemplateId: "amazon" }
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && /不能同时指定 templateId/.test(error.message)
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.template.save", {
        templateId: personalCommerceTemplateId,
        title: "Stale overwrite",
        plan: { mode: "generate", platformTemplateId: "amazon" }
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && /expectedTemplateRevision/.test(error.message),
      "A personal template overwrite must include its exact revision"
    );
    await runtimeModule.executeAutomationCommand("commerce.template.save", {
      templateId: personalCommerceTemplateId,
      expectedTemplateRevision: 1,
      title: "Amazon summer set v2",
      plan: { mode: "generate", platformTemplateId: "amazon" }
    }, canvasRuntimeContext);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.template.delete", {
        templateId: personalCommerceTemplateId,
        expectedTemplateRevision: 2,
        confirmed: false
      }, canvasRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    await runtimeModule.executeAutomationCommand("commerce.template.delete", {
      templateId: personalCommerceTemplateId,
      expectedTemplateRevision: 2,
      confirmed: true
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("commerce.template.import", {}, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("commerce.template.export", {
      templateId: "commerce-builtin-amazon"
    }, canvasRuntimeContext);
    assert.deepEqual(commerceTemplateCalls.map((call) => call.command), ["list", "save", "save", "save", "delete", "import", "export"]);
    assert.deepEqual(commerceTemplateCalls[3].input, {
      id: personalCommerceTemplateId,
      expectedRevision: 1,
      title: "Amazon summer set v2",
      plan: commerceTemplateCalls[3].input.plan
    });
    assert.deepEqual(commerceTemplateCalls[4].input, {
      id: personalCommerceTemplateId,
      expectedRevision: 2,
      confirmed: true
    });
    assert.deepEqual(commerceTemplateCalls[6].input, { id: "commerce-builtin-amazon" });

    const listedCatalog = await runtimeModule.executeAutomationCommand("commerce.catalog.list", {
      expectedProjectId: "PROJECT"
    }, canvasRuntimeContext);
    assert.equal(listedCatalog.catalogRevision, 0);
    const savedCatalogProduct = await runtimeModule.executeAutomationCommand("commerce.catalog.upsert", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 0,
      product: {
        title: "Travel mug",
        brandStyle: {
          enabled: true,
          fontFamily: "Inter, Arial, sans-serif",
          colors: ["#0B1F33", "#F4C430"],
          logoUsage: "Keep the original logo artwork and proportions.",
          productAppearance: "Keep body geometry and printed markings unchanged.",
          visualStyle: "Clean premium product photography."
        },
        platforms: ["amazon", "aliexpress"],
        variants: [{ title: "Black 500ml", optionValues: [{ name: "Color", value: "Black" }] }],
        skus: [{ skuCode: "MUG-BLK-500", platforms: ["amazon"], variantIndex: 0 }]
      }
    }, canvasRuntimeContext);
    assert.equal(savedCatalogProduct.product.revision, 1);
    assert.deepEqual(catalogCalls[1].input.brandStyle, {
      enabled: true,
      fontFamily: "Inter, Arial, sans-serif",
      colors: ["#0B1F33", "#F4C430"],
      logoUsage: "Keep the original logo artwork and proportions.",
      productAppearance: "Keep body geometry and printed markings unchanged.",
      visualStyle: "Clean premium product photography."
    }, "The shared CLI schema and runtime must pass the complete brandStyle aggregate without loss");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.catalog.upsert", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 1,
        product: { productId: "product-11111111111111111111111111111111", title: "Stale edit" }
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && /expectedProductRevision/.test(error.message)
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.catalog.delete", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 1,
        productId: "product-11111111111111111111111111111111",
        expectedProductRevision: 1,
        confirmed: false
      }, canvasRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    await runtimeModule.executeAutomationCommand("commerce.catalog.delete", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 1,
      productId: "product-11111111111111111111111111111111",
      expectedProductRevision: 1,
      confirmed: true
    }, canvasRuntimeContext);
    await runtimeModule.executeAutomationCommand("commerce.catalog.assign", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 2,
      expectedCanvasRevision: 25,
      productId: "product-11111111111111111111111111111111",
      expectedProductRevision: 2,
      kind: "master",
      ownerType: "sku",
      ownerId: "sku-22222222222222222222222222222222",
      role: "primary",
      assets: [{ nodeId: "A", assetIndex: 0 }]
    }, canvasRuntimeContext);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.catalog.assign", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 2,
        expectedCanvasRevision: 25,
        productId: "product-11111111111111111111111111111111",
        expectedProductRevision: 2,
        kind: "master",
        ownerType: "product",
        role: "primary",
        assets: [{ nodeId: "A", assetIndex: 0, path: "C:/forbidden.png" }]
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && error.details?.path === "$.assets[0]"
    );
    await runtimeModule.executeAutomationCommand("commerce.catalog.remove", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 3,
      productId: "product-11111111111111111111111111111111",
      expectedProductRevision: 3,
      linkId: "material-33333333333333333333333333333333"
    }, canvasRuntimeContext);
    const reviewedCatalog = await runtimeModule.executeAutomationCommand("commerce.catalog.review", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 4,
      productId: "product-11111111111111111111111111111111",
      expectedProductRevision: 1,
      linkIds: [
        "result-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "result-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ],
      state: "approved"
    }, canvasRuntimeContext);
    assert.equal(reviewedCatalog.product.revision, 3);
    assert.deepEqual(catalogCalls.map((call) => call.command), ["list", "upsert", "delete", "assign", "remove", "review", "review"]);
    assert.deepEqual(catalogCalls[3].input.assets, [{ nodeId: "A", assetIndex: 0 }]);
    assert.equal(catalogCalls[3].input.expectedCanvasRevision, 25);
    assert.deepEqual(
      catalogCalls.slice(-2).map((call) => ({
        linkId: call.input.linkId,
        expectedCatalogRevision: call.input.expectedCatalogRevision,
        expectedProductRevision: call.input.expectedProductRevision,
        state: call.input.state
      })),
      [
        { linkId: "result-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expectedCatalogRevision: 4, expectedProductRevision: 1, state: "approved" },
        { linkId: "result-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", expectedCatalogRevision: 5, expectedProductRevision: 2, state: "approved" }
      ],
      "CLI review must advance Catalog and Product CAS revisions for each link in order"
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.catalog.review", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 6,
        productId: "product-11111111111111111111111111111111",
        expectedProductRevision: 3,
        linkIds: ["result-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        state: "invalid"
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT",
      "Invalid review states must fail before changing the catalog"
    );

    const comparisonProductId = "product-11111111111111111111111111111111";
    const comparisonGroupKey = `comparison-${"c".repeat(32)}`;
    const comparisonWinnerLinkId = `result-${"d".repeat(32)}`;
    const comparedCatalog = await runtimeModule.executeAutomationCommand("commerce.catalog.compare", {
      expectedProjectId: "PROJECT",
      productId: comparisonProductId
    }, canvasRuntimeContext);
    assert.equal(comparedCatalog.groups[0].groupKey, comparisonGroupKey);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.catalog.compare", {
        expectedProjectId: "STALE-PROJECT",
        productId: comparisonProductId
      }, canvasRuntimeContext),
      (error) => error.code === "PROJECT_MISMATCH",
      "A/B comparison must not read a different active project"
    );
    const selectedComparison = await runtimeModule.executeAutomationCommand("commerce.catalog.select", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 6,
      productId: comparisonProductId,
      expectedProductRevision: 3,
      groupKey: comparisonGroupKey,
      winnerLinkId: comparisonWinnerLinkId
    }, canvasRuntimeContext);
    assert.equal(selectedComparison.catalogRevision, 7);
    assert.deepEqual(commerceComparisonCalls, [{
      command: "compare",
      input: { expectedProjectId: "PROJECT", productId: comparisonProductId }
    }, {
      command: "select",
      input: {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 6,
        productId: comparisonProductId,
        expectedProductRevision: 3,
        groupKey: comparisonGroupKey,
        winnerLinkId: comparisonWinnerLinkId
      }
    }], "A/B CLI commands must preserve every Catalog/Product CAS field");

    const exportPreview = await runtimeModule.executeAutomationCommand("commerce.export.preview", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 4,
      platform: "amazon",
      format: "jpeg",
      skuIds: ["sku-22222222222222222222222222222222"]
    }, canvasRuntimeContext);
    assert.equal(exportPreview.summary.validImages, 2);
    assert.deepEqual(commerceExportCalls[0], {
      command: "preview",
      input: {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 4,
        platform: "amazon",
        format: "jpeg",
        includeCandidates: false,
        skuIds: ["sku-22222222222222222222222222222222"]
      }
    });
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.export.package", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 4,
        platform: "amazon",
        format: "jpeg",
        confirmed: false
      }, canvasRuntimeContext),
      (error) => error.code === "CONFIRMATION_REQUIRED"
    );
    await assert.rejects(
      runtimeModule.executeAutomationCommand("commerce.export.package", {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 4,
        platform: "amazon",
        format: "jpeg",
        confirmed: true,
        destinationPath: "C:/forbidden"
      }, canvasRuntimeContext),
      (error) => error.code === "INVALID_ARGUMENT" && error.details?.unexpected?.includes("destinationPath")
    );
    const packageExport = await runtimeModule.executeAutomationCommand("commerce.export.package", {
      expectedProjectId: "PROJECT",
      expectedCatalogRevision: 4,
      platform: "aliexpress",
      format: "png",
      includeCandidates: true,
      productIds: ["product-11111111111111111111111111111111"],
      confirmed: true
    }, canvasRuntimeContext);
    assert.equal(packageExport.canceled, true);
    assert.deepEqual(commerceExportCalls[1], {
      command: "package",
      input: {
        expectedProjectId: "PROJECT",
        expectedCatalogRevision: 4,
        platform: "aliexpress",
        format: "png",
        includeCandidates: true,
        productIds: ["product-11111111111111111111111111111111"],
        confirmed: true
      }
    });

    const goalCalls = { authorize: [], compose: [], waits: 0 };
    const commerceReusableNodes = [];
    let goalStatus = "idle";
    const goalContext = {
      activeProjectId: () => "project-goal",
      workspaceDomain: () => "general",
      activeConversationId: () => "conversation-goal",
      agentStatus: () => goalStatus,
      activeRunId: () => goalStatus === "idle" ? "" : "run-goal",
      agentPaused: () => false,
      viewport: () => ({ x: 0, y: 0, scale: 1 }),
      selection: () => ({ primaryId: "", ids: [] }),
      projects: () => [{ id: "project-goal", name: "Goal project" }],
      nodes: () => [
        { id: "image-a", type: "image", assets: [
          { assetId: "asset-a", index: 1, type: "file", path: "E:/fixtures/image-a.png" },
          { assetId: "asset-a-2", index: 2, type: "file", path: "E:/fixtures/image-a-2.png" }
        ] },
        { id: "image-b", type: "image", assets: [{ assetId: "asset-b", index: 1, type: "file", path: "E:/fixtures/image-b.png" }] }
      ],
      messages: () => [],
      composePluginTask: async (payload) => {
        goalCalls.compose.push(payload);
        return { ok: true, task: composePluginTask(payload) };
      },
      createCommerceReusableNode: (input) => {
        commerceReusableNodes.push(input);
        return { id: input.kind === "skill" ? "COMMERCE-SKILL" : "COMMERCE-REQ" };
      },
      executeAuthorizedGoal: async (prompt, options) => {
        goalCalls.authorize.push({ prompt, options });
        goalStatus = "thinking";
        return {
          phase: "dispatched",
          requestCount: options.operationsPerAsset * 3,
          operationsPerAsset: options.operationsPerAsset,
          probeContainerCount: 2,
          concurrencyCap: 4,
          paidImages: options.operationsPerAsset * 3
        };
      },
      wait: async () => {
        goalCalls.waits += 1;
        goalStatus = "idle";
      }
    };
    const goalPrompt = "Create one approved variant for every image container";
    const goalExecution = await runtimeModule.executeAutomationCommand("agent.goal", {
      prompt: goalPrompt,
      sourceNodeIds: ["image-a", "image-b"],
      operationsPerAsset: 2
    }, goalContext);
    assert.deepEqual(goalCalls.authorize, [{
      prompt: goalPrompt,
      options: { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 2 }
    }]);
    assert.equal(goalExecution.goal.requestCount, 6);
    assert.equal(goalExecution.goal.probeContainerCount, 2);
    assert.equal(goalExecution.agentStatus, "idle");
    assert.equal(goalCalls.waits, 1, "A directly authorized agent.goal must wait for the Agent turn to settle");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.goal", { prompt: goalPrompt, confirmed: true }, goalContext),
      (error) => error.code === "INVALID_ARGUMENT" && error.details?.path === "$" && error.details?.unexpected?.includes("confirmed"),
      "Legacy confirmation fields must be rejected by the shared schema"
    );

    goalStatus = "idle";
    goalCalls.authorize.length = 0;
    goalCalls.compose.length = 0;
    const invalidCommercePlans = [
      {
        name: "unknown platform template",
        plan: { mode: "generate", platformTemplateId: "unknown" },
        verify: (error) => error.details?.path === "$.plan.platformTemplateId"
      },
      {
        name: "unknown languageCodes entry",
        plan: { mode: "generate", setSize: 2, languageCodes: ["xx-ZZ"] },
        verify: (error) => error.details?.path === "$.plan.languageCodes[0]"
      },
      {
        name: "unknown targetLocales code",
        plan: { mode: "translate", targetLocales: [{ code: "xx-ZZ" }] },
        verify: (error) => error.details?.path === "$.plan.targetLocales[0].code"
      },
      {
        name: "simultaneous languageCodes and targetLocales",
        plan: { mode: "translate", languageCodes: ["en-US"], targetLocales: [{ code: "de-DE" }] },
        verify: (error) => error.details?.fields?.includes("plan.languageCodes")
          && error.details?.fields?.includes("plan.targetLocales")
      }
    ];
    for (const invalidCommerce of invalidCommercePlans) {
      const composeCallsBefore = goalCalls.compose.length;
      const authorizeCallsBefore = goalCalls.authorize.length;
      await assert.rejects(
        runtimeModule.executeAutomationCommand("commerce.compose-set", {
          sourceNodeIds: ["image-a", "image-b"],
          plan: invalidCommerce.plan
        }, goalContext),
        (error) => error.code === "INVALID_ARGUMENT" && invalidCommerce.verify(error),
        `${invalidCommerce.name} must fail before commerce composition or Goal authorization`
      );
      assert.equal(goalCalls.compose.length, composeCallsBefore,
        `${invalidCommerce.name} must cause zero composePluginTask calls`);
      assert.equal(goalCalls.authorize.length, authorizeCallsBefore,
        `${invalidCommerce.name} must cause zero executeAuthorizedGoal calls`);
    }
    const commercePlanArgs = {
      sourceNodeIds: ["image-a", "image-b"],
      plan: {
        mode: "generate",
        platformTemplateId: "amazon",
        setSize: 2,
        languageCodes: ["en-US", "de-DE"],
        saveTarget: "requirement",
        reusableName: "Marketplace listing set"
      }
    };
    const executedCommerce = await runtimeModule.executeAutomationCommand("commerce.compose-set", commercePlanArgs, goalContext);
    assert.equal(goalCalls.compose.at(-1).plan.platformTemplateId, "amazon");
    assert.equal(goalCalls.authorize.length, 1);
    assert.deepEqual(goalCalls.authorize[0].options, { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 4 });
    assert.match(goalCalls.authorize[0].prompt, /NAIMAGE_COMMERCE_SET_V1/);
    assert.match(goalCalls.authorize[0].prompt, /GOAL_RUNTIME_METADATA_CONTRACT/);
    assert.equal(executedCommerce.goal.requestCount, 12);
    assert.equal(executedCommerce.goal.operationsPerAsset, 4);
    assert.equal(commerceReusableNodes.length, 1);
    assert.equal(commerceReusableNodes[0].kind, "requirement");
    assert.equal(commerceReusableNodes[0].title, "Marketplace listing set");
    assert.deepEqual(commerceReusableNodes[0].sourceNodeIds, ["image-a", "image-b"]);
    assert.deepEqual(executedCommerce.reusableNode, { created: true, nodeId: "COMMERCE-REQ", kind: "requirement" });
    assert.match(rendererSource, /async function authorizeAndDispatchGoal\(/);
    assert.match(rendererSource, /await buildGoalModePreview\(promptText, options\)/,
      "Direct GUI and CLI execution must first build the complete frozen Goal preview");
    assert.match(rendererSource, /ledger\.consume\([\s\S]{0,220}preview\.confirmationHash/,
      "Direct execution must consume its trusted one-time authorization receipt");
    assert.match(rendererSource, /const dispatched = await dispatchConfirmedGoal\(/,
      "Only the fully authorized frozen preview may reach Goal dispatch");
    assert.match(rendererSource, /await authorizeAndDispatchGoal\(result\.task\.prompt, "main-dialog"/,
      "The commerce dialog's explicit execute action must dispatch without a second fee dialog");
    assert.match(rendererSource, /executeAuthorizedGoal: \(promptText, options\) => authorizeAndDispatchGoal\(promptText, "automation"/,
      "CLI Goal commands must use the same direct authorization path");

    const controlCalls = { send: [], steer: [], pause: 0, resume: 0, stop: 0 };
    let controlStatus = "thinking";
    let controlPaused = false;
    let sendAccepted = true;
    let steerAccepted = true;
    let pauseAccepted = true;
    let resumeAccepted = true;
    let stopAccepted = true;
    const controlContext = {
      ...goalContext,
      agentStatus: () => controlStatus,
      activeRunId: () => controlStatus === "idle" ? "" : "run-control",
      agentPaused: () => controlPaused,
      agentBusy: () => controlStatus === "thinking" || controlStatus === "editing",
      nodes: () => [
        { id: "image-a", type: "image", assets: [{ id: "asset-a" }] },
        { id: "image-b", type: "image", assets: [{ id: "asset-b" }] }
      ],
      sendPrompt: async (prompt, sourceNodeIds) => {
        controlCalls.send.push({ prompt, sourceNodeIds });
        return sendAccepted;
      },
      steerAgent: async (prompt, options) => {
        controlCalls.steer.push({ prompt, options });
        return steerAccepted;
      },
      pauseAgent: async () => {
        controlCalls.pause += 1;
        if (pauseAccepted) controlPaused = true;
        return pauseAccepted;
      },
      resumeAgent: async () => {
        controlCalls.resume += 1;
        if (resumeAccepted) controlPaused = false;
        return resumeAccepted;
      },
      stopAgent: async () => {
        controlCalls.stop += 1;
        if (stopAccepted) controlStatus = "idle";
        return stopAccepted;
      }
    };
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.chat", {
        prompt: "use these exact sources",
        sourceNodeIds: ["image-a", "missing-source"]
      }, controlContext),
      /missing-source.*命令未执行/,
      "A mixed valid/stale SOURCE list must fail atomically"
    );
    assert.equal(controlCalls.send.length, 0, "Invalid SOURCE ids must cause zero Agent calls");
    assert.equal(controlCalls.steer.length, 0, "Invalid SOURCE ids must cause zero steer calls");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.chat", {
        prompt: "replace sources implicitly",
        sourceNodeIds: ["image-a"]
      }, controlContext),
      /text-only|只修改文字|agent\.steer/,
      "Running agent.chat must reject implicit SOURCE replacement"
    );
    assert.equal(controlCalls.steer.length, 0);
    const waitsBeforeBusyChat = goalCalls.waits;
    const busyChat = await runtimeModule.executeAutomationCommand("agent.chat", { prompt: "text-only correction" }, controlContext);
    assert.equal(busyChat.accepted, true);
    assert.equal(busyChat.steered, true);
    assert.equal(goalCalls.waits, waitsBeforeBusyChat, "A running chat returns after steer acceptance instead of waiting for the parent run");
    assert.deepEqual(controlCalls.steer.at(-1), {
      prompt: "text-only correction",
      options: {
        taskScopeMode: "keep",
        sourceMode: "keep",
        referenceMode: "keep",
        sourceNodeIds: [],
        referenceNodeIds: [],
        useComposerAttachments: false
      }
    });
    steerAccepted = false;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.chat", { prompt: "steer rejected" }, controlContext),
      /没有接收 agent\.chat/,
      "A rejected running chat/steer must propagate as a top-level command failure"
    );
    steerAccepted = true;
    const steerCallsBeforeInvalidReference = controlCalls.steer.length;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.steer", {
        prompt: "append references",
        taskScopeMode: "merge-reference",
        referenceNodeIds: ["image-b", "missing-reference"]
      }, controlContext),
      /missing-reference.*命令未执行/
    );
    assert.equal(controlCalls.steer.length, steerCallsBeforeInvalidReference, "Invalid REFERENCE ids must not shrink to a valid subset");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.steer", {
        prompt: "append an omitted source",
        taskScopeMode: "merge-source",
        sourceNodeIds: []
      }, controlContext),
      /需要至少一个有效 sourceNodeId/
    );
    pauseAccepted = false;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.pause", {}, controlContext),
      /暂停失败/
    );
    pauseAccepted = true;
    const pausedControl = await runtimeModule.executeAutomationCommand("agent.pause", {}, controlContext);
    assert.equal(pausedControl.paused, true);
    resumeAccepted = false;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.resume", {}, controlContext),
      /恢复失败/
    );
    resumeAccepted = true;
    const resumedControl = await runtimeModule.executeAutomationCommand("agent.resume", {}, controlContext);
    assert.equal(resumedControl.paused, false);
    stopAccepted = false;
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.stop", {}, controlContext),
      /底层取消失败/,
      "A backend stop failure must never be reported as CLI success"
    );
    assert.equal(controlStatus, "thinking");
    stopAccepted = true;
    const stoppedControl = await runtimeModule.executeAutomationCommand("agent.stop", {}, controlContext);
    assert.equal(stoppedControl.agentStatus, "idle");
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.stop", {}, controlContext),
      /没有可结束/,
      "Stopping an idle Agent is not a successful cancellation"
    );
    assert.match(rendererSource, /naimageConfig\?\.parseSkill/,
      "GUI and CLI imports must share the Main-owned Skill parser");
    assert.match(rendererSource, /conflict: "locally-modified"/,
      "Re-importing a locally edited Skill must report a conflict instead of an exact duplicate");
    assert.match(rendererSource, /locallyModifiedAt: new Date\(\)\.toISOString\(\)/,
      "Editing imported Skill instructions must preserve source identity and mark the local modification");
    assert.match(composerSource, /<option value="auto">自动处理（推荐）<\/option>/);
    assert.match(composerSource, /<option value="keep">只修改要求，保留现有图片<\/option>/);
    assert.match(composerSource, /<option value="replace-source">更换处理图片<\/option>/);
    assert.doesNotMatch(composerSource, /<option value="merge-source">/,
      "The normal steer UI must not expose protocol-level SOURCE merge terminology");
    assert.match(composerSource, /if \(!executionBusy\) setTaskScopeMode\("auto"\)/,
      "The visible steer mode must reset between runs");
    assert.match(composerSource, /if \(executionBusy\) setTaskScopeMode\("auto"\)/,
      "A submitted steer mode must reset after use");
    assert.match(rendererSource, /import\(["']\.\/automation-command-runtime["']\)/,
      "Renderer automation commands must stay behind an async module boundary");

    autoRespond = false;
    const pendingCommand = service.dispatch("agent.goal", { prompt: "pending renderer lifecycle probe" }, 30_000);
    const pendingCancellation = assert.rejects(
      pendingCommand,
      (error) => error.code === "NAIMAGE_AUTOMATION_RENDERER_GONE" && /关闭/.test(error.message)
    );
    destroyedHandlers[0]();
    await pendingCancellation;
    assert.equal(service.status().rendererReady, false);
    assert.equal(service.rendererGone(webContents.id).rejected, 0, "Renderer cleanup must be idempotent");
  } finally {
    await service.stop();
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, rendererLifecycleListeners: destroyedHandlers.length, rendererPendingCancellation: true, cliRunControlCommands: 4, strictNodeIds: true, workspaceDomains: true, socialCommands: true, cliVideoImport: true, cliVideoGeneration: true, cliSkillImport: true, cliImageExport: true, commerceTemplateNameConflict: true, goalCommandProtocol: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
