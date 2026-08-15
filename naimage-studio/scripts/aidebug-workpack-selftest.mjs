import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWorkpack,
  loadWorkpack,
  reclaimWorkpackAgent,
  recordWorkpackReview,
  runWorkpackAgent,
  snapshotWorkpackFile,
  workpackStatus,
  writeWorkpackManifest
} from "../AIDEBUG/workpack.mjs";
import { validateSuperGoalProfile } from "../AIDEBUG/super-goal-contract.mjs";
import { createVisualReview } from "../AIDEBUG/visual-review.mjs";
import sharp from "sharp";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "..");
const diagnosticsRoot = join(repoRoot, ".diagnostics", "aidebug-agents");
const electronDiagnosticsRoot = join(repoRoot, ".diagnostics", "electron");
const catalogPath = join(repoRoot, "AIDEBUG", "catalog.json");
const packageJsonPath = join(repoRoot, "package.json");
const runnerPath = join(repoRoot, "AIDEBUG", "run.mjs");
const workpackRunnerPath = join(repoRoot, "AIDEBUG", "workpack.mjs");
const superGoalContractPath = join(repoRoot, "AIDEBUG", "super-goal-contract.mjs");
const superGoalPath = join(repoRoot, "AIDEBUG", "SUPER_GOAL.json");
const goalPaths = [
  join(repoRoot, "GOAL.md"),
  join(repoRoot, "AIDEBUG", "SUPER_GOAL.md"),
  superGoalPath
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const taskDefinitions = {
  "aidebug-options": {
    label: "AIDebug option contract",
    kind: "logic",
    timeoutMs: 120_000
  },
  "aidebug-reporting": {
    label: "AIDebug report contract",
    kind: "logic",
    timeoutMs: 120_000
  }
};

function createPack(label, agentSpecs, waveSpecs, { extraControlPlane = [] } = {}) {
  mkdirSync(diagnosticsRoot, { recursive: true });
  const workpackId = `workpack-selftest-${label}-${timestamp()}-${Math.random().toString(36).slice(2, 10)}`;
  const outputDir = join(diagnosticsRoot, workpackId);
  mkdirSync(outputDir, { recursive: false });
  const workpackPath = join(outputDir, "workpack.json");
  const agents = agentSpecs.map((spec) => {
    const definition = taskDefinitions[spec.taskId];
    if (!definition) throw new Error(`Unknown self-test task: ${spec.taskId}`);
    return {
      id: spec.id,
      wave: spec.wave,
      scope: `workpack self-test ${spec.id}`,
      taskIds: [spec.taskId],
      tasks: [{
        id: spec.taskId,
        label: definition.label,
        kind: spec.reviewRequired ? "gui" : definition.kind,
        timeoutMs: definition.timeoutMs,
        resources: [...(spec.resources || [])],
        requiresNetwork: false
      }],
      exclusiveResources: [...(spec.resources || [])],
      reviewRequired: spec.reviewRequired === true,
      runnerCommand: spec.runnerCommand
        ? [...spec.runnerCommand]
        : [process.execPath, "AIDEBUG/run.mjs", "--task", spec.taskId, "--jobs", "1"],
      command: [process.execPath, "AIDEBUG/workpack.mjs", "run-agent", "--workpack", workpackPath, "--agent", spec.id]
    };
  });
  const draft = {
    version: 2,
    protocolVersion: 1,
    workpackId,
    workpackPath,
    repoRoot,
    createdAt: new Date().toISOString(),
    profile: null,
    note: "AIDEBUG workpack closure protocol self-test.",
    policy: {
      explicitSelectionOnly: true,
      waveBarrier: "all-prior-agents-passed",
      inputDrift: "fail-closed",
      heartbeatMs: 5000,
      staleAfterMs: 120000,
      allowNetwork: false,
      failFast: false
    },
    superGoal: JSON.parse(readFileSync(superGoalPath, "utf8")),
    goals: goalPaths.map(snapshotWorkpackFile),
    controlPlane: [catalogPath, packageJsonPath, runnerPath, workpackRunnerPath, ...extraControlPlane].map(snapshotWorkpackFile),
    waves: waveSpecs.map((wave, index) => ({
      index: index + 1,
      agents: [...wave],
      exclusiveResources: [...new Set(wave.flatMap((agentId) => agents.find((agent) => agent.id === agentId)?.exclusiveResources || []))].sort()
    })),
    agents,
    collectCommand: [process.execPath, "AIDEBUG/workpack.mjs", "collect", "--workpack", workpackPath]
  };
  writeWorkpackManifest(workpackPath, draft);
  return { workpackId, workpackPath, outputDir };
}

function resultWindow(run) {
  return {
    start: Date.parse(run.result.startedAt),
    end: Date.parse(run.result.endedAt)
  };
}

function runWorkpackCli(workpackPath, agentId) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [
      workpackRunnerPath,
      "run-agent",
      "--workpack",
      workpackPath,
      "--agent",
      agentId
    ], {
      cwd: repoRoot,
      env: { ...process.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => resolveRun({ pid: child.pid, code, signal, stdout, stderr }));
  });
}

