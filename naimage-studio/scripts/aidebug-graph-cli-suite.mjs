#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import {
  BasicCdpClient,
  createRuntimeEvaluator,
  pollForDebugTarget,
  waitForRuntimeExpression
} from "./aidebug/harness/cdp.mjs";
import {
  allocateDebugPort,
  forceKillProcessTree,
  pipeProcessLogs,
  waitForChildExit,
  waitForHttpServer
} from "./aidebug/harness/process.mjs";
import { createAidebugReporting } from "./aidebug/harness/reporting.mjs";
import { capturePngScreenshot } from "./aidebug/harness/screenshot.mjs";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const diagnosticsRoot = join(packageRoot, ".diagnostics", "electron");
const reviewRoot = join(packageRoot, ".diagnostics", "aidebug-review");
const runKey = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(diagnosticsRoot, `aidebug-graph-cli-${runKey}`);
const reviewDir = join(reviewRoot, `review-graph-cli-${runKey}`);
const configDir = join(runDir, "config");
const projectListPath = join(configDir, "project-list.json");
const fixtureProjectId = "aidebug-graph-project";
const fixtureProjectPath = join(runDir, "project");
const endpointPath = join(configDir, "automation", "endpoint.json");
const schemaPath = join(packageRoot, "integrations", "naimage-control", "references", "commands.schema.json");
const sourceCliPath = join(packageRoot, "integrations", "naimage-control", "scripts", "naimage.ps1");
const installedSkillRoot = join(runDir, "naimage-control");
const installedCliPath = join(installedSkillRoot, "scripts", "naimage.ps1");
const cliTracePath = join(runDir, "cli-commands.ndjson");
const observationsPath = join(runDir, "observations.ndjson");
const electronLogPath = join(runDir, "electron.log");
const desktopLogPath = join(runDir, "aidebug-history.md");
const viteCli = join(packageRoot, "node_modules", "vite", "bin", "vite.js");
const electronCli = join(packageRoot, "node_modules", "electron", "cli.js");
const visualReviewCli = join(packageRoot, "AIDEBUG", "visual-review.mjs");
const selfTestOnly = process.argv.includes("--self-test") || process.argv.includes("--selftest");

const REQUIRED_COMMANDS = Object.freeze([
  "canvas.state",
  "canvas.clear",
  "canvas.import",
  "canvas.select",
  "canvas.fit",
  "canvas.group",
  "canvas.connect",
  "canvas.nudge",
  "canvas.create-requirement",
  "canvas.update-requirement",
  "canvas.execute-requirement",
  "canvas.disconnect",
  "canvas.dissolve"
]);

const evaluate = createRuntimeEvaluator({ holdAsyncIifePromises: true });

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileEvidence(filePath) {
  const bytes = readFileSync(filePath);
  const stat = statSync(filePath);
  return {
    path: resolve(filePath),
    byteLength: bytes.length,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256Bytes(bytes)
  };
}

function appendJsonLine(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}

function prepareProjectFixture() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(fixtureProjectPath, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(projectListPath, `${JSON.stringify({
    activeProjectId: fixtureProjectId,
    projects: [{
      id: fixtureProjectId,
      name: "AIDebug Graph CLI",
      path: fixtureProjectPath,
      sessionPath: join(fixtureProjectPath, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: true
    }]
  }, null, 2)}\n`, "utf8");
}

const observations = [];
function recordObservation(level, label, detail = {}) {
  const observation = { at: new Date().toISOString(), level, label, detail };
  observations.push(observation);
  appendJsonLine(observationsPath, observation);
  process.stdout.write(`[aidebug:${level}] ${label}\n`);
  return observation;
}

function commandNamesFromSchema(schema) {
  return (Array.isArray(schema?.sections) ? schema.sections : [])
    .flatMap((section) => Array.isArray(section?.commands) ? section.commands : [])
    .map((command) => String(command?.name || "").trim())
    .filter(Boolean);
}

function readCommandSchema() {
  const bytes = readFileSync(schemaPath);
  const schema = JSON.parse(bytes.toString("utf8"));
  const commandNames = commandNamesFromSchema(schema);
  const missing = REQUIRED_COMMANDS.filter((command) => !commandNames.includes(command));
  return {
    schema,
    commandNames,
    missing,
    evidence: {
      ...fileEvidence(schemaPath),
      version: Number(schema?.version || 0),
      commandCount: commandNames.length,
      requiredCommands: [...REQUIRED_COMMANDS]
    }
  };
}

function parseCliJson(stdout) {
  const text = String(stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the final compact JSON line when a host emitted a preface.
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // PowerShell or the host may emit a non-JSON informational line first.
    }
  }
  throw new Error(`naimage CLI did not emit JSON (stdout length ${String(stdout || "").length}).`);
}

