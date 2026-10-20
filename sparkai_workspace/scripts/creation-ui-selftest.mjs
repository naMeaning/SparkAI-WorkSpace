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
  symbolPlan ? transformCode(expression, symbolPlan, "creation-ui-test.js") : expression, ...options);
const runDir = join(root, ".diagnostics", `creation-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
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

const seedBuffers = [];
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const rawBytes = Buffer.concat(chunks), raw = rawBytes.toString("utf8");
    if (req.url === "/v1/responses") {
      const body = JSON.parse(raw), round = report.modelPosts++;
      assert.equal(body.tool_choice, "auto");
      if (round === 0) { await gate; response(res, [call("image_gen", { operation: "edit", prompt: "执行已冻结的定向修改，每目标一张", brief: "仅修改所选两张" }, "selected-revision")]); }
      else if (round === 1) response(res, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "两个指定成果已生成并保存，尚未进行AI视觉检查，请按要求审核。" }] }]);
      else if (round === 2) response(res, [call("image_gen", { operation: "redraw", prompt: "执行冻结的精确区域修改", brief: "修改用户涂抹的位置" }, "region-revision")]);
      else if (round === 3) response(res, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "涂抹区域的新版本已单独保存，尚未进行AI视觉检查。" }] }]);
      else throw new Error(`Unexpected model round ${round}`);
    } else if (/^\/v1\/images\/(generations|edits)/.test(req.url)) {
      let prompt, count, matched, uploadedMaskHash = null;
      if (String(req.headers["content-type"] || "").startsWith("multipart/form-data")) {
        const form = await new Request("http://127.0.0.1/fixture", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: rawBytes }).formData();
        const images = await Promise.all([...form.entries()].filter(([key, value]) => key.startsWith("image") && typeof value.arrayBuffer === "function").map(async ([, value]) => Buffer.from(await value.arrayBuffer())));
        prompt = String(form.get("prompt") || ""); count = Number(form.get("n") || 1);
        matched = seedBuffers.map((bytes, index) => images.some(image => image.equals(bytes)) ? index + 1 : null).filter(Boolean);
        const mask = form.get("mask");
        if (mask) uploadedMaskHash = createHash("sha256").update(Buffer.from(await mask.arrayBuffer())).digest("hex");
        assert.equal(images.length, 1, "Each exact revision uploads one frozen source");
      } else {
        const body = JSON.parse(raw); prompt = body.prompt; count = body.n ?? 1;
        matched = seedBuffers.map((bytes, index) => raw.includes(bytes.toString("base64")) ? index + 1 : null).filter(Boolean);
      }
      report.imagePosts++;
      report.wire.push({ sourceNumbers: matched, prompt, count, uploadedMaskHash });
      assert.equal(count, 1); assert.equal(matched.length, 1);
      if (report.imagePosts === 3) {
        assert.equal(matched[0], 2); assert.match(prompt, /金色星形徽章/); assert.match(prompt, /只修改用户蒙版的透明区域/);
        const savedMask = JSON.parse(readFileSync(join(project, ".naimage/creation-masks/manifest.json"), "utf8")).masks[0];
        assert.equal(uploadedMaskHash, savedMask.mask.contentHash, "Actual HTTP mask bytes equal the managed frozen PNG");
      } else if (matched[0] === 2) { assert.equal(uploadedMaskHash, null); assert.match(prompt, /背景改成浅蓝色/); assert.doesNotMatch(prompt, /减少文字密度/); await delay(120); }
      else if (matched[0] === 5) { assert.equal(uploadedMaskHash, null); assert.match(prompt, /减少文字密度/); assert.doesNotMatch(prompt, /背景改成浅蓝色/); }
      else throw new Error("Revision used a non-target source");
      json(res, { data: [{ b64_json: png.toString("base64") }] });
    } else if (req.url === "/v1/models") json(res, { data: [{ id: "gpt-5.6-sol" }, { id: "gpt-image-2" }] });
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

const fixtureNodes = [];
mkdirSync(join(project, "output", "imagegen"), { recursive: true });
mkdirSync(join(project, "assets"), { recursive: true });
for (let index = 1; index <= 7; index++) {
  const bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: index * 28, g: 180, b: 230 - index * 20 } } }).png().toBuffer();
  seedBuffers.push(bytes); const contentHash = createHash("sha256").update(bytes).digest("hex");
  const relativePath = index % 2 ? `assets/product-${index}.png` : `output/imagegen/product-${index}.png`;
  const file = join(project, relativePath); writeFileSync(file, bytes);
  fixtureNodes.push({ id: `N000${index}`, title: `商品图${index}`, type: "image", status: "done", x: 50 + (index % 3) * 260, y: 50 + Math.floor(index / 3) * 300, branch: "project-agent", outputs: 1,
    assets: [{ type: "file", path: file, relativePath, assetId: `image-${contentHash.slice(0, 32)}`, occurrenceId: `occ-${String(index).padStart(32, "0")}`, contentHash, width: 128, height: 128, mimeType: "image/png", status: "done" }] });
}
try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: "task-conversation", conversations: [{ id: "task-conversation", title: "本地任务", messages: [] }], nodes: fixtureNodes, messages: [], layoutGroups: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "task-project", projects: [{ id: "task-project", name: "AI Native 本地任务验收", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base,
    serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", agentModel: "gpt-5.6-sol", agentModelPool: ["gpt-5.6-sol"], contextStrategy: "codex",
    agentModelBindings: [{ model: "gpt-5.6-sol", customBaseUrl: base, customApiKey: "fixture-agent" }],
    imageConnectionVersion: 1, imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1,
    imageModelBindings: [{ model: "gpt-image-2", customBaseUrl: base, customApiKey: "fixture-image", protocol: "openai-images", gateway: "direct" }],
    imageModelConfigs: [{ model: "gpt-image-2", protocol: "openai-images", gateway: "direct", capabilities: { edit: true, referenceImages: true, multiReferenceImages: true, mask: true, supportedQualities: ["auto", "high"] } }], glassTheme: "light-classic", agentPanelWidth: 350 }));
  if (!exe) {
    const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  }

  const projectInfo = { id: "task-project", path: project, sessionPath: join(project, "session.json") };
  const owner = createRequire(import.meta.url)("../desktop/project-creation-service.cjs").createProjectCreationService({ projectFor: () => projectInfo,
    readSession: () => JSON.parse(readFileSync(projectInfo.sessionPath, "utf8")), projectRelativePath: (root, file) => file.slice(root.length + 1).replaceAll("\\", "/"), resolveProjectRelativePath: (root, file) => join(root, file) });
  const scope = { expectedProjectId: "task-project", conversationId: "task-conversation" };
  const initial = owner.updateRequirements({ ...scope, expectedRevision: 0, requirements: {
    goal: { text: "七张商品图", source: "user" }, usage: { text: "电商商品展示", source: "user" },
    slots: fixtureNodes.map((node, index) => ({ slotId: `product-slot-${index + 1}`, label: node.title, source: "user" })),
    preserve: [{ criterionId: "product-subject", text: "保留商品主体", source: "user" }], adjustable: [],
    conditions: [{ criterionId: "text-readable", text: "文字应清晰可读", source: "user" }], fileRules: { formats: ["png"] }
  } });
  const initialSession = JSON.parse(readFileSync(projectInfo.sessionPath, "utf8"));
  initialSession.nodes.forEach((node, index) => { node.taskProvenance = { version: 1, taskScopeSnapshotHash: `scope-${"a".repeat(32)}`, resultPolicy: "single", creation: initial.requirementRef, creationSlotId: `product-slot-${index + 1}` }; });
  // Deliberately permute persisted nodes: display order cannot identify a target.
  initialSession.nodes = [initialSession.nodes[4], initialSession.nodes[0], initialSession.nodes[6], initialSession.nodes[1], initialSession.nodes[5], initialSession.nodes[2], initialSession.nodes[3]];
  writeFileSync(projectInfo.sessionPath, JSON.stringify(initialSession));
  await launch();
  const targets = [fixtureNodes[1].assets[0], fixtureNodes[4].assets[0]].map(({ assetId, occurrenceId, contentHash }) => ({ assetId, occurrenceId, contentHash }));
  let revisionInput, taskTarget, regionInput, regionTaskTarget;
  await check("persisted requirements and stable slots survive reordered source nodes; minimum-window task review is usable", async () => {
    const snapshot = await command("creation.acceptance.get", scope); assert.equal(snapshot.results.length, 7);
    for (const target of targets) assert.equal(snapshot.results.find(result => result.target.assetId === target.assetId).slotId, `product-slot-${target === targets[0] ? 2 : 5}`);
    if (!exe) await ev("window.naimageConfig.debugWindowBounds({width:884,height:640})");
    else await ev("window.resizeTo(884,640); undefined");
    await delay(200);
    await wait("Boolean(document.querySelector('[data-creation-session]'))");
    await ev("document.querySelector('[data-creation-session]').open=true"); await screenshot("requirements-minimum");
    const bounds = await ev("({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})");
    assert.equal(bounds.width, 884); assert.equal(bounds.height, 640); assert.equal(bounds.overflow, false);
  });
  await check("real GUI requirement edit is authoritative; stale CLI edit cannot overwrite it", async () => {
    await ev("document.querySelector('.creation-requirements').open=true");
    await ev("(()=>{const e=document.querySelector('.creation-field textarea');e.focus();e.select()})()");
    await client.send("Input.insertText", { text: "七张商品图，保持统一品牌风格" });
    await ev("[...document.querySelectorAll('.creation-requirements button')].find(e=>e.textContent.includes('保存')).click()");
    await until(async () => (await command("creation.requirements.get", scope)).requirements.revision === 2, "GUI requirement saved");
    const { requirementId, conversationId, revision, fingerprint, updatedAt, ...body } = initial.requirements;
    const stale = await command("creation.requirements.update", { ...scope, expectedRevision: 1, requirements: body }, true);
    assert.equal(stale.code, "CREATION_REQUIREMENTS_CONFLICT");
    await screenshot("requirements-edited");
  });
  await check("only source 2/background and source 5/text produce two loopback POSTs; concurrent GUI/CLI retries share one task", async () => {
    const current = await command("creation.requirements.get", scope);
    revisionInput = { ...scope, requirementId: current.requirements.requirementId, expectedRevision: current.requirements.revision,
      preserve: ["保留商品主体"], changes: [], targets: [{ ...targets[0], changes: ["背景改成浅蓝色"] }, { ...targets[1], changes: ["减少文字密度"] }] };
    await ev("document.querySelector('.creation-requirements').open=false");
    for (const number of [2, 5]) await ev(`(()=>{const e=[...document.querySelectorAll('.creation-result')].find(e=>e.querySelector('strong')?.textContent.endsWith('商品图${number}'));e.querySelector('input').click()})()`);
    for (const [number, text] of [[2, "背景改成浅蓝色"], [5, "减少文字密度"]]) {
      await ev(`(()=>{const e=[...document.querySelectorAll('.creation-revision label')].find(e=>e.textContent.includes('仅此成果的修改要求')&&e.textContent.includes('商品图${number}')).querySelector('textarea');e.focus();e.select()})()`);
      await client.send("Input.insertText", { text });
    }
    await ev("(()=>{const e=[...document.querySelectorAll('.creation-revision label')].find(e=>e.textContent.includes('保留要求')).querySelector('textarea');e.focus();e.select()})()");
    await client.send("Input.insertText", { text: "保留商品主体" });
    await ev("document.querySelector('.creation-revision button').scrollIntoView({block:'center'})");
    await screenshot("selected-two-targets");
    await click(client, ".creation-revision button");
    await until(() => JSON.parse(readFileSync(join(project, '.naimage/creation.json'), 'utf8')).revisions.length === 1, "GUI revision plan committed");
    revisionInput.submissionId = JSON.parse(readFileSync(join(project, '.naimage/creation.json'), 'utf8')).revisions[0].submissionId;
    const [first, second] = await Promise.all([command("creation.revision.start", revisionInput), Promise.resolve().then(() => cli("creation.revision.start", revisionInput))]);
    assert.equal(second.ok, true); assert.equal(first.task.taskId, second.result.task.taskId); taskTarget = { ...scope, taskId: first.task.taskId };
    releaseFirst();
    await until(async () => {
      const task = (await command("agent.task.get", taskTarget)).task;
      assert.ok(!["failed", "save-failed", "interrupted", "uncertain", "partial"].includes(task.phase), `Two-target task ended as ${task.phase}: ${task.error?.message || ""}`);
      return task.phase === "completed";
    }, "two targeted results saved", 60000);
    assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 2);
    assert.deepEqual(report.wire.map(item => item.sourceNumbers[0]).sort(), [2, 5]);
    const session = JSON.parse(readFileSync(projectInfo.sessionPath, "utf8")); assert.equal(session.nodes.flatMap(node => node.assets || []).length, 9);
    for (let index = 0; index < 7; index++) assert.equal(createHash("sha256").update(readFileSync(fixtureNodes[index].assets[0].path)).digest("hex"), fixtureNodes[index].assets[0].contentHash);
    const original = await command("creation.revision.start", revisionInput); assert.equal(original.task.taskId, first.task.taskId); assert.equal(report.imagePosts, 2);
    const conflict = await command("creation.revision.start", { ...revisionInput, changes: ["different"] }, true); assert.equal(conflict.ok, false);
    const materialLabels = await ev("[...document.querySelectorAll('.project-agent-material-chip')].map(e=>[e.innerText,e.title].join(' ')).join('\\n')");
    assert.doesNotMatch(materialLabels,/\b(?:image|asset|occ|mask|run)-[a-f0-9-]{12,}/i,"Ordinary material chips use friendly result labels");
    await screenshot("two-results-saved");
  });
  await check("new versions expose explicit before/after baselines, separate inspection and catalog adopt/undo", async () => {
    const current = await command("creation.acceptance.get", scope);
    const derived = current.results.filter(result => !fixtureNodes.some(node => node.assets[0].assetId === result.target.assetId));
    assert.equal(derived.length, 2);
    assert.equal(derived.every(result => result.saved && result.current && result.fileCheck?.status === "passed" && !result.visualReview), true,
      "Saved Main results receive actual automatic file checks without inventing AI inspection");
    await until(() => ev("[...document.querySelectorAll('.creation-result')].filter(e=>{const f=e.querySelectorAll('.creation-comparison figure');return f.length===2&&f[0].textContent.includes('修改基准')&&f[1].textContent.includes('修改后')}).length===2"), "two explicit comparisons");
    assert.equal(await ev("Promise.all([...document.querySelectorAll('.creation-comparison img')].map(async e=>{try{e.loading='eager';await e.decode();return e.naturalWidth>0}catch{return false}})).then(values=>values.every(Boolean))"), true, "all comparison pixels decode");
    await ev("(()=>{const e=[...document.querySelectorAll('.creation-result')].find(e=>e.querySelector('.creation-comparison figure figcaption')?.textContent.includes('修改基准'));e.scrollIntoView({block:'start'})})()");
    await screenshot("before-after-review");
    const first = derived[0];
    const resultIndex = current.results.findIndex(result => result.target.occurrenceId === first.target.occurrenceId);
    await ev(`(()=>{const e=document.querySelectorAll('.creation-result')[${resultIndex}];const b=[...e.querySelectorAll('button')].find(b=>b.textContent==='采用');b.dataset.creationAction='adopt';b.scrollIntoView({block:'center'})})()`);
    await click(client, '[data-creation-action="adopt"]');
    await until(async () => (await command("creation.acceptance.get", scope)).results.some(result => result.target.assetId === first.target.assetId && result.decision.state === "approved"), "catalog adoption");
    await screenshot("adopted");
    await ev(`(()=>{const e=document.querySelectorAll('.creation-result')[${resultIndex}];const b=[...e.querySelectorAll('button')].find(b=>b.textContent==='待定');b.dataset.creationAction='undo';b.scrollIntoView({block:'center'})})()`);
    await click(client, '[data-creation-action="undo"]');
    await until(async () => (await command("creation.acceptance.get", scope)).results.find(result => result.target.occurrenceId === first.target.occurrenceId).decision.state === "candidate", "GUI undo adoption");
    assert.equal(report.imagePosts, 2);
  });
  await check("single-target region button reuses the paint editor and saves one mask-bound durable task", async () => {
    const current = await command("creation.acceptance.get", scope);
    assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 2);
    await ev("(()=>{for(const e of document.querySelectorAll('.creation-result-select input:checked'))e.click();const row=[...document.querySelectorAll('.creation-result')].find(e=>e.querySelector('strong')?.textContent.endsWith('商品图2'));row.querySelector('input').click()})()");
    await ev("(()=>{const b=[...document.querySelectorAll('.creation-revision button')].find(b=>b.textContent==='精确区域修改');if(!b||b.disabled)throw new Error('region revision unavailable');b.dataset.regionAction='open';b.scrollIntoView({block:'center'})})()");
    await click(client, '[data-region-action="open"]');
    await wait("Boolean(document.querySelector('.region-redraw-canvas-shell.ready'))");
    const editor = await ev("(()=>{const d=document.querySelector('.region-redraw-dialog'),c=d.querySelector('.region-redraw-mask-canvas'),s=d.querySelector('.region-redraw-source-canvas'),r=d.getBoundingClientRect(),p=c.getBoundingClientRect();return {source:[s.width,s.height],pixel:[...s.getContext('2d').getImageData(64,64,1,1).data],visible:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,canvas:{x:p.x,y:p.y,width:p.width,height:p.height},viewport:{width:innerWidth,height:innerHeight}}})()");
    assert.deepEqual(editor.source, [128,128]); assert.deepEqual(editor.pixel, [56,180,190,255]); assert.equal(editor.visible, true);
    assert.deepEqual(editor.viewport, {width:884,height:640});
    await screenshot("region-editor-minimum");
    const start = { x: editor.canvas.x + editor.canvas.width * 0.22, y: editor.canvas.y + editor.canvas.height * 0.35 };
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
    for (let step=1;step<=4;step++) await client.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:start.x+editor.canvas.width*0.035*step,y:start.y+editor.canvas.height*0.015*step,button:"left",buttons:1});
    await client.send("Input.dispatchMouseEvent", {type:"mouseReleased",x:start.x+editor.canvas.width*0.14,y:start.y+editor.canvas.height*0.06,button:"left",buttons:0,clickCount:1});
    const painted = await ev("(()=>{const c=document.querySelector('.region-redraw-mask-canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return Array.from({length:a.length/4},(_,i)=>a[i*4+3]>8).filter(Boolean).length})()");
    assert.ok(painted>=24&&painted<128*128, "Real pointer strokes paint a partial region");
    const regionPrompt = "仅把涂抹区域改成金色星形徽章";
    await ev("(()=>{const e=document.querySelector('.region-redraw-prompt-field textarea');e.focus();e.select()})()");
    await client.send("Input.insertText", {text:regionPrompt});
    await screenshot("region-painted");
    await ev("(()=>{const b=[...document.querySelectorAll('.region-redraw-footer button')].find(b=>b.textContent.includes('执行'));if(!b||b.disabled)throw new Error('region submit unavailable');b.dataset.regionAction='submit'})()");
    await click(client,'[data-region-action="submit"]');
    await until(()=>JSON.parse(readFileSync(join(project,'.naimage/creation.json'),'utf8')).revisions.length===2,"region revision accepted");
    const savedPlan = JSON.parse(readFileSync(join(project,'.naimage/creation.json'),'utf8')).revisions[1];
    const mask = savedPlan.result.targets[0].mask;
    assert.equal(savedPlan.result.targets.length,1); assert.deepEqual(Object.keys(mask),['assetId','occurrenceId','contentHash']);
    regionInput = {...scope,requirementId:current.requirements.requirementId,expectedRevision:current.requirements.revision,
      submissionId:savedPlan.submissionId,preserve:['保留商品主体'],changes:[],targets:[{...targets[0],mask,preserve:[],changes:[regionPrompt]}]};
    const receipt = await command('creation.revision.start',regionInput);
    regionTaskTarget={...scope,taskId:receipt.task.taskId}; assert.notEqual(regionTaskTarget.taskId,taskTarget.taskId);
    await until(async()=>{const task=(await command('agent.task.get',regionTaskTarget)).task;assert.ok(!['failed','save-failed','interrupted','uncertain','partial'].includes(task.phase),`Region task ended as ${task.phase}: ${task.error?.message||''}`);return task.phase==='completed'},'region result saved',60000);
    assert.equal(report.imagePosts,3);assert.equal(report.modelPosts,4);assert.deepEqual(report.wire[2].sourceNumbers,[2]);
    const registry=JSON.parse(readFileSync(join(project,'.naimage/creation-masks/manifest.json'),'utf8'));
    assert.equal(registry.masks.length,1);assert.deepEqual(registry.masks[0].target,targets[0]);
    const maskFile=readFileSync(join(project,registry.masks[0].relativePath)),maskInfo=await sharp(maskFile).metadata();
    assert.deepEqual([maskInfo.width,maskInfo.height],[128,128]);assert.equal(createHash('sha256').update(maskFile).digest('hex'),report.wire[2].uploadedMaskHash);
    const snapshot=await command('creation.acceptance.get',scope);assert.equal(snapshot.results.length,10);assert.equal(snapshot.requirements.revision,4);
    const regionResult=snapshot.results.find(result=>result.baseline?.target.occurrenceId===targets[0].occurrenceId&&!current.results.some(previous=>previous.target.occurrenceId===result.target.occurrenceId));
    assert.ok(regionResult?.saved);assert.equal(regionResult.current,true);assert.equal(regionResult.fileCheck?.status,'passed');assert.equal(regionResult.visualReview,undefined);
    const repeated=await command('creation.revision.start',regionInput);assert.equal(repeated.task.taskId,regionTaskTarget.taskId);assert.equal(report.imagePosts,3);
    for(let index=0;index<7;index++)assert.equal(createHash('sha256').update(readFileSync(fixtureNodes[index].assets[0].path)).digest('hex'),fixtureNodes[index].assets[0].contentHash);
    await screenshot('region-result-saved');
  });
  await check("detached mutation, reload and normal restart share authoritative decisions and three new versions without execution", async () => {
    await client.send("Page.reload"); await wait("Boolean(document.querySelector('[data-creation-session]'))");
    await click(client, '[aria-label="调整对话框位置"]');
    await ev("[...document.querySelectorAll('.agent-placement-menu button')].find(b=>b.textContent.includes('独立浮动窗口')).click()");
    const target = await pollForDebugTarget({ port: debugPort, attempts: 100, intervalMs: 100, findTarget: list => list.find(item => item.type === "page" && /agent-window\.html/.test(item.url)) });
    agentClient = new BasicCdpClient(target.webSocketDebuggerUrl); await agentClient.open(); await agentClient.send("Runtime.enable"); await agentClient.send("Page.enable");
    await until(() => evaluateRuntime(agentClient, "(()=>{const e=document.querySelector('#agent-creation-session');return !!e&&!e.hidden&&e.querySelectorAll('.creation-result').length===10&&getComputedStyle(e).display!=='none'})()"), "detached creation state");
    await evaluateRuntime(agentClient, "document.querySelector('#agent-creation-session').open=true");
    const detachedSurface = await evaluateRuntime(agentClient, "(()=>{const e=document.querySelector('#agent-creation-session'),r=e.getBoundingClientRect(),s=e.querySelector('summary').getBoundingClientRect();return {rows:e.querySelectorAll('.creation-result').length,visible:!e.hidden&&r.width>100&&r.height>20&&s.top>=0&&s.bottom<=innerHeight&&s.right<=innerWidth,viewport:{width:innerWidth,height:innerHeight},bounds:{x:r.x,y:r.y,width:r.width,height:r.height}}})()");
    assert.equal(detachedSurface.visible, true); assert.equal(detachedSurface.rows, 10); report.windows.push({ surface: 'detached-creation', ...detachedSurface });
    await screenshot("detached-review", agentClient);
    const before=await command('creation.acceptance.get',scope),reviewed=before.results.find(result=>result.current&&result.fileCheck?.status==='passed'&&!fixtureNodes.some(node=>node.assets[0].occurrenceId===result.target.occurrenceId));
    assert.ok(reviewed,'Region output has current local file evidence');
    const rowIndex=before.results.findIndex(result=>result.target.occurrenceId===reviewed.target.occurrenceId);
    await evaluateRuntime(agentClient,`(()=>{const e=document.querySelectorAll('.creation-result')[${rowIndex}],b=[...e.querySelectorAll('button')].find(b=>b.textContent==='采用');if(b.disabled)throw new Error('detached adopt disabled');b.dataset.detachedAction='adopt';b.scrollIntoView({block:'center'})})()`);
    await click(agentClient,'[data-detached-action="adopt"]');
    await until(async()=>(await command('creation.acceptance.get',scope)).results.find(result=>result.target.occurrenceId===reviewed.target.occurrenceId).decision.state==='approved','detached adoption authoritative');
    await until(()=>evaluateRuntime(agentClient,"document.querySelector('[data-creation-summary]').textContent.includes('已采用 1')"),'detached adoption visible');
    await screenshot('detached-adopted',agentClient);
    await evaluateRuntime(agentClient,`(()=>{const e=document.querySelectorAll('.creation-result')[${rowIndex}],b=[...e.querySelectorAll('button')].find(b=>b.textContent==='待定');b.dataset.detachedAction='undo';b.scrollIntoView({block:'center'})})()`);
    await click(agentClient,'[data-detached-action="undo"]');
    await until(async()=>(await command('creation.acceptance.get',scope)).results.find(result=>result.target.occurrenceId===reviewed.target.occurrenceId).decision.state==='candidate','detached undo authoritative');
    await until(()=>evaluateRuntime(agentClient,"document.querySelector('[data-creation-summary]').textContent.includes('已采用 0')"),'detached undo visible');
    assert.equal(report.imagePosts,3);assert.equal(report.modelPosts,4);await screenshot('detached-undone',agentClient);
    await stop(); await launch();
    const snapshot = await command("creation.acceptance.get", scope); assert.equal(snapshot.results.length, 10); assert.equal(snapshot.requirements.revision, 4);
    assert.equal(snapshot.results.find(result=>result.target.occurrenceId===reviewed.target.occurrenceId).decision.state,'candidate');
    const repeated = await command("creation.revision.start", revisionInput); assert.equal(repeated.task.taskId, taskTarget.taskId);
    const repeatedRegion=await command('creation.revision.start',regionInput);assert.equal(repeatedRegion.task.taskId,regionTaskTarget.taskId);
    assert.equal(report.imagePosts, 3);assert.equal(report.modelPosts,4);await screenshot("restart-review");
  });
  await stop(); report.ok=true; checkpoint(); console.log(JSON.stringify({ok:true,checks:report.checks.length,modelPosts:report.modelPosts,imagePosts:report.imagePosts,screenshots:report.screenshots.length,report:join(runDir,"report.json")}));
} catch(error) {
  releaseFirst(); report.error=error.stack; console.error(error); process.exitCode=1;
  if (agentClient) {
    report.detachedFailure = await evaluateRuntime(agentClient, "(()=>{const e=document.querySelector('#agent-creation-session'),t=document.querySelector('#agent-task-card');return {readyState:document.readyState,bridgeMethods:Object.keys(window.naimageAgentWindowSurface||{}),creation:{exists:!!e,hidden:e?.hidden,rows:e?.querySelectorAll('.creation-result').length,text:e?.innerText?.slice(0,1600)},task:{exists:!!t,hidden:t?.hidden,textarea:!!t?.querySelector('textarea'),text:t?.innerText?.slice(0,500)},bodyText:document.body.innerText.slice(0,2000)}})()").catch(error => ({ error: error.message }));
    await screenshot("detached-failure", agentClient).catch(()=>{});
  }
  if(client) { await screenshot("failure").catch(()=>{}); await stop().catch(()=>{}); }
  checkpoint();
} finally { if(vite) vite.kill(); server.closeAllConnections(); server.close(); }
