"use strict";

const assert = require("node:assert/strict");
const dns = require("node:dns");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { Readable } = require("node:stream");
const path = require("node:path");
const { PNG } = require("pngjs");
const sharp = require("sharp");
const { app } = require("electron");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".diagnostics", "electron", `image-result-download-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = path.join(runDir, "config");
const projectDir = path.join(runDir, "project");
for (const directory of [configDir, projectDir, path.join(runDir, "user-data")]) mkdirSync(directory, { recursive: true });
const projectId = "offline-grok-download";
writeFileSync(path.join(configDir, "project-list.json"), JSON.stringify({
  activeProjectId: projectId,
  projects: [{ id: projectId, name: "Offline Grok Download", path: projectDir, sessionPath: path.join(projectDir, "session.json"), external: true }]
}));
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = configDir;
process.env.NAIMAGE_DEBUG_DIR = path.join(runDir, "runtime");
app.commandLine.appendSwitch("user-data-dir", path.join(runDir, "user-data"));
const { writeServerImageOutputs, extractServerImages, imageGenerationContext } = require("../electron-main.cjs");
const { detectEncodedImageFormat } = require("../runtime/encoded-image-format.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");

async function main() {
  await app.whenReady();
  const png = PNG.sync.write({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 255) });
  const url = "https://offline-image.example/result.png?token=private-fixture-signature";
  let generated = 0;
  let downloads = 0;
  let downloadFails = true;
  let ignoreInlineFormat = false;
  const originalLookup = dns.promises.lookup;
  const originalRequest = https.request;
  dns.promises.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  https.request = (_url, options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      downloads += 1;
      options.lookup("offline-image.example", { all: true }, (lookupError, addresses) => {
        assert.ifError(lookupError);
        assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
      });
      if (downloadFails) {
        request.emit("error", new AggregateError([
          Object.assign(new Error(url), { code: "ETIMEDOUT" }),
          Object.assign(new Error("Bearer private-fixture-key"), { code: "ENETUNREACH" })
        ]));
        return;
      }
      const socket = new EventEmitter();
      socket.connecting = false;
      socket.remoteAddress = "93.184.216.34";
      request.emit("socket", socket);
      const response = Readable.from([png]);
      response.statusCode = 200;
      response.headers = { "content-length": String(png.length) };
      response.socket = socket;
      onResponse(response);
    });
    return request;
  };
  try {
    const service = createImageGenerationService({
      newApiRelayJson: async (_settings, _endpoint, body) => {
        generated += 1;
        return { data: [body.response_format === "b64_json" && !ignoreInlineFormat
          ? { b64_json: png.toString("base64") }
          : { url }] };
      }
    });
    const settings = { accessMode: "custom", imageModelBindings: [{ model: "grok-imagine-image-2.0", protocol: "xai-images", gateway: "newapi", transportMode: "sync" }] };
    const request = { model: "grok-imagine-image-2.0", prompt: "offline result pipeline" };
    const inline = await service.generate(settings, request);
    assert.equal(inline.images[0].type, "base64");
    const inlineAssets = await writeServerImageOutputs(inline.images, "inline", "inline-run", projectId);
    assert.equal(downloads, 0, "Inline Grok results must materialize without a CDN request");
    assert.deepEqual(readFileSync(inlineAssets[0].path), png);
    assert.equal(path.relative(projectDir, inlineAssets[0].path).startsWith(".."), false);

    const jpeg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp({ lossless: true }).toBuffer();
    const retainedFormats = [];
    for (const protocol of ["openai-images", "xai-images", "gemini-native"]) {
      for (const [format, bytes] of Object.entries({ png, jpeg, webp })) {
        // Channel aliases and deliberately wrong MIME/format metadata verify
        // the saved format follows actual bytes for every selected Adapter.
        const fixtureService = createImageGenerationService({ newApiRelayJson: async () => ({ data: [{ b64_json: bytes.toString("base64"), mime_type: "image/png", output_format: "png" }] }) });
        const fixtureSettings = { imageModelBindings: [{ model: "channel-alias", protocol, gateway: "newapi", transportMode: "sync" }] };
        const data = await fixtureService.generate(fixtureSettings, { model: "channel-alias", prompt: "encoding fixture" });
        const outputs = await writeServerImageOutputs(extractServerImages(data), `${protocol}-${format}`, "format-run", projectId, "png", imageGenerationContext({}, data));
        const saved = readFileSync(outputs[0].path);
        const expected = detectEncodedImageFormat(bytes);
        assert.deepEqual(saved, bytes, "Provider image bytes must be retained without any encoding conversion");
        assert.equal(outputs[0].mimeType, expected.mimeType);
        assert.equal(outputs[0].outputFormat, format);
        assert.equal(path.extname(outputs[0].path), expected.extension);
        assert.equal(outputs[0].generation.request.outputFormat, "png");
        assert.equal(outputs[0].generation.response.outputFormat, format, "Actual bytes override inaccurate upstream format metadata");
        assert.deepEqual({ width: outputs[0].width, height: outputs[0].height }, { width: 8, height: 8 });
        retainedFormats.push({ protocol, format });
      }
    }
    const pngDespiteWebp = await writeServerImageOutputs(inline.images, "png-despite-webp", "format-run", projectId, "webp");
    assert.deepEqual(readFileSync(pngDespiteWebp[0].path), png, "A different requested encoding must not alter a PNG result either");
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(100_000, 16);
    oversized.writeUInt32BE(100_000, 20);
    const invalidResults = [
      { name: "invalid", bytes: Buffer.from("invalid-image-data"), code: "NAIMAGE_IMAGE_OUTPUT_FORMAT_INVALID" },
      { name: "empty", bytes: Buffer.alloc(0), code: "NAIMAGE_IMAGE_OUTPUT_SIZE_INVALID" },
      { name: "corrupt-png", bytes: png.subarray(0, 12) },
      { name: "corrupt-webp", bytes: webp.subarray(0, 20) },
      { name: "oversized-dimensions", bytes: oversized }
    ];
    for (const invalid of invalidResults) {
      await assert.rejects(writeServerImageOutputs([{ type: "base64", value: invalid.bytes.toString("base64") }], invalid.name, "format-run", projectId), (error) => {
        if (invalid.code) assert.equal(error.code, invalid.code);
        assert.equal(error.errorCategory, "image_result_processing");
        assert.equal(error.generationCompleted, true);
        assert.equal(error.unsafeToRetry, true);
        return true;
      });
    }

    ignoreInlineFormat = true;
    const remote = await service.generate(settings, request);
    let failure;
    await assert.rejects(writeServerImageOutputs(remote.images, "failed", "failed-run", projectId), (error) => {
      failure = error;
      assert.equal(error.errorCategory, "image_result_download");
      assert.equal(error.unsafeToRetry, true);
      assert.equal(error.generationCompleted, true);
      assert.match(error.message, /ETIMEDOUT.*ENETUNREACH/);
      assert.doesNotMatch(error.message, /private-fixture|https:|Bearer/);
      return true;
    });
    assert.equal(generated, 2, "Downloading an already generated result must not invoke the generation provider again");
    assert.equal(downloads, 1);

    downloadFails = false;
    const explicitUrl = await service.generate(settings, { ...request, responseFormat: "url" });
    const urlAssets = await writeServerImageOutputs(explicitUrl.images, "url", "url-run", projectId);
    assert.deepEqual(readFileSync(urlAssets[0].path), png);
    const report = {
      ok: true, inlineImageSaved: true, publicUrlSaved: true, emptyAggregateErrorClassified: true,
      originalBytesRetained: retainedFormats, requestedFormatMismatchAccepted: true, corruptImageRejected: true, oversizedImageRejected: true, processingFailureNotRetriable: true,
      failure: { code: failure.code, errorCategory: failure.errorCategory, unsafeToRetry: failure.unsafeToRetry, generationCompleted: failure.generationCompleted, message: failure.message },
      generationCalls: generated, downloadCalls: downloads, realModelRequests: 0, realNetworkRequests: 0
    };
    writeFileSync(path.join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ...report, reportPath: path.join(runDir, "report.json") })}\n`);
  } finally {
    dns.promises.lookup = originalLookup;
    https.request = originalRequest;
  }
}

main().then(() => app.exit(0)).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
