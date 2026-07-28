"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-integration-"));
  const appRoot = path.join(root, "app");
  const codexRoot = path.join(root, "codex");
  const skillRoot = path.join(appRoot, "integrations", "naimage-control");
  mkdirSync(path.join(skillRoot, "scripts"), { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: naimage-control\ndescription: fixture\n---\n\n# Fixture\n", "utf8");
  writeFileSync(path.join(skillRoot, "scripts", "naimage.ps1"), "Write-Output fixture\n", "utf8");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexRoot;
  try {
    const modulePath = require.resolve("../desktop/agent-integration-service.cjs");
    delete require.cache[modulePath];
    const { createAgentIntegrationService } = require(modulePath);
    const service = createAgentIntegrationService({
      appRoot,
      endpointPath: path.join(root, "endpoint.json"),
      executablePath: path.join(root, "naimage.exe"),
      log: () => {}
    });
    const installed = service.install(["codex"]);
    assert.equal(installed.ok, true);
    const installedPath = path.join(codexRoot, "skills", "naimage-control");
    assert.equal(existsSync(path.join(installedPath, "SKILL.md")), true);
    const connection = JSON.parse(readFileSync(path.join(installedPath, ".naimage-connection.json"), "utf8"));
    assert.equal(connection.installedBy, "naimage");
    const detected = service.detect();
    assert.equal(detected.targets.find((target) => target.id === "codex").installed, true);
    const removed = service.remove(["codex"]);
    assert.equal(removed.ok, true);
    assert.equal(existsSync(installedPath), false);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, targets: 1 })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
