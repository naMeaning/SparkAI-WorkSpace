import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(import.meta.dirname, ".."), exe = process.argv.find(arg => arg.startsWith("--exe="))?.slice(6);
const { buildProductionSymbolPlan, transformCode } = createRequire(import.meta.url)("./production-symbol-compaction.cjs");
const symbolPlan = exe ? buildProductionSymbolPlan(root) : null;
const evaluateRuntime = (target, expression, ...options) => evaluateRaw(target,
  symbolPlan ? transformCode(expression, symbolPlan, "agent-task-ui-test.js") : expression, ...options);
const runDir = join(root, ".diagnostics", `agent-task-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), skill = join(runDir, "skill");
for (const dir of [config, project, skill]) mkdirSync(dir, { recursive: true });
cpSync(join(root, "integrations/naimage-control"), skill, { recursive: true });
writeFileSync(join(skill, ".naimage-connection.json"), JSON.stringify({ endpointPath: join(config, "automation/endpoint.json"), executablePath: exe || "unused" }));
const report = { ok: false, realModelRequests: 0, modelPosts: 0, imagePosts: 0, checks: [], screenshots: [], wire: [], serverErrors: [], windows: [], routes: [] };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const png = await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="#f7e9da"/><circle cx="512" cy="512" r="240" fill="#d44761"/></svg>')).png().toBuffer();
let electron, vite, client, agentClient, debugPort, devUrl = "", releaseFirst, releaseInterrupted;
const gate = new Promise(resolveGate => { releaseFirst = resolveGate; });
const interruptedGate = new Promise(resolveGate => { releaseInterrupted = resolveGate; });
const call = (name, args, call_id) => ({ type: "function_call", name, call_id, arguments: JSON.stringify(args) });
const response = (res, output) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: `local-${report.modelPosts}`, status: "completed", output } })}\n\ndata: [DONE]\n\n`);
};
const json = (res, body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const ask = number => call("ask_user", { title: "确认创作方向", question: "选择这次作品的颜色", options: [{ id: "red", label: "红色", answer: "保留红色", recommended: true }, { id: "blue", label: "蓝色", answer: "改为蓝色" }] }, `question-${number}`);
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    report.routes.push({ method: req.method, route: req.url });
    if (req.url === "/v1/chat/completions") throw new Error("Fixture requires Responses routing");
    if (req.url === "/v1/responses") {
      const body = JSON.parse(raw), round = report.modelPosts++;
      if (round === 0) { await gate; response(res, [call("image_gen", { operation: "generate", prompt: "白底红色圆形", brief: "创作圆形图片" }, "receipt-image")]); }
      else if (round === 1 || round === 4 || round === 6) response(res, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "本地任务执行完成。" }] }]);
      else if (round === 2 || round === 5 || round === 7) response(res, [ask(round)]);
      else if (round === 3) {
        const serialized = JSON.stringify(body);
        assert.match(serialized, /原任务续接/); assert.match(serialized, /1:1/);
        report.continuationHasOriginalIntent = serialized.includes("保留圆形主体");
        response(res, [call("image_gen", { operation: "variants", prompt: "保留圆形主体，按用户补充颜色创作", count: 1, brief: "续接原任务" }, "answer-image")]);
      } else if (round === 8) { await interruptedGate; response(res, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "原执行已中断。" }] }]); }
      else throw new Error(`Unexpected model round ${round}`);
    } else if (/^\/v1\/images\/(generations|edits)/.test(req.url)) {
      report.imagePosts++;
      const isJson = String(req.headers["content-type"]).includes("application/json");
      const body = isJson ? JSON.parse(raw) : null;
      const field = name => raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`))?.[1];
      const wire = { route: req.url, model: body?.model || field("model"), n: body?.n ?? Number(field("n") || 1),
        ratio: body?.aspect_ratio || field("aspect_ratio") || body?.ratio || field("ratio"), resolution: body?.resolution || field("resolution"),
        quality: body?.quality || field("quality"), inputImage: /name="(?:image|images|image\[\])"/.test(raw) || Boolean(body?.image || body?.images) };
      report.wire.push(wire);
      assert.equal(wire.n, 1); assert.equal(wire.ratio, report.imagePosts === 1 ? "3:2" : "1:1"); assert.equal(wire.resolution.toLowerCase(), report.imagePosts === 1 ? "2k" : "1k"); assert.equal(wire.quality, "high");
      json(res, { data: [{ b64_json: png.toString("base64") }] });
    } else if (req.url === "/v1/models") json(res, { data: [{ id: "gpt-5.6-sol" }, { id: "grok-imagine-image-2.0" }] });
    else json(res, { success: true, data: { id: 1, username: "fixture", quota: 100000, items: [] } });
  } catch (error) { report.serverErrors.push(error.message); checkpoint(); if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); } else res.end(); }
});
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 30000, intervalMs: 100 });
async function until(predicate, name, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (report.serverErrors.length) throw new Error(report.serverErrors[0]); if (await predicate()) return; await delay(100); }
  throw new Error(`Timeout: ${name}`);
}
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function command(command, args = {}, raw = false) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const value = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, args, timeoutMs: 15000 }), signal: AbortSignal.timeout(20000) })).json();
  if (raw) return value;
  assert.equal(value.ok, true, `${command}: ${JSON.stringify(value)}`); return value.result;
}
function cli(commandName, args) {
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const script = `$ProgressPreference='SilentlyContinue'; $agentTaskArguments=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(args)).toString("base64")}')); & ${quote(join(skill, "scripts/naimage.ps1"))} -Command ${quote(commandName)} -ArgsJson $agentTaskArguments -TimeoutSeconds 10`;
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 18000 }).replace(/^\uFEFF/, ""));
}
async function click(target, selector) {
  const point = await evaluateRuntime(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing click target');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
async function screenshot(name, target = client) { await capturePngScreenshotToFile(target, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`); }
async function visibleCard(target, selector) {
  return evaluateRuntime(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return {text:e?.innerText,visible:!!r&&r.width>100&&r.height>20&&r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth&&s.visibility!=='hidden'&&s.display!=='none',bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth}})()`);
}
async function launch() {
  debugPort = await allocateDebugPort();
  const electronExe = exe || createRequire(import.meta.url)("electron");
  electron = spawn(electronExe, [...(!exe ? ["electron-main.cjs"] : []), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`], {
    cwd: exe ? dirname(exe) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: exe ? "0" : "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1",
      NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea') && window.naimageAgent?.taskCommand)");
  return target;
}
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {});
  client?.close(); agentClient?.close(); client = null; agentClient = null;
  const exited = await waitForChildExit(electron, 15000);
  report.shutdowns ||= []; report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false });
  assert.equal(exited, true, "isolated application exits normally"); assert.equal(electron.exitCode, 0); electron = null;
}
let singleTarget, askTarget;
try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: "task-conversation", conversations: [{ id: "task-conversation", title: "本地任务", messages: [] }], nodes: [], messages: [], layoutGroups: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "task-project", projects: [{ id: "task-project", name: "AI Native 本地任务验收", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base,
    serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", agentModel: "gpt-5.6-sol", agentModelPool: ["gpt-5.6-sol"], contextStrategy: "codex",
    agentModelBindings: [{ model: "gpt-5.6-sol", customBaseUrl: base, customApiKey: "fixture-agent" }],
    imageConnectionVersion: 1, imageModel: "grok-imagine-image-2.0", imageModelPool: ["grok-imagine-image-2.0"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1,
    imageModelBindings: [{ model: "grok-imagine-image-2.0", customBaseUrl: base, customApiKey: "fixture-image", protocol: "xai-images", gateway: "direct" }],
    imageModelConfigs: [{ model: "grok-imagine-image-2.0", protocol: "xai-images", gateway: "direct", capabilities: { edit: true, referenceImages: true, multiReferenceImages: true, supportedQualities: ["auto", "high"] } }], glassTheme: "light-classic", agentPanelWidth: 350 }));
  if (!exe) {
    const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  }
  const rendererTarget = await launch();
  const scope = { expectedProjectId: "task-project", conversationId: "task-conversation" };
  await check("concurrent authenticated submissions launch one Main run; conflict and busy add no dispatch", async () => {
    const input = { ...scope, submissionId: "single", prompt: "白底红色圆形", title: "创作一张圆形图片", sourceNodeIds: [], ratio: "3:2", resolution: "2K" };
    const [first, second] = await Promise.all([command("agent.task.start", input), command("agent.task.start", input)]);
    assert.equal(first.accepted, true); assert.equal(first.task.taskId, second.task.taskId);
    singleTarget = { ...scope, taskId: first.task.taskId };
    await until(() => report.modelPosts === 1, "first held model request");
    const conflict = await command("agent.task.start", { ...input, prompt: "different" }, true); assert.equal(conflict.code, "TASK_SUBMISSION_CONFLICT");
    const busy = await command("agent.task.start", { ...input, submissionId: "busy" }, true); assert.equal(busy.code, "TASK_BUSY");
    const runState = await ev("window.naimageAgent.runStatus({projectId:'task-project'})"); assert.equal(runState.runs.length, 1);
    assert.equal(report.imagePosts, 0); report.concurrentRunCount = runState.runs.length;
  });
  await check("real PowerShell CLI wait timeout returns the same queryable task and current cursor", async () => {
    const current = await command("agent.task.get", singleTarget);
    const timed = cli("agent.task.wait", { ...singleTarget, afterVersion: current.task.version, timeoutMs: 80 });
    assert.equal(timed.ok, true); assert.equal(timed.result.timedOut, true); assert.equal(timed.result.task.taskId, singleTarget.taskId);
    const queried = cli("agent.task.get", singleTarget); assert.equal(queried.result.task.taskId, singleTarget.taskId); report.cliTimeout = true;
    releaseFirst();
  });
  await check("one loopback image POST produces one durable asset and a compact honest task card", async () => {
    await until(async () => (await command("agent.task.get", singleTarget)).task.phase === "completed", "first completed receipt", 60000);
    const receipt = (await command("agent.task.get", singleTarget)).task;
    assert.equal(receipt.savedCount, 1); assert.equal(report.imagePosts, 1); assert.equal(receipt.results.length, 1);
    const session = JSON.parse(readFileSync(join(project, "session.json"), "utf8")); assert.equal(session.nodes.length, 1); assert.equal(session.nodes[0].assets.length, 1);
    const asset = session.nodes[0].assets[0];
    assert.equal(asset.contentHash, createHash("sha256").update(readFileSync(asset.path)).digest("hex"), "saved asset hash must describe the durable bytes used by the next frozen task");
    assert.equal(createHash("sha256").update(readFileSync(asset.path)).digest("hex"), createHash("sha256").update(png).digest("hex"), "journal-owned provider bytes stay unchanged after Runtime delivery");
    await until(async () => (await visibleCard(client, ".agent-task-card")).text?.includes("执行完成"), "completed card");
    report.card = await visibleCard(client, ".agent-task-card"); assert.equal(report.card.visible, true); assert.equal(report.card.overflow, false);
    assert.doesNotMatch(report.card.text, /task-|run-|scope-|[A-Z]:\\|sha256|视觉验收通过/);
    report.firstAsset = { assetId: receipt.results[0].assetId, nodeId: receipt.results[0].nodeId }; await screenshot("completed-task");
  });
  await check("structured question persists; native minimum window and reload retain frozen source/config", async () => {
    const receipt = await command("agent.task.start", { ...scope, submissionId: "ask", prompt: "保留圆形主体，先询问颜色再创作一款", title: "为圆形创作一款配色", sourceNodeIds: [report.firstAsset.nodeId] });
    askTarget = { ...scope, taskId: receipt.task.taskId };
    await until(async () => (await command("agent.task.get", askTarget)).task.phase === "waiting", "structured question");
    const waiting = (await command("agent.task.get", askTarget)).task; report.frozenScope = waiting.scope;
    assert.equal(waiting.question.options.length, 2); assert.equal(waiting.question.allowCustomAnswer, true);
    await command("canvas.select", { ids: [] });
    await ev("(async()=>{const r=await window.naimageConfig.loadSettings();return window.naimageConfig.saveSettings({...r.settings,imageRatio:'16:9',imageResolution:'2K',imageCount:3,imageQuality:'medium'})})()");
    if (!exe) await ev("window.naimageConfig.debugWindowBounds({width:884,height:640})");
    else {
      // Electron builds need not expose Chromium's Browser window domain.
      // resizeTo changes the real native window; do not emulate a viewport.
      await ev("window.resizeTo(884,640); undefined");
      report.windowResizeMethod = "native-window.resizeTo";
    }
    await delay(300); report.windows.push(await ev("({width:innerWidth,height:innerHeight,outerWidth,outerHeight})"));
    assert.equal(report.windows.at(-1).width, 884); assert.equal(report.windows.at(-1).height, 640);
    await screenshot("question-minimum");
    await ev("window.__taskReloadMarker=true");
    await client.send("Page.reload", { ignoreCache: true });
    await until(() => ev("!window.__taskReloadMarker && document.readyState==='complete' && Boolean(document.querySelector('.ask-user-dialog'))").catch(() => false), "saved question after reload");
    const reloaded = (await command("agent.task.get", askTarget)).task; assert.deepEqual(reloaded.scope, waiting.scope); assert.equal(reloaded.question.requestId, waiting.question.requestId);
    assert.equal(report.imagePosts, 1); await screenshot("question-reloaded");
  });
  await check("GUI submit and CLI answer race consume the question once; stale answers do not dispatch", async () => {
    await click(client, ".ask-user-option");
    const task = (await command("agent.task.get", askTarget)).task;
    const answer = { ...askTarget, questionId: task.question.requestId, expectedVersion: task.version, optionId: "red" };
    const submit = await ev("(()=>{const b=[...document.querySelectorAll('.ask-user-dialog button')].find(b=>b.textContent.includes('发送给 Agent'));const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    const competing = command("agent.task.answer", answer, true);
    for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...submit, button: "left", clickCount: 1 });
    const result = await competing; assert.ok(result.ok || result.code === "TASK_ANSWER_STALE"); report.cliAnswerWon = result.ok === true;
    await until(async () => (await command("agent.task.get", askTarget)).task.phase === "completed", "answered task completes", 60000);
    const stale = await command("agent.task.answer", answer, true); assert.equal(stale.code, "TASK_ANSWER_STALE");
    const finished = (await command("agent.task.get", askTarget)).task; assert.equal(finished.runIds.length, 2); assert.equal(finished.savedCount, 1);
    assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 5); assert.equal(report.wire[1].inputImage, true); assert.equal(report.continuationHasOriginalIntent, true);
    assert.deepEqual(finished.scope, report.frozenScope);
    await until(async () => { const card = await visibleCard(client, ".agent-task-card"); return card.text?.includes("执行完成") && card.text.includes("已保存 1"); }, "answered card shows the confirmed saved receipt");
    await screenshot("answered-task");
  });
  await check("independent Agent window shares receipt and answers custom text through the original owner", async () => {
    await wait("!document.querySelector('.ask-user-dialog')");
    await click(client, '[aria-label="调整对话框位置"]');
    await ev("[...document.querySelectorAll('.agent-placement-menu button')].find(b=>b.textContent.includes('独立浮动窗口')).click()");
    const target = await pollForDebugTarget({ port: debugPort, attempts: 100, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && /agent-window\.html/.test(item.url)) });
    agentClient = new BasicCdpClient(target.webSocketDebuggerUrl); await agentClient.open();
    agentClient.socket.addEventListener("message", event => {
      const value = JSON.parse(String(event.data)); if (value.method !== "Runtime.exceptionThrown") return;
      report.independentExceptions ||= []; report.independentExceptions.push({ text: value.params?.exceptionDetails?.text,
        description: String(value.params?.exceptionDetails?.exception?.description || "").split("\n")[0].replace(/(?:file|https?):\/\/\S+/g, "[script]") });
    });
    await agentClient.send("Runtime.enable"); await agentClient.send("Page.enable");
    const started = await command("agent.task.start", { ...scope, submissionId: "independent", prompt: "请先询问颜色，只需文字记录回答", title: "共同确认下一步", sourceNodeIds: [] });
    const targetTask = { ...scope, taskId: started.task.taskId };
    await until(async () => (await command("agent.task.get", targetTask)).task.phase === "waiting", "independent question");
    await waitForRuntimeExpression(agentClient, "Boolean(document.querySelector('#agent-task-card textarea'))", { evaluate: evaluateRuntime, timeoutMs: 15000, intervalMs: 100 });
    report.independentQuestion = await visibleCard(agentClient, "#agent-task-card"); assert.equal(report.independentQuestion.visible, true);
    await screenshot("independent-question", agentClient);
    await click(agentClient, "#agent-task-card textarea"); await agentClient.send("Input.insertText", { text: "这只是原问题的补充回答，记录暖红色。" });
    await evaluateRuntime(agentClient, "[...document.querySelectorAll('#agent-task-card button')].find(b=>b.textContent==='提交回答').click()");
    await until(async () => (await command("agent.task.get", targetTask)).task.phase === "completed", "independent answer");
    const completed = (await command("agent.task.get", targetTask)).task; assert.equal(completed.runIds.length, 2); assert.equal(completed.savedCount, 0);
    assert.equal(report.modelPosts, 7); assert.equal(report.imagePosts, 2);
    await until(async () => (await visibleCard(agentClient, "#agent-task-card")).text.includes("执行完成"), "independent complete card");
    await screenshot("independent-completed", agentClient);
    await evaluateRuntime(agentClient, "(()=>{const s=document.getElementById('dock-select');s.value='right';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
    await delay(300);
  });
  await check("GUI answer consumed before a real session save failure becomes interrupted without model dispatch", async () => {
    const started = await command("agent.task.start", { ...scope, submissionId: "answer-save-failure", prompt: "本地保存失败夹具，先询问颜色", sourceNodeIds: [] });
    const target = { ...scope, taskId: started.task.taskId };
    await until(async () => (await command("agent.task.get", target)).task.phase === "waiting", "question before save failure");
    await wait("Boolean(document.querySelector('.ask-user-dialog'))");
    const task = (await command("agent.task.get", target)).task;
    const staleAnswer = { ...target, questionId: task.question.requestId, expectedVersion: task.version, optionId: "red" };
    const blocker = join(project, "session.json.tmp"); mkdirSync(blocker);
    try {
      await click(client, ".ask-user-option");
      const button = await ev("(()=>{const b=[...document.querySelectorAll('.ask-user-dialog button')].find(b=>b.textContent.includes('发送给 Agent'));const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
      for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...button, button: "left", clickCount: 1 });
      await until(async () => (await command("agent.task.get", target)).task.phase === "interrupted", "failed continuation preparation becomes interrupted");
      assert.equal(report.modelPosts, 8); assert.equal(report.imagePosts, 2);
      assert.equal((await command("agent.task.answer", staleAnswer, true)).code, "TASK_ANSWER_STALE");
      await until(async () => (await visibleCard(client, ".agent-task-card")).text?.includes("执行已中断"), "failed continuation task card");
      await screenshot("answer-save-failed");
    } finally { rmdirSync(blocker); }
    await delay(400);
  });
  await check("reload during active execution marks the original task interrupted and does not replay create", async () => {
    const input = { ...scope, submissionId: "interrupted", prompt: "本地中断夹具，不生成图片", sourceNodeIds: [] };
    const started = await command("agent.task.start", input), target = { ...scope, taskId: started.task.taskId };
    await until(() => report.modelPosts === 9, "held interrupted execution");
    await ev("window.__taskReloadMarker=true"); await client.send("Page.reload");
    await until(() => ev("!window.__taskReloadMarker && document.readyState==='complete' && Boolean(document.querySelector('.project-agent-composer textarea'))").catch(() => false), "reloaded original owner");
    const original = (await command("agent.task.get", target)).task; assert.equal(original.phase, "interrupted");
    const duplicate = await command("agent.task.start", input); assert.equal(duplicate.task.taskId, started.task.taskId);
    releaseInterrupted(); await delay(200); assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 9);
    await until(async () => (await visibleCard(client, ".agent-task-card")).text?.includes("执行已中断"), "visible interrupted card");
    await screenshot("interrupted-reload"); report.interruptedTaskId = started.task.taskId;
  });
  await check("normal process restart preserves original receipts/assets and never creates new requests", async () => {
    await stop(); await launch();
    for (const target of [singleTarget, askTarget]) {
      const receipt = (await command("agent.task.get", target)).task; assert.equal(receipt.phase, "completed"); assert.equal(receipt.savedCount, 1);
    }
    const replay = await command("agent.task.start", { ...scope, submissionId: "single", prompt: "白底红色圆形", title: "创作一张圆形图片", sourceNodeIds: [], ratio: "3:2", resolution: "2K" });
    assert.equal(replay.task.taskId, singleTarget.taskId); assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 9);
    assert.equal((await command("agent.task.get", { ...scope, taskId: report.interruptedTaskId })).task.phase, "interrupted");
    const session = JSON.parse(readFileSync(join(project, "session.json"), "utf8")); assert.equal(session.nodes.length, 2); assert.equal(session.nodes.flatMap(node => node.assets || []).length, 2);
    await screenshot("restart-task-card");
  });
  await check("receipt DTOs, durable task ledger and report exclude fixture secrets, URLs and absolute paths", async () => {
    const payloads = [JSON.stringify(await command("agent.task.get", askTarget)), readFileSync(join(project, ".naimage/agent/tasks.json"), "utf8"), JSON.stringify(report)];
    for (const payload of payloads) assert.doesNotMatch(payload, /fixture-(?:session|token|image|agent)|Bearer |https?:\/\/|[A-Z]:\\|[?&](?:sig|token)=/i);
    report.receiptPrivacy = true;
  });
  await stop(); report.ok = true; checkpoint(); console.log(JSON.stringify({ ok: true, checks: report.checks.length, modelPosts: report.modelPosts, imagePosts: report.imagePosts, screenshots: report.screenshots.length, report: join(runDir, "report.json") }));
} catch (error) {
  report.error = error.message; checkpoint(); console.error(error); process.exitCode = 1;
  if (agentClient) {
    report.independentFailure = await evaluateRuntime(agentClient, "(()=>{const e=document.getElementById('agent-task-card');return{readyState:document.readyState,project:document.getElementById('project-name')?.textContent,status:document.getElementById('status-text')?.textContent,taskHidden:e?.hidden,taskText:e?.innerText,projection:e?.dataset.projection||null,textareas:document.querySelectorAll('#agent-task-card textarea').length,modules:performance.getEntriesByType('resource').map(item=>item.name.split('/').at(-1))}})()").catch(() => null);
    await screenshot("failure-agent", agentClient).catch(() => {});
  }
  releaseFirst(); releaseInterrupted(); if (client) { await screenshot("failure").catch(() => {}); await stop().catch(error => { report.shutdownError = error.message; }); }
  checkpoint();
} finally { if (vite) vite.kill(); server.closeAllConnections(); server.close(); }
