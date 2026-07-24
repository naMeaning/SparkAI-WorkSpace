"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  controlledCommandPlan,
  executeControlledCommand,
  isExploreCommand,
  resolveCommandCwd,
  resolveCommandPath,
  splitCommandLine
} = require("../runtime/controlled-shell-command.cjs");

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), "naimage-controlled-shell-"));
  const nested = path.join(root, "nested");
  const fixture = path.join(nested, "fixture.txt");
  mkdirSync(nested, { recursive: true });
  writeFileSync(fixture, "line one\nline two\nline three\n", "utf8");

  try {
    assert.deepEqual(splitCommandLine('rg -n "hello world" nested'), ["rg", "-n", "hello world", "nested"]);
    assert.equal(resolveCommandCwd(root, "nested").ok, true);
    assert.equal(resolveCommandCwd(root, "..").ok, false);
    assert.equal(resolveCommandPath(root, root, "nested/fixture.txt").ok, true);
    assert.equal(resolveCommandPath(root, root, "../outside.txt").ok, false);

    assert.equal(controlledCommandPlan("Get-Location", root, root).kind, "cwd");
    assert.equal(controlledCommandPlan("node --version", root, root).kind, "spawn");
    assert.equal(controlledCommandPlan("git status --short --branch", root, root).kind, "spawn");
    assert.equal(controlledCommandPlan("rg --files nested", root, root).kind, "spawn");
    assert.equal(controlledCommandPlan("rg -n line nested", root, root).kind, "spawn");
    assert.equal(controlledCommandPlan("Get-Content nested/fixture.txt -TotalCount 2", root, root).kind, "read-file");

    assert.equal(controlledCommandPlan("Remove-Item nested", root, root).ok, false);
    assert.equal(controlledCommandPlan("git status; Get-Location", root, root).ok, false);
    assert.equal(controlledCommandPlan("rg -n $(Get-Location) nested", root, root).ok, false);
    assert.equal(controlledCommandPlan("Get-Content nested -TotalCount 2", root, root).ok, false);
    assert.equal(controlledCommandPlan("Get-Content ../outside.txt -TotalCount 2", root, root).ok, false);

    const cwdResult = await executeControlledCommand({ command: "Get-Location" }, root);
    assert.equal(cwdResult.ok, true);
    assert.match(cwdResult.text, /exitCode: 0/);
    assert.match(cwdResult.text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const readResult = await executeControlledCommand(
      { command: "Get-Content nested/fixture.txt -TotalCount 2" },
      root
    );
    assert.equal(readResult.ok, true);
    assert.match(readResult.text, /line one\nline two/);
    assert.doesNotMatch(readResult.text, /line three/);

    const rejected = await executeControlledCommand({ command: "Set-Content fixture.txt unsafe" }, root);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.errorCategory, "policy");

    assert.equal(isExploreCommand("rg -n marker ."), true);
    assert.equal(isExploreCommand("Get-Content file.txt -TotalCount 2"), true);
    assert.equal(isExploreCommand("node --version"), false);

    console.log("controlled shell command self-test passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
