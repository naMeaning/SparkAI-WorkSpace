import assert from "node:assert/strict";
import test from "node:test";
import { createSchedulerController } from "./scheduler-health.js";

test("scheduler controller records successful and failed runs", async () => {
  const successful = createSchedulerController({
    name: "successful",
    intervalMinutes: 5,
    async run() {
      return { ok: true };
    }
  });

  await successful.runNow();
  const successSnapshot = successful.snapshot();
  assert.equal(successSnapshot.enabled, true);
  assert.equal(successSnapshot.intervalMinutes, 5);
  assert.equal(successSnapshot.running, false);
  assert.ok(successSnapshot.lastStartedAt);
  assert.ok(successSnapshot.lastSuccessAt);
  assert.equal(successSnapshot.lastFailureAt, null);

  const failing = createSchedulerController({
    name: "failing",
    intervalMinutes: 1,
    async run() {
      throw new Error("forced scheduler failure");
    }
  });

  await assert.rejects(() => failing.runNow(), /forced scheduler failure/);
  const failureSnapshot = failing.snapshot();
  assert.ok(failureSnapshot.lastFailureAt);
  assert.equal(failureSnapshot.lastErrorCode, "scheduler_run_failed");
  assert.equal(failureSnapshot.lastErrorMessage, "forced scheduler failure");
});

test("scheduler controller prevents overlapping runs", async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = createSchedulerController({
    name: "overlap",
    intervalMinutes: 1,
    async run() {
      calls += 1;
      await blocked;
      return calls;
    }
  });

  const first = scheduler.runNow();
  const second = await scheduler.runNow();
  assert.equal(second, null);
  assert.equal(calls, 1);
  release();
  await first;
});
