import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { build } from "vite";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

// Actual production Renderer + Main IPC + loopback HTTP. No remote services,
// injected Renderer bridge or release signing identity are used.
const require = createRequire(import.meta.url);
const metadata = require("../package.json");
const { canonicalDesktopRelease } = require("../update-release.cjs");
const { windowsInstallerArtifactName, ACCESS_VARIANT_DUAL } = require("../runtime/access-variant.cjs");
const root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", `update-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project");
for (const directory of [config, project]) mkdirSync(directory, { recursive: true });
const bundleArgument = process.argv.find(value => value.startsWith("--bundle="));
const bundle = bundleArgument ? resolve(bundleArgument.slice("--bundle=".length)) : join(runDir, "renderer");
const pair = generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const publicKeyPath = join(runDir, "public.pem"); writeFileSync(publicKeyPath, pair.publicKey);
const bytes = Buffer.alloc(64 * 1024, 45), installerBytes = Buffer.alloc(1024, 61);
const captcha = await sharp(Buffer.from('<svg width="180" height="60"><rect width="180" height="60" fill="#e9eef2"/><text x="15" y="44" font-size="38" font-family="Arial" fill="#243746">123456</text></svg>')).png().toBuffer();
let mode = "http", downloadMode = "success", base, server, electron, client;
const report = { ok: false, realModelRequests: 0, productionRenderer: true, checks: [], screenshots: [], requests: [], launches: 0 };
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, `Boolean(${expression})`, { evaluate: evaluateRuntime, timeoutMs: 20_000, intervalMs: 100 });
const updateText = () => ev("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText || ''");
const check = async (name, action) => { report.current = name; await action(); report.checks.push(name); };
function release() {
  const version = mode === "current" ? metadata.version : mode === "installer" ? "99.1.0" : "99.0.0";
  const source = { schema_version: 1, product: "naimage-studio", channel: "stable", version, minimum_version: "1.0.0", published_at: "2026-10-18T00:00:00Z", compatibility: metadata.naimageUpdateCompatibility,
    notes: ["本地模拟更新；未连接外部更新服务。"],
    restart: { filename: `naimage-Restart-Update-${version}-x64.asar`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
    installer: { filename: windowsInstallerArtifactName(version, ACCESS_VARIANT_DUAL), size: installerBytes.length, sha256: createHash("sha256").update(installerBytes).digest("hex") } };
  const kind = mode === "current" ? "none" : mode === "installer" ? "installer" : "restart";
  const signature = sign(null, Buffer.from(canonicalDesktopRelease(source)), pair.privateKey).toString("base64");
  return { ...source, signature, update_type: kind, update_available: kind !== "none", current_version: metadata.version, latest_version: version, ...(kind === "none" ? {} : { artifact: { ...source[kind], kind, version } }) };
}
function json(res, value, status = 200) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
async function click(selector, text) {
  const point = await ev(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text || "")}||e.textContent.trim()===${JSON.stringify(text || "")});if(!element)return null;element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:element.disabled}})()`);
  assert.ok(point, `Missing visible control: ${selector} ${text || ""}`); assert.equal(Boolean(point.disabled), false);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(120);
}
async function screenshot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); }
async function openUpdates() {
  await wait("document.querySelector('button[aria-label=\"设置\"]') && document.querySelector('textarea')");
  await click('button[aria-label="设置"]'); await wait("document.querySelector('[data-settings-section=\"updates\"]')");
  await click('[data-settings-section="updates"]');
  await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('软件更新')");
}
async function closeUpdates() { await click('button[aria-label="关闭设置"]'); await wait("!document.querySelector('[data-ui-surface=\"settings\"]')"); }
async function boot() {
  const debugPort = await allocateDebugPort();
  electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: base, NAIMAGE_CONFIG_DIR: config, NAIMAGE_UPDATE_PUBLIC_KEY: publicKeyPath, NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log") }
  });
  report.launches += 1;
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: targets => targets.find(target => target.type === "page" && target.url.startsWith(base)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("window.naimageUpdater && document.querySelector('button[aria-label=\"设置\"]') && document.querySelector('textarea')");
  await delay(400);
}
async function stop() {
  if (!electron) return;
  await ev("window.close()").catch(() => {}); client?.close(); client = null;
  for (let i = 0; i < 40 && electron.exitCode === null; i += 1) await delay(100);
  if (electron.exitCode === null) forceKillProcessTree(electron);
  electron = null;
}
try {
  if (!bundleArgument) await build({ root, logLevel: "error", build: { outDir: bundle, emptyOutDir: true } });
  assert.ok(existsSync(join(bundle, "index.html")));
  report.bundle = bundle;
  report.bundleIndexSha256 = createHash("sha256").update(readFileSync(join(bundle, "index.html"))).digest("hex");
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/downloads/")) {
      report.requests.push({ method: req.method, path: url.pathname });
      if (/images\/|responses|completions|videos\//.test(url.pathname)) { report.realModelRequests += 1; json(res, { error: "Models are forbidden in this fixture" }, 500); return; }
      if (url.pathname === "/api/desktop-update/check") {
        assert.equal(req.method, "GET");
        if (mode === "http") json(res, { error: "Invalid URL (GET /api/desktop-update/check)" }, 404);
        else if (mode === "tamper") json(res, { ...release(), notes: ["tampered"] });
        else json(res, release()); return;
      }
      if (url.pathname === "/api/desktop-update/authorize") { json(res, { release: release(), download_url: `${base}/downloads/naimage-studio/${release().restart.filename}` }); return; }
      if (url.pathname === "/api/desktop-download/captcha") { json(res, { challenge_id: "ui-challenge", image_data_url: `data:image/png;base64,${captcha.toString("base64")}`, expires_in: 120, installer: release().installer }); return; }
      if (url.pathname === "/api/desktop-download/authorize") { json(res, { installer: release().installer, download_url: `${base}/downloads/naimage-studio/${release().installer.filename}` }); return; }
      if (url.pathname.startsWith("/downloads/")) {
        if (downloadMode === "missing") { json(res, { error: "模拟下载文件暂不可用" }, 404); return; }
        const data = url.pathname.endsWith(".exe") ? installerBytes : bytes;
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": data.length });
        res.write(data.subarray(0, 256)); setTimeout(() => res.end(data.subarray(256)), 900); return;
      }
      if (url.pathname === "/api/user/self") { json(res, { success: true, data: { id: 7, username: "local-user", display_name: "本地模拟用户", quota: 1000000, used_quota: 0, request_count: 0 } }); return; }
      if (url.pathname === "/api/status") { json(res, { success: true, data: { quota_per_unit: 500000, quota_display_type: "USD", usd_exchange_rate: 7 } }); return; }
      if (url.pathname === "/api/user/models") { json(res, { success: true, data: ["gpt-6.1-sol", "gpt-image-2"] }); return; }
      if (url.pathname === "/v1/models") { json(res, { object: "list", data: ["gpt-6.1-sol", "gpt-image-2"].map(id => ({ id, object: "model" })) }); return; }
      json(res, { success: true, data: { items: [], total: 0 } }); return;
    }
    const file = resolve(bundle, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
    if (!file.startsWith(`${bundle}${sep}`) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" })[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", accountBaseUrl: base, updateBaseUrl: base, serverSessionCookie: "session=local-ui-fixture", serverUserId: "7", imageModel: "gpt-image-2", agentModel: "gpt-6.1-sol", imageConnectionVersion: 1, glassTheme: "light-classic", networkProxyUrl: "", agentSkillAutoInstallTargets: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "update-fixture", projects: [{ id: "update-fixture", name: "更新验证", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  await boot(); await openUpdates();
  await check("HTTP 404 remains a service-route diagnostic in the visible Settings UI", async () => {
    await click('[data-ui-surface="settings"] button', "检查更新"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('HTTP 404')");
    const text = await updateText(); assert.match(text, /桌面更新接口/); assert.doesNotMatch(text, /Invalid URL/); await screenshot("http-route-error");
  });
  await check("valid no-update response clears the route failure", async () => {
    mode = "current"; await click('[data-ui-surface="settings"] button', "检查更新"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('当前已是最新版本')");
    assert.doesNotMatch(await updateText(), /HTTP 404/); await screenshot("current-version");
  });
  await check("tampered signed manifest is visibly rejected and can recover", async () => {
    mode = "tamper"; await click('[data-ui-surface="settings"] button', "检查更新"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('签名校验失败')");
    await screenshot("signature-error"); mode = "restart";
    await click('[data-ui-surface="settings"] button', "检查更新"); await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='下载重启更新')");
  });
  await check("download error retains retry action; actual bytes then show progress and ready action", async () => {
    downloadMode = "missing"; await click('[data-ui-surface="settings"] button', "下载重启更新"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('模拟下载文件暂不可用')");
    await screenshot("download-error"); downloadMode = "success";
    await click('[data-ui-surface="settings"] button', "下载重启更新"); await wait("Boolean(document.querySelector('[role=\"progressbar\"][aria-label=\"更新下载进度\"]'))");
    const progress = await ev("Number(document.querySelector('[role=\"progressbar\"]').getAttribute('aria-valuenow'))"); assert.ok(progress > 0 && progress < 100); await screenshot("download-progress");
    await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='重启并更新')"); await screenshot("restart-ready");
  });
  await closeUpdates(); await stop(); await boot(); await openUpdates();
  await check("ready update persists after process restart; development apply refusal keeps it recoverable", async () => {
    await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='重启并更新')");
    await click('[data-ui-surface="settings"] button', "重启并更新"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('开发运行模式')");
    assert.equal((await ev("window.naimageUpdater.status()")).pending.kind, "restart"); await screenshot("restart-restored-refused");
  });
  await check("full installer path renders captcha, authorized download and safe development launch refusal", async () => {
    mode = "installer"; assert.equal((await ev("window.naimageUpdater.check()")).ok, true);
    await closeUpdates(); await openUpdates();
    await click('[data-ui-surface="settings"] button', "验证并下载安装包"); await wait("document.querySelector('input[placeholder=\"输入 6 位数字\"]')"); await screenshot("installer-captcha");
    await click('input[placeholder="输入 6 位数字"]'); await client.send("Input.insertText", { text: "123456" });
    await click('[data-ui-surface="settings"] button', "验证并下载"); await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='启动安装程序')");
    await click('[data-ui-surface="settings"] button', "启动安装程序"); await wait("document.querySelector('[data-ui-surface=\"settings\"]')?.innerText.includes('开发运行模式')"); await screenshot("installer-ready-refused");
  });
  await check("update controls fit an 884 by 640 viewport", async () => {
    await client.send("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, deviceScaleFactor: 1, mobile: false }); await delay(200);
    report.compactBounds = await ev("(()=>{const surface=document.querySelector('[data-ui-surface=\"settings\"]'),r=surface.getBoundingClientRect(),button=[...surface.querySelectorAll('button')].find(e=>e.textContent.trim()==='启动安装程序'),b=button.getBoundingClientRect();return{surface:{x:r.x,y:r.y,width:r.width,height:r.height},button:{x:b.x,y:b.y,width:b.width,height:b.height},viewport:{width:innerWidth,height:innerHeight}}})()");
    const { button, surface, viewport } = report.compactBounds; assert.ok(button.x >= surface.x && button.x + button.width <= viewport.width && button.y >= 0 && button.y + button.height <= viewport.height);
    assert.ok(surface.x >= 0 && surface.y >= 0 && surface.x + surface.width <= viewport.width + 1 && surface.y + surface.height <= viewport.height + 1); await screenshot("compact-update");
  });
  assert.equal(report.realModelRequests, 0); report.ok = true;
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (client) await screenshot("final-state").catch(() => {});
  await stop(); if (server) await new Promise(resolve => server.close(resolve));
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, screenshots: report.screenshots.length, error: report.error?.message, report: join(runDir, "report.json") }));
}
