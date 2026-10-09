import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import sharp from "sharp";
import encodedImageFormat from "../../runtime/encoded-image-format.cjs";

import { allocateDebugPort } from "../aidebug/harness/process.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const exeArg = process.argv.find((item) => item.startsWith("--exe="));
const settingsArg = process.argv.find((item) => item.startsWith("--settings="));
const liveNetwork = process.argv.includes("--live-network");
const checkImageAdaptation = process.argv.includes("--check-image-adaptation");
const materialImageArg = process.argv.find((item) => item.startsWith("--material-image="));
const materialImagePath = materialImageArg ? resolve(materialImageArg.split("=").slice(1).join("=")) : "";
if (materialImagePath && !checkImageAdaptation) throw new Error("--material-image requires --check-image-adaptation.");
if (checkImageAdaptation && liveNetwork) throw new Error("The packaged image adaptation check requires isolated local fixtures.");
const executable = resolve(exeArg?.split("=").slice(1).join("=") || join(projectRoot, "release", "win-unpacked", "SparkAIWorkSpace.exe"));
const sourceSettings = settingsArg ? resolve(settingsArg.split("=").slice(1).join("=")) : "";
const themeRegistry = JSON.parse(readFileSync(join(projectRoot, "runtime", "glass-theme-presets.json"), "utf8"));
const themeDefinitions = Object.fromEntries(Object.entries(themeRegistry.themes).map(([id, theme]) => [id, {
  mode: theme.mode, solid: theme.appearance === "solid", canvas: theme.tokens.canvas, surface: theme.tokens.surfaceSolid
}]));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(projectRoot, ".diagnostics", "release", `packaged-smoke-${stamp}`);
const configDir = join(runDir, "config");
const userDataDir = join(runDir, "user-data");
const debugDir = join(runDir, "runtime");
const electronLog = join(runDir, "electron.log");
const reportPath = join(runDir, "report.json");
const smokeProjectId = "packaged-smoke-project";
const smokeProjectDir = join(runDir, "project");
const remotePort = await allocateDebugPort();

if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

function packagedRuntimeHygiene(executablePath) {
  const root = dirname(executablePath);
  const forbiddenDirectoryNames = new Set([".v8-cache", ".diagnostics", ".git", "__pycache__"]);
  const forbiddenFileNames = new Set([
    "app-settings.json",
    "project-list.json",
    "session.json",
    "release-signing-private.pem"
  ]);
  const forbidden = [];
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) {
        if (forbiddenDirectoryNames.has(entry.name)) forbidden.push(relativePath);
        else visit(absolute);
      } else if (entry.isFile()) {
        fileCount += 1;
        totalBytes += statSync(absolute).size;
        if (forbiddenFileNames.has(entry.name) || /(?:^|\/)config\/(?:.*\.)?(?:pem|key|cookie)$/i.test(relativePath)) {
          forbidden.push(relativePath);
        }
      }
    }
  };
  visit(root);
  if (forbidden.length) {
    throw new Error(`Packaged runtime contains development caches or private state: ${forbidden.slice(0, 20).join(", ")}`);
  }
  return { ok: true, root, fileCount, totalBytes, forbidden: [] };
}

const hygiene = packagedRuntimeHygiene(executable);
mkdirSync(configDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(debugDir, { recursive: true });
mkdirSync(smokeProjectDir, { recursive: true });
const smokeProjectCreatedAt = new Date().toISOString();
writeFileSync(join(configDir, "project-list.json"), `${JSON.stringify({
  activeProjectId: smokeProjectId,
  projects: [{
    id: smokeProjectId,
    name: "Packaged Smoke",
    path: smokeProjectDir,
    sessionPath: join(smokeProjectDir, "session.json"),
    createdAt: smokeProjectCreatedAt,
    updatedAt: smokeProjectCreatedAt,
    external: true
  }]
}, null, 2)}\n`, "utf8");
if (sourceSettings) {
  if (!existsSync(sourceSettings)) throw new Error(`Packaged smoke settings not found: ${sourceSettings}`);
  copyFileSync(sourceSettings, join(configDir, "app-settings.json"));
}
if (process.argv.includes("--check-native-account") && !liveNetwork) {
  const target = join(configDir, "app-settings.json");
  const settings = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
  // Mock /me alone does not constitute a signed-in settings snapshot. Seed the
  // isolated identity so the real renderer takes its normal cached-list path.
  writeFileSync(target, `${JSON.stringify({ ...settings, accessMode: "account", serverUserId: "aidebug-user", serverSessionCookie: "session=aidebug-auth" }, null, 2)}\n`);
}

function fixturePng(width = 64, height = 64, transparent = false) {
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const subject = x >= 14 && x <= 49 && y >= 12 && y <= 51;
      png.data[offset] = subject ? 45 : 242;
      png.data[offset + 1] = subject ? 152 : 246;
      png.data[offset + 2] = subject ? 210 : 245;
      png.data[offset + 3] = transparent ? (subject ? 255 : 0) : 255;
    }
  }
  return PNG.sync.write(png);
}

