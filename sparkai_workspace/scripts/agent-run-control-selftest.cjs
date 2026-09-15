"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");
const { registerAgentIpc } = require("../desktop/ipc/agent-ipc.cjs");
const { normalizedTaskScope, normalizedSteerTaskScopeUpdate } = require("../agent-runtime.cjs");

(async () => {
  const { confirmAgentStopRequest } = await import("../src/agent-stop-request.ts");
  const snapshots = [];
  const control = createAgentRunControl({ onChange: (snapshot) => snapshots.push(snapshot) });
  assert.throws(
    () => control.begin({ runId: "missing-project", conversationId: "C1" }),
    (error) => error.code === "PROJECT_REQUIRED"
  );
  assert.throws(
    () => control.begin({ runId: "missing-conversation", projectId: "P" }),
    (error) => error.code === "CONVERSATION_REQUIRED"
  );
  const initialTaskScope = normalizedTaskScope({ taskScope: {
    version: 2,
    origin: "chat",
    canvasRevision: 1,
    sourceNodeIds: ["OLD-SOURCE"],
    sourceAssets: [{ assetId: "old-source", displayCode: "SRC1", name: "old.png", role: "source", nodeId: "OLD-SOURCE" }]
  } });
  const replacementTaskScope = normalizedTaskScope({ taskScope: {
    version: 2,
    origin: "chat",
    canvasRevision: 2,
    sourceNodeIds: ["N5"],
    sourceAssets: [{ assetId: "new-source", displayCode: "SRC2", name: "new.png", role: "source", nodeId: "N5" }]
  } });
  const normalizeScopeUpdate = (current, update) => normalizedSteerTaskScopeUpdate(current, update);
  const first = control.begin({ runId: "run-a", projectId: "P", conversationId: "C1", nodeIds: ["N1"], steerable: true, taskScope: initialTaskScope });
  control.begin({ runId: "run-b", projectId: "P", conversationId: "C1", nodeIds: ["N1", "N2"] });
  assert.throws(
    () => control.begin({ runId: "run-c", projectId: "P", conversationId: "C2", nodeIds: ["N1"] }),
    (error) => error.code === "NAIMAGE_NODE_LOCKED",
  );
  assert.doesNotThrow(() => control.begin({ runId: "run-d", projectId: "OTHER", conversationId: "C2", nodeIds: ["N1"] }));

  control.pause({ projectId: "P", conversationId: "C1" });
  assert.deepEqual(control.snapshot("P").pausedScopes, [{ projectId: "P", conversationId: "C1" }]);
  let released = false;
  const waiter = control.waitUntilRunnable(first, first.signal).then(() => { released = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(released, false);
  control.resume({ projectId: "P", conversationId: "C1" });
  await waiter;
  assert.equal(released, true);

  const steerPrompt = "Use a warm yellow background and replace the old composition.";
  const modelPhase = control.beginPhase(first, { kind: "model" });
  const steered = control.steer({
    runId: "run-a",
    projectId: "P",
    conversationId: "C1",
    prompt: steerPrompt,
    taskScopeUpdate: { sourceMode: "replace", referenceMode: "keep", taskScope: replacementTaskScope }
  }, normalizeScopeUpdate);
  assert.equal(steered.accepted, 1);
  assert.equal(steered.interrupted, 1);
  assert.equal(modelPhase.signal.aborted, true);
  assert.equal(modelPhase.signal.reason.code, "NAIMAGE_RUN_STEERED");
  assert.equal(first.signal.aborted, false, "Steer must not terminate the whole run");
  assert.equal(modelPhase.steered, true);
  const appliedSteers = control.consumeSteers(first);
  assert.deepEqual(appliedSteers.map((item) => item.prompt), [steerPrompt]);
  assert.equal(appliedSteers[0].taskScope.sourceAssets[0].assetId, "new-source");
  assert.notEqual(appliedSteers[0].taskScope.snapshotHash, initialTaskScope.snapshotHash);
  assert.equal(steered.taskScopeSnapshotHash, appliedSteers[0].taskScope.snapshotHash);
  assert.equal(control.snapshot("P").runs.find((run) => run.runId === "run-a").taskScopeSnapshotHash, appliedSteers[0].taskScope.snapshotHash);
  assert.equal(control.snapshot("P").lockedNodeIds.includes("N5"), true, "replacement SOURCE must become locked");
  assert.equal(control.snapshot("P").lockedNodeIds.includes("OLD-SOURCE"), false, "superseded SOURCE must be released");
  const oldSourceReuse = control.begin({ runId: "old-source-reuse", projectId: "P", conversationId: "C2", nodeIds: ["OLD-SOURCE"] });
  assert.ok(oldSourceReuse);
  assert.throws(
    () => control.begin({ runId: "new-source-conflict", projectId: "P", conversationId: "C2", nodeIds: ["N5"] }),
    (error) => error.code === "NAIMAGE_NODE_LOCKED"
  );
  control.finish({ runId: "old-source-reuse" });
  modelPhase.finish();
  const queued = control.steer({ runId: "run-a", prompt: "Keep the product unchanged." }, normalizeScopeUpdate);
  assert.equal(queued.accepted, 1);
  assert.equal(queued.interrupted, 0);
  assert.equal(control.snapshot("P").runs.find((run) => run.runId === "run-a").queuedSteerCount, 1);
  const queuedPhase = control.beginPhase(first, { kind: "model" });
  assert.equal(queuedPhase.steered, true, "a phase created after a queued steer must not start old work");
  assert.equal(queuedPhase.signal.reason.code, "NAIMAGE_RUN_STEERED");
  queuedPhase.finish();
  assert.equal(control.consumeSteers(first).length, 1);
  const oversized = control.steer({ runId: "run-a", prompt: "x".repeat(36_001) }, normalizeScopeUpdate);
  assert.equal(oversized.accepted, 0);
  assert.match(oversized.error, /36000/);
  const wrongScope = control.steer({ runId: "run-a", projectId: "OTHER", conversationId: "C1", prompt: "must not cross projects" }, normalizeScopeUpdate);
  assert.equal(wrongScope.accepted, 0, "runId lookup must still honor an explicitly supplied project scope");
  const collisionScope = normalizedTaskScope({ taskScope: {
    version: 2,
    origin: "chat",
    canvasRevision: 3,
    sourceNodeIds: ["N6"],
    sourceAssets: [{ assetId: "locked-source", displayCode: "SRC3", name: "locked.png", role: "source", nodeId: "N6" }]
  } });
  control.begin({ runId: "scope-lock", projectId: "P", conversationId: "C2", nodeIds: ["N6"] });
  assert.throws(
    () => control.steer({
      runId: "run-a",
      projectId: "P",
      conversationId: "C1",
      prompt: "replace with a source locked by another conversation",
      taskScopeUpdate: { sourceMode: "replace", referenceMode: "keep", taskScope: collisionScope }
    }, normalizeScopeUpdate),
    (error) => error.code === "NAIMAGE_NODE_LOCKED"
  );
  assert.equal(control.snapshot("P").runs.find((run) => run.runId === "run-a").taskScopeSnapshotHash, replacementTaskScope.snapshotHash);
  control.finish({ runId: "scope-lock" });

  const goalTaskScope = {
    version: 2,
    origin: "goal",
    scopeType: "container-group",
    canvasRevision: 9,
    sourceNodeIds: ["GOAL-SOURCE-A", "GOAL-SOURCE-B"],
    sourceContainerIds: ["GOAL-CONTAINER-A", "GOAL-CONTAINER-B"],
    referenceContainerIds: [],
    sourceBindingIds: ["binding:goal:a", "binding:goal:b"],
    referenceBindingIds: [],
    sourceAssets: [],
    referenceAssets: [],
    resultPolicy: "grouped-by-container",
    confirmationPolicy: "direct",
    goal: {
      version: 1,
      target: "all-image-containers",
      frozen: true,
      containerIds: ["GOAL-CONTAINER-A", "GOAL-CONTAINER-B"],
      bindingIds: ["binding:goal:a", "binding:goal:b"],
      containerCount: 2,
      bindingCount: 2,
      configuredConcurrency: 8,
      probeContainerCount: 2,
      operationsPerAsset: 1,
      requestCount: 2
    },
    snapshotHash: `scope-${"9".repeat(32)}`,
    sourceAssetCount: 2,
    referenceAssetCount: 0,
    truncated: false
  };
  const goalRun = control.begin({
    runId: "goal-run",
    projectId: "GOAL-P",
    conversationId: "GOAL-C1",
    nodeIds: ["GOAL-EXECUTION"],
    steerable: true,
    taskScope: goalTaskScope
  });
  const goalLocks = control.snapshot("GOAL-P").lockedNodeIds;
  for (const nodeId of ["GOAL-EXECUTION", ...goalTaskScope.sourceNodeIds, ...goalTaskScope.sourceContainerIds]) {
    assert.equal(goalLocks.includes(nodeId), true, `Frozen Goal node ${nodeId} must remain locked`);
    assert.throws(
      () => control.begin({ runId: `conflict-${nodeId}`, projectId: "GOAL-P", conversationId: "GOAL-C2", nodeIds: [nodeId] }),
      (error) => error.code === "NAIMAGE_NODE_LOCKED"
    );
  }
  let frozenNormalizerCalls = 0;
  const normalizeFrozenGoalUpdate = (current, update = {}) => {
    frozenNormalizerCalls += 1;
    const sourceMode = String(update?.sourceMode || "keep");
    const referenceMode = String(update?.referenceMode || "keep");
    if (
      current?.origin === "goal" &&
      (sourceMode !== "keep" || referenceMode !== "keep" || (update?.taskScope && update.taskScope !== current))
    ) {
      const error = new Error("Goal TaskScope is frozen; attachments require a newly confirmed Goal.");
      error.code = "NAIMAGE_GOAL_SCOPE_FROZEN";
      throw error;
    }
    return { sourceMode: "keep", referenceMode: "keep", taskScope: current };
  };
  const goalPhase = control.beginPhase(goalRun, { kind: "model" });
  for (const taskScopeUpdate of [
    { sourceMode: "merge", referenceMode: "keep", taskScope: replacementTaskScope },
    { sourceMode: "keep", referenceMode: "merge", taskScope: replacementTaskScope }
  ]) {
    assert.throws(
      () => control.steer({
        runId: "goal-run",
        projectId: "GOAL-P",
        conversationId: "GOAL-C1",
        prompt: "Attach another image while this Goal is running.",
        taskScopeUpdate
      }, normalizeFrozenGoalUpdate),
      (error) => error.code === "NAIMAGE_GOAL_SCOPE_FROZEN"
    );
  }
  assert.equal(frozenNormalizerCalls, 2, "Run control must delegate every attachment mutation to the authoritative normalizer");
  assert.equal(goalPhase.signal.aborted, false, "A rejected Goal mutation must not interrupt active work");
  assert.equal(control.consumeSteers(goalRun).length, 0, "A rejected Goal mutation must not enter the steer queue");
  assert.deepEqual(control.snapshot("GOAL-P").lockedNodeIds, goalLocks, "Rejected Goal mutations must not release or replace locks");
  assert.equal(control.snapshot("GOAL-P").runs[0].taskScopeSnapshotHash, goalTaskScope.snapshotHash);
  goalPhase.finish();
  assert.equal(control.finish({ runId: "goal-run" }), true);
  assert.deepEqual(control.snapshot("GOAL-P").lockedNodeIds, []);

  const sharedFirst = control.begin({ runId: "shared", projectId: "P", conversationId: "C1", nodeIds: ["N3"] });
  const sharedSecond = control.begin({ runId: "shared", projectId: "P", conversationId: "C1", nodeIds: ["N4"] });
  assert.equal(sharedFirst, sharedSecond);
  assert.deepEqual(control.snapshot("P").runs.find((run) => run.runId === "shared").nodeIds, ["N3", "N4"]);
  assert.equal(control.finish({ runId: "shared" }), false);
  assert.ok(control.snapshot("P").runs.some((run) => run.runId === "shared"));
  assert.equal(control.finish({ runId: "shared" }), true);
  assert.ok(!control.snapshot("P").runs.some((run) => run.runId === "shared"));

  const lifecycleControl = createAgentRunControl();
  const ownerAFirst = lifecycleControl.begin({
    runId: "owner-a-first",
    ownerId: "renderer-101",
    projectId: "LIFECYCLE-A",
    conversationId: "C1",
    nodeIds: ["OWNER-LOCKED-NODE"]
  });
  const ownerASecond = lifecycleControl.begin({
    runId: "owner-a-second",
    ownerId: "renderer-101",
    projectId: "LIFECYCLE-A",
    conversationId: "C2"
  });
  assert.throws(
    () => lifecycleControl.begin({
      runId: "owner-b-conflict",
      ownerId: "renderer-202",
      projectId: "LIFECYCLE-A",
      conversationId: "C1",
      nodeIds: ["OWNER-LOCKED-NODE"]
    }),
    (error) => error.code === "NAIMAGE_NODE_LOCKED"
  );
  const ownerB = lifecycleControl.begin({
    runId: "owner-b",
    ownerId: "renderer-202",
    projectId: "LIFECYCLE-A",
    conversationId: "C1"
  });
  assert.equal(lifecycleControl.isRunnable({ runId: ownerAFirst.runId, ownerId: "renderer-101" }), true);
  assert.equal(lifecycleControl.isRunnable({ runId: ownerAFirst.runId, ownerId: "renderer-202" }), false);
  assert.throws(
    () => lifecycleControl.begin({ runId: "owner-a-first", ownerId: "renderer-202", projectId: "LIFECYCLE-A", conversationId: "C1" }),
    (error) => error.code === "NAIMAGE_RUN_OWNER_CONFLICT"
  );
  lifecycleControl.pause({ runId: ownerAFirst.runId, ownerId: "renderer-101" });
  await lifecycleControl.waitUntilRunnable(ownerB, ownerB.signal);
  assert.deepEqual(lifecycleControl.snapshot("LIFECYCLE-A").pausedScopes, [{
    projectId: "LIFECYCLE-A",
    conversationId: "C1",
    ownerId: "renderer-101"
  }], "Pause state must remain isolated even when two Renderers share a project and conversation");
  const ownerAView = lifecycleControl.snapshot("LIFECYCLE-A", "renderer-101");
  const ownerBView = lifecycleControl.snapshot("LIFECYCLE-A", "renderer-202");
  assert.equal(ownerAView.runs.find((run) => run.runId === ownerAFirst.runId).paused, true);
  assert.equal(ownerBView.runs.find((run) => run.runId === ownerAFirst.runId).paused, false,
    "A Renderer snapshot must not display another owner's pause state");
  assert.deepEqual(ownerBView.pausedScopes, []);
  assert.equal(ownerBView.lockedNodeIds.includes("OWNER-LOCKED-NODE"), true,
    "Personalized pause projection must retain cross-Renderer node locks");
  const pausedOwnerWait = assert.rejects(
    lifecycleControl.waitUntilRunnable(ownerAFirst, ownerAFirst.signal),
    (error) => error.code === "NAIMAGE_RUN_CANCELLED"
  );
  const ownerStopped = lifecycleControl.stopOwner({ ownerId: "renderer-101", reason: "renderer destroyed" });
  await pausedOwnerWait;
  assert.equal(ownerStopped.stopped, 2);
  assert.equal(ownerAFirst.signal.aborted, true);
  assert.equal(ownerASecond.signal.aborted, true);
  assert.equal(ownerB.signal.aborted, false, "Stopping one Renderer must not stop another owner");
  assert.equal(lifecycleControl.snapshot().scopeCount, 1, "Stopped owner scopes must be reclaimed immediately");
  assert.equal(lifecycleControl.finish({ runId: ownerB.runId }), true);
  assert.equal(lifecycleControl.snapshot().scopeCount, 0, "The final completed run must release its scope state");

  const shutdownA = lifecycleControl.begin({ runId: "shutdown-a", ownerId: "renderer-101", projectId: "S1", conversationId: "C" });
  const shutdownB = lifecycleControl.begin({ runId: "shutdown-b", ownerId: "renderer-202", projectId: "S2", conversationId: "C" });
  const allStopped = lifecycleControl.stopAll("application shutdown");
  assert.equal(allStopped.stopped, 2);
  assert.equal(shutdownA.signal.aborted, true);
  assert.equal(shutdownB.signal.aborted, true);
  assert.equal(lifecycleControl.snapshot().scopeCount, 0);

  const ipcHandlers = new Map();
  const destroyedHandlers = [];
  const ipcControl = createAgentRunControl();
  let capturedChatSettings;
  const runtime = {
    normalizeTaskScope: (payload) => payload.taskScope || { version: 2, origin: "chat", sourceNodeIds: [] },
    chat: async ({ signal, settings }) => new Promise((_resolve, reject) => {
      capturedChatSettings = settings;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  };
  registerAgentIpc({
    ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    currentAgentSettings: () => ({ imageRatio: "1:1", imageResolution: "1K", imageSize: "1024x1024" }),
    getAgentRuntime: () => runtime,
    log: () => {},
    listAgentModels: async () => ({ ok: true, models: [] }),
    emitAgentProgress: () => {},
    agentRunControl: ipcControl,
    aidebugMode: false
  });
  const rendererEvent = {
    sender: {
      id: 303,
      isDestroyed: () => false,
      once: (event, handler) => {
        if (event === "destroyed") destroyedHandlers.push(handler);
      }
    }
  };
  const rendererRun = ipcHandlers.get("naimage:agent:chat")(rendererEvent, {
    runId: "renderer-owned-run",
    projectId: "IPC-P",
    conversationId: "IPC-C",
    imageDefaults: { ratio: "3:4", resolution: "2K" },
    taskScope: { version: 2, origin: "chat", sourceNodeIds: [] }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capturedChatSettings.imageFrameLocked, true);
  assert.equal(capturedChatSettings.imageRatio, "3:4");
  assert.equal(capturedChatSettings.imageResolution, "2K");
  assert.equal(capturedChatSettings.imageSize, "1536x2048");
  assert.equal(ipcControl.snapshot("IPC-P").runs[0].ownerId, "303");
  const otherRendererRun = ipcControl.begin({
    runId: "other-renderer-run",
    ownerId: "404",
    projectId: "IPC-P",
    conversationId: "IPC-C"
  });
  ipcControl.pause({ runId: otherRendererRun.runId, ownerId: "404" });
  const rendererStatus = await ipcHandlers.get("naimage:agent:run-status")(rendererEvent, { projectId: "IPC-P" });
  assert.equal(rendererStatus.runs.find((run) => run.runId === otherRendererRun.runId).paused, false);
  assert.deepEqual(rendererStatus.pausedScopes, []);
  assert.equal(destroyedHandlers.length, 1, "One Renderer must own one lifecycle listener, not one per request");
  destroyedHandlers[0]();
  const rendererResult = await rendererRun;
  assert.equal(rendererResult.ok, false);
  assert.match(rendererResult.error, /窗口已关闭/);
  assert.equal(otherRendererRun.signal.aborted, false);
  ipcControl.stopOwner({ ownerId: "404" });
  assert.equal(ipcControl.snapshot().runs.length, 0);
  assert.equal(ipcControl.snapshot().scopeCount, 0);

  const notSteerable = control.steer({ runId: "run-d", prompt: "should fail" });
  assert.equal(notSteerable.accepted, 0);
  assert.ok(notSteerable.error);

  const stopped = control.stop({ projectId: "P", conversationId: "C1", reason: "user stop" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.stopped, 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.signal.reason.code, "NAIMAGE_RUN_CANCELLED");
  assert.deepEqual(control.snapshot("P").lockedNodeIds, []);
  const repeatedStop = control.stop({ projectId: "P", conversationId: "C1", reason: "duplicate user stop" });
  assert.equal(repeatedStop.ok, true);
  assert.equal(repeatedStop.stopped, 0, "An already-settled authoritative stop remains a valid idempotent snapshot");
  assert.deepEqual(repeatedStop.runs.filter((run) => run.projectId === "P" && run.conversationId === "C1"), []);
  assert.ok(snapshots.some((snapshot) => snapshot.runs.some((run) => run.projectId === "OTHER")));

  function rendererStopState() {
    return {
      activeRun: "renderer-run",
      reservation: "renderer-reservation",
      placeholder: "working",
      stream: "running",
      status: "thinking",
      paused: true,
      pendingRequestId: "pending-ask-user"
    };
  }

  let resolveConfirmedStop;
  let confirmedCommitCount = 0;
  const stateBeforeConfirmation = rendererStopState();
  const pendingConfirmation = confirmAgentStopRequest(
    () => new Promise((resolve) => { resolveConfirmedStop = resolve; }),
    () => {
      confirmedCommitCount += 1;
      stateBeforeConfirmation.activeRun = null;
      stateBeforeConfirmation.reservation = null;
      stateBeforeConfirmation.placeholder = "failed";
      stateBeforeConfirmation.stream = "done";
      stateBeforeConfirmation.status = "idle";
      stateBeforeConfirmation.paused = false;
      stateBeforeConfirmation.pendingRequestId = null;
    }
  );
  await Promise.resolve();
  assert.deepEqual(stateBeforeConfirmation, rendererStopState(),
    "Renderer state must remain intact while Main stop confirmation is pending");
  assert.equal(confirmedCommitCount, 0);
  resolveConfirmedStop({ ok: true, stopped: 1, runs: [] });
  const confirmedStop = await pendingConfirmation;
  assert.equal(confirmedStop.ok, true);
  assert.equal(confirmedCommitCount, 1);
  assert.equal(stateBeforeConfirmation.status, "idle", "Renderer cleanup starts only after authoritative success");

  const rejectedResponses = [
    { label: "rejected Promise", request: () => Promise.reject(new Error("transport unavailable")), error: /transport unavailable/ },
    { label: "ok false", request: async () => ({ ok: false, error: "controller rejected stop" }), error: /controller rejected stop/ },
    { label: "undefined response", request: async () => undefined, error: /有效的结束确认/ },
    { label: "malformed response", request: async () => ({}), error: /有效的结束确认/ }
  ];
  for (const scenario of rejectedResponses) {
    const retained = rendererStopState();
    let commits = 0;
    const result = await confirmAgentStopRequest(scenario.request, () => {
      commits += 1;
      retained.status = "idle";
    });
    assert.equal(result.ok, false, scenario.label);
    assert.match(result.error, scenario.error, scenario.label);
    assert.equal(commits, 0, `${scenario.label} must not commit Renderer cleanup`);
    assert.deepEqual(retained, rendererStopState(), `${scenario.label} must preserve retryable Renderer state`);
  }

  const pendingOnlyState = rendererStopState();
  pendingOnlyState.activeRun = null;
  let pendingOnlyCommits = 0;
  const pendingOnlyStop = await confirmAgentStopRequest(
    async () => ({ ok: true, stopped: 0, runs: [] }),
    () => {
      pendingOnlyCommits += 1;
      pendingOnlyState.pendingRequestId = null;
      pendingOnlyState.status = "idle";
      pendingOnlyState.paused = false;
    }
  );
  assert.equal(pendingOnlyStop.ok, true, "stopped:0 is valid for a pending AskUser continuation with no Main run");
  assert.equal(pendingOnlyCommits, 1);
  assert.equal(pendingOnlyState.pendingRequestId, null);

  const rendererSource = readFileSync(path.resolve(__dirname, "..", "src", "main.tsx"), "utf8");
  const stopFunctionStart = rendererSource.indexOf("async function stopAgentRun()");
  const stopFunctionEnd = rendererSource.indexOf("// MAIN 10L", stopFunctionStart);
  const stopFunctionSource = rendererSource.slice(stopFunctionStart, stopFunctionEnd);
  const duplicateFenceIndex = stopFunctionSource.indexOf("if (agentStopPendingRef.current)");
  const bridgeInvocationIndex = stopFunctionSource.indexOf("stopBridge({");
  assert(stopFunctionStart >= 0 && stopFunctionEnd > stopFunctionStart, "Renderer stop function must remain discoverable");
  assert(duplicateFenceIndex >= 0 && duplicateFenceIndex < bridgeInvocationIndex,
    "A second concurrent stop must be fenced before it can invoke the Main bridge");
  assert.match(stopFunctionSource, /agentStopPendingRef\.current = requestToken/);
  assert.match(stopFunctionSource, /agentStopPendingRef\.current === requestToken/,
    "Only the matching stop request may release the pending fence");
  assert.match(stopFunctionSource, /confirmAgentStopRequest\([\s\S]*?activeRunRef\.current = null/,
    "Local active-run cleanup must remain inside the authoritative confirmation commit");
  console.log("agent run control self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
