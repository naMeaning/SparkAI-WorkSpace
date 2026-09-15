"use strict";

const bridge = window.naimageAgentWindowSurface;
const feed = document.getElementById("agent-feed");
const promptInput = document.getElementById("agent-prompt");
const composer = document.getElementById("agent-composer");
const sendButton = document.getElementById("send-button");
const pauseButton = document.getElementById("pause-button");
const stopButton = document.getElementById("stop-button");
const steerModeField = document.getElementById("steer-mode-field");
const steerMode = document.getElementById("steer-mode");
const goalSteerLock = document.getElementById("goal-steer-lock");
const goalControls = document.getElementById("agent-goal-controls");
const taskModeRow = document.getElementById("task-mode-row");
const standardModeButton = document.getElementById("standard-mode");
const goalModeButton = document.getElementById("goal-mode");
const goalSummary = document.getElementById("goal-summary");
const editSourcesButton = document.getElementById("edit-sources");
const editReferencesButton = document.getElementById("edit-references");
const conversationSelect = document.getElementById("conversation-select");
const dockSelect = document.getElementById("dock-select");
const statusSurface = document.querySelector(".agent-status");
let currentState = null;
let renderFrame = 0;
let promptTimer = 0;
let selectedTaskMode = "standard";
let wasBusy = false;

const taskScopeSnapshotHashPattern = /^scope-[a-f0-9]{32}$/;
const goalConfirmationHashPattern = /^goal-[a-f0-9]{32}$/;
const glassThemeIds = new Set(["dark-rose", "dark-ember", "dark-emerald", "light-lemon", "light-sky", "light-blush"]);
const glassMaterialIds = new Set(["clear", "frosted", "dense", "custom"]);
const glassAccentIds = new Set(["theme", "rose", "mint", "coral", "amber", "ice"]);
const glassVariableNamePattern = /^--(?:glass-(?:rgb|opacity|alpha|blur|saturation|highlight|shadow|radius|noise-opacity|motion-duration|accent-(?:rose|mint|coral|amber|ice)|swatch-(?:dark-rose|dark-ember|dark-emerald|light-lemon|light-sky|light-blush)-(?:canvas|accent|surface))|noise-opacity|accent|accent-rgb|accent-ink|secondary|secondary-rgb|canvas-tint|node-bg|solid-control|solid-control-hover|success|danger|theme-(?:bg|canvas|surface|surface-solid|surface-raised|ink|ink-soft|muted|line|line-strong|accent|accent-strong|blue|rose|amber|green|control-bg|hover-bg|active-bg))$/;

function command(payload) {
  bridge?.command?.(payload);
}

function safeGlassCssValue(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text.length > 96 || /[;{}@\\]/.test(text)) return "";
  return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%+-]+\)|-?\d+(?:\.\d+)?(?:px|ms|%)?|(?:\d{1,3}\s*,\s*){2}\d{1,3})$/i.test(text) ? text : "";
}

function applyLegacyAppearance(state) {
  const resolvedTheme = state.theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.theme || "light";
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.palette = state.themePalette || "terracotta";
  const customColors = state.themePalette === "custom" ? state.customTheme?.[resolvedTheme] : null;
  const customThemeMap = {
    "--bg": "--theme-bg",
    "--surface": "--theme-surface-raised",
    "--surface-soft": "--theme-surface",
    "--line": "--theme-line",
    "--line-strong": "--theme-line",
    "--ink": "--theme-ink",
    "--ink-soft": "--theme-muted",
    "--accent": "--theme-accent"
  };
  for (const [target, source] of Object.entries(customThemeMap)) {
    document.documentElement.style[customColors?.[source] ? "setProperty" : "removeProperty"](target, customColors?.[source]);
  }
}

