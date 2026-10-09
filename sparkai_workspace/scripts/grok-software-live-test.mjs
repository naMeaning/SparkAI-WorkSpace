// Explicitly authorized, one-shot software verification. Never copy account
// refresh credentials into another config and never automatically rerun this.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

if (!process.argv.includes("--authorized-one-image")) throw new Error("Explicit real-request authorization is required.");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exeArg = process.argv.find(arg => arg.startsWith("--exe="));
if (!exeArg) throw new Error("Use an actual local desktop EXE with the existing user login.");
const executable = resolve(exeArg.slice(6));
assert.ok(existsSync(executable));
const require = createRequire(import.meta.url);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const symbolPlan = buildProductionSymbolPlan(repoRoot);
const evaluate = (client, expression, ...options) => evaluateRaw(client, transformCode(expression, symbolPlan, "live-test.js"), ...options);
const runDir = join(repoRoot, ".diagnostics/electron", `grok-software-live-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const userDataDir = join(process.env.APPDATA, "naimage");
const configDir = join(userDataDir, "data");
const projectListPath = join(configDir, "project-list.json");
const projectDir = join(runDir, "project");
const projectId = `grok-verification-${Date.now()}`;
const priorList = JSON.parse(readFileSync(projectListPath, "utf8"));
const priorActive = priorList.activeProjectId;
let electronProcess, client;
let stage = "startup";
const report = { ok: false, mock: false, packaged: true, usesExistingUserData: true, attemptedSend: false, dispatched: false, imageRequests: 0, screenshots: [] };
const save = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const safeStatus = (value) => process.stdout.write(JSON.stringify(value) + "\n");
async function click(selector, text = "") {
  // Use the rendered DOM action in the real application. Coordinates can move
  // while model/frame settings finish loading; never submit a second click.
  await evaluate(client, `(() => { const el=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>!${JSON.stringify(text)} || el.textContent.includes(${JSON.stringify(text)})); if(!el||el.disabled) throw new Error('Missing software action'); el.click(); })()`);
}
try {
  mkdirSync(projectDir, { recursive: true });
  save();
  const now = new Date().toISOString();
  writeFileSync(projectListPath, JSON.stringify({ ...priorList, activeProjectId: projectId, projects: [...priorList.projects,
    { id: projectId, name: "Grok 真实验证 2026-10-08", path: projectDir, sessionPath: join(projectDir, "session.json"), createdAt: now, updatedAt: now, external: true }
  ] }, null, 2));
  const debugPort = await allocateDebugPort();
  electronProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: dirname(executable), windowsHide: true, stdio: "ignore", env: { ...process.env,
      NAIMAGE_DEV_URL: "", NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"),
      NAIMAGE_AIDEBUG: "0", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "0", NAIMAGE_AIDEBUG_LIVE_IMAGE: "0"
    }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: (targets) => targets.find((item) => item.type === "page" && /index\.html/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate, timeoutMs: 60000, intervalMs: 200 });
  const settings = await evaluate(client, "window.naimageConfig.loadSettings().then(result=>({ok:result.ok,agentModel:result.settings?.agentModel,imageModel:result.settings?.imageModel}))");
  report.models = settings;
  assert.equal(settings.imageModel, "grok-imagine-image-2.0");
  report.session = await evaluate(client, "window.naimageServer.me().then(result=>({ok:result.ok,verifiedByUserApi:result.ok===true&&Boolean(result.user?.id),hasUser:Boolean(result.user?.id),customUser:result.user?.id==='custom-api'}))");
  assert.equal(report.session.ok, true);
  assert.equal(report.session.hasUser, true);
  assert.equal(report.session.customUser, false);
  await capturePngScreenshotToFile(client, join(runDir, "existing-login.png"), { captureBeyondViewport: false });
  report.screenshots.push("existing-login.png");
  stage = "send";
  // Text is a test instruction, never a copy of the user's private conversation.
  const prompt = "请进行一次真实生图验证：用当前选中的 Grok 图片模型生成且只生成 1 张图片，内容为哆啦A梦正面站立挥手、淡蓝色背景、完整全身、清晰卡通插画。使用 image_gen，n=1，不生成第二张、不编辑、不重试生图。成功后用 view_image 查看刚生成的图片，再用简短中文说明画面主体和图片是否正常。若后续对话失败也保留该图，不要重生。";
  await evaluate(client, `(() => { const t=document.querySelector('.project-agent-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(prompt)}); t.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-send:not(:disabled)'))", { evaluate, timeoutMs: 5000, intervalMs: 100 });
  // Persist the dispatch marker before submitting; a timeout is never permission
  // to submit again. One click is the entire creation authorization.
  report.attemptedSend = true; save();
  await click(".project-agent-send");
  stage = "agent";
  let previous = "";
  const deadline = Date.now() + 8 * 60_000;
  let lastEvents = [];
  while (Date.now() < deadline) {
    await delay(1000);
    const state = await evaluate(client, `window.naimageConfig.readDiagnostics().then(log=>({events:log.events,status:document.querySelector('.project-agent-status')?.textContent, busy:document.querySelector('.project-agent-send')?.disabled, images:Array.from(document.querySelectorAll('.workflow-node img,.canvas-node img,.canvas-stage img')).filter(img=>img.complete&&img.naturalWidth>0).length, hasError:Boolean(document.querySelector('.agent-message.error'))}))`);
    lastEvents = state.events || [];
    if (lastEvents.length) report.dispatched = true;
    report.imageRequests = lastEvents.filter(event => event.kind === "image" && event.stage === "generation" && event.phase === "request").length;
    const compact = JSON.stringify({ stage, imageRequests: report.imageRequests, images: state.images, last: lastEvents.at(-1) });
    if (compact !== previous) { safeStatus(JSON.parse(compact)); previous = compact; }
    if (report.imageRequests > 1) {
      await evaluate(client, "document.querySelector('.project-agent-stop')?.click()");
      throw new Error("Multiple image requests observed");
    }
    const runState = await evaluate(client, `window.naimageAgent.runStatus({projectId:${JSON.stringify(projectId)}}).then(state=>({ok:state.ok,count:state.runs?.length}))`);
    if (lastEvents.length && runState.ok && runState.count === 0 && /思考完成|等待指令|遇到问题|后续对话未完成/.test(state.status || "")) {
      report.status = state.hasError ? "error" : /后续对话未完成/.test(state.status || "") ? "partial" : "done";
      report.renderedImages = state.images;
      break;
    }
  }
  report.events = lastEvents;
  assert.ok(report.status, "Software run did not settle; never resend an unknown creation");
  stage = "evidence";
  await capturePngScreenshotToFile(client, join(runDir, "real-result.png"), { captureBeyondViewport: false });
  report.screenshots.push("real-result.png");
  const assets = [];
  const inspect = async (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (/\.(?:png|jpe?g|webp)$/i.test(entry.name)) {
        const bytes = readFileSync(file);
        const metadata = await (await import("sharp")).default(bytes).metadata();
        assets.push({ file: file.slice(projectDir.length + 1).replace(/\\/g, "/"), size: bytes.length, format: metadata.format, width: metadata.width, height: metadata.height, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  };
  await inspect(join(projectDir, "output"));
  report.assets = assets;
  report.viewCompleted = lastEvents.some(event => event.kind === "view_image" && event.phase === "done");
  report.imageReturned = lastEvents.some(event => event.kind === "image" && event.stage === "generation" && event.phase === "response");
  report.imageSaved = lastEvents.some(event => event.kind === "image" && event.stage === "result" && event.phase === "done");
  await click('button[aria-label="打开设置"]');
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('button[data-settings-section=\"tools\"]'))", { evaluate, timeoutMs: 8000, intervalMs: 100 });
  await click('button[data-settings-section="tools"]');
  await waitForRuntimeExpression(client, "Array.from(document.querySelectorAll('.settings-drawer button')).some(b=>b.textContent.includes('查看日志'))", { evaluate, timeoutMs: 5000, intervalMs: 100 });
  await click('.settings-drawer button', '查看日志');
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('textarea[aria-label=\"诊断日志\"]')?.value)", { evaluate, timeoutMs: 5000, intervalMs: 100 });
  await capturePngScreenshotToFile(client, join(runDir, "real-diagnostics.png"), { captureBeyondViewport: false });
  report.screenshots.push("real-diagnostics.png");
  assert.equal(report.imageRequests, 1);
  assert.equal(report.imageReturned, true);
  assert.equal(report.imageSaved, true);
  assert.equal(report.viewCompleted, true);
  assert.ok(report.renderedImages >= 1);
  assert.equal(report.status, "done");
  report.ok = true;
} catch (error) {
  report.failedStage = stage;
  report.errorType = error.name;
  if (client) { try { await capturePngScreenshotToFile(client, join(runDir, "failure.png"), { captureBeyondViewport: false }); report.screenshots.push("failure.png"); } catch {} }
  process.exitCode = 1;
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  // Retain the verification project and restore the user's previous selection.
  const current = JSON.parse(readFileSync(projectListPath, "utf8"));
  if (current.activeProjectId === projectId) writeFileSync(projectListPath, JSON.stringify({ ...current, activeProjectId: priorActive }, null, 2));
  save();
  safeStatus({ ...report, evidence: runDir });
}
