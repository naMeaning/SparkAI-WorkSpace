import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { forceKillProcessTree, waitForChildExit } from "../scripts/aidebug/harness/process.mjs";
import { validateSuperGoalProfile } from "./super-goal-contract.mjs";
import { snapshotWorkpackFile, writeWorkpackManifest } from "./workpack.mjs";

const runnerPath = fileURLToPath(import.meta.url);
const aidebugRoot = dirname(runnerPath);
const repoRoot = resolve(aidebugRoot, "..");
const catalogPath = join(aidebugRoot, "catalog.json");
const workpackRunnerPath = join(aidebugRoot, "workpack.mjs");
const diagnosticsRoot = join(repoRoot, ".diagnostics", "aidebug-agents");
const packageJsonPath = join(repoRoot, "package.json");
const superGoalContractPath = join(aidebugRoot, "super-goal-contract.mjs");
const activeChildren = new Set();
let cancelled = false;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function safeName(value) {
  return String(value || "worker")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "worker";
}

function isInsideRepo(filePath) {
  const rel = relative(repoRoot, resolve(filePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertInsideDiagnosticsResult(filePath) {
  const resolvedPath = resolve(filePath);
  const rel = relative(diagnosticsRoot, resolvedPath);
  if (!isInsideRepo(resolvedPath) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`--result-file must stay below ${diagnosticsRoot}.`);
  }
  if (existsSync(resolvedPath)) throw new Error(`--result-file already exists: ${resolvedPath}`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function takeValue(argv, index, flag) {
  const current = argv[index];
  if (current === flag) {
    if (index + 1 >= argv.length) throw new Error(`${flag} requires a value.`);
    return { value: argv[index + 1], consumed: 2 };
  }
  if (current.startsWith(`${flag}=`)) return { value: current.slice(flag.length + 1), consumed: 1 };
  return null;
}

function parseArgs(argv) {
  const options = {
    profile: "",
    agents: [],
    tasks: [],
    jobs: 0,
    check: false,
    list: false,
    dryRun: false,
    emitWorkpack: false,
    resultFile: "",
    failFast: false,
    allowNetwork: false,
    selfTest: false,
    help: false
  };
  for (let index = 0; index < argv.length;) {
    const current = argv[index];
    const booleans = {
      "--check": "check",
      "--list": "list",
      "--dry-run": "dryRun",
      "--emit-workpack": "emitWorkpack",
      "--fail-fast": "failFast",
      "--allow-network": "allowNetwork",
      "--self-test": "selfTest",
      "--help": "help",
      "-h": "help"
    };
    if (booleans[current]) {
      options[booleans[current]] = true;
      index += 1;
      continue;
    }
    const profile = takeValue(argv, index, "--profile");
    if (profile) {
      if (options.profile) throw new Error("Only one --profile may be selected per run.");
      options.profile = profile.value;
      index += profile.consumed;
      continue;
    }
    const agent = takeValue(argv, index, "--agent");
    if (agent) {
      options.agents.push(agent.value);
      index += agent.consumed;
      continue;
    }
    const task = takeValue(argv, index, "--task");
    if (task) {
      options.tasks.push(task.value);
      index += task.consumed;
      continue;
    }
    const jobs = takeValue(argv, index, "--jobs");
    if (jobs) {
      const parsed = Number(jobs.value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) throw new Error("--jobs must be an integer from 1 to 8.");
      options.jobs = parsed;
      index += jobs.consumed;
      continue;
    }
    const resultFile = takeValue(argv, index, "--result-file");
    if (resultFile) {
      if (options.resultFile) throw new Error("Only one --result-file may be selected per run.");
      options.resultFile = resultFile.value;
      index += resultFile.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  return options;
}

function validateId(id, label) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(id || ""))) {
    throw new Error(`${label} has an invalid id: ${id}`);
  }
}

function validateCatalog(catalog) {
  if (catalog?.version !== 1) throw new Error("AIDEBUG/catalog.json must use version 1.");
  if (!catalog.tasks || typeof catalog.tasks !== "object") throw new Error("AIDEBUG catalog has no tasks object.");
  if (!catalog.profiles || typeof catalog.profiles !== "object") throw new Error("AIDEBUG catalog has no profiles object.");
  const packageScripts = readJson(packageJsonPath).scripts || {};
  const taskIds = new Set(Object.keys(catalog.tasks));
  for (const [taskId, task] of Object.entries(catalog.tasks)) {
    validateId(taskId, "Task");
    if (!task.label || !task.kind) throw new Error(`Task ${taskId} must define label and kind.`);
    if (!Number.isInteger(task.timeoutMs) || task.timeoutMs < 1000 || task.timeoutMs > 3_600_000) {
      throw new Error(`Task ${taskId} has an invalid timeoutMs.`);
    }
    if (!Array.isArray(task.resources) || task.resources.some((resource) => !/^[a-z0-9._-]+$/i.test(resource))) {
      throw new Error(`Task ${taskId} has invalid resources.`);
    }
    if (task.runner === "pnpm") {
      if (!/^[a-z0-9:_-]+$/i.test(String(task.script || "")) || !packageScripts[task.script]) {
        throw new Error(`Task ${taskId} refers to a missing package script: ${task.script}`);
      }
    } else if (task.runner === "node") {
      if (!Array.isArray(task.args) || !task.args.length) throw new Error(`Task ${taskId} must define node args.`);
      const entryPath = resolve(repoRoot, task.args[0]);
      if (!isInsideRepo(entryPath) || !existsSync(entryPath)) {
        throw new Error(`Task ${taskId} node entry is missing or outside the repository: ${task.args[0]}`);
      }
    } else {
      throw new Error(`Task ${taskId} has unsupported runner: ${task.runner}`);
    }
  }
  for (const goalFile of catalog.goalFiles || []) {
    const filePath = resolve(repoRoot, goalFile);
    if (!isInsideRepo(filePath) || !existsSync(filePath)) throw new Error(`Goal file is missing or outside the repository: ${goalFile}`);
  }
  for (const [profileId, profile] of Object.entries(catalog.profiles)) {
    validateId(profileId, "Profile");
    if (!Array.isArray(profile.agents) || !profile.agents.length) throw new Error(`Profile ${profileId} has no agents.`);
    const agentIds = new Set();
    for (const agent of profile.agents) {
      validateId(agent.id, `Profile ${profileId} agent`);
      if (agentIds.has(agent.id)) throw new Error(`Profile ${profileId} repeats agent ${agent.id}.`);
      agentIds.add(agent.id);
      if (!agent.scope || !Array.isArray(agent.tasks) || !agent.tasks.length) {
        throw new Error(`Profile ${profileId} agent ${agent.id} must define scope and tasks.`);
      }
      for (const taskId of agent.tasks) {
        if (!taskIds.has(taskId)) throw new Error(`Profile ${profileId} agent ${agent.id} refers to unknown task ${taskId}.`);
      }
    }
  }
  const superGoal = readSuperGoal(catalog);
  if (superGoal.schemaVersion !== 1 || !superGoal.goalId || !Array.isArray(superGoal.workstreams) || !superGoal.workstreams.length) {
    throw new Error("AIDEBUG/SUPER_GOAL.json must define schemaVersion 1, goalId, and workstreams.");
  }
  const workstreamIds = new Set();
  for (const workstream of superGoal.workstreams) {
    validateId(workstream.id, "SUPER GOAL workstream");
    if (workstreamIds.has(workstream.id)) throw new Error(`SUPER GOAL repeats workstream ${workstream.id}.`);
    workstreamIds.add(workstream.id);
    if (!Array.isArray(workstream.verificationTasks) || !workstream.verificationTasks.length) {
      throw new Error(`SUPER GOAL workstream ${workstream.id} has no verificationTasks.`);
    }
    for (const taskId of workstream.verificationTasks) {
      if (!taskIds.has(taskId)) throw new Error(`SUPER GOAL workstream ${workstream.id} refers to unknown task ${taskId}.`);
    }
  }
  const superGoalProfile = validateSuperGoalProfile(catalog, superGoal, taskIds);
  return {
    taskCount: taskIds.size,
    profileCount: Object.keys(catalog.profiles).length,
    goalFileCount: (catalog.goalFiles || []).length,
    workstreamCount: workstreamIds.size,
    ...superGoalProfile
  };
}

function readSuperGoal(catalog) {
  const stateFile = String(catalog.superGoalStateFile || "");
  if (!stateFile) throw new Error("AIDEBUG catalog has no superGoalStateFile.");
  const filePath = resolve(repoRoot, stateFile);
  if (!isInsideRepo(filePath) || !existsSync(filePath)) throw new Error(`SUPER GOAL state file is missing or outside the repository: ${stateFile}`);
  return readJson(filePath);
}

function goalSnapshots(catalog) {
  return (catalog.goalFiles || []).map((item) => {
    const filePath = resolve(repoRoot, item);
    const stat = statSync(filePath);
    return {
      path: filePath,
      byteLength: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: sha256(filePath)
    };
  });
}

function controlPlaneSnapshots() {
  return [catalogPath, packageJsonPath, runnerPath, workpackRunnerPath, superGoalContractPath].map(snapshotWorkpackFile);
}

function taskResources(agent, catalog) {
  return [...new Set(agent.tasks.flatMap((taskId) => catalog.tasks[taskId].resources || []))].sort();
}

function selectAgents(catalog, options, { forWorkpack = false } = {}) {
  const selected = [];
  if (options.profile) {
    const profile = catalog.profiles[options.profile];
    if (!profile) throw new Error(`Unknown profile: ${options.profile}`);
    const requested = new Set(options.agents);
    if (requested.size) {
      const known = new Set(profile.agents.map((agent) => agent.id));
      for (const agentId of requested) if (!known.has(agentId)) throw new Error(`Unknown agent ${agentId} in profile ${options.profile}.`);
    } else if (profile.requireAgentSelection && !forWorkpack) {
      throw new Error(`Profile ${options.profile} requires at least one explicit --agent. Available: ${profile.agents.map((agent) => agent.id).join(", ")}`);
    }
    for (const agent of profile.agents) {
      if (!requested.size || requested.has(agent.id)) selected.push({ ...agent, source: `profile:${options.profile}` });
    }
  } else if (options.agents.length) {
    throw new Error("--agent requires --profile.");
  }
  for (const taskId of options.tasks) {
    if (!catalog.tasks[taskId]) throw new Error(`Unknown task: ${taskId}`);
    selected.push({
      id: `task-${safeName(taskId)}`,
      scope: catalog.tasks[taskId].label,
      tasks: [taskId],
      source: "explicit-task"
    });
  }
  const ids = new Set();
  return selected.map((agent, index) => {
    let id = agent.id;
    while (ids.has(id)) id = `${agent.id}-${index + 1}`;
    ids.add(id);
    return { ...agent, id };
  });
}

function buildWaves(agents, catalog) {
  const waves = [];
  for (const agent of agents) {
    const resources = new Set(taskResources(agent, catalog));
    let placed = false;
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index];
      if ([...resources].some((resource) => wave.resources.has(resource))) continue;
      wave.agents.push(agent.id);
      resources.forEach((resource) => wave.resources.add(resource));
      placed = true;
      break;
    }
    if (!placed) waves.push({ agents: [agent.id], resources });
  }
  return waves.map((wave, index) => ({
    index: index + 1,
    agents: wave.agents,
    exclusiveResources: [...wave.resources].sort()
  }));
}

function planSummary(agents, catalog, options) {
  return {
    profile: options.profile || null,
    explicitOnly: true,
    jobs: options.jobs || catalog.defaultJobs || 1,
    agents: agents.map((agent) => ({
      id: agent.id,
      scope: agent.scope,
      source: agent.source,
      tasks: agent.tasks.map((taskId) => ({
        id: taskId,
        label: catalog.tasks[taskId].label,
        kind: catalog.tasks[taskId].kind,
        resources: catalog.tasks[taskId].resources,
        requiresNetwork: catalog.tasks[taskId].requiresNetwork === true
      }))
    })),
    waves: buildWaves(agents, catalog),
    superGoal: readSuperGoal(catalog),
    goals: goalSnapshots(catalog)
  };
}

class ResourcePool {
  constructor() {
    this.active = new Set();
    this.queue = [];
  }

  acquire(resources) {
    const requested = [...new Set(resources || [])].sort();
    if (!requested.length) return Promise.resolve(() => {});
    return new Promise((resolveAcquire) => {
      this.queue.push({ requested, resolveAcquire });
      this.pump();
    });
  }

  pump() {
    for (let index = 0; index < this.queue.length;) {
      const item = this.queue[index];
      if (item.requested.some((resource) => this.active.has(resource))) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      item.requested.forEach((resource) => this.active.add(resource));
      let released = false;
      item.resolveAcquire(() => {
        if (released) return;
        released = true;
        item.requested.forEach((resource) => this.active.delete(resource));
        this.pump();
      });
    }
  }
}

function commandForTask(task, { internal = false } = {}) {
  if (task.runner === "node") return { command: process.execPath, args: task.args };
  if (task.runner === "pnpm") {
    if (process.platform === "win32") {
      return {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", `corepack pnpm run ${task.script}`]
      };
    }
    return { command: "corepack", args: ["pnpm", "run", task.script] };
  }
  if (internal && task.runner === "node-eval") return { command: process.execPath, args: ["-e", task.code] };
  throw new Error(`Unsupported runner: ${task.runner}`);
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await forceKillProcessTree(child.pid, { isWindows: true }).catch(() => {});
    await waitForChildExit(child, 1500).catch(() => false);
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  if (await waitForChildExit(child, 1500).catch(() => false)) return;
  await forceKillProcessTree(child.pid, { isWindows: false }).catch(() => {});
}

async function runTask({ agent, taskId, task, taskIndex, agentDir, workerStream, resourcePool, allowNetwork, internal = false }) {
  if (task.requiresNetwork && !allowNetwork) {
    return {
      taskId,
      ok: false,
      skipped: true,
      reason: "network-not-authorized",
      resources: task.resources || []
    };
  }
  const release = await resourcePool.acquire(task.resources || []);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const logPath = join(agentDir, `${String(taskIndex + 1).padStart(2, "0")}-${safeName(taskId)}.log`);
  const taskStream = createWriteStream(logPath, { flags: "wx" });
  const write = (channel, chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    taskStream.write(text);
    workerStream.write(`[${taskId}:${channel}] ${text}`);
    process.stdout.write(`[${agent.id}/${taskId}] ${text}`);
  };
  const command = commandForTask(task, { internal });
  const guiArtifactPath = task.kind === "gui"
    ? join(agentDir, `${String(taskIndex + 1).padStart(2, "0")}-${safeName(taskId)}-gui-artifact.json`)
    : "";
  workerStream.write(`\n== ${taskId} started ${startedAt} ==\n`);
  let child;
  let spawnError = "";
  let timedOut = false;
  let exitCode = null;
  let signal = null;
  try {
    child = spawn(command.command, command.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
         NAIMAGE_AIDEBUG_ORCHESTRATOR: "1",
         NAIMAGE_AIDEBUG_AGENT_ID: agent.id,
         NAIMAGE_AIDEBUG_TASK_ID: taskId,
         ...(guiArtifactPath ? { NAIMAGE_AIDEBUG_GUI_RESULT_FILE: guiArtifactPath } : {})
       }
    });
    activeChildren.add(child);
    child.stdout?.on("data", (chunk) => write("stdout", chunk));
    child.stderr?.on("data", (chunk) => write("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      void stopOwnedChild(child);
    }, task.timeoutMs);
    const outcome = await new Promise((resolveOutcome) => {
      child.once("error", (error) => resolveOutcome({ error }));
      child.once("exit", (code, childSignal) => resolveOutcome({ code, signal: childSignal }));
    });
    clearTimeout(timer);
    if (outcome.error) spawnError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    exitCode = outcome.code ?? null;
    signal = outcome.signal ?? null;
  } finally {
    if (child) activeChildren.delete(child);
    taskStream.end();
    await finished(taskStream).catch(() => {});
    release();
  }
  const endedAtMs = Date.now();
  const guiArtifact = guiArtifactPath && existsSync(guiArtifactPath) ? snapshotWorkpackFile(guiArtifactPath) : null;
  const ok = !timedOut && !spawnError && exitCode === 0 && (task.kind !== "gui" || guiArtifact !== null);
  workerStream.write(`== ${taskId} ${ok ? "passed" : "failed"} ${new Date(endedAtMs).toISOString()} ==\n`);
  return {
    taskId,
    label: task.label,
    ok,
    skipped: false,
    startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    exitCode,
    signal,
    timedOut,
    spawnError,
    resources: task.resources || [],
    logPath,
    ...(task.kind === "gui" ? { guiArtifact } : {})
  };
}

