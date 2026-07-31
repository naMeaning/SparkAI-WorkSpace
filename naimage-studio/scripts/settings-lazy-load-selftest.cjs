"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const settingsDrawerSource = fs.readFileSync(path.join(root, "src", "settings-drawer.tsx"), "utf8");
const projectAgentComposerSource = fs.readFileSync(path.join(root, "src", "project-agent-composer.tsx"), "utf8");
const electronSource = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
const serverIpcSource = fs.readFileSync(path.join(root, "desktop", "ipc", "server-ipc.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");

assert.match(mainSource, /React\.lazy\(\(\) => import\("\.\/settings-drawer"\)\)/, "Settings must remain behind a natural async boundary");
assert.match(settingsDrawerSource, /const LazyGlassLab\s*=\s*React\.lazy\(\(\) => import\("\.\/glass-lab"\)\)/, "Glass Lab must remain behind its own natural async boundary");
assert.match(settingsDrawerSource, /activeSection === "appearance"[\s\S]{0,900}<React\.Suspense[\s\S]{0,400}<LazyGlassLab\b/, "Glass Lab must load only inside the appearance section Suspense boundary");
assert.doesNotMatch(mainSource, /(?:from\s+|import\()["']\.\/glass-lab["']/, "The workspace entry must not eagerly import Glass Lab");
assert.match(settingsDrawerSource, /refreshModels\(false,\s*draftSettings\.modelGroup,\s*true\)/, "Settings must hydrate models in cache-only mode");
assert.match(settingsDrawerSource, /refreshAccountTokens\(\{\s*preferCached:\s*true\s*\}\)/, "Settings must hydrate account tokens from the local snapshot");
assert.doesNotMatch(settingsDrawerSource, /activeSection === "access"[\s\S]{0,160}refreshAccountTokens\(\)/, "Opening the access section must not refresh New API automatically");
assert.doesNotMatch(settingsDrawerSource, /manualModelRefreshCountRef/, "Manual refresh must not use a hidden multi-click bypass");
assert.match(settingsDrawerSource, /function handleManualModelRefresh\(\)\s*\{\s*void refreshModels\(true\);\s*\}/, "One model refresh click must request fresh server state");
assert.match(settingsDrawerSource, /label="刷新密钥与分组"/, "Account access must expose an explicit refresh action");
assert.match(settingsDrawerSource, />\s*刷新模型\s*<\/ActionButton>/, "Model settings must expose an explicit refresh action");
assert.match(settingsDrawerSource, /const imageCatalog = serverSettings\.imageModels\?\.length \? serverSettings\.imageModels : serverModels;/, "Image model settings must prefer the classified image catalog over the combined server list");
assert.match(settingsDrawerSource, /const agentCatalog = serverSettings\.agentModels\?\.length \? serverSettings\.agentModels : serverModels;/, "Agent model settings must prefer the classified conversation catalog over the combined server list");
assert.match(projectAgentComposerSource, /uniqueImageModels\(\[\.\.\.imageModels, \.\.\.selectedImageModels\]\)/, "Composer chips must preserve catalog order while retaining selected-model fallbacks");

assert.match(electronSource, /accountTokenCachePath\s*=\s*path\.join\(configDir,\s*"account-token-cache\.json"\)/, "Token snapshots must use an application-data cache file");
assert.match(electronSource, /const cacheOnly = options\?\.cacheOnly === true;[\s\S]*?if \(cacheOnly\) \{/, "Model settings must provide a cache-only branch");
assert.match(serverIpcSource, /cacheOnly:\s*payload\?\.cacheOnly === true/, "Model cache-only mode must cross IPC");
assert.match(serverIpcSource, /preferCached:\s*payload\?\.preferCached === true/, "Token snapshot preference must cross IPC");
assert.match(preloadSource, /tokens:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("naimage:server:tokens",\s*payload\)/, "Preload must forward token snapshot options");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 19 })}\n`);
