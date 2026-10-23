import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reviewedTemplatePolicy from "../runtime/image-generation/comfyui-template-registry.cjs";
import {
  createMcpRequestHandler,
  invokeAutomationTool,
  loadAutomationTools
} from "../integrations/naimage-control/scripts/naimage-mcp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "integrations", "naimage-control", "references", "commands.schema.json");
const mcpPath = path.join(root, "integrations", "naimage-control", "scripts", "naimage-mcp.mjs");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runStdioServer(connectionPath, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpPath, "--connection", connectionPath], {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `MCP server exited with ${code}`));
      else resolve(stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
    });
    child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
  });
}

async function main() {
  const registry = loadAutomationTools(schemaPath);
  assert.equal(registry.byName.get("canvas.state").surface, "renderer");
  assert.equal(registry.byName.get("debug.runtime-state").surface, "service");
  assert.equal(registry.tools.length, registry.commands.length);
  for (const name of ["agent.task.start", "agent.task.answer"]) assert.equal(registry.tools.find(tool => tool.name === name).annotations.readOnlyHint, false);
  for (const name of ["agent.task.get", "agent.task.wait"]) assert.equal(registry.tools.find(tool => tool.name === name).annotations.readOnlyHint, true);
  assert.equal(registry.tools.find((tool) => tool.name === "debug.inspect-command").inputSchema.required[0], "name");
  const comfyuiGenerateSchema = registry.tools.find(tool => tool.name === "comfyui.generate").inputSchema;
  const comfyuiOptionsSchema = comfyuiGenerateSchema.properties.comfyui;
  assert.equal(comfyuiOptionsSchema.properties.steps.minimum, 1);
  assert.equal(comfyuiOptionsSchema.properties.steps.maximum, 150);
  assert.equal(comfyuiOptionsSchema.properties.cfg.maximum, 30);
  assert.equal(comfyuiOptionsSchema.properties.denoise.maximum, 1);
  assert.match(comfyuiOptionsSchema.properties.sampler.pattern, /100/);
  const workflowImport = registry.tools.find(tool => tool.name === "comfyui.workflow.import");
  const workflowApprove = registry.tools.find(tool => tool.name === "comfyui.workflow.approve");
  const maskList = registry.tools.find(tool => tool.name === "comfyui.mask.list");
  const maskImport = registry.tools.find(tool => tool.name === "comfyui.mask.import");
  assert.ok(workflowImport && workflowApprove && maskList && maskImport);
  assert.deepEqual(
    workflowApprove.inputSchema.properties.inputMappings.items.properties.kind.enum.slice(-5),
    ["steps", "cfg", "sampler", "scheduler", "denoise"]
  );
  assert.equal(workflowApprove.inputSchema.properties.inputMappings.items.properties.value, undefined);
  assert.equal(workflowApprove.inputSchema.properties.inputMappings.items.properties.kind.enum.includes("value"), false);
  assert.equal(workflowApprove.inputSchema.properties.inputMappings.items.properties.kind.enum.includes("image"), false);
  assert.deepEqual(workflowApprove.inputSchema.properties.capability.enum, ["generate", "img2img", "inpaint", "cutout"]);
  assert.deepEqual(workflowApprove.inputSchema.properties.capability.enum, [...reviewedTemplatePolicy.WORKFLOW_CAPABILITIES]);
  assert.deepEqual([...workflowApprove.inputSchema.properties.inputMappings.items.properties.kind.enum].sort(), Object.keys(reviewedTemplatePolicy.MAPPING_PORTS).filter(kind => kind !== "image").sort());
  assert.equal(workflowApprove.annotations.readOnlyHint, false);
  assert.equal(workflowImport.annotations.readOnlyHint, false);
  assert.equal(maskList.annotations.readOnlyHint, true);
  assert.equal(maskImport.annotations.readOnlyHint, false);
  assert.deepEqual(Object.keys(workflowImport.inputSchema.properties), ["label"]);
  assert.deepEqual(Object.keys(maskImport.inputSchema.properties), ["expectedProjectId", "conversationId", "sourceImage", "confirmed"]);
  assert.deepEqual(comfyuiOptionsSchema.anyOf.map(branch => branch.required), [["workflowId"], ["templateId"]]);
  assert.equal(comfyuiOptionsSchema.required.includes("checkpoint"), false);
  assert.equal(comfyuiOptionsSchema.properties.strength.maximum, 1);
  assert.deepEqual(comfyuiOptionsSchema.properties.sourceImage.required, ["assetId", "occurrenceId", "contentHash"]);
  assert.deepEqual(comfyuiOptionsSchema.properties.maskImage.required, ["assetId", "occurrenceId", "contentHash", "revision"]);
  assert.equal(comfyuiOptionsSchema.properties.referenceImages.maxItems, 4);
  for (const field of ["sourceImage", "maskImage"]) {
    assert.equal(comfyuiOptionsSchema.properties[field].additionalProperties, false);
    for (const key of ["path", "url", "base64", "dataUrl", "bytes"]) assert.equal(comfyuiOptionsSchema.properties[field].properties[key], undefined);
  }
  const connectionList = registry.tools.find(tool => tool.name === "comfyui.connections");
  const connectionSave = registry.tools.find(tool => tool.name === "comfyui.connection.save");
  const connectionTest = registry.tools.find(tool => tool.name === "comfyui.connection.test");
  const connectionCredentialImport = registry.tools.find(tool => tool.name === "comfyui.connection.import-credential");
  assert.ok(connectionList && connectionSave && connectionTest && connectionCredentialImport, "ComfyUI connection commands must be exposed through MCP");
  assert.deepEqual(Object.keys(connectionSave.inputSchema.properties), ["connectionId", "label", "enabled", "confirmed"]);
  assert.deepEqual(connectionSave.inputSchema.required, ["connectionId", "confirmed"]);
  assert.equal(connectionSave.inputSchema.properties.credentialRef, undefined, "Protected refs stay Main-owned");
  assert.deepEqual(connectionCredentialImport.inputSchema.properties.credentialType.enum, ["bearer", "basic", "mtls"]);
  assert.deepEqual(connectionCredentialImport.inputSchema.required, ["connectionId", "credentialType", "confirmed"]);
  assert.deepEqual(Object.keys(connectionCredentialImport.inputSchema.properties), ["connectionId", "credentialType", "confirmed"]);
  assert.equal(connectionTest.inputSchema.properties.confirmed.type, "boolean");
  assert.equal(connectionSave.inputSchema.properties.token, undefined, "Connection schema must never accept a token field");
  assert.equal(comfyuiOptionsSchema.properties.connectionId.type, "string");
  assert.equal(comfyuiOptionsSchema.properties.profileId.type, "string");
  assert.equal(comfyuiOptionsSchema.properties.baseUrl, undefined);
  assert.equal(comfyuiOptionsSchema.required.includes("connectionId"), true);
  const inspectSchema = registry.tools.find(tool => tool.name === "comfyui.inspect").inputSchema;
  assert.equal(inspectSchema.properties.baseUrl, undefined);
  assert.equal(inspectSchema.required.includes("connectionId"), true);
  const runtimeCommands = registry.tools.filter(tool => /^(?:comfyui\.runtime\.|comfyui\.manifest\.import$)/.test(tool.name));
  assert.equal(runtimeCommands.length, 12);
  for (const tool of runtimeCommands) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, ["comfyui.runtime.list", "comfyui.runtime.status"].includes(tool.name));
    for (const key of Object.keys(tool.inputSchema.properties)) assert.ok(["manifestId", "planId", "runtimeId", "jobId", "revisionId"].includes(key), `Runtime MCP accepts stable IDs only: ${key}`);
  }
  const installTool = registry.tools.find(tool => tool.name === "comfyui.runtime.install");
  assert.deepEqual(installTool.inputSchema.required, ["planId"]); assert.equal(installTool.inputSchema.properties.confirmed, undefined);
  assert.equal(installTool.annotations.openWorldHint, true);
  assert.equal(registry.tools.find(tool => tool.name === "comfyui.runtime.remove").annotations.destructiveHint, true);

  const token = "fixture-automation-token";
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      response.setHeader("content-type", "application/json; charset=utf-8");
      if (request.method === "GET" && request.url === "/v1/status") {
        requests.push({ method: "GET", command: "status" });
        response.end(JSON.stringify({ ok: true, service: "naimage-automation", rendererReady: true }));
        return;
      }
      const payload = JSON.parse(body || "{}");
      requests.push({ method: request.method, command: payload.command, args: payload.args });
      response.end(JSON.stringify({ ok: true, result: { command: payload.command, args: payload.args } }));
    });
  });
  const address = await listen(server);
  const endpoint = { host: "127.0.0.1", port: address.port, token };
  const temp = mkdtempSync(path.join(os.tmpdir(), "naimage-mcp-"));
  const endpointPath = path.join(temp, "endpoint.json");
  const connectionPath = path.join(temp, "connection.json");
  writeFileSync(endpointPath, `${JSON.stringify(endpoint)}\n`, "utf8");
  writeFileSync(connectionPath, `${JSON.stringify({ endpointPath, executablePath: "unused" })}\n`, "utf8");

  try {
    const directStatus = await invokeAutomationTool("status", {}, { registry, endpoint });
    assert.equal(directStatus.rendererReady, true);
    const directState = await invokeAutomationTool("canvas.state", {}, { registry, endpoint });
    assert.equal(directState.result.command, "canvas.state");

    const handler = createMcpRequestHandler({ registry, endpoint });
    const initialized = await handler({ method: "initialize", params: { protocolVersion: "2025-06-18" } });
    assert.equal(initialized.serverInfo.name, "naimage-control");
    const listed = await handler({ method: "tools/list" });
    assert.equal(listed.tools.length, registry.tools.length);
    const called = await handler({
      method: "tools/call",
      params: { name: "debug.inspect-command", arguments: { name: "agent.goal" } }
    });
    assert.equal(called.isError, false);
    assert.equal(called.structuredContent.command, "debug.inspect-command");
    assert.deepEqual(called.structuredContent.args, { name: "agent.goal" });
    const approved = await handler({ method: "tools/call", params: { name: "comfyui.workflow.approve", arguments: {
      draftId: "workflow-draft-fixture", capability: "cutout", outputNodeId: "9", inputMappings: [{ nodeId: "10", inputName: "image", kind: "sourceImage" }], confirmed: true
    } } });
    assert.equal(approved.isError, false); assert.equal(approved.structuredContent.command, "comfyui.workflow.approve");
    assert.equal(approved.structuredContent.args.capability, "cutout");
    const install = await handler({ method: "tools/call", params: { name: "comfyui.runtime.install", arguments: { planId: "plan-fixture" } } });
    assert.equal(install.isError, false); assert.equal(install.structuredContent.command, "comfyui.runtime.install");
    assert.deepEqual(install.structuredContent.args, { planId: "plan-fixture" });
    const missing = await handler({ method: "tools/call", params: { name: "missing.command", arguments: {} } });
    assert.equal(missing.isError, true);

    const stdio = await runStdioServer(connectionPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } }
    ]);
    assert.equal(stdio.length, 3);
    assert.equal(stdio[0].result.serverInfo.name, "naimage-control");
    assert.equal(stdio[1].result.tools.length, registry.tools.length);
    assert.equal(stdio[2].result.isError, false);
    assert.doesNotMatch(JSON.stringify(stdio), new RegExp(token));
    assert.equal(requests.some((request) => request.command === "debug.inspect-command"), true);
  } finally {
    await close(server);
    rmSync(temp, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, tools: registry.tools.length, sharedRegistry: true, stdio: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
