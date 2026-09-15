"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  createPublicHttpDownloadAdmission,
  downloadPublicHttpBuffer,
  isPublicIpAddress,
  parsePublicHttpUrl,
  resolvePublicHttpTarget
} = require("../desktop/public-http-resource.cjs");
const { loadRecordedRemoteAssetProxy, remoteUrlFromAssetProxy } = require("../desktop/remote-asset-proxy.cjs");

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:4700:4700::1111";

function expectedCode(code) {
  return (error) => error?.code === code;
}

function mappedLookup(recordsByHost, calls = []) {
  return async (hostname) => {
    const normalized = String(hostname || "").replace(/\.$/, "").toLowerCase();
    calls.push(normalized);
    const records = recordsByHost[normalized];
    if (!records) {
      const error = new Error(`No fixture DNS record for ${normalized}`);
      error.code = "ENOTFOUND";
      throw error;
    }
    return records.map((record) => ({ ...record }));
  };
}

function fakeRequester(routes, observations = []) {
  return (url, options, onResponse) => {
    const request = new EventEmitter();
    let destroyed = false;
    request.end = () => {
      queueMicrotask(() => {
        options.lookup(url.hostname, { all: true }, (lookupError, pinnedAddresses) => {
          if (lookupError) {
            request.emit("error", lookupError);
            return;
          }
          const key = url.toString();
          const route = routes[key];
          if (!route) {
            request.emit("error", new Error(`No fixture route for ${key}`));
            return;
          }
          assert.equal(options.agent, false, "Remote asset downloads must not reuse a shared connection pool");
          const socket = new EventEmitter();
          socket.connecting = false;
          socket.remoteAddress = route.socketAddress || pinnedAddresses[0].address;
          socket.destroy = (error) => {
            destroyed = true;
            if (error) queueMicrotask(() => request.emit("error", error));
          };
          request.emit("socket", socket);
          if (destroyed) return;
          observations.push({ url: key, pinnedAddresses: pinnedAddresses.map((record) => ({ ...record })) });
          const chunks = route.chunks || (route.body === undefined ? [] : [Buffer.from(route.body)]);
          const response = Readable.from(chunks);
          response.statusCode = route.statusCode ?? 200;
          response.headers = { ...(route.headers || {}) };
          response.socket = socket;
          onResponse(response);
        });
      });
    };
    request.destroy = (error) => {
      destroyed = true;
      if (error) queueMicrotask(() => request.emit("error", error));
    };
    return request;
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const { remoteAssetDisplaySource } = await import("../src/remote-asset-source.ts");
  const remoteDisplaySource = remoteAssetDisplaySource("https://images.example/item.png?token=a&size=2");
  const remoteDisplayUrl = new URL(remoteDisplaySource);
  assert.equal(remoteDisplayUrl.protocol, "naimage-asset:");
  assert.equal(remoteDisplayUrl.hostname, "remote");
  assert.equal(decodeURIComponent(remoteDisplayUrl.pathname.replace(/^\/+/, "")), "https://images.example/item.png?token=a&size=2");
  assert.equal(remoteAssetDisplaySource("naimage-asset://local/output/image.png"), "naimage-asset://local/output/image.png");
  assert.equal(remoteAssetDisplaySource("data:image/png;base64,AA=="), "data:image/png;base64,AA==");
  assert.equal(remoteUrlFromAssetProxy(remoteDisplaySource), "https://images.example/item.png?token=a&size=2");
  await assert.rejects(
    loadRecordedRemoteAssetProxy(remoteDisplaySource, {
      isRecorded: () => false,
      download: () => { throw new Error("must not download"); }
    }),
    expectedCode("NAIMAGE_REMOTE_PROXY_NOT_RECORDED")
  );
  const proxyFixture = Buffer.from("proxy-png-fixture");
  let proxyValidated = 0;
  const loadedProxy = await loadRecordedRemoteAssetProxy(remoteDisplaySource, {
    isRecorded: (value) => value === "https://images.example/item.png?token=a&size=2",
    download: async () => proxyFixture,
    detectFormat: () => ({ extension: ".png", mimeType: "image/png" }),
    validateDimensions: () => { proxyValidated += 1; },
    isDecodable: () => true
  });
  assert.equal(loadedProxy.buffer, proxyFixture);
  assert.equal(loadedProxy.mimeType, "image/png");
  assert.equal(proxyValidated, 1);

  const indexHtml = readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const cspContent = indexHtml.match(/Content-Security-Policy[\s\S]*?content="([^"]+)"/)?.[1] || "";
  const imageSourceDirective = cspContent.split(";").find((directive) => directive.trim().startsWith("img-src")) || "";
  assert.match(imageSourceDirective, /naimage-asset:/);
  assert.doesNotMatch(imageSourceDirective, /\bhttps?:/i, "Renderer images must not bypass the managed asset protocol");

  const electronMainSource = readFileSync(path.join(projectRoot, "electron-main.cjs"), "utf8");
  const outputWriterStart = electronMainSource.indexOf("async function writeServerImageOutputs");
  const outputWriterEnd = electronMainSource.indexOf("function sanitizeFileStem", outputWriterStart);
  const outputWriterSource = electronMainSource.slice(outputWriterStart, outputWriterEnd);
  assert(outputWriterStart >= 0 && outputWriterEnd > outputWriterStart);
  assert.match(outputWriterSource, /remoteImageDownloads\.download\(image\.value/);
  assert.doesNotMatch(outputWriterSource, /type:\s*["']url["']/, "Generated remote results must be materialized before entering the canvas");
  assert.match(electronMainSource, /loadRecordedRemoteAssetProxy\(url/);
  const serverIpcSource = readFileSync(path.join(projectRoot, "desktop", "ipc", "server-ipc.cjs"), "utf8");
  assert.match(
    serverIpcSource,
    /const assets = await writeServerImageOutputs\(/,
    "Renderer generation must await validated image materialization before returning assets"
  );

  let admittedActive = 0;
  let admittedMaximum = 0;
  let admittedCalls = 0;
  const admission = createPublicHttpDownloadAdmission({
    maxConcurrent: 2,
    download: async (value) => {
      admittedCalls += 1;
      admittedActive += 1;
      admittedMaximum = Math.max(admittedMaximum, admittedActive);
      await new Promise((resolve) => setTimeout(resolve, 12));
      admittedActive -= 1;
      return Buffer.from(String(value));
    }
  });
  const admittedResults = await Promise.all([
    admission.download("https://one.example/image", { maxBytes: 64 }),
    admission.download("https://one.example/image", { maxBytes: 64 }),
    admission.download("https://two.example/image", { maxBytes: 64 }),
    admission.download("https://three.example/image", { maxBytes: 64 })
  ]);
  assert.deepEqual(admittedResults.map((buffer) => buffer.toString()), [
    "https://one.example/image",
    "https://one.example/image",
    "https://two.example/image",
    "https://three.example/image"
  ]);
  assert.equal(admittedCalls, 3, "Identical in-flight remote assets must share one download");
  assert.equal(admittedMaximum, 2, "Remote image materialization must use bounded concurrency");
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, inFlight: 0, maxConcurrent: 2, maxQueued: 256 });

  assert.equal(isPublicIpAddress(PUBLIC_V4), true);
  assert.equal(isPublicIpAddress(PUBLIC_V6), true);
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1"
  ]) assert.equal(isPublicIpAddress(address), false, `${address} must not be considered public`);

  assert.equal(parsePublicHttpUrl("https://example.com/image.png").protocol, "https:");
  assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"), expectedCode("NAIMAGE_REMOTE_URL_PROTOCOL"));
  assert.throws(() => parsePublicHttpUrl("https://user:secret@example.com/image.png"), expectedCode("NAIMAGE_REMOTE_URL_CREDENTIALS"));

  const localUrls = [
    "http://localhost/image.png",
    "http://sub.localhost/image.png",
    "http://127.0.0.1/image.png",
    "http://2130706433/image.png",
    "http://0x7f000001/image.png",
    "http://017700000001/image.png",
    "http://%31%32%37.0.0.1/image.png",
    "http://127%2e0%2e0%2e1/image.png",
    "http://%6c%6f%63%61%6c%68%6f%73%74/image.png",
    "http://[::1]/image.png",
    "http://[::ffff:127.0.0.1]/image.png"
  ];
  for (const url of localUrls) {
    await assert.rejects(resolvePublicHttpTarget(url), expectedCode("NAIMAGE_REMOTE_ADDRESS_BLOCKED"));
  }

  const mixedLookupCalls = [];
  await assert.rejects(
    resolvePublicHttpTarget("https://mixed.example/image.png", {
      lookup: mappedLookup({
        "mixed.example": [
          { address: PUBLIC_V4, family: 4 },
          { address: "10.20.30.40", family: 4 }
        ]
      }, mixedLookupCalls)
    }),
    expectedCode("NAIMAGE_REMOTE_ADDRESS_BLOCKED")
  );
  assert.deepEqual(mixedLookupCalls, ["mixed.example"]);

  const lookupCalls = [];
  const observations = [];
  const lookup = mappedLookup({
    "origin.example": [{ address: PUBLIC_V4, family: 4 }],
    "cdn.example": [{ address: PUBLIC_V6, family: 6 }],
    "private.example": [{ address: "169.254.169.254", family: 4 }]
  }, lookupCalls);
  const request = fakeRequester({
    "https://origin.example/start": {
      statusCode: 302,
      headers: { location: "https://cdn.example/final" }
    },
    "https://cdn.example/final": {
      statusCode: 200,
      headers: { "content-length": "12" },
      body: "public-image"
    }
  }, observations);
  const downloaded = await downloadPublicHttpBuffer("https://origin.example/start", {
    maxBytes: 64,
    lookup,
    request
  });
  assert.equal(downloaded.toString(), "public-image");
  assert.deepEqual(lookupCalls, ["origin.example", "cdn.example"]);
  assert.deepEqual(observations.map((item) => item.pinnedAddresses), [
    [{ address: PUBLIC_V4, family: 4 }],
    [{ address: PUBLIC_V6, family: 6 }]
  ]);

  const blockedRedirectObservations = [];
  await assert.rejects(
    downloadPublicHttpBuffer("https://origin.example/private-redirect", {
      maxBytes: 64,
      lookup,
      request: fakeRequester({
        "https://origin.example/private-redirect": {
          statusCode: 302,
          headers: { location: "http://private.example/latest/meta-data" }
        }
      }, blockedRedirectObservations)
    }),
    expectedCode("NAIMAGE_REMOTE_ADDRESS_BLOCKED")
  );
  assert.equal(blockedRedirectObservations.length, 1, "The private redirect target must be rejected before a second request");

  let rebindingLookups = 0;
  const rebindingPinned = [];
  const rebindingBody = await downloadPublicHttpBuffer("https://rebind.example/image", {
    maxBytes: 64,
    lookup: async () => {
      rebindingLookups += 1;
      return rebindingLookups === 1
        ? [{ address: PUBLIC_V4, family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    request: fakeRequester({
      "https://rebind.example/image": { body: "pinned" }
    }, rebindingPinned)
  });
  assert.equal(rebindingBody.toString(), "pinned");
  assert.equal(rebindingLookups, 1, "The socket lookup must use the already verified result instead of resolving again");
  assert.deepEqual(rebindingPinned[0].pinnedAddresses, [{ address: PUBLIC_V4, family: 4 }]);

  await assert.rejects(
    downloadPublicHttpBuffer("https://origin.example/socket-mismatch", {
      maxBytes: 64,
      lookup,
      request: fakeRequester({
        "https://origin.example/socket-mismatch": { body: "unsafe", socketAddress: "127.0.0.1" }
      })
    }),
    expectedCode("NAIMAGE_REMOTE_SOCKET_ADDRESS_MISMATCH")
  );

  await assert.rejects(
    downloadPublicHttpBuffer("https://origin.example/too-large-header", {
      maxBytes: 4,
      lookup,
      request: fakeRequester({
        "https://origin.example/too-large-header": { headers: { "content-length": "5" }, body: "12345" }
      })
    }),
    expectedCode("NAIMAGE_REMOTE_RESPONSE_TOO_LARGE")
  );
  await assert.rejects(
    downloadPublicHttpBuffer("https://origin.example/too-large-stream", {
      maxBytes: 4,
      lookup,
      request: fakeRequester({
        "https://origin.example/too-large-stream": { chunks: [Buffer.from("12"), Buffer.from("345")] }
      })
    }),
    expectedCode("NAIMAGE_REMOTE_RESPONSE_TOO_LARGE")
  );
  await assert.rejects(
    downloadPublicHttpBuffer("https://origin.example/loop-a", {
      maxBytes: 64,
      maxRedirects: 1,
      lookup,
      request: fakeRequester({
        "https://origin.example/loop-a": { statusCode: 302, headers: { location: "/loop-b" } },
        "https://origin.example/loop-b": { statusCode: 302, headers: { location: "/loop-a" } }
      })
    }),
    expectedCode("NAIMAGE_REMOTE_REDIRECT_LIMIT")
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    publicAddressFamilies: [4, 6],
    directLocalUrlsRejected: localUrls.length,
    mixedDnsRejected: true,
    redirectHopValidation: true,
    dnsRebindingPinned: true,
    socketAddressVerified: true,
    sharedAgentDisabled: true,
    generatedUrlsMaterialized: true,
    rendererDirectRemoteBlocked: true,
    legacyRemoteProxyRecordedOnly: true,
    legacyRemoteProxyContract: true,
    boundedDownloadAdmission: true,
    inFlightUrlDeduplication: true,
    responseLimits: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
