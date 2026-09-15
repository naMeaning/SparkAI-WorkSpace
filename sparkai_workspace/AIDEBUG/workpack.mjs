import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { forceKillProcessTree, waitForChildExit } from "../scripts/aidebug/harness/process.mjs";

const aidebugRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(aidebugRoot, "..");
const diagnosticsRoot = join(repoRoot, ".diagnostics", "aidebug-agents");
const electronEvidenceRoot = join(repoRoot, ".diagnostics", "electron");
const visualEvidenceRoot = join(repoRoot, ".diagnostics", "aidebug-review");
const resourceLockRoot = join(diagnosticsRoot, "resource-locks");
const resourceLockHistoryRoot = join(diagnosticsRoot, "resource-lock-history");
const defaultStaleAfterMs = 120_000;
const defaultHeartbeatMs = 5_000;
const defaultWaitMs = 14_400_000;
const syncWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return hashBuffer(readFileSync(filePath));
}

function readJson(filePath) {
  const resolvedPath = resolve(filePath);
  const source = readFileSync(resolvedPath, "utf8");
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("the JSON root must be an object");
    }
    return value;
  } catch (error) {
    const wrapped = new Error(`Invalid JSON in ${resolvedPath}: ${error?.message || error}`);
    wrapped.code = "AIDEBUG_JSON_INVALID";
    wrapped.jsonPath = resolvedPath;
    wrapped.cause = error;
    throw wrapped;
  }
}

