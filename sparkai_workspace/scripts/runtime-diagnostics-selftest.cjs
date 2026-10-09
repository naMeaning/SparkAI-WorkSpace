"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntimeDiagnostics, MAX_EVENTS } = require("../desktop/runtime-diagnostics.cjs");
const { registerSettingsIpc } = require("../desktop/ipc/config-ipc.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");

async function main() {
  const dir = fs.mkdtempSync(path.resolve(__dirname, "../.diagnostics/runtime-diagnostics-"));
  const filePath = path.join(dir, "diagnostics.json");
  const store = createRuntimeDiagnostics({ filePath, version: "1.0.9" });
  const secrets = ["sk-private-fixture", "private-cookie-fixture", "private-prompt-fixture", "private-base64-fixture", "C:\\private\\secret.png", "https://private.example/image?token=private"];
  store.record({ kind: "model", phase: "failure", stage: "conversation", runId: secrets[1], model: "gpt-6.1-sol", protocol: "chat-completions", status: 502, durationMs: 120, prompt: secrets[2], apiKey: secrets[0], body: secrets[3], path: secrets[4], url: secrets[5], message: secrets.join(" ") });
  store.record({ kind: "image", phase: "failure", category: secrets[0], model: secrets[0], stage: secrets[4], status: Infinity });
  store.record(null);
  store.record({ kind: "not-whitelisted", phase: "failure" });
  const initial = store.snapshot();
  assert.equal(initial.events.length, 2);
  assert.equal(initial.events[0].status, 502);
  assert.match(initial.events[0].run, /^[a-f0-9]{12}$/);
  assert.equal(initial.events[1].model, undefined);
  for (const secret of secrets) assert.equal(JSON.stringify(initial).includes(secret), false);
  initial.events[0].status = 1;
  assert.equal(store.snapshot().events[0].status, 502, "Snapshots must not mutate the store");
  assert.deepEqual(createRuntimeDiagnostics({ filePath, version: "1.0.9" }).snapshot(), store.snapshot(), "A restart must retain timestamps and correlation hashes");
  for (let i = 0; i < MAX_EVENTS + 10; i++) store.record({ kind: "image", phase: "response", count: 1, attempt: i });
  assert.equal(store.snapshot().events.length, MAX_EVENTS);
  assert.equal(store.snapshot().events[0].attempt, 10);
  assert.equal(createRuntimeDiagnostics({ filePath, version: "1.0.9" }).snapshot().events.length, MAX_EVENTS);

  const handlers = new Map();
  let selection = { canceled: true };
  registerSettingsIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, runtimeDiagnostics: store, dialog: { showSaveDialog: async () => selection } });
  assert.equal(handlers.get("naimage:diagnostics:read")().events.length, MAX_EVENTS);
  assert.deepEqual(await handlers.get("naimage:diagnostics:export")(), { ok: false, canceled: true });
  selection = { filePath: path.join(dir, "export.json") };
  assert.deepEqual(await handlers.get("naimage:diagnostics:export")(), { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(selection.filePath)), store.snapshot());
  selection = { filePath: path.join(dir, "missing", "export.json") };
  const failed = await handlers.get("naimage:diagnostics:export")();
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes(dir), false);

  const records = [];
  let providerCalls = 0;
  let fail = false;
  const service = createImageGenerationService({ recordDiagnostic: (event) => { records.push(event); }, newApiRelayJson: async () => { providerCalls++; if (fail) throw Object.assign(new Error(secrets.join(" ")), { status: 502 }); return { data: [{ b64_json: "aW1hZ2U=" }] }; } });
  const settings = { imageModel: "configured-model", imageModelBindings: [{ model: "configured-model", protocol: "xai-images", gateway: "newapi" }] };
  await service.generate(settings, { prompt: secrets[2], n: 1, runId: "fixture" });
  assert.deepEqual(records.map((event) => [event.phase, event.protocol, event.count]), [["request", "xai-images", 1], ["response", "xai-images", 1]]);
  fail = true;
  await assert.rejects(service.generate(settings, { prompt: secrets[2], n: 1, runId: "fixture" }), (error) => error.status === 502);
  assert.equal(providerCalls, 2, "Diagnostics must not add generation retries");
  assert.equal(records.at(-1).stage, "generation");
  assert.equal(records.at(-1).status, 502);
  for (const record of records) store.record(record);
  for (const secret of secrets) assert.equal(fs.readFileSync(filePath, "utf8").includes(secret), false);
  const noLogService = createImageGenerationService({ recordDiagnostic: () => { throw new Error("disk unavailable"); }, newApiRelayJson: async () => ({ data: [{ b64_json: "aW1hZ2U=" }] }) });
  assert.equal((await noLogService.generate(settings, { prompt: "test" })).ok, true);
  fs.writeFileSync(filePath, "invalid json");
  assert.equal(createRuntimeDiagnostics({ filePath }).snapshot().events.length, 0);
  console.log(JSON.stringify({ ok: true, capacity: MAX_EVENTS, restart: true, export: true, canceledExport: true, redaction: true, adapterDiagnostics: true, realRequests: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
