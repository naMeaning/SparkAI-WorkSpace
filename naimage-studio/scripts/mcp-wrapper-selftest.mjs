import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  assert.equal(registry.tools.find((tool) => tool.name === "debug.inspect-command").inputSchema.required[0], "name");

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