function applyGlassAppearance(state) {
  const appearance = state.glassAppearance;
  if (!appearance || !glassThemeIds.has(appearance.glassTheme) || !glassMaterialIds.has(appearance.glassMaterial)) {
    applyLegacyAppearance(state);
    return;
  }
  const root = document.documentElement;
  const mode = appearance.mode === "dark" || appearance.mode === "light"
    ? appearance.mode
    : appearance.glassTheme.startsWith("dark-") ? "dark" : "light";
  const parameters = appearance.glassParameters && typeof appearance.glassParameters === "object"
    ? appearance.glassParameters
    : {};
  const accent = glassAccentIds.has(parameters.accent) ? parameters.accent : "theme";
  const variables = appearance.variables && typeof appearance.variables === "object" && !Array.isArray(appearance.variables)
    ? appearance.variables
    : {};

  root.dataset.glassTheme = appearance.glassTheme;
  root.dataset.glassMode = mode;
  root.dataset.glassMaterial = appearance.glassMaterial;
  root.dataset.glassAccent = accent;
  root.dataset.glassAccentResolved = glassAccentIds.has(appearance.resolvedAccent) ? appearance.resolvedAccent : accent;
  root.dataset.glassNoise = parameters.noise === false ? "off" : "on";
  root.dataset.glassReduceMotion = parameters.reduceMotion === true ? "true" : "false";
  root.dataset.theme = mode;
  root.dataset.palette = "glass";
  root.dataset.uiTheme = appearance.glassTheme;
  root.classList.toggle("glass-theme-active", true);
  root.classList.toggle("theme-dark", mode === "dark");
  root.classList.toggle("theme-light", mode === "light");
  root.classList.toggle("glass-no-noise", parameters.noise === false);
  root.classList.toggle("glass-reduce-motion", parameters.reduceMotion === true);
  for (const [name, rawValue] of Object.entries(variables)) {
    const value = safeGlassCssValue(rawValue);
    if (glassVariableNamePattern.test(name) && value) root.style.setProperty(name, value);
  }
  const aliases = {
    "--bg": "--theme-canvas",
    "--surface": "--theme-surface-solid",
    "--surface-soft": "--theme-control-bg",
    "--line": "--theme-line",
    "--line-strong": "--theme-line-strong",
    "--ink": "--theme-ink",
    "--muted": "--theme-muted",
    "--accent": "--theme-accent",
    "--accent-strong": "--theme-accent-strong",
    "--accent-ink": "--accent-ink",
    "--danger": "--danger"
  };
  for (const [target, source] of Object.entries(aliases)) {
    const value = safeGlassCssValue(variables[source]);
    if (value) root.style.setProperty(target, value);
  }
  root.style.colorScheme = mode;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    const previous = button.textContent;
    button.textContent = "已复制";
    window.setTimeout(() => { button.textContent = previous; }, 1_200);
  } catch {
    button.textContent = "复制失败";
  }
}

function toolCard(trace) {
  const card = element("section", "tool-card");
  const title = element("div", "tool-title");
  title.append(element("strong", "", trace.label || "工具调用"));
  if (trace.operation) title.append(element("span", "", trace.operation));
  if (trace.params) title.append(element("span", "", `· ${trace.params}`));
  card.append(title);
  if (trace.brief) card.append(element("p", "tool-brief", trace.brief));
  if (Array.isArray(trace.prompts) && trace.prompts.length) {
    const details = element("details", "prompt-details");
    details.append(element("summary", "", `查看生图提示词 · ${trace.prompts.length}`));
    for (const item of trace.prompts) {
      const entry = element("section", "prompt-entry");
      const header = element("header");
      header.append(element("span", "", item.title || "生图提示词"));
      const copy = element("button", "", "复制");
      copy.type = "button";
      copy.addEventListener("click", () => void copyText(item.prompt, copy));
      header.append(copy);
      entry.append(header, element("pre", "prompt-text", item.prompt));
      details.append(entry);
    }
    card.append(details);
  }
  return card;
}