async function runAgent({ agent, catalog, runDir, resourcePool, options, state, internal = false }) {
  const agentDir = join(runDir, "workers", safeName(agent.id));
  mkdirSync(agentDir, { recursive: true });
  const workerLogPath = join(agentDir, "worker.log");
  const workerStream = createWriteStream(workerLogPath, { flags: "wx" });
  const startedAtMs = Date.now();
  const tasks = [];
  try {
    for (let index = 0; index < agent.tasks.length; index += 1) {
      const taskId = agent.tasks[index];
      if (cancelled || (options.failFast && state.failed)) {
        tasks.push({ taskId, ok: false, skipped: true, reason: cancelled ? "cancelled" : "fail-fast" });
        continue;
      }
      const result = await runTask({
        agent,
        taskId,
        task: catalog.tasks[taskId],
        taskIndex: index,
        agentDir,
        workerStream,
        resourcePool,
        allowNetwork: options.allowNetwork,
        internal
      });
      tasks.push(result);
      if (!result.ok) {
        state.failed = true;
        break;
      }
    }
  } finally {
    workerStream.end();
    await finished(workerStream).catch(() => {});
  }
  const endedAtMs = Date.now();
  const report = {
    id: agent.id,
    scope: agent.scope,
    source: agent.source,
    ok: tasks.length === agent.tasks.length && tasks.every((task) => task.ok),
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    workerLogPath,
    tasks
  };
  writeFileSync(join(agentDir, "worker.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function runAgents({ agents, catalog, runDir, jobs, options, internal = false }) {
  const resourcePool = new ResourcePool();
  const state = { next: 0, failed: false };
  const results = [];
  const workerCount = Math.max(1, Math.min(jobs, agents.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = state.next;
      state.next += 1;
      if (index >= agents.length) return;
      const result = await runAgent({ agent: agents[index], catalog, runDir, resourcePool, options, state, internal });
      results[index] = result;
    }
  }));
  return results;
}

