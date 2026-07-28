"use strict";

const assert = require("node:assert/strict");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { createAutomationService } = require("../desktop/automation-service.cjs");

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-automation-"));
  const destroyedHandlers = [];
  const webContents = {
    id: 77,
    isDestroyed: () => false,
    once: (_event, handler) => destroyedHandlers.push(handler),
    send(_channel, payload) {
      setImmediate(() => service.resolveRendererResponse(webContents, {
        requestId: payload.requestId,
        ok: true,
        result: { command: payload.command, args: payload.args }
      }));
    }
  };
  const window = { isDestroyed: () => false, isFocused: () => true, webContents };
  const service = createAutomationService({
    BrowserWindow: { getAllWindows: () => [window] },
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
      body: JSON.stringify({ command: "canvas.state", args: { compact: true } })
    });
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.result.command, "canvas.state");
    const denied = await fetch(`http://127.0.0.1:${endpoint.port}/v1/status`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(denied.status, 401);
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
  } finally {
    await service.stop();
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, rendererLifecycleListeners: destroyedHandlers.length })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
