import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", "electron", `sequential-workflow-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config");
const report = { ok: false, realModelRequests: 0, checks: [], screenshots: [] };
const saveReport = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const productBreaks = [];
mkdirSync(config, { recursive: true });
const projects = [];
for (const [index, color] of ["#90b8eb", "#dca4ae"].entries()) {
  const id = `workflow-project-${index + 1}`;
  const directory = join(runDir, id);
  const sessionPath = join(directory, "session.json");
  const sourcePath = join(directory, "assets", "source.png");
  mkdirSync(join(directory, "assets"), { recursive: true });
  const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: color } }).png().toBuffer();
  writeFileSync(sourcePath, image);
  const contentHash = createHash("sha256").update(image).digest("hex");
  const asset = { type: "file", path: sourcePath, relativePath: "assets/source.png", assetId: `asset-${contentHash.slice(0, 32)}`, occurrenceId: `occ-${String(index + 1).repeat(32)}`, contentHash, mimeType: "image/png", width: 128, height: 128 };
  projects.push({ id, name: `项目 ${index + 1}`, path: directory, sessionPath, external: true });
  const initialNodes = [{ id: "N0001", title: `原图 ${index + 1}`, type: "image", status: "done", imageState: "done", x: 50, y: 70, width: 260, height: 260, assets: [asset], outputs: 1 }];
  if (index === 0) {
    initialNodes.push({ id: "N0002", displayCode: "N0002", title: "旧商品图需求", prompt: "保留商品主体并优化质感", type: "requirement", status: "done", x: 380, y: 70, width: 320, height: 230, parentId: "N0001", relationType: "referenced", outputs: 0, requirement: { version: 2, text: "保留商品主体并优化质感", revision: 1, createdFrom: "node", inputBindings: [{ nodeId: "N0001", role: "source" }] } });
  }
  writeFileSync(sessionPath, JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodeSequence: initialNodes.length, nodes: initialNodes, layoutGroups: [], messages: [], selectedNodeId: "N0001", activeConversationId: `workflow-conversation-${index + 1}`, conversations: [{ id: `workflow-conversation-${index + 1}`, title: "工作流验证", messages: [] }], workspaceDomain: index === 0 ? "commerce" : "general" }));
}
writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: projects[0].id, projects }));
writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverToken: "fixture-token", serverUserId: "1", accountBaseUrl: "http://127.0.0.1:1", serverUrl: "http://127.0.0.1:1", relayBaseUrl: "http://127.0.0.1:1", updateBaseUrl: "http://127.0.0.1:1", glassTheme: "light-blush", imageModel: "gpt-image-2", agentModel: "fixture-chat" }));
const legacyIds = [`reqtpl-${"1".repeat(32)}`, `reqtpl-${"2".repeat(32)}`];
writeFileSync(join(config, "requirement-library.json"), JSON.stringify({ schemaVersion: 2, items: [
  { version: 2, id: legacyIds[0], title: "旧文生图模板", text: "生成图片：一只{{color}}小猫", template: { version: 2, variables: [{ key: "color", label: "颜色", type: "text", default: "橙色" }] } },
  { version: 1, id: legacyIds[1], title: "旧复杂需求", text: "按要求处理并审核成果" }
] }));
writeFileSync(join(runDir, "no-server.cjs"), "process.exit(0);\n");
const devPort = await allocateDebugPort();
const devUrl = `http://127.0.0.1:${devPort}`;
const vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(devPort)], { cwd: root, stdio: "ignore", windowsHide: true });
let electron, client;
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 24000, intervalMs: 70 });
const projectId = index => JSON.stringify(projects[index].id);
const state = index => `window.naimageConfig.sequentialWorkflow({projectId:${projectId(index)},action:'state'})`;
const button = (text, scope) => `[...document.querySelectorAll(${JSON.stringify(scope ? `${scope} button` : "button,[role=menuitem]")})].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)})`;
async function click(expression, { button: mouseButton = "left", modifiers = 0 } = {}) {
  await wait(`Boolean((${expression})&&!(${expression}).disabled)`);
  const point = await ev(`(()=>{const e=${expression};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,reachable:e.contains(document.elementFromPoint(x,y))}})()`);
  assert.equal(point.reachable, true, `reachable: ${expression}`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: mouseButton, modifiers, clickCount: 1 });
}
async function rightClickEmptyCanvas() {
  const point = await ev(`(()=>{const c=document.querySelector('.workflow-canvas');if(!c)return null;const r=c.getBoundingClientRect();for(const [fx,fy] of [[0.85,0.85],[0.85,0.25],[0.2,0.85],[0.5,0.85],[0.6,0.5]]){const x=Math.round(r.left+r.width*fx),y=Math.round(r.top+r.height*fy),hit=document.elementFromPoint(x,y);if(hit&&c.contains(hit)&&!hit.closest('.flow-node,[data-canvas-no-zoom],svg'))return {x,y};}return null;})()`);
  assert.ok(point, "empty canvas point reachable");
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "right", clickCount: 1 });
}
const selector = value => `document.querySelector(${JSON.stringify(value)})`;
async function pressEscape() {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}
function parseRgb(value) {
  const match = String(value || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) } : null;
}
function contrastRatio(fg, bg) {
  const lum = ({ r, g, b }) => [r, g, b].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
async function inspectComparisonModal(themeLabel, screenshotName) {
  const dialogSel = '[role="dialog"][aria-label="所选成果对比"]';
  await wait(`Boolean(${selector(dialogSel)})`);
  await wait(`(()=>{const imgs=[...document.querySelectorAll('${dialogSel} .project-result-comparison-images img')];return imgs.length===2&&imgs.every(i=>i.complete&&i.naturalWidth>0);})()`);
  const info = await ev(`(()=>{const d=${selector(dialogSel)};const s=getComputedStyle(d);const r=d.getBoundingClientRect();return {bg:s.backgroundColor,color:s.color,x:r.x,y:r.y,right:r.right,bottom:r.bottom,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth};})()`);
  const bg = parseRgb(info.bg), fg = parseRgb(info.color);
  const ratio = bg && fg ? Number(contrastRatio(fg, bg).toFixed(2)) : 0;
  report.comparisonChecks = [...(report.comparisonChecks || []), { theme: themeLabel, ...info, contrastRatio: ratio }];
  if (ratio < 4.5) productBreaks.push(`结果对比弹层在 ${themeLabel} 主题下对比度不足 (${info.color} on ${info.bg}, ratio=${ratio})`);
  if (screenshotName) await captureViewportScreenshot(screenshotName);
  await click(selector(`${dialogSel} [aria-label="关闭成果对比"]`));
  await wait(`!${selector(dialogSel)}`);
}
async function choose(query, value) {
  await wait(`Boolean(${selector(query)})`);
  await ev(`(()=>{const e=${selector(query)};e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function writeText(query, value) {
  await click(selector(query));
  await client.send("Input.insertText", { text: value });
}
async function replaceText(query, value) {
  await click(selector(query));
  await ev(`(()=>{const e=${selector(query)};e.focus();e.select();})()`);
  await client.send("Input.insertText", { text: value });
  await wait(`(${selector(query)})?.value===${JSON.stringify(value)}`);
}
async function captureViewportScreenshot(name) {
  const file = `${name}.png`;
  await capturePngScreenshotToFile(client, join(runDir, file), { captureBeyondViewport: false });
  report.screenshots.push(file);
}
async function screenshot(name, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(`innerWidth===${width}&&innerHeight===${height}`);
  const bounds = await ev("(()=>{const p=document.querySelector('.sequential-workflow'),r=p.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,scroll:p.scrollWidth,client:p.clientWidth};})()");
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height && bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
  const file = `${name}.png`;
  await capturePngScreenshotToFile(client, join(runDir, file), { captureBeyondViewport: false });
  report.screenshots.push(file);
}
async function command(name, args) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation", "endpoint.json"), "utf8"));
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command: name, args, timeoutMs: 15000 }) });
  const result = await response.json();
  assert.equal(result.ok, true, `${name}: ${result.error}`);
  return result.result;
}
const panel = ".sequential-workflow";
try {
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  const port = await allocateDebugPort();
  electron = spawn(require("electron"), [root, `--remote-debugging-port=${port}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: root, windowsHide: true, stdio: "ignore",
    env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_AIDEBUG_IMAGE_FAULTS: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "0", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  const target = await pollForDebugTarget({ port, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait("document.documentElement?.dataset.theme==='light'&&Boolean(document.querySelector('.workspace-workflow-entry'))");

  // 1. Visible legacy project/domain tool entry on commerce project
  await wait("Boolean(document.querySelector('#workspace-legacy-tools'))");
  const legacyTriggerBounds = await ev("(()=>{const wf=document.querySelector('.workspace-workflow-entry').getBoundingClientRect();const lg=document.querySelector('#workspace-legacy-tools').getBoundingClientRect();return {wf:{x:wf.x,right:wf.right,y:wf.y,bottom:wf.bottom},lg:{x:lg.x,right:lg.right,y:lg.y,bottom:lg.bottom}};})()");
  assert.ok(legacyTriggerBounds.lg.x >= legacyTriggerBounds.wf.right - 1 && legacyTriggerBounds.lg.right <= 1280, JSON.stringify(legacyTriggerBounds));
  await click(selector("#workspace-legacy-tools"));
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"旧项目工具\"]'))");
  assert.ok(await ev(`Boolean(${button("SKU 商品素材库")})`), "legacy commerce catalog entry visible");
  assert.ok(await ev(`Boolean(${button("一键生成套图")})`), "legacy commerce set entry visible");
  await click(button("SKU 商品素材库"));
  await wait("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"SKU 商品素材库\"]'))");
  await pressEscape();
  await wait("!document.querySelector('[role=\"dialog\"][aria-label=\"SKU 商品素材库\"]')");
  report.checks.push("旧项目可见旧项目工具入口及菜单项打开与关闭");

  // 2. Old requirement node access via rail + canvas node edit
  await click(selector('.workspace-asset-rail-tabs [aria-label="需求"]'));
  await wait("Boolean(document.querySelector('.workspace-asset-rail-list [data-node-id=\"N0002\"]'))");
  await click(selector('.workspace-asset-rail-list [data-node-id="N0002"]'));
  await wait("Boolean(document.querySelector('.flow-node[data-node-id=\"N0002\"].selected'))");
  await click(selector('.flow-node[data-node-id="N0002"]'), { button: "right" });
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"成果菜单\"]'))");
  await click(button("编辑需求"));
  await wait("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"编辑图片处理需求\"]'))");
  await replaceText('[data-ui-surface="requirement-editor"] textarea', "保留商品主体并优化质感 · 已兼容修改");
  await click(selector('[data-ui-surface="requirement-editor"] [aria-label="保存需求"]'));
  await wait("!document.querySelector('[role=\"dialog\"][aria-label=\"编辑图片处理需求\"]')");
  await wait("document.querySelector('.flow-node[data-node-id=\"N0002\"]')?.innerText.includes('已兼容修改')");
  report.checks.push("画布已有旧需求节点可从需求轨定位并通过右键菜单编辑保存");

  // 3. Independent video and ComfyUI entry (no real model/video execution)
  await rightClickEmptyCanvas();
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"画布菜单\"]'))");
  await click(button("创建视频工作"));
  const videoDlg = '[role="dialog"][aria-label="创建视频工作"]';
  await wait(`Boolean(${selector(videoDlg)})`);
  assert.ok(Boolean(await ev(`${selector(`${videoDlg} select`)}.value`)), "video model preselected");
  await writeText(`${videoDlg} textarea`, "镜头缓缓推进展示商品细节");
  assert.equal(await ev(`${button("创建视频", videoDlg)}.disabled`), false);
  await click(button("取消", videoDlg));
  await wait(`!${selector(videoDlg)}`);

  await rightClickEmptyCanvas();
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"画布菜单\"]'))");
  await click(button("创建生图工作"));
  const imageDlg = '[role="dialog"][aria-label="创建生图工作"]';
  await wait(`Boolean(${selector(imageDlg)})`);
  await choose(`${imageDlg} [aria-label="图片执行连接"]`, "comfyui");
  await wait(`Boolean(${selector(`${imageDlg} .comfyui-task-fields`)})`);
  const comfyText = await ev(`${selector(`${imageDlg} .comfyui-task-fields`)}.innerText`);
  assert.ok(comfyText.includes("管理 ComfyUI 连接") && comfyText.includes("审核工作流") && comfyText.includes("导入 API Format JSON 工作流"), comfyText);
  await click(button("取消", imageDlg));
  await wait(`!${selector(imageDlg)}`);

  await click(selector("#workspace-settings-trigger"));
  await wait("Boolean(document.querySelector('[data-settings-section=\"providers\"]'))");
  await click(selector('[data-settings-section="providers"]'));
  await wait("Boolean(document.querySelector('[data-agent-provider-manager]'))");
  await click(selector('[data-agent-local-image] summary'));
  await wait("Boolean(document.querySelector('[aria-label=\"启用 Agent 本机生图\"]'))");
  await pressEscape();
  await wait("!document.querySelector('[data-agent-provider-manager]')||Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"保存未提交的设置\"]')||document.querySelector('[data-ui-surface=\"settings-unsaved\"]'))");
  if (await ev("Boolean(document.querySelector('[data-agent-provider-manager]'))")) {
    await click(button("不保存并关闭"));
  }
  await wait("!document.querySelector('[data-agent-provider-manager]')");
  report.checks.push("独立视频任务弹窗、独立 ComfyUI 生图连接表单及设置入口可用且未发送真实请求");

  // Select N0001 before opening workflow panel
  await click(selector('.workspace-asset-rail-tabs [aria-label="成果"]'));
  await wait("Boolean(document.querySelector('.workspace-asset-rail-list [data-node-id=\"N0001\"]'))");
  await click(selector('.workspace-asset-rail-list [data-node-id="N0001"]'));
  await wait("Boolean(document.querySelector('.flow-node[data-node-id=\"N0001\"].selected'))");
  await click(selector(".workspace-workflow-entry"));
  await click(button("从空白开始", panel));
  await choose(`${panel} [aria-label="步骤类型"]`, "cutout");
  await click(button("添加步骤", panel));
  await choose(`${panel} [aria-label="步骤类型"]`, "background");
  await click(button("添加步骤", panel));
  await writeText(`${panel} .workflow-step-fields textarea`, "浅灰背景");
  await choose(`${panel} .workflow-input select`, `occ-${"1".repeat(32)}`);
  await click(selector(`${panel} [aria-label="上移步骤 2"]`));
  await wait(`(${selector(panel)}).innerText.includes('来源必须是排在本步骤之前的结果')`);
  await click(selector(`${panel} [aria-label="下移步骤 1"]`));
  await screenshot("1280x800-light-draft", 1280, 800);
  await click(button("保存到我的工作流", panel));
  await wait(`(async()=>Boolean((await ${state(0)}).draft.libraryId))()`);
  await click(button("运行", panel));
  await wait(`(async()=>{const s=await ${state(0)};return s.runs[0]?.steps.every(step=>step.published)})()`);
  const first = await ev(state(0));
  assert.equal(first.runs[0].state, "done");
  const project1 = JSON.parse(readFileSync(projects[0].sessionPath, "utf8"));
  const cutout = project1.nodes.find(node => node.assets.some(asset => asset.assetId === first.runs[0].steps[0].output.assetId));
  const background = project1.nodes.find(node => node.assets.some(asset => asset.assetId === first.runs[0].steps[1].output.assetId));
  assert.equal(cutout.parentId, "N0001");
  assert.equal(background.parentId, cutout.id);
  const metadata = await sharp(cutout.assets[0].path).metadata();
  assert.equal(metadata.hasAlpha, true);
  report.checks.push("手动抠图和换背景、排序预检、真实 alpha 检查及两级画布来源");

  // 4. Result comparison via selected source menu (light theme)
  await click(selector(`${panel} [aria-label="关闭工作流"]`));
  await wait(`!${selector(panel)}`);
  await click(selector('.canvas-tools .zoom-button'));
  await wait(`Boolean(document.querySelector('.flow-node[data-node-id="${cutout.id}"] .node-head'))`);
  await click(selector(`.flow-node[data-node-id="${cutout.id}"] .node-head`));
  await click(selector(`.flow-node[data-node-id="${cutout.id}"] .node-head`), { button: "right" });
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"成果菜单\"]'))");
  await click(button("对比图片"));
  await inspectComparisonModal("light", null);

  await click(selector('.flow-node[data-node-id="N0001"] .node-head'));
  await click(selector(`.flow-node[data-node-id="${cutout.id}"] .node-head`), { modifiers: 2 });
  await wait(`Boolean(document.querySelector('.flow-node[data-node-id="N0001"].selected')&&document.querySelector('.flow-node[data-node-id="${cutout.id}"].selected'))`);
  await click(selector(`.flow-node[data-node-id="${cutout.id}"] .node-head`), { button: "right" });
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"多选成果菜单\"]'))");
  await click(button("对比选中图片"));
  await inspectComparisonModal("light", "1280x800-light-comparison");
  report.checks.push("浅色主题下通过右键单选与多选来源菜单打开成果对比并加载双图");

  await click(selector(".workspace-workflow-entry"));
  await click(button("我的工作流", panel));
  await wait(`Boolean(${button("旧需求模板", panel)})`);
  const migrated = JSON.parse(readFileSync(join(config, "sequential-workflows.json"), "utf8"));
  assert.equal(migrated.migrations[legacyIds[0]], "imported");
  assert.equal(migrated.migrations[legacyIds[1]], "legacy");
  await click(button("旧需求模板", panel));
  await wait("Boolean(document.querySelector('[aria-label=\"使用需求模板：旧复杂需求\"]'))");
  await click(selector('[aria-label="使用需求模板：旧复杂需求"]'));
  await wait("[...document.querySelectorAll('.flow-node.requirement-node')].some(e=>e.innerText.includes('旧复杂需求'))");
  report.checks.push("旧需求模板可从工作流旧入口插入当前画布而不自动执行");

  // Check narrow 884x640 topbar with legacy tools visible before switching to general project
  await client.send("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, deviceScaleFactor: 1, mobile: false });
  await wait("innerWidth===884&&innerHeight===640");
  const narrowTopbar = await ev("(()=>{const wf=document.querySelector('.workspace-workflow-entry').getBoundingClientRect();const lg=document.querySelector('#workspace-legacy-tools').getBoundingClientRect();const actions=document.querySelector('.ide-actions').getBoundingClientRect();return {wf:{x:wf.x,right:wf.right},lg:{x:lg.x,right:lg.right},actionsLeft:actions.left};})()");
  if (narrowTopbar.lg.right > narrowTopbar.actionsLeft + 1) productBreaks.push(`884px 窄窗口顶栏旧项目工具与右侧操作区重叠: ${JSON.stringify(narrowTopbar)}`);
  await captureViewportScreenshot("884x640-light-legacy-topbar");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await command("project.switch", { id: projects[1].id });
  await wait("!document.querySelector('#workspace-legacy-tools')");
  await click(selector(".workspace-workflow-entry"));
  await click(button("我的工作流", panel));
  await click(button("未命名工作流 · 2 步", panel));
  await wait(`Boolean(${selector(`${panel} .workflow-input select`)})`);
  assert.equal(await ev(`${selector(`${panel} .workflow-input select`)}.value`), "");
  await choose(`${panel} .workflow-input select`, `occ-${"2".repeat(32)}`);
  await click(button("运行", panel));
  await wait(`(async()=>Boolean((await ${state(1)}).runs[0]?.steps.every(step=>step.published)))()`);
  const second = await command("workflow.manage", { action: "state", expectedProjectId: projects[1].id });
  assert.equal(Object.values(second.runs[0].bindings)[0].occurrenceId, `occ-${"2".repeat(32)}`);
  assert.equal(second.runs[0].steps[1].output.path, undefined);
  report.checks.push("跨项目工作流复用重新绑定、CLI 公共身份、旧模板迁移和访问");

  // 5. One-sentence Agent draft edited then explicitly run
  await click(button("草稿", panel));
  await click(button("让 Agent 修改", panel));
  await writeText(`${panel} .workflow-group textarea`, "把选中的图抠出来，再放到浅灰背景");
  await click(button("让 Agent 起草", panel));
  await wait(`Boolean(${button("2. 换背景", panel)})`);
  assert.equal((await ev(state(1))).runs.length, 1);
  await click(button("2. 换背景", panel));
  await wait(`Boolean(${selector(`${panel} .workflow-step-fields textarea`)})`);
  assert.equal(await ev(`${selector(`${panel} .workflow-step-fields textarea`)}.value`), "浅灰背景");
  await replaceText(`${panel} .workflow-step-fields textarea`, "纯白棚拍背景");
  assert.equal((await ev(state(1))).runs.length, 1);
  if (!(await ev(`${selector(`${panel} .workflow-input select`)}.value`))) {
    await choose(`${panel} .workflow-input select`, `occ-${"2".repeat(32)}`);
  }
  await click(button("运行", panel));
  await wait(`(async()=>{const s=await ${state(1)};return s.runs.length===2&&s.runs[0]?.steps.every(step=>step.published)})()`);
  const third = await ev(state(1));
  assert.equal(third.runs[0].state, "done");
  assert.equal(third.runs[0].definition.steps[1].prompt, "纯白棚拍背景");
  const project2 = JSON.parse(readFileSync(projects[1].sessionPath, "utf8"));
  const editedCutout = project2.nodes.find(node => node.assets?.some(asset => asset.assetId === third.runs[0].steps[0].output.assetId));
  const editedBackground = project2.nodes.find(node => node.assets?.some(asset => asset.assetId === third.runs[0].steps[1].output.assetId));
  assert.equal(editedCutout.parentId, "N0001");
  assert.equal(editedBackground.parentId, editedCutout.id);
  assert.ok(String(editedBackground.prompt || "").includes("纯白棚拍背景"), editedBackground.prompt);
  report.checks.push("一句话 Agent 起草后人工修改参数再明确运行并回到发起项目画布");
  await screenshot("884x640-light-draft", 884, 640);
  await click(selector(`${panel} [aria-label="关闭工作流"]`));
  await wait(`!${selector(panel)}`);
  assert.equal(await ev("window.naimageConfig.saveSettings({glassTheme:'dark-emerald'}).then(r=>r.ok)"), true);
  await client.send("Page.reload");
  await wait("document.documentElement?.dataset.theme==='dark'&&Boolean(document.querySelector('.workspace-workflow-entry'))");
  await click(selector(".workspace-workflow-entry"));
  await wait(`Boolean(${selector(panel)})`);
  const actionColors = await ev("(()=>{const style=getComputedStyle(document.querySelector('.sequential-workflow .workflow-primary'));return {fg:style.color,bg:style.backgroundColor}})()");
  const actionContrast = contrastRatio(parseRgb(actionColors.fg), parseRgb(actionColors.bg));
  assert.ok(actionContrast >= 4.5, `Dark workflow run action contrast: ${actionContrast}`);
  report.darkRunActionContrast = Number(actionContrast.toFixed(2));
  await screenshot("884x640-dark-draft", 884, 640);
  await screenshot("1280x800-dark-draft", 1280, 800);
  await click(selector(`${panel} [aria-label="关闭工作流"]`));
  await wait(`!${selector(panel)}`);
  await click(selector('.canvas-tools .zoom-button'));
  await wait(`Boolean(document.querySelector('.flow-node[data-node-id="${editedBackground.id}"] .node-head'))`);
  await click(selector(`.flow-node[data-node-id="${editedBackground.id}"] .node-head`));
  await click(selector(`.flow-node[data-node-id="${editedBackground.id}"] .node-head`), { button: "right" });
  await wait("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"成果菜单\"]'))");
  await click(button("对比图片"));
  await inspectComparisonModal("dark", "1280x800-dark-comparison");
  report.productBreaks = productBreaks;
  assert.equal(report.realModelRequests, 0);
  assert.deepEqual(productBreaks, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  if (client) await capturePngScreenshotToFile(client, join(runDir, "failure.png"), { captureBeyondViewport: false }).catch(() => {});
  throw error;
} finally {
  if (client) {
    await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {});
    client.close();
  }
  if (electron && !(await waitForChildExit(electron, 7000))) electron.kill();
  vite.kill();
  saveReport();
  console.log(join(runDir, "report.json"));
}
