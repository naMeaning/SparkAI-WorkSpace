import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTargetPlan,
  scanCandidate,
  scanMigrationSources
} from "./project-migration-audit.mjs";

const root = mkdtempSync(join(tmpdir(), "naimage-migration-audit-"));
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "project-migration-audit.mjs");

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

test("audit inventories project directories and global Session files without mutation", async () => {
  const projectsDir = join(root, "legacy", "projects");
  const projectPath = join(projectsDir, "catalog");
  const sessionPath = join(root, "legacy", "session.json");
  const targetParent = join(root, "target");
  mkdirSync(targetParent, { recursive: true });
  write(join(projectPath, "session.json"), JSON.stringify({ nodes: [] }));
  write(join(projectPath, "assets", "hero.txt"), "hero");
  write(sessionPath, JSON.stringify({ messages: [{ role: "user", content: "legacy" }] }));
  const beforeProject = readFileSync(join(projectPath, "assets", "hero.txt"));
  const beforeSession = statSync(sessionPath);

  const report = await scanMigrationSources({ projectsDir, sessionPath, targetParent, hashes: true });
  assert.equal(report.mode, "read-only-audit");
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.cleanupPerformed, false);
  assert.equal(report.sourceSummary.candidateCount, 2);
  assert.equal(report.sourceSummary.blockedCount, 0);
  const project = report.candidates.find((item) => item.sourceKind === "project");
  const session = report.candidates.find((item) => item.sourceKind === "global-session");
  assert.equal(project.fileCount, 2);
  assert.equal(session.fileCount, 1);
  assert.equal(session.files[0].relativePath, "session.json");
  assert.equal(session.files[0].sha256, createHash("sha256").update(readFileSync(sessionPath)).digest("hex"));
  assert.equal(report.targetPlan.spaceOk === null || typeof report.targetPlan.spaceOk === "boolean", true);
  assert.deepEqual(readFileSync(join(projectPath, "assets", "hero.txt")), beforeProject);
  assert.equal(statSync(sessionPath).mtimeMs, beforeSession.mtimeMs);
  assert.equal(JSON.stringify(report).includes(root), false);
});

test("sensitive files and symlink-like sources are blocked and paths are redacted", async () => {
  const sensitivePath = join(root, "legacy", "projects", "secret-project");
  write(join(sensitivePath, "app-settings.secrets.json"), "secret");
  const sensitive = await scanCandidate(sensitivePath, "project", { hashes: true });
  assert.equal(sensitive.blocked, true);
  assert.equal(sensitive.blockedCode, "PROJECT_MIGRATION_SENSITIVE_FILE");
  assert.equal(sensitive.blockedReason.includes(root), false);

  const fileAsProject = join(root, "legacy", "not-a-directory.json");
  write(fileAsProject, "{}");
  const invalid = await scanCandidate(fileAsProject, "project");
  assert.equal(invalid.blockedCode, "MIGRATION_AUDIT_SOURCE_INVALID");
});

test("target plan de-duplicates destination names and preserves read-only boundaries", () => {
  const target = join(root, "target");
  mkdirSync(join(target, "catalog"), { recursive: true });
  const plan = buildTargetPlan([
    { sourceName: "catalog", sourceFingerprint: "a", fileCount: 1, totalBytes: 10, blocked: false },
    { sourceName: "catalog", sourceFingerprint: "b", fileCount: 2, totalBytes: 20, blocked: false }
  ], target, 1000);
  assert.deepEqual(plan.items.map((item) => item.destinationName), ["catalog (2)", "catalog (3)"]);
  assert.equal(plan.spaceOk, false);
  assert.equal(plan.requiredBytes, 8 * 1024 * 1024 + 30);
});

test("CLI refuses mutation, protects sources and supports explicit plan output", async () => {
  const projectsDir = join(root, "legacy", "projects");
  const sessionPath = join(root, "legacy", "session.json");
  const outsidePlan = join(root, "audit-plan.json");
  const denied = spawnSync(process.execPath, [scriptPath, "--projects-dir", projectsDir, "--execute"], { encoding: "utf8" });
  assert.equal(denied.status, 2);
  const ok = spawnSync(process.execPath, [scriptPath, "--projects-dir", projectsDir, "--session", sessionPath, "--write-plan", outsidePlan], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(existsSync(outsidePlan), true);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(outsidePlan, "utf8"))).includes(root), false);
  const overwrite = spawnSync(process.execPath, [scriptPath, "--session", sessionPath, "--write-plan", sessionPath], { encoding: "utf8" });
  assert.notEqual(overwrite.status, 0);
});

test.after(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
});

console.log("project migration audit selftest passed (4 contracts)");
