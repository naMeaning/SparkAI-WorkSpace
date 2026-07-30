import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const isWindows = process.platform === "win32";
const pnpm = "pnpm";
const pnpmCli = [
  process.env.NAIMAGE_PNPM_CLI,
  process.env.npm_execpath,
  process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs") : "",
  process.env.PNPM_HOME ? join(process.env.PNPM_HOME, "pnpm.cjs") : ""
].filter((candidate) => String(candidate || "").endsWith("pnpm.cjs"))
  .find((candidate) => existsSync(candidate)) || "";
const startedAt = new Date();
const runDir = join(projectRoot, ".diagnostics", "release", `verify-${startedAt.toISOString().replace(/[:.]/g, "-")}`);
const lockDir = join(projectRoot, ".release-tools");
const lockPath = join(lockDir, "release-verify.lock");

const gates = [
  ["typecheck", pnpm, ["run", "typecheck"]],
  ["agent text", pnpm, ["run", "test:agent-text"]],
  ["agent protocol", pnpm, ["run", "test:agent-protocol"]],
  ["agent responses adapter", pnpm, ["run", "test:agent-responses-adapter"]],
  ["agent context strategy", pnpm, ["run", "test:context-strategy"]],
  ["agent context checkpoint", pnpm, ["run", "test:context-checkpoint"]],
  ["agent panel layout", pnpm, ["run", "test:agent-panel-layout"]],
  ["agent panel UI", pnpm, ["run", "test:agent-panel-ui"]],
  ["agent window", pnpm, ["run", "test:agent-window"]],
  ["agent window UI", pnpm, ["run", "test:agent-window-ui"]],
  ["agent run control", pnpm, ["run", "test:agent-run-control"]],
  ["agent steer", pnpm, ["run", "test:agent-steer"]],
  ["controlled shell command", pnpm, ["run", "test:controlled-shell-command"]],
  ["New API transport", pnpm, ["run", "test:new-api-transport"]],
  ["custom API transport", pnpm, ["run", "test:custom-api-transport"]],
  ["license", pnpm, ["run", "test:license"]],
  ["view image", pnpm, ["run", "test:view-image"]],
  ["project IO", pnpm, ["run", "test:project-io"]],
  ["project save coordinator", pnpm, ["run", "test:project-save-coordinator"]],
  ["project session merge", pnpm, ["run", "test:project-session-merge"]],
  ["project session dual Renderer", pnpm, ["run", "test:project-session-dual-renderer"]],
  ["node mutation journal", pnpm, ["run", "test:node-mutation-journal"]],
  ["model catalog", pnpm, ["run", "test:model-catalog"]],
  ["settings persistence", pnpm, ["run", "test:settings-persistence"]],
  ["settings lazy load", pnpm, ["run", "test:settings-lazy-load"]],
  ["Glass theme", pnpm, ["run", "test:glass-theme"]],
  ["Workspace Glass UI", pnpm, ["run", "test:workspace-glass-ui"]],
  ["theme preset", pnpm, ["run", "test:theme-preset"]],
  ["UI foundation", pnpm, ["run", "test:ui-foundation"]],
  ["paste blocks", pnpm, ["run", "test:paste-blocks"]],
  ["image layout", pnpm, ["run", "test:image-layout"]],
  ["image container", pnpm, ["run", "test:image-container"]],
  ["image stream preview", pnpm, ["run", "test:image-stream-preview"]],
  ["image batch scheduler", pnpm, ["run", "test:image-batch-scheduler"]],
  ["image export", pnpm, ["run", "test:image-export"]],
  ["encoded image format", pnpm, ["run", "test:image-format"]],
  ["remote asset security", pnpm, ["run", "test:remote-asset-security"]],
  ["requirement signature", pnpm, ["run", "test:requirement-signature"]],
  ["requirement graph", pnpm, ["run", "test:requirement-graph"]],
  ["skill import", pnpm, ["run", "test:skill-import"]],
  ["task scope", pnpm, ["run", "test:task-scope"]],
  ["Goal task scope", pnpm, ["run", "test:goal-task-scope"]],
  ["Goal runtime", pnpm, ["run", "test:goal-runtime"]],
  ["Goal probe admission", pnpm, ["run", "test:goal-probe-admission"]],
  ["Goal probe dual Renderer", pnpm, ["run", "test:goal-probe-dual-renderer"]],
  ["execution gate", pnpm, ["run", "test:execution-gate"]],
  ["selection reducer", pnpm, ["run", "test:selection"]],
  ["canvas commands", pnpm, ["run", "test:canvas-commands"]],
  ["canvas clipboard", pnpm, ["run", "test:canvas-clipboard"]],
  ["asset identity", pnpm, ["run", "test:asset-identity"]],
  ["tool timeline", pnpm, ["run", "test:timeline"]],
  ["chroma key", pnpm, ["run", "test:chroma-key"]],
  ["layer alpha", pnpm, ["run", "test:layer-alpha"]],
  ["layer mask replay", pnpm, ["run", "test:layer-mask-replay"]],
  ["semantic matting", pnpm, ["run", "test:semantic-matting"]],
  ["PSD export", pnpm, ["run", "test:psd-export"]],
  ["thumbnail cache", pnpm, ["run", "test:thumbnail-cache"]],
  ["image import", pnpm, ["run", "test:image-import"]],
  ["IPC registration", pnpm, ["run", "test:ipc-registration"]],
  ["account token", pnpm, ["run", "test:account-token"]],
  ["account token quota", pnpm, ["run", "test:account-token-quota"]],
  ["plugin system", pnpm, ["run", "test:plugin-system"]],
  ["commerce set", pnpm, ["run", "test:commerce-set"]],
  ["project graph", pnpm, ["run", "test:project-graph"]],
  ["automation service", pnpm, ["run", "test:automation-service"]],
  ["agent integration", pnpm, ["run", "test:agent-integration"]],
  ["AIDebug fixture bridge", pnpm, ["run", "test:aidebug-agent-fixtures"]],
  ["AIDebug options", pnpm, ["run", "test:aidebug-options"]],
  ["AIDebug catalog", pnpm, ["run", "test:aidebug-catalog"]],
  ["AIDebug workpack", pnpm, ["run", "test:aidebug-workpack"]],
  ["Graph CLI harness", pnpm, ["run", "test:aidebug-graph-cli-harness"]],
  ["Glass workspace harness", pnpm, ["run", "test:aidebug-glass-workspace"]],
  ["release orchestrator contract", pnpm, ["run", "test:release-orchestrator"]],
  ["Electron lifecycle", pnpm, ["run", "test:lifecycle"]],
  ["agent text UI", pnpm, ["run", "test:agent-text-ui"]],
  ["authentication gate GUI", pnpm, ["run", "aidebug:auth-gate"]],
  ["AskUser GUI", pnpm, ["run", "aidebug:ask-user"]],
  ["image import GUI", pnpm, ["run", "aidebug:image-import"]],
  ["selection GUI", pnpm, ["run", "aidebug:selection"]],
  ["requirement GUI", pnpm, ["run", "aidebug:requirements"]],
  ["image recovery GUI", pnpm, ["run", "aidebug:image-recovery"]],
  ["canvas clarity GUI", pnpm, ["run", "aidebug:canvas-clarity"]],
  ["context menus GUI", pnpm, ["run", "aidebug:menus"]],
  ["image collection GUI", process.execPath, ["scripts/aidebug-gui.mjs", "--image-collection-suite", "--mock-agent"]],
  ["Graph CLI GUI", pnpm, ["run", "aidebug:graph-cli"]],
  ["Skill node GUI", pnpm, ["run", "aidebug:skills"]],
  ["Goal mode GUI", pnpm, ["run", "aidebug:goal"]],
  ["commerce set GUI", pnpm, ["run", "aidebug:commerce-set"]],
  ["Glass workspace GUI", pnpm, ["run", "aidebug:glass-workspace"]],
  ["stop pending GUI", pnpm, ["run", "aidebug:stop-pending"]],
  ["product performance", pnpm, ["run", "aidebug:performance:product"]],
  ["production build", pnpm, ["run", "build"]],
  ["bundle budget", pnpm, ["run", "test:bundle"]],
  ["bundle policy", pnpm, ["run", "test:bundle-policy"]],
  ["desktop update", pnpm, ["run", "test:update"]],
  ["desktop update rollback", pnpm, ["run", "test:update-rollback"]],
  ["update helper", pnpm, ["run", "test:update-helper"]]
];