function messageCard(message) {
  const card = element("article", `message ${message.role || "assistant"}${message.status === "error" ? " error" : ""}`);
  const meta = element("div", "message-meta");
  meta.append(element("strong", "", message.role === "user" ? "你" : message.role === "system" ? "系统" : "Agent"));
  meta.append(element("span", "", message.status === "running" ? "进行中" : message.createdAt || ""));
  card.append(meta);
  if (message.content) card.append(element("p", "message-content", message.content));
  if (message.sourceCount || message.referenceCount) {
    const parts = [];
    if (message.sourceCount) parts.push(`${message.sourceCount} 张原图`);
    if (message.referenceCount) parts.push(`${message.referenceCount} 张参考图`);
    card.append(element("div", "attachment-summary", parts.join(" · ")));
  }
  if (message.toolTrace) card.append(toolCard(message.toolTrace));
  return card;
}

function renderFeed(messages) {
  const stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  const fragment = document.createDocumentFragment();
  if (!messages.length) {
    fragment.append(element("p", "empty-feed", "这是独立的 SparkAI WorkSpace Agent 窗口。主窗口仍然负责画布和任务状态，你可以在这里持续对话与控制图片任务。"));
  } else {
    for (const message of messages) fragment.append(messageCard(message));
  }
  feed.replaceChildren(fragment);
  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
}

function goalAvailable(goal) {
  const hash = String(goal?.snapshotHash || "");
  const validHash = goal?.active
    ? taskScopeSnapshotHashPattern.test(hash)
    : goalConfirmationHashPattern.test(hash);
  return Boolean(
    goal?.available &&
    Number(goal.containerCount) > 0 &&
    Number(goal.assetCount) > 0 &&
    Number(goal.operationsPerAsset) > 0 &&
    Number(goal.requestCount) === Number(goal.assetCount) * Number(goal.operationsPerAsset) &&
    validHash
  );
}

function goalUsageText() {
  return "不预估费用 · 完成后按上游返回值记录用量";
}

function renderGoalState(state) {
  const goal = state.goal || {};
  const activeGoal = Boolean(state.busy && goal.active);
  const available = goalAvailable(goal);
  if (state.busy && !wasBusy) selectedTaskMode = "standard";
  if (!state.busy && selectedTaskMode === "goal" && !available) selectedTaskMode = "standard";
  wasBusy = Boolean(state.busy);

  const goalSelected = !state.busy && selectedTaskMode === "goal";
  goalControls.hidden = Boolean(state.busy && !activeGoal);
  taskModeRow.hidden = Boolean(state.busy);
  goalSummary.hidden = !(goalSelected || activeGoal);
  standardModeButton.classList.toggle("active", selectedTaskMode === "standard");
  standardModeButton.setAttribute("aria-pressed", String(selectedTaskMode === "standard"));
  goalModeButton.classList.toggle("active", goalSelected || activeGoal);
  goalModeButton.setAttribute("aria-pressed", String(goalSelected || activeGoal));
  goalModeButton.disabled = !state.ready || !available || state.busy;
  document.getElementById("goal-availability").textContent = available
    ? `${goal.containerCount} 个容器 · ${goal.assetCount} 张图 · 最多 ${goal.requestCount} 次请求`
    : "画布暂无可执行图片容器";
  document.getElementById("goal-summary-title").textContent = activeGoal ? "Goal 运行中" : "全部图片容器";
  document.getElementById("goal-counts").textContent = `${Number(goal.containerCount) || 0} 个容器 · ${Number(goal.assetCount) || 0} 张图 · 每图 ${Number(goal.operationsPerAsset) || 0} 项 · 最多 ${Number(goal.requestCount) || 0} 次请求${goal.skippedContainerCount ? ` · 跳过 ${goal.skippedContainerCount}` : ""}`;
  const hash = String(goal.snapshotHash || "");
  const hashElement = document.getElementById("goal-hash");
  hashElement.textContent = hash ? "本次来源范围已确认" : "等待来源范围";
  hashElement.title = "";
  document.getElementById("goal-probe").textContent = `Main 串行准入 · 先探测 ${Number(goal.probeContainerCount) || 0} 个 · 通过后最高 ${Number(goal.concurrencyCap) || 0} 并发`;
  document.getElementById("goal-usage").textContent = goalUsageText();
  document.getElementById("goal-warning").textContent = String(goal.warning || "用量与费用只采用上游完成后实际返回的数据。");
  document.documentElement.dataset.taskMode = activeGoal || goalSelected ? "goal" : "standard";
  return { activeGoal, available, goalSelected };
}