function safeName(value) {
  return String(value || "item")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function canonicalPath(filePath) {
  let cursor = resolve(filePath);
  const missing = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  const canonicalParent = existsSync(cursor) ? realpathSync.native(cursor) : resolve(cursor);
  return resolve(canonicalParent, ...missing);
}

function isInside(root, filePath) {
  const rel = relative(canonicalPath(root), canonicalPath(filePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertInside(root, filePath, label) {
  if (!isInside(root, filePath)) throw new Error(`${label} is outside the allowed directory: ${filePath}`);
}

function writeJsonExclusive(filePath, value) {
  const outputDir = dirname(filePath);
  mkdirSync(outputDir, { recursive: true });
  const temporaryPath = join(outputDir, `.${basename(filePath)}.publish-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    linkSync(temporaryPath, filePath);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The canonical hard link is already complete; stale publish links never own protocol state.
    }
  }
}

export function writeWorkpackManifest(workpackPath, draft) {
  const manifest = finalizeWorkpackManifest(draft);
  writeJsonExclusive(workpackPath, manifest);
  const manifestEvidence = fileEvidence(workpackPath);
  const integrity = {
    schemaVersion: 1,
    workpackId: manifest.workpackId,
    manifestHash: manifest.manifestHash,
    manifestSha256: manifestEvidence.sha256,
    byteLength: manifestEvidence.byteLength,
    createdAt: new Date().toISOString()
  };
  const integrityPath = join(dirname(workpackPath), "workpack.integrity.json");
  writeJsonExclusive(integrityPath, integrity);
  return { manifest, integrity, integrityPath };
}

function replaceJsonWithHistory(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  if (existsSync(filePath)) {
    const historyPath = join(dirname(filePath), `${basename(filePath, ".json")}-${timestamp()}-${randomUUID().slice(0, 8)}.json`);
    renameWithRetry(filePath, historyPath);
  }
  renameWithRetry(temporaryPath, filePath);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function renameWithRetry(sourcePath, destinationPath, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      renameSync(sourcePath, destinationPath);
      return;
    } catch (error) {
      const transient = new Set(["EPERM", "EACCES", "EBUSY"]).has(error?.code);
      if (!transient || attempt === attempts - 1) throw error;
      Atomics.wait(syncWaitBuffer, 0, 0, Math.min(160, 10 * (2 ** attempt)));
    }
  }
}

function fileEvidence(filePath) {
  const resolvedPath = resolve(filePath);
  const stat = statSync(resolvedPath);
  if (!stat.isFile()) throw new Error(`Evidence path is not a file: ${resolvedPath}`);
  return {
    path: resolvedPath,
    byteLength: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: hashFile(resolvedPath)
  };
}

export function snapshotWorkpackFile(filePath) {
  return fileEvidence(filePath);
}

function manifestPayload(manifest) {
  const { manifestHash: _manifestHash, ...payload } = manifest;
  return payload;
}

export function finalizeWorkpackManifest(draft) {
  const payload = structuredClone(draft);
  return {
    ...payload,
    manifestHash: hashBuffer(JSON.stringify(payload))
  };
}

function validateId(value, label) {
  const id = String(value || "");
  const windowsStem = id.split(".")[0].toUpperCase();
  if (
    !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id) ||
    /[.]$/.test(id) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)
  ) {
    throw new Error(`${label} has an invalid id: ${value}`);
  }
}

function normalizedResources(resources = []) {
  return [...new Set(resources.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))].sort();
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedRunnerCommand(manifest, agent) {
  return [
    process.execPath,
    "AIDEBUG/run.mjs",
    ...(manifest.profile
      ? ["--profile", manifest.profile, "--agent", agent.id]
      : agent.taskIds.flatMap((taskId) => ["--task", taskId])),
    "--jobs",
    "1",
    ...(manifest.policy?.failFast === true ? ["--fail-fast"] : []),
    ...(manifest.policy?.allowNetwork === true ? ["--allow-network"] : [])
  ];
}

function workpackStateRoot(workpackPath) {
  return join(dirname(workpackPath), "state");
}

function agentStatePath(workpackPath, agentId) {
  return join(workpackStateRoot(workpackPath), "agents", safeName(agentId));
}

function reviewPath(workpackPath, agentId) {
  return join(workpackStateRoot(workpackPath), "reviews", `${safeName(agentId)}.json`);
}

function resolveWorkpack(value) {
  const candidates = isAbsolute(String(value || ""))
    ? [resolve(value)]
    : [resolve(process.cwd(), String(value || "")), resolve(repoRoot, String(value || ""))];
  const workpackPath = candidates.find((candidate) => existsSync(candidate));
  if (!workpackPath) throw new Error(`Workpack does not exist: ${value}`);
  assertInside(diagnosticsRoot, workpackPath, "Workpack");
  return workpackPath;
}

function validateManifestShape(manifest, workpackPath) {
  if (manifest?.version !== 2 || manifest?.protocolVersion !== 1) {
    throw new Error("AIDEBUG workpack must use manifest version 2 and protocol version 1.");
  }
  if (manifest.repoRoot !== repoRoot) throw new Error("Workpack belongs to a different repository root.");
  if (resolve(manifest.workpackPath || "") !== workpackPath) throw new Error("Workpack path does not match its manifest.");
  if (manifest.workpackId !== basename(dirname(workpackPath))) throw new Error("Workpack id does not match its directory.");
  if (!Array.isArray(manifest.agents) || !manifest.agents.length) throw new Error("Workpack has no agents.");
  if (!Array.isArray(manifest.waves) || !manifest.waves.length) throw new Error("Workpack has no waves.");
  const agentIds = new Set();
  const normalizedAgentIds = new Set();
  for (const agent of manifest.agents) {
    validateId(agent.id, "Workpack agent");
    const normalizedAgentId = agent.id.toLowerCase();
    if (normalizedAgentIds.has(normalizedAgentId)) throw new Error(`Workpack repeats or case-collides agent ${agent.id}.`);
    agentIds.add(agent.id);
    normalizedAgentIds.add(normalizedAgentId);
    if (!Number.isInteger(agent.wave) || agent.wave < 1) throw new Error(`Agent ${agent.id} has an invalid wave.`);
    if (!Array.isArray(agent.taskIds) || !agent.taskIds.length) throw new Error(`Agent ${agent.id} has no tasks.`);
    if (!Array.isArray(agent.tasks) || agent.tasks.length !== agent.taskIds.length) {
      throw new Error(`Agent ${agent.id} has incomplete task metadata.`);
    }
    if (!Array.isArray(agent.exclusiveResources)) throw new Error(`Agent ${agent.id} has invalid resources.`);
    if (!jsonEqual(agent.tasks.map((task) => task?.id), agent.taskIds)) throw new Error(`Agent ${agent.id} task metadata does not match taskIds.`);
    if (agent.tasks.some((task) => !task || typeof task.label !== "string" || !Number.isFinite(Number(task.timeoutMs)) || !Array.isArray(task.resources))) {
      throw new Error(`Agent ${agent.id} contains invalid task metadata.`);
    }
    const derivedResources = normalizedResources(agent.tasks.flatMap((task) => task.resources));
    if (!jsonEqual(normalizedResources(agent.exclusiveResources), derivedResources)) throw new Error(`Agent ${agent.id} resources do not match its tasks.`);
    const derivedReviewRequired = agent.tasks.some((task) => task.kind === "gui");
    if ((agent.reviewRequired === true) !== derivedReviewRequired) throw new Error(`Agent ${agent.id} review requirement does not match its GUI tasks.`);
    if (!jsonEqual(agent.runnerCommand, expectedRunnerCommand(manifest, agent))) {
      throw new Error(`Agent ${agent.id} runner command is not derived from its immutable selection.`);
    }
    const expectedWrapper = [process.execPath, "AIDEBUG/workpack.mjs", "run-agent", "--workpack", workpackPath, "--agent", agent.id];
    if (!jsonEqual(agent.command, expectedWrapper)) throw new Error(`Agent ${agent.id} wrapper command is invalid.`);
  }
  const waveIds = new Set();
  const assignedAgents = new Set();
  for (let waveOffset = 0; waveOffset < manifest.waves.length; waveOffset += 1) {
    const wave = manifest.waves[waveOffset];
    if (!Number.isInteger(wave.index) || wave.index < 1 || !Array.isArray(wave.agents) || !wave.agents.length) {
      throw new Error("Workpack contains an invalid wave.");
    }
    if (wave.index !== waveOffset + 1 || waveIds.has(wave.index)) throw new Error("Workpack waves must be unique and consecutively ordered.");
    waveIds.add(wave.index);
    for (const agentId of wave.agents) {
      if (!agentIds.has(agentId)) throw new Error(`Wave refers to unknown agent ${agentId}.`);
      if (assignedAgents.has(agentId)) throw new Error(`Agent ${agentId} appears in more than one wave.`);
      assignedAgents.add(agentId);
      if (manifest.agents.find((agent) => agent.id === agentId)?.wave !== wave.index) throw new Error(`Agent ${agentId} wave metadata is inconsistent.`);
    }
    const derivedWaveResources = normalizedResources(wave.agents.flatMap((agentId) => manifest.agents.find((agent) => agent.id === agentId)?.exclusiveResources || []));
    if (!jsonEqual(normalizedResources(wave.exclusiveResources), derivedWaveResources)) throw new Error(`Wave ${wave.index} resources are inconsistent.`);
  }
  if (assignedAgents.size !== manifest.agents.length) throw new Error("Every workpack agent must appear in exactly one wave.");
  const expectedCollect = [process.execPath, "AIDEBUG/workpack.mjs", "collect", "--workpack", workpackPath];
  if (!jsonEqual(manifest.collectCommand, expectedCollect)) throw new Error("Workpack collect command is invalid.");
  for (const snapshot of [...(manifest.goals || []), ...(manifest.controlPlane || [])]) {
    if (!snapshot?.path || !isInside(repoRoot, snapshot.path)) throw new Error("Workpack input snapshots must stay inside the repository.");
  }
  const expectedHash = hashBuffer(JSON.stringify(manifestPayload(manifest)));
  if (manifest.manifestHash !== expectedHash) throw new Error("Workpack manifest hash does not match its contents.");
}

function snapshotDrift(snapshot) {
  const filePath = resolve(String(snapshot?.path || ""));
  if (!filePath || !existsSync(filePath)) return { path: filePath, reason: "missing" };
  const stat = statSync(filePath);
  if (!stat.isFile()) return { path: filePath, reason: "not-a-file" };
  const actualHash = hashFile(filePath);
  if (actualHash !== snapshot.sha256 || stat.size !== snapshot.byteLength) {
    return {
      path: filePath,
      reason: "content-drift",
      expectedSha256: snapshot.sha256,
      actualSha256: actualHash,
      expectedByteLength: snapshot.byteLength,
      actualByteLength: stat.size
    };
  }
  return null;
}

function inputDrift(manifest) {
  return [...(manifest.goals || []), ...(manifest.controlPlane || [])]
    .map(snapshotDrift)
    .filter(Boolean);
}

export function loadWorkpack(workpackValue, { requireCurrentInputs = false } = {}) {
  const workpackPath = resolveWorkpack(workpackValue);
  const manifest = readJson(workpackPath);
  validateManifestShape(manifest, workpackPath);
  const integrityPath = join(dirname(workpackPath), "workpack.integrity.json");
  if (!existsSync(integrityPath)) throw new Error("Workpack integrity sidecar is missing.");
  const integrity = readJson(integrityPath);
  const manifestEvidence = fileEvidence(workpackPath);
  if (
    integrity?.schemaVersion !== 1 ||
    integrity.workpackId !== manifest.workpackId ||
    integrity.manifestHash !== manifest.manifestHash ||
    integrity.manifestSha256 !== manifestEvidence.sha256 ||
    integrity.byteLength !== manifestEvidence.byteLength
  ) {
    throw new Error("Workpack integrity sidecar does not match the exact manifest bytes.");
  }
  const drift = inputDrift(manifest);
  if (requireCurrentInputs && drift.length) {
    const error = new Error(`Workpack inputs changed after emission: ${drift.map((item) => basename(item.path)).join(", ")}`);
    error.code = "AIDEBUG_WORKPACK_INPUT_DRIFT";
    error.drift = drift;
    throw error;
  }
  return { workpackPath, manifest, integrity, drift };
}

function findAgent(manifest, agentId) {
  const agent = manifest.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown workpack agent: ${agentId}`);
  return agent;
}

function latestCheckpoint(agentDir) {
  const checkpointDir = join(agentDir, "checkpoints");
  if (!existsSync(checkpointDir)) return null;
  const entries = readdirSync(checkpointDir)
    .filter((item) => item.endsWith(".json"))
    .sort();
  return entries.length ? readJson(join(checkpointDir, entries.at(-1))) : null;
}

function agentState(workpackPath, agentId) {
  const statePath = agentStatePath(workpackPath, agentId);
  if (!existsSync(statePath)) return { status: "pending", statePath };
  const claimFile = join(statePath, "claim.json");
  const childFile = join(statePath, "child.json");
  const resultFile = join(statePath, "result.json");
  const resultIntegrityFile = join(statePath, "result.integrity.json");
  const claim = existsSync(claimFile) ? readJson(claimFile) : null;
  const child = existsSync(childFile) ? readJson(childFile) : null;
  const result = existsSync(resultFile) ? readJson(resultFile) : null;
  const resultIntegrity = existsSync(resultIntegrityFile) ? readJson(resultIntegrityFile) : null;
  const checkpoint = latestCheckpoint(statePath);
  const terminalCheckpoint = checkpoint?.status === "passed" || checkpoint?.status === "failed";
  return {
    status: result
      ? (result.ok ? "passed" : "failed")
      : terminalCheckpoint
        ? "terminal-uncommitted"
        : claim
          ? checkpoint?.status || "claimed"
          : "orphaned",
    statePath,
    claim,
    child,
    checkpoint,
    result,
    resultIntegrity,
    resultPath: result ? resultFile : "",
    resultIntegrityPath: resultIntegrity ? resultIntegrityFile : ""
  };
}

function evidenceJsonIssue(error, workpackPath) {
  if (error?.code !== "AIDEBUG_JSON_INVALID" || !error?.jsonPath) return "";
  const relativePath = relative(dirname(resolve(workpackPath)), resolve(error.jsonPath)).replaceAll("\\", "/");
  return `evidence-json-invalid:${relativePath || basename(error.jsonPath)}`;
}

function failedEvidenceState(workpackPath, agentId, state = null) {
  if (state) return { ...state, status: "failed" };
  const statePath = agentStatePath(workpackPath, agentId);
  return {
    status: "failed",
    statePath,
    claim: null,
    child: null,
    checkpoint: null,
    result: null,
    resultIntegrity: null,
    resultPath: "",
    resultIntegrityPath: ""
  };
}

function unavailableReview(agent, issue) {
  return agent.reviewRequired === true
    ? { ok: false, issues: [issue], review: null }
    : { ok: true, issues: [], review: null };
}

function inspectAgentEvidence(workpackPath, manifest, agent) {
  let state;
  try {
    state = agentState(workpackPath, agent.id);
  } catch (error) {
    const issue = evidenceJsonIssue(error, workpackPath);
    if (!issue) throw error;
    return {
      state: failedEvidenceState(workpackPath, agent.id),
      runner: { ok: false, issues: [issue], report: null, guiArtifacts: [] },
      review: unavailableReview(agent, issue)
    };
  }

  let runner;
  try {
    runner = validateRunnerResult(manifest, agent, state);
  } catch (error) {
    const issue = evidenceJsonIssue(error, workpackPath);
    if (!issue) throw error;
    return {
      state: failedEvidenceState(workpackPath, agent.id, state),
      runner: { ok: false, issues: [issue], report: null, guiArtifacts: [] },
      review: unavailableReview(agent, issue)
    };
  }

  try {
    return {
      state,
      runner,
      review: validateRecordedReview(workpackPath, manifest, agent, state)
    };
  } catch (error) {
    const issue = evidenceJsonIssue(error, workpackPath);
    if (!issue) throw error;
    return {
      state: failedEvidenceState(workpackPath, agent.id, state),
      runner,
      review: { ok: false, issues: [issue], review: null }
    };
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function stateHeartbeatAt(state) {
  return Date.parse(state.checkpoint?.at || state.claim?.claimedAt || "") || 0;
}

function stateIsStale(state, staleAfterMs) {
  if (!state.claim || state.result) return false;
  if (state.claim.host !== hostname()) return false;
  if (state.claim.host === hostname() && processAlive(Number(state.claim.pid))) return false;
  if (state.claim.host === hostname() && processAlive(Number(state.child?.pid || state.checkpoint?.detail?.childPid))) return false;
  return Date.now() - stateHeartbeatAt(state) >= staleAfterMs;
}

function createCheckpointWriter(agentDir, claim) {
  const checkpointDir = join(agentDir, "checkpoints");
  mkdirSync(checkpointDir, { recursive: true });
  if (readdirSync(checkpointDir).some((item) => item.endsWith(".json"))) {
    throw new Error(`Agent ${claim.agentId} already has checkpoint evidence.`);
  }
  let sequence = 0;
  let previousPath = "";
  let head = null;
  const writeCheckpoint = (status, detail = {}) => {
    sequence += 1;
    const checkpoint = {
      schemaVersion: 1,
      workpackId: claim.workpackId,
      manifestHash: claim.manifestHash,
      agentId: claim.agentId,
      claimToken: claim.claimToken,
      sequence,
      status,
      at: new Date().toISOString(),
      pid: process.pid,
      previousCheckpointSha256: previousPath ? hashFile(previousPath) : "",
      detail
    };
    const checkpointPath = join(checkpointDir, `${String(sequence).padStart(6, "0")}-${safeName(status)}.json`);
    writeJsonExclusive(checkpointPath, checkpoint);
    previousPath = checkpointPath;
    head = { sequence, path: checkpointPath, sha256: hashFile(checkpointPath) };
    return { ...checkpoint, evidence: head };
  };
  writeCheckpoint.head = () => head;
  return writeCheckpoint;
}

function createClaim(workpackPath, manifest, agent) {
  const statePath = agentStatePath(workpackPath, agent.id);
  mkdirSync(statePath, { recursive: true });
  const claim = {
    schemaVersion: 1,
    workpackId: manifest.workpackId,
    manifestHash: manifest.manifestHash,
    agentId: agent.id,
    wave: agent.wave,
    taskIds: [...agent.taskIds],
    claimToken: randomUUID(),
    claimedAt: new Date().toISOString(),
    host: hostname(),
    pid: process.pid
  };
  try {
    writeJsonExclusive(join(statePath, "claim.json"), claim);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const state = agentState(workpackPath, agent.id);
    const duplicate = new Error(`Agent ${agent.id} is already ${state.status}. Use reclaim only after a non-terminal claim becomes stale.`);
    duplicate.code = "AIDEBUG_WORKPACK_AGENT_ALREADY_CLAIMED";
    duplicate.state = state;
    throw duplicate;
  }
  const checkpoint = createCheckpointWriter(statePath, claim);
  checkpoint("claimed");
  return { statePath, claim, checkpoint };
}

async function waitForPriorWave(workpackPath, manifest, agent, waitMs) {
  const priorAgents = manifest.agents.filter((candidate) => candidate.wave < agent.wave);
  if (!priorAgents.length) return;
  const startedAtMs = Date.now();
  while (true) {
    const states = priorAgents.map((candidate) => {
      const state = agentState(workpackPath, candidate.id);
      return { agent: candidate, state, validation: state.result ? validateRunnerResult(manifest, candidate, state) : null };
    });
    const failed = states.find((item) => item.state.result && item.validation?.ok !== true);
    if (failed) {
      const error = new Error(`Wave ${failed.agent.wave} failed validation at agent ${failed.agent.id}; agent ${agent.id} will not start. ${failed.validation?.issues.join(", ") || ""}`);
      error.code = "AIDEBUG_WORKPACK_PRIOR_WAVE_FAILED";
      throw error;
    }
    if (states.every((item) => item.validation?.ok === true)) return;
    if (Date.now() - startedAtMs >= waitMs) {
      const pending = states.filter((item) => !item.state.result).map((item) => item.agent.id);
      const error = new Error(`Timed out waiting for prior wave agents: ${pending.join(", ")}`);
      error.code = "AIDEBUG_WORKPACK_WAVE_TIMEOUT";
      throw error;
    }
    await sleep(250);
  }
}

function resourceLockPath(resource) {
  const normalized = String(resource || "").trim().toLowerCase();
  return join(resourceLockRoot, `${hashBuffer(normalized).slice(0, 40)}.lock`);
}

function readResourceOwner(lockPath) {
  const ownerPath = join(lockPath, "owner.json");
  return existsSync(ownerPath) ? readJson(ownerPath) : null;
}

function releaseResourceLock(lockPath, claimToken) {
  if (!existsSync(lockPath)) return;
  const owner = readResourceOwner(lockPath);
  if (!owner || owner.claimToken !== claimToken) return;
  assertInside(resourceLockRoot, lockPath, "Resource lock");
  mkdirSync(resourceLockHistoryRoot, { recursive: true });
  const releasedPath = join(resourceLockHistoryRoot, `released-${safeName(owner.resource)}-${timestamp()}-${randomUUID().slice(0, 8)}`);
  renameWithRetry(lockPath, releasedPath);
  rmSync(releasedPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
}

async function acquireResourceLocks({ manifest, agent, claim, checkpoint, waitMs }) {
  const resources = [...new Set(agent.exclusiveResources || [])].sort();
  if (!resources.length) return [];
  mkdirSync(resourceLockRoot, { recursive: true });
  const startedAtMs = Date.now();
  let lastConflict = "";
  while (true) {
    const acquired = [];
    let conflict = null;
    for (const resource of resources) {
      const lockPath = resourceLockPath(resource);
      const owner = {
        schemaVersion: 1,
        resource,
        workpackId: manifest.workpackId,
        workpackPath: manifest.workpackPath,
        manifestHash: manifest.manifestHash,
        agentId: agent.id,
        agentStatePath: agentStatePath(manifest.workpackPath, agent.id),
        claimToken: claim.claimToken,
        host: hostname(),
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      };
      try {
        mkdirSync(lockPath, { recursive: true });
        writeJsonExclusive(join(lockPath, "owner.json"), owner);
        acquired.push(lockPath);
      } catch (error) {
        if (error?.code !== "EEXIST") {
          acquired.forEach((item) => releaseResourceLock(item, claim.claimToken));
          throw error;
        }
        conflict = { resource, lockPath, owner: readResourceOwner(lockPath) };
        acquired.forEach((item) => releaseResourceLock(item, claim.claimToken));
        break;
      }
    }
    if (!conflict) {
      checkpoint("resources-acquired", { resources });
      return resources.map(resourceLockPath);
    }
    const conflictKey = `${conflict.resource}:${conflict.owner?.workpackId || "unknown"}:${conflict.owner?.agentId || "unknown"}`;
    if (conflictKey !== lastConflict) {
      checkpoint("waiting-resource", {
        resource: conflict.resource,
        ownerWorkpackId: conflict.owner?.workpackId || "",
        ownerWorkpackPath: conflict.owner?.workpackPath || "",
        ownerAgentId: conflict.owner?.agentId || ""
      });
      lastConflict = conflictKey;
    }
    if (Date.now() - startedAtMs >= waitMs) {
      const error = new Error(`Timed out waiting for resource ${conflict.resource}. Owner: ${conflict.owner?.workpackId || "unknown"}/${conflict.owner?.agentId || "unknown"}.`);
      error.code = "AIDEBUG_WORKPACK_RESOURCE_TIMEOUT";
      error.owner = conflict.owner;
      throw error;
    }
    await sleep(250);
  }
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

function assignedTimeoutMs(agent) {
  const taskTimeout = agent.tasks.reduce((total, task) => total + Math.max(1000, Number(task.timeoutMs || 0)), 0);
  return Math.min(14_400_000, Math.max(120_000, taskTimeout + 120_000));
}

async function executeRunner({ manifest, agent, statePath, claim, checkpoint, heartbeatMs }) {
  const stdoutPath = join(statePath, "launcher.stdout.log");
  const stderrPath = join(statePath, "launcher.stderr.log");
  const runnerResultPath = join(statePath, "runner-result.json");
  const stdoutStream = createWriteStream(stdoutPath, { flags: "wx" });
  const stderrStream = createWriteStream(stderrPath, { flags: "wx" });
  const command = [...agent.runnerCommand];
  if (command.includes("--result-file") || command.some((item) => item.startsWith("--result-file="))) {
    throw new Error(`Agent ${agent.id} runner command already contains --result-file.`);
  }
  command.push("--result-file", runnerResultPath);
  const startedAtMs = Date.now();
  checkpoint("runner-starting", { command: command.slice(0, 4), runnerResultPath });
  let child;
  let spawnError = "";
  let timedOut = false;
  let exitCode = null;
  let signal = null;
  let heartbeat;
  let timer;
  try {
    child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        NAIMAGE_AIDEBUG_ORCHESTRATOR: "1",
        NAIMAGE_AIDEBUG_WORKPACK_ID: manifest.workpackId,
        NAIMAGE_AIDEBUG_WORKPACK_AGENT_ID: agent.id,
        NAIMAGE_AIDEBUG_WORKPACK_CLAIM: claim.claimToken
      }
    });
    if (Number.isInteger(child.pid) && child.pid > 0) {
      writeJsonExclusive(join(statePath, "child.json"), {
        schemaVersion: 1,
        workpackId: manifest.workpackId,
        manifestHash: manifest.manifestHash,
        agentId: agent.id,
        claimToken: claim.claimToken,
        host: hostname(),
        pid: child.pid,
        startedAt: new Date().toISOString()
      });
    }
    child.stdout?.on("data", (chunk) => {
      stdoutStream.write(chunk);
      process.stdout.write(`[${agent.id}:stdout] ${chunk}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderrStream.write(chunk);
      process.stderr.write(`[${agent.id}:stderr] ${chunk}`);
    });
    checkpoint("runner-active", { childPid: child.pid });
    heartbeat = setInterval(() => checkpoint("runner-heartbeat", { childPid: child.pid }), heartbeatMs);
    timer = setTimeout(() => {
      timedOut = true;
      void stopOwnedChild(child);
    }, assignedTimeoutMs(agent));
    const outcome = await new Promise((resolveOutcome) => {
      child.once("error", (error) => resolveOutcome({ error }));
      child.once("exit", (code, childSignal) => resolveOutcome({ code, signal: childSignal }));
    });
    if (outcome.error) spawnError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    exitCode = outcome.code ?? null;
    signal = outcome.signal ?? null;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    stdoutStream.end();
    stderrStream.end();
    await Promise.all([finished(stdoutStream).catch(() => {}), finished(stderrStream).catch(() => {})]);
  }
  const endedAtMs = Date.now();
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    exitCode,
    signal,
    timedOut,
    spawnError,
    stdout: fileEvidence(stdoutPath),
    stderr: fileEvidence(stderrPath),
    runnerResultPath,
    runnerResult: existsSync(runnerResultPath) ? readJson(runnerResultPath) : null,
    runnerResultEvidence: existsSync(runnerResultPath) ? fileEvidence(runnerResultPath) : null
  };
}

function reportEvidenceFromRunner(runner) {
  const reportPath = String(runner.runnerResult?.reportPath || "");
  if (!reportPath || !existsSync(reportPath)) return null;
  assertInside(diagnosticsRoot, reportPath, "AIDEBUG runner report");
  return fileEvidence(reportPath);
}

function resultPayload(result) {
  const { checkpointHead: _checkpointHead, resultPayloadSha256: _resultPayloadSha256, ...payload } = result;
  return payload;
}

function resultPayloadHash(result) {
  return hashBuffer(JSON.stringify(resultPayload(result)));
}

function commitAgentResult(statePath, result, checkpoint) {
  const payloadSha256 = resultPayloadHash(result);
  const terminal = checkpoint(result.ok ? "passed" : "failed", {
    failureReason: result.failureReason || "",
    resultPayloadSha256: payloadSha256
  });
  const committed = {
    ...result,
    resultPayloadSha256: payloadSha256,
    checkpointHead: terminal.evidence
  };
  const resultPath = join(statePath, "result.json");
  writeJsonExclusive(resultPath, committed);
  const resultEvidence = fileEvidence(resultPath);
  const integrityPath = join(statePath, "result.integrity.json");
  writeJsonExclusive(integrityPath, {
    schemaVersion: 1,
    workpackId: committed.workpackId,
    manifestHash: committed.manifestHash,
    agentId: committed.agentId,
    claimToken: committed.claimToken,
    resultPayloadSha256: payloadSha256,
    result: resultEvidence,
    terminalCheckpoint: terminal.evidence,
    createdAt: new Date().toISOString()
  });
  return { result: committed, resultPath, integrityPath };
}

export async function runWorkpackAgent(workpackValue, agentId, options = {}) {
  const waitMs = Math.max(0, Number(options.waitMs ?? defaultWaitMs));
  const heartbeatMs = Math.max(250, Number(options.heartbeatMs ?? defaultHeartbeatMs));
  const { workpackPath, manifest, integrity } = loadWorkpack(workpackValue, { requireCurrentInputs: true });
  const agent = findAgent(manifest, agentId);
  const existing = agentState(workpackPath, agent.id);
  if (existing.result) {
    const validation = validateRunnerResult(manifest, agent, existing);
    if (validation.ok) return { result: existing.result, resultPath: existing.resultPath, idempotent: true };
    const invalid = new Error(`Agent ${agent.id} has an invalid terminal result: ${validation.issues.join(", ")}`);
    invalid.code = "AIDEBUG_WORKPACK_TERMINAL_INVALID";
    invalid.issues = validation.issues;
    throw invalid;
  }
  await waitForPriorWave(workpackPath, manifest, agent, waitMs);
  loadWorkpack(workpackPath, { requireCurrentInputs: true });
  const { statePath, claim, checkpoint } = createClaim(workpackPath, manifest, agent);
  let locks = [];
  let result;
  try {
    locks = await acquireResourceLocks({ manifest, agent, claim, checkpoint, waitMs });
    loadWorkpack(workpackPath, { requireCurrentInputs: true });
    const runner = await executeRunner({ manifest, agent, statePath, claim, checkpoint, heartbeatMs });
    const drift = inputDrift(manifest);
    const report = reportEvidenceFromRunner(runner);
    const runnerOk = runner.exitCode === 0 && !runner.signal && !runner.timedOut && !runner.spawnError &&
      runner.runnerResult?.ok === true && report && drift.length === 0;
    checkpoint("finalizing", { runnerExitCode: runner.exitCode, inputDriftCount: drift.length });
    result = {
      schemaVersion: 1,
      workpackId: manifest.workpackId,
      workpackPath,
      manifestHash: manifest.manifestHash,
      manifestSha256: integrity.manifestSha256,
      agentId: agent.id,
      wave: agent.wave,
      taskIds: [...agent.taskIds],
      claimToken: claim.claimToken,
      ok: Boolean(runnerOk),
      status: runnerOk ? "passed" : "failed",
      startedAt: runner.startedAt,
      endedAt: runner.endedAt,
      durationMs: runner.durationMs,
      runner: {
        exitCode: runner.exitCode,
        signal: runner.signal,
        timedOut: runner.timedOut,
        spawnError: runner.spawnError,
        stdout: runner.stdout,
        stderr: runner.stderr,
        result: runner.runnerResultEvidence,
        report
      },
      inputDrift: drift,
      failureReason: runnerOk
        ? ""
        : drift.length
          ? "workpack-input-drift"
          : runner.timedOut
            ? "runner-timeout"
            : runner.spawnError
              ? "runner-spawn-error"
              : !runner.runnerResult
                ? "runner-result-missing"
                : runner.runnerResult.ok !== true
                  ? "runner-reported-failure"
                  : !report
                    ? "runner-report-missing"
                    : "runner-exit-failure"
    };
  } catch (error) {
    checkpoint("finalizing", { error: error instanceof Error ? error.message : String(error) });
    result = {
      schemaVersion: 1,
      workpackId: manifest.workpackId,
      workpackPath,
      manifestHash: manifest.manifestHash,
      manifestSha256: integrity.manifestSha256,
      agentId: agent.id,
      wave: agent.wave,
      taskIds: [...agent.taskIds],
      claimToken: claim.claimToken,
      ok: false,
      status: "failed",
      startedAt: claim.claimedAt,
      endedAt: new Date().toISOString(),
      inputDrift: inputDrift(manifest),
      failureReason: error?.code || "workpack-agent-error",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    locks.forEach((lockPath) => releaseResourceLock(lockPath, claim.claimToken));
  }
  return commitAgentResult(statePath, result, checkpoint);
}

function validateEvidenceSnapshot(snapshot, label, allowedRoot = "") {
  if (!snapshot?.path || !existsSync(snapshot.path)) return `${label}-missing`;
  if (allowedRoot && !isInside(allowedRoot, snapshot.path)) return `${label}-outside-allowed-root`;
  const actual = fileEvidence(snapshot.path);
  if (actual.sha256 !== snapshot.sha256 || actual.byteLength !== snapshot.byteLength) return `${label}-changed`;
  return "";
}

function goalHashesMatch(left = [], right = []) {
  const expected = new Map(left.map((item) => [resolve(item.path), item.sha256]));
  const actual = new Map(right.map((item) => [resolve(item.path), item.sha256]));
  return expected.size === actual.size && [...expected].every(([filePath, hash]) => actual.get(filePath) === hash);
}

function validateCheckpointChain(manifest, agent, state) {
  const issues = [];
  const checkpointDir = join(state.statePath, "checkpoints");
  if (!existsSync(checkpointDir)) return ["checkpoint-chain-missing"];
  const entries = readdirSync(checkpointDir).filter((item) => item.endsWith(".json")).sort();
  if (!entries.length) return ["checkpoint-chain-empty"];
  let previousSha256 = "";
  let tail = null;
  let tailPath = "";
  for (let index = 0; index < entries.length; index += 1) {
    const checkpointPath = join(checkpointDir, entries[index]);
    const checkpoint = readJson(checkpointPath);
    if (
      checkpoint.schemaVersion !== 1 || checkpoint.workpackId !== manifest.workpackId ||
      checkpoint.manifestHash !== manifest.manifestHash || checkpoint.agentId !== agent.id ||
      checkpoint.claimToken !== state.claim?.claimToken || checkpoint.sequence !== index + 1
    ) issues.push(`checkpoint-${index + 1}-identity-invalid`);
    if (checkpoint.previousCheckpointSha256 !== previousSha256) issues.push(`checkpoint-${index + 1}-chain-invalid`);
    previousSha256 = hashFile(checkpointPath);
    tail = checkpoint;
    tailPath = checkpointPath;
  }
  if (state.result) {
    const head = state.result.checkpointHead;
    const headPath = resolve(head?.path || "");
    if (
      !head || !isInside(checkpointDir, headPath) || !existsSync(headPath) ||
      canonicalPath(headPath) !== canonicalPath(tailPath) || head.sequence !== entries.length ||
      head.sha256 !== previousSha256 || hashFile(headPath) !== head.sha256
    ) issues.push("result-checkpoint-head-invalid");
    if (!tail || tail.status !== state.result.status || !new Set(["passed", "failed"]).has(tail.status)) {
      issues.push("result-terminal-checkpoint-status-invalid");
    }
    const payloadSha256 = resultPayloadHash(state.result);
    if (
      state.result.resultPayloadSha256 !== payloadSha256 ||
      tail?.detail?.resultPayloadSha256 !== payloadSha256
    ) issues.push("result-payload-checkpoint-binding-invalid");
  }
  return issues;
}

function validateResultIntegrity(manifest, agent, state) {
  const integrity = state.resultIntegrity;
  if (!state.result) return [];
  if (!integrity) return ["result-integrity-missing"];
  const issues = [];
  if (
    integrity.schemaVersion !== 1 || integrity.workpackId !== manifest.workpackId ||
    integrity.manifestHash !== manifest.manifestHash || integrity.agentId !== agent.id ||
    integrity.claimToken !== state.result.claimToken
  ) issues.push("result-integrity-identity-invalid");
  const resultIssue = validateEvidenceSnapshot(integrity.result, "result-integrity-result", state.statePath);
  if (resultIssue) issues.push(resultIssue);
  if (canonicalPath(integrity.result?.path || "") !== canonicalPath(state.resultPath || "")) issues.push("result-integrity-path-mismatch");
  if (
    integrity.resultPayloadSha256 !== state.result.resultPayloadSha256 ||
    !jsonEqual(integrity.terminalCheckpoint, state.result.checkpointHead)
  ) issues.push("result-integrity-binding-mismatch");
  return issues;
}

function validateRunnerResult(manifest, agent, state) {
  const issues = [];
  const result = state.result;
  if (!result) return { ok: false, issues: ["result-missing"], report: null, guiArtifacts: [] };
  if (result.schemaVersion !== 1) issues.push("result-schema-invalid");
  if (result.workpackId !== manifest.workpackId || result.manifestHash !== manifest.manifestHash) issues.push("result-workpack-mismatch");
  const manifestSha256 = hashFile(manifest.workpackPath);
  if (result.manifestSha256 !== manifestSha256) issues.push("result-manifest-file-mismatch");
  if (result.agentId !== agent.id || result.wave !== agent.wave) issues.push("result-agent-mismatch");
  if (!state.claim || result.claimToken !== state.claim.claimToken) issues.push("result-claim-mismatch");
  if (result.status !== (result.ok === true ? "passed" : "failed")) issues.push("result-status-mismatch");
  if (JSON.stringify(result.taskIds) !== JSON.stringify(agent.taskIds)) issues.push("result-task-list-mismatch");
  for (const [label, evidence] of Object.entries({
    stdout: result.runner?.stdout,
    stderr: result.runner?.stderr,
    runnerResult: result.runner?.result
  })) {
    const issue = validateEvidenceSnapshot(evidence, label, state.statePath);
    if (issue) issues.push(issue);
  }
  const reportEvidenceIssue = validateEvidenceSnapshot(result.runner?.report, "report", diagnosticsRoot);
  if (reportEvidenceIssue) issues.push(reportEvidenceIssue);
  issues.push(...validateResultIntegrity(manifest, agent, state));
  if (result.ok === true) {
    if (
      result.runner?.exitCode !== 0 || result.runner?.signal != null || result.runner?.timedOut !== false ||
      String(result.runner?.spawnError || "") !== ""
    ) issues.push("result-runner-outcome-invalid");
    if (Array.isArray(result.inputDrift) && result.inputDrift.length) issues.push("result-recorded-input-drift");
  }
  for (const resource of agent.exclusiveResources || []) {
    const owner = readResourceOwner(resourceLockPath(resource));
    if (
      owner?.workpackId === manifest.workpackId && owner?.agentId === agent.id &&
      owner?.claimToken === result.claimToken
    ) issues.push(`owned-resource-lock-remains:${resource}`);
  }
  let report = null;
  let runnerResult = null;
  const guiArtifacts = [];
  if (result.runner?.result?.path && existsSync(result.runner.result.path)) {
    runnerResult = readJson(result.runner.result.path);
    const binding = runnerResult.workpack;
    if (
      binding?.workpackId !== manifest.workpackId || binding?.agentId !== agent.id ||
      binding?.claimToken !== result.claimToken
    ) issues.push("runner-result-workpack-binding-mismatch");
    if (JSON.stringify(runnerResult.agentIds || []) !== JSON.stringify([agent.id])) issues.push("runner-result-agent-mismatch");
    if (JSON.stringify(runnerResult.taskIds || []) !== JSON.stringify(agent.taskIds)) issues.push("runner-result-task-mismatch");
    if (runnerResult.ok !== true) issues.push("runner-result-failed");
    if (canonicalPath(runnerResult.reportPath || "") !== canonicalPath(result.runner?.report?.path || "")) issues.push("runner-result-report-path-mismatch");
  }
  const reportPath = result.runner?.report?.path;
  if (reportPath && existsSync(reportPath)) {
    report = readJson(reportPath);
    if (report.ok !== true) issues.push("runner-report-failed");
    if (
      report.workpack?.workpackId !== manifest.workpackId || report.workpack?.agentId !== agent.id ||
      report.workpack?.claimToken !== result.claimToken
    ) issues.push("runner-report-workpack-binding-mismatch");
    if (!goalHashesMatch(manifest.goals, report.goals)) issues.push("runner-report-goal-mismatch");
    if (!Array.isArray(report.agents) || report.agents.length !== 1 || report.agents[0]?.id !== agent.id) {
      issues.push("runner-report-agent-mismatch");
    } else {
      const runnerTasks = report.agents[0].tasks || [];
      const taskIds = runnerTasks.map((task) => task.taskId);
      if (JSON.stringify(taskIds) !== JSON.stringify(agent.taskIds)) issues.push("runner-report-task-mismatch");
      if (!report.agents[0].ok || !runnerTasks.every((task) => task.ok)) issues.push("runner-report-task-failed");
      for (const task of agent.tasks.filter((item) => item.kind === "gui")) {
        const runnerTask = runnerTasks.find((item) => item.taskId === task.id);
        const artifactEvidence = runnerTask?.guiArtifact;
        const artifactIssue = validateEvidenceSnapshot(artifactEvidence, `gui-artifact:${task.id}`, diagnosticsRoot);
        if (artifactIssue) {
          issues.push(artifactIssue);
          continue;
        }
        const artifact = readJson(artifactEvidence.path);
        if (
          artifact.schemaVersion !== 1 || artifact.ok !== true ||
          artifact.workpack?.workpackId !== manifest.workpackId || artifact.workpack?.agentId !== agent.id ||
          artifact.workpack?.claimToken !== result.claimToken || artifact.workpack?.taskId !== task.id
        ) issues.push(`gui-artifact-binding-mismatch:${task.id}`);
        const guiReportIssue = validateEvidenceSnapshot(artifact.report, `gui-artifact-report:${task.id}`, electronEvidenceRoot);
        if (guiReportIssue) issues.push(guiReportIssue);
        guiArtifacts.push({ taskId: task.id, evidence: artifactEvidence, artifact });
      }
    }
  }
  issues.push(...validateCheckpointChain(manifest, agent, state));
  if (result.ok !== true) issues.push(`agent-result-${result.failureReason || "failed"}`);
  return { ok: issues.length === 0, issues: [...new Set(issues)], report, guiArtifacts };
}

function evidenceTimeRange(result) {
  return {
    start: Date.parse(result.startedAt || "") - 60_000,
    end: Date.parse(result.endedAt || "") + 300_000
  };
}

function pngGeometry(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: 0, height: 0 };
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function validateGuiReport(guiReportPath, manifest, agent, agentResult, guiArtifacts, { allowFixtureEvidence = false } = {}) {
  const resolvedPath = resolve(guiReportPath);
  assertInside(electronEvidenceRoot, resolvedPath, "GUI report");
  const report = readJson(resolvedPath);
  const issues = [];
  if (report.ok !== true || (Array.isArray(report.failures) && report.failures.length)) issues.push("gui-report-failed");
  if (!allowFixtureEvidence && /self[-_ ]?test|fixture/i.test(String(report.mode || ""))) issues.push("gui-report-is-fixture");
  if (resolve(report.reportPath || "") !== resolvedPath) issues.push("gui-report-path-mismatch");
  const runDir = resolve(report.runDir || "");
  if (!isInside(electronEvidenceRoot, runDir) || !isInside(runDir, resolvedPath)) issues.push("gui-run-directory-invalid");
  const binding = report.workpack;
  const guiTaskIds = new Set(agent.tasks.filter((task) => task.kind === "gui").map((task) => task.id));
  if (
    binding?.workpackId !== manifest.workpackId || binding?.agentId !== agent.id ||
    binding?.claimToken !== agentResult.claimToken || !guiTaskIds.has(binding?.taskId)
  ) issues.push("gui-report-workpack-binding-mismatch");
  const artifact = guiArtifacts.find((item) => item.taskId === binding?.taskId);
  if (!artifact && !allowFixtureEvidence) {
    issues.push("gui-report-runner-artifact-missing");
  } else if (artifact) {
    if (
      canonicalPath(artifact.artifact?.report?.path || "") !== canonicalPath(resolvedPath) ||
      artifact.artifact?.report?.sha256 !== hashFile(resolvedPath) ||
      Number(artifact.artifact?.report?.byteLength) !== statSync(resolvedPath).size
    ) issues.push("gui-report-runner-artifact-mismatch");
  }
  const observations = Array.isArray(report.observations) ? report.observations : [];
  if (!observations.some((item) => item?.label === "suite-checkpoint" && item?.detail?.label === "bootstrap:prepare-run")) {
    issues.push("gui-bootstrap-evidence-missing");
  }
  const firstObservedAt = Math.min(...observations.map((item) => Date.parse(item?.at || "")).filter(Number.isFinite));
  const range = evidenceTimeRange(agentResult);
  if (!Number.isFinite(firstObservedAt) || firstObservedAt < range.start || firstObservedAt > range.end) issues.push("gui-report-outside-agent-run");
  const results = Array.isArray(report.results) ? report.results : [];
  const visualResults = results.filter((item) => item?.screenshotPath && item?.screenshotSource !== "fallback" && item?.nativeCapture?.source !== "fixture");
  if (!visualResults.length) issues.push("gui-screenshots-missing");
  const screenshots = [];
  for (const item of visualResults) {
    const screenshotPath = resolve(item?.screenshotPath || "");
    if (!screenshotPath || !existsSync(screenshotPath) || !isInside(runDir, screenshotPath)) {
      issues.push(`gui-screenshot-invalid:${item?.label || "unknown"}`);
      continue;
    }
    const evidence = fileEvidence(screenshotPath);
    if (item?.screenshotEvidence?.sha256 !== evidence.sha256 || Number(item?.screenshotEvidence?.byteLength) !== evidence.byteLength) {
      issues.push(`gui-screenshot-hash-mismatch:${item?.label || "unknown"}`);
    }
    if (item?.screenshotSource !== "cdp-dual-frame" || item?.screenshotEvidence?.source !== "cdp-dual-frame") {
      issues.push(`gui-screenshot-source-invalid:${item?.label || "unknown"}`);
    }
    const geometry = pngGeometry(screenshotPath);
    if (
      geometry.width <= 0 || geometry.height <= 0 ||
      Number(item?.screenshotEvidence?.width) !== geometry.width || Number(item?.screenshotEvidence?.height) !== geometry.height
    ) issues.push(`gui-screenshot-dimensions-invalid:${item?.label || "unknown"}`);
    if (item?.dualFrameReport?.ok !== true || item?.stateStabilityReport?.ok !== true) issues.push(`gui-screenshot-stability-failed:${item?.label || "unknown"}`);
    if ((item?.stateIssues || []).length || (item?.captureIssues || []).length) issues.push(`gui-screenshot-state-failed:${item?.label || "unknown"}`);
    if (item?.overflow?.documentOverflowX || item?.overflow?.bodyOverflowX || (item?.overflow?.elementOverflowX || []).length) {
      issues.push(`gui-screenshot-overflow:${item?.label || "unknown"}`);
    }
    if (item?.visualReliability?.ok !== true) issues.push(`gui-visual-reliability-failed:${item?.label || "unknown"}`);
    screenshots.push({ label: String(item?.label || ""), ...evidence });
  }
  return {
    ok: issues.length === 0,
    issues,
    report,
    reportEvidence: fileEvidence(resolvedPath),
    screenshots,
    guiArtifact: artifact?.evidence || null
  };
}

function validateVisualReview(visualReviewPath, guiScreenshots, { allowFixtureEvidence = false } = {}) {
  const resolvedPath = resolve(visualReviewPath);
  assertInside(visualEvidenceRoot, resolvedPath, "Visual review");
  const review = readJson(resolvedPath);
  const issues = [];
  if (review.ok !== true || (Array.isArray(review.errors) && review.errors.length)) issues.push("visual-review-failed");
  if (!allowFixtureEvidence && /selftest-/i.test(resolvedPath)) issues.push("visual-review-is-selftest");
  const montagePath = resolve(review.montagePath || "");
  if (!montagePath || !existsSync(montagePath) || !isInside(dirname(resolvedPath), montagePath)) {
    issues.push("visual-review-montage-invalid");
  }
  const montage = montagePath && existsSync(montagePath) ? fileEvidence(montagePath) : null;
  if (montage && (review.montage?.sha256 !== montage.sha256 || Number(review.montage?.byteLength) !== montage.byteLength)) {
    issues.push("visual-review-montage-changed");
  }
  const sourceHashes = new Set((review.sources || []).map((item) => item?.sha256).filter(Boolean));
  const expectedHashes = new Set(guiScreenshots.map((item) => item.sha256));
  if (sourceHashes.size !== expectedHashes.size || [...sourceHashes].some((hash) => !expectedHashes.has(hash))) {
    issues.push("visual-review-source-set-mismatch");
  }
  for (const screenshot of guiScreenshots) {
    if (!sourceHashes.has(screenshot.sha256)) issues.push(`visual-review-missing-screenshot:${screenshot.label || screenshot.sha256.slice(0, 8)}`);
  }
  for (const source of review.sources || []) {
    const issue = validateEvidenceSnapshot(source, `visual-source:${basename(source.path || "unknown")}`, electronEvidenceRoot);
    if (issue) issues.push(issue);
  }
  return { ok: issues.length === 0, issues, review, reviewEvidence: fileEvidence(resolvedPath), montage };
}

export function recordWorkpackReview(workpackValue, agentId, options = {}) {
  const { workpackPath, manifest } = loadWorkpack(workpackValue, { requireCurrentInputs: true });
  const agent = findAgent(manifest, agentId);
  if (agent.reviewRequired !== true) throw new Error(`Agent ${agent.id} has no GUI task and does not require visual review.`);
  const state = agentState(workpackPath, agent.id);
  const validatedResult = validateRunnerResult(manifest, agent, state);
  if (!validatedResult.ok) throw new Error(`Agent ${agent.id} has no valid passing result: ${validatedResult.issues.join(", ")}`);
  const verdict = String(options.verdict || "").trim().toLowerCase();
  if (!new Set(["approved", "rejected"]).has(verdict)) throw new Error("Review verdict must be approved or rejected.");
  const reviewer = String(options.reviewer || "").trim();
  if (reviewer.length < 2 || reviewer.length > 120) throw new Error("Reviewer must be 2 to 120 characters.");
  const gui = validateGuiReport(options.guiReport, manifest, agent, state.result, validatedResult.guiArtifacts, options);
  const visual = validateVisualReview(options.visualReview, gui.screenshots, options);
  const issues = [...gui.issues, ...visual.issues];
  if (issues.length) throw new Error(`Visual evidence is not closure-ready: ${issues.join(", ")}`);
  const record = {
    schemaVersion: 1,
    workpackId: manifest.workpackId,
    workpackPath,
    manifestHash: manifest.manifestHash,
    agentId: agent.id,
    agentResult: fileEvidence(state.resultPath),
    recordedAt: new Date().toISOString(),
    reviewer,
    verdict,
    notes: String(options.notes || "").trim().slice(0, 4000),
    guiReport: gui.reportEvidence,
    guiArtifact: gui.guiArtifact,
    screenshots: gui.screenshots,
    visualReview: visual.reviewEvidence,
    montage: visual.montage,
    coverage: {
      guiScreenshots: gui.screenshots.length,
      reviewedScreenshots: gui.screenshots.length,
      complete: true
    }
  };
  const outputPath = reviewPath(workpackPath, agent.id);
  writeJsonExclusive(outputPath, record);
  return { record, reviewPath: outputPath };
}

function validateRecordedReview(workpackPath, manifest, agent, state) {
  if (agent.reviewRequired !== true) return { ok: true, issues: [], review: null };
  const outputPath = reviewPath(workpackPath, agent.id);
  if (!existsSync(outputPath)) return { ok: false, issues: ["visual-review-record-missing"], review: null };
  const review = readJson(outputPath);
  const issues = [];
  if (review.schemaVersion !== 1 || review.workpackId !== manifest.workpackId || review.manifestHash !== manifest.manifestHash || review.agentId !== agent.id) {
    issues.push("visual-review-record-mismatch");
  }
  if (review.verdict !== "approved") issues.push(`visual-review-${review.verdict || "invalid"}`);
  if (review.coverage?.complete !== true || review.coverage?.guiScreenshots !== review.coverage?.reviewedScreenshots) issues.push("visual-review-coverage-incomplete");
  const resultIssue = validateEvidenceSnapshot(review.agentResult, "visual-review-agent-result", state.statePath);
  if (resultIssue) issues.push(resultIssue);
  if (state.resultPath && review.agentResult?.sha256 !== hashFile(state.resultPath)) issues.push("visual-review-agent-result-mismatch");
  for (const [label, evidence, root] of [
    ["guiArtifact", review.guiArtifact, diagnosticsRoot],
    ["guiReport", review.guiReport, electronEvidenceRoot],
    ["visualReview", review.visualReview, visualEvidenceRoot],
    ["montage", review.montage, visualEvidenceRoot]
  ]) {
    const issue = validateEvidenceSnapshot(evidence, label, root);
    if (issue) issues.push(issue);
  }
  for (const screenshot of review.screenshots || []) {
    const issue = validateEvidenceSnapshot(screenshot, `reviewed-screenshot:${screenshot.label || "unknown"}`, electronEvidenceRoot);
    if (issue) issues.push(issue);
  }
  return { ok: issues.length === 0, issues, review };
}

export function collectWorkpack(workpackValue) {
  const { workpackPath, manifest, integrity, drift } = loadWorkpack(workpackValue, { requireCurrentInputs: false });
  const agents = manifest.agents.map((agent) => {
    const { state, runner, review } = inspectAgentEvidence(workpackPath, manifest, agent);
    return {
      id: agent.id,
      wave: agent.wave,
      taskIds: [...agent.taskIds],
      reviewRequired: agent.reviewRequired === true,
      status: state.status,
      ok: runner.ok && review.ok,
      hasResult: Boolean(state.result),
      hasReview: Boolean(review.review),
      statePath: state.statePath,
      resultPath: state.resultPath || "",
      runnerIssues: runner.issues,
      reviewIssues: review.issues,
      reviewPath: review.review ? reviewPath(workpackPath, agent.id) : ""
    };
  });
  const terminalFailure = agents.some((agent) =>
    agent.status === "failed" || agent.status === "terminal-uncommitted" ||
    (agent.hasResult && agent.runnerIssues.length > 0) ||
    (agent.hasReview && agent.reviewIssues.length > 0)
  );
  const complete = agents.every((agent) => agent.ok);
  const status = drift.length ? "stale-inputs" : complete ? "passed" : terminalFailure ? "failed" : "incomplete";
  const closureId = `closure-${timestamp()}-${randomUUID().slice(0, 8)}`;
  const closure = {
    schemaVersion: 1,
    closureId,
    workpackId: manifest.workpackId,
    workpackPath,
    manifestHash: manifest.manifestHash,
    manifestSha256: integrity.manifestSha256,
    createdAt: new Date().toISOString(),
    ok: status === "passed",
    status,
    inputDrift: drift,
    counts: {
      waves: manifest.waves.length,
      agents: agents.length,
      agentsPassed: agents.filter((agent) => agent.ok).length,
      agentsPending: agents.filter((agent) => !agent.hasResult).length,
      reviewsRequired: agents.filter((agent) => agent.reviewRequired).length,
      reviewsPassed: agents.filter((agent) => agent.reviewRequired && agent.reviewIssues.length === 0).length
    },
    waves: manifest.waves.map((wave) => ({
      ...wave,
      ok: wave.agents.every((agentId) => agents.find((agent) => agent.id === agentId)?.ok === true)
    })),
    agents
  };
  const closuresRoot = join(workpackStateRoot(workpackPath), "closures");
  mkdirSync(closuresRoot, { recursive: true });
  const immutableClosurePath = join(closuresRoot, `${closureId}.json`);
  writeJsonExclusive(immutableClosurePath, closure);
  const closurePath = join(dirname(workpackPath), "closure-report.json");
  replaceJsonWithHistory(closurePath, closure);
  return { closure, closurePath, immutableClosurePath };
}

function archiveResourceLock(lockPath, owner) {
  if (!existsSync(lockPath)) return "";
  mkdirSync(resourceLockHistoryRoot, { recursive: true });
  const archivePath = join(resourceLockHistoryRoot, `${safeName(owner?.resource || basename(lockPath))}-${timestamp()}-${randomUUID().slice(0, 8)}`);
  renameWithRetry(lockPath, archivePath);
  return archivePath;
}

export function reclaimWorkpackAgent(workpackValue, agentId, { staleAfterMs = defaultStaleAfterMs } = {}) {
  const { workpackPath, manifest } = loadWorkpack(workpackValue, { requireCurrentInputs: false });
  const agent = findAgent(manifest, agentId);
  let state = agentState(workpackPath, agent.id);
  if (!state.claim) {
    if (state.status === "pending") throw new Error(`Agent ${agent.id} has no claim to reclaim.`);
    const ageMs = Date.now() - statSync(state.statePath).mtimeMs;
    if (ageMs < staleAfterMs) {
      const error = new Error(`Agent ${agent.id} has an unpublished state directory that is not stale.`);
      error.code = "AIDEBUG_WORKPACK_CLAIM_NOT_STALE";
      throw error;
    }
    const historyRoot = join(workpackStateRoot(workpackPath), "history", "orphans");
    mkdirSync(historyRoot, { recursive: true });
    const archivePath = join(historyRoot, `${safeName(agent.id)}-${timestamp()}-${randomUUID().slice(0, 8)}`);
    renameWithRetry(state.statePath, archivePath);
    return {
      ok: true,
      orphanedState: true,
      workpackId: manifest.workpackId,
      agentId: agent.id,
      reclaimedAt: new Date().toISOString(),
      archivePath,
      reclaimedLocks: []
    };
  }
  if (state.result) throw new Error(`Agent ${agent.id} is terminal (${state.status}); emit a new workpack instead of hiding its result.`);
  if (state.checkpoint?.status === "passed" || state.checkpoint?.status === "failed") {
    throw new Error(`Agent ${agent.id} has an uncommitted terminal checkpoint and cannot be reclaimed automatically.`);
  }
  if (state.claim.host !== hostname()) {
    const error = new Error(`Agent ${agent.id} belongs to host ${state.claim.host}; cross-host reclaim is not supported.`);
    error.code = "AIDEBUG_WORKPACK_REMOTE_RECLAIM_UNSUPPORTED";
    throw error;
  }
  if (!stateIsStale(state, staleAfterMs)) {
    const error = new Error(`Agent ${agent.id} claim is not stale.`);
    error.code = "AIDEBUG_WORKPACK_CLAIM_NOT_STALE";
    throw error;
  }
  const observed = {
    claimToken: state.claim.claimToken,
    sequence: state.checkpoint?.sequence || 0,
    at: state.checkpoint?.at || state.claim.claimedAt
  };
  Atomics.wait(syncWaitBuffer, 0, 0, Math.min(250, Math.max(50, Math.floor(staleAfterMs / 4))));
  state = agentState(workpackPath, agent.id);
  if (
    !stateIsStale(state, staleAfterMs) || state.claim?.claimToken !== observed.claimToken ||
    Number(state.checkpoint?.sequence || 0) !== observed.sequence || (state.checkpoint?.at || state.claim?.claimedAt) !== observed.at
  ) {
    const error = new Error(`Agent ${agent.id} changed during stale observation and will not be reclaimed.`);
    error.code = "AIDEBUG_WORKPACK_CLAIM_NOT_STALE";
    throw error;
  }
  const historyRoot = join(workpackStateRoot(workpackPath), "history", "agents");
  mkdirSync(historyRoot, { recursive: true });
  const archivePath = join(historyRoot, `${safeName(agent.id)}-${timestamp()}-${String(state.claim.claimToken).slice(0, 8)}`);
  renameWithRetry(state.statePath, archivePath);
  const reclaimedLocks = [];
  for (const resource of agent.exclusiveResources || []) {
    const lockPath = resourceLockPath(resource);
    if (!existsSync(lockPath)) continue;
    const owner = readResourceOwner(lockPath);
    if (owner?.claimToken === state.claim.claimToken && owner?.workpackId === manifest.workpackId && owner?.agentId === agent.id) {
      reclaimedLocks.push(archiveResourceLock(lockPath, owner));
    }
  }
  return {
    ok: true,
    workpackId: manifest.workpackId,
    agentId: agent.id,
    reclaimedAt: new Date().toISOString(),
    archivePath,
    reclaimedLocks
  };
}

export function workpackStatus(workpackValue) {
  const { workpackPath, manifest, drift } = loadWorkpack(workpackValue, { requireCurrentInputs: false });
  const waves = manifest.waves.map((wave) => ({
    ...wave,
    agents: wave.agents.map((agentId) => {
      const agent = findAgent(manifest, agentId);
      const { state, runner, review } = inspectAgentEvidence(workpackPath, manifest, agent);
      return { id: agentId, ...state, verified: runner.ok && review.ok, runnerIssues: runner.issues, reviewIssues: review.issues };
    })
  }));
  const inputsCurrent = drift.length === 0;
  const closureReady = inputsCurrent && waves.every((wave) => wave.agents.every((agent) => agent.verified));
  return {
    ok: closureReady,
    inputsCurrent,
    closureReady,
    workpackId: manifest.workpackId,
    workpackPath,
    manifestHash: manifest.manifestHash,
    inputDrift: drift,
    waves
  };
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

function parseCli(argv) {
  const command = argv[0] || "";
  const options = { command, workpack: "", agent: "", waitMs: defaultWaitMs, staleAfterMs: defaultStaleAfterMs, guiReport: "", visualReview: "", verdict: "", reviewer: "", notes: "", help: false };
  for (let index = 1; index < argv.length;) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    const mappings = [
      ["--workpack", "workpack"],
      ["--agent", "agent"],
      ["--gui-report", "guiReport"],
      ["--visual-review", "visualReview"],
      ["--verdict", "verdict"],
      ["--reviewer", "reviewer"],
      ["--notes", "notes"]
    ];
    let matched = false;
    for (const [flag, key] of mappings) {
      const taken = takeValue(argv, index, flag);
      if (!taken) continue;
      options[key] = taken.value;
      index += taken.consumed;
      matched = true;
      break;
    }
    if (matched) continue;
    const wait = takeValue(argv, index, "--wait-ms");
    if (wait) {
      options.waitMs = Number(wait.value);
      if (!Number.isInteger(options.waitMs) || options.waitMs < 1000 || options.waitMs > 14_400_000) throw new Error("--wait-ms must be 1000..14400000.");
      index += wait.consumed;
      continue;
    }
    const stale = takeValue(argv, index, "--stale-after-ms");
    if (stale) {
      options.staleAfterMs = Number(stale.value);
      if (!Number.isInteger(options.staleAfterMs) || options.staleAfterMs < 30_000 || options.staleAfterMs > 86_400_000) throw new Error("--stale-after-ms must be 30000..86400000.");
      index += stale.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node AIDEBUG/workpack.mjs status --workpack <workpack.json>
  node AIDEBUG/workpack.mjs run-agent --workpack <workpack.json> --agent <id> [--wait-ms <ms>]
  node AIDEBUG/workpack.mjs review --workpack <workpack.json> --agent <id> --gui-report <report.json> --visual-review <review.json> --verdict <approved|rejected> --reviewer <name> [--notes <text>]
  node AIDEBUG/workpack.mjs collect --workpack <workpack.json>
  node AIDEBUG/workpack.mjs reclaim --workpack <workpack.json> --agent <id> [--stale-after-ms <ms>]

Claims and results are immutable. Reclaim archives only a non-terminal stale claim and its owned resource locks.
`);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help || !options.command) {
    printHelp();
    return;
  }
  if (!options.workpack) throw new Error("--workpack is required.");
  if (options.command === "status") {
    console.log(JSON.stringify(workpackStatus(options.workpack), null, 2));
    return;
  }
  if (options.command === "collect") {
    const collected = collectWorkpack(options.workpack);
    console.log(JSON.stringify({ ok: collected.closure.ok, status: collected.closure.status, closurePath: collected.closurePath, counts: collected.closure.counts }, null, 2));
    if (!collected.closure.ok) process.exitCode = 1;
    return;
  }
  if (!options.agent) throw new Error("--agent is required.");
  if (options.command === "run-agent") {
    const run = await runWorkpackAgent(options.workpack, options.agent, { waitMs: options.waitMs });
    console.log(JSON.stringify({
      ok: run.result.ok,
      idempotent: run.idempotent === true,
      resultPath: run.resultPath,
      status: run.result.status,
      failureReason: run.result.failureReason
    }, null, 2));
    if (!run.result.ok) process.exitCode = 1;
    return;
  }
  if (options.command === "review") {
    if (!options.guiReport || !options.visualReview || !options.verdict || !options.reviewer) {
      throw new Error("review requires --gui-report, --visual-review, --verdict, and --reviewer.");
    }
    const review = recordWorkpackReview(options.workpack, options.agent, options);
    console.log(JSON.stringify({ ok: review.record.verdict === "approved", reviewPath: review.reviewPath, verdict: review.record.verdict, coverage: review.record.coverage }, null, 2));
    if (review.record.verdict !== "approved") process.exitCode = 1;
    return;
  }
  if (options.command === "reclaim") {
    console.log(JSON.stringify(reclaimWorkpackAgent(options.workpack, options.agent, { staleAfterMs: options.staleAfterMs }), null, 2));
    return;
  }
  throw new Error(`Unknown workpack command: ${options.command}`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