function runProcess(file, args, options = {}) {
  return new Promise((resolveProcess) => {
    execFile(file, args, {
      cwd: options.cwd || packageRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: options.timeoutMs || 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: options.env || process.env
    }, (error, stdout, stderr) => {
      resolveProcess({
        status: error ? Number(error.code || 1) : 0,
        signal: error?.signal || "",
        killed: Boolean(error?.killed),
        error: error ? String(error.message || error) : "",
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    });
  });
}

function prepareCliInstall() {
  if (!existsSync(sourceCliPath)) throw new Error(`naimage CLI is missing: ${sourceCliPath}`);
  mkdirSync(dirname(installedCliPath), { recursive: true });
  copyFileSync(sourceCliPath, installedCliPath);
  writeFileSync(join(installedSkillRoot, ".naimage-connection.json"), `\uFEFF${JSON.stringify({
    version: 1,
    endpointPath,
    executablePath: "",
    installedBy: "aidebug-graph-cli",
    installedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  const source = fileEvidence(sourceCliPath);
  const installed = fileEvidence(installedCliPath);
  if (source.sha256 !== installed.sha256) throw new Error("Temporary naimage CLI copy does not match the product CLI.");
  return { source, installed };
}

async function waitForEndpointFile(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(endpointPath)) return;
    await delay(100);
  }
  throw new Error(`naimage automation endpoint file did not appear: ${endpointPath}`);
}

async function invokeCli(command, args = {}, { expectFailure = false, timeoutSeconds = 90 } = {}) {
  const startedAt = new Date().toISOString();
  const safeArgs = JSON.parse(JSON.stringify(args));
  appendJsonLine(cliTracePath, { event: "start", at: startedAt, command, args: safeArgs });
  const execution = await runProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", installedCliPath,
    command,
    "-ArgsJson", JSON.stringify(args),
    "-TimeoutSeconds", String(timeoutSeconds)
  ], { timeoutMs: (timeoutSeconds + 15) * 1000 });
  let payload = null;
  let parseError = "";
  try {
    payload = parseCliJson(execution.stdout);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const failed = execution.status !== 0 || payload?.ok !== true;
  const verdictOk = expectFailure ? failed && payload?.ok === false : !failed;
  const trace = {
    event: "complete",
    at: new Date().toISOString(),
    command,
    args: safeArgs,
    expected: expectFailure ? "failure" : "success",
    ok: verdictOk,
    status: execution.status,
    payloadOk: payload?.ok === true,
    parseError,
    error: String(payload?.error || execution.error || ""),
    stderrLength: execution.stderr.length,
    stdoutLength: execution.stdout.length
  };
  appendJsonLine(cliTracePath, trace);
  if (!verdictOk) {
    throw new Error(`${command} ${expectFailure ? "did not reject" : "failed"}: ${trace.error || parseError || `exit ${execution.status}`}`);
  }
  return { command, args: safeArgs, execution, payload, result: payload?.result, trace };
}

function stateFrom(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.nodes)) return value;
  if (value.state && typeof value.state === "object") return stateFrom(value.state);
  if (value.result && typeof value.result === "object") return stateFrom(value.result);
  return null;
}

async function readCanvasState() {
  const call = await invokeCli("canvas.state", {}, { timeoutSeconds: 45 });
  const state = stateFrom(call.result);
  if (!state) throw new Error("canvas.state did not return a node-bearing state object.");
  return state;
}

function projectIdOf(state) {
  return String(state?.activeProjectId || state?.projectId || "").trim();
}

function canvasRevisionOf(state) {
  const revision = Number(state?.canvasRevision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("canvas.state is missing a valid canvasRevision.");
  return revision;
}

function mutationGuard(state) {
  const expectedProjectId = projectIdOf(state);
  if (!expectedProjectId) throw new Error("canvas.state is missing activeProjectId.");
  return { expectedProjectId, expectedCanvasRevision: canvasRevisionOf(state) };
}

function nodesOf(state) {
  return Array.isArray(state?.nodes) ? state.nodes : [];
}

function nodeOf(state, nodeId) {
  return nodesOf(state).find((node) => String(node?.id || "") === String(nodeId || "")) || null;
}

function containerKind(node) {
  return String(
    node?.container?.kind || node?.imageContainer?.kind || node?.containerKind || node?.imageContainerKind || ""
  );
}

function containerMembers(node) {
  const source = node?.container || node?.imageContainer || {};
  const values = [
    ...(Array.isArray(source.memberNodeIds) ? source.memberNodeIds : []),
    ...(Array.isArray(source.childContainerNodeIds) ? source.childContainerNodeIds : []),
    ...(Array.isArray(source.layoutGroup?.memberNodeIds) ? source.layoutGroup.memberNodeIds : []),
    ...(Array.isArray(source.members) ? source.members : []),
    ...(Array.isArray(node?.containerMemberNodeIds) ? node.containerMemberNodeIds : [])
  ];
  return [...new Set(values.map(String).filter(Boolean))];
}

function relationRows(state) {
  const rows = [];
  const append = (candidate, fallbackTarget = "") => {
    if (!candidate || typeof candidate !== "object") return;
    const sourceId = String(candidate.sourceId || candidate.parentId || candidate.from || "");
    const targetId = String(candidate.targetId || candidate.nodeId || candidate.to || fallbackTarget || "");
    if (!sourceId || !targetId) return;
    rows.push({
      sourceId,
      targetId,
      relationType: String(candidate.relationType || candidate.type || ""),
      inputRole: String(candidate.inputRole || candidate.role || "")
    });
  };
  for (const candidate of [...(state?.edges || []), ...(state?.relations || [])]) append(candidate);
  for (const node of nodesOf(state)) {
    if (node?.relation) append(node.relation, node.id);
    if (Array.isArray(node?.relations)) node.relations.forEach((relation) => append(relation, node.id));
    if (node?.parentId) append({ sourceId: node.parentId, targetId: node.id, relationType: node.relationType });
    const bindings = Array.isArray(node?.requirement?.inputBindings) ? node.requirement.inputBindings : [];
    bindings.forEach((binding) => append({ sourceId: binding.nodeId, targetId: node.id, relationType: "requirement-input", inputRole: binding.role }));
  }
  const unique = new Map();
  rows.forEach((row) => unique.set(`${row.sourceId}\u0000${row.targetId}\u0000${row.relationType}\u0000${row.inputRole}`, row));
  return [...unique.values()];
}

function relationPresent(state, sourceId, targetId) {
  return relationRows(state).some((row) => row.sourceId === sourceId && row.targetId === targetId);
}

function requirementRevision(node) {
  const revision = Number(node?.requirement?.revision ?? node?.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new Error(`Requirement ${node?.id || ""} is missing a valid revision.`);
  return revision;
}

function requirementBindings(node) {
  const values = node?.requirement?.inputBindings || node?.inputBindings || [];
  return Array.isArray(values) ? values.map((binding) => ({ nodeId: String(binding?.nodeId || ""), role: String(binding?.role || "") })) : [];
}

function requirementRunCount(node) {
  return Math.max(0, Number(node?.requirement?.lastRunCount ?? node?.activity?.runCount ?? node?.requirement?.activity?.runCount ?? 0) || 0);
}

function requirementActivity(node) {
  return String(node?.activity?.status || node?.requirement?.activity?.status || node?.requirement?.status || "").toLowerCase();
}

function createFixturePng(index, width = 64, height = 48) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      png.data[offset] = (40 + index * 53 + x * 3) % 255;
      png.data[offset + 1] = (90 + index * 37 + y * 5) % 255;
      png.data[offset + 2] = (160 + index * 29 + (x + y) * 2) % 255;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function pngMetrics(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    const colors = new Set();
    let opaque = 0;
    let sampled = 0;
    const strideX = Math.max(1, Math.floor(png.width / 32));
    const strideY = Math.max(1, Math.floor(png.height / 24));
    for (let y = 0; y < png.height; y += strideY) {
      for (let x = 0; x < png.width; x += strideX) {
        const offset = (y * png.width + x) * 4;
        colors.add(`${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]},${png.data[offset + 3]}`);
        if (png.data[offset + 3] >= 240) opaque += 1;
        sampled += 1;
      }
    }
    return {
      ok: png.width >= 320 && png.height >= 240 && colors.size >= 8 && opaque / Math.max(1, sampled) >= 0.9,
      width: png.width,
      height: png.height,
      uniqueSampleColors: colors.size,
      opaqueRatio: opaque / Math.max(1, sampled),
      sampled
    };
  } catch (error) {
    return { ok: false, width: 0, height: 0, uniqueSampleColors: 0, opaqueRatio: 0, sampled: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function rendererSnapshot(client) {
  return evaluate(client, `(() => {
    const debug = window.__naimageDebugAgentState?.() || {};
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const visibleRatio = (box) => {
      if (!box || box.width <= 0 || box.height <= 0) return 0;
      const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
      const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
      return width * height / Math.max(1, box.width * box.height);
    };
    const nodeLayouts = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).map((element) => {
      const box = rect(element);
      return {
        id: element.dataset.nodeId || '',
        type: element.classList.contains('requirement-node') ? 'requirement' : element.classList.contains('image') ? 'image' : '',
        selected: element.classList.contains('selected'),
        containerKind: element.dataset.imageContainerKind || '',
        text: String(element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
        geometry: box,
        visibleRatio: visibleRatio(box)
      };
    });
    const edges = Array.from(document.querySelectorAll('.edge-layer .edge.provenance')).map((element) => ({
      sourceId: element.dataset.sourceId || '',
      targetId: element.dataset.targetId || '',
      className: element.getAttribute('class') || '',
      path: element.getAttribute('d') || ''
    }));
    const selectedNodeIds = nodeLayouts.filter((node) => node.selected).map((node) => node.id);
    const horizontalOverflowElements = ['.ide-shell', '.workflow-canvas', '.project-agent-panel']
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => {
        if (element.scrollWidth <= element.clientWidth + 2) return false;
        const overflowX = getComputedStyle(element).overflowX;
        return overflowX !== 'hidden' && overflowX !== 'clip';
      })
      .map((element) => element.className || element.tagName);
    return {
      readyState: document.readyState,
      title: document.title,
      viewport: {
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        devicePixelRatio,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight
      },
      overflow: {
        documentX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        documentY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        bodyX: document.body.scrollWidth > document.body.clientWidth,
        bodyY: document.body.scrollHeight > document.body.clientHeight,
        horizontalOverflowElements
      },
      canvasVisible: Boolean(document.querySelector('.workflow-canvas')),
      canvasScale: Number(debug?.viewport?.scale || 1),
      selectedNodeIds,
      nodeLayouts,
      edges,
      groups: nodeLayouts.filter((node) => node.containerKind === 'container-group').map((node) => node.id),
      requirementIds: nodeLayouts.filter((node) => node.type === 'requirement').map((node) => node.id),
      agentStatus: String(debug.agentStatus || ''),
      debugNodes: (debug.nodes || []).map((node) => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId || '',
        relationType: node.relationType || '',
        title: node.title || '',
        containerKind: node.imageContainer?.kind || node.container?.kind || '',
        requirementRevision: Number(node.requirement?.revision || 0),
        requirementRunCount: Number(node.requirement?.lastRunCount || 0),
        requirementActivity: String(node.activity?.status || node.requirement?.activity?.status || '')
      }))
    };
  })()`);
}

function stateSignature(state, dom) {
  return JSON.stringify({
    revision: Number(state?.canvasRevision ?? -1),
    selection: {
      primaryId: String(state?.selection?.primaryId || ""),
      ids: [...(state?.selection?.ids || [])].map(String).sort()
    },
    nodes: nodesOf(state).map((node) => ({
      id: String(node?.id || ""),
      type: String(node?.type || ""),
      parentId: String(node?.parentId || node?.relation?.parentId || ""),
      relationType: String(node?.relationType || node?.relation?.relationType || ""),
      containerKind: containerKind(node),
      members: containerMembers(node).sort(),
      requirementRevision: Number(node?.requirement?.revision || 0),
      runCount: requirementRunCount(node),
      activity: requirementActivity(node)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    edges: relationRows(state).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    dom: {
      selected: [...(dom?.selectedNodeIds || [])].sort(),
      groups: [...(dom?.groups || [])].sort(),
      requirements: [...(dom?.requirementIds || [])].sort(),
      edges: [...(dom?.edges || [])].map((edge) => `${edge.sourceId}>${edge.targetId}:${edge.className}`).sort()
    }
  });
}

function includesAll(values, expected) {
  const available = new Set((Array.isArray(values) ? values : []).map(String));
  return expected.every((value) => available.has(String(value)));
}

function sceneChecks(state, dom, expected) {
  const checks = [];
  const add = (key, ok, expectedValue, actual) => checks.push({ key, ok: Boolean(ok), expected: expectedValue, actual });
  add("canvas-visible", dom?.canvasVisible === true, true, dom?.canvasVisible);
  add("document-horizontal-overflow", dom?.overflow?.documentX !== true && dom?.overflow?.bodyX !== true, false, dom?.overflow);
  const requiredVisible = (expected.visibleNodeIds || []).map((id) => dom?.nodeLayouts?.find((node) => node.id === id));
  add("required-nodes-visible", requiredVisible.every((node) => node && node.visibleRatio >= 0.85), expected.visibleNodeIds || [], requiredVisible);
  if (expected.selectedNodeIds) {
    add("selection", includesAll(state?.selection?.ids, expected.selectedNodeIds) && includesAll(dom?.selectedNodeIds, expected.selectedNodeIds), expected.selectedNodeIds, {
      cli: state?.selection,
      dom: dom?.selectedNodeIds
    });
  }
  if (expected.groupHostId) {
    const host = nodeOf(state, expected.groupHostId);
    const domGroup = dom?.groups?.includes(expected.groupHostId);
    add("container-group-present", containerKind(host) === "container-group" && domGroup, expected.groupHostId, {
      kind: containerKind(host),
      members: containerMembers(host),
      domGroups: dom?.groups
    });
    if (expected.groupMemberIds) add("container-group-members", includesAll(containerMembers(host), expected.groupMemberIds), expected.groupMemberIds, containerMembers(host));
  }
  if (expected.groupAbsentId) {
    const host = nodeOf(state, expected.groupAbsentId);
    add("container-group-absent", containerKind(host) !== "container-group" && !dom?.groups?.includes(expected.groupAbsentId), true, {
      kind: containerKind(host),
      domGroups: dom?.groups
    });
  }
  if (expected.edgePresent) {
    const { sourceId, targetId } = expected.edgePresent;
    const domEdge = dom?.edges?.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
    add("edge-present", relationPresent(state, sourceId, targetId) && domEdge, expected.edgePresent, { relations: relationRows(state), domEdges: dom?.edges });
  }
  if (expected.edgeAbsent) {
    const { sourceId, targetId } = expected.edgeAbsent;
    const domEdge = dom?.edges?.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
    add("edge-absent", !relationPresent(state, sourceId, targetId) && !domEdge, expected.edgeAbsent, { relations: relationRows(state), domEdges: dom?.edges });
  }
  if (expected.requirement) {
    const requirement = nodeOf(state, expected.requirement.id);
    const bindings = requirementBindings(requirement);
    add("requirement-present", requirement?.type === "requirement" && dom?.requirementIds?.includes(expected.requirement.id), expected.requirement.id, requirement);
    if (expected.requirement.minimumRevision) add("requirement-revision", Number(requirement?.requirement?.revision || 0) >= expected.requirement.minimumRevision, expected.requirement.minimumRevision, requirement?.requirement?.revision);
    if (expected.requirement.titleIncludes) add("requirement-title", String(requirement?.title || requirement?.requirement?.title || "").includes(expected.requirement.titleIncludes), expected.requirement.titleIncludes, requirement?.title || requirement?.requirement?.title);
    if (expected.requirement.bindingNodeIds) add("requirement-bindings", includesAll(bindings.map((binding) => binding.nodeId), expected.requirement.bindingNodeIds), expected.requirement.bindingNodeIds, bindings);
    if (expected.requirement.minimumRunCount) add("requirement-run-count", requirementRunCount(requirement) >= expected.requirement.minimumRunCount, expected.requirement.minimumRunCount, requirementRunCount(requirement));
  }
  if (expected.minimumNodeCount) add("minimum-node-count", nodesOf(state).length >= expected.minimumNodeCount, expected.minimumNodeCount, nodesOf(state).length);
  return checks;
}

async function captureScene(client, label, viewport, expected) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height
  });
  await invokeCli("canvas.fit", {}, { timeoutSeconds: 45 });
  await delay(240);

  let frameA = null;
  let frameB = null;
  let domA = null;
  let domB = null;
  let stateA = null;
  let stateB = null;
  let stable = false;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    domA = await rendererSnapshot(client);
    stateA = await readCanvasState();
    frameA = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12_000);
    await delay(260);
    domB = await rendererSnapshot(client);
    stateB = await readCanvasState();
    frameB = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12_000);
    stable = stateSignature(stateA, domA) === stateSignature(stateB, domB);
    if (stable) break;
    await delay(300);
  }

  const firstFramePath = join(runDir, `${label}-frame-a.png`);
  const screenshotPath = join(runDir, `${label}.png`);
  writeFileSync(firstFramePath, frameA);
  writeFileSync(screenshotPath, frameB);
  const firstMetrics = pngMetrics(frameA);
  const finalMetrics = pngMetrics(frameB);
  const screenshotEvidence = {
    source: "cdp-dual-frame",
    path: screenshotPath,
    firstFramePath,
    width: finalMetrics.width,
    height: finalMetrics.height,
    byteLength: frameB.length,
    sha256: sha256Bytes(frameB),
    firstFrameSha256: sha256Bytes(frameA),
    finalFrameSha256: sha256Bytes(frameB)
  };
  const checks = sceneChecks(stateB, domB, expected);
  const stateIssues = checks.filter((check) => !check.ok).map(({ key, expected: expectedValue, actual }) => ({ key, expected: expectedValue, actual }));
  const captureIssues = [];
  if (!stable) captureIssues.push({ key: "state-stability", expected: true, actual: false });
  if (!firstMetrics.ok) captureIssues.push({ key: "first-frame-pixels", expected: true, actual: firstMetrics });
  if (!finalMetrics.ok) captureIssues.push({ key: "final-frame-pixels", expected: true, actual: finalMetrics });
  if (finalMetrics.width !== viewport.width || finalMetrics.height !== viewport.height) {
    captureIssues.push({ key: "screenshot-dimensions", expected: viewport, actual: { width: finalMetrics.width, height: finalMetrics.height } });
  }
  const elementOverflowX = Array.isArray(domB?.overflow?.horizontalOverflowElements) ? domB.overflow.horizontalOverflowElements : [];
  const overflow = {
    documentOverflowX: Boolean(domB?.overflow?.documentX),
    bodyOverflowX: Boolean(domB?.overflow?.bodyX),
    elementOverflowX
  };
  const functionalOk = stateIssues.length === 0;
  const stateOk = stable;
  const visualOk = firstMetrics.ok && finalMetrics.ok && !overflow.documentOverflowX && !overflow.bodyOverflowX && elementOverflowX.length === 0;
  const evidenceOk = screenshotEvidence.source === "cdp-dual-frame" && screenshotEvidence.byteLength > 4096 && finalMetrics.width === viewport.width && finalMetrics.height === viewport.height;
  const visualReliability = {
    ok: functionalOk && stateOk && visualOk && evidenceOk,
    status: functionalOk && stateOk && visualOk && evidenceOk ? "verified" : "failed",
    functionalOk,
    stateOk,
    visualOk,
    evidenceOk,
    failureReasons: [
      ...(functionalOk ? [] : ["state-assertion-failed"]),
      ...(stateOk ? [] : ["state-unstable-between-frames"]),
      ...(visualOk ? [] : ["visual-or-overflow-check-failed"]),
      ...(evidenceOk ? [] : ["screenshot-evidence-invalid"])
    ]
  };
  const renderer = domB.viewport;
  const comparisonOk = finalMetrics.width === renderer.innerWidth && finalMetrics.height === renderer.innerHeight;
  const captureEnvironment = {
    schemaVersion: 2,
    request: {
      status: "requested",
      application: { status: "applied", method: "Emulation.setDeviceMetricsOverride" },
      verifiedBy: "renderer-inner"
    },
    requestedWindow: { width: viewport.width, height: viewport.height },
    browserWindow: {
      status: "unavailable",
      error: "This standalone suite records the renderer CSS viewport; BrowserWindow bounds are not queried."
    },
    actualWindow: null,
    renderer,
    screenshot: { width: finalMetrics.width, height: finalMetrics.height, byteLength: frameB.length },
    canvas: { scale: Number(domB.canvasScale || 1), percent: Math.round(Number(domB.canvasScale || 1) * 100) },
    comparisons: {
      screenshotToRenderer: {
        expectedScale: "css-pixel",
        withinTolerance: comparisonOk,
        widthDelta: finalMetrics.width - renderer.innerWidth,
        heightDelta: finalMetrics.height - renderer.innerHeight
      }
    },
    evidenceQuality: {
      ok: comparisonOk,
      status: "partial",
      missing: ["browser-window-bounds"]
    }
  };
  return {
    label,
    screenshotPath,
    firstFramePath,
    screenshotSource: "cdp-dual-frame",
    screenshotEvidence,
    dualFrameReport: {
      ok: firstMetrics.ok && finalMetrics.ok && stable,
      stable,
      firstSha256: screenshotEvidence.firstFrameSha256,
      secondSha256: screenshotEvidence.finalFrameSha256,
      identicalPixels: screenshotEvidence.firstFrameSha256 === screenshotEvidence.finalFrameSha256
    },
    stateStabilityReport: {
      ok: stable,
      stable,
      firstSignatureSha256: sha256Bytes(stateSignature(stateA, domA)),
      secondSignatureSha256: sha256Bytes(stateSignature(stateB, domB))
    },
    screenshotFrameReport: { ok: firstMetrics.ok && finalMetrics.ok, first: firstMetrics, final: finalMetrics },
    screenshotSurfaceReport: { ok: domB.canvasVisible === true && !overflow.documentOverflowX && !overflow.bodyOverflowX },
    captureEnvironment,
    visualReliability,
    visualPolicy: "overview",
    state: {
      canvasVisible: domB.canvasVisible,
      canvasZoomPercent: Math.round(Number(domB.canvasScale || 1) * 100),
      selectedNodeId: String(stateB?.selection?.primaryId || ""),
      selectedNodeIds: Array.isArray(stateB?.selection?.ids) ? stateB.selection.ids : [],
      nodeLayouts: domB.nodeLayouts,
      domEdges: domB.edges,
      cliRelations: relationRows(stateB),
      cliState: stateB,
      checks
    },
    stateIssues,
    captureIssues,
    overflow
  };
}

async function waitForRequirementExecution(requirementId, beforeNodeIds, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readCanvasState();
    const requirement = nodeOf(latest, requirementId);
    const output = nodesOf(latest).find((node) => !beforeNodeIds.has(String(node?.id || "")) && (
      String(node?.parentId || "") === requirementId ||
      String(node?.relation?.sourceId || node?.relation?.parentId || "") === requirementId
    ));
    const activity = requirementActivity(requirement);
    const settled = !["thinking", "editing", "running", "pending"].includes(String(latest?.agentStatus || activity).toLowerCase());
    if (settled && (output || requirementRunCount(requirement) >= 1 || ["done", "complete", "completed", "idle", "success"].includes(activity))) {
      return { ok: true, state: latest, output: output || null, requirement, activity };
    }
    await delay(450);
  }
  return { ok: false, state: latest, output: null, requirement: nodeOf(latest, requirementId), activity: requirementActivity(nodeOf(latest, requirementId)) };
}

async function waitForRenderedImageOutput(client, beforeNodeIds, timeoutMs = 20_000) {
  const excludedIds = JSON.stringify([...beforeNodeIds].map(String));
  const expression = `(() => {
    const excluded = new Set(${excludedIds});
    return Array.from(document.querySelectorAll('.flow-node.image[data-node-id]')).some((node) => {
      if (excluded.has(node.dataset.nodeId || '')) return false;
      const images = Array.from(node.querySelectorAll('img'));
      return images.length > 0 && images.every((image) => image.complete && image.naturalWidth >= 2 && image.naturalHeight >= 2);
    });
  })()`;
  await waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs: 180 });
  return String(await evaluate(client, `(() => {
    const excluded = new Set(${excludedIds});
    const node = Array.from(document.querySelectorAll('.flow-node.image[data-node-id]')).find((candidate) => {
      if (excluded.has(candidate.dataset.nodeId || '')) return false;
      const images = Array.from(candidate.querySelectorAll('img'));
      return images.length > 0 && images.every((image) => image.complete && image.naturalWidth >= 2 && image.naturalHeight >= 2);
    });
    return node?.dataset.nodeId || '';
  })()`));
}

async function importFixture(filePath, x, y) {
  const before = await readCanvasState();
  const beforeIds = new Set(nodesOf(before).map((node) => String(node.id)));
  const call = await invokeCli("canvas.import", { paths: [filePath], x, y }, { timeoutSeconds: 90 });
  const after = stateFrom(call.result) || await readCanvasState();
  const created = nodesOf(after).find((node) => !beforeIds.has(String(node?.id || "")) && node?.type === "image");
  if (!created) throw new Error(`canvas.import did not create an image node for ${filePath}.`);
  return { call, before, after, node: created };
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    await forceKillProcessTree(child.pid, { isWindows: true });
    await waitForChildExit(child, 1800);
    return;
  }
  try {
    child.kill();
  } catch {
    // The process may have already exited.
  }
  if (!await waitForChildExit(child, 1800)) await forceKillProcessTree(child.pid, { isWindows: false });
}

function spawnVite(port) {
  if (!existsSync(viteCli)) throw new Error(`Vite CLI is missing: ${viteCli}`);
  return spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
}

function spawnElectron(devUrl, debugPort) {
  if (!existsSync(electronCli)) throw new Error(`Electron CLI is missing: ${electronCli}`);
  return spawn(process.execPath, [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: "1",
      NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
      NAIMAGE_AIDEBUG_REAL_AGENT: "0",
      NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
      NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
      NAIMAGE_CONFIG_DIR: configDir,
      NAIMAGE_ELECTRON_LOG: electronLogPath
    }
  });
}

async function runVisualReview(reportPath) {
  mkdirSync(reviewRoot, { recursive: true });
  const result = await runProcess(process.execPath, [
    visualReviewCli,
    "--input", reportPath,
    "--output-dir", reviewDir,
    "--columns", "3",
    "--tile-width", "520",
    "--max-images", "100"
  ], { timeoutMs: 120_000 });
  if (result.status !== 0) throw new Error(`visual-review failed: ${result.stderr || result.stdout || result.error}`);
  const payload = parseCliJson(result.stdout);
  if (payload?.ok !== true || !payload?.reportPath || !payload?.montagePath) throw new Error("visual-review did not return review and montage paths.");
  return payload;
}

function createFallbackPng() {
  return createFixturePng(99, 2, 2);
}

function workpackBinding() {
  const workpackId = String(process.env.NAIMAGE_AIDEBUG_WORKPACK_ID || "").trim();
  if (!workpackId) return null;
  return {
    workpackId,
    agentId: String(process.env.NAIMAGE_AIDEBUG_WORKPACK_AGENT_ID || process.env.NAIMAGE_AIDEBUG_AGENT_ID || "").trim(),
    claimToken: String(process.env.NAIMAGE_AIDEBUG_WORKPACK_CLAIM || "").trim(),
    taskId: String(process.env.NAIMAGE_AIDEBUG_TASK_ID || "").trim()
  };
}

async function runHarnessSelfTest() {
  const synthetic = {
    activeProjectId: "default",
    canvasRevision: 8,
    selection: { primaryId: "A", ids: ["A", "B"] },
    nodes: [
      { id: "A", type: "image", container: { kind: "container-group", memberNodeIds: ["A", "B"] } },
      { id: "B", type: "image" },
      { id: "C", type: "image", parentId: "A", relationType: "referenced" },
      { id: "R", type: "requirement", title: "Updated", requirement: { revision: 2, lastRunCount: 1, inputBindings: [{ nodeId: "A", role: "source" }] } }
    ]
  };
  const parsed = parseCliJson("informational line\n{\"ok\":true,\"result\":{\"value\":1}}\n");
  const parsedPretty = parseCliJson(JSON.stringify({ ok: true, reportPath: "report.json", montagePath: "montage.png" }, null, 2));
  const png = pngMetrics(createFixturePng(3, 320, 240));
  const assertions = {
    parsed: parsed?.ok === true && parsed?.result?.value === 1,
    parsedPretty: parsedPretty?.ok === true && parsedPretty?.montagePath === "montage.png",
    schemaCommandListUnique: new Set(REQUIRED_COMMANDS).size === REQUIRED_COMMANDS.length,
    projectGuard: JSON.stringify(mutationGuard(synthetic)) === JSON.stringify({ expectedProjectId: "default", expectedCanvasRevision: 8 }),
    groupIdentity: containerKind(nodeOf(synthetic, "A")) === "container-group" && includesAll(containerMembers(nodeOf(synthetic, "A")), ["A", "B"]),
    relationExtraction: relationPresent(synthetic, "A", "C"),
    requirementIdentity: requirementRevision(nodeOf(synthetic, "R")) === 2 && requirementRunCount(nodeOf(synthetic, "R")) === 1,
    pngEvidence: png.ok
  };
  const ok = Object.values(assertions).every(Boolean);
  process.stdout.write(`${JSON.stringify({ ok, mode: "graph-cli-harness-selftest", assertions, png }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  if (selfTestOnly) {
    await runHarnessSelfTest();
    return;
  }

  mkdirSync(runDir, { recursive: true });
  prepareProjectFixture();
  recordObservation("info", "suite-checkpoint", { label: "bootstrap:prepare-run", runDir, mode: "graph-cli-suite" });
  const schema = readCommandSchema();
  if (schema.missing.length) throw new Error(`Graph CLI commands are not registered yet: ${schema.missing.join(", ")}`);
  const cliInstall = prepareCliInstall();
  recordObservation("info", "graph-cli-contract-ready", {
    schema: schema.evidence,
    cliSource: cliInstall.source,
    cliCopyMatches: cliInstall.source.sha256 === cliInstall.installed.sha256
  });

  const fixtureDir = join(runDir, "fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePaths = [1, 2, 3].map((index) => {
    const path = join(fixtureDir, `graph-source-${index}.png`);
    writeFileSync(path, createFixturePng(index));
    return path;
  });

  let viteProcess = null;
  let electronProcess = null;
  let client = null;
  let reportResult = null;
  const results = [];
  const steps = [];
  const addStep = (label, ok, detail = {}) => {
    const step = { label, ok: Boolean(ok), ...detail };
    steps.push(step);
    recordObservation(ok ? "info" : "issue", `graph-cli:${label}`, detail);
    return step;
  };
  const reporting = createAidebugReporting({
    runDir,
    desktopLogPath,
    observations,
    mockAgent: true,
    cycleIndex: 1,
    cycleTotal: 1,
    fallbackPng: createFallbackPng(),
    recordObservation
  });

  try {
    const devPort = await allocateDebugPort();
    let debugPort = await allocateDebugPort();
    while (debugPort === devPort) debugPort = await allocateDebugPort();
    const devUrl = `http://127.0.0.1:${devPort}`;
    viteProcess = spawnVite(devPort);
    pipeProcessLogs(viteProcess, "vite");
    await waitForHttpServer(devUrl, { attempts: 100, intervalMs: 250, errorMessage: `Vite did not respond: ${devUrl}` });
    electronProcess = spawnElectron(devUrl, debugPort);
    pipeProcessLogs(electronProcess, "electron");
    const target = await pollForDebugTarget({
      port: debugPort,
      attempts: 120,
      intervalMs: 250,
      findTarget: (targets) => targets.find((item) => item.type === "page" && (String(item.url || "").startsWith(devUrl) || /naimage/i.test(String(item.title || "")))),
      notFoundMessage: `No naimage Renderer target appeared on ${debugPort}.`
    });
    client = new BasicCdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await waitForRuntimeExpression(client, "Boolean(document.querySelector('.ide-shell') && window.__naimageDebugAgentState)", { evaluate, timeoutMs: 20_000, intervalMs: 200 });
    await waitForRuntimeExpression(client, "Boolean(window.naimageAutomation)", { evaluate, timeoutMs: 10_000, intervalMs: 200 });
    addStep("electron-ready", true, { devPort, debugPort, targetId: target.id || "" });
    await waitForEndpointFile();

    const status = await invokeCli("status", {}, { timeoutSeconds: 45 });
    addStep("loopback-cli-ready", status.payload?.ok === true, { rendererReady: status.result?.rendererReady !== false });
    await invokeCli("canvas.clear", { mode: "all", confirmed: true }, { timeoutSeconds: 60 });

    const imports = [];
    imports.push(await importFixture(fixturePaths[0], 120, 160));
    imports.push(await importFixture(fixturePaths[1], 420, 180));
    imports.push(await importFixture(fixturePaths[2], 760, 260));
    const [firstId, secondId, thirdId] = imports.map((item) => String(item.node.id));
    addStep("fixture-import", new Set([firstId, secondId, thirdId]).size === 3, { nodeIds: [firstId, secondId, thirdId] });

    const selected = await invokeCli("canvas.select", { ids: [firstId, secondId], primaryId: firstId });
    const selectedState = stateFrom(selected.result) || await readCanvasState();
    addStep("multi-select", includesAll(selectedState?.selection?.ids, [firstId, secondId]), { selection: selectedState.selection });
    results.push(await captureScene(client, "graph-cli-multi-selected-1280", { width: 1280, height: 820 }, {
      selectedNodeIds: [firstId, secondId],
      visibleNodeIds: [firstId, secondId, thirdId],
      minimumNodeCount: 3
    }));

    const beforeGroup = await readCanvasState();
    const grouped = await invokeCli("canvas.group", {
      nodeIds: [firstId, secondId],
      primaryId: firstId,
      ...mutationGuard(beforeGroup)
    });
    const groupedState = stateFrom(grouped.result) || await readCanvasState();
    const hostNodeId = String(grouped.result?.hostNodeId || grouped.result?.containerId || grouped.result?.nodeId || firstId);
    const groupOk = grouped.result?.changed !== false && containerKind(nodeOf(groupedState, hostNodeId)) === "container-group" && includesAll(containerMembers(nodeOf(groupedState, hostNodeId)), [firstId, secondId]);
    addStep("group", groupOk, { hostNodeId, affectedNodeIds: grouped.result?.affectedNodeIds || [], canvasRevision: groupedState.canvasRevision });

    const revisionBeforeConnect = canvasRevisionOf(groupedState);
    const connected = await invokeCli("canvas.connect", {
      edges: [{ sourceId: hostNodeId, targetId: thirdId, relationType: "referenced" }],
      replaceExisting: false,
      ...mutationGuard(groupedState)
    });
    const connectedState = stateFrom(connected.result) || await readCanvasState();
    addStep("connect", connected.result?.changed !== false && relationPresent(connectedState, hostNodeId, thirdId), {
      affectedNodeIds: connected.result?.affectedNodeIds || [],
      relation: { sourceId: hostNodeId, targetId: thirdId },
      canvasRevision: connectedState.canvasRevision
    });

    const staleDisconnect = await invokeCli("canvas.disconnect", {
      edges: [{ sourceId: hostNodeId, targetId: thirdId }],
      expectedProjectId: projectIdOf(connectedState),
      expectedCanvasRevision: revisionBeforeConnect
    }, { expectFailure: true, timeoutSeconds: 45 });
    const afterStale = await readCanvasState();
    const staleOk = staleDisconnect.payload?.ok === false && canvasRevisionOf(afterStale) === canvasRevisionOf(connectedState) && relationPresent(afterStale, hostNodeId, thirdId);
    addStep("stale-revision-rejected", staleOk, {
      attemptedRevision: revisionBeforeConnect,
      currentRevision: canvasRevisionOf(afterStale),
      graphUnchanged: relationPresent(afterStale, hostNodeId, thirdId)
    });

    const currentDisconnect = await invokeCli("canvas.disconnect", {
      edges: [{ sourceId: hostNodeId, targetId: thirdId }],
      ...mutationGuard(afterStale)
    });
    const currentDisconnectedState = stateFrom(currentDisconnect.result) || await readCanvasState();
    const currentDisconnectOk = !relationPresent(currentDisconnectedState, hostNodeId, thirdId)
      && canvasRevisionOf(currentDisconnectedState) > canvasRevisionOf(afterStale);
    addStep("current-revision-disconnect", currentDisconnectOk, {
      previousRevision: canvasRevisionOf(afterStale),
      canvasRevision: canvasRevisionOf(currentDisconnectedState),
      graphDisconnected: !relationPresent(currentDisconnectedState, hostNodeId, thirdId)
    });

    const currentReconnect = await invokeCli("canvas.connect", {
      edges: [{ sourceId: hostNodeId, targetId: thirdId, relationType: "referenced" }],
      replaceExisting: false,
      ...mutationGuard(currentDisconnectedState)
    });
    const reconnectedState = stateFrom(currentReconnect.result) || await readCanvasState();
    const currentReconnectOk = relationPresent(reconnectedState, hostNodeId, thirdId)
      && canvasRevisionOf(reconnectedState) > canvasRevisionOf(currentDisconnectedState);
    addStep("receipt-revision-reconnect", currentReconnectOk, {
      previousRevision: canvasRevisionOf(currentDisconnectedState),
      canvasRevision: canvasRevisionOf(reconnectedState),
      graphConnected: relationPresent(reconnectedState, hostNodeId, thirdId)
    });

    const hostBeforeNudge = nodeOf(reconnectedState, hostNodeId);
    const nudged = await invokeCli("canvas.nudge", {
      nodeIds: [firstId],
      dx: -10_000,
      dy: -10_000,
      ...mutationGuard(reconnectedState)
    });
    const nudgedState = stateFrom(nudged.result) || await readCanvasState();
    await delay(240);
    const nudgeDom = await rendererSnapshot(client);
    const nudgedHost = nodeOf(nudgedState, hostNodeId);
    const nudgedHostLayout = nudgeDom.nodeLayouts.find((node) => node.id === hostNodeId);
    const unclampedX = Number(hostBeforeNudge?.x || 0) - 10_000;
    const unclampedY = Number(hostBeforeNudge?.y || 0) - 10_000;
    const nudgeOk = nudged.result?.changed !== false
      && Array.isArray(nudged.result?.nodeIds)
      && nudged.result.nodeIds.includes(hostNodeId)
      && Number(nudgedHost?.x) !== unclampedX
      && Number(nudgedHost?.y) !== unclampedY
      && Number(nudgedHostLayout?.visibleRatio || 0) >= 0.85;
    addStep("nudge-member-maps-to-visible-host-and-clamps", nudgeOk, {
      requestedNodeId: firstId,
      affectedNodeIds: nudged.result?.nodeIds || [],
      requestedPosition: { x: unclampedX, y: unclampedY },
      actualPosition: { x: nudgedHost?.x, y: nudgedHost?.y },
      hostVisibleRatio: nudgedHostLayout?.visibleRatio || 0,
      canvasRevision: canvasRevisionOf(nudgedState)
    });

    await invokeCli("canvas.select", { ids: [hostNodeId, thirdId], primaryId: hostNodeId });
    results.push(await captureScene(client, "graph-cli-group-connected-1280", { width: 1280, height: 820 }, {
      selectedNodeIds: [hostNodeId, thirdId],
      visibleNodeIds: [hostNodeId, thirdId],
      groupHostId: hostNodeId,
      groupMemberIds: [firstId, secondId],
      edgePresent: { sourceId: hostNodeId, targetId: thirdId },
      minimumNodeCount: 3
    }));

    const beforeCreate = await readCanvasState();
    const created = await invokeCli("canvas.create-requirement", {
      title: "CLI Graph Review",
      text: "Use image_gen once to create a restrained product-image review variant while preserving product identity. AIDEBUG_GRAPH_CLI_V1",
      inputBindings: [
        { nodeId: hostNodeId, role: "source" },
        { nodeId: thirdId, role: "reference" }
      ],
      x: 720,
      y: 460,
      ...mutationGuard(beforeCreate)
    }, { timeoutSeconds: 60 });
    const createdState = stateFrom(created.result) || await readCanvasState();
    const requirementId = String(created.result?.nodeId || created.result?.id || "");
    if (!requirementId || nodeOf(createdState, requirementId)?.type !== "requirement") throw new Error("canvas.create-requirement did not return a Requirement nodeId.");
    addStep("create-requirement", created.result?.changed !== false, { requirementId, affectedNodeIds: created.result?.affectedNodeIds || [] });

    const createdRequirement = nodeOf(createdState, requirementId);
    const updated = await invokeCli("canvas.update-requirement", {
      nodeId: requirementId,
      expectedRevision: requirementRevision(createdRequirement),
      patch: {
        title: "CLI Graph Review · Updated",
        text: "Use image_gen once to create one restrained commercial variant. Preserve geometry, labels, proportions, and identity; use the reference only for lighting. AIDEBUG_GRAPH_CLI_V2",
        inputBindings: [
          { nodeId: hostNodeId, role: "source" },
          { nodeId: thirdId, role: "reference" }
        ]
      },
      ...mutationGuard(createdState)
    }, { timeoutSeconds: 60 });
    const updatedState = stateFrom(updated.result) || await readCanvasState();
    const updatedRequirement = nodeOf(updatedState, requirementId);
    const updateOk = updated.result?.changed !== false && requirementRevision(updatedRequirement) > requirementRevision(createdRequirement) && String(updatedRequirement?.title || updatedRequirement?.requirement?.title || "").includes("Updated");
    addStep("update-requirement", updateOk, { requirementId, revision: updatedRequirement?.requirement?.revision, bindings: requirementBindings(updatedRequirement) });

    await invokeCli("canvas.select", { ids: [requirementId], primaryId: requirementId });
    results.push(await captureScene(client, "graph-cli-requirement-updated-1280", { width: 1280, height: 820 }, {
      selectedNodeIds: [requirementId],
      visibleNodeIds: [hostNodeId, thirdId, requirementId],
      groupHostId: hostNodeId,
      edgePresent: { sourceId: hostNodeId, targetId: thirdId },
      requirement: {
        id: requirementId,
        minimumRevision: requirementRevision(updatedRequirement),
        titleIncludes: "Updated",
        bindingNodeIds: [hostNodeId, thirdId]
      },
      minimumNodeCount: 4
    }));

    const beforeExecute = await readCanvasState();
    const executeRequirement = nodeOf(beforeExecute, requirementId);
    const beforeExecutionIds = new Set(nodesOf(beforeExecute).map((node) => String(node.id)));
    const executed = await invokeCli("canvas.execute-requirement", {
      nodeId: requirementId,
      expectedRevision: requirementRevision(executeRequirement),
      expectedProjectId: projectIdOf(beforeExecute)
    }, { timeoutSeconds: 90 });
    const execution = await waitForRequirementExecution(requirementId, beforeExecutionIds, 45_000);
    const executionOutputId = String(execution.output?.id || "");
    if (executionOutputId) await invokeCli("canvas.select", { ids: [requirementId, executionOutputId], primaryId: requirementId });
    const renderedOutputId = executionOutputId
      ? await waitForRenderedImageOutput(client, beforeExecutionIds, 20_000)
      : "";
    const executionOk = executed.result?.accepted !== false && execution.ok && Boolean(executionOutputId) && Boolean(renderedOutputId);
    addStep("execute-requirement", executionOk, {
      requirementId,
      accepted: executed.result?.accepted,
      outputNodeId: executionOutputId,
      renderedOutputId,
      runCount: requirementRunCount(execution.requirement),
      activity: execution.activity
    });
    if (!executionOk) throw new Error("Mock Requirement execution did not settle with visible completion evidence.");

    await invokeCli("canvas.select", { ids: [requirementId, renderedOutputId], primaryId: requirementId });
    results.push(await captureScene(client, "graph-cli-requirement-executed-1280", { width: 1280, height: 820 }, {
      selectedNodeIds: [requirementId, renderedOutputId],
      visibleNodeIds: [hostNodeId, thirdId, requirementId, renderedOutputId],
      groupHostId: hostNodeId,
      edgePresent: { sourceId: hostNodeId, targetId: thirdId },
      requirement: {
        id: requirementId,
        minimumRevision: requirementRevision(execution.requirement),
        bindingNodeIds: [hostNodeId, thirdId],
        minimumRunCount: 1
      },
      minimumNodeCount: 5
    }));

    const beforeDisconnect = await readCanvasState();
    const disconnected = await invokeCli("canvas.disconnect", {
      edges: [{ sourceId: hostNodeId, targetId: thirdId }],
      ...mutationGuard(beforeDisconnect)
    });
    const disconnectedState = stateFrom(disconnected.result) || await readCanvasState();
    addStep("disconnect", disconnected.result?.changed !== false && !relationPresent(disconnectedState, hostNodeId, thirdId), {
      affectedNodeIds: disconnected.result?.affectedNodeIds || [],
      relation: { sourceId: hostNodeId, targetId: thirdId }
    });

    const beforeDissolve = await readCanvasState();
    const dissolved = await invokeCli("canvas.dissolve", {
      containerIds: [hostNodeId],
      ...mutationGuard(beforeDissolve)
    });
    const finalState = stateFrom(dissolved.result) || await readCanvasState();
    const dissolveOk = dissolved.result?.changed !== false && containerKind(nodeOf(finalState, hostNodeId)) !== "container-group";
    addStep("dissolve", dissolveOk, { containerIds: [hostNodeId], affectedNodeIds: dissolved.result?.affectedNodeIds || [] });

    await invokeCli("canvas.select", { ids: [hostNodeId, thirdId, requirementId], primaryId: requirementId });
    const finalCapture = await captureScene(client, "graph-cli-disconnected-dissolved-min-900x640", { width: 900, height: 640 }, {
      selectedNodeIds: [hostNodeId, thirdId, requirementId],
      visibleNodeIds: [hostNodeId, secondId, thirdId, requirementId],
      groupAbsentId: hostNodeId,
      edgeAbsent: { sourceId: hostNodeId, targetId: thirdId },
      requirement: { id: requirementId, minimumRevision: requirementRevision(nodeOf(finalState, requirementId)) },
      minimumNodeCount: 5
    });
    results.push(finalCapture);

    const functionalOk = steps.every((step) => step.ok);
    const stateOk = results.every((capture) => capture.stateIssues.length === 0 && capture.stateStabilityReport.ok);
    const visualOk = results.every((capture) => capture.visualReliability.visualOk && capture.overflow.elementOverflowX.length === 0);
    const evidenceOk = results.every((capture) => capture.visualReliability.evidenceOk && capture.dualFrameReport.ok);
    const suite = {
      ok: functionalOk && stateOk && visualOk && evidenceOk,
      mode: "graph-cli-suite",
      cli: {
        executable: cliInstall.installed,
        source: cliInstall.source,
        exactProductCopy: cliInstall.source.sha256 === cliInstall.installed.sha256,
        transport: "authenticated-loopback-powershell",
        trace: fileEvidence(cliTracePath)
      },
      schema: schema.evidence,
      fixtureEvidence: fixturePaths.map((fixturePath, index) => {
        const evidence = fileEvidence(fixturePath);
        return {
          fixture: index + 1,
          byteLength: evidence.byteLength,
          sha256: evidence.sha256,
          source: "local-generated-png"
        };
      }),
      steps,
      qaInventory: {
        realLoopbackCli: steps.some((step) => step.label === "loopback-cli-ready" && step.ok),
        multiSelect: steps.some((step) => step.label === "multi-select" && step.ok),
        group: steps.some((step) => step.label === "group" && step.ok),
        connect: steps.some((step) => step.label === "connect" && step.ok),
        staleRevisionRejectedWithoutMutation: steps.some((step) => step.label === "stale-revision-rejected" && step.ok),
        currentRevisionDisconnect: steps.some((step) => step.label === "current-revision-disconnect" && step.ok),
        receiptRevisionReconnect: steps.some((step) => step.label === "receipt-revision-reconnect" && step.ok),
        nudgeMemberMappedToVisibleHostAndClamped: steps.some((step) => step.label === "nudge-member-maps-to-visible-host-and-clamps" && step.ok),
        requirementCreate: steps.some((step) => step.label === "create-requirement" && step.ok),
        requirementUpdate: steps.some((step) => step.label === "update-requirement" && step.ok),
        requirementExecuteWithMockAgent: steps.some((step) => step.label === "execute-requirement" && step.ok),
        disconnect: steps.some((step) => step.label === "disconnect" && step.ok),
        dissolve: steps.some((step) => step.label === "dissolve" && step.ok),
        minimumViewport: finalCapture.visualReliability.ok
      },
      gestureVerdict: { exercised: true, ok: functionalOk, input: "external PowerShell CLI" },
      evidenceVerdict: { functionalOk, stateOk, gestureOk: functionalOk, visualOk, evidenceOk },
      issues: []
    };
    if (!suite.ok) suite.issues.push({ area: "graph-cli", message: "One or more Graph CLI functional, state, visual, or evidence checks failed." });
    finalCapture.suite = suite;
    if (!suite.ok) finalCapture.stateIssues.push({ key: "graphCliSuite", expected: true, actual: suite.evidenceVerdict });

    reportResult = reporting.finishSuiteRun({
      results,
      reportMetadata: {
        mode: "graph-cli-suite",
        agentMode: "mock-agent",
        cliTransport: "authenticated-loopback-powershell",
        networkUsed: false,
        workpack: workpackBinding()
      },
      reportAfterObservations: { graphCliSuite: suite },
      consoleAfterSummary: { graphCli: suite.qaInventory }
    });
    if (!reportResult.ok) throw new Error("Graph CLI AIDEBUG report contains failed scenes.");

    const review = await runVisualReview(reportResult.reportPath);
    const completion = {
      ok: true,
      mode: "graph-cli-suite",
      runDir,
      reportPath: reportResult.reportPath,
      contactSheetPath: reportResult.contactSheetPath,
      summaryPath: reportResult.summaryPath,
      reviewPath: review.reportPath,
      montagePath: review.montagePath,
      sourceCount: review.sourceCount,
      reviewErrors: review.errors || []
    };
    writeFileSync(join(runDir, "completion.json"), `${JSON.stringify(completion, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(completion, null, 2)}\n`);
  } finally {
    client?.close();
    await stopChild(electronProcess);
    await stopChild(viteProcess);
    if (existsSync(endpointPath)) unlinkSync(endpointPath);
  }
}

main().catch((error) => {
  mkdirSync(runDir, { recursive: true });
  const failure = {
    ok: false,
    mode: selfTestOnly ? "graph-cli-harness-selftest" : "graph-cli-suite",
    at: new Date().toISOString(),
    runDir,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack || "" : ""
  };
  writeFileSync(join(runDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
});
