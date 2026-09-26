"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const settingsDrawerSource = fs.readFileSync(path.join(root, "src", "settings-drawer.tsx"), "utf8");
const modelConfigDialogSource = fs.readFileSync(path.join(root, "src", "model-config-dialog.tsx"), "utf8");
const projectAgentComposerSource = fs.readFileSync(path.join(root, "src", "project-agent-composer.tsx"), "utf8");
const agentPanelStyleSource = fs.readFileSync(path.join(root, "src", "styles", "07g-agent-panel-overrides.css"), "utf8");
const helpCenterSource = fs.readFileSync(path.join(root, "src", "help-center.tsx"), "utf8");
const electronSource = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
const serverIpcSource = fs.readFileSync(path.join(root, "desktop", "ipc", "server-ipc.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const composerToolbarStart = projectAgentComposerSource.indexOf('className="project-agent-composer-toolbar"');
const composerToolbarEnd = projectAgentComposerSource.indexOf("<textarea", composerToolbarStart);
const composerToolbarSource = composerToolbarStart >= 0 && composerToolbarEnd > composerToolbarStart
  ? projectAgentComposerSource.slice(composerToolbarStart, composerToolbarEnd)
  : "";

assert.match(mainSource, /React\.lazy\(\(\) => import\("\.\/settings-drawer"\)\)/, "Settings must remain behind a natural async boundary");
assert.match(mainSource, /React\.lazy\(\(\) => import\("\.\/help-center"\)\)/, "Help and policy content must remain behind a natural async boundary");
assert.match(settingsDrawerSource, /const LazyGlassLab\s*=\s*React\.lazy\(\(\) => import\("\.\/glass-lab"\)\)/, "Glass Lab must remain behind its own natural async boundary");
assert.match(settingsDrawerSource, /activeSection === "appearance"[\s\S]{0,900}<React\.Suspense[\s\S]{0,400}<LazyGlassLab\b/, "Glass Lab must load only inside the appearance section Suspense boundary");
assert.doesNotMatch(mainSource, /(?:from\s+|import\()["']\.\/glass-lab["']/, "The workspace entry must not eagerly import Glass Lab");
assert.match(settingsDrawerSource, /refreshModels\(false,\s*draftSettings\.modelGroup,\s*true\)/, "Settings must hydrate models in cache-only mode");
assert.match(settingsDrawerSource, /await refreshModels\(false,\s*draftSettings\.modelGroup,\s*true\);[\s\S]{0,120}await refreshModels\(false,\s*draftSettings\.modelGroup,\s*false\);/, "Settings must show the cached catalog before refreshing it in the background");
assert.match(settingsDrawerSource, /refreshAccountTokens\(\{\s*preferCached:\s*true\s*\}\)/, "Settings must hydrate account tokens from the local snapshot");
assert.doesNotMatch(settingsDrawerSource, /activeSection === "access"[\s\S]{0,160}refreshAccountTokens\(\)/, "Opening the access section must not refresh New API automatically");
assert.doesNotMatch(settingsDrawerSource, /manualModelRefreshCountRef/, "Manual refresh must not use a hidden multi-click bypass");
assert.match(settingsDrawerSource, /function handleManualModelRefresh\(\)\s*\{\s*void refreshModels\(true\);\s*\}/, "One model refresh click must request fresh server state");
assert.match(settingsDrawerSource, /label="刷新密钥与分组"/, "Account access must expose an explicit refresh action");
assert.match(settingsDrawerSource, />\s*刷新模型\s*<\/ActionButton>/, "Model settings must expose an explicit refresh action");
assert.match(settingsDrawerSource, /const imageCatalog = serverSettings\.imageModels\?\.length \? serverSettings\.imageModels : serverModels;/, "Image model settings must prefer the classified image catalog over the combined server list");
assert.match(settingsDrawerSource, /const agentCatalog = serverSettings\.agentModels\?\.length \? serverSettings\.agentModels : serverModels;/, "Agent model settings must prefer the classified conversation catalog over the combined server list");
assert.match(settingsDrawerSource, /accessProfiles:\s*serverSettings\.modelAccessProfiles \?\? \[\]/, "Settings must expose credential-safe compatibility profiles");
assert.match(settingsDrawerSource, /serviceStatuses:\s*serverSettings\.serviceStatuses \?\? \{\}/, "Settings must preserve independent Agent, image, and video service statuses");
assert.match(modelConfigDialogSource, /kind !== "video"[\s\S]{0,360}逐模型连接/, "Conversation and image model dialogs must expose per-model connections");
assert.match(modelConfigDialogSource, /kind === "agent" \? settings\.agentModelBindings : kind === "image" \? settings\.imageModelBindings : \[\]/, "The conversation model dialog must edit Agent bindings rather than image bindings");
assert.match(modelConfigDialogSource, /kind === "agent"[\s\S]{0,420}agentModelBindings[\s\S]{0,360}normalizeAgentModelPoolSelection/, "Saving the conversation model dialog must persist its per-model bindings");
assert.match(modelConfigDialogSource, /label=\{accountMode \? "自定义 API Key（可选）" : "API Key"\}/, "Account mode must retain the per-model custom API Key field");
assert.match(modelConfigDialogSource, /accountMode[\s\S]{0,900}customApiKey[\s\S]{0,1600}账户密钥/, "Account mode must keep custom model Keys and account-token fallback in one binding card");
assert.match(modelConfigDialogSource, /(?:账号登录与逐模型自定义 API Key 可以同时使用|无限制版账号登录也支持逐模型 Base URL 与 API Key)/, "The model dialog must explain custom connection priority without hiding account-token fallback");
assert.match(projectAgentComposerSource, /filterImagePickerModels\(uniqueImageModels\(\[\.\.\.imageModels, \.\.\.selectedImageModels\]\)\)/, "Composer model menu must preserve catalog order while retaining selected-model fallbacks");
assert.match(projectAgentComposerSource, /data-primary-action=\{primaryAction\}/, "Idle composer must mark which footer action is primary");
assert.match(projectAgentComposerSource, />\s*生成\s*</, "Direct generation must remain an explicit action");
assert.match(projectAgentComposerSource, />\s*发送给 Agent\s*</, "Sending to Agent must remain the labeled keyboard action");
assert.match(projectAgentComposerSource, /className="project-agent-model-trigger"[\s\S]{0,260}aria-haspopup="dialog"[\s\S]{0,180}aria-expanded=\{modelMenuOpen\}/, "Composer must expose the image catalog through one expandable model control");
const composerToolbarControlOrder = ["project-agent-mode-picker", "project-agent-materials-picker", "project-agent-model-picker", "project-agent-image-frame"]
  .map((selector) => composerToolbarSource.indexOf(selector));
assert(
  composerToolbarSource && composerToolbarControlOrder.every((index) => index >= 0) && composerToolbarControlOrder.every((index, position) => position === 0 || index > composerToolbarControlOrder[position - 1]),
  "Mode, materials, model, ratio, and resolution controls must share one compact toolbar"
);
assert.match(agentPanelStyleSource, /\.project-agent-model-picker\s*\{[\s\S]{0,220}max-width:\s*210px;/, "The image-model trigger must remain compact instead of expanding into a full-width model-name row");
assert.match(projectAgentComposerSource, /project-agent-mode-trigger[\s\S]{0,900}project-agent-mode-fan[\s\S]{0,1000}project-agent-mode-option goal/, "Normal and Goal modes must share one trigger with a fan menu");
assert.match(agentPanelStyleSource, /\.project-agent-mode-picker:hover \.project-agent-mode-fan[\s\S]{0,180}pointer-events:\s*auto;[\s\S]{0,120}opacity:\s*1;/, "The task-mode fan must be discoverable on hover");
assert.match(projectAgentComposerSource, /project-agent-materials-trigger[\s\S]{0,900}project-agent-materials-menu[\s\S]{0,600}添加原图[\s\S]{0,600}添加参考图/, "Original and reference image actions must collapse into one materials menu");
assert.match(projectAgentComposerSource, /project-agent-frame-picker ratio[\s\S]{0,500}aria-haspopup="listbox"[\s\S]{0,900}project-agent-frame-menu[\s\S]{0,1800}project-agent-frame-picker resolution/, "Ratio and resolution must use custom listboxes instead of native selects");
assert.doesNotMatch(projectAgentComposerSource.match(/<div ref=\{framePickerRef\}[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "", /<select\b/, "The compact frame controls must not fall back to native white select menus");
assert.match(agentPanelStyleSource, /\.project-agent-materials-menu,\s*\.project-agent-frame-menu\s*\{[\s\S]{0,520}backdrop-filter:\s*var\(--glass-backdrop-filter\)/, "Frame menus must inherit the shared glass surface");
assert.match(agentPanelStyleSource, /\.project-agent-frame-menu\s*\{[\s\S]{0,120}min-width:\s*max\(100%,\s*160px\)/, "Frame menus must be wide enough to avoid a thin native-dropdown appearance");
assert.match(projectAgentComposerSource, /className="project-agent-model-search"[\s\S]{0,260}placeholder="搜索上游模型"/, "Large upstream model catalogs must be searchable");
assert.match(projectAgentComposerSource, /className="project-agent-model-option"[\s\S]{0,420}type="checkbox"[\s\S]{0,160}checked=\{selected\}/, "Every image model option must use a directly checkable checkbox");
assert.match(projectAgentComposerSource, /lastSelected = selected && activeModels\.length === 1[\s\S]{0,900}disabled=\{lastSelected\}/, "The model menu must keep at least one image model selected");
assert.match(projectAgentComposerSource, /const defaultImageModel = activeModels\[0\] \|\| "";/, "The composer default image model must come from the first selected model");
assert.match(projectAgentComposerSource, /const selectedModelSummary = defaultImageModel \|\| "选择模型";/, "The composer model summary must use the default image model instead of only a model count");
assert.match(projectAgentComposerSource, /project-agent-model-trigger[\s\S]{0,520}<strong>\{selectedModelSummary\}<\/strong>/, "The composer trigger must render the default image model summary");
assert.match(projectAgentComposerSource, /function setDefaultImageModel\(model: string\)[\s\S]{0,260}onSelectedImageModelsChange\(\[model,/, "Setting the default image model must move it to the front of the selected pool");
assert.match(projectAgentComposerSource, /className=\{`project-agent-model-default[\s\S]{0,300}设为默认生图模型/, "Every model row must expose a named default-model control");
assert.match(mainSource, /const projectAgentChangeImageModels[\s\S]{0,260}const imageModel = imageModelPool\[0\]/, "The first selected model must persist as the default image model");
assert.match(mainSource, /projectAgentRequestImageModels[\s\S]{0,480}naimageServer\.models\(\{[\s\S]{0,160}selectedAccountTokenGroup[\s\S]{0,520}settings\?\.imageModels/, "Opening the composer model menu must load the current key's classified upstream image catalog through the shared model cache");
assert.match(projectAgentComposerSource, /value: "auto", label: "自动处理（推荐）"[\s\S]{0,180}value: "keep", label: "只修改要求，保留现有图片"[\s\S]{0,180}value: "replace-source", label: "更换处理图片"/, "The normal steer UI must expose only three plain-language image-scope choices");
assert.doesNotMatch(projectAgentComposerSource, /<option value="(?:merge-source|replace-reference|merge-reference|clear)">/, "The normal steer UI must not expose internal SOURCE or REFERENCE protocol modes");

assert.match(settingsDrawerSource, /function requestSettingsClose\(\)[\s\S]{0,180}if \(dirty\)[\s\S]{0,120}setClosePromptOpen\(true\)/, "Closing dirty settings must open the save-choice prompt");
assert.match(settingsDrawerSource, /savedAppearanceRef\.current = normalized;[\s\S]{0,220}if \(closeAfterSave\)/, "Save-and-close must retain the newly saved appearance during unmount");
assert.match(settingsDrawerSource, /commitSettings\(true\)[\s\S]{0,180}保存并关闭/, "The dirty close prompt must provide save-and-close");
assert.match(settingsDrawerSource, /discardAndClose[\s\S]{0,120}不保存并关闭/, "The dirty close prompt must provide discard-and-close");
assert.match(settingsDrawerSource, /<DrawerShell[\s\S]{0,260}busy=\{saving\}/, "Settings close policy must only be busy while a save is in progress");
assert.match(settingsDrawerSource, /<SurfaceHeader[\s\S]{0,320}closeDisabled=\{saving\}/, "Background model loading must not disable the Settings close button");

for (const section of ["start", "workflow", "privacy", "terms", "fees", "about"]) {
  assert.match(helpCenterSource, new RegExp(`id: "${section}"`), `Help Center must expose the ${section} section`);
}
assert.match(helpCenterSource, /软件制作者[\s\S]{0,80}namean/, "Help and policy content must identify namean as the software creator");

assert.match(electronSource, /accountTokenCachePath\s*=\s*path\.join\(configDir,\s*"account-token-cache\.json"\)/, "Token snapshots must use an application-data cache file");
assert.match(electronSource, /const cacheOnly = options\?\.cacheOnly === true;[\s\S]*?if \(cacheOnly\) \{/, "Model settings must provide a cache-only branch");
assert.match(electronSource, /const modelCacheTtlMs = 15 \* 60 \* 1000;/, "Electron Main must cache model catalogs for at least fifteen minutes");
assert.match(electronSource, /now - memoryEntry\.cachedAt < modelCacheTtlMs \* 4/, "Expired model catalogs must stay serveable while a background refresh runs");
assert.match(electronSource, /function modelCacheKey\(settings\)[\s\S]{0,1400}settings\.selectedAccountTokenId/, "Each selected NewAPI key must own an isolated model-cache entry");
assert.match(electronSource, /function modelCacheKey\(settings\)[\s\S]{0,900}credentials\.apiKey[\s\S]{0,500}credentialIdentity/, "Changing a custom API key on the same Base URL must rotate the shared model-cache key without persisting the key");
assert.match(electronSource, /accountTokenService\.credentials\(settings\)[\s\S]{0,260}directApiUrl\(credentials\.baseUrl, "\/v1\/models"\)[\s\S]{0,260}authorization: `Bearer \$\{credentials\.apiKey\}`/, "Account mode must query the selected NewAPI key's upstream /v1/models endpoint with its Main-only key");
assert.match(electronSource, /for \(const provider of \["agent", "image", "video"\]\)[\s\S]{0,900}customApiCredentials\(settings, credentialProvider\)/, "Custom API mode must classify each Agent, image, and video service while deduplicating shared credentials");
assert.match(electronSource, /credentialFingerprint = createHash\("sha256"\)[\s\S]{0,220}credentials\.apiKey/, "Distinct custom API keys on one Base URL must not be collapsed into one model request");
assert.match(electronSource, /const currentSettings = currentAgentSettings\(\);[\s\S]{0,260}settingsSecretStore\.restorePlaceholders\(\{[\s\S]{0,160}\.\.\.currentSettings,[\s\S]{0,160}\.\.\.\(incomingSettings \|\| \{\}\)[\s\S]{0,100}\}, currentSettings\)/, "Model-list drafts must merge the complete Main-owned settings before restoring encrypted Agent binding placeholders");
assert.match(electronSource, /const modelCapabilities = modelCapabilitiesFromResponse\(request\.data\);[\s\S]{0,180}const payload = \{ modelIds, modelCapabilities, profileId \};/, "Custom model discovery must retain each upstream endpoint capability payload");
assert.match(electronSource, /const modelCapabilities = mergeModelCapabilities\([\s\S]{0,180}payload\.modelCapabilities[\s\S]{0,500}splitModelSettings\(settings, collected, \[\], modelCapabilities, \{/, "Custom model discovery must preserve merged endpoint capabilities in the shared cache profile");
assert.match(electronSource, /modelCatalogUnavailable:\s*true/, "A failed account model refresh must return an explicit unavailable profile instead of erasing the saved catalog");
assert.match(electronSource, /mergeModelAccessProfiles\(base\.modelAccessProfiles, loaded\.modelAccessProfiles\)/, "A failed refresh must overlay its error profile onto the stale credential-free model cache");
assert.match(serverIpcSource, /cacheOnly:\s*payload\?\.cacheOnly === true/, "Model cache-only mode must cross IPC");
assert.match(serverIpcSource, /preferCached:\s*payload\?\.preferCached === true/, "Token snapshot preference must cross IPC");
assert.match(preloadSource, /tokens:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("naimage:server:tokens",\s*payload\)/, "Preload must forward token snapshot options");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 67 })}\n`);
