"use strict";

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(reason ? String(reason) : "任务已结束。");
  error.name = "AbortError";
  error.code = "NAIMAGE_RUN_CANCELLED";
  return error;
}

async function runImageBatchScheduler(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const batchSize = Math.max(1, Math.min(10, Math.floor(Number(options.batchSize || 1) || 1)));
  const signal = options.signal;
  const waitUntilRunnable = typeof options.waitUntilRunnable === "function" ? options.waitUntilRunnable : async () => {};
  const runItem = typeof options.runItem === "function" ? options.runItem : async (item) => item;
  const onBatchStart = typeof options.onBatchStart === "function" ? options.onBatchStart : () => {};
  const results = Array(items.length);

  for (let start = 0; start < items.length; start += batchSize) {
    if (signal?.aborted) throw abortError(signal);
    await waitUntilRunnable(signal);
    if (signal?.aborted) throw abortError(signal);
    const batch = items.slice(start, start + batchSize);
    onBatchStart({ batchIndex: Math.floor(start / batchSize), start, size: batch.length, total: items.length });
    const settled = await Promise.allSettled(batch.map((item, offset) => runItem(item, start + offset, signal)));
    settled.forEach((result, offset) => {
      results[start + offset] = result;
    });
  }
  return results;
}

module.exports = { runImageBatchScheduler };
