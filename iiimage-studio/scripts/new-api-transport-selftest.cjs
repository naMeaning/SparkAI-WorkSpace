"use strict";

process.env.IIIMAGE_AGENT_PROTOCOL_SELFTEST = "1";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { app } = require("electron");
const {
  activeNewApiCurlTransportCount,
  boundedImageRead,
  encodedImageDimensions,
  imageEditRequestLimiterStatus,
  migrateSettings,
  newApiFetch,
  newApiRelayStream,
  newApiTransportFetch,
  newApiUserLogsEndpoint,
  tokenItemsFromNewApiPayload,
  withImageEditRequestSlot
} = require("../electron-main.cjs");

async function listen(server, host) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  await app.whenReady();
  const boundedReadRoot = mkdtempSync(path.join(os.tmpdir(), "iiimage-bounded-read-"));
  try {
    const exactPath = path.join(boundedReadRoot, "exact.png");
    const oversizedPath = path.join(boundedReadRoot, "oversized.png");
    writeFileSync(exactPath, Buffer.alloc(64, 1));
    writeFileSync(oversizedPath, Buffer.alloc(65, 2));
    assert.equal(boundedImageRead(exactPath, 64, "exact.png").length, 64);
    assert.throws(
      () => boundedImageRead(oversizedPath, 64, "oversized.png"),
      (error) => error?.code === "IIIMAGE_SOURCE_TOO_LARGE"
    );
  } finally {
    rmSync(boundedReadRoot, { recursive: true, force: true });
  }
  assert.equal(newApiUserLogsEndpoint, "/api/log/self?p=1&page_size=20");
  assert.deepEqual(tokenItemsFromNewApiPayload({ data: { page: 1, page_size: 20, total: 2, items: [{ id: 1 }, { id: 2 }] } }), [{ id: 1 }, { id: 2 }]);
  const webpVp8x = Buffer.alloc(30);
  webpVp8x.write("RIFF", 0, "ascii");
  webpVp8x.writeUInt32LE(22, 4);
  webpVp8x.write("WEBP", 8, "ascii");
  webpVp8x.write("VP8X", 12, "ascii");
  webpVp8x.writeUInt32LE(10, 16);
  webpVp8x.writeUIntLE(799, 24, 3);
  webpVp8x.writeUIntLE(1199, 27, 3);
  assert.deepEqual(encodedImageDimensions(webpVp8x), { width: 800, height: 1200 });
  let activeEditTasks = 0;
  let maximumEditTasks = 0;
  await Promise.all(Array.from({ length: 10 }, () => withImageEditRequestSlot(async () => {
    activeEditTasks += 1;
    maximumEditTasks = Math.max(maximumEditTasks, activeEditTasks);
    await delay(20);
    activeEditTasks -= 1;
  })));
  assert.equal(maximumEditTasks, 3);
  assert.deepEqual(imageEditRequestLimiterStatus(), { active: 0, queued: 0, maximum: 3 });
  let retryRequests = 0;
  let partialRequests = 0;
  let streamClosedCount = 0;
  let slowBodyClosed = false;
  const server = http.createServer((request, response) => {
    if (request.url === "/stream") {
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.write("data: {\"ready\":true}\n\n");
      const timer = setInterval(() => {
        if (!response.destroyed) response.write(": keepalive\n\n");
      }, 50);
      response.once("close", () => {
        streamClosedCount += 1;
        clearInterval(timer);
      });
      return;
    }
    if (request.url === "/slow-body") {
      response.flushHeaders();
      response.write('{"success":');
      const timer = setTimeout(() => {
        if (!response.destroyed) response.end("true}");
      }, 2_000);
      response.once("close", () => {
        slowBodyClosed = true;
        clearTimeout(timer);
      });
      return;
    }
    if (request.url === "/reject-upload") {
      response.statusCode = 413;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ success: false, message: "too large" }));
      return;
    }
    if (request.url === "/large") {
      response.end(JSON.stringify({ success: true, payload: "x".repeat(2 * 1024 * 1024) }));
      return;
    }
    if (request.url === "/iiimage/v1/events") {
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.end('data: {\ndata:   "type": "response.completed",\ndata:   "done": true\ndata: }\n\n');
      return;
    }
    if (request.url === "/iiimage/v1/events-large") {
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.end(`data: ${"x".repeat(2 * 1024 * 1024 + 128)}`);
      return;
    }
    if (request.url === "/form") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.once("end", () => {
        const payload = Buffer.concat(chunks).toString("utf8");
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          success: true,
          contentType: request.headers["content-type"],
          contentLength: Number(request.headers["content-length"] || 0),
          hasPrompt: payload.includes("transport form payload"),
          hasFilename: payload.includes("fixture.png")
        }));
      });
      return;
    }
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/ok") {
      response.end(JSON.stringify({ success: true, transport: "node-http" }));
      return;
    }
    if (request.url === "/cookie") {
      response.setHeader("set-cookie", ["session=transport-cookie; Path=/; HttpOnly", "preference=compact; Path=/"]);
      response.end(JSON.stringify({ success: true }));
      return;
    }
    if (request.url === "/retry") {
      retryRequests += 1;
      response.statusCode = retryRequests < 3 ? 503 : 200;
      response.end(JSON.stringify(retryRequests < 3
        ? { success: false, message: "temporary" }
        : { success: true, attempt: retryRequests }));
      return;
    }
    if (request.url === "/partial") {
      partialRequests += 1;
      if (partialRequests === 1) {
        response.flushHeaders();
        response.write('{"success":');
        setTimeout(() => response.destroy(), 10);
      } else {
        response.end(JSON.stringify({ success: true, attempt: partialRequests }));
      }
      return;
    }
    if (request.url === "/slow") {
      const timer = setTimeout(() => {
        if (!response.destroyed) response.end(JSON.stringify({ success: true }));
      }, 2_000);
      response.once("close", () => clearTimeout(timer));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ success: false }));
  });

  try {
    assert.equal(migrateSettings({ reasoningEffort: "ultra" }).reasoningEffort, "ultra");
    assert.equal(migrateSettings({ timeoutSeconds: "invalid" }).timeoutSeconds, 180);
    assert.equal(migrateSettings({ timeoutSeconds: 0 }).timeoutSeconds, 15);
    assert.equal(migrateSettings({ timeoutSeconds: Number.MAX_SAFE_INTEGER }).timeoutSeconds, 600);
    // 127.0.0.2 stays on the loopback interface but is intentionally not the
    // app's reserved 127.0.0.1 local-server address.
    await listen(server, "127.0.0.2");
    const address = server.address();
    assert(address && typeof address === "object");
    const settings = { serverUrl: `http://127.0.0.2:${address.port}` };

    const healthy = await newApiFetch(settings, "/ok", { timeoutMs: 1_000, retries: 0 });
    assert.equal(healthy.response.status, 200);
    assert.equal(healthy.data.transport, "node-http");

    const curlHealthy = await newApiTransportFetch(`${settings.serverUrl}/ok`, {
      method: "GET",
      forceCurl: true
    });
    assert.equal(curlHealthy.status, 200);
    assert.equal(JSON.parse(await curlHealthy.text()).transport, "node-http");

    const cookie = await newApiFetch(settings, "/cookie", { timeoutMs: 1_000, retries: 0 });
    assert.deepEqual(cookie.response.headers.getSetCookie(), [
      "session=transport-cookie; Path=/; HttpOnly",
      "preference=compact; Path=/"
    ]);

    const form = new FormData();
    form.append("prompt", "transport form payload");
    form.append("image", new Blob([Buffer.from("fixture-image")], { type: "image/png" }), "fixture.png");
    const uploaded = await newApiFetch(settings, "/form", {
      method: "POST",
      body: form,
      timeoutMs: 1_000,
      retries: 0
    });
    assert.match(uploaded.data.contentType, /^multipart\/form-data; boundary=/i);
    assert(uploaded.data.contentLength > 0);
    assert.equal(uploaded.data.hasPrompt, true);
    assert.equal(uploaded.data.hasFilename, true);

    const curlForm = new FormData();
    curlForm.append("prompt", "transport form payload");
    curlForm.append("image", new Blob([Buffer.from("fixture-image")], { type: "image/png" }), "fixture.png");
    const curlUploaded = await newApiTransportFetch(`${settings.serverUrl}/form`, {
      method: "POST",
      body: curlForm,
      forceCurl: true
    });
    const curlUploadData = JSON.parse(await curlUploaded.text());
    assert.equal(curlUploaded.status, 200);
    assert.match(curlUploadData.contentType, /^multipart\/form-data; boundary=/i);
    assert.equal(curlUploadData.hasPrompt, true);
    assert.equal(curlUploadData.hasFilename, true);

    const oversizedForm = new FormData();
    oversizedForm.append("image", new Blob([Buffer.alloc(2 * 1024 * 1024)], { type: "image/png" }), "oversized.png");
    await assert.rejects(
      () => newApiTransportFetch(`${settings.serverUrl}/form`, {
        method: "POST",
        body: oversizedForm,
        maxRequestBytes: 1 * 1024 * 1024,
        forceCurl: true
      }),
      (error) => error?.code === "NEW_API_REQUEST_TOO_LARGE"
    );

    const oversizedResponse = await newApiTransportFetch(`${settings.serverUrl}/large`, {
      method: "GET",
      maxResponseBytes: 1 * 1024 * 1024,
      forceCurl: true
    });
    await assert.rejects(() => oversizedResponse.text(), /安全上限/);

    const streamSettings = { ...settings, serverSessionCookie: "session=transport", serverUserId: "7" };
    const relayEvents = [];
    await newApiRelayStream(streamSettings, "/events", { input: "fixture" }, (event) => relayEvents.push(event));
    assert.equal(relayEvents.length, 1);
    assert.equal(relayEvents[0].type, "response.completed");
    assert.equal(relayEvents[0].done, true);
    await assert.rejects(
      () => newApiRelayStream(streamSettings, "/events-large", { input: "fixture" }, () => {}),
      (error) => error?.code === "NEW_API_SSE_EVENT_TOO_LARGE"
    );

    const recovered = await newApiFetch(settings, "/retry", { timeoutMs: 1_000, retries: 2 });
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.data.attempt, 3);
    assert.equal(retryRequests, 3);

    const recoveredPartial = await newApiFetch(settings, "/partial", { timeoutMs: 1_000, retries: 1 });
    assert.equal(recoveredPartial.response.status, 200);
    assert.equal(recoveredPartial.data.attempt, 2);
    assert.equal(partialRequests, 2);

    const startedAt = Date.now();
    await assert.rejects(
      () => newApiFetch(settings, "/slow", { timeoutMs: 120, retries: 0 }),
      (error) => error?.code === "NEW_API_TIMEOUT"
    );
    assert(Date.now() - startedAt < 1_500, "New API timeout must fail promptly instead of hanging the UI");

    await assert.rejects(
      () => newApiFetch(settings, "/slow-body", { timeoutMs: 120, retries: 0 }),
      (error) => error?.code === "NEW_API_TIMEOUT"
    );
    for (let attempt = 0; attempt < 20 && !slowBodyClosed; attempt += 1) await delay(10);
    assert.equal(slowBodyClosed, true, "A timeout after response headers must close the response body socket");

    const rejectedUpload = await newApiTransportFetch(`${settings.serverUrl}/reject-upload`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(8 * 1024 * 1024, 7),
      forceCurl: true
    });
    assert.equal(rejectedUpload.status, 413);
    assert.match(await rejectedUpload.text(), /too large/);

    const unconsumedController = new AbortController();
    const unconsumedStream = await newApiTransportFetch(`${settings.serverUrl}/stream`, {
      method: "GET",
      signal: unconsumedController.signal
    });
    unconsumedController.abort(new Error("unconsumed transport stream cancelled"));
    await assert.rejects(() => unconsumedStream.text(), /unconsumed transport stream cancelled|closed|aborted|cancel/i);

    const streamController = new AbortController();
    const stream = await newApiTransportFetch(`${settings.serverUrl}/stream`, {
      method: "GET",
      signal: streamController.signal
    });
    const streamIterator = stream.body[Symbol.asyncIterator]();
    const firstChunk = await streamIterator.next();
    assert.match(String(firstChunk.value), /ready/);
    streamController.abort(new Error("transport stream cancelled"));
    await assert.rejects(() => streamIterator.next(), /transport stream cancelled|aborted|cancel/i);

    const curlStreamController = new AbortController();
    const curlStream = await newApiTransportFetch(`${settings.serverUrl}/stream`, {
      method: "GET",
      signal: curlStreamController.signal,
      forceCurl: true
    });
    const curlIterator = curlStream.body[Symbol.asyncIterator]();
    assert.match(String((await curlIterator.next()).value), /ready/);
    curlStreamController.abort(new Error("curl transport stream cancelled"));
    await assert.rejects(() => curlIterator.next(), /curl transport stream cancelled|closed|aborted|cancel|curl/i);

    for (let attempt = 0; attempt < 40 && streamClosedCount < 3; attempt += 1) await delay(10);
    assert.equal(streamClosedCount, 3, "Aborting after response headers must close native and curl server sockets");
    for (let attempt = 0; attempt < 40 && activeNewApiCurlTransportCount() > 0; attempt += 1) await delay(10);
    assert.equal(activeNewApiCurlTransportCount(), 0, "Completed and cancelled curl requests must not remain active");

    return {
      ok: true,
      nodeHttpFetch: true,
      windowsCurlFetch: true,
      formData: true,
      cookieHeaders: true,
      responseAbort: true,
      retryRequests,
      partialResponseRetries: partialRequests,
      earlyUploadRejectionPreserved: true,
      requestAndResponseLimits: true,
      sseBoundaries: true,
      timeoutBounded: true,
    };
  } finally {
    await close(server);
  }
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  });