function valueArg(name, fallback = "") {
  const item = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
}

const resumeReportInput = String(
  valueArg("--resume-report", process.env.NAIMAGE_RELEASE_VERIFY_RESUME_REPORT || "")
).trim();
const resumeFromLabel = String(
  valueArg("--resume-from", process.env.NAIMAGE_RELEASE_VERIFY_RESUME_FROM || "")
).trim();
const resumeAllowedChangedPaths = String(
  valueArg("--resume-allow-changed", process.env.NAIMAGE_RELEASE_VERIFY_RESUME_ALLOW_CHANGED || "")
).split(/[;,]/)
  .map((value) => value.trim().replaceAll("\\", "/"))
  .filter(Boolean);

function run(command, args) {
  return new Promise((resolveRun) => {
    let child;
    try {
      if (command === pnpm && isWindows && !pnpmCli) {
        resolveRun({ exitCode: 1, error: "Windows pnpm.cjs was not found; set NAIMAGE_PNPM_CLI." });
        return;
      }
      const executable = command === pnpm && pnpmCli ? process.execPath : command;
      const executableArgs = command === pnpm && pnpmCli ? [pnpmCli, ...args] : args;
      child = spawn(executable, executableArgs, {
        cwd: projectRoot,
        env: { ...process.env, NAIMAGE_RELEASE_VERIFY: "1" },
        shell: false,
        stdio: "inherit",
        windowsHide: true
      });
    } catch (error) {
      resolveRun({ exitCode: 1, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.on("error", (error) => resolveRun({ exitCode: 1, error: error.message }));
    child.on("exit", (code, signal) => resolveRun({ exitCode: code ?? 1, signal: signal || "" }));
  });
}

function gitOutput(args, encoding = null) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    windowsHide: true,
    encoding,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed.`);
  return result.stdout;
}

function isInside(candidate, root) {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

function gitLines(args) {
  return String(gitOutput(args, "utf8") || "")
    .split(/\r?\n/)
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

function changedPathsSince(baseHead) {
  const committed = gitLines(["diff", "--name-only", "--diff-filter=ACMR", `${baseHead}..HEAD`]);
  const tracked = gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
  const untracked = String(gitOutput(["ls-files", "--others", "--exclude-standard", "-z"], "utf8") || "")
    .split("\0")
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(Boolean);
  return [...new Set([...committed, ...tracked, ...untracked])].sort();
}

function resolveResumeCheckpoint() {
  if (!resumeReportInput && !resumeFromLabel) return null;
  if (!resumeReportInput || !resumeFromLabel) {
    throw new Error("发布续跑必须同时提供 --resume-report 与 --resume-from。");
  }
  const reportPath = resolve(resumeReportInput);
  const releaseEvidenceRoot = join(projectRoot, ".diagnostics", "release");
  if (!isInside(reportPath, releaseEvidenceRoot) || !existsSync(reportPath)) {
    throw new Error("发布续跑报告必须是当前项目 .diagnostics/release 内已有的 report.json。");
  }
  const previous = JSON.parse(readFileSync(reportPath, "utf8"));
  const previousResults = Array.isArray(previous?.results) ? previous.results : [];
  const startIndex = gates.findIndex(([label]) => label === resumeFromLabel);
  if (startIndex < 0) throw new Error(`发布续跑门禁不存在：${resumeFromLabel}`);
  if (previous?.sourceStable !== true || !previous?.sourceBefore?.head || previous?.sourceBefore?.head !== previous?.sourceAfter?.head || previous?.sourceBefore?.digest !== previous?.sourceAfter?.digest) {
    throw new Error("发布续跑报告的源码指纹不稳定，不能作为检查点。");
  }
  if (Number(previous?.expectedGateCount || 0) !== gates.length || previousResults.length <= startIndex) {
    throw new Error("发布续跑报告与当前门禁数量或失败位置不一致。");
  }
  for (let index = 0; index < startIndex; index += 1) {
    if (previousResults[index]?.label !== gates[index][0] || previousResults[index]?.exitCode !== 0) {
      throw new Error(`发布续跑前置门禁证据无效：${gates[index][0]}`);
    }
  }
  if (previousResults[startIndex]?.label !== resumeFromLabel || previousResults[startIndex]?.exitCode === 0) {
    throw new Error(`发布续跑报告没有在 ${resumeFromLabel} 失败。`);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", previous.sourceBefore.head, "HEAD"], {
    cwd: projectRoot,
    windowsHide: true,
    encoding: "utf8"
  });
  if (ancestor.status !== 0) throw new Error("发布续跑报告的源码提交不是当前 HEAD 的祖先。");
  const changedPaths = changedPathsSince(previous.sourceBefore.head);
  const unexpectedChangedPaths = changedPaths.filter((item) => !resumeAllowedChangedPaths.includes(item));
  if (unexpectedChangedPaths.length > 0) {
    throw new Error(`发布续跑发现未授权的源码变化：${unexpectedChangedPaths.join(", ")}`);
  }
  return {
    reportPath,
    fromLabel: resumeFromLabel,
    startIndex,
    previousHead: previous.sourceBefore.head,
    changedPaths,
    allowedChangedPaths: resumeAllowedChangedPaths,
    reusedResults: previousResults.slice(0, startIndex).map((row) => ({
      ...row,
      reused: true,
      reusedFromReport: reportPath
    }))
  };
}

function sourceFingerprint() {
  const hash = createHash("sha256");
  const head = String(gitOutput(["rev-parse", "HEAD"], "utf8")).trim();
  hash.update(`head\0${head}\0`);
  hash.update(gitOutput(["diff", "--binary", "HEAD"]));
  const untracked = String(gitOutput(["ls-files", "--others", "--exclude-standard", "-z"], "utf8"))
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const item of untracked) {
    const filePath = join(projectRoot, item);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) continue;
    hash.update(`untracked\0${item}\0`);
    hash.update(readFileSync(filePath));
  }
  return { head, digest: hash.digest("hex"), untrackedCount: untracked.length };
}

function acquireVerifyLock() {
  mkdirSync(lockDir, { recursive: true });
  if (existsSync(lockPath)) {
    let owner = null;
    try { owner = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
    const pid = Number(owner?.pid || 0);
    if (pid > 0) {
      try {
        process.kill(pid, 0);
        throw new Error(`另一个 release:verify 正在运行（PID ${pid}）。`);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(lockPath, { force: true });
  }
  const descriptor = openSync(lockPath, "wx");
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString() }, null, 2)}\n`, "utf8");
  return () => {
    try { closeSync(descriptor); } catch {}
    rmSync(lockPath, { force: true });
  };
}

mkdirSync(runDir, { recursive: true });
const releaseVerifyLock = acquireVerifyLock();
const sourceBefore = sourceFingerprint();
const results = [];
let sourceAfter = null;
let runnerFailure = "";
let resumeCheckpoint = null;
try {
  resumeCheckpoint = resolveResumeCheckpoint();
  if (resumeCheckpoint) {
    results.push(...resumeCheckpoint.reusedResults);
    process.stdout.write(`\n[release:verify] RESUME ${resumeCheckpoint.fromLabel}，复用 ${resumeCheckpoint.reusedResults.length} 项已通过门禁：${resumeCheckpoint.reportPath}\n`);
  }
  for (let index = resumeCheckpoint?.startIndex || 0; index < gates.length; index += 1) {
    const [label, command, args] = gates[index];
    const gateStartedAt = Date.now();
    process.stdout.write(`\n[release:verify] ${label}\n`);
    const result = await run(command, args);
    const row = { label, command, args, ...result, durationMs: Date.now() - gateStartedAt };
    results.push(row);
    if (row.exitCode !== 0) break;
  }
  sourceAfter = sourceFingerprint();
} catch (error) {
  runnerFailure = error instanceof Error ? error.stack || error.message : String(error);
  try { sourceAfter = sourceFingerprint(); } catch {}
} finally {
  releaseVerifyLock();
}

const sourceStable = Boolean(sourceAfter && sourceAfter.digest === sourceBefore.digest);
const report = {
  ok: !runnerFailure && sourceStable && results.length === gates.length && results.every((item) => item.exitCode === 0),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  expectedGateCount: gates.length,
  completedGateCount: results.length,
  sourceStable,
  sourceBefore,
  sourceAfter,
  resumeCheckpoint: resumeCheckpoint ? {
    reportPath: resumeCheckpoint.reportPath,
    fromLabel: resumeCheckpoint.fromLabel,
    previousHead: resumeCheckpoint.previousHead,
    changedPaths: resumeCheckpoint.changedPaths,
    allowedChangedPaths: resumeCheckpoint.allowedChangedPaths,
    reusedGateCount: resumeCheckpoint.reusedResults.length
  } : null,
  runnerFailure,
  results
};
const reportPath = join(runDir, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\n[release:verify] ${report.ok ? "PASS" : "FAIL"} ${reportPath}\n`);
if (!sourceStable) process.stderr.write("[release:verify] Source worktree changed while gates were running; this evidence is invalid.\n");
if (runnerFailure) process.stderr.write(`${runnerFailure}\n`);
if (!report.ok) process.exitCode = 1;
