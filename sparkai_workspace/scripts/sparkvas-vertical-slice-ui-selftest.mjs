import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { createRecipeStore } = require("../desktop/recipe-store.cjs");
const { createRecipeRunService } = require("../desktop/recipe-run-service.cjs");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `sparkvas-vertical-slice-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(runDir, "project");
const sourcePath = join(projectDir, "output", "imagegen", "product.png");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");

let viteProcess;
let electronProcess;
let mainClient;
const screenshots = [];
const checks = [];

function check(name, value = true) {
  assert.equal(value, true, name);
  checks.push(name);
}

function setNativeValueExpression(selector, value) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`;
}

function buttonClickExpression(label, scope = "") {
  const selector = scope ? `${scope} button` : "button";
  return `(() => {
    const button = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`;
}

async function capture(name) {
  const target = join(runDir, name);
  await capturePngScreenshotToFile(mainClient, target, { captureBeyondViewport: false }, 15_000);
  screenshots.push(target);
  return target;
}

async function waitForRuntimeExpressionSafe(expression, { timeoutMs = 20_000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await evaluate(mainClient, expression)) return true;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw lastError || new Error(`Timed out waiting for expression: ${expression}`);
}

function fixtureSession(imageHash, width, height, now) {
  return {
    schemaVersion: 5,
    workspaceDomain: "general",
    sessionRevision: 1,
    nodeSequence: 1,
    canvasRevision: 1,
    messages: [],
    conversations: [{
      id: "conv-recipe-selftest",
      title: "Recipe UI Fixture",
      messages: [],
      createdAt: now,
      updatedAt: now,
    }],
    activeConversationId: "conv-recipe-selftest",
    nodes: [{
      id: "N1",
      displayCode: "N1",
      title: "受管美妆商品图",
      prompt: "Managed beauty product image for the Recipe UI fixture.",
      type: "image",
      status: "done",
      x: 160,
      y: 150,
      branch: "basic",
      outputs: 1,
      createdAt: now,
      width: 520,
      height: 520,
      zOrder: 1,
      assets: [{
        assetId: "asset-product-fixture",
        occurrenceId: `occ-${"f".repeat(24)}`,
        contentHash: imageHash,
        index: 1,
        type: "file",
        width,
        height,
        relativePath: "output/imagegen/product.png",
        assetUrl: "naimage-asset://local/output/imagegen/product.png",
        originalName: "product.png",
        mimeType: "image/png",
        outputFormat: "png",
        status: "done",
        displayCode: "N1",
        title: "受管美妆商品图",
      }],
      imageState: "done",
      imageParams: {
        prompt: "Managed beauty product image for the Recipe UI fixture.",
        ratio: "1:1",
        resolution: "1K",
        size: "1024x1024",
        count: 1,
        quality: "high",
        batchMode: "parallel",
        model: "gpt-image-2",
        referenceImages: [],
      },
    }],
    selectedNodeId: "N1",
    nodeMutationJournal: [],
    nodeMutationWriterCheckpoints: [],
    nodeMutationBarriers: [],
    pendingAgentExecution: null,
    projectTaskContexts: [],
  };
}

async function prepareFixture() {
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dirname(sourcePath), { recursive: true });
  copyFileSync(join(repoRoot, "public", "ui", "style-library", "cards", "commerce-density-crossborder.png"), sourcePath);
  const imageBytes = readFileSync(sourcePath);
  const imageHash = createHash("sha256").update(imageBytes).digest("hex");
  const metadata = await sharp(imageBytes).metadata();
  assert.equal(metadata.format, "png");
  const now = new Date().toISOString();
  writeFileSync(join(configDir, "project-list.json"), `${JSON.stringify({
    activeProjectId: "project-recipe-selftest",
    projects: [{
      id: "project-recipe-selftest",
      name: "Sparkvas Recipe UI",
      path: projectDir,
      sessionPath: join(projectDir, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: true,
    }],
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(projectDir, "session.json"), `${JSON.stringify(
    fixtureSession(imageHash, metadata.width, metadata.height, now),
    null,
    2,
  )}\n`, "utf8");
}

function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function projectRecipeFixture() {
  return {
    id: "project-recipe-selftest",
    name: "Sparkvas Recipe UI",
    path: projectDir,
  };
}

function recoveryOutputAsset(slotId, index) {
  const fileName = `recovered-${index + 1}-${slotId}.png`;
  const filePath = join(projectDir, "output", "imagegen", fileName);
  copyFileSync(sourcePath, filePath);
  const contentHash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return {
    assetId: `recovery-${slotId}`,
    occurrenceId: `occ-recovery-${slotId}`,
    contentHash,
    relativePath: `output/imagegen/${fileName}`,
    assetUrl: `naimage-asset://local/abs/${encodeURIComponent(filePath)}`,
    originalName: fileName,
    mimeType: "image/png",
    width: 512,
    height: 512,
  };
}