function runNodeCli(args, cwd = repoRoot) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => resolveRun({ pid: child.pid, code, signal, stdout, stderr }));
  });
}

function superGoalProfileFixtureCatalog() {
  const task = (label, script) => ({
    label,
    kind: "logic",
    runner: "pnpm",
    script,
    timeoutMs: 5_000,
    resources: [],
    requiresNetwork: false
  });
  return {
    version: 1,
    defaultJobs: 1,
    superGoalStateFile: "AIDEBUG/SUPER_GOAL.json",
    goalFiles: [],
    tasks: {
      "verify-owner-a": task("Verify owner A", "test:verify-owner-a"),
      "verify-owner-b": task("Verify owner B", "test:verify-owner-b"),
      "unrelated-owner-a": task("Unrelated owner A task", "test:unrelated-owner-a")
    },
    profiles: {
      "super-goal-specialists": {
        description: "Fixture SUPER GOAL owner lanes.",
        requireAgentSelection: true,
        agents: [
          { id: "owner-a", scope: "Own workstream A", tasks: ["verify-owner-a"] },
          { id: "owner-b", scope: "Own workstream B", tasks: ["verify-owner-b"] }
        ]
      },
      "other-profile": {
        description: "A same-id lane outside the closure profile must not satisfy it.",
        agents: [
          { id: "owner-b", scope: "Non-closure owner B", tasks: ["verify-owner-b"] }
        ]
      }
    }
  };
}

function superGoalProfileFixtureState() {
  return {
    schemaVersion: 1,
    goalId: "workpack-profile-selftest",
    status: "active",
    workstreams: [
      { id: "workstream-a", state: "active", ownerLane: "owner-a", verificationTasks: ["verify-owner-a"] },
      { id: "workstream-b", state: "active", ownerLane: "owner-b", verificationTasks: ["verify-owner-b"] }
    ]
  };
}

function createSuperGoalProfileRunnerFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "naimage-aidebug-profile-"));
  const fixtureAidebugRoot = join(fixtureRoot, "AIDEBUG");
  const fixtureHarnessRoot = join(fixtureRoot, "scripts", "aidebug", "harness");
  mkdirSync(fixtureAidebugRoot, { recursive: true });
  mkdirSync(fixtureHarnessRoot, { recursive: true });
  writeFileSync(join(fixtureAidebugRoot, "run.mjs"), readFileSync(runnerPath));
  writeFileSync(join(fixtureAidebugRoot, "workpack.mjs"), readFileSync(workpackRunnerPath));
  writeFileSync(join(fixtureAidebugRoot, "super-goal-contract.mjs"), readFileSync(superGoalContractPath));
  writeFileSync(
    join(fixtureHarnessRoot, "process.mjs"),
    readFileSync(join(repoRoot, "scripts", "aidebug", "harness", "process.mjs"))
  );
  writeFileSync(join(fixtureAidebugRoot, "SUPER_GOAL.json"), `${JSON.stringify(superGoalProfileFixtureState(), null, 2)}\n`, "utf8");
  writeFileSync(join(fixtureAidebugRoot, "catalog.json"), `${JSON.stringify(superGoalProfileFixtureCatalog(), null, 2)}\n`, "utf8");
  writeFileSync(join(fixtureRoot, "package.json"), `${JSON.stringify({
    private: true,
    scripts: {
      "test:verify-owner-a": "node -e process.exit(0)",
      "test:verify-owner-b": "node -e process.exit(0)",
      "test:unrelated-owner-a": "node -e process.exit(0)"
    }
  }, null, 2)}\n`, "utf8");
  return {
    fixtureRoot,
    catalogPath: join(fixtureAidebugRoot, "catalog.json"),
    runnerPath: join(fixtureAidebugRoot, "run.mjs")
  };
}

