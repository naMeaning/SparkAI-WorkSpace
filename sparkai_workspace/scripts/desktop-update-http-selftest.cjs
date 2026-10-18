"use strict";
// Loopback only: real client + transport + updater, ephemeral signing identity.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const rawFs = require("original-fs");
const { app } = require("electron");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");
const { createNewApiTransport } = require("../desktop/new-api-transport.cjs");
const { createDesktopUpdaterService } = require("../desktop/updater-service.cjs");
const { registerUpdateIpc } = require("../desktop/ipc/update-ipc.cjs");
const { canonicalDesktopRelease } = require("../update-release.cjs");
const { windowsInstallerArtifactName, ACCESS_VARIANT_DUAL } = require("../runtime/access-variant.cjs");
const metadata = require("../package.json");
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".diagnostics", `update-http-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(runDir, { recursive: true });
const pair = generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.NAIMAGE_UPDATE_PUBLIC_KEY = path.join(runDir, "public.pem");
fs.writeFileSync(process.env.NAIMAGE_UPDATE_PUBLIC_KEY, pair.publicKey);
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = path.join(runDir, "config");
const { migrateSettings } = require("../electron-main.cjs");
const release = { schema_version: 1, product: "naimage-studio", channel: "stable", version: metadata.version,
  published_at: "2026-10-17T00:00:00Z", minimum_version: "1.0.0", compatibility: metadata.naimageUpdateCompatibility, notes: [],
  restart: { filename: `naimage-Restart-Update-${metadata.version}-x64.asar`, sha256: "a".repeat(64), size: 1024 },
  installer: { filename: windowsInstallerArtifactName(metadata.version, ACCESS_VARIANT_DUAL), sha256: "b".repeat(64), size: 2048 } };
const signed = { ...release, current_version: metadata.version, latest_version: metadata.version, update_available: false,
  update_type: "none", signature: sign(null, Buffer.from(canonicalDesktopRelease(release)), pair.privateKey).toString("base64") };
let mode = "success", settings, server, requests = [], activeRelease = signed, base;
let downloadMode = "success", downloadAttempts = 0, authorizeMode = "success";
const restartBytes = Buffer.alloc(32 * 1024, 37);
let installerBytes = Buffer.alloc(16 * 1024, 61);
const progressEvents = [];
const report = { ok: false, realModelRequests: 0, checks: [], requests };
const check = async (name, action) => { await action(); report.checks.push(name); };
function futureRelease(kind = "restart", version = "99.0.0") {
  const value = { ...release, version,
    restart: { filename: `naimage-Restart-Update-${version}-x64.asar`, sha256: createHash("sha256").update(restartBytes).digest("hex"), size: restartBytes.length },
    installer: { filename: windowsInstallerArtifactName(version, ACCESS_VARIANT_DUAL), sha256: createHash("sha256").update(installerBytes).digest("hex"), size: installerBytes.length } };
  return { ...value, current_version: metadata.version, latest_version: version, update_available: true,
    update_type: kind, artifact: { ...value[kind], kind, version },
    signature: sign(null, Buffer.from(canonicalDesktopRelease(value)), pair.privateKey).toString("base64") };
}
const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
const inside = (file, parent) => file === path.resolve(parent) || file.startsWith(`${path.resolve(parent)}${path.sep}`);
function handlerFixture(service) {
  const handlers = new Map();
  registerUpdateIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, desktopUpdater: service });
  return (name, payload) => handlers.get(`naimage:update:${name}`)({}, payload);
}
async function main() {
  await app.whenReady();
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push({ method: req.method, path: url.pathname, ...(req.headers.range ? { range: req.headers.range } : {}) });
    assert.equal(req.headers["x-naimage-desktop-product"], "naimage-studio");
    assert.equal(req.headers.cookie, "session=loopback-fixture");
    if (url.pathname === "/api/desktop-update/authorize") {
      assert.equal(req.method, "POST");
      const target = authorizeMode === "foreign" ? "https://untrusted.invalid/downloads/naimage-studio/file.asar"
        : authorizeMode === "path" ? `${base}/untrusted/file.asar` : `${base}/downloads/naimage-studio/${activeRelease.restart.filename}`;
      json(res, { release: activeRelease, download_url: target }); return;
    }
    if (url.pathname === "/api/desktop-download/captcha") {
      assert.equal(req.method, "POST");
      json(res, { challenge_id: "local-challenge", image_data_url: "data:image/png;base64,iVBORw0KGgo=", expires_in: 120, installer: activeRelease.installer }); return;
    }
    if (url.pathname === "/api/desktop-download/authorize") {
      assert.equal(req.method, "POST");
      let body = ""; req.on("data", part => { body += part; }); req.on("end", () => {
        const parsed = JSON.parse(body); assert.equal(parsed.product, "naimage-studio"); assert.equal(parsed.challenge_id, "local-challenge");
        if (parsed.code !== "123456") { json(res, { error: "验证码错误" }, 403); return; }
        json(res, { installer: activeRelease.installer, download_url: `${base}/downloads/naimage-studio/${activeRelease.installer.filename}` });
      }); return;
    }
    if (url.pathname.startsWith("/downloads/naimage-studio/")) {
      assert.equal(req.method, "GET"); downloadAttempts += 1;
      if (downloadMode === "missing") { json(res, { error: "fixture unavailable" }, 404); return; }
      const original = url.pathname.endsWith(".asar") ? restartBytes : installerBytes;
      const bytes = downloadMode === "corrupt" ? Buffer.alloc(original.length, 12) : original;
      const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range || "")?.[1] || 0);
      if (downloadMode === "range-mismatch" && downloadAttempts === 1) {
        res.writeHead(206, { "content-range": `bytes ${start + 1}-${bytes.length - 1}/${bytes.length}`, "content-length": bytes.length - start });
        res.end(bytes.subarray(start)); return;
      }
      const code = req.headers.range ? 206 : 200;
      const headers = { "content-length": bytes.length - start, "content-type": "application/octet-stream" };
      if (code === 206) headers["content-range"] = `bytes ${start}-${bytes.length - 1}/${bytes.length}`;
      res.writeHead(code, headers);
      if (downloadMode === "slow") {
        res.write(bytes.subarray(start, start + 1024));
        setTimeout(() => res.end(bytes.subarray(start + 1024)), 300);
      } else res.end(bytes.subarray(start));
      return;
    }
    assert.equal(url.pathname, "/api/desktop-update/check"); assert.equal(req.method, "GET");
    if (mode === "disconnect") { req.socket.destroy(); return; }
    res.setHeader("content-type", "application/json");
    if (mode === "route" || mode === "method") { res.statusCode = mode === "route" ? 404 : 405; res.end(JSON.stringify({ error: "Invalid URL (GET /api/desktop-update/check)" })); }
    else if (mode === "server-error") res.end(JSON.stringify({ success: false, message: "Invalid URL (GET /api/desktop-update/check)" }));
    else if (mode === "html") res.end("<html>proxy login</html>");
    else if (mode === "schema") res.end(JSON.stringify({ product: "wrong" }));
    else if (mode === "signature") res.end(JSON.stringify({ ...signed, notes: ["tampered"] }));
    else res.end(JSON.stringify(activeRelease));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const defaults = { accountBaseUrl: base, updateBaseUrl: base };
  settings = { ...defaults, serverSessionCookie: "session=loopback-fixture", serverUserId: "7" };
  const transport = createNewApiTransport({ app });
  const client = createNewApiClient({ defaultSettings: defaults, migrateSettings: value => value,
    readJson: () => settings, writeJson: () => {}, settingsPath: "unused", normalizeServerUrl: (value, fallback) => String(value || fallback || "").trim().replace(/\/+$/, ""),
    ensureLocalServer: async () => {}, isLocalServerUrl: () => false, newApiTransportFetch: transport.newApiTransportFetch });
  const makeService = (name = "updater", appOverride = app) => createDesktopUpdaterService({ app: appOverride,
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel, event) => progressEvents.push(event) } }] },
    configDir: path.join(runDir, name), projectRoot: root,
    packageMetadata: metadata, defaultSettings: defaults, settingsPath: "unused", readJson: (file, fallback) => file === "unused" ? settings : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback,
    writeJson: (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); },
    isPathInside: inside, migrateSettings: value => value, ...client, shutdownApplicationServices: async () => { report.shutdownCalls = (report.shutdownCalls || 0) + 1; return { timedOut: false }; },
    newApiTransportFetch: transport.newApiTransportFetch });
  const service = makeService();
  await check("migration keeps explicit custom update address and independently migrates legacy defaults", async () => {
    assert.equal(migrateSettings({ updateBaseUrl: "https://image.aieyra.cn/" }).updateBaseUrl, "https://sparkapi.org");
    assert.equal(migrateSettings({ serverUrl: "https://legacy.example" }).updateBaseUrl, "https://sparkapi.org");
    assert.equal(migrateSettings({ updateBaseUrl: base }).updateBaseUrl, base);
    assert.equal(migrateSettings({ updateBaseUrl: "" }).updateBaseUrl, "https://sparkapi.org");
  });
  const success = async () => { mode = "success"; const result = await service.checkDesktopUpdate(); assert.equal(result.diagnostic.phase, "verified"); assert.equal(result.diagnostic.signatureVerified, true); assert.equal(result.progress.stage, "checked"); assert.equal(result.busy, false, "Completed checks must release the Settings action"); };
  await check("valid absolute loopback request, signed response and checked state", success);
  await check("update URL is independent of malformed account URL", async () => { settings.accountBaseUrl = "https://[bad"; await success(); settings.accountBaseUrl = base; });
  await check("invalid update URL is rejected before transport", async () => {
    settings.updateBaseUrl = "https://[bad"; const count = requests.length;
    await assert.rejects(service.checkDesktopUpdate(), error => error.code === "UPDATE_URL"); assert.equal(requests.length, count); settings.updateBaseUrl = base;
  });
  await check("missing login has distinct auth error and no transport", async () => {
    const cookie = settings.serverSessionCookie; settings.serverSessionCookie = ""; const count = requests.length;
    await assert.rejects(service.checkDesktopUpdate(), error => error.code === "UPDATE_AUTH"); assert.equal(requests.length, count); settings.serverSessionCookie = cookie;
  });
  for (const [scenario, expected] of [["route", "UPDATE_HTTP"], ["method", "UPDATE_HTTP"], ["server-error", "UPDATE_RESPONSE"], ["html", "UPDATE_RESPONSE"], ["schema", "UPDATE_MANIFEST"], ["signature", "UPDATE_SIGNATURE"], ["disconnect", "UPDATE_TRANSPORT"]]) {
    await check(`${scenario} failure is classified and can recover`, async () => {
      mode = scenario;
      await assert.rejects(service.checkDesktopUpdate(), error => error.code === expected);
      assert.equal(service.desktopUpdaterStatus().progress.stage, "error");
      assert.equal(service.desktopUpdaterStatus().diagnostic.errorCode, expected);
      await success(); assert.equal(service.desktopUpdaterStatus().diagnostic.errorCode, undefined);
    });
  }
  mode = "success";
  const downloadService = makeService("download"), invoke = handlerFixture(downloadService);
  activeRelease = futureRelease();
  await check("restart check, authorization and byte-verified download reach ready IPC state", async () => {
    await invoke("check"); progressEvents.length = 0;
    const [left, right] = await Promise.all([invoke("download-restart"), invoke("download-restart")]);
    assert.equal(left.ok, true); assert.deepEqual(left, right); assert.equal(downloadAttempts, 1);
    const status = await invoke("status"); assert.equal(status.progress.stage, "ready"); assert.equal(status.canApplyPending, true);
    assert.ok(progressEvents.some(event => event.stage === "downloading" && event.received > 0));
    assert.ok(progressEvents.some(event => event.stage === "verifying"));
    assert.equal(JSON.stringify(status).includes(runDir), false, "Public updater DTOs exclude local paths");
    assert.equal(JSON.stringify(status).includes("session="), false);
  });
  await check("ready update survives service reconstruction and developer apply is safely refused", async () => {
    const restored = makeService("download"), call = handlerFixture(restored);
    assert.equal((await call("status")).progress.stage, "ready");
    const result = await call("apply-restart"); assert.equal(result.ok, false); assert.match(result.error, /开发运行模式/);
    assert.equal((await call("status")).canApplyPending, true);
  });
  await check("foreign and untrusted download paths are rejected before transport", async () => {
    for (const forbidden of ["foreign", "path"]) {
      authorizeMode = forbidden; const before = downloadAttempts;
      const result = await invoke("download-restart"); assert.equal(result.ok, false); assert.match(result.error, /不可信/); assert.equal(downloadAttempts, before);
    }
    authorizeMode = "success";
  });
  await check("404 download records failure and a later download recovers", async () => {
    activeRelease = futureRelease("restart", "99.0.1"); await invoke("check"); downloadMode = "missing";
    const failed = await invoke("download-restart"); assert.equal(failed.ok, false); assert.equal((await invoke("status")).progress.stage, "error");
    downloadMode = "success"; assert.equal((await invoke("download-restart")).ok, true); assert.equal((await invoke("status")).progress.stage, "ready");
  });
  await check("partial download resumes using validated 206 ranges", async () => {
    activeRelease = futureRelease("restart", "99.0.2"); await invoke("check");
    const target = path.join(runDir, "download", "updates", activeRelease.version, activeRelease.restart.filename);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(`${target}.part`, restartBytes.subarray(0, 1024));
    const before = requests.length; assert.equal((await invoke("download-restart")).ok, true);
    assert.ok(requests.slice(before).some(request => request.range === "bytes=1024-"));
    assert.equal(createHash("sha256").update(rawFs.readFileSync(target)).digest("hex"), activeRelease.restart.sha256);
  });
  await check("mismatched 206 ranges restart cleanly and recover", async () => {
    activeRelease = futureRelease("restart", "99.0.3"); await invoke("check");
    const target = path.join(runDir, "download", "updates", activeRelease.version, activeRelease.restart.filename);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(`${target}.part`, restartBytes.subarray(0, 1024));
    downloadMode = "range-mismatch"; downloadAttempts = 0;
    assert.equal((await invoke("download-restart")).ok, true); assert.equal(downloadAttempts, 2); downloadMode = "success";
  });
  await check("persistent hash mismatch deletes unsafe bytes and retry recovers", async () => {
    activeRelease = futureRelease("restart", "99.0.4"); await invoke("check"); downloadMode = "corrupt"; downloadAttempts = 0;
    const result = await invoke("download-restart"); assert.equal(result.ok, false); assert.match(result.error, /SHA-256/); assert.equal(downloadAttempts, 2);
    assert.equal((await invoke("status")).pending, null);
    const target = path.join(runDir, "download", "updates", activeRelease.version, activeRelease.restart.filename);
    assert.equal(rawFs.existsSync(target), false); assert.equal(fs.existsSync(`${target}.part`), false);
    downloadMode = "success"; assert.equal((await invoke("download-restart")).ok, true);
  });
  await check("live download status stays active while restored unfinished state becomes recoverable error", async () => {
    activeRelease = futureRelease("restart", "99.0.5"); await invoke("check"); downloadMode = "slow";
    const task = invoke("download-restart");
    for (let i = 0; i < 100 && !progressEvents.some(event => event.version === activeRelease.version && event.stage === "downloading"); i += 1) await delay(5);
    const live = await invoke("status"); assert.equal(live.busy, true); assert.equal(live.progress.stage, "downloading");
    assert.equal((await task).ok, true); downloadMode = "success";
    const interrupted = makeService("unfinished"); interrupted.publishDesktopUpdateProgress({ stage: "downloading", version: "99.0.6", received: 128, total: 1024 });
    const restored = makeService("unfinished").desktopUpdaterStatus(); assert.equal(restored.progress.stage, "error"); assert.match(restored.progress.message, /未完成/);
  });
  await check("installer captcha, wrong code, safe input validation and successful authorization", async () => {
    activeRelease = futureRelease("installer", "99.1.0"); await invoke("check");
    const captcha = await invoke("installer-captcha"); assert.equal(captcha.ok, true); assert.equal(captcha.installer.sha256, activeRelease.installer.sha256);
    const before = requests.length; assert.equal((await invoke("download-installer", { challengeId: captcha.challengeId, code: "bad" })).ok, false); assert.equal(requests.length, before);
    assert.equal((await invoke("download-installer", { challengeId: captcha.challengeId, code: "000000" })).ok, false);
    assert.equal((await invoke("download-installer", { challengeId: captcha.challengeId, code: "123456" })).ok, true);
    assert.equal((await invoke("status")).pending.kind, "installer");
    const refused = await invoke("launch-installer"); assert.equal(refused.ok, false); assert.match(refused.error, /开发运行模式/);
  });
  await check("installer tamper is rejected before handoff; signed executable fixture launches and exits safely", async () => {
    const compiler = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const sourcePath = path.join(runDir, "installer-fixture.cs"), executable = path.join(runDir, "installer-fixture.exe");
    fs.writeFileSync(sourcePath, 'using System.IO; using System.Reflection; public static class Fixture { public static void Main() { File.WriteAllText(Assembly.GetExecutingAssembly().Location + ".launched", "loopback installer fixture"); } }');
    const compiled = spawnSync(compiler, ["/nologo", "/target:winexe", `/out:${executable}`, sourcePath], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    assert.equal(compiled.status, 0, `Harmless installer fixture compilation failed: ${compiled.stdout} ${compiled.stderr}`);
    installerBytes = fs.readFileSync(executable); activeRelease = futureRelease("installer", "99.1.1");
    let exits = 0;
    const packagedApp = { isPackaged: true, getVersion: () => metadata.version, exit: code => { assert.equal(code, 0); exits += 1; } };
    const packagedService = makeService("installer-handoff", packagedApp), call = handlerFixture(packagedService);
    await call("check"); const captcha = await call("installer-captcha");
    await call("download-installer", { challengeId: captcha.challengeId, code: "123456" });
    const target = path.join(runDir, "installer-handoff", "updates", activeRelease.version, activeRelease.installer.filename);
    const bad = Buffer.from(installerBytes); bad[bad.length - 1] ^= 1; rawFs.writeFileSync(target, bad);
    const tampered = await call("launch-installer"); assert.equal(tampered.ok, false); assert.match(tampered.error, /完整性/); assert.equal(rawFs.existsSync(target), false); assert.equal(exits, 0);
    await call("download-installer", { challengeId: captcha.challengeId, code: "123456" });
    const launched = await call("launch-installer"); assert.equal(launched.ok, true); assert.equal(launched.launching, true);
    for (let i = 0; i < 50 && (!fs.existsSync(`${target}.launched`) || !exits); i += 1) await delay(100);
    assert.equal(fs.existsSync(`${target}.launched`), true); assert.equal(exits, 1); assert.equal(report.shutdownCalls, 1);
    assert.equal((await call("status")).progress.stage, "applying");
    const upgraded = makeService("installer-handoff", { ...packagedApp, getVersion: () => activeRelease.version }).desktopUpdaterStatus();
    assert.equal(upgraded.pending, null); assert.equal(upgraded.canApplyPending, false); assert.equal(upgraded.progress.stage, "checked");
    assert.equal((await call("launch-installer")).ok, false, "Accepted handoff cannot launch twice");
    report.installerHandoff = { harmlessExecutable: true, launched: true, shutdownCalls: report.shutdownCalls, appExitRequests: exits, actualInstallation: false };
  });
  report.ok = true;
}
main().catch(error => { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, error: report.error?.message, report: path.join(runDir, "report.json") }));
  app.exit(report.ok ? 0 : 1);
});