async function seedRecoveredRecipeRun() {
  const inputBytes = readFileSync(sourcePath);
  const inputHash = createHash("sha256").update(inputBytes).digest("hex");
  const project = projectRecipeFixture();
  const recipeStore = createRecipeStore({
    projectFor: projectId => projectId === project.id ? project : null,
    metaDir: ".naimage",
  });
  const service = createRecipeRunService({
    projectFor: projectId => projectId === project.id ? project : null,
    recipeStore,
    resolveInputAsset: projectId => {
      assert.equal(projectId, project.id);
      return {
        assetId: "asset-product-fixture",
        occurrenceId: `occ-${"f".repeat(24)}`,
        contentHash: inputHash,
        path: sourcePath,
        relativePath: "output/imagegen/product.png",
        displayCode: "N1",
        originalName: "product.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        canvasNodeId: "N1",
        canvasAssetIndex: 0,
      };
    },
    executeImage: async payload => ({
      asset: recoveryOutputAsset(payload.slotId, payload.requestIndex - 1),
    }),
    metaDir: ".naimage",
    writeJson: atomicWriteJson,
  });
  const prepared = service.prepare({
    projectId: project.id,
    conversationId: "conv-recipe-selftest",
    recipeId: "recipe.sparkvas.beauty-product-hero",
    input: {
      assetId: "asset-product-fixture",
      occurrenceId: `occ-${"f".repeat(24)}`,
      contentHash: inputHash,
    },
    options: {
      sceneBrief: "Recovered durable Recipe fixture.",
      language: "zh-CN",
      slotDirections: {},
      ratio: "1:1",
      resolution: "1K",
      quality: "high",
    },
  });
  service.start({
    projectId: project.id,
    runId: prepared.runId,
    confirmed: true,
  });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const current = service.get({ projectId: project.id, runId: prepared.runId });
    if (["succeeded", "failed", "cancelled"].includes(current.run.status)) {
      assert.equal(current.run.status, "succeeded");
      assert.equal(current.assets.length, 6);
      return prepared.runId;
    }
    await delay(20);
  }
  throw new Error("Seeded Recipe Run did not settle.");
}

