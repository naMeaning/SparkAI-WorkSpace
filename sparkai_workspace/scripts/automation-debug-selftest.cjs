"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAutomationService } = require("../desktop/automation-service.cjs");
const { createDebugCommandService } = require("../desktop/debug-command-service.cjs");

async function post(endpoint, command, args = {}) {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ command, args })
  });
  return { status: response.status, payload: await response.json() };
}

async function main() {
  const appRoot = path.resolve(__dirname, "..");
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-debug-command-"));
  const debugDir = path.join(root, "diagnostics");
  const electronLog = path.join(root, "latest.log");
  const schemaPath = path.join(appRoot, "integrations", "naimage-control", "references", "commands.schema.json");
  writeFileSync(electronLog, [
    "[2026-08-03T00:00:00.000Z] boot ready",
    `[2026-08-03T00:00:01.000Z] opened ${appRoot} Bearer secret-token-value`,
    "[2026-08-03T00:00:02.000Z] console level=error renderer.ts:9 Cookie: session-private-value"
  ].join("\n"), "utf8");

  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const mockWindow = {
    isDestroyed: () => false,
    isFocused: () => true,
    isVisible: () => true,
    capturePage: async () => ({
      toPNG: () => png,
      getSize: () => ({ width: 900, height: 640 })
    })
  };
  const BrowserWindow = { getAllWindows: () => [mockWindow] };
  const ipcMain = {
    _invokeHandlers: new Map([
      ["naimage:config:load-settings", () => {}],
      ["not-naimage", () => {}]
    ]),
    eventNames: () => ["naimage:automation:response", "unrelated"]
  };
  const debug = createDebugCommandService({
    appRoot,
    debugDir,
    electronLog,
    commandSchemaPath: schemaPath,
    BrowserWindow,
    ipcMain,
    version: "1.0.9",
    enabled: true,
    getRendererState: async () => ({
      activeProjectId: "fixture",
      apiKey: "sk-super-secret",
      path: path.join(appRoot, "config", "session.json")
    }),
    log: () => {}
  });

  for (const command of [
    "debug.runtime-state",
    "debug.renderer-logs",
    "debug.main-logs",
    "debug.run-targeted-test",
    "debug.capture-window",
    "debug.inspect-ipc",
    "debug.inspect-command"
  ]) assert.equal(debug.commands.includes(command), true, `${command} must come from the shared service registry`);

  const state = await debug.execute("debug.runtime-state", {});
  assert.equal(state.registry.serviceCommands, 8);
  assert.equal(state.windows.length, 1);
  assert.equal(state.rendererState.apiKey, "[REDACTED]");
  assert.match(state.rendererState.path, /<app-root>/);
  const rendererLogs = await debug.execute("debug.renderer-logs", { limit: 10 });
  assert.equal(rendererLogs.returned, 1);
  assert.doesNotMatch(rendererLogs.entries[0], /session-private-value/);
  assert.match(rendererLogs.entries[0], /\[REDACTED\]/);
  const mainLogs = await debug.execute("debug.main-logs", { limit: 10 });
  assert.equal(mainLogs.returned, 3);
  assert.doesNotMatch(mainLogs.entries.join("\n"), /secret-token-value/);
  assert.doesNotMatch(mainLogs.entries.join("\n"), new RegExp(appRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const command = await debug.execute("debug.inspect-command", { name: "agent.goal" });
  assert.equal(command.surface, "renderer");
  assert.equal(command.parameters.properties.confirmed, undefined);
  await assert.rejects(
    debug.execute("debug.inspect-command", { name: "missing.command" }),
    (error) => error.code === "UNKNOWN_AUTOMATION_COMMAND"
  );
  await assert.rejects(
    debug.execute("debug.main-logs", { limit: 2, path: "C:\\outside.log" }),
    (error) => error.code === "INVALID_ARGUMENT" && error.details.unexpected.includes("path")
  );
  const ipc = await debug.execute("debug.inspect-ipc", {});
  assert.deepEqual(ipc.invokeChannels, ["naimage:config:load-settings"]);
  assert.deepEqual(ipc.receiveChannels, ["naimage:automation:response"]);
  const capture = await debug.execute("debug.capture-window", { label: "debug smoke", scope: "window" });
  assert.equal(capture.location, `<diagnostics>/${capture.fileName}`);
  assert.equal(capture.capturedScope, "page");
  assert.equal(existsSync(path.join(debugDir, capture.fileName)), true);
  assert.deepEqual(readFileSync(path.join(debugDir, capture.fileName)), png);

  const disabled = createDebugCommandService({
    appRoot,
    debugDir,
    electronLog,
    commandSchemaPath: schemaPath,
    BrowserWindow,
    enabled: false
  });
  await assert.rejects(disabled.execute("debug.runtime-state", {}), (error) => error.code === "DEBUG_COMMAND_DISABLED");

  const emptyBrowserWindow = { getAllWindows: () => [] };
  const automation = createAutomationService({
    BrowserWindow: emptyBrowserWindow,
    configDir: root,
    version: "1.0.9",
    executablePath: "SparkAIWorkSpace.exe",
    log: () => {},
    serviceCommandHandler: debug.execute,
    serviceCommandNames: debug.commands
  });
  try {
    const endpoint = await automation.start();
    const inspected = await post(endpoint, "debug.inspect-command", { name: "canvas.state" });
    assert.equal(inspected.status, 200);
    assert.equal(inspected.payload.result.name, "canvas.state");
    const rendererCommand = await post(endpoint, "canvas.state", {});
    assert.equal(rendererCommand.status, 503, "Renderer commands still require a ready Renderer");
  } finally {
    await automation.stop();
  }

  const productionAutomation = createAutomationService({
    BrowserWindow: emptyBrowserWindow,
    configDir: path.join(root, "production"),
    version: "1.0.9",
    executablePath: "SparkAIWorkSpace.exe",
    log: () => {},
    serviceCommandHandler: disabled.execute,
    serviceCommandNames: disabled.commands
  });
  try {
    const endpoint = await productionAutomation.start();
    const denied = await post(endpoint, "debug.runtime-state", {});
    assert.equal(denied.payload.ok, false);
    assert.equal(denied.payload.code, "DEBUG_COMMAND_DISABLED");
  } finally {
    await productionAutomation.stop();
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, debugCommands: 7, redaction: true, productionDenied: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