function goalConfirmationText(goal) {
  return [
    `确认对当前 ${goal.containerCount} 个图片容器（${goal.assetCount} 张图，每图 ${goal.operationsPerAsset} 项，最多 ${goal.requestCount} 次请求）执行 Goal？`,
    `多个窗口共享 Main 准入容量；先探测 ${goal.probeContainerCount} 个容器，等待探测时暂停其他 Goal 新放量；全部请求、资产落盘和结果校验成功后，才公平共享最高 ${goal.concurrencyCap} 并发。`,
    goalUsageText(),
    String(goal.warning || "用量与费用只采用上游完成后实际返回的数据。")
  ].join("\n\n");
}

function render() {
  renderFrame = 0;
  const state = currentState;
  if (!state) return;
  applyGlassAppearance(state);
  document.getElementById("project-name").textContent = [state.projectName || "项目", state.workspaceDomain?.title].filter(Boolean).join(" · ");
  document.getElementById("status-text").textContent = state.ready ? state.statusText : "主窗口尚未就绪";
  document.getElementById("model-name").textContent = state.modelName || "";
  document.getElementById("source-count").textContent = String(state.sourceImageCount || 0);
  document.getElementById("reference-count").textContent = String(state.referenceImageCount || 0);
  document.getElementById("selected-count").textContent = String(state.selectedArtifactCount || 0);
  const stopPending = Boolean(state.stopPending);
  statusSurface.classList.toggle("busy", Boolean(state.busy));
  statusSurface.classList.toggle("paused", Boolean(state.paused));
  statusSurface.classList.toggle("stop-pending", stopPending);
  statusSurface.classList.toggle("error", /问题|失败|error/i.test(state.statusText || ""));
  const { activeGoal, available: goalIsAvailable, goalSelected } = renderGoalState(state);

  const activeElement = document.activeElement;
  if (activeElement !== promptInput || promptInput.value === promptInput.dataset.lastPublished) {
    promptInput.value = state.prompt || "";
    promptInput.dataset.lastPublished = state.prompt || "";
  }
  promptInput.disabled = !state.ready || stopPending;
  sendButton.disabled = !state.ready || stopPending || !promptInput.value.trim() || (!state.busy && goalSelected && !goalIsAvailable);
  sendButton.textContent = state.busy ? "修改" : "发送";
  sendButton.classList.toggle("steer", Boolean(state.busy));
  pauseButton.hidden = !state.busy;
  pauseButton.disabled = stopPending;
  pauseButton.textContent = state.paused ? "恢复" : "暂停";
  stopButton.hidden = !state.busy;
  stopButton.disabled = stopPending;
  stopButton.textContent = stopPending ? "正在结束" : "结束";
  steerModeField.hidden = !state.busy || activeGoal;
  goalSteerLock.hidden = !activeGoal;
  steerMode.disabled = !state.ready || !state.busy || activeGoal || stopPending;
  if (!state.busy) steerMode.value = "auto";
  promptInput.placeholder = state.busy
    ? activeGoal ? "修改 Goal 的处理要求，当前来源范围保持不变…" : "输入修改要求，Agent 会停止旧计划并重新规划…"
    : goalSelected ? "描述要对画布全部图片容器执行的操作…" : "告诉 Agent 你想完成什么…";
  editSourcesButton.disabled = activeGoal || goalSelected || stopPending;
  editReferencesButton.disabled = activeGoal || goalSelected || stopPending;

  const previousConversation = conversationSelect.value;
  conversationSelect.replaceChildren();
  for (const conversation of state.conversations || []) {
    const option = document.createElement("option");
    option.value = conversation.id;
    option.textContent = conversation.title || "未命名会话";
    option.selected = conversation.active;
    conversationSelect.append(option);
  }
  if (previousConversation && Array.from(conversationSelect.options).some((item) => item.value === previousConversation)) {
    conversationSelect.value = state.activeConversationId || previousConversation;
  }
  conversationSelect.disabled = state.busy || !state.ready;
  document.getElementById("new-conversation").disabled = !state.ready || stopPending;
  document.getElementById("clear-conversation").disabled = state.busy || !state.ready;
  renderFeed(Array.isArray(state.messages) ? state.messages : []);
}