if (materialImagePath && statSync(materialImagePath).size > 32 * 1024 * 1024) throw new Error("Supplied material exceeds 32 MiB.");
const sourceBytes = materialImagePath ? readFileSync(materialImagePath) : fixturePng();
const sourceFormat = encodedImageFormat.requireEncodedImageFormat(sourceBytes);
const { info: sourceDimensions } = await sharp(sourceBytes, { failOn: "error", limitInputPixels: 64_000_000 }).raw().toBuffer({ resolveWithObject: true });
const suppliedMaterialImage = materialImagePath ? { path: materialImagePath, bytes: sourceBytes.length, sha256: createHash("sha256").update(sourceBytes).digest("hex"), mimeType: sourceFormat.mimeType, outputFormat: sourceFormat.format, width: sourceDimensions.width, height: sourceDimensions.height } : undefined;
const layerBytes = fixturePng(64, 64, true);
const background = new PNG({ width: 64, height: 64, colorType: 6, inputColorType: 6, inputHasAlpha: true });
for (let offset = 0; offset < background.data.length; offset += 4) {
  background.data[offset] = 242;
  background.data[offset + 1] = 246;
  background.data[offset + 2] = 245;
  background.data[offset + 3] = 255;
}
const backgroundBytes = PNG.sync.write(background);
const fixturePath = join(runDir, `external-reference${sourceFormat.extension}`);
writeFileSync(fixturePath, sourceBytes);
const sourceDataUrl = `data:${sourceFormat.mimeType};base64,${sourceBytes.toString("base64")}`;
const semanticPreviewDataUrl = `data:image/png;base64,${fixturePng().toString("base64")}`;
const layerDataUrl = `data:image/png;base64,${layerBytes.toString("base64")}`;
const backgroundDataUrl = `data:image/png;base64,${backgroundBytes.toString("base64")}`;

if (checkImageAdaptation) {
  const imageDir = join(smokeProjectDir, "output", "imagegen");
  mkdirSync(imageDir, { recursive: true });
  const imagePath = join(imageDir, `packaged-material${sourceFormat.extension}`);
  writeFileSync(imagePath, sourceBytes);
  writeFileSync(join(smokeProjectDir, "session.json"), JSON.stringify({
    version: 5, messages: [], selectedNodeId: "", selectedNodeIds: [],
    nodes: [{ id: "A", displayCode: "A", title: "打包素材", prompt: "", type: "image", status: "done", imageState: "done",
      branch: "basic", x: 100, y: 100, outputs: 1, createdAt: smokeProjectCreatedAt,
      assets: [{ type: "file", assetId: "packaged-material", index: 1, path: imagePath, mimeType: sourceFormat.mimeType, outputFormat: sourceFormat.format, width: sourceDimensions.width, height: sourceDimensions.height }] }]
  }));
  const settingsPath = join(configDir, "app-settings.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  writeFileSync(settingsPath, JSON.stringify({ ...settings, imageModel: "gpt-image-2",
    imageModelPool: ["gpt-image-2", "grok-imagine-image-2.0", "gemini-3.1-flash-image"] }));
}