async function launchApp(extraEnv = {}) {
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");
  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;
  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
  });
  await waitForHttpServer(devUrl, { attempts: 160, intervalMs: 100, errorMessage: "Recipe UI Vite server did not start." });
  electronProcess = spawn(process.execPath, [
    electronCli,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(runDir, "user-data")}`,
    "electron-main.cjs",
  ], {
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
      NAIMAGE_AIDEBUG_RECIPE_DELAY_MS: "25",
      NAIMAGE_CONFIG_DIR: configDir,
      ...extraEnv,
    },
  });
  const target = await pollForDebugTarget({
    port: debugPort,
    attempts: 180,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Recipe UI renderer was not found.",
  });
  mainClient = new BasicCdpClient(target.webSocketDebuggerUrl);
  await mainClient.open();
  await mainClient.send("Runtime.enable");
  await mainClient.send("Page.enable");
  await waitForWorkspace();
}

async function shutdownApp() {
  mainClient?.close();
  mainClient = null;
  await forceKillProcessTree(electronProcess?.pid);
  electronProcess = null;
  await forceKillProcessTree(viteProcess?.pid);
  viteProcess = null;
}

async function waitForWorkspace() {
  await waitForRuntimeExpressionSafe(
    "Boolean(document.querySelector('.ide-main') && window.naimageRecipe && document.querySelector('.flow-node[data-node-id=\"N1\"]'))",
    { timeoutMs: 25_000, intervalMs: 100 },
  );
}

async function setWindowSize(width, height) {
  let result = await evaluate(mainClient, `window.naimageConfig.debugWindowBounds({ width: ${width}, height: ${height} })`);
  check(`window request ${width}x${height}`, result?.ok === true);
  const firstViewport = await evaluate(mainClient, "({ width: innerWidth, height: innerHeight })");
  if (Math.abs(firstViewport.width - width) || Math.abs(firstViewport.height - height)) {
    result = await evaluate(mainClient, `window.naimageConfig.debugWindowBounds({ width: ${width + width - firstViewport.width}, height: ${height + height - firstViewport.height} })`);
    check(`window correction ${width}x${height}`, result?.ok === true);
  }
  await waitForRuntimeExpression(
    mainClient,
    `Math.abs(innerWidth - ${width}) <= 2 && Math.abs(innerHeight - ${height}) <= 2`,
    { evaluate, timeoutMs: 8_000, intervalMs: 100 },
  );
}

async function setTheme(theme) {
  const saved = await evaluate(mainClient, `(async () => {
    const settings = await window.naimageConfig.loadSettings();
    return window.naimageConfig.saveSettings({
      ...settings,
      theme: ${JSON.stringify(theme)},
      glassTheme: ${JSON.stringify(theme === "dark" ? "dark-rose" : "light-classic")}
    });
  })()`);
  check(`save ${theme} theme`, saved?.ok === true);
  await mainClient.send("Page.reload", { ignoreCache: true });
  await waitForWorkspace();
  await waitForRuntimeExpressionSafe(
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
    { timeoutMs: 15_000, intervalMs: 100 },
  );
}

async function selectSourceNode() {
  await waitForRuntimeExpression(
    mainClient,
    "Boolean(document.querySelector('.flow-node[data-node-id=\"N1\"]'))",
    { evaluate, timeoutMs: 10_000, intervalMs: 100 },
  );
  const selected = await evaluate(mainClient, `(() => {
    const node = document.querySelector('.flow-node[data-node-id="N1"]');
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    node.dispatchEvent(new PointerEvent('pointerdown', init));
    node.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: init.clientX, clientY: init.clientY }));
    return true;
  })()`);
  await waitForRuntimeExpression(
    mainClient,
    "document.querySelector('.flow-node.selected[data-node-id=\"N1\"]') !== null",
    { evaluate, timeoutMs: 8_000, intervalMs: 80 },
  );
  check("source node receives pointer selection", selected);
}

async function openRecipeStudio() {
  try {
    await waitForRuntimeExpression(
      mainClient,
      "Array.from(document.querySelectorAll('button')).some((item) => item.getAttribute('aria-label') === '用 Skill/Recipe 处理')",
      { evaluate, timeoutMs: 10_000, intervalMs: 100 },
    );
  } catch (error) {
    const debug = await evaluate(mainClient, `(() => ({
      selected: document.querySelector('.flow-node.selected')?.getAttribute('data-node-id') || '',
      labels: Array.from(document.querySelectorAll('.canvas-interaction-toolbar button')).map((item) => item.getAttribute('aria-label')),
      state: window.__naimageAIDebug?.state?.() || null
    }))()`);
    throw new Error(`${error.message} ${JSON.stringify(debug)}`);
  }
  const opened = await evaluate(mainClient, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === '用 Skill/Recipe 处理');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  check("single selected managed image exposes the Skill/Recipe entry", opened);
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.recipe-studio-dialog'))", { evaluate, timeoutMs: 10_000, intervalMs: 100 });
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('[aria-label=\"Recipe 场景文案\"]'))", { evaluate, timeoutMs: 10_000, intervalMs: 100 });
}

async function prepareStudioRun() {
  check("Studio prepares the run plan", await evaluate(mainClient, buttonClickExpression("继续")));
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('[aria-label=\"确认发起六次图片请求\"]'))", { evaluate, timeoutMs: 12_000, intervalMs: 100 });
}

async function confirmAndStartRun() {
  check("explicit paid confirmation can be checked", await evaluate(mainClient, `(() => {
    const checkbox = document.querySelector('[aria-label="确认发起六次图片请求"]');
    if (!(checkbox instanceof HTMLInputElement)) return false;
    checkbox.click();
    return checkbox.checked;
  })()`));
  check("run starts only after confirmation", await evaluate(mainClient, buttonClickExpression("开始生成")));
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.recipe-run-dock'))", { evaluate, timeoutMs: 8_000, intervalMs: 100 });
  check("starting a Run closes the Studio modal immediately", await evaluate(mainClient, "!document.querySelector('.recipe-studio-dialog') && !document.querySelector('.recipe-studio-layer')"));
  check("Canvas and Agent stay interactive without dock overlap", await evaluate(mainClient, `(() => {
    const dock = document.querySelector('.recipe-run-dock')?.getBoundingClientRect();
    const panel = document.querySelector('.project-agent-panel')?.getBoundingClientRect();
    const composer = document.querySelector('.project-agent-composer textarea');
    if (!dock || !panel || !(composer instanceof HTMLTextAreaElement)) return false;
    return dock.right <= panel.left + 1;
  })()`));
}

async function runFailureScenario() {
  await shutdownApp();
  await prepareFixture();
  await launchApp({
    NAIMAGE_AIDEBUG_RECIPE_FAIL_SLOT: "hero",
  });
  await setWindowSize(1280, 800);
  await setTheme("light");
  await selectSourceNode();
  await openRecipeStudio();
  await prepareStudioRun();
  await confirmAndStartRun();
  await waitForRuntimeExpression(
    mainClient,
    "Boolean(document.querySelector('.recipe-run-dock.is-failed'))",
    { evaluate, timeoutMs: 20_000, intervalMs: 120 },
  );
  check("background failure runs in a dock, not a modal", await evaluate(mainClient, "!document.querySelector('.recipe-studio-dialog')"));
  const failure = await evaluate(mainClient, `(() => ({
    state: document.querySelector('.recipe-run-dock .recipe-run-state')?.textContent?.trim() || '',
    canvasResult: Boolean(document.querySelector('.node-recipe-provenance[data-recipe-run-id]')),
    message: document.querySelector('.recipe-run-dock-error')?.textContent?.trim() || ''
  }))()`);
  check("failure Run reports failure", failure.state.includes("失败"));
  check("failure keeps its error visible in the dock", failure.message.length > 0);
  check("failure does not write a Canvas result", failure.canvasResult === false);
  check("failure shows a human-readable message", failure.message.length > 0);
  await capture("09-failure-light-1280x800.png");
}

async function runCancellationScenario() {
  await shutdownApp();
  await prepareFixture();
  await launchApp({
    NAIMAGE_AIDEBUG_RECIPE_DELAY_MS: "5000",
  });
  await setWindowSize(1280, 800);
  await setTheme("light");
  await selectSourceNode();
  await openRecipeStudio();
  await prepareStudioRun();
  await confirmAndStartRun();
  check("background Run exposes cancellation", await evaluate(mainClient, buttonClickExpression("取消", ".recipe-run-dock")));
  await waitForRuntimeExpression(
    mainClient,
    "Boolean(document.querySelector('.recipe-run-dock.is-cancelled'))",
    { evaluate, timeoutMs: 20_000, intervalMs: 120 },
  );
  const cancelled = await evaluate(mainClient, `(() => ({
    state: document.querySelector('.recipe-run-dock .recipe-run-state')?.textContent?.trim() || '',
    dock: Boolean(document.querySelector('.recipe-run-dock')),
    canvasResult: Boolean(document.querySelector('.node-recipe-provenance[data-recipe-run-id]'))
  }))()`);
  check("cancelled Run reports cancellation", cancelled.state.includes("已取消"));
  check("cancellation stops before a Canvas result", cancelled.canvasResult === false);
  check("cancellation stays in the background dock", cancelled.dock === true);
  await capture("10-cancelled-light-1280x800.png");
}

async function runRestartRecoveryScenario() {
  await shutdownApp();
  await prepareFixture();
  const recoveredRunId = await seedRecoveredRecipeRun();
  await launchApp();
  await setWindowSize(1280, 800);
  await setTheme("light");
  await waitForRuntimeExpression(
    mainClient,
    `Boolean(document.querySelector('.node-recipe-provenance[data-recipe-run-id="${recoveredRunId}"]'))`,
    { evaluate, timeoutMs: 30_000, intervalMs: 150 },
  );
  await waitForRuntimeExpression(
    mainClient,
    `Array.from(document.querySelectorAll('.node-recipe-provenance[data-recipe-run-id="${recoveredRunId}"]'))[0]?.closest('.flow-node')?.querySelectorAll('.node-image-tile img').length === 6`,
    { evaluate, timeoutMs: 10_000, intervalMs: 150 },
  );
  await delay(350);
  const recovered = await evaluate(mainClient, `(() => {
    const chip = document.querySelector('.node-recipe-provenance[data-recipe-run-id="${recoveredRunId}"]');
    const node = chip?.closest('.flow-node');
    return {
      nodes: document.querySelectorAll('[data-recipe-run-id="${recoveredRunId}"]').length,
      tiles: node?.querySelectorAll('.node-image-tile').length || 0,
      loadedImages: Array.from(node?.querySelectorAll('.node-image-tile img') || []).filter((image) => image.complete && image.naturalWidth > 0).length
    };
  })()`);
  check("restart restores exactly one Canvas result", recovered.nodes === 1);
  check("restart restores six image tiles", recovered.tiles === 6);
  check("restart restores loadable image assets", recovered.loadedImages === 6);
  await capture("11-restart-recovery-light-1280x800.png");
  await mainClient.send("Page.reload", { ignoreCache: true });
  await waitForWorkspace();
  await waitForRuntimeExpression(
    mainClient,
    `document.querySelectorAll('[data-recipe-run-id="${recoveredRunId}"]').length === 1`,
    { evaluate, timeoutMs: 20_000, intervalMs: 150 },
  );
  const reloaded = await evaluate(mainClient, `Array.from(document.querySelectorAll('[data-recipe-run-id="${recoveredRunId}"]')).length`);
  check("reloading does not duplicate the recovered Canvas result", reloaded === 1);
  await capture("12-restart-reload-idempotent-light-1280x800.png");
}

async function main() {
  await prepareFixture();
  await launchApp({
    NAIMAGE_AIDEBUG_RECIPE_DELAY_MS: "450",
  });
  await setWindowSize(1280, 800);
  await setTheme("light");
  await waitForRuntimeExpression(mainClient, "document.querySelector('.flow-node.selected[data-node-id=\"N1\"]') !== null", { evaluate, timeoutMs: 8_000, intervalMs: 100 });
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate, timeoutMs: 15_000, intervalMs: 100 });
  const workspaceClutter = await evaluate(mainClient, `(() => ({
    emptySlogan: Boolean(document.querySelector('.project-agent-empty')),
    contextHint: Boolean(document.querySelector('.workspace-context-hint')),
    cloudTelemetry: Boolean(document.querySelector('.project-agent-provider-status')),
    idleComposerHint: (document.querySelector('.project-agent-composer footer span')?.textContent || '').trim(),
    duplicateContext: document.querySelectorAll('[data-project-context]').length,
    headerSubtitle: Boolean(document.querySelector('.project-agent-header p')),
    workspaceSubtitle: Boolean(document.querySelector('.workspace-task-context small, .workspace-task-context > span'))
  }))()`);
  check("workspace removes empty Agent slogan", workspaceClutter.emptySlogan === false);
  check("workspace removes canvas context hint", workspaceClutter.contextHint === false);
  check("workspace hides default cloud telemetry lines", workspaceClutter.cloudTelemetry === false);
  check("workspace removes idle composer shortcut hint", workspaceClutter.idleComposerHint === "");
  check("workspace never duplicates ProjectContextPanel", workspaceClutter.duplicateContext <= 1);
  check("workspace removes Agent header and workspace explanatory subtitles", workspaceClutter.headerSubtitle === false && workspaceClutter.workspaceSubtitle === false);
  check("empty creation acceptance shows only its actionable entry", await evaluate(mainClient, "document.querySelector('.creation-session > summary')?.textContent.trim() === '创作要求'"));
  check("canvas zoom controls appear in one place", await evaluate(mainClient, "document.querySelectorAll('.canvas-footer .canvas-tools').length === 0 && document.querySelectorAll('.canvas-navigation-zoom').length === 1"));
  await capture("01-canvas-clean-light-1280x800.png");

  check("project search popover opens", await evaluate(mainClient, `(() => {
    const trigger = document.querySelector('.workspace-search-trigger');
    if (!(trigger instanceof HTMLButtonElement)) return false;
    trigger.click();
    return true;
  })()`));
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.workspace-search-popover'))", { evaluate, timeoutMs: 8_000, intervalMs: 100 });
  const searchPopoverState = await evaluate(mainClient, `(() => ({
    popoverOpen: Boolean(document.querySelector('.workspace-search-popover')),
    popoverContext: Boolean(document.querySelector('.workspace-search-popover [data-project-context]')),
    sidebarContextCount: document.querySelectorAll('.project-agent-panel [data-project-context]').length,
    totalContextCount: document.querySelectorAll('[data-project-context]').length
  }))()`);
  check("opened project search popover removes duplicate ProjectContextPanel while right sidebar keeps ownership", searchPopoverState.popoverOpen && searchPopoverState.popoverContext === false && searchPopoverState.sidebarContextCount === 1 && searchPopoverState.totalContextCount === 1);
  await capture("01b-search-no-duplicate-knowledge-light-1280x800.png");
  check("project search popover closes", await evaluate(mainClient, `(() => {
    const closeButton = document.querySelector('.workspace-search-popover button[aria-label="关闭搜索"]');
    if (!(closeButton instanceof HTMLButtonElement)) return false;
    closeButton.click();
    return true;
  })()`));
  await waitForRuntimeExpression(mainClient, "!document.querySelector('.workspace-search-popover')", { evaluate, timeoutMs: 5_000, intervalMs: 80 });

  await openRecipeStudio();
  check("source selection remains while Studio is open", await evaluate(mainClient, "document.querySelector('.flow-node.selected[data-node-id=\"N1\"]') !== null"));
  check("Studio opens the built-in Beauty product-hero Recipe directly", await evaluate(mainClient, "document.querySelector('[data-recipe-id=\"recipe.sparkvas.beauty-product-hero\"]') !== null"));
  check("Studio keeps the single Recipe surface free of graph chrome", await evaluate(mainClient, "!document.querySelector('.recipe-selector-list, .recipe-graph-preview')"));
  check("Studio removes header explanatory subtitle", await evaluate(mainClient, "!document.querySelector('.recipe-studio-dialog .ui-surface-description')"));
  await waitForRuntimeExpression(
    mainClient,
    "(() => { const img = document.querySelector('.recipe-source-card img'); return Boolean(img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0); })()",
    { evaluate, timeoutMs: 8_000, intervalMs: 100 },
  );
  const studioDetails = await evaluate(mainClient, `(() => {
    const img = document.querySelector('.recipe-source-card img');
    const title = document.querySelector('.recipe-source-card strong')?.textContent?.trim() || '';
    const inputs = Array.from(document.querySelectorAll('.recipe-output-editor input'));
    return {
      thumbnailLoaded: Boolean(img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
      sourceTitle: title,
      outputCount: inputs.length,
      editableOutputs: inputs.filter((item) => item instanceof HTMLInputElement && !item.disabled && !item.readOnly).length
    };
  })()`);
  check("Studio displays a loaded input thumbnail", studioDetails.thumbnailLoaded && studioDetails.sourceTitle === "受管美妆商品图");
  const heroDirection = "干净高级的棚拍主视觉，突出瓶身质感与品牌识别";
  const heroEdited = await evaluate(mainClient, setNativeValueExpression('[aria-label="主视觉画面方向"]', heroDirection));
  const heroUpdated = await evaluate(mainClient, `document.querySelector('[aria-label="主视觉画面方向"]')?.value === ${JSON.stringify(heroDirection)}`);
  check("Studio keeps all six output direction fields editable", studioDetails.outputCount === 6 && studioDetails.editableOutputs === 6 && heroEdited && heroUpdated);
  check("scene brief is editable", await evaluate(mainClient, setNativeValueExpression('[aria-label="Recipe 场景文案"]', "柔和自然光美妆棚拍，保留商品包装和品牌识别，适合跨境商品详情页。")));
  check("market language is editable", await evaluate(mainClient, setNativeValueExpression('[aria-label="Recipe 市场语言"]', "en-US")));
  await capture("02-studio-light-1280x800.png");
  await prepareStudioRun();
  const confirmSummary = await evaluate(mainClient, `(() => ({
    outputs: document.querySelectorAll('.recipe-expected-list li').length,
    permissions: document.querySelectorAll('.recipe-permission-row').length,
    paidText: document.querySelector('.recipe-confirm-checkbox')?.textContent || '',
    sourceSelected: Boolean(document.querySelector('.flow-node.selected[data-node-id="N1"]'))
  }))()`);
  check("confirmation lists six outputs", confirmSummary.outputs === 6);
  check("confirmation lists only active Tool permissions", confirmSummary.permissions === 3);
  check("confirmation names the six paid requests", confirmSummary.paidText.includes("6 次图片生成请求"));
  check("source selection remains while confirmation is open", confirmSummary.sourceSelected);
  await capture("03-confirm-light-1280x800.png");

  await confirmAndStartRun();
  check("user can type into Agent composer while Recipe Run executes in background", await evaluate(mainClient, setNativeValueExpression('.project-agent-composer textarea', "顺便构思下一轮文案方向")));
  await capture("04-running-dock-light-1280x800.png");
  await waitForRuntimeExpression(
    mainClient,
    "Boolean(document.querySelector('.recipe-run-dock.is-succeeded'))",
    { evaluate, timeoutMs: 120_000, intervalMs: 200 },
  );
  check("background Run dock reports success", await evaluate(mainClient, "document.querySelector('.recipe-run-dock .recipe-run-state')?.textContent?.includes('已完成') === true"));
  check("Recipe Run does not steal selection while backgrounded", await evaluate(mainClient, "document.querySelector('.flow-node.selected[data-node-id=\"N1\"]') !== null"));
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.node-recipe-provenance[data-recipe-run-id]'))", { evaluate, timeoutMs: 12_000, intervalMs: 100 });
  check("background completion lands result on Canvas before reveal", await evaluate(mainClient, "document.querySelectorAll('.node-recipe-provenance[data-recipe-run-id]').length === 1"));
  await waitForRuntimeExpression(
    mainClient,
    "Array.from(document.querySelectorAll('.recipe-run-dock button')).some((item) => item.textContent?.trim() === '查看结果')",
    { evaluate, timeoutMs: 15_000, intervalMs: 120 },
  );
  check("background success exposes a reveal action", await evaluate(mainClient, buttonClickExpression("查看结果", ".recipe-run-dock")));
  await waitForRuntimeExpression(mainClient, "!document.querySelector('.recipe-run-dock')", { evaluate, timeoutMs: 8_000, intervalMs: 100 });
  check("reveal closes the background dock", await evaluate(mainClient, "!document.querySelector('.recipe-run-dock')"));
  await waitForRuntimeExpression(
    mainClient,
    "Array.from(document.querySelectorAll('.node-recipe-provenance[data-recipe-run-id]')).some((chip) => chip.closest('.flow-node')?.classList.contains('selected'))",
    { evaluate, timeoutMs: 8_000, intervalMs: 100 },
  );
  await waitForRuntimeExpression(
    mainClient,
    "Array.from(document.querySelectorAll('.flow-node.selected .node-image-tile img')).filter((image) => image.complete && image.naturalWidth > 0).length === 6",
    { evaluate, timeoutMs: 10_000, intervalMs: 120 },
  );
  await evaluate(mainClient, `Promise.all(Array.from(document.querySelectorAll('.flow-node.selected .node-image-tile img')).map((img) => img.decode ? img.decode().catch(() => {}) : Promise.resolve()))`);
  await delay(120);
  const canvasState = await evaluate(mainClient, `(() => {
    const node = document.querySelector('.flow-node.selected');
    const chip = document.querySelector('.node-recipe-provenance[data-recipe-run-id]');
    const footerCount = chip?.closest('footer')?.querySelector(':scope > span:last-child');
    const chipRect = chip?.getBoundingClientRect();
    const countRect = footerCount?.getBoundingClientRect();
    return {
      runId: chip?.getAttribute('data-recipe-run-id') || '',
      selectedRunId: node?.querySelector('[data-recipe-run-id]')?.getAttribute('data-recipe-run-id') || '',
      tileCount: node?.querySelectorAll('.node-image-tile').length || 0,
      loadedImages: Array.from(node?.querySelectorAll('.node-image-tile img') || []).filter((image) => image.complete && image.naturalWidth > 0).length,
      provenanceInFooterNoOverlap: Boolean(chipRect && countRect && chipRect.right <= countRect.left + 1),
      relationClass: node?.className || ''
    };
  })()`);
  check("one result node returns to the Canvas", Boolean(canvasState.runId));
  check("result node is selected", canvasState.selectedRunId === canvasState.runId);
  check("result node renders six image tiles", canvasState.tileCount === 6);
  check("result node renders six loadable images", canvasState.loadedImages === 6);
  check("provenance pill sits cleanly inside node footer without overlap", canvasState.provenanceInFooterNoOverlap);
  await capture("05-canvas-result-light-1280x800.png");

  check("Recipe Run provenance chip opens", await evaluate(mainClient, `(() => {
    const chip = document.querySelector('.node-recipe-provenance[data-recipe-run-id]');
    if (!(chip instanceof HTMLButtonElement)) return false;
    chip.click();
    return true;
  })()`));
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.recipe-provenance-dialog'))", { evaluate, timeoutMs: 10_000, intervalMs: 100 });
  await waitForRuntimeExpression(mainClient, "Boolean(document.querySelector('.recipe-provenance-dialog .recipe-kv-strip'))", { evaluate, timeoutMs: 10_000, intervalMs: 100 });
  const provenance = await evaluate(mainClient, `(() => ({
    text: document.querySelector('.recipe-provenance-dialog')?.textContent || '',
    assets: document.querySelectorAll('.recipe-provenance-asset').length,
    hasRecipe: document.querySelector('.recipe-provenance-dialog')?.textContent?.includes('recipe.sparkvas.beauty-product-hero') === true,
    hasRun: document.querySelector('.recipe-provenance-dialog')?.textContent?.includes(${JSON.stringify(canvasState.runId)}) === true
  }))()`);
  check("provenance shows Recipe identity", provenance.hasRecipe);
  check("provenance shows Run identity", provenance.hasRun);
  check("provenance lists input and six outputs", provenance.assets === 7);
  await capture("06-provenance-light-1280x800.png");
  check("provenance closes", await evaluate(mainClient, `(() => {
    const button = document.querySelector('.recipe-provenance-dialog .ui-surface-close');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`));
  await waitForRuntimeExpression(mainClient, "!document.querySelector('.recipe-provenance-dialog')", { evaluate, timeoutMs: 5_000, intervalMs: 80 });

  await setTheme("dark");
  await setWindowSize(884, 640);
  await selectSourceNode();
  await openRecipeStudio();
  await capture("08-studio-dark-884x640.png");
  const responsive = await evaluate(mainClient, `(() => {
    const dialog = document.querySelector('.recipe-studio-dialog');
    const body = document.querySelector('.recipe-studio-body');
    const workspace = document.querySelector('.recipe-studio-workspace');
    const form = document.querySelector('.recipe-studio-form');
    const rect = dialog?.getBoundingClientRect();
    const formRect = form?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      dialog: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      singleColumn: !document.querySelector('.recipe-studio-sidebar, .recipe-selector-list, .recipe-graph-preview'),
      form: formRect ? { left: formRect.left, top: formRect.top, right: formRect.right, bottom: formRect.bottom } : null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyScrollable: body ? body.scrollHeight >= body.clientHeight : false
    };
  })()`);
  check("884x640 uses the requested content size", Math.abs(responsive.viewport.width - 884) <= 2 && Math.abs(responsive.viewport.height - 640) <= 2);
  check("884x640 dialog stays inside the viewport", responsive.dialog && responsive.dialog.left >= 0 && responsive.dialog.top >= 0 && responsive.dialog.right <= 884 && responsive.dialog.bottom <= 640);
  check("884x640 page has no horizontal overflow", responsive.overflowX <= 1);
  check("Studio body remains scrollable instead of clipping", responsive.bodyScrollable);
  check("Studio uses one full-width form column", responsive.singleColumn && responsive.form && responsive.form.left >= 0 && responsive.form.right <= 884);

  await runFailureScenario();
  await runCancellationScenario();
  await runRestartRecoveryScenario();

  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify({
    ok: true,
    checks: checks.length,
    screenshots,
    runId: canvasState.runId,
    runDir,
    realModelRequests: 0,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: checks.length,
    screenshots,
    runId: canvasState.runId,
    runDir,
    reportPath,
  }, null, 2)}\n`);
}

try {
  await main();
} finally {
  await shutdownApp();
}
