#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, statfs, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { directoryInventory, fileInventory } from "../desktop/project-data-migration.cjs";

const REPORT_VERSION = 1;
const DISK_RESERVE_BYTES = 8 * 1024 * 1024;

function text(value, limit = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
}

function comparable(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function inside(candidate, root) {
  const relation = path.relative(path.resolve(root), path.resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function sourceFingerprint(sourcePath) {
  return createHash("sha256").update(comparable(sourcePath)).digest("hex").slice(0, 16);
}

function safeFolderName(value, fallback = "旧项目") {
  const cleaned = text(value, 72)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || fallback;
}

async function availableBytes(rootPath) {
  try {
    if (typeof statfs !== "function") return null;
    const info = await statfs(rootPath);
    const blockSize = Number(info.bsize || info.frsize || 0);
    const blocks = Number(info.bavail ?? info.bfree ?? 0);
    return blockSize > 0 && blocks >= 0 ? Math.floor(blockSize * blocks) : null;
  } catch {
    return null;
  }
}

async function scanCandidate(sourcePath, sourceKind, options = {}) {
  const resolved = path.resolve(sourcePath);
  const base = {
    sourceKind,
    sourceName: path.basename(resolved) || sourceKind,
    sourceFingerprint: sourceFingerprint(resolved),
    fileCount: 0,
    totalBytes: 0,
    files: [],
    blocked: false,
    blockedCode: "",
    blockedReason: ""
  };
  try {
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink()) throw Object.assign(new Error("来源是符号链接，拒绝扫描。"), { code: "MIGRATION_AUDIT_SYMLINK" });
    if (sourceKind === "global-session" && !stats.isFile()) {
      throw Object.assign(new Error("全局 Session 来源必须是普通文件。"), { code: "MIGRATION_AUDIT_SOURCE_INVALID" });
    }
    if (sourceKind === "project" && !stats.isDirectory()) {
      throw Object.assign(new Error("项目来源必须是目录。"), { code: "MIGRATION_AUDIT_SOURCE_INVALID" });
    }
    const files = stats.isFile()
      ? await fileInventory(resolved, "session.json", { hashes: options.hashes !== false })
      : await directoryInventory(resolved, { hashes: options.hashes !== false, hashConcurrency: 2 });
    return {
      ...base,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
      files: files.map((file) => ({
        relativePath: file.relativePath,
        size: Number(file.size || 0),
        sha256: String(file.sha256 || "")
      }))
    };
  } catch (error) {
    const rawReason = text(error?.message || error, 320);
    return {
      ...base,
      blocked: true,
      blockedCode: text(error?.code, 80) || "MIGRATION_AUDIT_SCAN_FAILED",
      blockedReason: rawReason.replaceAll(resolved, "<source>")
    };
  }
}

async function discoverSources(options = {}) {
  const candidates = [];
  const seen = new Set();
  const add = async (sourcePath, kind) => {
    const resolved = path.resolve(sourcePath);
    const key = comparable(resolved);
    if (seen.has(key) || !existsSync(resolved)) return;
    seen.add(key);
    candidates.push(await scanCandidate(resolved, kind, options));
  };
  if (options.projectsDir && existsSync(options.projectsDir)) {
    const entries = await readdir(options.projectsDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await add(path.join(options.projectsDir, entry.name), "project");
    }
  }
  if (options.sessionPath && existsSync(options.sessionPath)) await add(options.sessionPath, "global-session");
  return candidates;
}

function buildTargetPlan(candidates, targetParent, available) {
  const target = targetParent ? path.resolve(targetParent) : "";
  const names = new Set();
  const items = candidates.map((candidate) => {
    let name = safeFolderName(candidate.sourceName);
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase()) || (target && existsSync(path.join(target, name)))) {
      name = `${safeFolderName(candidate.sourceName)} (${suffix})`;
      suffix += 1;
    }
    names.add(name.toLocaleLowerCase());
    return {
      sourceFingerprint: candidate.sourceFingerprint,
      destinationName: name,
      fileCount: candidate.fileCount,
      totalBytes: candidate.totalBytes,
      conflict: Boolean(target && existsSync(path.join(target, name)))
    };
  });
  const requiredBytes = items.reduce((sum, item) => sum + item.totalBytes, 0) + DISK_RESERVE_BYTES;
  return {
    targetName: target ? path.basename(target) : "未指定",
    targetFingerprint: target ? sourceFingerprint(target) : "",
    itemCount: items.length,
    requiredBytes,
    availableBytes: available,
    spaceOk: available === null ? null : available >= requiredBytes,
    items
  };
}

