import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.argv.find(a => a.startsWith("--exe="))?.slice(6) || "";
const runDir = join(root, ".diagnostics", `image-generation-failure-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(runDir, "project");
const model = "grok-imagine-image-2.0";
const secondModel = "fixture-image-model-b";
const report = { ok: false, packaged: Boolean(exe), realModelRequests: 0, imagePosts: 0, modelPosts: 0, screenshots: [] };
let vite, electron, client;
const require = createRequire(import.meta.url);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const plan = exe ? buildProductionSymbolPlan(root) : null;
const evaluate = (target, expression, ...options) => evaluateRaw(target, plan ? transformCode(expression, plan, "image-failure-ui.js") : expression, ...options);
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/images/generations") {
    report.imagePosts++;
    const body = JSON.parse(raw);
    report.request = { model: body.model, n: body.n, responseFormat: body.response_format };
    res.statusCode = 502;
    res.end(JSON.stringify({ error: { message: "Upstream service temporarily unavailable https://private.example/?token=private-sentinel" } }));
  } else if (["/v1/chat/completions", "/v1/responses"].includes(req.url)) {
    const round = report.modelPosts++;
    const args = { operation: "generate", prompt: `Fixture landscape ${round}`, brief: "验证 Grok 渠道故障", count: 1, ratio: "1:1", resolution: "1K" };
    const done = "图片渠道返回 HTTP 502，未收到成图，已停止自动重试。请先查询渠道结果。";
    const output = round < 2 ? [{ type: "function_call", name: "image_gen", call_id: `image-${round}`, arguments: JSON.stringify(args) }]
      : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: done }] }];
    if (req.url.endsWith("/responses")) res.end(JSON.stringify({ id: `response-${round}`, status: "completed", output }));
    else {
      res.setHeader("Content-Type", "text/event-stream");
      const delta = round < 2 ? { role: "assistant", tool_calls: [{ index: 0, id: `image-${round}`, type: "function", function: { name: "image_gen", arguments: JSON.stringify(args) } }] }
        : { role: "assistant", content: done };
      res.end(`data: ${JSON.stringify({ id: `chat-${round}`, choices: [{ index: 0, delta }] })}\n\ndata: [DONE]\n\n`);
    }
  } else if (req.url === "/v1/models") {
    const credential = String(req.headers.authorization || "");
    const ids = credential.endsWith("fixture-image-b") ? [secondModel]
      : credential.endsWith("fixture-image-a") ? [model]
        : ["gpt-6.1-sol"];
    res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
  }
  else res.end(JSON.stringify({ success: true, data: { id: 1, username: "fixture", quota: 1000000, items: [] } }));
});
try {
  for (const dir of [configDir, projectDir, join(runDir, "user-data")]) mkdirSync(dir, { recursive: true });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: "image-failure", projects: [{ id: "image-failure", name: "Grok 渠道故障验证", path: projectDir, sessionPath: join(projectDir, "session.json"), external: true }] }));
  writeFileSync(join(configDir, "app-settings.json"), JSON.stringify({ accessMode: "account", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base,
    agentBaseUrl: base, imageBaseUrl: base, serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-key",
    agentModel: "gpt-6.1-sol", agentModelPool: ["gpt-6.1-sol"], contextStrategy: "codex", agentModelBindings: [{ model: "gpt-6.1-sol", customBaseUrl: base, customApiKey: "fixture-key" }],
    imageModel: model, imageModelPool: [model], imageModelBindings: [
      { model, customBaseUrl: base, customApiKey: "fixture-image-a" },
      { model: secondModel, customBaseUrl: base, customApiKey: "fixture-image-b" }
    ], glassTheme: "light-classic", imageRatio: "1:1", imageResolution: "1K" }));
  const debugPort = await allocateDebugPort();
  let devUrl = "";
  if (!exe) {
    const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  }
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`];
  electron = spawn(exe || process.execPath, exe ? args : [join(root, "node_modules/electron/cli.js"), ...args, "electron-main.cjs"], {
    cwd: exe ? dirname(exe) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1",
      NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"),
      NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "mock-service-owned-by-test.cjs") }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: ts => ts.find(t => t.type === "page" && !/agent-window\.html/.test(t.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate, timeoutMs: 60000, intervalMs: 100 });
  const catalog = await evaluate(client, `(async () => {
    const result = await window.naimageServer.models({ forceRefresh: true });
    const profiles = result?.settings?.modelAccessProfiles || [];
    const findProfile = (id) => profiles.find((profile) => profile.providers.includes('image') && profile.capabilities?.[id.toLowerCase()]);
    const profileA = findProfile(${JSON.stringify(model)});
    const profileB = findProfile(${JSON.stringify(secondModel)});
    return {
      ok: result?.ok === true,
      distinctConnections: Boolean(profileA && profileB && profileA.id !== profileB.id),
      aHasRequestedModel: Boolean(profileA?.capabilities?.[${JSON.stringify(model.toLowerCase())}]),
      bHasOnlyItsModel: Boolean(profileB?.capabilities?.[${JSON.stringify(secondModel.toLowerCase())}] && !profileB?.capabilities?.[${JSON.stringify(model.toLowerCase())}])
    };
  })()`);
  report.catalog = catalog;
  assert.equal(catalog.ok, true);
  assert.equal(catalog.distinctConnections, true);
  assert.equal(catalog.aHasRequestedModel, true);
  assert.equal(catalog.bHasOnlyItsModel, true);
  await evaluate(client, `(() => { const t=document.querySelector('.project-agent-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'用 Grok 生成一张风景测试图'); t.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-send:not(:disabled)'))", { evaluate, timeoutMs: 5000, intervalMs: 50 });
  const button = await evaluate(client, "(() => {const r=document.querySelector('.project-agent-send').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...button, button: "left", clickCount: 1 });
  await waitForRuntimeExpression(client, "document.querySelector('.project-agent-panel')?.textContent.includes('请先查询渠道结果。')", { evaluate, timeoutMs: 45000, intervalMs: 100 });
  assert.equal(report.imagePosts, 1); assert.equal(report.modelPosts, 3);
  assert.equal(report.request.model, model); assert.equal(report.request.n, 1);
  report.main = await evaluate(client, `(() => {const panel=document.querySelector('.project-agent-panel');const matches=Array.from(panel.querySelectorAll('*')).filter(e=>e.textContent.includes('图片渠道暂时不可用')).sort((a,b)=>a.textContent.length-b.textContent.length);const error=matches[0];error?.scrollIntoView({block:'center'});const r=error?.getBoundingClientRect();return {error:error?.textContent,visible:!!r&&r.width>20&&r.height>10&&r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,bounds:r?{width:r.width,height:r.height,top:r.top,bottom:r.bottom}:null,leaked:panel.textContent.includes('private-sentinel'),completed:panel.textContent.includes('图片生成完成')};})()`);
  assert.equal(report.main.visible, true); assert.equal(report.main.leaked, false); assert.equal(report.main.completed, false);
  await capturePngScreenshotToFile(client, join(runDir, "main-error.png"), { captureBeyondViewport: false }); report.screenshots.push("main-error.png");
  const evidence = await evaluate(client, `(async () => {
    const result = await window.naimageServer.models({ cacheOnly: true });
    const profiles = result?.settings?.modelAccessProfiles || [];
    const failureProfile = profiles.find((profile) => profile.providers.includes('image') && profile.capabilities?.[${JSON.stringify(model.toLowerCase())}]?.observations?.some((item) => item.outcome === 'failure'));
    const otherProfile = profiles.find((profile) => profile.providers.includes('image') && profile.capabilities?.[${JSON.stringify(secondModel.toLowerCase())}]);
    const failure = failureProfile?.capabilities?.[${JSON.stringify(model.toLowerCase())}]?.observations?.filter((item) => item.outcome === 'failure').at(-1);
    return {
      cacheAvailable: result?.ok === true,
      failureRecordedOnA: Boolean(failureProfile && failure?.stage === 'generation' && failure?.category === 'image_generation_uncertain'),
      bDidNotReceiveFailedModel: Boolean(otherProfile && !otherProfile.capabilities?.[${JSON.stringify(model.toLowerCase())}]),
      bHasNoRuntimeObservation: Boolean(otherProfile && Object.values(otherProfile.capabilities).every((capability) => !capability.observations?.length))
    };
  })()`);
  report.evidence = evidence;
  assert.equal(evidence.cacheAvailable, true);
  assert.equal(evidence.failureRecordedOnA, true);
  assert.equal(evidence.bDidNotReceiveFailedModel, true);
  assert.equal(evidence.bHasNoRuntimeObservation, true);
  const diagnostics = JSON.parse(readFileSync(join(runDir, "runtime/diagnostics.json"), "utf8"));
  assert.ok(diagnostics.events.some(e => e.kind === "image" && e.status === 502 && e.category === "image_generation_uncertain"));
  assert.equal(report.imagePosts, 1);
  report.ok = true;
} catch (error) {
  report.error = String(error.stack || error); process.exitCode = 1;
  if (client) try { await capturePngScreenshotToFile(client, join(runDir, "failure.png")); } catch {}
} finally {
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: join(runDir, "report.json") }));
  client?.close();
  await forceKillProcessTree(electron?.pid); await forceKillProcessTree(vite?.pid);
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
}
