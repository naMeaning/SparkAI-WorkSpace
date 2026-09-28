import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runDir = join(repoRoot, ".diagnostics", "electron", `agent-send-ipc-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(runDir, "project");
const logPath = join(runDir, "electron.log");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
let viteProcess;
let electronProcess;
let client;

async function dispatchMouseClick(rect) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return { x, y };
}

async function dispatchCtrlEnter() {
  const control = {
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17
  };
  const enter = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  };
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers: 2,
    ...control
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers: 2,
    ...enter
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 2,
    ...enter
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 0,
    ...control
  });
}

async function main() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const timestamp = new Date().toISOString();
  writeFileSync(join(configDir, "project-list.json"), `${JSON.stringify({
    activeProjectId: "agent-send-ipc-project",
    projects: [{
      id: "agent-send-ipc-project",
      name: "Agent Send IPC Fixture",
      path: projectDir,
      sessionPath: join(projectDir, "session.json"),
      createdAt: timestamp,
      updatedAt: timestamp,
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
  await waitForHttpServer(devUrl, { attempts: 120, intervalMs: 100, errorMessage: "Vite did not start." });
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
      NAIMAGE_CONFIG_DIR: configDir,
      NAIMAGE_DEBUG_DIR: runDir,
      NAIMAGE_ELECTRON_LOG: logPath
    }
  });
  const target = await pollForDebugTarget({
    port: debugPort,
    attempts: 160,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Electron renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-panel') && window.__naimageDebugAgentState?.().activeProjectId === 'agent-send-ipc-project')", { evaluate, timeoutMs: 15_000, intervalMs: 100 });
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate, timeoutMs: 15_000, intervalMs: 100 });

  const settingsComputedStyle = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rgb = (value) => {
      const match = String(value || '').match(/rgba?\\((\\d+)[, ]+(\\d+)[, ]+(\\d+)/i);
      return match ? match.slice(1, 4).map(Number) : null;
    };
    const luminance = (value) => {
      const channels = rgb(value);
      if (!channels) return null;
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrast = (foreground, background) => {
      const fg = luminance(foreground);
      const bg = luminance(background);
      if (fg === null || bg === null) return null;
      const brightest = Math.max(fg, bg);
      const darkest = Math.min(fg, bg);
      return Math.round(((brightest + 0.05) / (darkest + 0.05)) * 100) / 100;
    };
    const read = () => {
      const drawer = document.querySelector('.settings-drawer');
      const input = drawer?.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea, select');
      const helper = drawer?.querySelector('small');
      const style = (element) => element ? getComputedStyle(element) : null;
      const drawerStyle = style(drawer);
      const inputStyle = style(input);
      const helperStyle = style(helper);
      return {
        theme: document.documentElement.getAttribute('data-glass-theme') || '',
        drawerBackground: drawerStyle?.backgroundColor || '',
        drawerOpacity: drawerStyle?.opacity || '',
        inputBackground: inputStyle?.backgroundColor || '',
        inputColor: inputStyle?.color || '',
        helperColor: helperStyle?.color || '',
        inputBorder: inputStyle?.borderColor || '',
        inputContrast: contrast(inputStyle?.color, inputStyle?.backgroundColor),
        helperContrast: contrast(helperStyle?.color, drawerStyle?.backgroundColor)
      };
    };
    window.__naimageDebugOpenSurface?.('settings');
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline && !document.querySelector('.settings-drawer')) await delay(30);
    const initial = read();
    const appearanceTab = Array.from(document.querySelectorAll('.settings-section-tab')).find((item) => String(item.textContent || '').trim() === '外观');
    appearanceTab?.click();
    await delay(180);
    const lab = document.querySelector('.glass-lab[data-glass-lab="true"]');
    const initialTheme = lab?.getAttribute('data-glass-theme') || initial.theme;
    const alternateTheme = initialTheme === 'light-silver' ? 'dark-ember' : 'light-silver';
    document.querySelector('[data-glass-section="themes"] [data-glass-theme="' + alternateTheme + '"]')?.click();
    const switchedDeadline = performance.now() + 2500;
    while (performance.now() < switchedDeadline && document.documentElement.getAttribute('data-glass-theme') !== alternateTheme) await delay(30);
    const alternate = read();
    document.querySelector('[data-glass-section="themes"] [data-glass-theme="' + initialTheme + '"]')?.click();
    const restoredDeadline = performance.now() + 2500;
    while (performance.now() < restoredDeadline && document.documentElement.getAttribute('data-glass-theme') !== initialTheme) await delay(30);
    window.__naimageDebugOpenSurface?.('main');
    const restoreDeadline = performance.now() + 2500;
    while (performance.now() < restoreDeadline && !document.querySelector('.project-agent-composer textarea')) await delay(30);
    return { initial, alternate, restoredTheme: document.documentElement.getAttribute('data-glass-theme') || '' };
  })()`);
  assert(settingsComputedStyle?.initial?.drawerBackground && settingsComputedStyle?.alternate?.drawerBackground, "Settings drawer computed styles must be observable in both themes.");
  assert.notEqual(settingsComputedStyle.initial.drawerBackground, "rgba(0, 0, 0, 0)", `Settings drawer must be opaque enough: ${JSON.stringify(settingsComputedStyle)}`);
  assert.notEqual(settingsComputedStyle.alternate.drawerBackground, "rgba(0, 0, 0, 0)", `Settings drawer must be opaque enough in alternate theme: ${JSON.stringify(settingsComputedStyle)}`);
  assert(settingsComputedStyle.initial.inputColor && settingsComputedStyle.alternate.inputColor, "Settings input text color must be defined in both themes.");
  assert((settingsComputedStyle.initial.inputContrast || 0) >= 4.5 && (settingsComputedStyle.initial.helperContrast || 0) >= 4.5, `Dark theme settings contrast is too low: ${JSON.stringify(settingsComputedStyle.initial)}`);
  assert((settingsComputedStyle.alternate.inputContrast || 0) >= 4.5 && (settingsComputedStyle.alternate.helperContrast || 0) >= 4.5, `Light theme settings contrast is too low: ${JSON.stringify(settingsComputedStyle.alternate)}`);

  const bridgeProbe = await evaluate(client, `(() => {
    const bridge = window.naimageAgent;
    if (!bridge || typeof bridge.chat !== 'function') return { ok: false, error: 'Agent bridge is unavailable.' };
    return { ok: true, chatType: typeof bridge.chat };
  })()`);
  assert.equal(bridgeProbe?.ok, true, JSON.stringify(bridgeProbe));

  const prompt = `AIDEBUG_REAL_COMPOSER_SEND_${Date.now()}`;
  const before = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    const button = document.querySelector('.project-agent-composer button[aria-label="发送"]');
    const textarea = document.querySelector('.project-agent-composer textarea');
    return {
      projectId: state.activeProjectId || '',
      conversationId: state.activeConversationId || '',
      agentStatus: state.agentStatus || '',
      button: button ? { disabled: button.disabled, type: button.getAttribute('type'), className: button.className } : null,
      textarea: Boolean(textarea)
    };
  })()`);
  const inputResult = await evaluate(client, `(() => {
    const textarea = document.querySelector('.project-agent-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(inputResult, true);
  await waitForRuntimeExpression(client, `document.querySelector('.project-agent-composer button[aria-label="发送"]')?.disabled === false`, { evaluate, timeoutMs: 3_000, intervalMs: 50 });
  const clickResult = await evaluate(client, `(() => {
    const button = document.querySelector('.project-agent-composer button[aria-label="发送"]');
    if (!(button instanceof HTMLButtonElement)) return { ok: false, error: 'send button missing' };
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const form = button.form;
    window.__naimageAgentSendSubmitCount = 0;
    form?.addEventListener('submit', () => { window.__naimageAgentSendSubmitCount += 1; }, { capture: true });
    return {
      ok: true,
      hit: hit ? { tag: hit.tagName, className: hit.className || '', ariaLabel: hit.getAttribute?.('aria-label') || '' } : null,
      activeBefore: document.activeElement?.tagName || '',
      formPresent: Boolean(form),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      disabled: button.disabled,
      type: button.type
    };
  })()`);
  assert.equal(clickResult?.ok, true, JSON.stringify(clickResult));
  const mouseDispatch = await dispatchMouseClick(clickResult.rect);
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    const promptPresent = Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)});
    const runtimeRequest = Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request');
    return promptPresent && runtimeRequest;
  })()`, { evaluate, timeoutMs: 5_000, intervalMs: 50 });
  const mouseAfter = await evaluate(client, `(() => ({
    activeElement: document.activeElement?.tagName || '',
    submitCount: Number(window.__naimageAgentSendSubmitCount || 0),
    buttonDisabled: document.querySelector('.project-agent-composer button[aria-label="发送"]')?.disabled ?? null
  }))()`);
  const keyboardPrompt = `AIDEBUG_REAL_COMPOSER_CTRL_ENTER_${Date.now()}`;
  const keyboardInput = await evaluate(client, `(() => {
    const textarea = document.querySelector('.project-agent-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(keyboardPrompt)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(keyboardPrompt)} }));
    textarea.focus();
    return document.activeElement === textarea;
  })()`);
  assert.equal(keyboardInput, true);
  await waitForRuntimeExpression(client, `document.querySelector('.project-agent-composer button[aria-label="发送"]')?.disabled === false`, { evaluate, timeoutMs: 3_000, intervalMs: 50 });
  await dispatchCtrlEnter();
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(keyboardPrompt)}) && Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request');
  })()`, { evaluate, timeoutMs: 5_000, intervalMs: 50 });
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return state.agentStatus === 'idle' || state.agentStatus === 'error';
  })()`, { evaluate, timeoutMs: 20_000, intervalMs: 100 });
  const normalEvidence = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return {
      promptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)}),
      runtimeRequest: Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request'),
      keyboardPromptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(keyboardPrompt)})
    };
  })()`);
  const staleBusyPrompt = `AIDEBUG_REAL_COMPOSER_STALE_BUSY_${Date.now()}`;
  const staleSurface = await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-running') === true`);
  assert.equal(staleSurface, true);
  await waitForRuntimeExpression(client, `window.__naimageDebugAgentState?.().activeRunId === 'debug-running-ui'`, { evaluate, timeoutMs: 3_000, intervalMs: 50 });
  const staleInput = await evaluate(client, `(() => {
    const textarea = document.querySelector('.project-agent-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(staleBusyPrompt)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(staleBusyPrompt)} }));
    textarea.focus();
    return document.activeElement === textarea;
  })()`);
  assert.equal(staleInput, true);
  await waitForRuntimeExpression(client, `document.querySelector('.project-agent-composer button[aria-label="修改当前任务"]')?.disabled === false`, { evaluate, timeoutMs: 3_000, intervalMs: 50 });
  await dispatchCtrlEnter();
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(staleBusyPrompt)}) && Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request' && item.runId !== 'debug-running-ui');
  })()`, { evaluate, timeoutMs: 5_000, intervalMs: 50 });
  const staleRecovery = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return {
      promptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(staleBusyPrompt)}),
      runtimeRequest: Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request' && item.runId !== 'debug-running-ui'),
      activeRunId: state.activeRunId || '',
      agentStatus: state.agentStatus || ''
    };
  })()`);
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return (state.agentStatus === 'idle' || state.agentStatus === 'error') && !state.activeRunId;
  })()`, { evaluate, timeoutMs: 20_000, intervalMs: 100 });
  const explicitScopePrompt = `AIDEBUG_REAL_COMPOSER_EXPLICIT_SCOPE_${Date.now()}`;
  const explicitScopeSurface = await evaluate(client, `window.__naimageDebugOpenSurface?.('agent-running') === true`);
  assert.equal(explicitScopeSurface, true);
  await waitForRuntimeExpression(client, `Boolean(document.querySelector('.project-agent-steer-mode .glass-select-trigger'))`, { evaluate, timeoutMs: 3_000, intervalMs: 50 });
  const explicitScopeMode = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trigger = document.querySelector('.project-agent-steer-mode .glass-select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) return false;
    trigger.click();
    await delay(60);
    const option = document.querySelector('[data-glass-select-value="replace-source"]');
    if (!(option instanceof HTMLButtonElement)) return false;
    option.click();
    await delay(80);
    return document.querySelector('.project-agent-steer-mode .glass-select-value')?.textContent?.includes('更换处理图片') === true;
  })()`);
  assert.equal(explicitScopeMode, true, 'Explicit TaskScope mode must be selectable while steering a run.');
  const explicitScopeInput = await evaluate(client, `(() => {
    const textarea = document.querySelector('.project-agent-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(explicitScopePrompt)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(explicitScopePrompt)} }));
    textarea.focus();
    return document.activeElement === textarea;
  })()`);
  assert.equal(explicitScopeInput, true);
  await dispatchCtrlEnter();
  await waitForRuntimeExpression(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(explicitScopePrompt)}) && Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request' && item.runId !== 'debug-running-ui');
  })()`, { evaluate, timeoutMs: 5_000, intervalMs: 50 });
  const explicitScopeRecovery = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return {
      promptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(explicitScopePrompt)}),
      runtimeRequest: Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request' && item.runId !== 'debug-running-ui'),
      lastScopeOrigin: state.lastDispatchedTaskScope?.origin || ''
    };
  })()`);
  await delay(250);
  const afterCall = await evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    return {
      state: {
        activeProjectId: state.activeProjectId || '',
        activeConversationId: state.activeConversationId || '',
        agentStatus: state.agentStatus || '',
        promptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)}),
        runtimeRequest: Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request'),
        lastProgress: Array.isArray(state.progress) ? state.progress.slice(-8) : [],
        lastAssistant: state.lastAssistant || ''
      },
      ipcEvidence: {
        promptPresent: Boolean(${JSON.stringify(normalEvidence?.promptPresent)}),
        runtimeRequest: Boolean(${JSON.stringify(normalEvidence?.runtimeRequest)}),
        electronLogHasMockModel: false,
        keyboardPromptPresent: Boolean(${JSON.stringify(normalEvidence?.keyboardPromptPresent)}),
        staleBusyPromptPresent: Boolean(${JSON.stringify(staleRecovery?.promptPresent)}),
        staleBusyRuntimeRequest: Boolean(${JSON.stringify(staleRecovery?.runtimeRequest)})
      }
    };
  })()`);
  let final = afterCall;
  try {
    await waitForRuntimeExpression(client, `(() => {
      const state = window.__naimageDebugAgentState?.() || {};
      return state.agentStatus === 'idle' || state.agentStatus === 'error';
    })()`, { evaluate, timeoutMs: 20_000, intervalMs: 100 });
    final = await evaluate(client, `(() => {
      const state = window.__naimageDebugAgentState?.() || {};
      return {
        state: {
          activeProjectId: state.activeProjectId || '',
          activeConversationId: state.activeConversationId || '',
          agentStatus: state.agentStatus || '',
          promptPresent: Array.isArray(state.messages) && state.messages.some((message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)}),
          runtimeRequest: Array.isArray(state.progress) && state.progress.some((item) => item.phase === 'runtime-request'),
          lastProgress: Array.isArray(state.progress) ? state.progress.slice(-12) : [],
          lastAssistant: state.lastAssistant || ''
      },
      ipcEvidence: {
        promptPresent: Boolean(${JSON.stringify(normalEvidence?.promptPresent)}),
        runtimeRequest: Boolean(${JSON.stringify(normalEvidence?.runtimeRequest)}),
        electronLogHasMockModel: false,
        keyboardPromptPresent: Boolean(${JSON.stringify(normalEvidence?.keyboardPromptPresent)}),
        staleBusyPromptPresent: Boolean(${JSON.stringify(staleRecovery?.promptPresent)}),
        staleBusyRuntimeRequest: Boolean(${JSON.stringify(staleRecovery?.runtimeRequest)})
      }
    };
  })()`);
  } catch {
    // Preserve the live state for diagnosis when the mock runtime does not settle.
  }
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8").split(/\r?\n/).slice(-80) : [];
  const electronLogHasMockModel = log.some((line) => line.includes(`aidebug model`) && line.includes(prompt));
  const electronLogHasStaleBusyModel = log.some((line) => line.includes(`aidebug model`) && line.includes(staleBusyPrompt));
  const ipcChatCount = log.filter((line) => line.includes("agent ipc chat received")).length;
  const ipcSteerCount = log.filter((line) => line.includes("agent ipc steer")).length;
  const ipcExplicitScopeSteerCount = log.filter((line) => line.includes("agent ipc steer") && line.includes("source=replace")).length;
  if (final?.ipcEvidence) final.ipcEvidence.electronLogHasMockModel = electronLogHasMockModel;
  if (final?.ipcEvidence) final.ipcEvidence.electronLogHasStaleBusyModel = electronLogHasStaleBusyModel;
  if (final?.ipcEvidence) {
    final.ipcEvidence.ipcChatCount = ipcChatCount;
    final.ipcEvidence.ipcSteerCount = ipcSteerCount;
    final.ipcEvidence.ipcExplicitScopeSteerCount = ipcExplicitScopeSteerCount;
    final.ipcEvidence.settingsComputedStyle = settingsComputedStyle;
    final.ipcEvidence.explicitScopeRecovery = explicitScopeRecovery;
  }
  process.stdout.write(`${JSON.stringify({ ok: Boolean(final?.ipcEvidence?.promptPresent && final?.ipcEvidence?.runtimeRequest && final?.ipcEvidence?.keyboardPromptPresent && final?.ipcEvidence?.staleBusyPromptPresent && final?.ipcEvidence?.staleBusyRuntimeRequest && final?.ipcEvidence?.explicitScopeRecovery?.promptPresent && final?.ipcEvidence?.explicitScopeRecovery?.runtimeRequest && electronLogHasMockModel && electronLogHasStaleBusyModel && ipcChatCount >= 4 && ipcSteerCount >= 2 && ipcExplicitScopeSteerCount >= 1 && settingsComputedStyle?.initial?.inputColor && settingsComputedStyle?.alternate?.inputColor), before, bridgeProbe, inputResult, clickResult, mouseDispatch, mouseAfter, keyboardInput, staleRecovery, explicitScopeMode, explicitScopeInput, explicitScopeRecovery, settingsComputedStyle, final, log }, null, 2)}\n`);
}

try {
  await main();
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
