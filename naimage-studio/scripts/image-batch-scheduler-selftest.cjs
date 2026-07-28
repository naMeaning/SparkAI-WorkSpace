"use strict";

const assert = require("node:assert/strict");
const { runImageBatchScheduler } = require("../runtime/image-batch-scheduler.cjs");

(async () => {
  const batches = [];
  const active = new Set();
  let maximumActive = 0;
  const results = await runImageBatchScheduler({
    items: [1, 2, 3, 4, 5],
    batchSize: 2,
    onBatchStart: (batch) => batches.push(batch),
    runItem: async (item) => {
      active.add(item);
      maximumActive = Math.max(maximumActive, active.size);
      await new Promise((resolve) => setTimeout(resolve, item % 2 ? 8 : 2));
      active.delete(item);
      return item * 10;
    },
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(batches.map(({ start, size }) => ({ start, size })), [
    { start: 0, size: 2 },
    { start: 2, size: 2 },
    { start: 4, size: 1 },
  ]);
  assert.deepEqual(results.map((result) => result.value), [10, 20, 30, 40, 50]);

  const controller = new AbortController();
  let released = false;
  const aborted = runImageBatchScheduler({
    items: [1],
    signal: controller.signal,
    waitUntilRunnable: () => new Promise((resolve) => {
      const timer = setInterval(() => {
        if (!released) return;
        clearInterval(timer);
        resolve();
      }, 1);
    }),
  });
  controller.abort(new Error("cancelled"));
  released = true;
  await assert.rejects(aborted, /cancelled/);
  console.log("image batch scheduler self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
