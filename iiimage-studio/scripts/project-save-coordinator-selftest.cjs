"use strict";

const assert = require("node:assert/strict");

const {
  createProjectSaveCoordinator,
  normalizeSessionRevision
} = require("../desktop/project-save-coordinator.cjs");

async function main() {
  assert.equal(normalizeSessionRevision(0), 0);
  assert.equal(normalizeSessionRevision("12"), 12);
  assert.equal(normalizeSessionRevision(-1), null);
  assert.equal(normalizeSessionRevision(1.5), null);
  assert.equal(normalizeSessionRevision(Number.MAX_SAFE_INTEGER + 1), null);

  const coordinator = createProjectSaveCoordinator({
    initialRevision: async (projectId) => projectId === "project-a" ? 2 : 0
  });

  const explicit = await coordinator.enqueue("project-a", 3, async (nextRevision, currentRevision) => {
    assert.equal(nextRevision, 3);
    assert.equal(currentRevision, 2);
    return { applied: true };
  });
  assert.equal(explicit.appliedRevision, 3);

  const stale = await coordinator.enqueue("project-a", 3, async () => {
    throw new Error("stale revision must not be applied");
  });
  assert.equal(stale.skippedStale, true);

  const implicit = await coordinator.enqueue("project-a", null, async (nextRevision, currentRevision) => {
    assert.equal(nextRevision, 4);
    assert.equal(currentRevision, 3);
    return { applied: true };
  });
  assert.equal(implicit.appliedRevision, 4);

  const declined = await coordinator.enqueue("project-a", 5, async () => ({ applied: false, reason: "unchanged" }));
  assert.equal(declined.appliedRevision, 4);
  assert.equal(coordinator.revision("project-a"), 4);

  const invalid = await coordinator.enqueue("project-a", -1, async () => ({ applied: true }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.appliedRevision, 4);

  const serialEvents = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = coordinator.enqueue("serial", 1, async () => {
    serialEvents.push("first:start");
    await firstGate;
    serialEvents.push("first:end");
    return { applied: true };
  });
  const second = coordinator.enqueue("serial", 2, async () => {
    serialEvents.push("second");
    return { applied: true };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(serialEvents, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(serialEvents, ["first:start", "first:end", "second"]);

  const recovery = createProjectSaveCoordinator();
  await assert.rejects(recovery.enqueue("recover", 1, async () => {
    throw new Error("expected failure");
  }), /expected failure/);
  const recovered = await recovery.enqueue("recover", 2, async () => ({ applied: true }));
  assert.equal(recovered.appliedRevision, 2);

  await Promise.resolve();
  assert.equal(coordinator.pendingProjectCount(), 0);
  assert.equal(recovery.pendingProjectCount(), 0);

  process.stdout.write(`${JSON.stringify({ ok: true, cases: 18 })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