function scheduleRender(state) {
  currentState = state;
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(render);
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentState?.ready || currentState.stopPending) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  if (promptTimer) {
    window.clearTimeout(promptTimer);
    promptTimer = 0;
  }
  promptInput.dataset.lastPublished = promptInput.value;
  const activeGoal = Boolean(currentState.busy && currentState.goal?.active);
  if (!currentState.busy && selectedTaskMode === "goal") {
    const goal = currentState.goal;
    if (!goalAvailable(goal)) {
      window.alert("Goal 范围已失效，请等待主窗口重新同步后再试。");
      return;
    }
    if (!window.confirm(goalConfirmationText(goal))) return;
    command({
      type: "send",
      prompt,
      taskScopeMode: "auto",
      taskMode: "goal",
      goalConfirmed: true,
      expectedSnapshotHash: goal.snapshotHash
    });
  } else if (activeGoal) {
    command({ type: "send", prompt, taskScopeMode: "keep" });
  } else {
    command({ type: "send", prompt, taskScopeMode: currentState.busy ? steerMode.value : "auto" });
  }
  if (currentState.busy) steerMode.value = "auto";
});

pauseButton.addEventListener("click", () => {
  if (!currentState?.busy || currentState.stopPending) return;
  if (currentState.paused) {
    command({ type: "resume" });
    return;
  }
  if (confirm("暂停当前任务？已经发出的请求会完成，但不会派发下一批。")) {
    command({ type: "pause-confirmed" });
  }
});

stopButton.addEventListener("click", () => {
  if (!currentState?.busy || currentState.stopPending) return;
  if (confirm("结束当前任务？这会取消正在进行的思考、生图请求和尚未开始的批次。")) {
    command({ type: "stop-confirmed" });
  }
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

promptInput.addEventListener("input", () => {
  sendButton.disabled = !currentState?.ready || currentState?.stopPending || !promptInput.value.trim() || (
    !currentState?.busy && selectedTaskMode === "goal" && !goalAvailable(currentState?.goal)
  );
  if (promptTimer) window.clearTimeout(promptTimer);
  promptTimer = window.setTimeout(() => {
    promptInput.dataset.lastPublished = promptInput.value;
    command({ type: "set-prompt", prompt: promptInput.value });
  }, 120);
});

conversationSelect.addEventListener("change", () => {
  if (conversationSelect.value) command({ type: "switch-conversation", conversationId: conversationSelect.value });
});

dockSelect.addEventListener("change", () => {
  const placement = dockSelect.value;
  dockSelect.value = "";
  if (placement) command({ type: "dock", placement });
});

document.getElementById("new-conversation").addEventListener("click", () => {
  if (confirm("开始新的 Agent 会话？当前会话会保留在项目历史中。")) command({ type: "new-conversation-confirmed" });
});
document.getElementById("clear-conversation").addEventListener("click", () => {
  if (confirm("清空当前聊天、上下文摘要和绘画经验？此操作无法撤销。")) command({ type: "clear-conversation-confirmed" });
});
document.getElementById("edit-sources").addEventListener("click", () => command({ type: "edit-sources" }));
document.getElementById("edit-references").addEventListener("click", () => command({ type: "edit-references" }));
document.getElementById("edit-memory").addEventListener("click", () => command({ type: "edit-memory" }));
standardModeButton.addEventListener("click", () => {
  if (currentState?.busy) return;
  selectedTaskMode = "standard";
  scheduleRender(currentState);
});
goalModeButton.addEventListener("click", () => {
  if (currentState?.busy || !goalAvailable(currentState?.goal)) return;
  selectedTaskMode = "goal";
  scheduleRender(currentState);
});

bridge?.onState?.((state) => scheduleRender(state));
bridge?.ready?.();