async function scanMigrationSources(options = {}) {
  const candidates = await discoverSources(options);
  const available = options.targetParent ? await availableBytes(options.targetParent) : null;
  const targetPlan = buildTargetPlan(candidates, options.targetParent, available);
  const blockedCount = candidates.filter((candidate) => candidate.blocked).length;
  const report = {
    schemaVersion: REPORT_VERSION,
    mode: "read-only-audit",
    networkAttempted: false,
    mutationPerformed: false,
    cleanupPerformed: false,
    sourceConfigured: Boolean(options.projectsDir || options.sessionPath),
    sourceSummary: {
      candidateCount: candidates.length,
      blockedCount,
      fileCount: candidates.reduce((sum, candidate) => sum + candidate.fileCount, 0),
      totalBytes: candidates.reduce((sum, candidate) => sum + candidate.totalBytes, 0)
    },
    candidates,
    targetPlan,
    backupPlan: {
      format: "sparkai-project-migration-backup-v1",
      entries: candidates.filter((candidate) => !candidate.blocked).map((candidate) => ({
        sourceFingerprint: candidate.sourceFingerprint,
        destinationName: targetPlan.items.find((item) => item.sourceFingerprint === candidate.sourceFingerprint)?.destinationName || "",
        files: candidate.files
      }))
    },
    nextAction: "仅生成预检和备份计划；真实迁移仍需通过应用迁移界面二次确认，本工具不会复制、删除或清理数据。"
  };
  return report;
}

function parseArgs(argv) {
  const options = { hashes: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--projects-dir") options.projectsDir = path.resolve(argv[++index]);
    else if (arg === "--session") options.sessionPath = path.resolve(argv[++index]);
    else if (arg === "--target-parent") options.targetParent = path.resolve(argv[++index]);
    else if (arg === "--no-hash") options.hashes = false;
    else if (arg === "--write-plan") options.writePlan = path.resolve(argv[++index]);
    else if (arg === "--execute" || arg === "--cleanup") options.forbiddenMutation = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

function help() {
  process.stdout.write([
    "SparkAI WorkSpace C 盘迁移只读验收工具",
    "用法：node scripts/project-migration-audit.mjs --projects-dir <旧 projects> [--session <旧 session.json>] [--target-parent <目标父目录>]",
    "默认读取文件并计算 SHA-256，不复制、不改索引、不删除源数据。可用 --write-plan 保存脱敏备份计划。",
    "--execute/--cleanup 会被明确拒绝；真实操作请使用应用内迁移流程。"
  ].join("\n") + "\n");
}

export { buildTargetPlan, discoverSources, inside, parseArgs, scanCandidate, scanMigrationSources, sourceFingerprint };

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    process.exit(0);
  }
  if (options.forbiddenMutation) {
    process.stderr.write("已拒绝：迁移验收工具只读，不执行复制或清理。请使用应用内带二次确认的迁移流程。\n");
    process.exit(2);
  }
  if (!options.projectsDir && !options.sessionPath) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: REPORT_VERSION, mode: "read-only-audit", sourceConfigured: false, nextAction: "请显式提供 --projects-dir 或 --session；不会默认扫描 C 盘。" }, null, 2)}\n`);
    process.exit(0);
  }
  const report = await scanMigrationSources(options);
  if (options.writePlan) {
    const planPath = path.resolve(options.writePlan);
    if (options.projectsDir && inside(planPath, options.projectsDir)) throw new Error("备份计划不能写入旧项目来源目录。");
    if (options.sessionPath && comparable(planPath) === comparable(options.sessionPath)) throw new Error("备份计划不能覆盖旧全局 Session 文件。");
    await writeFile(planPath, `${JSON.stringify(report.backupPlan, null, 2)}\n`, "utf8");
    report.backupPlanPath = path.basename(planPath);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
