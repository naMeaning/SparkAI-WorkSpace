import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `commerce-export-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(configDir, "projects", "default");
const projectListPath = join(configDir, "project-list.json");
const fixtureProjectId = "commerce-export-ui-project";
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const exportCommand = "sparkai.commerce-toolkit.open-export-center";
let viteProcess;
let electronProcess;
let client;
let target;

function prepareProjectFixture() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(projectListPath, `${JSON.stringify({
    activeProjectId: fixtureProjectId,
    projects: [{
      id: fixtureProjectId,
      name: "Commerce Export UI",
      path: projectDir,
      sessionPath: join(projectDir, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: true
    }]
  }, null, 2)}\n`, "utf8");
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function seedCatalog() {
  const imageDir = join(projectDir, "output", "imagegen");
  const metadataDir = join(projectDir, ".naimage");
  const imagePath = join(imageDir, "commerce-export-fixture.png");
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(metadataDir, { recursive: true });
  copyFileSync(join(repoRoot, "public", "naimage.png"), imagePath);
  const contentHash = sha256File(imagePath);
  const timestamp = "2026-07-31T10:00:00.000Z";
  const productId = `product-${"1".repeat(32)}`;
  const variantA = `variant-${"2".repeat(32)}`;
  const variantB = `variant-${"3".repeat(32)}`;
  const skuA = `sku-${"4".repeat(32)}`;
  const skuB = `sku-${"5".repeat(32)}`;
  const asset = (suffix, ownerType, ownerId, role, state, slotIndex) => ({
    linkId: `result-${suffix.repeat(32)}`,
    kind: "result",
    ownerType,
    ownerId,
    role,
    state,
    assetId: `asset-commerce-export-${suffix}`,
    contentHash,
    relativePath: "output/imagegen/commerce-export-fixture.png",
    fileName: "commerce-export-fixture.png",
    commerceSlotIndex: slotIndex,
    createdAt: timestamp
  });
  writeFileSync(join(metadataDir, "commerce-catalog.json"), `${JSON.stringify({
    schemaVersion: 1,
    catalogId: `catalog-${"0".repeat(32)}`,
    revision: 8,
    createdAt: timestamp,
    updatedAt: timestamp,
    products: [{
      productId,
      title: "Travel Mug",
      productCode: "MUG-2026",
      brand: "North",
      platforms: ["amazon", "aliexpress"],
      status: "active",
      revision: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      variants: [
        { variantId: variantA, title: "Black", optionValues: [{ name: "Color", value: "Black" }], revision: 1, createdAt: timestamp, updatedAt: timestamp },
        { variantId: variantB, title: "White", optionValues: [{ name: "Color", value: "White" }], revision: 1, createdAt: timestamp, updatedAt: timestamp }
      ],
      skus: [
        { skuId: skuA, skuCode: "MUG-BLACK", title: "Black mug", variantId: variantA, platforms: ["amazon", "aliexpress"], revision: 1, createdAt: timestamp, updatedAt: timestamp },
        { skuId: skuB, skuCode: "MUG-WHITE", title: "White mug", variantId: variantB, platforms: ["amazon"], revision: 1, createdAt: timestamp, updatedAt: timestamp }
      ],
      assets: [
        asset("6", "product", productId, "main", "approved", 0),
        asset("7", "product", productId, "selling-point", "candidate", 1),
        asset("8", "sku", skuB, "scene", "approved", 2)
      ]
    }]
  }, null, 2)}\n`, "utf8");
}

async function waitFor(expression, timeoutMs = 12_000) {
  return waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs: 70 });
}

async function setWindowSize(width, height) {
  const result = await evaluate(client, `(async () => await window.naimageConfig?.debugWindowBounds?.(${JSON.stringify({ width, height })}))()`, 5_000);
  assert.equal(result?.ok, true, `Window resize failed: ${JSON.stringify(result)}`);
  await delay(320);
  await evaluate(client, "window.dispatchEvent(new Event('resize')); undefined");
  await delay(180);
}

async function dispatchExportShortcut() {
  const payload = {
    key: "6",
    code: "Digit6",
    windowsVirtualKeyCode: 54,
    nativeVirtualKeyCode: 54,
    modifiers: 10
  };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...payload });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
}

async function clickByText(selector, text) {
  const clicked = await evaluate(client, `(() => {
    const expected = ${JSON.stringify(text)};
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((candidate) => String(candidate.textContent || "").replace(/\\s+/g, " ").trim().includes(expected));
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing control: ${text}`);
}

async function selectControl(index, value) {
  const changed = await evaluate(client, `(() => {
    const element = document.querySelectorAll('.commerce-export-controls select')[${Number(index)}];
    if (!(element instanceof HTMLSelectElement)) return false;
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Missing export select at index ${index}`);
  await delay(120);
}

async function readLayout() {
  return evaluate(client, `(() => {
    const dialog = document.querySelector('.commerce-export-dialog');
    const body = document.querySelector('.commerce-export-body');
    const selection = document.querySelector('.commerce-export-selection');
    const preview = document.querySelector('.commerce-export-preview');
    const footer = dialog?.querySelector('.ui-surface-footer');
    const exportButton = Array.from(dialog?.querySelectorAll('button') || []).find((button) => button.textContent?.includes('导出 SKU 包'));
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const dialogRect = rect(dialog);
    const exportRect = rect(exportButton);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialog: dialogRect,
      body: rect(body),
      selection: rect(selection),
      preview: rect(preview),
      footer: rect(footer),
      exportButton: exportRect,
      dialogInsideViewport: Boolean(dialogRect && dialogRect.left >= -1 && dialogRect.top >= -1 && dialogRect.right <= innerWidth + 1 && dialogRect.bottom <= innerHeight + 1),
      exportButtonReachable: Boolean(exportRect && exportRect.left >= -1 && exportRect.top >= -1 && exportRect.right <= innerWidth + 1 && exportRect.bottom <= innerHeight + 1),
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      dialogOverflowX: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1),
      bodyOverflowX: Boolean(body && body.scrollWidth > body.clientWidth + 1),
      packageRows: document.querySelectorAll('.commerce-export-package-row').length,
      issueRows: document.querySelectorAll('.commerce-export-issue').length,
      exportEnabled: exportButton instanceof HTMLButtonElement && !exportButton.disabled
    };
  })()`);
}

async function main() {
  mkdirSync(runDir, { recursive: true });
  prepareProjectFixture();
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");
  writeFileSync(join(configDir, "app-settings.json"), `${JSON.stringify({
    theme: "light",
    themePalette: "anthropic",
    canvasToolDockMode: "expanded",
    pluginStates: [{
      id: "sparkai.commerce-toolkit",
      version: "1.0.0",
      enabled: true,
      grantedPermissions: ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]
    }]
  }, null, 2)}\n`, "utf8");
  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false
  });
  await waitForHttpServer(devUrl, { attempts: 120, intervalMs: 100, errorMessage: "Commerce export Vite server did not start." });

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

  target = await pollForDebugTarget({
    port: debugPort,
    attempts: 160,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Commerce export Electron renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitFor("Boolean(document.querySelector('.ide-shell') && window.naimageConfig?.previewCommerceExport)", 15_000);
  seedCatalog();

  const toolbar = await evaluate(client, `(() => {
    const button = document.querySelector('[data-plugin-command="${exportCommand}"]');
    return {
      exists: button instanceof HTMLButtonElement,
      title: button?.getAttribute('title') || '',
      hasIcon: Boolean(button?.querySelector('svg')),
      shortcut: button?.getAttribute('aria-keyshortcuts') || ''
    };
  })()`);
  assert.equal(toolbar.exists, true);
  assert.equal(toolbar.hasIcon, true);
  assert.match(toolbar.title, /Ctrl\/⌘\s+\+\s+Shift\s+\+\s+6/);
  assert.match(toolbar.shortcut, /Control\+Shift\+6/);

  await setWindowSize(1280, 820);
  await dispatchExportShortcut();
  await waitFor("Boolean(document.querySelector('.commerce-export-dialog'))");
  await waitFor("document.querySelectorAll('.commerce-export-product-row').length === 1 && document.querySelectorAll('.commerce-export-sku-list label').length === 2");

  const initial = await evaluate(client, `(() => ({
    platform: document.querySelectorAll('.commerce-export-controls select')[0]?.value,
    format: document.querySelectorAll('.commerce-export-controls select')[1]?.value,
    candidate: document.querySelector('.commerce-export-candidate-toggle input')?.checked,
    selected: Array.from(document.querySelectorAll('.commerce-export-sku-list input')).filter((input) => input.checked).length,
    summaryText: document.querySelector('.commerce-export-selection-header small')?.textContent?.trim()
  }))()`);
  assert.deepEqual(initial, { platform: "amazon", format: "jpeg", candidate: false, selected: 2, summaryText: "2/2" });

  await selectControl(1, "png");
  await clickByText(".commerce-export-candidate-toggle", "包含候选结果");
  assert.equal(await evaluate(client, "document.querySelector('.commerce-export-candidate-toggle input')?.checked"), true);
  await selectControl(0, "aliexpress");
  await waitFor("document.querySelectorAll('.commerce-export-sku-list label').length === 1");
  assert.equal(await evaluate(client, "document.querySelector('.commerce-export-selection-header small')?.textContent?.trim()"), "1/1");
  await selectControl(0, "amazon");
  await waitFor("document.querySelectorAll('.commerce-export-sku-list label').length === 2");
  assert.equal(await evaluate(client, "document.querySelectorAll('.commerce-export-controls select')[1]?.value"), "jpeg");

  const toggledOff = await evaluate(client, `(() => {
    const input = document.querySelector('.commerce-export-sku-list label input');
    if (!(input instanceof HTMLInputElement)) return false;
    input.click();
    return true;
  })()`);
  assert.equal(toggledOff, true);
  await waitFor("document.querySelector('.commerce-export-selection-header small')?.textContent?.trim() === '1/2'");
  await evaluate(client, "document.querySelector('.commerce-export-sku-list label input')?.click()");
  await waitFor("document.querySelector('.commerce-export-selection-header small')?.textContent?.trim() === '2/2'");

  await clickByText(".commerce-export-dialog button", "运行检查");
  await waitFor("document.querySelectorAll('.commerce-export-package-row').length === 2", 20_000);
  const desktopLayout = await readLayout();
  assert.equal(desktopLayout.dialogInsideViewport, true, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.exportButtonReachable, true, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.documentOverflowX, false, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.dialogOverflowX, false, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.bodyOverflowX, false, JSON.stringify(desktopLayout));
  assert.equal(desktopLayout.packageRows, 2);
  assert(desktopLayout.issueRows > 0, "Fixture should expose at least one non-blocking platform warning");
  assert.equal(desktopLayout.exportEnabled, true);
  const desktopScreenshot = join(runDir, "commerce-export-1280x820.png");
  await capturePngScreenshotToFile(client, desktopScreenshot, { captureBeyondViewport: false }, 15_000);

  await setWindowSize(884, 720);
  const minimumLayout = await readLayout();
  assert.equal(minimumLayout.dialogInsideViewport, true, JSON.stringify(minimumLayout));
  assert.equal(minimumLayout.exportButtonReachable, true, JSON.stringify(minimumLayout));
  assert.equal(minimumLayout.documentOverflowX, false, JSON.stringify(minimumLayout));
  assert.equal(minimumLayout.dialogOverflowX, false, JSON.stringify(minimumLayout));
  assert.equal(minimumLayout.bodyOverflowX, false, JSON.stringify(minimumLayout));
  assert.equal(minimumLayout.packageRows, 2);
  assert.equal(minimumLayout.exportEnabled, true);
  const minimumScreenshot = join(runDir, "commerce-export-884x720.png");
  await capturePngScreenshotToFile(client, minimumScreenshot, { captureBeyondViewport: false }, 15_000);

  await evaluate(client, "document.querySelector('.commerce-export-dialog .ui-surface-close')?.click()");
  await waitFor("!document.querySelector('.commerce-export-dialog')");
  const toolbarOpened = await evaluate(client, `(() => {
    const button = document.querySelector('[data-plugin-command="${exportCommand}"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert.equal(toolbarOpened, true);
  await waitFor("Boolean(document.querySelector('.commerce-export-dialog'))");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 31,
    toolbar,
    initial,
    desktopLayout,
    minimumLayout,
    screenshots: [desktopScreenshot, minimumScreenshot]
  })}\n`);
}

try {
  await main();
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