async function assertSuperGoalProfileCliCheckContract() {
  const fixture = createSuperGoalProfileRunnerFixture();
  const writeCatalog = (catalog) => writeFileSync(fixture.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const check = () => runNodeCli([fixture.runnerPath, "--check"], fixture.fixtureRoot);
  const assertFailedWith = (result, tokens, label) => {
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.code, 0, `${label} must make AIDEBUG/run.mjs --check fail`);
    for (const token of tokens) assert.match(output, token, `${label} must identify the incomplete SUPER GOAL profile`);
  };
  try {
    const missingOwner = superGoalProfileFixtureCatalog();
    missingOwner.profiles["super-goal-specialists"].agents = missingOwner.profiles["super-goal-specialists"].agents
      .filter((agent) => agent.id !== "owner-b");
    writeCatalog(missingOwner);
    assertFailedWith(
      await check(),
      [/super-goal-specialists/i, /owner-b/i],
      "A workstream owner lane present only in another profile"
    );

    const missingVerificationTask = superGoalProfileFixtureCatalog();
    missingVerificationTask.profiles["super-goal-specialists"].agents
      .find((agent) => agent.id === "owner-a").tasks = ["unrelated-owner-a"];
    writeCatalog(missingVerificationTask);
    assertFailedWith(
      await check(),
      [/owner-a/i, /verify-owner-a/i],
      "A SUPER GOAL owner lane missing its workstream verification task"
    );

    writeCatalog(superGoalProfileFixtureCatalog());
    const complete = await check();
    assert.equal(complete.code, 0, complete.stderr || complete.stdout);
    assert.equal(JSON.parse(complete.stdout).ok, true);
  } finally {
    rmSync(fixture.fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function committedResult(pack, agentId = "task-aidebug-options") {
  return JSON.parse(readFileSync(join(pack.outputDir, "state", "agents", agentId, "result.json"), "utf8"));
}

function checkpointRecords(outputDir, agentId) {
  const checkpointDir = join(outputDir, "state", "agents", agentId, "checkpoints");
  return readdirSync(checkpointDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => ({
      path: join(checkpointDir, entry),
      value: JSON.parse(readFileSync(join(checkpointDir, entry), "utf8"))
    }));
}

function assertCollectRefuses(workpackPath, expectedIssue, label) {
  const collected = collectWorkpack(workpackPath);
  const issues = collected.closure.agents.flatMap((agent) => [...agent.runnerIssues, ...agent.reviewIssues]);
  assert.equal(collected.closure.ok, false, `${label} must not produce a passed closure`);
  assert.match(issues.join("\n"), expectedIssue, `${label} must identify the damaged evidence`);
  return collected;
}

function seedClaimState(pack, {
  status = "runner-heartbeat",
  at,
  parentPid = 2_147_483_647,
  childPid = 2_147_483_646,
  host = hostname()
}) {
  const manifest = loadWorkpack(pack.workpackPath).manifest;
  const agent = manifest.agents[0];
  const statePath = join(pack.outputDir, "state", "agents", agent.id);
  const checkpointPath = join(statePath, "checkpoints", `000001-${status}.json`);
  const claimToken = `${status}-selftest-claim`;
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(join(statePath, "claim.json"), `${JSON.stringify({
    schemaVersion: 1,
    workpackId: manifest.workpackId,
    manifestHash: manifest.manifestHash,
    agentId: agent.id,
    wave: agent.wave,
    taskIds: [...agent.taskIds],
    claimToken,
    claimedAt: at,
    host,
    pid: parentPid
  }, null, 2)}\n`, "utf8");
  writeFileSync(checkpointPath, `${JSON.stringify({
    schemaVersion: 1,
    workpackId: manifest.workpackId,
    manifestHash: manifest.manifestHash,
    agentId: agent.id,
    claimToken,
    sequence: 1,
    status,
    at,
    pid: parentPid,
    previousCheckpointSha256: "",
    detail: Number.isInteger(childPid) ? { childPid } : {}
  }, null, 2)}\n`, "utf8");
  return { agent, checkpointPath, statePath };
}

function assertReclaimNotStale(pack, label, staleAfterMs = 100) {
  assert.throws(
    () => reclaimWorkpackAgent(pack.workpackPath, pack.agentId || "task-aidebug-options", { staleAfterMs }),
    (error) => error?.code === "AIDEBUG_WORKPACK_CLAIM_NOT_STALE",
    label
  );
}

async function main() {
  const evidence = {};
  mkdirSync(diagnosticsRoot, { recursive: true });
  mkdirSync(electronDiagnosticsRoot, { recursive: true });

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const superGoal = JSON.parse(readFileSync(superGoalPath, "utf8"));
  const taskIds = new Set(Object.keys(catalog.tasks));
  const superGoalContract = validateSuperGoalProfile(catalog, superGoal, taskIds);
  assert.equal(superGoalContract.superGoalProfile, "super-goal-specialists");
  assert.equal(superGoalContract.ownerLaneCount, new Set(superGoal.workstreams.map((workstream) => workstream.ownerLane)).size);

  const missingLaneCatalog = structuredClone(catalog);
  missingLaneCatalog.profiles[missingLaneCatalog.superGoalProfile].agents = missingLaneCatalog.profiles[missingLaneCatalog.superGoalProfile].agents
    .filter((agent) => agent.id !== "gui-smoke-agent");
  assert.throws(
    () => validateSuperGoalProfile(missingLaneCatalog, superGoal, taskIds),
    /missing ownerLane gui-smoke-agent.*ui-runtime-observation/,
    "The final SUPER GOAL profile must fail closed when an owner lane is omitted"
  );

  const missingTaskCatalog = structuredClone(catalog);
  const interactionLane = missingTaskCatalog.profiles[missingTaskCatalog.superGoalProfile].agents
    .find((agent) => agent.id === "node-interaction-agent");
  interactionLane.tasks = interactionLane.tasks.filter((taskId) => taskId !== "requirement-graph");
  assert.throws(
    () => validateSuperGoalProfile(missingTaskCatalog, superGoal, taskIds),
    /node-interaction-agent.*interaction-speed.*requirement-graph/,
    "Each owner lane must cover every verification task declared by its workstream"
  );
  evidence.superGoalProfileContract = superGoalContract;
  await assertSuperGoalProfileCliCheckContract();
  evidence.superGoalProfileCliCheck = true;

  const concurrentRunnerRoot = join(diagnosticsRoot, `run-directory-selftest-${timestamp()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(concurrentRunnerRoot, { recursive: false });
  const concurrentRunnerSinks = Array.from({ length: 4 }, (_, index) => join(concurrentRunnerRoot, `runner-${index + 1}.json`));
  const concurrentRunnerResults = await Promise.all(concurrentRunnerSinks.map((resultFile) => runNodeCli([
    runnerPath,
    "--task",
    "aidebug-options",
    "--result-file",
    resultFile
  ])));
  concurrentRunnerResults.forEach((result, index) => assert.equal(result.code, 0, result.stderr || result.stdout || `concurrent runner ${index + 1}`));
  const concurrentRunnerPayloads = concurrentRunnerSinks.map((resultFile) => JSON.parse(readFileSync(resultFile, "utf8")));
  const concurrentRunDirs = concurrentRunnerPayloads.map((payload) => payload.runDir);
  assert.equal(new Set(concurrentRunDirs.map((runDir) => resolve(runDir))).size, concurrentRunDirs.length, "Concurrent runner processes must never share a run directory");
  for (const runDir of concurrentRunDirs) {
    assert.match(
      basename(runDir),
      /^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/,
      "Runner directories must include a collision-resistant UUID suffix"
    );
  }
  evidence.concurrentRunnerDirectories = concurrentRunDirs;

  const emitted = await runNodeCli([runnerPath, "--task", "aidebug-options", "--emit-workpack"]);
  assert.equal(emitted.code, 0, emitted.stderr || emitted.stdout);
  const emittedPayload = JSON.parse(emitted.stdout);
  const emittedManifest = loadWorkpack(emittedPayload.workpackPath).manifest;
  assert.deepEqual(emittedManifest.agents[0].command, [
    process.execPath,
    "AIDEBUG/workpack.mjs",
    "run-agent",
    "--workpack",
    emittedPayload.workpackPath,
    "--agent",
    emittedManifest.agents[0].id
  ]);
  const emittedRun = await runWorkpackCli(emittedPayload.workpackPath, emittedManifest.agents[0].id);
  assert.equal(emittedRun.code, 0, emittedRun.stderr || emittedRun.stdout);
  assert.equal(collectWorkpack(emittedPayload.workpackPath).closure.ok, true);
  evidence.realEmitterWrapperClosure = dirname(emittedPayload.workpackPath);

  const waves = createPack("waves", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 },
    { id: "task-aidebug-reporting", taskId: "aidebug-reporting", wave: 2 }
  ], [["task-aidebug-options"], ["task-aidebug-reporting"]]);
  await assert.rejects(
    runWorkpackAgent(waves.workpackPath, "task-aidebug-reporting", { waitMs: 50, heartbeatMs: 250 }),
    (error) => error?.code === "AIDEBUG_WORKPACK_WAVE_TIMEOUT"
  );
  const waveOne = await runWorkpackAgent(waves.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(waveOne.result.ok, true);
  const idempotent = await runWorkpackAgent(waves.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(idempotent.idempotent, true);
  assert.equal(idempotent.result.claimToken, waveOne.result.claimToken);
  const waveTwo = await runWorkpackAgent(waves.workpackPath, "task-aidebug-reporting", { heartbeatMs: 250 });
  assert.equal(waveTwo.result.ok, true);
  assert.ok(Date.parse(waveTwo.result.startedAt) >= Date.parse(waveOne.result.endedAt), "Wave 2 must start after wave 1 ends");
  const firstClosure = collectWorkpack(waves.workpackPath);
  const secondClosure = collectWorkpack(waves.workpackPath);
  assert.equal(firstClosure.closure.ok, true);
  assert.equal(secondClosure.closure.ok, true);
  assert.notEqual(firstClosure.immutableClosurePath, secondClosure.immutableClosurePath);
  assert.equal(readdirSync(join(waves.outputDir, "state", "closures")).length >= 2, true);
  evidence.waveClosure = secondClosure.immutableClosurePath;

  const claimRace = createPack("claim-race", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const race = await Promise.all(Array.from({ length: 16 }, () =>
    runWorkpackCli(claimRace.workpackPath, "task-aidebug-options")
  ));
  const launched = race.filter((item) => item.code === 0 && /"idempotent"\s*:\s*false/.test(item.stdout));
  const idempotentContenders = race.filter((item) => item.code === 0 && /"idempotent"\s*:\s*true/.test(item.stdout));
  const rejected = race.filter((item) => item.code !== 0);
  assert.equal(launched.length, 1, "Exactly one contender must launch the runner");
  assert.equal(launched.length + idempotentContenders.length + rejected.length, 16, "Every independent CLI contender must have an explicit outcome");
  assert.ok(rejected.length >= 1, "At least one overlapping contender must observe the active atomic claim");
  assert.equal(collectWorkpack(claimRace.workpackPath).closure.ok, true);
  evidence.claimRace = claimRace.outputDir;

  const lockA = createPack("lock-a", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1, resources: ["Electron-UI"] }
  ], [["task-aidebug-options"]]);
  const lockB = createPack("lock-b", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1, resources: ["electron-ui"] }
  ], [["task-aidebug-options"]]);
  const [lockedA, lockedB] = await Promise.all([
    runWorkpackCli(lockA.workpackPath, "task-aidebug-options"),
    runWorkpackCli(lockB.workpackPath, "task-aidebug-options")
  ]);
  assert.equal(lockedA.code, 0, lockedA.stderr || lockedA.stdout);
  assert.equal(lockedB.code, 0, lockedB.stderr || lockedB.stdout);
  const windowA = resultWindow({ result: committedResult(lockA) });
  const windowB = resultWindow({ result: committedResult(lockB) });
  assert.equal(windowA.end <= windowB.start || windowB.end <= windowA.start, true, "Case-normalized cross-workpack resource locks must serialize runners");
  assert.equal(collectWorkpack(lockA.workpackPath).closure.ok, true);
  assert.equal(collectWorkpack(lockB.workpackPath).closure.ok, true);
  evidence.crossWorkpackLocks = [lockA.outputDir, lockB.outputDir];

  const stale = createPack("stale", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const staleManifest = loadWorkpack(stale.workpackPath).manifest;
  const staleStatePath = join(stale.outputDir, "state", "agents", "task-aidebug-options");
  const staleCheckpointPath = join(staleStatePath, "checkpoints", "000001-runner-heartbeat.json");
  mkdirSync(dirname(staleCheckpointPath), { recursive: true });
  const oldAt = new Date(Date.now() - 600_000).toISOString();
  const staleClaim = {
    schemaVersion: 1,
    workpackId: staleManifest.workpackId,
    manifestHash: staleManifest.manifestHash,
    agentId: "task-aidebug-options",
    wave: 1,
    taskIds: ["aidebug-options"],
    claimToken: "stale-selftest-claim",
    claimedAt: oldAt,
    host: hostname(),
    pid: 2_147_483_647
  };
  writeFileSync(join(staleStatePath, "claim.json"), `${JSON.stringify(staleClaim, null, 2)}\n`, "utf8");
  writeFileSync(staleCheckpointPath, `${JSON.stringify({
    schemaVersion: 1,
    workpackId: staleManifest.workpackId,
    manifestHash: staleManifest.manifestHash,
    agentId: "task-aidebug-options",
    claimToken: staleClaim.claimToken,
    sequence: 1,
    status: "runner-heartbeat",
    at: oldAt,
    pid: staleClaim.pid,
    previousCheckpointSha256: "",
    detail: { childPid: 2_147_483_646 }
  }, null, 2)}\n`, "utf8");
  const reclaimed = reclaimWorkpackAgent(stale.workpackPath, "task-aidebug-options", { staleAfterMs: 100 });
  assert.equal(reclaimed.ok, true);
  assert.equal(existsSync(reclaimed.archivePath), true);
  const afterReclaim = await runWorkpackAgent(stale.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(afterReclaim.result.ok, true);
  assert.equal(collectWorkpack(stale.workpackPath).closure.ok, true);
  evidence.staleReclaim = reclaimed.archivePath;

  const freshClaim = createPack("fresh-claim", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  seedClaimState(freshClaim, { at: new Date().toISOString() });
  assertReclaimNotStale(freshClaim, "A fresh heartbeat must never be reclaimed");

  const liveParent = createPack("live-parent", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  seedClaimState(liveParent, { at: oldAt, parentPid: process.pid, childPid: 2_147_483_646 });
  assertReclaimNotStale(liveParent, "A live wrapper PID must fence reclaim");

  const liveChild = createPack("live-child", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  seedClaimState(liveChild, { at: oldAt, parentPid: 2_147_483_647, childPid: process.pid });
  assertReclaimNotStale(liveChild, "A live child PID must fence reclaim");

  const remoteClaim = createPack("remote-claim", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  seedClaimState(remoteClaim, { at: oldAt, host: "aidebug-remote-host" });
  assert.throws(
    () => reclaimWorkpackAgent(remoteClaim.workpackPath, "task-aidebug-options", { staleAfterMs: 100 }),
    (error) => error?.code === "AIDEBUG_WORKPACK_REMOTE_RECLAIM_UNSUPPORTED"
  );

  const terminalClaim = createPack("terminal-claim", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  seedClaimState(terminalClaim, { status: "passed", at: oldAt });
  assert.throws(
    () => reclaimWorkpackAgent(terminalClaim.workpackPath, "task-aidebug-options", { staleAfterMs: 100 }),
    /terminal checkpoint/i
  );

  const orphanClaim = createPack("orphan-claim", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const orphanStatePath = join(orphanClaim.outputDir, "state", "agents", "task-aidebug-options");
  mkdirSync(orphanStatePath, { recursive: true });
  const oldDate = new Date(Date.now() - 600_000);
  utimesSync(orphanStatePath, oldDate, oldDate);
  const orphanReclaim = reclaimWorkpackAgent(orphanClaim.workpackPath, "task-aidebug-options", { staleAfterMs: 100 });
  assert.equal(orphanReclaim.orphanedState, true);

  const lockedResource = `Reclaim-Lock-${timestamp()}`;
  const lockedStale = createPack("locked-stale", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1, resources: [lockedResource] }
  ], [["task-aidebug-options"]]);
  const lockedSeed = seedClaimState(lockedStale, { at: oldAt });
  const lockHash = createHash("sha256").update(lockedResource.toLowerCase()).digest("hex").slice(0, 40);
  const staleLockPath = join(diagnosticsRoot, "resource-locks", `${lockHash}.lock`);
  mkdirSync(staleLockPath, { recursive: true });
  writeFileSync(join(staleLockPath, "owner.json"), `${JSON.stringify({
    schemaVersion: 1,
    resource: lockedResource,
    workpackId: lockedStale.workpackId,
    workpackPath: lockedStale.workpackPath,
    manifestHash: loadWorkpack(lockedStale.workpackPath).manifest.manifestHash,
    agentId: lockedSeed.agent.id,
    agentStatePath: lockedSeed.statePath,
    claimToken: "runner-heartbeat-selftest-claim",
    host: hostname(),
    pid: 2_147_483_647,
    acquiredAt: oldAt
  }, null, 2)}\n`, "utf8");
  const lockedReclaim = reclaimWorkpackAgent(lockedStale.workpackPath, "task-aidebug-options", { staleAfterMs: 100 });
  assert.equal(lockedReclaim.reclaimedLocks.length, 1);
  assert.equal(existsSync(staleLockPath), false);
  evidence.reclaimMatrix = [freshClaim.outputDir, liveParent.outputDir, liveChild.outputDir, remoteClaim.outputDir, terminalClaim.outputDir, orphanReclaim.archivePath, lockedReclaim.archivePath];

  const reviewPack = createPack("visual-binding", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1, reviewRequired: true }
  ], [["task-aidebug-options"]]);
  const reviewedAgent = await runWorkpackAgent(reviewPack.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(reviewedAgent.result.ok, true);
  const guiRunDir = join(electronDiagnosticsRoot, `aidebug-workpack-protocol-${timestamp()}`);
  const guiReportPath = join(guiRunDir, "report.json");
  const screenshotPath = join(guiRunDir, "protocol-frame.png");
  mkdirSync(guiRunDir, { recursive: false });
  await sharp({ create: { width: 640, height: 360, channels: 4, background: { r: 30, g: 60, b: 95, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="640" height="360"><rect x="80" y="70" width="480" height="220" rx="24" fill="#58b4ae"/><text x="155" y="190" font-size="34" fill="#0b1720">WORKPACK UI EVIDENCE</text></svg>') }])
    .png()
    .toFile(screenshotPath);
  const screenshotStat = statSync(screenshotPath);
  const observedAt = new Date(Date.parse(reviewedAgent.result.startedAt) + 10).toISOString();
  writeFileSync(guiReportPath, `${JSON.stringify({
    ok: true,
    mode: "workpack-protocol",
    workpack: {
      workpackId: reviewPack.workpackId,
      agentId: "task-aidebug-options",
      claimToken: reviewedAgent.result.claimToken,
      taskId: "aidebug-options"
    },
    runDir: guiRunDir,
    reportPath: guiReportPath,
    observations: [{ at: observedAt, label: "suite-checkpoint", detail: { label: "bootstrap:prepare-run" } }],
    results: [{
      label: "workpack-protocol-frame",
      screenshotPath,
      screenshotSource: "cdp-dual-frame",
      screenshotEvidence: {
        source: "cdp-dual-frame",
        path: screenshotPath,
        byteLength: screenshotStat.size,
        width: 640,
        height: 360,
        sha256: sha256(screenshotPath)
      },
      dualFrameReport: { ok: true, stable: true },
      stateStabilityReport: { ok: true, stable: true },
      visualReliability: { ok: true, status: "verified" },
      stateIssues: [],
      captureIssues: [],
      overflow: { documentOverflowX: false, bodyOverflowX: false, elementOverflowX: [] }
    }],
    failures: []
  }, null, 2)}\n`, "utf8");
  const visualOutputDir = join(repoRoot, ".diagnostics", "aidebug-review", `workpack-protocol-selftest-${timestamp()}`);
  const visual = await createVisualReview({ sources: [screenshotPath], outputDir: visualOutputDir, columns: 1, tileWidth: 320 });
  assert.throws(
    () => recordWorkpackReview(reviewPack.workpackPath, "task-aidebug-options", {
      guiReport: guiReportPath,
      visualReview: visual.reportPath,
      verdict: "approved",
      reviewer: "AIDEBUG protocol selftest"
    }),
    /valid passing result|gui-artifact/i,
    "Production review binding must reject an untracked GUI report even when its self-declared fields look valid"
  );
  const forgedGuiClosure = assertCollectRefuses(reviewPack.workpackPath, /gui-artifact/i, "untracked GUI provenance");
  assert.equal(forgedGuiClosure.closure.status, "failed");
  evidence.untrackedGuiRejected = forgedGuiClosure.immutableClosurePath;

  const tamper = createPack("evidence-tamper", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const tamperRun = await runWorkpackAgent(tamper.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(tamperRun.result.ok, true);
  const tamperCheckpoints = checkpointRecords(tamper.outputDir, "task-aidebug-options");
  const terminalCheckpoint = tamperCheckpoints.at(-1);
  assert.equal(terminalCheckpoint.value.status, "passed");
  assert.equal(tamperRun.result.checkpointHead.sequence, tamperCheckpoints.length);
  assert.equal(resolve(tamperRun.result.checkpointHead.path), resolve(terminalCheckpoint.path));
  assert.equal(tamperRun.result.checkpointHead.sha256, sha256(terminalCheckpoint.path));

  appendFileSync(terminalCheckpoint.path, "\n", "utf8");
  assertCollectRefuses(tamper.workpackPath, /checkpoint/i, "terminal checkpoint tamper");
  appendFileSync(tamperRun.result.runner.stdout.path, "tampered stdout\n", "utf8");
  assertCollectRefuses(tamper.workpackPath, /stdout-changed/i, "launcher stdout tamper");
  appendFileSync(tamperRun.result.runner.result.path, "\n", "utf8");
  assertCollectRefuses(tamper.workpackPath, /runnerResult-changed/i, "runner result tamper");
  appendFileSync(tamperRun.result.runner.report.path, "\n", "utf8");
  assertCollectRefuses(tamper.workpackPath, /report-changed/i, "runner report tamper");
  appendFileSync(tamperRun.resultPath, "\n", "utf8");
  const resultTamperClosure = assertCollectRefuses(tamper.workpackPath, /result-integrity-result-changed/i, "result bytes tamper");
  assert.equal(resultTamperClosure.closure.status, "failed");
  evidence.tamperMatrix = resultTamperClosure.immutableClosurePath;

  const invalidJson = createPack("invalid-json-evidence", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const invalidJsonRun = await runWorkpackAgent(invalidJson.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(invalidJsonRun.result.ok, true);
  writeFileSync(invalidJsonRun.resultPath, "{\"schemaVersion\":", "utf8");
  const invalidJsonStatus = workpackStatus(invalidJson.workpackPath);
  const invalidJsonStatusAgent = invalidJsonStatus.waves[0].agents[0];
  assert.equal(invalidJsonStatus.ok, false);
  assert.equal(invalidJsonStatusAgent.status, "failed");
  assert.match(invalidJsonStatusAgent.runnerIssues.join("\n"), /evidence-json-invalid:.*result\.json/);
  const invalidJsonClosure = collectWorkpack(invalidJson.workpackPath);
  const invalidJsonIssues = invalidJsonClosure.closure.agents.flatMap((agent) => [...agent.runnerIssues, ...agent.reviewIssues]);
  assert.equal(invalidJsonClosure.closure.status, "failed");
  assert.equal(invalidJsonClosure.closure.ok, false);
  assert.match(invalidJsonIssues.join("\n"), /evidence-json-invalid:.*result\.json/);
  assert.equal(existsSync(invalidJsonClosure.immutableClosurePath), true);
  evidence.invalidJsonEvidenceClosure = invalidJsonClosure.immutableClosurePath;

  const invalidShape = createPack("invalid-json-shape", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  const invalidShapeRun = await runWorkpackAgent(invalidShape.workpackPath, "task-aidebug-options", { heartbeatMs: 250 });
  assert.equal(invalidShapeRun.result.ok, true);
  writeFileSync(invalidShapeRun.result.runner.result.path, "[]\n", "utf8");
  const invalidShapeClosure = collectWorkpack(invalidShape.workpackPath);
  const invalidShapeIssues = invalidShapeClosure.closure.agents.flatMap((agent) => [...agent.runnerIssues, ...agent.reviewIssues]);
  assert.equal(invalidShapeClosure.closure.status, "failed");
  assert.match(invalidShapeIssues.join("\n"), /evidence-json-invalid:.*runner-result\.json/);
  evidence.invalidJsonShapeClosure = invalidShapeClosure.immutableClosurePath;

  const driftSentinelRoot = join(diagnosticsRoot, `workpack-selftest-drift-input-${timestamp()}`);
  mkdirSync(driftSentinelRoot, { recursive: false });
  const driftSentinel = join(driftSentinelRoot, "input.txt");
  writeFileSync(driftSentinel, "before\n", "utf8");
  const drift = createPack("drift", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]], { extraControlPlane: [driftSentinel] });
  appendFileSync(driftSentinel, "after\n", "utf8");
  assert.throws(
    () => loadWorkpack(drift.workpackPath, { requireCurrentInputs: true }),
    (error) => error?.code === "AIDEBUG_WORKPACK_INPUT_DRIFT"
  );
  const driftClosure = collectWorkpack(drift.workpackPath);
  assert.equal(driftClosure.closure.status, "stale-inputs");
  assert.equal(driftClosure.closure.ok, false);
  evidence.inputDrift = driftClosure.immutableClosurePath;

  const integrity = createPack("integrity", [
    { id: "task-aidebug-options", taskId: "aidebug-options", wave: 1 }
  ], [["task-aidebug-options"]]);
  appendFileSync(integrity.workpackPath, "\n", "utf8");
  assert.throws(() => loadWorkpack(integrity.workpackPath), /integrity sidecar/i);
  evidence.manifestTamper = integrity.outputDir;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    realEmitterWrapperClosure: true,
    atomicClaimContenders: 16,
    atomicClaimLaunches: launched.length,
    independentCliClaimProcesses: true,
    atomicClaimRejectedWhileActive: rejected.length,
    atomicClaimIdempotentAfterPass: idempotentContenders.length,
    waveBarrier: true,
    passedIdempotency: true,
    crossWorkpackCaseNormalizedProcessLock: true,
    staleReclaimMatrix: true,
    untrackedGuiProvenanceRejected: true,
    terminalCheckpointAnchored: true,
    evidenceTamperMatrixRejected: true,
    invalidJsonEvidenceFailsClosed: true,
    immutableClosureHistory: true,
    inputDriftRejected: true,
    exactManifestBytesProtected: true,
    superGoalProfileContract: true,
    concurrentRunnerDirectories: true,
    evidence
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
