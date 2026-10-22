"use strict";
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { createImageOperationJournal } = require("../desktop/image-operation-journal.cjs");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");
const sharp = require("sharp");
const { applyClientMask } = require("../desktop/image-mask-compat.cjs");
const { verifyAlphaSubject } = require("../runtime/image-generation/edit-capabilities.cjs");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQkwMaACDAwAFwICBXS9U/8AAAAASUVORK5CYII=";
async function child() {
  const [phase, dir, base] = process.argv.slice(3);
  const settings = { accessMode: "custom", imageBaseUrl: base, imageApiKey: "fixture-private-key" };
  const client = createNewApiClient({ defaultSettings: {}, ensureLocalServer: async () => {}, isLocalServerUrl: () => false,
    newApiTransportFetch: fetch, normalizeServerUrl: value => String(value).replace(/\/+$/, "") });
  const journal = createImageOperationJournal({ projectFor: () => ({ path: dir }), extractImages: result => (result.data || []).map(image => image.url ? { type: "url", value: image.url } : { type: "base64", value: image.b64_json }),
    download: async url => { const response = await fetch(url); if (!response.ok) throw new Error("download failed"); return Buffer.from(await response.arrayBuffer()); },
    async materialize(images, stem) {
      if (["localfail", "alphavalidcreate"].includes(phase)) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      const buffer = Buffer.from(images[0].value, "base64"); await sharp(buffer).raw().toBuffer();
      const file = path.join(dir, `${stem}.png`); writeFileSync(file, buffer); return [{ path: file, type: "file", index: 1 }];
    },
    async processImage(buffer, inputs, processing = {}) {
      if (["maskcreate", "maskfailagain"].includes(phase)) throw Object.assign(new Error("local mask failure"), { code: "ENOMEM" });
      if (processing.requireAlpha && processing.kind !== "client-mask") {
        const alpha = await verifyAlphaSubject(buffer);
        if (!alpha.ok) throw Object.assign(new Error("invalid alpha fixture"), { code: "IMAGE_EDIT_ALPHA_INVALID" });
        return { buffer, localProcessing: { alpha: { ...alpha, verified: true } } };
      }
      const result = await applyClientMask({ images: [{ type: "base64", value: buffer.toString("base64") }] }, inputs);
      return Buffer.from(result.images[0].value, "base64");
    },
    resolveConnection: async () => ({ connectionId: phase === "changed" ? "changed" : "original", protocol: "openai-images", transport: "async" }),
    pollTask: item => client.pollSub2apiImageTask(settings, item.taskId, { model: item.model, pollIntervalMs: 0 })
  });
  if (phase === "create") {
    const operation = journal.start({ projectId: "P", operationId: "accepted", runId: "r", requestIndex: 1, model: "gpt-image-2", connectionId: "original", protocol: "openai-images", transport: "async" });
    await client.newApiRelayAsyncImage(settings, "/v1/images/generations", { model: "gpt-image-2", prompt: "local" }, { onAccepted(event) { journal.accepted(operation, event); process.exit(0); } });
  } else if (phase === "unknown") {
    const operation = journal.start({ projectId: "P", operationId: "unknown", runId: "unknown", model: "gpt-image-2", connectionId: "original", protocol: "openai-images", transport: "sync" });
    journal.failed(operation, Object.assign(new Error("socket interrupted"), { ambiguous: true }));
    await assert.rejects(() => journal.recover("P", operation.key), error => error.code === "IMAGE_OPERATION_UNCERTAIN");
    assert.throws(() => journal.start({ ...operation }), error => error.code === "IMAGE_OPERATION_EXISTS");
  } else if (phase === "partial") {
    const operation = journal.start({ projectId: "P", operationId: "partial", runId: "partial", model: "gpt-image-2", connectionId: "original", protocol: "openai-images", transport: "sync" });
    const result = { data: [{ b64_json: png }, { b64_json: Buffer.from("invalid image").toString("base64") }] };
    journal.received(operation, result); const assets = await journal.deliver(operation, result);
    assert.equal(assets.length, 1); assert.equal(journal.get("P", operation.key).state, "partial");
  } else if (["alphacreate", "alphavalidcreate"].includes(phase)) {
    const raw = Buffer.alloc(8 * 8 * 4, 255);
    if (phase === "alphavalidcreate") for (let index = 0; index < 32; index++) raw[index * 4 + 3] = 0;
    const bytes = await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const operation = journal.start({ projectId: "P", operationId: phase === "alphacreate" ? "alpha-invalid" : "alpha-valid", runId: "alpha", model: "fixture" });
    const result = { data: [{ b64_json: bytes.toString("base64") }] };
    journal.received(operation, result, { requireAlpha: true });
    await assert.rejects(journal.deliver(operation, result, {}, false), error => error.code === (phase === "alphacreate" ? "IMAGE_EDIT_ALPHA_INVALID" : "ENOSPC"));
    assert.equal(journal.get("P", operation.key).processing.requireAlpha, true);
    assert.equal(journal.get("P", operation.key).slots[0].processed, false);
  } else if (["alphafailagain", "alpharecover"].includes(phase)) {
    const operation = journal.list("P").find(item => item.operationId === (phase === "alphafailagain" ? "alpha-invalid" : "alpha-valid"));
    if (phase === "alphafailagain") await assert.rejects(journal.recover("P", operation.key), error => error.code === "IMAGE_EDIT_ALPHA_INVALID");
    else {
      const result = await journal.recover("P", operation.key);
      assert.equal(result.assets[0].localProcessing.alpha.verified, true);
      assert.equal(result.assets[0].localProcessing.alpha.transparentRatio, 0.5);
      assert.equal((await verifyAlphaSubject(readFileSync(result.assets[0].path))).ok, true);
    }
  } else if (phase === "maskcreate") {
    const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#0000ff" } }).png().toBuffer();
    const raw = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#00ff00" } }).png().toBuffer();
    const mask = Buffer.alloc(8 * 8 * 4, 255); for (let i = 0; i < 32; i++) mask[i * 4 + 3] = 0;
    const maskPng = await sharp(mask, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const sourcePath = path.join(dir, "managed-source.png"); writeFileSync(sourcePath, source);
    const operation = journal.start({ projectId: "P", operationId: "masked-local", runId: "masked-local", model: "gpt-image-2", parameters: { quality: "high", size: "2048x2048" } });
    const result = { data: [{ b64_json: raw.toString("base64") }] };
    journal.received(operation, result, { clientMask: true, sourcePath, inputs: { editImages: [{ buffer: source }], mask: { buffer: maskPng } } });
    await assert.rejects(() => journal.deliver(operation, result, {}, false));
    assert.equal(journal.get("P", operation.key).slots[0].processed, false);
  } else if (["maskfailagain", "maskrecover"].includes(phase)) {
    const item = journal.list("P").find(item => item.operationId === "masked-local");
    if (phase === "maskfailagain") {
      await assert.rejects(() => journal.recover("P", item.key));
      assert.equal(journal.get("P", item.key).slots[0].processed, false, "repeated local failure retains raw-cache processing contract");
    } else {
      const result = await journal.recover("P", item.key), pixels = await sharp(result.assets[0].path).ensureAlpha().raw().toBuffer();
      assert.deepEqual([...pixels.subarray(0, 4)], [0, 255, 0, 255]);
      assert.deepEqual([...pixels.subarray(63 * 4, 64 * 4)], [0, 0, 255, 255], "outside mask is original source after restart");
      assert.equal(journal.get("P", item.key).state, "saved");
    }
  } else {
    const item = journal.list("P").find(item => item.operationId === "accepted");
    if (phase === "changed") await assert.rejects(() => journal.recover("P", item.key), error => error.code === "IMAGE_CONNECTION_CHANGED");
    else if (["downloadfail", "localfail"].includes(phase)) await assert.rejects(() => journal.recover("P", item.key));
    else { const result = await journal.recover("P", item.key); assert.equal(result.assets.length, 1); const repeated = await journal.recover("P", item.key); assert.deepEqual(repeated.assets, result.assets); }
  }
}
async function main() {
  const dir = mkdtempSync(path.join(path.resolve(__dirname, "../.diagnostics"), "image-recovery-"));
  let posts = 0, polls = 0, downloads = 0;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST") { posts++; res.end(JSON.stringify({ task_id: "original-task", status: "queued" })); }
    else if (req.url.startsWith("/v1/images/tasks/")) {
      polls++;
      if (polls === 1) { res.statusCode = 429; res.end("{}"); }
      else res.end(JSON.stringify({ status: "completed", result: { data: [{ url: `http://127.0.0.1:${server.address().port}/result?signature=private-sentinel` }] } }));
    } else { downloads++; if (downloads === 1) { res.statusCode = 503; res.end("unavailable"); } else { res.setHeader("content-type", "image/png"); res.end(Buffer.from(png, "base64")); } }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function run(phase) {
    const process = spawn(global.process.execPath, [__filename, "--child", phase, dir, base], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = ""; process.stdout.on("data", chunk => output += chunk); process.stderr.on("data", chunk => output += chunk);
    const code = await new Promise(resolve => process.on("exit", resolve)); assert.equal(code, 0, `${phase}: ${output}`);
  }
  try {
    await run("create"); assert.equal(posts, 1); assert.equal(polls, 0);
    await run("changed"); assert.equal(polls, 0);
    await run("downloadfail"); assert.equal(posts, 1); assert.equal(polls, 2);
    await run("localfail"); assert.equal(downloads, 2);
    const priorPolls = polls, priorDownloads = downloads;
    await run("recover"); assert.equal(polls, priorPolls, "cached bytes survive process restart"); assert.equal(downloads, priorDownloads);
    await run("unknown"); await run("partial"); await run("maskcreate"); await run("maskfailagain"); await run("maskrecover");
    await run("alphacreate"); await run("alphafailagain"); await run("alphavalidcreate"); await run("alpharecover"); assert.equal(posts, 1);
    const text = readFileSync(path.join(dir, ".naimage/image-operations/journal.json"), "utf8");
    for (const secret of ["fixture-private-key", "private-sentinel", "b64_json", "http://", "base64"]) assert.equal(text.includes(secret), false, secret);
    const report = { ok: true, childProcesses: 14, posts, polls, downloads, realModelRequests: 0, originalTaskRecovered: true, localBytesRecoveredAfterRestart: true, credentialChangeBlocked: true, uncertainNotResubmitted: true, partialSuccessPreserved: true, maskedBytesRecoveredAcrossRepeatedFailures: true, requiredAlphaValidatedAcrossRestart: true };
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, dir }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
(process.argv[2] === "--child" ? child() : main()).catch(error => { console.error(error); process.exitCode = 1; });