function emitWorkpack(agents, catalog, options) {
  mkdirSync(diagnosticsRoot, { recursive: true });
  const workpackId = `workpack-${timestamp()}-${randomUUID().slice(0, 8)}`;
  const outputDir = join(diagnosticsRoot, workpackId);
  mkdirSync(outputDir, { recursive: false });
  const workpackPath = join(outputDir, "workpack.json");
  const waves = buildWaves(agents, catalog);
  const waveByAgent = new Map(waves.flatMap((wave) => wave.agents.map((agentId) => [agentId, wave.index])));
  const runnerCommand = (agent) => [
    process.execPath,
    "AIDEBUG/run.mjs",
    ...(options.profile
      ? ["--profile", options.profile, "--agent", agent.id]
      : agent.tasks.flatMap((taskId) => ["--task", taskId])),
    "--jobs",
    "1",
    ...(options.failFast ? ["--fail-fast"] : []),
    ...(options.allowNetwork ? ["--allow-network"] : [])
  ];
  const draft = {
    version: 2,
    protocolVersion: 1,
    workpackId,
    workpackPath,
    repoRoot,
    createdAt: new Date().toISOString(),
    profile: options.profile || null,
    note: "Immutable AIDEBUG multi-Agent assignment. Execute only through AIDEBUG/workpack.mjs so claims, waves, locks, checkpoints, results, and closure evidence stay linked.",
    policy: {
      explicitSelectionOnly: true,
      waveBarrier: "all-prior-agents-passed",
      inputDrift: "fail-closed",
      heartbeatMs: 5000,
      staleAfterMs: 120000,
      allowNetwork: options.allowNetwork === true,
      failFast: options.failFast === true
    },
    superGoal: readSuperGoal(catalog),
    goals: goalSnapshots(catalog),
    controlPlane: controlPlaneSnapshots(),
    waves,
    agents: agents.map((agent) => ({
      id: agent.id,
      wave: waveByAgent.get(agent.id),
      scope: agent.scope,
      taskIds: agent.tasks,
      tasks: agent.tasks.map((taskId) => ({
        id: taskId,
        label: catalog.tasks[taskId].label,
        kind: catalog.tasks[taskId].kind,
        timeoutMs: catalog.tasks[taskId].timeoutMs,
        resources: [...(catalog.tasks[taskId].resources || [])],
        requiresNetwork: catalog.tasks[taskId].requiresNetwork === true
      })),
      exclusiveResources: taskResources(agent, catalog),
      reviewRequired: agent.tasks.some((taskId) => catalog.tasks[taskId].kind === "gui"),
      runnerCommand: runnerCommand(agent),
      command: [process.execPath, "AIDEBUG/workpack.mjs", "run-agent", "--workpack", workpackPath, "--agent", agent.id]
    })),
    collectCommand: [process.execPath, "AIDEBUG/workpack.mjs", "collect", "--workpack", workpackPath]
  };
  const written = writeWorkpackManifest(workpackPath, draft);
  return { workpackPath, workpack: written.manifest, integrityPath: written.integrityPath };
}

