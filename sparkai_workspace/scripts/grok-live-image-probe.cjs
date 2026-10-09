"use strict";

// Opt-in paid probe. The launcher receives the test key through stdin, passes
// it only in the child environment, and never reads account settings.
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const baseUrl = "https://supeai.top";
const model = "grok-imagine-image-2.0";
const prompt = "Doraemon, the cheerful blue robotic cat from the Japanese manga, full body, round blue head and body, white face and belly, red round nose, black whiskers, red collar with a golden bell, a white four-dimensional pocket on his belly. He smiles and waves one hand, clean colorful 2D cartoon illustration on a simple light background, no text, no lettering.";

if (!process.versions.electron) {
  if (!process.argv.includes("--live")) throw new Error("This paid probe requires --live and explicit user authorization.");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("Awaiting test credential on stdin; credential will not be printed or persisted.\n");
  let pending = "";
  let child;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (child) { child.stdin.write(chunk.replace(/\r/g, "\n")); return; }
    pending += chunk;
    const newline = pending.search(/[\r\n]/);
    if (newline < 0) return;
    const credential = pending.slice(0, newline).trim();
    const retainedInput = pending.slice(newline + 1);
    pending = "";
    if (!credential.startsWith("sk-")) { process.stderr.write("Invalid credential input.\n"); process.exit(1); }
    const childEnv = { ...process.env, SPARKAI_GROK_PROBE_KEY: credential };
    process.stdout.write("Credential accepted in memory; starting isolated Electron probe.\n");
    delete childEnv.ELECTRON_RUN_AS_NODE;
    child = spawn(require("electron"), [__filename, "--live-child"], {
      cwd: root, env: childEnv, stdio: ["pipe", "inherit", "inherit"], windowsHide: true
    });
    delete childEnv.SPARKAI_GROK_PROBE_KEY;
    if (retainedInput) child.stdin.write(retainedInput);
    child.once("exit", (code) => process.exit(code || 0));
    child.once("error", () => { process.stderr.write("Probe process failed to start.\n"); process.exit(1); });
  });
} else {
  const { app, nativeImage } = require("electron");
  const apiKey = process.env.SPARKAI_GROK_PROBE_KEY || "";
  delete process.env.SPARKAI_GROK_PROBE_KEY;
  if (!apiKey || !process.argv.includes("--live-child")) throw new Error("Missing in-memory test credential.");
  const runDir = path.join(root, ".diagnostics", "electron", `grok-live-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const configDir = path.join(runDir, "config");
  const projectDir = path.join(runDir, "project");
  const projectId = "grok-live-probe";
  for (const directory of [configDir, projectDir, path.join(runDir, "user-data")]) mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(configDir, "project-list.json"), JSON.stringify({
    activeProjectId: projectId, projects: [{ id: projectId, name: "Grok Live Probe", path: projectDir, external: true, sessionPath: path.join(projectDir, "session.json") }]
  }));
  process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
  process.env.NAIMAGE_CONFIG_DIR = configDir;
  process.env.NAIMAGE_DEBUG_DIR = path.join(runDir, "runtime");
  app.commandLine.appendSwitch("user-data-dir", path.join(runDir, "user-data"));
  const { writeServerImageOutputs, extractServerImages, imageGenerationContext } = require("../electron-main.cjs");
  const { createNewApiTransport } = require("../desktop/new-api-transport.cjs");
  const { createNewApiClient } = require("../desktop/new-api-client.cjs");
  const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
  const { detectEncodedImageFormat } = require("../runtime/encoded-image-format.cjs");
  const report = { ok: false, baseUrl, model, subject: "Doraemon", realGenerationRequests: 0, creationRetries: 0, network: [], materializations: [] };
  let result;

  function emit(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
  function save() {
    report.reportPath = path.join(runDir, "report.json");
    writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  function safeError(error) {
    const codes = new Set();
    const pending = [error];
    const seen = new Set();
    while (pending.length && seen.size < 24) {
      const current = pending.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      if (/^(?:E[A-Z_]+|NEW_API_[A-Z_]+|NAIMAGE_[A-Z_]+|IMAGE_[A-Z_]+|ABORT_ERR)$/.test(String(current.code || ""))) codes.add(current.code);
      if (current.cause) pending.push(current.cause);
      if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 8));
    }
    return { codes: [...codes], status: Number(error?.status) || undefined, generationCompleted: error?.generationCompleted === true, unsafeToRetry: error?.unsafeToRetry === true };
  }
  const knownKeys = new Set(["data", "result", "images", "output", "response", "b64_json", "url", "image_url", "image_base64", "base64", "inlineData", "inline_data", "mime_type", "mimeType", "created", "model", "usage", "revised_prompt", "error", "message", "code", "type", "width", "height", "object", "index", "task_id", "status", "success"]);
  function shape(value, depth = 0) {
    if (depth > 5) return { type: typeof value };
    if (Array.isArray(value)) return { type: "array", count: value.length, first: shape(value[0], depth + 1) };
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => knownKeys.has(key)).slice(0, 24).map(([key, child]) => [key, shape(child, depth + 1)]));
    return { type: typeof value, ...(typeof value === "string" ? { length: value.length, httpUrl: /^https?:\/\//i.test(value), dataUrl: /^data:image\//i.test(value) } : {}) };
  }

  async function materialize(images = result?.images, label = "main") {
    if (!images?.length) { emit({ event: "no-result" }); return; }
    const entry = { label, startedAt: new Date().toISOString() };
    try {
      const outputs = await writeServerImageOutputs(images, `grok-real-${label}`, "grok-live", projectId, "png", imageGenerationContext({}, result, "png"));
      entry.outputs = outputs.map((output, index) => {
        const bytes = readFileSync(output.path);
        const decoded = nativeImage.createFromBuffer(bytes);
        if (decoded.isEmpty()) throw new Error("Image decode failed.");
        const original = report.providerImages?.[index];
        const providerBytesIdentical = original ? bytes.equals(readFileSync(original.path)) : undefined;
        if (original && !providerBytesIdentical) throw new Error("Managed output changed the provider's original bytes.");
        return { path: output.path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: output.mimeType, outputFormat: output.outputFormat, providerBytesIdentical, ...decoded.getSize() };
      });
      entry.ok = true;
      report.ok = true;
    } catch (error) { entry.ok = false; entry.error = safeError(error); }
    report.materializations.push(entry);
    save();
    emit({ event: "materialized", ...entry, reportPath: report.reportPath });
  }

  async function main() {
    await app.whenReady();
    const transport = createNewApiTransport({ app, windowsCurlPath: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe") });
    const client = createNewApiClient({
      accessPolicy: { customApiAccess: true },
      normalizeServerUrl: (value, fallback = "") => String(value || fallback).trim().replace(/\/+$/, ""),
      isLocalServerUrl: () => false,
      log: (message) => emit({ event: "client", message }),
      newApiTransportFetch: async (url, options) => {
        if (options.method === "POST") {
          report.realGenerationRequests += 1;
          if (report.realGenerationRequests > 1) throw new Error("Probe forbids repeat generation.");
          const body = JSON.parse(options.body);
          report.request = { endpoint: new URL(url).pathname, model: body.model, n: body.n, aspect_ratio: body.aspect_ratio, resolution: body.resolution, quality: body.quality, response_format: body.response_format };
          emit({ event: "creating", request: report.request });
          save();
        }
        const response = await transport.newApiTransportFetch(url, options);
        report.network.push({ method: options.method, status: response.status, contentType: response.headers.get("content-type") });
        return response;
      }
    });
    const service = createImageGenerationService({
      accessPolicy: { customApiAccess: true },
      newApiRelayJson: async (...args) => {
        const raw = await client.newApiRelayJson(...args);
        report.responseShape = shape(raw);
        save();
        emit({ event: "provider-response", status: report.network.at(-1)?.status, shape: report.responseShape });
        return raw;
      }
    });
    const settings = { accessMode: "custom", imageBaseUrl: baseUrl, imageApiKey: apiKey, imageModelBindings: [{ model, protocol: "xai-images", gateway: "newapi", transportMode: "sync" }] };
    try {
      result = await service.generate(settings, { model, prompt, n: 1, quality: "low", ratio: "1:1", resolution: "1K" });
      report.normalized = result.images.map((image) => ({ type: image.type, mimeType: image.mimeType, valueLength: image.value.length, httpUrl: /^https?:\/\//i.test(image.value), ...(image.type === "base64" ? { detected: detectEncodedImageFormat(Buffer.from(image.value.replace(/^data:image\/[^;]+;base64,/, ""), "base64")) } : {}) }));
      report.providerImages = result.images.filter((image) => image.type === "base64").map((image, index) => {
        const bytes = Buffer.from(image.value.replace(/^data:image\/[^;]+;base64,/, ""), "base64");
        const detected = detectEncodedImageFormat(bytes);
        const decoded = nativeImage.createFromBuffer(bytes);
        if (!detected || decoded.isEmpty()) throw new Error("Provider image decode failed.");
        const filePath = path.join(runDir, `provider-original-${index + 1}${detected.extension}`);
        writeFileSync(filePath, bytes);
        return { path: filePath, bytes: bytes.length, mimeType: detected.mimeType, sha256: createHash("sha256").update(bytes).digest("hex"), ...decoded.getSize() };
      });
      save();
      emit({ event: "normalized", images: report.normalized });
      await materialize(extractServerImages(result));
    } catch (error) { report.generationError = safeError(error); save(); emit({ event: "generation-failed", error: report.generationError, reportPath: report.reportPath }); }
    save();
    emit({ event: "finished", ok: report.ok, realGenerationRequests: report.realGenerationRequests, reportPath: report.reportPath });
    app.exit(report.ok ? 0 : 1);
  }
  main().catch((error) => { report.fatalError = safeError(error); save(); emit({ event: "fatal", error: report.fatalError, reportPath: report.reportPath }); app.exit(1); });
}
