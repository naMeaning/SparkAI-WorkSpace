"use strict";

const bridge = window.naimageAgentWindowSurface;
const feed = document.getElementById("agent-feed");
const promptInput = document.getElementById("agent-prompt");
const composer = document.getElementById("agent-composer");
const sendButton = document.getElementById("send-button");
const conversationSelect = document.getElementById("conversation-select");
const dockSelect = document.getElementById("dock-select");
const statusSurface = document.querySelector(".agent-status");
let currentState = null;
let renderFrame = 0;
let promptTimer = 0;

function command(payload) {
  bridge?.command?.(payload);
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
    fragment.append(element("p", "empty-feed", "这是独立的 naimage Agent 窗口。主窗口仍然负责画布和任务状态，你可以在这里持续对话与控制图片任务。"));
  } else {
    for (const message of messages) fragment.append(messageCard(message));
  }
  feed.replaceChildren(fragment);
  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
}

function render() {
  renderFrame = 0;
  const state = currentState;
  if (!state) return;
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
  document.getElementById("project-name").textContent = state.projectName || "项目";
  document.getElementById("status-text").textContent = state.ready ? state.statusText : "主窗口尚未就绪";
  document.getElementById("model-name").textContent = state.modelName || "";
  document.getElementById("source-count").textContent = String(state.sourceImageCount || 0);
  document.getElementById("reference-count").textContent = String(state.referenceImageCount || 0);
  document.getElementById("selected-count").textContent = String(state.selectedArtifactCount || 0);
  statusSurface.classList.toggle("busy", Boolean(state.busy));
  statusSurface.classList.toggle("error", /问题|失败|error/i.test(state.statusText || ""));

  const activeElement = document.activeElement;
  if (activeElement !== promptInput || promptInput.value === promptInput.dataset.lastPublished) {
    promptInput.value = state.prompt || "";
    promptInput.dataset.lastPublished = state.prompt || "";
  }
  promptInput.disabled = !state.ready;
  sendButton.disabled = !state.ready || (!state.busy && !promptInput.value.trim());
  sendButton.textContent = state.busy ? "停止" : "发送";
  sendButton.classList.toggle("stop", Boolean(state.busy));

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
  document.getElementById("new-conversation").disabled = state.busy || !state.ready;
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
  if (!currentState?.ready) return;
  if (currentState.busy) {
    command({ type: "stop" });
    return;
  }
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  if (promptTimer) {
    window.clearTimeout(promptTimer);
    promptTimer = 0;
  }
  promptInput.dataset.lastPublished = promptInput.value;
  command({ type: "send", prompt });
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

promptInput.addEventListener("input", () => {
  sendButton.disabled = !currentState?.ready || (!currentState?.busy && !promptInput.value.trim());
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

bridge?.onState?.((state) => scheduleRender(state));
bridge?.ready?.();