function printList(catalog) {
  console.log(JSON.stringify({
    explicitSelectionRequired: true,
    tasks: Object.entries(catalog.tasks).map(([id, task]) => ({ id, label: task.label, kind: task.kind, resources: task.resources })),
    profiles: Object.entries(catalog.profiles).map(([id, profile]) => ({
      id,
      description: profile.description,
      requireAgentSelection: profile.requireAgentSelection === true,
      agents: profile.agents.map((agent) => ({ id: agent.id, scope: agent.scope, tasks: agent.tasks }))
    }))
  }, null, 2));
}

function intervalsOverlap(left, right) {
  return left.startedAtMs < right.endedAtMs && right.startedAtMs < left.endedAtMs;
}

async function runSelfTest(catalogValidation) {
  const runDir = join(diagnosticsRoot, `selftest-${timestamp()}`);
  mkdirSync(runDir, { recursive: true });
  const makeTask = (label, delayMs, resources = [], exitCode = 0) => ({
    label,
    kind: "selftest",
    runner: "node-eval",
    code: `console.log(${JSON.stringify(label)}); setTimeout(() => process.exit(${exitCode}), ${delayMs});`,
    timeoutMs: 5000,
    resources,
    requiresNetwork: false
  });
  const selfCatalog = {
    tasks: {
      "exclusive-a": makeTask("exclusive-a", 180, ["shared-ui"]),
      "exclusive-b": makeTask("exclusive-b", 180, ["shared-ui"]),
      "parallel-free": makeTask("parallel-free", 180),
      "expected-failure": makeTask("expected-failure", 20, [], 7)
    }
  };
  const agents = [
    { id: "exclusive-agent-a", scope: "selftest", tasks: ["exclusive-a"], source: "selftest" },
    { id: "exclusive-agent-b", scope: "selftest", tasks: ["exclusive-b"], source: "selftest" },
    { id: "parallel-agent", scope: "selftest", tasks: ["parallel-free"], source: "selftest" },
    { id: "failure-agent", scope: "selftest", tasks: ["expected-failure"], source: "selftest" }
  ];
  const results = await runAgents({
    agents,
    catalog: selfCatalog,
    runDir,
    jobs: 4,
    options: { failFast: false, allowNetwork: false },
    internal: true
  });
  const byTask = new Map(results.flatMap((agent) => agent.tasks.map((task) => [task.taskId, task])));
  const exclusiveA = byTask.get("exclusive-a");
  const exclusiveB = byTask.get("exclusive-b");
  const parallelFree = byTask.get("parallel-free");
  const expectedFailure = byTask.get("expected-failure");
  const exclusiveSerialized = !intervalsOverlap(exclusiveA, exclusiveB);
  const independentOverlap = intervalsOverlap(parallelFree, exclusiveA) || intervalsOverlap(parallelFree, exclusiveB);
  const expectedFailureObserved = expectedFailure.exitCode === 7 && expectedFailure.ok === false;
  const workerEvidenceComplete = results.every((agent) => existsSync(agent.workerLogPath));
  const ok = exclusiveA.ok && exclusiveB.ok && parallelFree.ok && exclusiveSerialized && independentOverlap && expectedFailureObserved && workerEvidenceComplete;
  const report = {
    ok,
    createdAt: new Date().toISOString(),
    catalogValidation,
    exclusiveSerialized,
    independentOverlap,
    expectedFailureObserved,
    workerEvidenceComplete,
    results
  };
  const reportPath = join(runDir, "selftest-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!ok) throw new Error(`AIDEBUG runner self-test failed. See ${reportPath}`);
  console.log(JSON.stringify({ ok, reportPath, exclusiveSerialized, independentOverlap, expectedFailureObserved }, null, 2));
}

async function cancelActiveChildren(signal) {
  if (cancelled) return;
  cancelled = true;
  await Promise.all([...activeChildren].map((child) => stopOwnedChild(child)));
  process.exitCode = signal === "SIGINT" ? 130 : 143;
}

function installSignalHandlers() {
  process.once("SIGINT", () => void cancelActiveChildren("SIGINT"));
  process.once("SIGTERM", () => void cancelActiveChildren("SIGTERM"));
}

function printHelp() {
  console.log(`Usage:
  node AIDEBUG/run.mjs --list
  node AIDEBUG/run.mjs --check
  node AIDEBUG/run.mjs --profile <id> [--agent <id> ...] [--jobs <1..8>]
  node AIDEBUG/run.mjs --task <id> [--task <id> ...] [--jobs <1..8>]

No suite runs without an explicit --profile or --task.

Options:
  --agent <id>          Select an affected specialist lane; repeat to select several.
  --dry-run             Print the exact plan without starting tests.
  --emit-workpack       Write a machine-readable assignment manifest; without --agent, include the whole profile.
  --result-file <path>  Internal deterministic result sink used by the workpack executor.
  --fail-fast           Stop scheduling later tasks after the first failure.
  --allow-network       Authorize catalog tasks explicitly marked as requiring network.
  --self-test           Verify scheduling, resource exclusion, logs, and failure propagation.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const catalog = readJson(catalogPath);
  const validation = validateCatalog(catalog);
  if (options.resultFile && (options.check || options.list || options.selfTest || options.dryRun || options.emitWorkpack)) {
    throw new Error("--result-file is only valid for an actual selected test run.");
  }
  if (options.check) {
    console.log(JSON.stringify({ ok: true, catalogPath, ...validation, superGoal: readSuperGoal(catalog), goals: goalSnapshots(catalog) }, null, 2));
    return;
  }
  if (options.list) {
    printList(catalog);
    return;
  }
  if (options.selfTest) {
    await runSelfTest(validation);
    return;
  }
  if (!options.profile && !options.tasks.length) {
    throw new Error("No tests selected. Use an explicit --profile or --task; AIDEBUG never defaults to a full suite.");
  }
  const agents = selectAgents(catalog, options, { forWorkpack: options.emitWorkpack });
  if (!agents.length) throw new Error("The explicit selection resolved to no Agent lanes.");
  const plan = planSummary(agents, catalog, options);
  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
    return;
  }
  if (options.emitWorkpack) {
    const emitted = emitWorkpack(agents, catalog, options);
    console.log(JSON.stringify({
      ok: true,
      workpackPath: emitted.workpackPath,
      integrityPath: emitted.integrityPath,
      waves: emitted.workpack.waves,
      commands: emitted.workpack.agents.map((agent) => ({ id: agent.id, wave: agent.wave, command: agent.command })),
      collectCommand: emitted.workpack.collectCommand
    }, null, 2));
    return;
  }
  const networkTasks = agents.flatMap((agent) => agent.tasks).filter((taskId) => catalog.tasks[taskId].requiresNetwork);
  if (networkTasks.length && !options.allowNetwork) {
    throw new Error(`Selected tasks require network authorization: ${[...new Set(networkTasks)].join(", ")}. Re-run with --allow-network only if intended.`);
  }
  const runDir = join(diagnosticsRoot, `run-${timestamp()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(runDir, { recursive: false });
  const planPath = join(runDir, "run-plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  installSignalHandlers();
  const jobs = Math.max(1, Math.min(options.jobs || catalog.defaultJobs || 1, agents.length));
  const startedAtMs = Date.now();
  const results = await runAgents({ agents, catalog, runDir, jobs, options });
  const endedAtMs = Date.now();
  const report = {
    ok: !cancelled && results.every((agent) => agent.ok),
    cancelled,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    runDir,
    planPath,
    jobs,
    workpack: process.env.NAIMAGE_AIDEBUG_WORKPACK_ID
      ? {
          workpackId: process.env.NAIMAGE_AIDEBUG_WORKPACK_ID,
          agentId: process.env.NAIMAGE_AIDEBUG_WORKPACK_AGENT_ID || "",
          claimToken: process.env.NAIMAGE_AIDEBUG_WORKPACK_CLAIM || ""
        }
      : null,
    goals: plan.goals,
    superGoal: plan.superGoal,
    counts: {
      agents: results.length,
      agentsPassed: results.filter((agent) => agent.ok).length,
      tasks: results.reduce((total, agent) => total + agent.tasks.length, 0),
      tasksPassed: results.reduce((total, agent) => total + agent.tasks.filter((task) => task.ok).length, 0)
    },
    agents: results
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (options.resultFile) {
    const resultFile = resolve(process.cwd(), options.resultFile);
    assertInsideDiagnosticsResult(resultFile);
    mkdirSync(dirname(resultFile), { recursive: true });
    writeFileSync(resultFile, `${JSON.stringify({
      schemaVersion: 1,
      ok: report.ok,
      workpack: report.workpack,
      reportPath,
      runDir,
      counts: report.counts,
      goals: report.goals,
      agentIds: report.agents.map((agent) => agent.id),
      taskIds: report.agents.flatMap((agent) => agent.tasks.map((task) => task.taskId)),
      completedAt: report.endedAt
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  console.log(JSON.stringify({ ok: report.ok, reportPath, runDir, counts: report.counts }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
