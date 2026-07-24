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
import { dirname, join, resolve } from "node:path";
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
  ["New API transport", pnpm, ["run", "test:new-api-transport"]],
  ["view image", pnpm, ["run", "test:view-image"]],
  ["project IO", pnpm, ["run", "test:project-io"]],
  ["UI foundation", pnpm, ["run", "test:ui-foundation"]],
  ["image layout", pnpm, ["run", "test:image-layout"]],
  ["image container", pnpm, ["run", "test:image-container"]],
  ["requirement signature", pnpm, ["run", "test:requirement-signature"]],
  ["requirement graph", pnpm, ["run", "test:requirement-graph"]],
  ["task scope", pnpm, ["run", "test:task-scope"]],
  ["execution gate", pnpm, ["run", "test:execution-gate"]],
  ["selection reducer", pnpm, ["run", "test:selection"]],
  ["canvas commands", pnpm, ["run", "test:canvas-commands"]],
  ["asset identity", pnpm, ["run", "test:asset-identity"]],
  ["tool timeline", pnpm, ["run", "test:timeline"]],
  ["chroma key", pnpm, ["run", "test:chroma-key"]],
  ["layer alpha", pnpm, ["run", "test:layer-alpha"]],
  ["layer mask replay", pnpm, ["run", "test:layer-mask-replay"]],
  ["semantic matting", pnpm, ["run", "test:semantic-matting"]],
  ["PSD export", pnpm, ["run", "test:psd-export"]],
  ["thumbnail cache", pnpm, ["run", "test:thumbnail-cache"]],
  ["image import", pnpm, ["run", "test:image-import"]],
  ["Electron lifecycle", pnpm, ["run", "test:lifecycle"]],
  ["agent text UI", pnpm, ["run", "test:agent-text-ui"]],
  ["AskUser GUI", pnpm, ["run", "aidebug:ask-user"]],
  ["image import GUI", pnpm, ["run", "aidebug:image-import"]],
  ["selection GUI", pnpm, ["run", "aidebug:selection"]],
  ["requirement GUI", pnpm, ["run", "aidebug:requirements"]],
  ["image recovery GUI", pnpm, ["run", "aidebug:image-recovery"]],
  ["canvas clarity GUI", pnpm, ["run", "aidebug:canvas-clarity"]],
  ["image collection GUI", process.execPath, ["scripts/aidebug-gui.mjs", "--image-collection-suite", "--mock-agent"]],
  ["product performance", pnpm, ["run", "aidebug:performance:product"]],
  ["production build", pnpm, ["run", "build"]],
  ["bundle budget", pnpm, ["run", "test:bundle"]],
  ["desktop update", pnpm, ["run", "test:update"]],
  ["desktop update rollback", pnpm, ["run", "test:update-rollback"]],
  ["update helper", pnpm, ["run", "test:update-helper"]]
];

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
try {
  for (const [label, command, args] of gates) {
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
  runnerFailure,
  results
};
const reportPath = join(runDir, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\n[release:verify] ${report.ok ? "PASS" : "FAIL"} ${reportPath}\n`);
if (!sourceStable) process.stderr.write("[release:verify] Source worktree changed while gates were running; this evidence is invalid.\n");
if (runnerFailure) process.stderr.write(`${runnerFailure}\n`);
if (!report.ok) process.exitCode = 1;