const child = spawn(executable, [
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${remotePort}`
], {
  cwd: dirname(executable),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NAIMAGE_AIDEBUG: "1",
    NAIMAGE_AIDEBUG_LIVE_IMAGE: liveNetwork ? "1" : "0",
    NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
    NAIMAGE_CONFIG_DIR: configDir,
    NAIMAGE_DEBUG_DIR: debugDir,
    NAIMAGE_ELECTRON_LOG: electronLog
  }
});

let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

async function waitForTarget(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // The DevTools endpoint appears after Electron creates its renderer.
    }
    await delay(250);
  }
  throw new Error("Packaged renderer DevTools target did not become ready.");
}

function cdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("Unable to open packaged renderer CDP socket.")), { once: true });
  });
  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveCall, reject: rejectCall, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) rejectCall(new Error(message.error.message || JSON.stringify(message.error)));
    else resolveCall(message.result);
  });
  const call = async (method, params = {}, timeoutMs = 60_000) => {
    await opened;
    const id = ++sequence;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { socket, call };
}

let result = null;
let failure = "";
let target = null;
try {
  target = await waitForTarget();
  const client = cdpClient(target.webSocketDebuggerUrl);
  await client.call("Runtime.enable");
  const expression = `(async () => {
    const waitUntil = async (predicate, timeoutMs = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (predicate()) return true;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      return false;
    };
    const bridgeReady = await waitUntil(() => Boolean(
      window.naimageConfig && window.naimageAgent &&
      (!${JSON.stringify(liveNetwork)} || (window.naimageServer && window.naimageUpdater))
    ));
    if (!bridgeReady) throw new Error("Production preload bridges did not become ready.");
    const settings = await window.naimageConfig.loadSettings();
    const projects = await window.naimageConfig.listProjects();
    const smoke = await window.naimageAgent.smoke();
    const projectId = ${JSON.stringify(smokeProjectId)};
    const saved = await window.naimageConfig.saveOutputImage({
      dataUrl: ${JSON.stringify(sourceDataUrl)},
      stem: "packaged-smoke",
      runId: "packaged-smoke-${stamp}",
      projectId,
      bucket: "imagegen"
    });
    const readBack = saved?.asset?.path
      ? await window.naimageConfig.readAssetDataUrl({ path: saved.asset.path })
      : { ok: false, error: "saved asset path missing" };
    const imported = await window.naimageConfig.importLocalImage({
      path: ${JSON.stringify(fixturePath)},
      projectId
    });
    const semantic = await window.naimageConfig.refineSemanticLayers({
      width: 64,
      height: 64,
      previewSource: ${JSON.stringify(semanticPreviewDataUrl)},
      backgroundSource: ${JSON.stringify(backgroundDataUrl)},
      layers: [{
        id: "subject-fixture",
        role: "decoration",
        source: ${JSON.stringify(layerDataUrl)},
        preserveGeometry: true
      }]
    });
    const psd = saved?.asset
      ? await window.naimageConfig.exportAssetPsd({
          asset: saved.asset,
          assetIndex: 0,
          nodeTitle: "Packaged Smoke",
          projectId,
          suggestedName: "packaged-smoke.psd",
          aidebugName: "packaged-smoke"
        })
      : { ok: false, error: "saved asset missing" };
    const thumbnail = await window.naimageConfig.thumbnailStats({});
    const network = ${JSON.stringify(liveNetwork)}
      ? await (async () => {
          const meStartedAt = performance.now();
          const me = await window.naimageServer.me();
          const meDurationMs = Math.round(performance.now() - meStartedAt);
          const updateStartedAt = performance.now();
          const update = await window.naimageUpdater.check();
          const updateDurationMs = Math.round(performance.now() - updateStartedAt);
          const logsStartedAt = performance.now();
          const logs = await window.naimageServer.logs();
          const logsDurationMs = Math.round(performance.now() - logsStartedAt);
          return {
            ok: Boolean(me?.ok && update?.ok && logs?.ok),
            meOk: Boolean(me?.ok),
            updateOk: Boolean(update?.ok),
            logsOk: Boolean(logs?.ok),
            logCount: Array.isArray(logs?.logs) ? logs.logs.length : 0,
            currentVersion: update?.currentVersion || "",
            latestVersion: update?.latestVersion || "",
            updateAvailable: update?.updateAvailable === true,
            updateType: update?.updateType || "none",
            meDurationMs,
            updateDurationMs,
            logsDurationMs
          };
        })()
      : { ok: true, skipped: true };
    const title = document.title;
    const bodyText = (document.body?.innerText || "").trim();
    const expectedThemeId = settings?.settings?.glassTheme;
    await waitUntil(() => document.documentElement.dataset.glassTheme === expectedThemeId);
    const expectedTheme = ${JSON.stringify(themeDefinitions)}[expectedThemeId];
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const canvasStyle = getComputedStyle(document.querySelector('[data-canvas-surface="true"]'));
    const composerStyle = getComputedStyle(document.querySelector('textarea')?.closest('form'));
    const hexRgb = (hex) => 'rgb(' + [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ') + ')';
    const appearance = {
      theme: root.dataset.glassTheme,
      style: root.dataset.glassStyle,
      mode: rootStyle.colorScheme,
      canvas: canvasStyle.backgroundColor,
      canvasImage: canvasStyle.backgroundImage,
      noise: root.dataset.glassNoise,
      backdrop: composerStyle.backdropFilter
    };
    appearance.ok = Boolean(expectedTheme && appearance.theme === expectedThemeId && appearance.mode === expectedTheme.mode && appearance.canvas === hexRgb(expectedTheme.canvas) && (
      expectedTheme.solid
        ? appearance.style === 'solid' && appearance.canvasImage === 'none' && appearance.noise === 'off' && appearance.backdrop === 'none'
        : appearance.style === 'glass'
    ));
    return {
      ok: Boolean(
        settings && projects?.ok && smoke?.ok && saved?.ok && readBack?.ok &&
        imported?.ok && semantic?.ok && psd?.ok && thumbnail?.ok && network?.ok &&
        title === "SparkAI WorkSpace" && bodyText.length > 20 && appearance.ok
      ),
      title,
      bodyTextLength: bodyText.length,
      appearance,
      bridges: {
        config: Object.keys(window.naimageConfig || {}),
        agent: Object.keys(window.naimageAgent || {}),
        server: Object.keys(window.naimageServer || {})
      },
      projects: { ok: projects?.ok, count: projects?.projects?.length, activeProjectId: projects?.activeProjectId },
      smoke,
      saved: { ok: saved?.ok, path: saved?.asset?.path, width: saved?.asset?.width, height: saved?.asset?.height },
      readBack: { ok: readBack?.ok, matches: readBack?.dataUrl === ${JSON.stringify(sourceDataUrl)} },
      imported: { ok: imported?.ok, path: imported?.asset?.path, thumbnailPath: imported?.asset?.thumbnailPath },
      semantic: { ok: semantic?.ok, engine: semantic?.engine, layerCount: semantic?.layers?.length, reportCount: semantic?.reports?.length },
      psd: { ok: psd?.ok, path: psd?.path, count: psd?.count, layerNames: psd?.layerNames },
      thumbnail: { ok: thumbnail?.ok, stats: thumbnail?.stats },
      network
    };
  })()`;
  const evaluated = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, 180_000);
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text || "Packaged smoke evaluation failed.");
  }
  result = evaluated.result?.value;
  await client.call("Page.enable");
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(runDir, "packaged-workspace.png"), Buffer.from(screenshot.data, "base64"));
  if (process.argv.includes("--check-theme-entry") || process.argv.includes("--check-native-account") || checkImageAdaptation) {
    async function evaluateUi(expression) {
      const response = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result?.value;
    }
    async function waitUi(expression) {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluateUi(expression)) return;
        await delay(100);
      }
      await captureUi('packaged-ui-failure');
      const ui = await evaluateUi(`({ dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(item => ({ label: item.getAttribute('aria-label'), surface: item.dataset.uiSurface })),
        menuButtons: Array.from(document.querySelectorAll('[role="menu"] button')).map(item => item.textContent.trim()),
        nodeCount: document.querySelectorAll('[data-canvas-surface="true"] [data-node-id]').length })`);
      writeFileSync(join(runDir, 'packaged-ui-failure.json'), JSON.stringify(ui, null, 2));
      throw new Error(`Packaged UI did not settle: ${expression}`);
    }
    async function pointFor(selector, text = null) {
      const point = await evaluateUi(`(() => {
        const button = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => ${JSON.stringify(text)} === null || item.textContent.trim() === ${JSON.stringify(text)});
        button?.scrollIntoView({ block: 'nearest' });
        const box = button?.getBoundingClientRect();
        const x = box ? box.left + box.width / 2 : 0;
        const y = box ? box.top + box.height / 2 : 0;
        const label = button?.querySelector('span');
        const labelBox = label?.getBoundingClientRect();
        return { x, y, text: button?.textContent?.trim(), labelWidth: labelBox?.width || 0,
          visible: Boolean(box && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight),
          hit: Boolean(button && button.contains(document.elementFromPoint(x, y)))
        };
      })()`);
      if (!point?.visible || !point.hit) throw new Error(`Packaged control is clipped or covered: ${selector} ${JSON.stringify(point)}`);
      return point;
    }
    async function clickUi(selector, text = null, right = false) {
      const point = await pointFor(selector, text);
      const button = right ? "right" : "left";
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button, clickCount: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button, clickCount: 1 });
      await delay(100);
      return point;
    }
    async function captureUi(name) {
      const shot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(runDir, `${name}.png`), Buffer.from(shot.data, "base64"));
    }
    const originalSize = await evaluateUi("({ width: innerWidth, height: innerHeight })");
    const resized = await evaluateUi("window.naimageConfig.debugWindowBounds({ width: 884, height: 640 })");
    if (!resized?.ok) throw new Error("Packaged Electron window could not be resized for the theme entry check.");
    await client.call("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, screenWidth: 884, screenHeight: 640, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    if (process.argv.includes("--check-theme-entry")) {
    const trigger = await pointFor('button[aria-label="切换界面主题"]');
    if (trigger.text !== "主题" || trigger.labelWidth < 10) throw new Error("Packaged small-window theme entry has no legible label.");
    await captureUi("packaged-theme-entry-minimum");
    await clickUi('button[aria-label="切换界面主题"]');
    await waitUi("Boolean(document.querySelector('[data-glass-lab]'))");
    await clickUi('button[data-settings-section="agent"]');
    const previousScroll = await evaluateUi(`(() => {
      const body = document.querySelector('[data-ui-surface="settings"] > nav').nextElementSibling;
      body.scrollTop = body.scrollHeight;
      return body.scrollTop;
    })()`);
    if (previousScroll < 40) throw new Error("Packaged theme navigation did not exercise a scrolled settings category.");
    await clickUi('button[data-settings-section="appearance"]');
    await waitUi("Boolean(document.querySelector('[data-glass-lab]'))");
    const buttons = await evaluateUi(`(() => {
      const body = document.querySelector('[data-ui-surface="settings"] > nav').nextElementSibling;
      const viewport = body.getBoundingClientRect();
      return { scrollTop: body.scrollTop, themes: ['light-classic', 'dark-classic'].map((id) => {
        const button = document.querySelector('[data-glass-section="themes"] button[data-glass-theme="' + id + '"]');
        const box = button?.getBoundingClientRect();
        return { id, text: button?.textContent?.trim(), visible: Boolean(box && box.top >= viewport.top && box.bottom <= viewport.bottom && box.left >= viewport.left && box.right <= viewport.right) };
      }) };
    })()`);
    result.themeEntry = { ok: false, trigger, previousScroll, ...buttons };
    await captureUi("packaged-theme-buttons");
    if (buttons.scrollTop !== 0 || buttons.themes.some((item) => !item.visible)) throw new Error("Packaged black/white theme buttons are outside the settings viewport.");
    for (const { id } of buttons.themes) {
      await clickUi(`[data-glass-section="themes"] button[data-glass-theme="${id}"]`);
      await waitUi(`document.documentElement.dataset.glassTheme === ${JSON.stringify(id)} && document.documentElement.dataset.glassStyle === 'solid'`);
      await captureUi(`packaged-theme-${id}`);
    }
    // Discard this isolated draft so the appearance and independent-window
    // checks still validate the configuration with which this smoke started.
    await clickUi('button[aria-label="关闭设置"]');
    await waitUi("!document.querySelector('[data-ui-surface=\"settings\"]') || Array.from(document.querySelectorAll('button')).some((item) => item.textContent.trim() === '不保存并关闭')");
    if (await evaluateUi("Boolean(document.querySelector('[data-ui-surface=\"settings\"]'))")) await clickUi("button", "不保存并关闭");
    await waitUi(`!document.querySelector('[data-ui-surface="settings"]') && document.documentElement.dataset.glassTheme === ${JSON.stringify(result.appearance.theme)}`);
    result.themeEntry = { ok: true, windowBounds: resized.contentBounds, trigger, previousScroll, ...buttons, mouseClicked: buttons.themes.map((item) => item.id) };
    }
    if (process.argv.includes("--check-native-account")) {
      if (liveNetwork) throw new Error("The packaged account UI check requires the isolated mock account.");
      await clickUi('.account-avatar-button');
      await waitUi("document.querySelector('.account-usage-count')?.textContent?.includes('共 25 条')");
      const overview = await evaluateUi(`(() => {
        const drawer = document.querySelector('.account-drawer'), body = drawer.querySelector('.account-surface-body'), box = drawer.getBoundingClientRect();
        const background = (element) => {
          const color = getComputedStyle(element).backgroundColor;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return { color, alpha: context.getImageData(0, 0, 1, 1).data[3] / 255 };
        };
        return { cards: Array.from(drawer.querySelectorAll('.account-balance-grid > div')).map(item => item.textContent),
          withinViewport: box.left >= 0 && box.right <= innerWidth + 1, overflow: body.scrollWidth > body.clientWidth + 1,
          backgrounds: [background(drawer), background(body)],
          fakePricing: /单张损耗|免费张数|充值额度/.test(drawer.textContent) };
      })()`);
      result.nativeAccount = { ok: false, mockAccount: true, overview };
      await captureUi('packaged-native-account');
      if (overview.backgrounds.some(item => item.alpha < 0.99)) throw new Error("Packaged account text is not protected by an opaque reading surface.");
      if (!overview.withinViewport || overview.overflow || overview.fakePricing || !overview.cards[0].includes('$2.00')) throw new Error("Packaged native account overview has invalid quota or layout.");
      await clickUi('.account-log-pager button:last-child');
      await waitUi("document.querySelector('.account-log-pager > span')?.textContent?.trim() === '2 / 2'");
      const pageTwoCount = await evaluateUi("document.querySelectorAll('.account-usage-list article').length");
      if (pageTwoCount !== 5) throw new Error("Packaged account logs did not render the server page.");
      await captureUi('packaged-native-logs-page-2');
      await evaluateUi(`(() => { const select=document.querySelector('[aria-label="日志类型"]'); select.value='5'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await clickUi('.account-log-filters button[type="submit"]');
      await waitUi("document.querySelector('.account-usage-count')?.textContent?.includes('共 1 条')");
      const failureText = await evaluateUi("document.querySelector('.account-usage-list').textContent");
      if (!failureText.includes('调用失败') || /aidebug-sensitive-token|sk-aidebug/.test(failureText)) throw new Error("Packaged filtered log is incorrect or exposes credentials.");
      await captureUi('packaged-native-error-log');
      await clickUi('.account-primary-actions button:first-child');
      await waitUi("Boolean(document.querySelector('.settings-account-token-section')) && !document.querySelector('.account-drawer')");
      await waitUi("document.querySelector('[aria-label=\"刷新密钥与分组\"]')?.disabled === false");
      await waitUi("document.querySelector('.settings-account-token-section')?.textContent?.includes('本地快照') && document.querySelector('[aria-label=\"编辑当前密钥\"]')?.disabled === false");
      const tokenManagement = await evaluateUi(`(() => {
        const section = document.querySelector('.settings-account-token-section');
        return { cached: section.textContent.includes('本地快照'), selectedTokenVisible: Boolean(section.querySelector('[aria-label="编辑当前密钥"]')) };
      })()`);
      await captureUi('packaged-native-token-manager');
      await waitUi("document.querySelector('[aria-label=\"编辑当前密钥\"]')?.disabled === false");
      await clickUi('[aria-label="编辑当前密钥"]');
      await waitUi("Boolean(document.querySelector('[aria-label=\"密钥额度\"]'))");
      const cachedEditor = await evaluateUi(`(() => {
        const form=document.querySelector('.settings-account-token-editor');
        return { amount: form.querySelector('[aria-label="密钥额度"]').value,
          nativeUnit: form.textContent.includes('额度（USD）'), ips: form.querySelector('[aria-label="密钥 IP 白名单"]').value,
          models: form.querySelector('[aria-label="密钥允许的模型"]')?.value };
      })()`);
      if (cachedEditor.amount !== '10' || !cachedEditor.nativeUnit || cachedEditor.ips !== '203.0.113.7' || cachedEditor.models !== 'gpt-image-2') throw new Error("Packaged cached token editing lost the native quota unit or server restrictions.");
      await clickUi('[aria-label="密钥额度"]');
      await captureUi('packaged-native-cached-token-editor');
      await clickUi('.settings-account-token-editor button', '取消');
      await clickUi('[aria-label="刷新密钥与分组"]');
      await waitUi("document.querySelector('.settings-account-token-section')?.textContent?.includes('当前使用密钥')");
      const quotaText = await evaluateUi("document.querySelector('.settings-account-token-section').textContent");
      if (!quotaText.includes('$10.00')) throw new Error("Packaged token quota does not use the upstream display unit.");
      await clickUi('.settings-account-token-list summary');
      await clickUi('.settings-account-token-list-row button:last-child');
      await waitUi("Boolean(document.querySelector('[aria-label=\"密钥到期时间\"]'))");
      const editor = await evaluateUi(`(() => {
        const form=document.querySelector('.settings-account-token-editor');
        return { overflow: form.scrollWidth > form.clientWidth + 1, fields: ['密钥到期时间','密钥 IP 白名单'].map(label => Boolean(form.querySelector('[aria-label="' + label + '"]'))) };
      })()`);
      if (editor.overflow || editor.fields.some(value => !value)) throw new Error("Packaged token editor is missing fields or overflows.");
      await clickUi('[aria-label="密钥 IP 白名单"]');
      await captureUi('packaged-native-token-editor');
      await clickUi('.settings-account-token-editor button', '取消');
      await clickUi('button[aria-label="关闭设置"]');
      await waitUi("!document.querySelector('[data-ui-surface=\"settings\"]') || Array.from(document.querySelectorAll('button')).some(item => item.textContent.trim() === '不保存并关闭')");
      if (await evaluateUi("Boolean(document.querySelector('[data-ui-surface=\"settings\"]'))")) await clickUi('button', '不保存并关闭');
      await waitUi("!document.querySelector('[data-ui-surface=\"settings\"]')");
      result.nativeAccount = { ok: true, mockAccount: true, realProviderRequests: 0, windowBounds: resized.contentBounds, overview, pageTwoCount, filteredFailures: 1, tokenManagement, cachedEditor, editor };
    }
    if (checkImageAdaptation) {
      const materialTrigger = 'button[title^="当前素材："]';
      await waitUi('Boolean(document.querySelector(\'[data-canvas-surface="true"] [data-node-id="A"]\'))');
      await clickUi('[data-canvas-surface="true"] [data-node-id="A"]');
      await delay(800);
      await clickUi('[data-canvas-surface="true"] [data-node-id="A"]', null, true);
      await waitUi("Array.from(document.querySelectorAll('button')).some(item => item.textContent.trim() === '添加到原图')");
      await captureUi('packaged-material-node-menu');
      await clickUi('button', '添加到原图');
      await waitUi(`document.querySelector(${JSON.stringify(materialTrigger)})?.title.includes('1 张原图')`);
      for (const role of ['source', 'reference']) {
        const picker = `[role="dialog"][aria-label="${role === 'source' ? '本轮原图' : '参考图'}"]`;
        await clickUi(materialTrigger);
        await clickUi(`[role="menu"][aria-label="管理输入素材"] button:${role === 'source' ? 'first' : 'last'}-child`);
        await waitUi(`Boolean(document.querySelector(${JSON.stringify(picker)}))`);
        await clickUi(`${picker} [aria-label="素材来源"] button`, '从画布选取');
        const candidate = `${picker} button[data-canvas-node-id="A"][data-canvas-asset-index="0"]`;
        await waitUi(`document.querySelector(${JSON.stringify(candidate)})?.querySelector('img')?.naturalWidth > 0`);
        const selected = await evaluateUi(`document.querySelector(${JSON.stringify(candidate)})?.getAttribute('aria-pressed')`);
        if (selected !== (role === 'source' ? 'true' : 'false')) throw new Error('Packaged canvas picker lost the explicit material role.');
        if (role === 'reference') await clickUi(candidate);
        else await pointFor(candidate);
        await captureUi(`packaged-${role}-canvas-picker`);
        await clickUi(`${picker} footer button`, role === 'source' ? '取消' : '保存');
        await waitUi(`!document.querySelector(${JSON.stringify(picker)})`);
      }
      const materialTitle = await evaluateUi(`document.querySelector(${JSON.stringify(materialTrigger)})?.title`);
      if (!materialTitle.includes('0 张原图，1 张参考图')) throw new Error('Packaged canvas material role transfer failed.');
      await clickUi('button[aria-label="切换界面主题"]');
      await waitUi('Boolean(document.querySelector(\'[data-ui-surface="settings"]\'))');
      await clickUi('button[data-settings-section="models"]');
      await clickUi('button[aria-label="配置生图模型"]');
      const model = 'grok-imagine-image-2.0';
      const gemini = 'gemini-3.1-flash-image';
      await waitUi(`Boolean(document.querySelector('button[aria-label="${model} 接口格式"]'))`);
      for (const [field, value] of [['接口格式', 'openai-images'], ['服务渠道', 'newapi'], ['结果获取', 'sync']]) {
        await clickUi(`button[aria-label="${model} ${field}"]`);
        await clickUi(`[role="option"][data-glass-select-value="${value}"]`);
      }
      await clickUi(`button[aria-label="${gemini} 接口格式"]`);
      await clickUi('[role="option"][data-glass-select-value="gemini-native"]');
      await pointFor(`button[aria-label="${model} 接口格式"]`);
      await captureUi('packaged-provider-configuration');
      await clickUi('[role="dialog"][aria-label="配置生图模型"] footer button', '保存');
      await clickUi('[data-ui-surface="settings"] footer button', '保存设置');
      await waitUi('document.querySelector(\'[data-ui-surface="settings"]\')?.textContent.includes("设置已保存")');
      await clickUi('[data-ui-surface="settings"] footer button', '关闭');
      await waitUi('!document.querySelector(\'[data-ui-surface="settings"]\')');
      const savedSettings = JSON.parse(readFileSync(join(configDir, 'app-settings.json'), 'utf8'));
      const binding = savedSettings.imageModelBindings?.find(item => item.model === model);
      const geminiBinding = savedSettings.imageModelBindings?.find(item => item.model === gemini);
      if (binding?.protocol !== 'openai-images' || binding.gateway !== 'newapi' || binding.transportMode !== 'sync' || geminiBinding?.protocol !== 'gemini-native') throw new Error('Packaged provider configuration did not persist in Main.');
      await evaluateUi('window.__packagedImageReloadPending = true');
      await client.call('Page.reload');
      await waitUi(`!window.__packagedImageReloadPending && Boolean(document.querySelector(${JSON.stringify(materialTrigger)}))`);
      await clickUi('button[aria-label="切换界面主题"]');
      await waitUi('Boolean(document.querySelector(\'[data-ui-surface="settings"]\'))');
      await clickUi('button[data-settings-section="models"]');
      await clickUi('button[aria-label="配置生图模型"]');
      await waitUi(`Boolean(document.querySelector('button[aria-label="${model} 接口格式"]'))`);
      const reloaded = await evaluateUi(`(() => {
        const value = (model, field) => document.querySelector('button[aria-label="'+model+' '+field+'"]')?.closest('[data-glass-select]')?.dataset.value;
        return { protocol: value(${JSON.stringify(model)}, '接口格式'), gateway: value(${JSON.stringify(model)}, '服务渠道'),
          transportMode: value(${JSON.stringify(model)}, '结果获取'), geminiProtocol: value(${JSON.stringify(gemini)}, '接口格式') };
      })()`);
      if (reloaded.protocol !== 'openai-images' || reloaded.gateway !== 'newapi' || reloaded.transportMode !== 'sync' || reloaded.geminiProtocol !== 'gemini-native') throw new Error('Packaged provider configuration did not survive renderer reload.');
      await pointFor(`button[aria-label="${model} 接口格式"]`);
      await captureUi('packaged-provider-reloaded');
      await clickUi('[role="dialog"][aria-label="配置生图模型"] footer button', '取消');
      await clickUi('button[aria-label="关闭设置"]');
      await waitUi('!document.querySelector(\'[data-ui-surface="settings"]\') || Boolean(document.querySelector(\'[role="dialog"][aria-label="保存设置修改"]\'))');
      if (await evaluateUi('Boolean(document.querySelector(\'[data-ui-surface="settings"]\'))')) await clickUi('button', '不保存并关闭');
      await waitUi('!document.querySelector(\'[data-ui-surface="settings"]\')');
      result.imageAdaptation = { ok: true, windowBounds: resized.contentBounds, materialTitle, sourcePicker: true,
        referencePicker: true, nodeMenu: true, mainPersisted: true, reloaded, realProviderRequests: 0 };
      result.ok = result.ok && result.imageAdaptation.ok;
    }
    await evaluateUi(`window.naimageConfig.debugWindowBounds(${JSON.stringify(originalSize)})`);
    await client.call("Emulation.clearDeviceMetricsOverride");
  }
  if (process.argv.includes("--check-agent-window")) {
    const openAgent = await client.call("Runtime.evaluate", {
      expression: `(async () => {
        const toggle = document.querySelector('button[aria-label="调整对话框位置"]');
        if (!toggle) return false;
        toggle.click();
        for (let attempt = 0; attempt < 50; attempt++) {
          const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('独立浮动窗口'));
          if (button) { button.click(); return true; }
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
        return false;
      })()`, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (!openAgent.result?.value) throw new Error("Packaged independent Agent placement action was unavailable.");
    let agentTarget;
    for (let attempt = 0; attempt < 100 && !agentTarget; attempt++) {
      const targets = await (await fetch(`http://127.0.0.1:${remotePort}/json`)).json();
      agentTarget = targets.find((item) => item.type === "page" && /agent-window\.html(?:$|[?#])/.test(item.url));
      if (!agentTarget) await delay(100);
    }
    if (!agentTarget) throw new Error("Packaged independent Agent target was unavailable.");
    const agentClient = cdpClient(agentTarget.webSocketDebuggerUrl);
    try {
      await agentClient.call("Runtime.enable");
      const probe = await agentClient.call("Runtime.evaluate", {
        expression: `(async () => {
          for (let attempt = 0; attempt < 100 && document.documentElement?.dataset.glassTheme !== ${JSON.stringify(result.appearance.theme)}; attempt++) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          return { theme: document.documentElement.dataset.glassTheme, style: document.documentElement.dataset.glassStyle, mode: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.body).backgroundColor, header: getComputedStyle(document.querySelector('.agent-header')).backgroundColor, backdrop: getComputedStyle(document.querySelector('.agent-composer')).backdropFilter };
        })()`, awaitPromise: true, returnByValue: true
      });
      const expected = themeDefinitions[result.appearance.theme];
      const hexRgb = (hex) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
      result.independentAgent = probe.result?.value;
      result.independentAgent.ok = result.independentAgent.theme === result.appearance.theme && result.independentAgent.mode === expected.mode && result.independentAgent.background === hexRgb(expected.canvas) && (!expected.solid || (result.independentAgent.header === hexRgb(expected.surface) && result.independentAgent.backdrop === "none"));
      result.ok = result.ok && result.independentAgent.ok;
      await agentClient.call("Page.enable");
      const agentScreenshot = await agentClient.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(runDir, "packaged-independent-agent.png"), Buffer.from(agentScreenshot.data, "base64"));
    } finally {
      agentClient.socket.close();
    }
  }
  client.socket.close();
  if (!result?.ok) failure = "Packaged runtime checks returned a failing result.";
} catch (error) {
  failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  child.kill();
  await delay(1200);
  if (child.exitCode === null && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
}

const report = {
  ...(suppliedMaterialImage ? { suppliedMaterialImage } : {}),
  ok: !failure && result?.ok === true,
  executable,
  hygiene,
  runDir,
  reportPath,
  target: target ? { title: target.title, url: target.url } : null,
  result,
  failure,
  process: { exitCode: child.exitCode, stdout, stderr },
  logTail: existsSync(electronLog) ? readFileSync(electronLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-120) : []
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (sourceSettings && existsSync(configDir)) {
  if (relative(runDir, resolve(configDir)) !== "config") throw new Error("Packaged smoke cleanup escaped its run directory.");
  rmSync(configDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
console.log(JSON.stringify({ ok: report.ok, reportPath, executable, failure, result }, null, 2));
if (!report.ok) process.exitCode = 1;
