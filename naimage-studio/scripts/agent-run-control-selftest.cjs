"use strict";

const assert = require("node:assert/strict");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");

(async () => {
  const snapshots = [];
  const control = createAgentRunControl({ onChange: (snapshot) => snapshots.push(snapshot) });
  const first = control.begin({ runId: "run-a", projectId: "P", conversationId: "C1", nodeIds: ["N1"] });
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

  const sharedFirst = control.begin({ runId: "shared", projectId: "P", conversationId: "C1", nodeIds: ["N3"] });
  const sharedSecond = control.begin({ runId: "shared", projectId: "P", conversationId: "C1", nodeIds: ["N4"] });
  assert.equal(sharedFirst, sharedSecond);
  assert.deepEqual(control.snapshot("P").runs.find((run) => run.runId === "shared").nodeIds, ["N3", "N4"]);
  assert.equal(control.finish({ runId: "shared" }), false);
  assert.ok(control.snapshot("P").runs.some((run) => run.runId === "shared"));
  assert.equal(control.finish({ runId: "shared" }), true);
  assert.ok(!control.snapshot("P").runs.some((run) => run.runId === "shared"));

  const stopped = control.stop({ projectId: "P", conversationId: "C1", reason: "user stop" });
  assert.equal(stopped.stopped, 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.signal.reason.code, "NAIMAGE_RUN_CANCELLED");
  assert.deepEqual(control.snapshot("P").lockedNodeIds, []);
  assert.ok(snapshots.some((snapshot) => snapshot.runs.some((run) => run.projectId === "OTHER")));
  console.log("agent run control self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
