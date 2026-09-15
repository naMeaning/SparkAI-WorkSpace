import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `agent-window-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
let viteProcess;
let electronProcess;
let mainClient;
let agentClient;

async function main() {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  const projectDir = join(runDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const projectTimestamp = new Date().toISOString();
  const projectName = "Agent Window UI Fixture";
  writeFileSync(join(configDir, "project-list.json"), `${JSON.stringify({
    activeProjectId: "agent-window-ui-project",
    projects: [{
      id: "agent-window-ui-project",
      name: projectName,
      path: projectDir,
      sessionPath: join(projectDir, "session.json"),
      createdAt: projectTimestamp,
      updatedAt: projectTimestamp,
      external: true
    }]
  }, null, 2)}\n`, "utf8");
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");
  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false
  });
  await waitForHttpServer(devUrl, { attempts: 120, intervalMs: 100, errorMessage: "Agent window Vite server did not start." });

  electronProcess = spawn(process.execPath, [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
    env: {
      ...process.env,
      NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: "1",
      NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
      NAIMAGE_AIDEBUG_REAL_AGENT: "0",
      NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
      NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
      NAIMAGE_CONFIG_DIR: configDir
    }
  });

  const mainTarget = await pollForDebugTarget({
    port: debugPort,
    attempts: 160,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Main renderer was not found."
  });
  mainClient = new BasicCdpClient(mainTarget.webSocketDebuggerUrl);
  await mainClient.open();
  await mainClient.send("Runtime.enable");
  await mainClient.send("Page.enable");
  await waitForRuntimeExpression(
    mainClient,
    "Boolean(document.querySelector('.project-agent-panel:not([aria-busy=\"true\"]) button[aria-label=\"调整对话框位置\"]') && window.__naimageAIDebug && window.naimageAgentWindow)",
    { evaluate, timeoutMs: 15_000, intervalMs: 100 }
  );

  const placementProbe = await evaluate(mainClient, `(() => {
    const toggle = document.querySelector('button[aria-label="调整对话框位置"]');
    const panel = document.querySelector('.project-agent-panel');
    const shell = document.querySelector('.ide-main');
    const labels = Array.from(panel?.querySelectorAll('button[aria-label]') || []).map((item) => item.getAttribute('aria-label'));
    if (!(toggle instanceof HTMLButtonElement)) return {
      opened: false,
      panelLabel: panel?.getAttribute('aria-label') || '',
      panelClass: panel?.className || '',
      shellClass: shell?.className || '',
      buttonLabels: labels
    };
    toggle.click();
    return { opened: true, panelLabel: panel?.getAttribute('aria-label') || '', panelClass: panel?.className || '', shellClass: shell?.className || '', buttonLabels: labels };
  })()`);
  assert.equal(placementProbe?.opened, true, `Agent placement menu toggle must be available: ${JSON.stringify(placementProbe)}`);
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.agent-placement-menu'))", { evaluate, timeoutMs: 3_000, intervalMs: 60 });
  const openedFromMenu = await evaluate(mainClient, `(() => {
    const button = Array.from(document.querySelectorAll('.agent-placement-menu button')).find((item) => item.textContent?.includes('独立浮动窗口'));
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert.equal(openedFromMenu, true, "Independent Agent window must be reachable from the placement menu");
  await waitForRuntimeExpression(mainClient, "document.querySelector('.ide-main')?.classList.contains('agent-collapsed') === true", { evaluate, timeoutMs: 5_000, intervalMs: 80 });

  const agentTarget = await pollForDebugTarget({
    port: debugPort,
    attempts: 100,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && /agent-window\.html(?:$|[?#])/.test(String(item.url))),
    notFoundMessage: "Independent Agent window renderer was not found."
  });
  agentClient = new BasicCdpClient(agentTarget.webSocketDebuggerUrl);
  await agentClient.open();
  await agentClient.send("Runtime.enable");
  await agentClient.send("Page.enable");
  await agentClient.send("Page.bringToFront");
  await waitForRuntimeExpression(agentClient, "document.visibilityState === 'visible'", { evaluate, timeoutMs: 5_000, intervalMs: 80 });
  await waitForRuntimeExpression(
    agentClient,
    `document.querySelector('#agent-prompt')?.disabled === false && document.querySelector('#project-name')?.textContent?.startsWith(${JSON.stringify(projectName)}) && document.querySelector('#model-name')?.textContent?.length > 0`,
    { evaluate, timeoutMs: 8_000, intervalMs: 80 }
  );

  const initial = await evaluate(agentClient, `(() => ({
    title: document.title,
    project: document.querySelector('#project-name')?.textContent,
    status: document.querySelector('#status-text')?.textContent,
    model: document.querySelector('#model-name')?.textContent,
    width: innerWidth,
    height: innerHeight,
    nodeIntegrationHidden: typeof require === 'undefined' && typeof process === 'undefined'
  }))()`);
  assert.equal(initial.title, "SparkAI WorkSpace Agent");
  assert.equal(initial.nodeIntegrationHidden, true);
  assert(initial.width >= 360 && initial.height >= 480);
  assert(String(initial.project || "").startsWith(projectName), "Project identity must synchronize from the main renderer");

  const uniquePrompt = `独立浮窗测试 ${Date.now()}`;
  const submitted = await evaluate(agentClient, `(() => {
    const input = document.querySelector('#agent-prompt');
    const form = document.querySelector('#agent-composer');
    if (!(input instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, ${JSON.stringify(uniquePrompt)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  assert.equal(submitted, true);
  await waitForRuntimeExpression(mainClient, `window.__naimageDebugAgentState?.().messages?.some((item) => item.role === 'user' && item.content === ${JSON.stringify(uniquePrompt)}) === true`, { evaluate, timeoutMs: 8_000, intervalMs: 80 });
  await waitForRuntimeExpression(agentClient, `document.querySelector('#agent-feed')?.textContent?.includes(${JSON.stringify(uniquePrompt)}) === true`, { evaluate, timeoutMs: 8_000, intervalMs: 80 });
  await waitForRuntimeExpression(agentClient, "document.querySelector('#agent-feed')?.textContent?.includes('Agent') === true", { evaluate, timeoutMs: 8_000, intervalMs: 80 });
  await waitForRuntimeExpression(agentClient, "document.querySelector('#agent-prompt')?.value === ''", { evaluate, timeoutMs: 8_000, intervalMs: 80 });

  const screenshotPath = join(runDir, "independent-agent-window.png");
  await capturePngScreenshotToFile(agentClient, screenshotPath, { captureBeyondViewport: false }, 15_000);

  const docked = await evaluate(agentClient, `(() => {
    const select = document.querySelector('#dock-select');
    if (!(select instanceof HTMLSelectElement)) return false;
    select.value = 'top';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(docked, true);
  await waitForRuntimeExpression(mainClient, "document.querySelector('.ide-main')?.classList.contains('agent-placement-top') === true && document.querySelector('.ide-main')?.classList.contains('agent-collapsed') === false", { evaluate, timeoutMs: 5_000, intervalMs: 80 });
  await delay(150);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 15,
    initial,
    promptRoundTrip: true,
    dockedTop: true,
    screenshotPath
  })}\n`);
}

try {
  await main();
} finally {
  agentClient?.close();
  mainClient?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
