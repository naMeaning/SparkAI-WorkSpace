"use strict";

const assert = require("node:assert/strict");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    async text() { return JSON.stringify(data); }
  };
}

async function main() {
  const calls = [];
  let poll = 0;
  let transport = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return response(202, { task_id: "task-1", status: "queued" });
    poll += 1;
    if (poll === 1) return response(200, { task_id: "task-1", status: "running" });
    return response(200, { task_id: "task-1", status: "completed", result: { data: [{ b64_json: "aW1hZ2U=" }] } });
  };
  const client = createNewApiClient({
    defaultSettings: { accountBaseUrl: "https://sparkapi.org", relayBaseUrl: "", updateBaseUrl: "https://sparkapi.org" },
    ensureLocalServer: async () => {},
    isLocalServerUrl: () => false,
    migrateSettings: (value) => value,
    newApiTransportFetch: (...args) => transport(...args),
    normalizeServerUrl: (value, fallback = "") => String(value || fallback).replace(/\/+$/, ""),
    readJson: () => ({}),
    resolveAccountApiCredentials: async () => ({ baseUrl: "https://sparkapi.org", apiKey: "account-key" }),
    settingsPath: "settings.json",
    writeJson: () => {}
  });
  const settings = {
    accessMode: "custom",
    imageBaseUrl: "https://sub2api.example/v1",
    imageApiKey: "sub2-key",
    imageModelBindings: []
  };
  const accepted = [];
  const statuses = [];
  const result = await client.newApiRelayAsyncImage(settings, "/v1/images/generations", {
    model: "grok-imagine-image-2.0",
    prompt: "landscape"
  }, {
    model: "grok-imagine-image-2.0",
    pollIntervalMs: 0,
    maxWaitMs: 5_000,
    onAccepted: (event) => accepted.push(event),
    onStatus: (event) => statuses.push(event.status)
  });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.options.method === "GET").length, 2);
  assert.equal(calls[0].url, "https://sub2api.example/v1/images/generations/async");
  assert.equal(calls[1].url, "https://sub2api.example/v1/images/tasks/task-1");
  assert.deepEqual(result, { data: [{ b64_json: "aW1hZ2U=" }] });
  assert.deepEqual(accepted, [{ taskId: "task-1", status: "queued" }]);
  assert.deepEqual(statuses, ["running", "completed"]);

  let createCount = 0;
  transport = async (_url, options) => {
    if (options.method === "POST") createCount += 1;
    throw Object.assign(new Error("socket closed before task id"), { code: "ECONNRESET" });
  };
  await assert.rejects(
    () => client.newApiRelayAsyncImage(settings, "/v1/images/generations", { model: "gpt-image-2", prompt: "x" }),
    (error) => error?.unsafeToRetry === true && error?.ambiguous === true
  );
  assert.equal(createCount, 1, "An ambiguous create must never be resubmitted automatically");

  const controller = new AbortController();
  transport = async (_url, options) => {
    if (options.method === "POST") return response(202, { task_id: "task-abort", status: "queued" });
    if (options.signal?.aborted) throw options.signal.reason || new Error("aborted");
    return response(200, { task_id: "task-abort", status: "running" });
  };
  await assert.rejects(
    () => client.newApiRelayAsyncImage(settings, "/v1/images/generations", { model: "gpt-image-2", prompt: "x" }, {
      signal: controller.signal,
      pollIntervalMs: 0,
      onAccepted: () => controller.abort(new Error("user aborted"))
    }),
    /user aborted|aborted/i
  );

  process.stdout.write(`${JSON.stringify({ ok: true, polling: true, abort: true, ambiguousCreateNotRetried: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
