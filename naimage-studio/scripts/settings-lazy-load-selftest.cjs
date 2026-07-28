"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const electronSource = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
const serverIpcSource = fs.readFileSync(path.join(root, "desktop", "ipc", "server-ipc.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");

assert.match(mainSource, /refreshModels\(false,\s*draftSettings\.modelGroup,\s*true\)/, "Settings must hydrate models in cache-only mode");
assert.match(mainSource, /refreshAccountTokens\(\{\s*preferCached:\s*true\s*\}\)/, "Settings must hydrate account tokens from the local snapshot");
assert.doesNotMatch(mainSource, /activeSection === "access"[\s\S]{0,160}refreshAccountTokens\(\)/, "Opening the access section must not refresh New API automatically");
assert.doesNotMatch(mainSource, /manualModelRefreshCountRef/, "Manual refresh must not use a hidden multi-click bypass");
assert.match(mainSource, /function handleManualModelRefresh\(\)\s*\{\s*void refreshModels\(true\);\s*\}/, "One model refresh click must request fresh server state");
assert.match(mainSource, /label="刷新密钥与分组"/, "Account access must expose an explicit refresh action");
assert.match(mainSource, />\s*刷新模型\s*<\/ActionButton>/, "Model settings must expose an explicit refresh action");

assert.match(electronSource, /accountTokenCachePath\s*=\s*path\.join\(configDir,\s*"account-token-cache\.json"\)/, "Token snapshots must use an application-data cache file");
assert.match(electronSource, /const cacheOnly = options\?\.cacheOnly === true;[\s\S]*?if \(cacheOnly\) \{/, "Model settings must provide a cache-only branch");
assert.match(serverIpcSource, /cacheOnly:\s*payload\?\.cacheOnly === true/, "Model cache-only mode must cross IPC");
assert.match(serverIpcSource, /preferCached:\s*payload\?\.preferCached === true/, "Token snapshot preference must cross IPC");
assert.match(preloadSource, /tokens:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("naimage:server:tokens",\s*payload\)/, "Preload must forward token snapshot options");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 12 })}\n`);
