"use strict";

const assert = require("node:assert/strict");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createAutomationService } = require("../desktop/automation-service.cjs");
const { composePluginTask } = require("../desktop/plugin-task-prompts.cjs");

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
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-automation-"));
  const destroyedHandlers = [];
  let autoRespond = true;
  let rendererFailureCommand = "";
  let focusedRendererId = 77;
  let goalTokenSequence = 10;
  const rendererRequests = [];
  const goalToken = () => `goal-${(goalTokenSequence++).toString(16).padStart(32, "0")}`;
  const mockRendererResult = (payload) => {
    if (!["agent.goal", "commerce.compose-set"].includes(payload.command) || payload.args?.confirmed === true) {
      return { command: payload.command, args: payload.args };
    }
    const preview = {
      requiresConfirmation: true,
      snapshot: { snapshotHash: goalToken() },
      counts: { imageContainers: 2, assets: 2 }
    };
    if (payload.command === "commerce.compose-set") {
      preview.confirmationArgs = JSON.parse(JSON.stringify({
        sourceNodeIds: payload.args.sourceNodeIds,
        plan: payload.args.plan
      }));
    }
    return preview;
  };
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
    const routedPreviewA = await service.dispatch("agent.goal", { prompt: routedGoalPrompt });
    const routedTokenA = routedPreviewA.snapshot.snapshotHash;
    focusedRendererId = webContentsB.id;
    const concurrentConfirmation = await Promise.allSettled([
      service.dispatch("agent.goal", { prompt: routedGoalPrompt, confirmed: true, expectedSnapshotHash: routedTokenA }),
      service.dispatch("agent.goal", { prompt: routedGoalPrompt, confirmed: true, expectedSnapshotHash: routedTokenA })
    ]);
    assert.equal(concurrentConfirmation.filter((item) => item.status === "fulfilled").length, 1, "A Goal bearer can dispatch at most once under concurrent confirmation");
    assert.equal(concurrentConfirmation.filter((item) => item.status === "rejected").length, 1);
    const routedConfirmationA = rendererRequests.filter((item) => item.command === "agent.goal" && item.args?.confirmed === true && item.args?.expectedSnapshotHash === routedTokenA);
    assert.equal(routedConfirmationA.length, 1);
    assert.equal(routedConfirmationA[0].webContentsId, webContents.id, "Focus changes must not move Goal execution away from its issuing Renderer");

    const scopedPreview = await service.dispatch("agent.goal", {
      prompt: routedGoalPrompt,
      sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
      operationsPerAsset: 3
    });
    const scopedToken = scopedPreview.snapshot.snapshotHash;
    await assert.rejects(
      service.dispatch("agent.goal", {
        prompt: routedGoalPrompt,
        sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
        operationsPerAsset: 4,
        confirmed: true,
        expectedSnapshotHash: scopedToken
      }),
      /预览参数不一致|重新预览/,
      "Changing operationsPerAsset must burn and reject the scoped Goal confirmation"
    );
    await assert.rejects(
      service.dispatch("agent.goal", {
        prompt: routedGoalPrompt,
        sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
        operationsPerAsset: 3,
        confirmed: true,
        expectedSnapshotHash: scopedToken
      }),
      /已使用|重新预览/
    );

    const commerceArgs = {
      sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
      plan: { mode: "generate", setSize: 2, languageCodes: ["en-US", "de-DE"] }
    };
    const commercePreview = await service.dispatch("commerce.compose-set", commerceArgs);
    const commerceToken = commercePreview.snapshot.snapshotHash;
    assert.deepEqual(commercePreview.confirmationArgs, commerceArgs,
      "Commerce preview must return the exact raw arguments required by Main-process confirmation");
    const acceptedCommerce = await service.dispatch("commerce.compose-set", {
      ...commercePreview.confirmationArgs,
      confirmed: true,
      expectedSnapshotHash: commerceToken
    });
    assert.deepEqual(acceptedCommerce.args, {
      ...commerceArgs,
      confirmed: true,
      expectedSnapshotHash: commerceToken
    });

    const changedCommercePreview = await service.dispatch("commerce.compose-set", commerceArgs);
    const changedCommerceToken = changedCommercePreview.snapshot.snapshotHash;
    await assert.rejects(
      service.dispatch("commerce.compose-set", {
        ...changedCommercePreview.confirmationArgs,
        plan: { ...changedCommercePreview.confirmationArgs.plan, setSize: 3 },
        confirmed: true,
        expectedSnapshotHash: changedCommerceToken
      }),
      /预览参数不一致|重新预览/,
      "A changed commerce plan must not reuse an earlier quote"
    );
    await assert.rejects(
      service.dispatch("commerce.compose-set", {
        ...changedCommercePreview.confirmationArgs,
        confirmed: true,
        expectedSnapshotHash: changedCommerceToken
      }),
      /已使用|重新预览/,
      "A failed changed-plan attempt must burn the Main-process commerce confirmation"
    );

    focusedRendererId = webContentsB.id;
    const routedPreviewB = await service.dispatch("agent.goal", { prompt: routedGoalPrompt });
    const routedTokenB = routedPreviewB.snapshot.snapshotHash;
    focusedRendererId = webContents.id;
    await service.dispatch("agent.goal", { prompt: routedGoalPrompt, confirmed: true, expectedSnapshotHash: routedTokenB });
    const routedConfirmationB = rendererRequests.filter((item) => item.command === "agent.goal" && item.args?.confirmed === true && item.args?.expectedSnapshotHash === routedTokenB);
    assert.equal(routedConfirmationB.length, 1);
    assert.equal(routedConfirmationB[0].webContentsId, webContentsB.id);

    focusedRendererId = webContents.id;
    const changedPromptPreview = await service.dispatch("agent.goal", { prompt: routedGoalPrompt });
    const changedPromptToken = changedPromptPreview.snapshot.snapshotHash;
    await assert.rejects(
      service.dispatch("agent.goal", { prompt: `${routedGoalPrompt} changed`, confirmed: true, expectedSnapshotHash: changedPromptToken }),
      /prompt 不一致|重新预览/
    );
    await assert.rejects(
      service.dispatch("agent.goal", { prompt: routedGoalPrompt, confirmed: true, expectedSnapshotHash: changedPromptToken }),
      /已使用|重新预览/,
      "A failed changed-prompt attempt must burn the Main-process owner record"
    );
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
    for (const command of ["canvas.import-skill", "canvas.export-image", ...graphCommands, "agent.chat", "agent.goal", "commerce.compose-set", "agent.steer", "agent.pause", "agent.resume", "agent.stop"]) {
      assert.equal(rendererCommands.has(command), true, `${command} must be registered in the shared command schema`);
      assert.match(commandReference, new RegExp("`" + command.replace(".", "\\.") + "`"));
    }
    const goalSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "agent.goal");
    assert.deepEqual(goalSchema.parameters.required, ["prompt"]);
    assert.equal(goalSchema.parameters.properties.confirmed.default, false);
    assert.equal(goalSchema.parameters.properties.operationsPerAsset.default, 1);
    assert.equal(goalSchema.parameters.properties.operationsPerAsset.maximum, 200);
    assert.equal(goalSchema.parameters.properties.sourceNodeIds.maxItems, 200);
    assert.equal(goalSchema.parameters.properties.expectedSnapshotHash.pattern, "^goal-[a-f0-9]{32}$");
    assert.match(goalSchema.description, /sourceNodeIds/);
    assert.match(goalSchema.description, /operationsPerAsset/);
    assert.match(goalSchema.description, /one-time snapshot\.snapshotHash/);
    const commerceSchema = commandSchema.sections.flatMap((section) => section.commands).find((command) => command.name === "commerce.compose-set");
    assert.deepEqual(commerceSchema.parameters.required, ["sourceNodeIds", "plan"]);
    assert.equal(commerceSchema.parameters.properties.sourceNodeIds.minItems, 1);
    assert.equal(commerceSchema.parameters.properties.plan.additionalProperties, false);
    const commerceLanguageCodes = commerceSetContract.languages.map((language) => language.code);
    const commercePlanProperties = commerceSchema.parameters.properties.plan.properties;
    assert.deepEqual(commercePlanProperties.languageCodes.items.enum, commerceLanguageCodes,
      "CLI languageCodes must contain the complete canonical commerce language registry");
    assert.deepEqual(commercePlanProperties.targetLocales.items.properties.code.enum, commerceLanguageCodes,
      "CLI targetLocales codes must contain the complete canonical commerce language registry");
    assert.match(commerceSchema.description, /never bypasses agent\.goal confirmation/);
    assert.match(commerceSchema.description, /confirmationArgs/);
    assert.equal(commerceSchema.examples.length, 2, "Commerce CLI schema must document generate and translate plans");
    assert.equal(commerceSchema.examples[0].plan.mode, "generate");
    assert.ok(commerceSchema.examples[0].plan.slots.every((slot) => Boolean(slot.prompt)),
      "Generate example must demonstrate per-slot prompts");
    assert.equal(commerceSchema.examples[0].plan.saveTarget, "requirement");
    assert.equal(commerceSchema.examples[1].plan.mode, "translate");
    assert.ok(commerceSchema.examples[1].plan.targetLocales.every((locale) => Boolean(locale.prompt)),
      "Translate example must demonstrate per-locale prompts");
    assert.equal(commerceSchema.examples[1].plan.saveTarget, "skill");
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
    assert.equal(generatedExample("canvas.connect").edges.length, 1, "Nested edge examples must satisfy minItems");
    assert.equal(generatedExample("canvas.group").nodeIds.length, 2, "Unique node examples must satisfy minItems without duplicates");
    assert.equal(Object.keys(generatedExample("canvas.update-requirement").patch).length, 1, "Nested patch examples must satisfy minProperties");
    assert.deepEqual(Object.keys(generatedExample("canvas.export-image")).sort(), ["assetIndex", "format", "nodeId"]);
    assert.match(runtimeSource, /"canvas\.import-skill"/);
    assert.match(runtimeSource, /context\.parseSkill/);
    assert.match(runtimeSource, /"canvas\.export-image"/);
    assert.match(runtimeSource, /context\.exportImage/);
    assert.match(runtimeSource, /context\.previewGoal\(prompt, scopeOptions\)/);
    assert.match(runtimeSource, /context\.executeGoal\(prompt, expectedSnapshotHash, "automation", scopeOptions\)/);
    assert.match(runtimeSource, /"commerce\.compose-set"/);
    const registryModule = await import(`${pathToFileURL(path.resolve(__dirname, "..", "src", "automation-command-registry.ts")).href}?automation-selftest=${Date.now()}`);
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("agent.goal"), true,
      "Generated Renderer command registry must contain agent.goal");
    assert.equal(registryModule.AUTOMATION_RENDERER_COMMAND_NAMES.includes("commerce.compose-set"), true,
      "Generated Renderer command registry must contain commerce.compose-set");
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
    let automationSelection = { primaryId: "", ids: [] };
    const canvasNodes = [
      { id: "A", title: "A", prompt: "", type: "image", status: "done", x: 10, y: 20, branch: "test", outputs: 1, createdAt: "now", assets: [{ assetId: "asset-a", path: "A.png" }] },
      { id: "B", title: "B", prompt: "", type: "image", status: "done", x: 30, y: 40, branch: "test", outputs: 1, createdAt: "now", assets: [{ assetId: "asset-b", path: "B.png" }] },
      {
        id: "REQ", title: "Requirement", prompt: "Edit", type: "requirement", status: "done", x: 80, y: 40,
        branch: "test", outputs: 0, createdAt: "now", parentId: "A", relationType: "referenced",
        requirement: { version: 2, revision: 3, text: "Edit", createdFrom: "node", inputBindings: [{ nodeId: "A", role: "source" }] }
      }
    ];
    const graphCalls = [];
    const canvasRuntimeContext = {
      activeProjectId: () => "PROJECT",
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
      connectCanvas: (input) => { graphCalls.push({ command: "connect", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      disconnectCanvas: (input) => { graphCalls.push({ command: "disconnect", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      groupCanvas: (input) => { graphCalls.push({ command: "group", input }); canvasRevision += 1; return { changed: true, hostNodeId: "A", canvasRevision }; },
      dissolveCanvas: (input) => { graphCalls.push({ command: "dissolve", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      nudgeCanvas: (input) => { graphCalls.push({ command: "nudge", input }); canvasRevision += 1; return { changed: true, canvasRevision }; },
      createRequirement: (input) => { graphCalls.push({ command: "create-requirement", input }); canvasRevision += 1; return { changed: true, nodeId: "REQ-2", canvasRevision }; },
      updateRequirement: (input) => { graphCalls.push({ command: "update-requirement", input }); canvasRevision += 1; return { changed: true, nodeId: input.nodeId, canvasRevision }; },
      executeRequirement: async (input) => { graphCalls.push({ command: "execute-requirement", input }); return { accepted: true, nodeId: input.nodeId }; },
      agentBusy: () => false
    };
    const authoritativeState = await runtimeModule.executeAutomationCommand("canvas.state", {}, canvasRuntimeContext);
    assert.equal(authoritativeState.canvasRevision, 17);
    assert.deepEqual(authoritativeState.locks.lockedNodeIds, ["B"]);
    assert.equal(authoritativeState.nodes.find((node) => node.id === "REQ").requirement.revision, 3);
    assert.equal(authoritativeState.nodes.find((node) => node.id === "REQ").relation.parentId, "A");
    assert.equal(authoritativeState.nodes.find((node) => node.id === "B").activity.locked, true);
    const importConflict = await runtimeModule.executeAutomationCommand("canvas.import-skill", { markdown: "ignored" }, canvasRuntimeContext);
    assert.equal(importConflict.created, false);
    assert.equal(importConflict.exact, false);
    assert.equal(importConflict.conflict, "locally-modified");
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

    const goalCalls = { preview: [], execute: [], compose: [], waits: 0 };
    const commerceReusableNodes = [];
    let goalStatus = "idle";
    const goalContext = {
      activeProjectId: () => "project-goal",
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
      previewGoal: async (prompt, options) => {
        goalCalls.preview.push({ prompt, options });
        return {
          requiresConfirmation: true,
          snapshot: { snapshotHash: "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", imageContainerIds: ["image-a", "image-b"] },
          counts: { imageContainers: 2, assets: 2 }
        };
      },
      executeGoal: async (prompt, expectedSnapshotHash, issuerId, options) => {
        goalCalls.execute.push({ prompt, expectedSnapshotHash, issuerId, options });
        goalStatus = "thinking";
      },
      wait: async () => {
        goalCalls.waits += 1;
        goalStatus = "idle";
      }
    };
    const goalPrompt = "Create one approved variant for every image container";
    const goalPreview = await runtimeModule.executeAutomationCommand("agent.goal", {
      prompt: goalPrompt,
      sourceNodeIds: ["image-a", "image-b"],
      operationsPerAsset: 2
    }, goalContext);
    assert.equal(goalPreview.requiresConfirmation, true);
    assert.equal(goalPreview.snapshot.snapshotHash, "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.deepEqual(goalPreview.counts, { imageContainers: 2, assets: 2 });
    assert.deepEqual(goalCalls.preview, [{
      prompt: goalPrompt,
      options: { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 2 }
    }]);
    assert.deepEqual(goalCalls.execute, []);
    await assert.rejects(
      runtimeModule.executeAutomationCommand("agent.goal", { prompt: goalPrompt, confirmed: true }, goalContext),
      /expectedSnapshotHash/
    );
    assert.deepEqual(goalCalls.execute, [], "A confirmed Goal without a snapshot hash must not dispatch");
    const goalExecution = await runtimeModule.executeAutomationCommand("agent.goal", {
      prompt: goalPrompt,
      sourceNodeIds: ["image-a", "image-b"],
      operationsPerAsset: 2,
      confirmed: true,
      expectedSnapshotHash: "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }, goalContext);
    assert.deepEqual(goalCalls.execute, [{
      prompt: goalPrompt,
      expectedSnapshotHash: "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      issuerId: "automation",
      options: { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 2 }
    }]);
    assert.equal(goalCalls.waits, 1, "Confirmed agent.goal must wait for the current Agent turn to settle");
    assert.equal(goalExecution.agentStatus, "idle");

    goalStatus = "idle";
    goalCalls.preview.length = 0;
    goalCalls.execute.length = 0;
    goalCalls.compose.length = 0;
    const invalidCommercePlans = [
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
      const previewCallsBefore = goalCalls.preview.length;
      await assert.rejects(
        runtimeModule.executeAutomationCommand("commerce.compose-set", {
          sourceNodeIds: ["image-a", "image-b"],
          plan: invalidCommerce.plan
        }, goalContext),
        (error) => error.code === "INVALID_ARGUMENT" && invalidCommerce.verify(error),
        `${invalidCommerce.name} must fail before commerce composition or Goal preview`
      );
      assert.equal(goalCalls.compose.length, composeCallsBefore,
        `${invalidCommerce.name} must cause zero composePluginTask calls`);
      assert.equal(goalCalls.preview.length, previewCallsBefore,
        `${invalidCommerce.name} must cause zero previewGoal calls`);
    }
    const commercePlanArgs = {
      sourceNodeIds: ["image-a", "image-b"],
      plan: {
        mode: "generate",
        setSize: 2,
        languageCodes: ["en-US", "de-DE"],
        saveTarget: "requirement",
        reusableName: "Marketplace listing set"
      }
    };
    const commerceRuntimePreview = await runtimeModule.executeAutomationCommand("commerce.compose-set", commercePlanArgs, goalContext);
    assert.equal(commerceRuntimePreview.requiresConfirmation, true);
    assert.deepEqual(commerceRuntimePreview.confirmationArgs, commercePlanArgs,
      "Runtime preview must preserve the exact raw commerce arguments for confirmation");
    assert.notStrictEqual(commerceRuntimePreview.confirmationArgs, commercePlanArgs);
    assert.notStrictEqual(commerceRuntimePreview.confirmationArgs.sourceNodeIds, commercePlanArgs.sourceNodeIds);
    assert.notStrictEqual(commerceRuntimePreview.confirmationArgs.plan, commercePlanArgs.plan,
      "Runtime confirmationArgs must be a deep copy instead of an alias of caller-owned input");
    assert.deepEqual(commerceRuntimePreview.composition.normalizedPlan, commerceRuntimePreview.composition.plan,
      "The explicit normalizedPlan field must match the backwards-compatible composition.plan field");
    assert.equal(commerceRuntimePreview.composition.operationsPerAsset, 4);
    assert.equal(commerceRuntimePreview.composition.counts.sourceCount, 3);
    assert.equal(commerceRuntimePreview.composition.counts.totalRequests, 12);
    assert.match(commerceRuntimePreview.composition.planHash, /^commerce-[a-f0-9]{32}$/);
    assert.deepEqual(goalCalls.preview[0].options, { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 4 });
    assert.match(goalCalls.preview[0].prompt, /NAIMAGE_COMMERCE_SET_V1/);
    assert.match(goalCalls.preview[0].prompt, /GOAL_RUNTIME_METADATA_CONTRACT/);
    assert.equal(commerceReusableNodes.length, 0, "Commerce preview must not create a reusable node");
    const confirmedCommerce = await runtimeModule.executeAutomationCommand("commerce.compose-set", {
      ...commerceRuntimePreview.confirmationArgs,
      confirmed: true,
      expectedSnapshotHash: "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }, goalContext);
    assert.equal(goalCalls.execute.length, 1);
    assert.deepEqual(goalCalls.execute[0].options, { sourceNodeIds: ["image-a", "image-b"], operationsPerAsset: 4 });
    assert.equal(goalCalls.execute[0].prompt, goalCalls.preview[0].prompt, "Commerce preview and execution must compose byte-identical prompts");
    assert.equal(commerceReusableNodes.length, 1);
    assert.equal(commerceReusableNodes[0].kind, "requirement");
    assert.equal(commerceReusableNodes[0].title, "Marketplace listing set");
    assert.deepEqual(commerceReusableNodes[0].sourceNodeIds, ["image-a", "image-b"]);
    assert.deepEqual(confirmedCommerce.reusableNode, { created: true, nodeId: "COMMERCE-REQ", kind: "requirement" });
    assert.match(rendererSource, /ledger\.take\(promptText, expectedSnapshotHash/,
      "The Renderer must burn a prompt-bound one-time Goal confirmation before busy and live-scope checks");
    assert.match(rendererSource, /issueGoalConfirmation\(await buildGoalModePreview\(promptText,[\s\S]{0,300}\), "automation"\)/,
      "Every GUI or CLI Goal execution must originate from an issued preview");
    assert.ok((rendererSource.match(/targetNodeIds: options\.sourceNodeIds/g) || []).length >= 2,
      "Automation Goal preview and confirmed execution must both rebuild the exact requested SOURCE scope");
    assert.ok((rendererSource.match(/operationsPerAsset: options\.operationsPerAsset/g) || []).length >= 2,
      "Automation Goal preview and confirmed execution must both rebuild the exact per-asset operation count");

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
    assert.match(composerSource, /<option value="merge-source">追加 SOURCE<\/option>/);
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
  process.stdout.write(`${JSON.stringify({ ok: true, rendererLifecycleListeners: destroyedHandlers.length, rendererPendingCancellation: true, cliRunControlCommands: 4, strictNodeIds: true, cliSkillImport: true, cliImageExport: true, goalCommandProtocol: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
