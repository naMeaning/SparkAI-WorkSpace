export function createGuiStateReader({ evaluate, workbenchMinWidth }) {
  return function readGuiStateWithDependencies(client) {
    return readGuiState(client, { evaluate, workbenchMinWidth });
  };
}

export async function readGuiState(client, { evaluate, workbenchMinWidth }) {
  return evaluate(client, `(async () => {
    const element = (selector) => document.querySelector(selector);
    const text = (selector) => String(element(selector)?.textContent || "").replace(/\\s+/g, " ").trim();
    const rect = (selector) => element(selector)?.getBoundingClientRect();
    const visible = (selector) => {
      const node = element(selector);
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const visibilityMetric = (node, containerRect) => {
      if (!node || !containerRect) return { ok: false, visibleRatio: 0, gaps: null };
      const box = node.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(box.right, containerRect.right) - Math.max(box.left, containerRect.left));
      const visibleHeight = Math.max(0, Math.min(box.bottom, containerRect.bottom) - Math.max(box.top, containerRect.top));
      const visibleRatio = Math.round((visibleWidth * visibleHeight / Math.max(1, box.width * box.height)) * 1000) / 1000;
      const gaps = {
        left: Math.round(box.left - containerRect.left),
        right: Math.round(containerRect.right - box.right),
        top: Math.round(box.top - containerRect.top),
        bottom: Math.round(containerRect.bottom - box.bottom)
      };
      return {
        ok: visibleRatio >= 0.96 && gaps.left >= 6 && gaps.right >= 6 && gaps.top >= 6 && gaps.bottom >= 6,
        visibleRatio,
        gaps
      };
    };
    const metricRound = (value) => Math.round(Number(value || 0) * 1000) / 1000;
    const cssTimeMs = (value) => String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((max, part) => {
        const number = parseFloat(part);
        if (!Number.isFinite(number)) return max;
        const ms = part.endsWith("ms") ? number : number * 1000;
        return Math.max(max, ms);
      }, 0);
    const motionMetric = (node) => {
      if (!node) return { present: false, transitionMs: 0, transitionProperty: "", animationName: "none", animationMs: 0, hasTransition: false, hasAnimation: false };
      const style = getComputedStyle(node);
      const transitionMs = Math.round(Math.max(cssTimeMs(style.transitionDuration), cssTimeMs(style.transitionDelay)));
      const animationMs = Math.round(Math.max(cssTimeMs(style.animationDuration), cssTimeMs(style.animationDelay)));
      const animationName = String(style.animationName || "none");
      const transitionProperty = String(style.transitionProperty || "");
      return {
        present: true,
        transitionMs,
        transitionProperty,
        animationName,
        animationMs,
        hasTransition: transitionMs >= 100 && transitionProperty !== "none",
        hasAnimation: animationMs >= 100 && animationName !== "none"
      };
    };
    const focusStabilityMetric = (node) => {
      if (!node || typeof node.focus !== "function") return { ok: true, present: false, widthDelta: 0, heightDelta: 0 };
      const before = node.getBoundingClientRect();
      node.focus({ preventScroll: true });
      const after = node.getBoundingClientRect();
      if (typeof node.blur === "function") node.blur();
      const widthDelta = metricRound(Math.abs(after.width - before.width));
      const heightDelta = metricRound(Math.abs(after.height - before.height));
      return { ok: widthDelta <= 1 && heightDelta <= 1, present: true, widthDelta, heightDelta };
    };
    const rectArea = (box) => Math.max(0, Number(box?.width || 0)) * Math.max(0, Number(box?.height || 0));
    const intersectRect = (a, b) => {
      if (!a || !b) return null;
      const left = Math.max(a.left, b.left);
      const top = Math.max(a.top, b.top);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const plainRect = (box) => box ? ({
      left: metricRound(box.left),
      top: metricRound(box.top),
      right: metricRound(box.right),
      bottom: metricRound(box.bottom),
      width: metricRound(box.width),
      height: metricRound(box.height)
    }) : null;
    const visualStyle = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: metricRound(parseFloat(style.opacity || "1")),
        pointerEvents: style.pointerEvents,
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clipPath: style.clipPath,
        filter: style.filter,
        isolation: style.isolation,
        mixBlendMode: style.mixBlendMode,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
        color: style.color
      };
    };
    const hitStackAt = (clientX, clientY) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) return [];
      return document.elementsFromPoint(clientX, clientY).slice(0, 10).map((node) => ({
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        className: typeof node.className === "string" ? node.className : "",
        nodeId: node.closest?.(".flow-node")?.getAttribute("data-node-id") || "",
        assetIndex: node.closest?.("[data-asset-index]")?.getAttribute("data-asset-index") || ""
      }));
    };
    const mainRect = rect(".ide-main");
    const canvasRect = rect(".workflow-canvas");
    const canvasPanelRect = rect(".canvas-panel");
    const canvasSelectionIndicatorNode = element(".canvas-selection-indicator");
    const canvasSelectionIndicatorRect = canvasSelectionIndicatorNode?.getBoundingClientRect?.() || null;
    const canvasSelectionIndicatorStyle = canvasSelectionIndicatorNode ? getComputedStyle(canvasSelectionIndicatorNode) : null;
    const canvasSelectionIndicatorTitleNode = canvasSelectionIndicatorNode?.querySelector(".canvas-selection-indicator-copy strong") || null;
    const canvasSelectionIndicatorTitleRect = canvasSelectionIndicatorTitleNode?.getBoundingClientRect?.() || null;
    const canvasSelectionIndicatorTitleStyle = canvasSelectionIndicatorTitleNode ? getComputedStyle(canvasSelectionIndicatorTitleNode) : null;
    const canvasSelectionIndicatorDetailNode = canvasSelectionIndicatorNode?.querySelector(".canvas-selection-indicator-copy small") || null;
    const topbarRect = rect(".ide-topbar");
    const shellRect = rect(".ide-shell");
    const mainNode = element(".ide-main");
    const topbarNode = element(".ide-topbar");
    const shellNode = element(".ide-shell");
    const canvasOnlyMain = Boolean(element(".ide-main.canvas-only"));
    const agentRect = rect(".project-agent-panel");
    const legacyAgentPanelMounted = Boolean(element(".agent-panel"));
    const legacyAgentCanvasNodeMounted = Array.from(document.querySelectorAll(".flow-node")).some((node) => node.classList.contains("agent"));
    const agentSurfaceRect = agentRect;
    const projectAgentContextNode = element(".project-agent-composer-context");
    const projectAgentContextRect = projectAgentContextNode?.getBoundingClientRect?.() || null;
    const projectAgentContextStyle = projectAgentContextNode ? getComputedStyle(projectAgentContextNode) : null;
    const projectAgentContextPrefixNode = projectAgentContextNode?.querySelector(":scope > span") || null;
    const projectAgentContextPrefixRect = projectAgentContextPrefixNode?.getBoundingClientRect?.() || null;
    const projectAgentContextPrefixStyle = projectAgentContextPrefixNode ? getComputedStyle(projectAgentContextPrefixNode) : null;
    const projectAgentContextValueNode = projectAgentContextNode?.querySelector(":scope > strong") || null;
    const projectAgentContextValueRect = projectAgentContextValueNode?.getBoundingClientRect?.() || null;
    const projectAgentContextValueStyle = projectAgentContextValueNode ? getComputedStyle(projectAgentContextValueNode) : null;
    const projectAgentContextClearNode = projectAgentContextNode?.querySelector(":scope > button") || null;
    const projectAgentContextClearRect = projectAgentContextClearNode?.getBoundingClientRect?.() || null;
    const inspectorRect = rect(".node-inspector");
    const inspectorHeadNode = element(".node-inspector-head");
    const inspectorHeadRect = rect(".node-inspector-head");
    const inspectorEyebrowNode = element(".node-inspector-head .eyebrow");
    const inspectorTitleNode = element(".node-inspector-head strong");
    const inspectorTitleRect = rect(".node-inspector-head strong");
    const projectActionsRect = rect(".project-actions");
    const ideActionsRect = rect(".ide-actions");
    const windowControlsRect = rect(".window-controls");
    const canvasToolbarRect = rect(".canvas-toolbar");
    const canvasFooterRect = rect(".canvas-footer");
    const canvasStatusRect = rect(".canvas-status-line");
    const canvasToolsRect = rect(".canvas-footer .canvas-tools");
    const canvasZoomButtonRect = rect(".canvas-footer .zoom-button");
    const projectMenuRect = rect(".project-menu-popover:not(.file-command-popover)");
    const fileMenuRect = rect(".file-command-popover");
    const rightCollapseRect = rect(".agent-collapse-button");
    const collapsedAgentRailRect = rect(".project-agent-collapsed-rail");
    const imageGenTraceRect = rect(".agent-message.running .agent-tool-trace");
    const imageGenTraceTitleRect = rect(".agent-message.running .agent-tool-trace-title");
    const imageGenTraceBriefRect = rect(".agent-message.running .agent-tool-brief-outside");
    const imageGenTimerRect = rect(".agent-message.running .agent-tool-imagegen-timer");
    const composerModelButton = element(".composer-model-chip");
    const composerModelRect = rect(".composer-model-chip");
    const composerToolButton = element(".composer-tool-button");
    const composerToolRect = rect(".composer-tool-button");
    const sendButton = element(".send-button, .project-agent-send, .project-agent-composer .primary-wide, .project-agent-composer .danger-secondary");
    const sendButtonRect = rect(".send-button, .project-agent-send, .project-agent-composer .primary-wide, .project-agent-composer .danger-secondary");
    const supplementButton = element(".send-supplement-button");
    const supplementButtonRect = rect(".send-supplement-button");
    const referenceStripNode = element(".agent-reference-strip");
    const referenceStripRect = rect(".agent-reference-strip");
    const referenceRemoveButton = element(".agent-reference-strip span > button");
    const referenceRemoveButtonRect = rect(".agent-reference-strip span > button");
    const agentStatusNode = element(".agent-status");
    const agentStatusRect = rect(".agent-status");
    const canvasDynamicStatusPattern = /正在(?:生图|生成|运行|处理|绘图|工作|思考|输出|请求)|生成中|运行中|处理中|绘图中|请求模型/i;
    const canvasDynamicStatusTexts = Array.from(document.querySelectorAll(
      ".flow-node .node-state, .flow-node .node-image-progress, .flow-node .node-image-preview, .canvas-status-line, .node-inspector"
    ))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && !node.closest(".project-agent-panel");
      })
      .map((node) => String(node.textContent || "").replace(/\\s+/g, " ").trim())
      .filter((text) => text && canvasDynamicStatusPattern.test(text));
    const canvasExecutionChrome = Array.from(document.querySelectorAll(
      '.flow-node[data-image-run-state="placeholder"].active-build, ' +
      '.flow-node[data-image-run-state="placeholder"] .spin, ' +
      '.flow-node[data-image-run-state="placeholder"] .is-generating'
    ))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && !node.closest(".project-agent-panel");
      })
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        className: String(node.className || ""),
        nodeId: node.closest(".flow-node")?.getAttribute("data-node-id") || ""
      }));
    const runningMessageNode = element(".agent-message.running .agent-message-node");
    const runningMessageRect = rect(".agent-message.running");
    const runningDotRect = rect(".agent-message.running .agent-message-node");
    const composerTextareaRect = rect(".agent-composer textarea, .project-agent-composer textarea");
    const composerTextarea = element(".agent-composer textarea, .project-agent-composer textarea");
    const composerInputRect = rect(".composer-input, .project-agent-composer");
    const composerRect = rect(".agent-composer, .project-agent-composer");
    const composerToolbarRect = rect(".composer-toolbar, .project-agent-composer footer");
    const agentFeedNode = element(".agent-feed, .project-agent-feed");
    const agentFeedRect = rect(".agent-feed, .project-agent-feed");
    const agentMessageItems = Array.from(document.querySelectorAll(".agent-message"));
    const lastAgentMessage = agentMessageItems[agentMessageItems.length - 1] || null;
    const lastAgentMessageRect = lastAgentMessage?.getBoundingClientRect() || null;
    const composerPopoverRect = rect(".composer-model-popover");
    const composerPopoverStyle = getComputedStyle(element(".composer-model-popover") || document.body);
    const settingListStyle = getComputedStyle(element(".settings-model-section") || document.body);
    const settingConfigRowRect = rect(".settings-model-card");
    const avatarRect = rect(".account-avatar-button");
    const avatarRadius = parseFloat(getComputedStyle(element(".account-avatar-button") || document.body).borderTopLeftRadius || "0");
    const drawerRect = rect(".settings-drawer:not(.account-drawer), .account-drawer");
    const settingsDrawerRect = rect(".settings-drawer:not(.account-drawer)");
    const accountDrawerRect = rect(".account-drawer");
    const settingsHeaderRect = rect(".settings-drawer:not(.account-drawer) > .ui-surface-header");
    const accountHeaderRect = rect(".account-drawer > .ui-surface-header");
    const settingsHeaderTitleRect = rect(".settings-drawer:not(.account-drawer) > .ui-surface-header h2");
    const accountHeaderTitleRect = rect(".account-drawer > .ui-surface-header h2");
    const settingsSectionHeadRect = rect(".settings-drawer:not(.account-drawer) .settings-section-header");
    const settingsSectionTitleBlockRect = rect(".settings-drawer:not(.account-drawer) .settings-section-header h3");
    const settingsPromptActionRect = rect(".settings-drawer:not(.account-drawer) .settings-prompt-action");
    const modelFetchButtonRect = rect(".settings-drawer:not(.account-drawer) .settings-refresh-action");
    const modelFetchButtonText = text(".settings-drawer:not(.account-drawer) .settings-refresh-action");
    const settingsHeaderTitleText = text(".settings-drawer:not(.account-drawer) > .ui-surface-header h2");
    const settingsHeaderSubtitleText = text(".settings-drawer:not(.account-drawer) > .ui-surface-header .ui-surface-description");
    const settingsSectionEyebrowText = text(".settings-drawer:not(.account-drawer) .settings-section-header .ui-surface-eyebrow");
    const settingsSectionTitleText = text(".settings-drawer:not(.account-drawer) .settings-section-header h3, .settings-drawer:not(.account-drawer) .settings-appearance-title");
    const settingsActiveTabText = text(".settings-drawer:not(.account-drawer) .settings-section-tab[aria-pressed='true']");
    const settingsSaveButtonText = text(".settings-drawer:not(.account-drawer) .settings-surface-footer .ui-action-primary");
    const settingsRestoreButtonText = text(".settings-drawer:not(.account-drawer) .settings-surface-footer .ui-surface-footer-leading .ui-action-button");
    const settingsUpdateHeadingText = text(".settings-drawer:not(.account-drawer) .settings-update-section h3");
    const settingsUpdateCardRect = rect(".settings-drawer:not(.account-drawer) .settings-update-card");
    const settingsUpdateActionText = text(".settings-drawer:not(.account-drawer) .settings-update-card .ui-action-primary");
    const settingsUpdateSecurityText = text(".settings-drawer:not(.account-drawer) .settings-update-security");
    const settingsThemeModeButtons = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .theme-mode-options .theme-mode-option"));
    const settingsThemePaletteButtons = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .theme-palette-option"));
    const settingsThemeModeActiveCount = settingsThemeModeButtons.filter((node) => node.getAttribute("aria-pressed") === "true").length;
    const settingsThemePaletteActiveCount = settingsThemePaletteButtons.filter((node) => node.getAttribute("aria-pressed") === "true").length;
    const settingsSurfaceBody = element(".settings-drawer:not(.account-drawer) .settings-surface-body");
    const settingsSurfaceBodyRect = settingsSurfaceBody?.getBoundingClientRect();
    const settingsCustomThemeEditor = element(".settings-drawer:not(.account-drawer) .theme-custom-editor");
    const settingsCustomThemeColorInputs = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .theme-custom-color-control input[type='color']"));
    const settingsCustomThemeModeButtons = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .theme-custom-mode .ui-segment-action"));
    const settingsCustomThemeActionButtons = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .theme-custom-actions button"));
    const settingsCustomThemeActionTexts = settingsCustomThemeActionButtons.map((node) => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    const settingsCustomThemeActionsRect = rect(".settings-drawer:not(.account-drawer) .theme-custom-actions");
    const settingsContextStrategySelect = element(".settings-drawer:not(.account-drawer) .settings-context-policy select");
    const settingsContextStrategyValues = Array.from(settingsContextStrategySelect?.querySelectorAll("option") || []).map((node) => String(node.value || ""));
    const settingsContextCustomInputs = Array.from(document.querySelectorAll(".settings-drawer:not(.account-drawer) .settings-context-custom-fields input[type='number']"));
    const accountProfileCardRect = rect(".account-drawer .account-profile");
    const accountProfileAvatarRect = rect(".account-drawer .account-surface-avatar");
    const accountProfileStatusText = text(".account-drawer .account-status");
    const walletCardRect = rect(".account-drawer .account-balance-grid");
    const walletCardItemRects = Array.from(document.querySelectorAll(".account-drawer .account-balance-grid > div"))
      .slice(0, 3)
      .map((node) => node.getBoundingClientRect());
    const usageLogListRect = rect(".account-drawer .account-usage-list");
    const usageLogArticleRects = Array.from(document.querySelectorAll(".account-drawer .account-usage-list article"))
      .slice(0, 4)
      .map((node) => node.getBoundingClientRect());
    const usageLogTexts = Array.from(document.querySelectorAll(".account-drawer .account-usage-list article"))
      .slice(0, 4)
      .map((node) => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    const accountActionButtons = Array.from(document.querySelectorAll(".account-drawer .account-primary-actions .ui-action-button"));
    const accountActionButtonMetrics = accountActionButtons.map((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        text: String(node.textContent || "").replace(/\\s+/g, " ").trim(),
        iconCount: node.querySelectorAll("svg").length,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        radius: parseFloat(style.borderTopLeftRadius || "0"),
        background: style.backgroundColor || "",
        color: style.color || ""
      };
    });
    const walletCardStyle = getComputedStyle(element(".account-drawer .account-balance-grid") || document.body);
    const modelPickerRect = rect(".model-picker-dialog");
    const modelPickerHeadRect = rect(".model-picker-head");
    const modelPickerToolbarRect = rect(".model-picker-toolbar");
    const modelPickerListNode = element(".model-picker-list");
    const modelPickerListRect = rect(".model-picker-list");
    const modelPickerActionsRect = rect(".model-picker-actions");
    const modelPickerCloseRect = rect(".model-picker-close");
    const modelPickerOptionNodes = Array.from(document.querySelectorAll(".model-picker-option"));
    const optionText = (node, selector) => String(node?.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
    const gpt56Option = modelPickerOptionNodes.find((node) => /^gpt-5\.6(?:$|-)/i.test(optionText(node, "strong"))) || null;
    const gpt55Option = modelPickerOptionNodes.find((node) => optionText(node, "strong") === "gpt-5.5") || null;
    const gpt55MetaText = gpt55Option ? optionText(gpt55Option, "small") : "";
    const modelPickerListStyle = getComputedStyle(modelPickerListNode || document.body);
    const modelCacheProbe = window.__naimageModelCacheProbe || {};
    const agentToolsProbe = window.__naimageAgentToolsProbe || {};
    const publicAgentToolNames = Array.isArray(agentToolsProbe.tools)
      ? agentToolsProbe.tools.map((tool) => String(tool?.function?.name || tool?.name || (tool?.type === "web_search" ? "web_search" : ""))).filter(Boolean)
      : [];
    const publicImageTool = Array.isArray(agentToolsProbe.tools)
      ? agentToolsProbe.tools.find((tool) => String(tool?.function?.name || "") === "image_gen")
      : null;
    const publicImageOperations = Array.isArray(publicImageTool?.function?.parameters?.properties?.operation?.enum)
      ? publicImageTool.function.parameters.properties.operation.enum.map(String)
      : [];
    const requiredPublicAgentTools = ["image_gen", "shell_command", "view_image", "web_search", "ask_user", "experience", "workflow"];
    const publicAgentToolSchemaOk = Boolean(
      agentToolsProbe.ok &&
      requiredPublicAgentTools.every((name) => publicAgentToolNames.includes(name)) &&
      !["memory", "context_manage"].some((name) => publicAgentToolNames.includes(name)) &&
      ["generate", "edit", "replace", "variants", "layers", "cutout", "redraw"].every((operation) => publicImageOperations.includes(operation))
    );
    const modelPickerScrollProbe = window.__naimageModelPickerScrollProbe || {};
    const activeDialogRect = rect(".ui-surface[data-ui-surface]");
    const withinViewport = (box, pad = 1) => !box || (box.left >= -pad && box.top >= -pad && box.right <= window.innerWidth + pad && box.bottom <= window.innerHeight + pad);
    const dialogLayoutSpecs = [
      { kind: "agent-prompt", selector: '.agent-text-editor-dialog[aria-label="编辑 Agent 提示词"]', body: ".agent-text-editor-body" },
      { kind: "fast-memory", selector: '.agent-text-editor-dialog[aria-label="编辑 Agent 记忆"]', body: ".agent-text-editor-body" },
      { kind: "model-picker", selector: ".model-picker-dialog", body: ".model-picker-list" },
      { kind: "ai-redraw", selector: '.region-redraw-dialog[aria-label="AI 重绘"]', body: ".region-redraw-body" },
      { kind: "ai-cutout", selector: '.region-redraw-dialog[aria-label="AI 抠图"]', body: ".region-redraw-body" },
      { kind: "node-editor", selector: ".node-editor-dialog", body: ".unified-node-editor-body" },
      { kind: "image-viewer", selector: ".image-viewer", body: ".image-viewer-body" },
      { kind: "ask-user", selector: ".ask-user-dialog", body: ".ask-user-body" },
      { kind: "reference-picker", selector: ".reference-picker-dialog", body: ".reference-grid" },
      { kind: "manual-image-task", selector: ".manual-image-task-dialog", body: ".manual-image-task-body" },
      { kind: "requirement-editor", selector: ".requirement-editor-dialog", body: ".requirement-editor-body" },
      { kind: "layer-viewer", selector: ".layer-group-viewer", body: ".layer-group-viewer-body" }
    ];
    const activeDialogSpec = dialogLayoutSpecs.find((spec) => element(spec.selector));
    const activeLayoutDialog = activeDialogSpec ? element(activeDialogSpec.selector) : null;
    const activeLayoutDialogRect = activeLayoutDialog?.getBoundingClientRect?.() || null;
    const activeLayoutHeader = activeLayoutDialog?.querySelector(":scope > header") || null;
    const activeLayoutFooter = activeLayoutDialog?.querySelector(":scope > footer") || null;
    const activeLayoutHeaderRect = activeLayoutHeader?.getBoundingClientRect?.() || null;
    const activeLayoutFooterRect = activeLayoutFooter?.getBoundingClientRect?.() || null;
    const activeLayoutBody = activeDialogSpec ? activeLayoutDialog?.querySelector(activeDialogSpec.body) || null : null;
    const activeLayoutBodyRect = activeLayoutBody?.getBoundingClientRect?.() || null;
    const activeLayoutMiddleRects = activeLayoutDialog
      ? Array.from(activeLayoutDialog.children)
          .filter((node) => node !== activeLayoutHeader && node !== activeLayoutFooter && node instanceof HTMLElement && getComputedStyle(node).display !== "none")
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
      : [];
    const activeLayoutMiddleTop = activeLayoutMiddleRects.length ? Math.min(...activeLayoutMiddleRects.map((box) => box.top)) : 0;
    const activeLayoutMiddleBottom = activeLayoutMiddleRects.length ? Math.max(...activeLayoutMiddleRects.map((box) => box.bottom)) : 0;
    const activeLayoutAvailableMiddleHeight = activeLayoutHeaderRect && activeLayoutFooterRect
      ? Math.max(0, activeLayoutFooterRect.top - activeLayoutHeaderRect.bottom)
      : 0;
    const activeLayoutMiddleFillRatio = activeLayoutAvailableMiddleHeight > 0
      ? (activeLayoutMiddleBottom - activeLayoutMiddleTop) / activeLayoutAvailableMiddleHeight
      : 0;
    const activeLayoutBodyChildren = activeLayoutBody
      ? Array.from(activeLayoutBody.children)
          .filter((node) => node instanceof HTMLElement && getComputedStyle(node).display !== "none")
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
      : [];
    const activeLayoutBodyStyle = activeLayoutBody ? getComputedStyle(activeLayoutBody) : null;
    const activeLayoutBodyScrolls = Boolean(
      activeLayoutBody && activeLayoutBodyStyle && /auto|scroll/.test(activeLayoutBodyStyle.overflowY || "") &&
      activeLayoutBody.scrollHeight > activeLayoutBody.clientHeight + 2
    );
    const activeLayoutBottomBlank = activeLayoutBodyRect && activeLayoutBodyChildren.length && !activeLayoutBodyScrolls
      ? Math.max(0, activeLayoutBodyRect.bottom - Math.max(...activeLayoutBodyChildren.map((box) => box.bottom)))
      : 0;
    const activeLayoutRightBlank = activeLayoutBodyRect && activeLayoutBodyChildren.length && !activeLayoutBodyScrolls
      ? Math.max(0, activeLayoutBodyRect.right - Math.max(...activeLayoutBodyChildren.map((box) => box.right)))
      : 0;
    const activeLayoutTextareas = activeLayoutDialog ? Array.from(activeLayoutDialog.querySelectorAll("textarea")) : [];
    const activeLayoutTextareaMetrics = activeLayoutTextareas.map((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        width: metricRound(box.width),
        height: metricRound(box.height),
        area: metricRound(box.width * box.height),
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: style.overflowY,
        fillsBodyHeightRatio: activeLayoutBodyRect ? metricRound(box.height / Math.max(1, activeLayoutBodyRect.height)) : 0
      };
    });
    const activeLayoutScrollables = activeLayoutDialog
      ? Array.from(activeLayoutDialog.querySelectorAll("*"))
          .filter((node) => {
            const style = getComputedStyle(node);
            return node instanceof HTMLElement && /auto|scroll/.test(style.overflowY || "") && node.scrollHeight > node.clientHeight + 2;
          })
      : [];
    const activeLayoutNestedScrollConflicts = activeLayoutScrollables.flatMap((outer, outerIndex) =>
      activeLayoutScrollables.slice(outerIndex + 1).filter((inner) => outer.contains(inner) || inner.contains(outer)).map((inner) => ({
        outer: String(outer.className || outer.tagName),
        inner: String(inner.className || inner.tagName)
      }))
    );
    const dialogLayoutMetrics = activeLayoutDialogRect ? {
      kind: activeDialogSpec?.kind || "unknown",
      dialog: plainRect(activeLayoutDialogRect),
      header: plainRect(activeLayoutHeaderRect),
      body: plainRect(activeLayoutBodyRect),
      footer: plainRect(activeLayoutFooterRect),
      middleCount: activeLayoutMiddleRects.length,
      middleFillRatio: metricRound(activeLayoutMiddleFillRatio),
      bottomBlank: metricRound(activeLayoutBottomBlank),
      rightBlank: metricRound(activeLayoutRightBlank),
      bodyClientHeight: activeLayoutBody?.clientHeight || 0,
      bodyScrollHeight: activeLayoutBody?.scrollHeight || 0,
      bodyOverflowY: activeLayoutBodyStyle?.overflowY || "",
      textareaMetrics: activeLayoutTextareaMetrics,
      scrollables: activeLayoutScrollables.map((node) => ({
        className: String(node.className || node.tagName),
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY
      })),
      nestedScrollConflicts: activeLayoutNestedScrollConflicts
    } : null;
    const dialogLayoutMiddleFillOk = !activeLayoutDialogRect || !activeLayoutHeaderRect || !activeLayoutFooterRect || activeLayoutMiddleFillRatio >= 0.94;
    const dialogLayoutNestedScrollOk = activeLayoutNestedScrollConflicts.length === 0;
    const uiControlVisible = (node) => {
      const box = node?.getBoundingClientRect?.();
      const style = node ? getComputedStyle(node) : null;
      return Boolean(box && style && box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden");
    };
    const uiControlMetric = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        className: String(node.className || ""),
        label: String(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "").replace(/\s+/g, " ").trim(),
        left: metricRound(box.left),
        top: metricRound(box.top),
        right: metricRound(box.right),
        bottom: metricRound(box.bottom),
        width: metricRound(box.width),
        height: metricRound(box.height),
        radius: metricRound(parseFloat(style.borderTopLeftRadius || "0")),
        borderWidth: metricRound(parseFloat(style.borderTopWidth || "0")),
        borderBottomWidth: metricRound(parseFloat(style.borderBottomWidth || "0")),
        choiceLayout: String(node.getAttribute("data-ui-choice-layout") || "")
      };
    };
    const visibleUiSurfaces = Array.from(document.querySelectorAll("[data-ui-surface]")).filter(uiControlVisible);
    const visibleUiButtons = Array.from(document.querySelectorAll("button")).filter(uiControlVisible);
    const uiBaseMissingMetrics = visibleUiButtons.filter((node) => !node.classList.contains("ui-button-base")).map(uiControlMetric);
    const uiSurfaceButtons = visibleUiSurfaces.flatMap((surface) => Array.from(surface.querySelectorAll("button"))).filter(uiControlVisible);
    const uiActionMetrics = uiSurfaceButtons.filter((node) => node.classList.contains("ui-action-button")).map(uiControlMetric);
    const uiIconMetrics = uiSurfaceButtons
      .filter((node) => node.classList.contains("ui-icon-action") || node.classList.contains("ui-surface-close"))
      .map(uiControlMetric);
    const uiChoiceMetrics = uiSurfaceButtons
      .filter((node) => node.classList.contains("ui-choice-row") || node.classList.contains("ui-segment-action") || node.classList.contains("ui-inline-action"))
      .map(uiControlMetric);
    const uiPreviewMetrics = uiSurfaceButtons
      .filter((node) => node.getAttribute("data-ui-control") === "preview")
      .map(uiControlMetric);
    const uiRawButtonMetrics = uiSurfaceButtons
      .filter((node) => !node.matches(".ui-action-button, .ui-icon-action, .ui-surface-close, .ui-choice-row, .ui-segment-action, .ui-inline-action, [data-ui-control='preview']"))
      .map(uiControlMetric);
    const uiFooterMetrics = visibleUiSurfaces.flatMap((surface) => Array.from(surface.querySelectorAll(":scope > .ui-surface-footer"))).map((footer) => {
      const group = footer.querySelector(":scope > .ui-surface-footer-actions");
      const buttons = group ? Array.from(group.querySelectorAll(":scope > button")).filter(uiControlVisible) : [];
      const metrics = buttons.map(uiControlMetric).sort((left, right) => Math.abs(left.top - right.top) <= 2 ? left.left - right.left : left.top - right.top);
      const horizontalGaps = metrics.slice(1).flatMap((item, index) => {
        const previous = metrics[index];
        return Math.abs(item.top - previous.top) <= 2 ? [metricRound(item.left - previous.right)] : [];
      });
      return {
        buttonCount: buttons.length,
        nonPrimitiveCount: buttons.filter((node) => !node.classList.contains("ui-action-button") && !node.classList.contains("ui-icon-action")).length,
        nestedActionWrapperCount: group ? Array.from(group.children).filter((node) => node.tagName !== "BUTTON").length : 0,
        minHorizontalGap: horizontalGaps.length ? Math.min(...horizontalGaps) : null,
        overlaps: horizontalGaps.filter((gap) => gap < 0).length,
        buttons: metrics
      };
    });
    const uiActionControlsOk = uiActionMetrics.every((item) => item.height >= 33 && item.height <= 44 && item.radius >= 4 && Boolean(item.label));
    const uiIconControlsOk = uiIconMetrics.every((item) => item.width >= 27 && item.height >= 27 && Math.abs(item.width - item.height) <= 1.5 && item.radius >= 4 && Boolean(item.label));
    const uiChoiceControlsOk = uiChoiceMetrics.every((item) => (
      item.height >= 27 &&
      Boolean(item.label) &&
      (item.radius >= 4 || (item.choiceLayout === "list" && item.borderBottomWidth >= 0.5))
    ));
    const uiPreviewControlsOk = uiPreviewMetrics.every((item) => item.width >= 44 && item.height >= 44 && item.radius >= 4 && Boolean(item.label));
    const uiFooterControlsOk = uiFooterMetrics.every((item) => item.nonPrimitiveCount === 0 && item.nestedActionWrapperCount === 0 && item.overlaps === 0 && (item.minHorizontalGap == null || item.minHorizontalGap >= 10));
    const uiPrimitiveCoverageOk = uiRawButtonMetrics.length === 0;
    const uiBaseCoverageOk = uiBaseMissingMetrics.length === 0;
    const uiControlFoundationOk = uiActionControlsOk && uiIconControlsOk && uiChoiceControlsOk && uiPreviewControlsOk && uiFooterControlsOk && uiPrimitiveCoverageOk && uiBaseCoverageOk;
    const uiControlFoundationMetrics = {
      surfaceCount: visibleUiSurfaces.length,
      actionControlsOk: uiActionControlsOk,
      iconControlsOk: uiIconControlsOk,
      choiceControlsOk: uiChoiceControlsOk,
      previewControlsOk: uiPreviewControlsOk,
      footerControlsOk: uiFooterControlsOk,
      primitiveCoverageOk: uiPrimitiveCoverageOk,
      baseCoverageOk: uiBaseCoverageOk,
      visibleButtonCount: visibleUiButtons.length,
      baseMissingButtons: uiBaseMissingMetrics,
      actions: uiActionMetrics,
      icons: uiIconMetrics,
      choices: uiChoiceMetrics,
      previews: uiPreviewMetrics,
      rawButtons: uiRawButtonMetrics,
      footers: uiFooterMetrics
    };
    const authShellNode = element(".auth-shell");
    const authShellRect = authShellNode?.getBoundingClientRect?.() || null;
    const authStageRect = rect(".auth-stage");
    const authCardNode = element(".auth-card");
    const authCardRect = authCardNode?.getBoundingClientRect?.() || null;
    const authFormNode = element(".auth-gate-form");
    const authFormRect = authFormNode?.getBoundingClientRect?.() || null;
    const authSwitchNodes = Array.from(document.querySelectorAll(".auth-gate-form .auth-switch"));
    const authSwitchNode = authSwitchNodes[0] || null;
    const authSwitchRect = authSwitchNode?.getBoundingClientRect?.() || null;
    const authSwitchStyle = authSwitchNode ? getComputedStyle(authSwitchNode) : null;
    const authSwitchButtons = Array.from(document.querySelectorAll(".auth-gate-form .auth-switch button"));
    const authSwitchButtonMetrics = authSwitchButtons.map((node) => ({
      text: String(node.textContent || "").trim(),
      active: node.classList.contains("active"),
      ...plainRect(node.getBoundingClientRect())
    }));
    const authSwitchMetrics = authSwitchNodes.map((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const buttons = Array.from(node.querySelectorAll("button"));
      const buttonMetrics = buttons.map((button) => ({
        text: String(button.textContent || "").trim(),
        active: button.classList.contains("active"),
        ...plainRect(button.getBoundingClientRect())
      }));
      const columns = String(style.gridTemplateColumns || "").trim().split(/\\s+/).filter(Boolean);
      const horizontalOk = Boolean(
        buttons.length === 2 && buttonMetrics.length === 2 &&
        Math.abs(Number(buttonMetrics[0]?.top || 0) - Number(buttonMetrics[1]?.top || 0)) <= 1 &&
        Math.abs(Number(buttonMetrics[0]?.bottom || 0) - Number(buttonMetrics[1]?.bottom || 0)) <= 1 &&
        Number(buttonMetrics[0]?.right || 0) <= Number(buttonMetrics[1]?.left || 0) + 1 &&
        buttonMetrics.every((item) => Number(item.width || 0) >= Math.max(80, (box.width - 16) / 2)) &&
        columns.length === 2
      );
      return {
        ...plainRect(box),
        display: style.display,
        gridTemplateColumns: style.gridTemplateColumns,
        gridAutoFlow: style.gridAutoFlow,
        buttons: buttonMetrics,
        horizontalOk
      };
    });
    const authActiveTab = element(".auth-gate-form .auth-switch button.active");
    const authActiveTabRect = authActiveTab?.getBoundingClientRect?.() || null;
    const authInputs = Array.from(document.querySelectorAll(".auth-gate-form input"));
    const authInputMetrics = authInputs.map((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        className: String(node.className || ""),
        type: String(node.type || ""),
        width: metricRound(box.width),
        height: metricRound(box.height),
        borderWidth: metricRound(parseFloat(style.borderTopWidth || "0")),
        backgroundColor: style.backgroundColor,
        color: style.color,
        fontSize: metricRound(parseFloat(style.fontSize || "0"))
      };
    });
    const authSubmitNode = element(".auth-gate-form .basic-auth-submit");
    const authSubmitRect = authSubmitNode?.getBoundingClientRect?.() || null;
    const authSubmitStyle = authSubmitNode ? getComputedStyle(authSubmitNode) : null;
    const authActiveTabStyle = authActiveTab ? getComputedStyle(authActiveTab) : null;
    const authMessageNode = element(".auth-card .auth-message");
    const authMessageRect = authMessageNode?.getBoundingClientRect?.() || null;
    const authMessageStyle = authMessageNode ? getComputedStyle(authMessageNode) : null;
    const nonTransparentColor = (value) => Boolean(value && value !== "transparent" && value !== "none" && !/^rgba\\([^)]*,\\s*0\\)$/.test(value));
    const authGateVisible = Boolean(authShellRect && authCardRect && authFormRect);
    const authGateOnlyOk = !authGateVisible || Boolean(
      !element(".ide-shell") && !element(".settings-drawer") && !element(".account-drawer") &&
      !element(".project-menu-popover") && !element(".file-command-popover") && !element(".dialog-layer")
    );
    const authGateSwitchHorizontalOk = !authGateVisible || Boolean(
      authSwitchMetrics.length >= 1 && authSwitchMetrics.every((item) => item.horizontalOk)
    );
    const authGateLayoutOk = !authGateVisible || Boolean(
      withinViewport(authShellRect, 1) && withinViewport(authCardRect, 2) && authStageRect &&
      authCardRect.width >= Math.min(340, window.innerWidth - 32) && authCardRect.width <= 540 &&
      authCardRect.height <= authStageRect.height - 12 && authFormRect.width >= authCardRect.width - 44 &&
      authSwitchMetrics.length >= 1 && authSwitchMetrics.every((item) => item.width >= authFormRect.width - 2) &&
      authActiveTabRect && authActiveTabRect.height >= 30 && authGateSwitchHorizontalOk
    );
    const authGateControlsStyledOk = !authGateVisible || Boolean(
      authInputs.length >= 2 && authInputMetrics.every((item) => item.width >= Math.min(260, Number(authFormRect?.width || 0) - 4) && item.height >= 34 && item.borderWidth >= 0.5 && nonTransparentColor(item.backgroundColor) && item.fontSize >= 12) &&
      authSubmitRect && authSubmitStyle && authSubmitRect.width >= Number(authFormRect?.width || 0) - 2 && authSubmitRect.height >= 34 &&
      nonTransparentColor(authSubmitStyle.backgroundImage !== "none" ? authSubmitStyle.backgroundImage : authSubmitStyle.backgroundColor) &&
      authActiveTabStyle && nonTransparentColor(authActiveTabStyle.backgroundImage !== "none" ? authActiveTabStyle.backgroundImage : authActiveTabStyle.backgroundColor)
    );
    const authGateErrorStyledOk = !authMessageNode || Boolean(
      authMessageRect && authMessageStyle && withinViewport(authMessageRect, 2) &&
      (
        parseFloat(authMessageStyle.borderTopWidth || "0") >= 0.5 ||
        parseFloat(authMessageStyle.borderLeftWidth || "0") >= 2
      ) &&
      authMessageNode.matches('[data-ui-notice="true"]') &&
      nonTransparentColor(authMessageStyle.backgroundColor)
    );
    const authGateMetrics = authGateVisible ? {
      mode: element(".auth-gate-form .basic-auth-name") ? "register" : "login",
      shell: plainRect(authShellRect),
      stage: plainRect(authStageRect),
      card: plainRect(authCardRect),
      form: plainRect(authFormRect),
      switch: plainRect(authSwitchRect),
      switchStyle: authSwitchStyle ? { display: authSwitchStyle.display, gridTemplateColumns: authSwitchStyle.gridTemplateColumns, gridAutoFlow: authSwitchStyle.gridAutoFlow } : null,
      switchButtons: authSwitchButtonMetrics,
      switches: authSwitchMetrics,
      activeTab: plainRect(authActiveTabRect),
      inputs: authInputMetrics,
      submit: authSubmitRect ? { ...plainRect(authSubmitRect), backgroundColor: authSubmitStyle?.backgroundColor || "", backgroundImage: authSubmitStyle?.backgroundImage || "", color: authSubmitStyle?.color || "" } : null,
      message: authMessageRect ? { ...plainRect(authMessageRect), text: String(authMessageNode?.textContent || "").trim(), backgroundColor: authMessageStyle?.backgroundColor || "", borderWidth: parseFloat(authMessageStyle?.borderTopWidth || "0") || 0 } : null
    } : null;
    const drawerFlushRight = (box) => !box || (
      Math.abs(box.top) <= 1 &&
      Math.abs(window.innerWidth - box.right) <= 1 &&
      box.bottom >= window.innerHeight - 1 &&
      box.height >= window.innerHeight - 2
    );
    const documentVerticalOverflow = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
    const bodyVerticalOverflow = document.body.scrollHeight > document.body.clientHeight + 1;
    const shellVerticalOverflow = shellNode ? shellNode.scrollHeight > shellNode.clientHeight + 2 : false;
    const mainVerticalOverflow = mainNode ? mainNode.scrollHeight > mainNode.clientHeight + 2 : false;
    const topbarVerticalOverflow = topbarNode ? topbarNode.scrollHeight > topbarNode.clientHeight + 2 : false;
    const compactViewport = window.innerWidth <= 740 && window.innerHeight <= 760;
    const minVisibleCanvasHeight = compactViewport ? 240 : 320;
    const compactInspectorHeaderOk = !compactViewport || !inspectorHeadNode || Boolean(
      inspectorRect &&
      inspectorHeadRect &&
      inspectorTitleNode &&
      inspectorTitleRect &&
      inspectorRect.height <= 48 &&
      inspectorHeadRect.height <= 47 &&
      inspectorHeadRect.top >= inspectorRect.top - 1 &&
      inspectorHeadRect.bottom <= inspectorRect.bottom + 1 &&
      (!inspectorEyebrowNode || getComputedStyle(inspectorEyebrowNode).display === "none") &&
      inspectorTitleRect.height >= 12 &&
      inspectorTitleRect.bottom <= inspectorHeadRect.bottom + 1
    );
    const topbarControlsDockedOk = !windowControlsRect || Boolean(topbarRect) &&
      windowControlsRect.top >= topbarRect.top - 1 &&
      windowControlsRect.bottom <= topbarRect.bottom + 1 &&
      windowControlsRect.right <= topbarRect.right + 1 &&
      windowControlsRect.left >= topbarRect.left - 1;
    const agentDebugState = window.__naimageDebugAgentState?.() || null;
    const stateLayerEvidence = agentDebugState?.stateLayerEvidence || null;
    const stateLayerFailures = stateLayerEvidence
      ? [
          ...(Array.isArray(stateLayerEvidence.criticalComparisons) ? stateLayerEvidence.criticalComparisons.filter((item) => !item?.ok).map((item) => ({
            kind: "layer-mismatch",
            left: item.leftName,
            right: item.rightName,
            missingFromRight: item.missingFromRight || [],
            unexpectedInRight: item.unexpectedInRight || [],
            sameOrder: item.sameOrder
          })) : []),
          ...Object.entries(stateLayerEvidence.duplicates || {}).filter(([, ids]) => Array.isArray(ids) && ids.length).map(([layer, ids]) => ({ kind: "duplicate-ids", layer, ids })),
          ...(Array.isArray(stateLayerEvidence.layoutGroupProblems) ? stateLayerEvidence.layoutGroupProblems.map((problem) => ({ kind: "layout-group", ...problem })) : [])
        ]
      : [{ kind: "missing-state-layer-evidence" }];
    const stateLayerClosureWarnings = Array.isArray(stateLayerEvidence?.closureComparisons)
      ? stateLayerEvidence.closureComparisons.filter((item) => !item?.ok).map((item) => ({
          kind: "stale-render-closure",
          left: item.leftName,
          right: item.rightName,
          missingFromRight: item.missingFromRight || [],
          unexpectedInRight: item.unexpectedInRight || [],
          sameOrder: item.sameOrder
        }))
      : [];
    const stateLayerConsistencyOk = Boolean(stateLayerEvidence?.ok && stateLayerFailures.length === 0);
    const agentToolPromptBlocks = Array.from(document.querySelectorAll(".agent-tool-prompt-block"));
    const agentToolBriefNodes = Array.from(document.querySelectorAll(".agent-tool-brief-outside")).filter((node) => String(node.textContent || "").trim());
    const selectedCanvasNodeCount = document.querySelectorAll(".flow-node.selected").length;
    const selectedNodeIds = Array.isArray(agentDebugState?.selectedNodeIds) ? agentDebugState.selectedNodeIds : [];
    const selectionMode = String(agentDebugState?.selectionMode || (selectedNodeIds.length > 1 ? "multiple" : selectedNodeIds.length === 1 ? "single" : "none"));
    const selectionGesture = String(agentDebugState?.selectionGesture || "");
    const toolTimelineEvidence = agentDebugState?.toolTimelineEvidence && typeof agentDebugState.toolTimelineEvidence === "object"
      ? agentDebugState.toolTimelineEvidence
      : { ok: true, cardCount: 0, operationCount: 0, duplicateOperationStages: [], cards: [] };
    const layerCommitEvidence = agentDebugState?.layerCommitEvidence && typeof agentDebugState.layerCommitEvidence === "object"
      ? agentDebugState.layerCommitEvidence
      : { ok: true, pendingCount: 0, operations: [] };
    const selectedNodeHighlightMetrics = Array.from(document.querySelectorAll(".flow-node.selected")).map((node) => {
      const style = getComputedStyle(node);
      return {
        id: node.getAttribute("data-node-id") || "",
        outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
        outlineOffset: Number.parseFloat(style.outlineOffset) || 0,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow
      };
    });
    const selectedNodeHighlightVisibleOk = selectedNodeHighlightMetrics.length > 0 && selectedNodeHighlightMetrics.every((item) =>
      item.outlineWidth >= 1.5 &&
      item.outlineOffset >= 2 &&
      item.outlineStyle === "solid" &&
      item.outlineColor !== "transparent" &&
      item.boxShadow !== "none"
    );
    const normalizeContextText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const currentSelectionText = normalizeContextText(projectAgentContextNode?.textContent);
    const projectAgentContextAriaLabel = normalizeContextText(projectAgentContextNode?.getAttribute("aria-label"));
    const projectAgentContextOpacityValue = Number.parseFloat(projectAgentContextStyle?.opacity || "1");
    const projectAgentContextOpacity = Number.isFinite(projectAgentContextOpacityValue) ? projectAgentContextOpacityValue : 1;
    const projectAgentContextStyleVisible = Boolean(
      projectAgentContextNode &&
      projectAgentContextStyle &&
      projectAgentContextStyle.display !== "none" &&
      projectAgentContextStyle.visibility !== "hidden" &&
      projectAgentContextStyle.visibility !== "collapse" &&
      projectAgentContextOpacity > 0
    );
    const projectAgentContextCheckVisibilityOk = (() => {
      if (!projectAgentContextNode) return false;
      if (typeof projectAgentContextNode.checkVisibility !== "function") return projectAgentContextStyleVisible;
      try {
        return projectAgentContextNode.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch {
        return projectAgentContextStyleVisible;
      }
    })();
    const projectAgentContextViewportRect = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight
    };
    const projectAgentContextViewportIntersection = intersectRect(projectAgentContextRect, projectAgentContextViewportRect);
    const projectAgentContextAgentIntersection = intersectRect(projectAgentContextRect, agentRect);
    const projectAgentContextArea = Math.max(1, rectArea(projectAgentContextRect));
    const projectAgentContextViewportVisibleRatio = metricRound(rectArea(projectAgentContextViewportIntersection) / projectAgentContextArea);
    const projectAgentContextAgentVisibleRatio = metricRound(rectArea(projectAgentContextAgentIntersection) / projectAgentContextArea);
    const projectAgentContextCenterX = Number(projectAgentContextRect?.left || 0) + Number(projectAgentContextRect?.width || 0) / 2;
    const projectAgentContextCenterY = Number(projectAgentContextRect?.top || 0) + Number(projectAgentContextRect?.height || 0) / 2;
    const projectAgentContextTopHit = projectAgentContextRect
      ? document.elementFromPoint(projectAgentContextCenterX, projectAgentContextCenterY)
      : null;
    const projectAgentContextHitTestOk = Boolean(
      projectAgentContextNode &&
      projectAgentContextTopHit &&
      (projectAgentContextTopHit === projectAgentContextNode || projectAgentContextNode.contains(projectAgentContextTopHit))
    );
    const projectAgentContextPrefixPresent = Boolean(projectAgentContextPrefixNode && /将基于/.test(String(projectAgentContextPrefixNode.textContent || "")));
    const projectAgentContextPrefixSingleLineOk = !projectAgentContextPrefixPresent || Boolean(
      projectAgentContextPrefixRect &&
      projectAgentContextPrefixRect.width >= 24 &&
      projectAgentContextPrefixRect.height > 0 &&
      projectAgentContextPrefixRect.height <= 16 &&
      Number(projectAgentContextPrefixNode.scrollHeight || 0) <= Number(projectAgentContextPrefixNode.clientHeight || 0) + 1 &&
      projectAgentContextPrefixStyle?.whiteSpace === "nowrap" &&
      projectAgentContextPrefixStyle?.writingMode === "horizontal-tb"
    );
    const projectAgentContextPrefixMetrics = projectAgentContextPrefixNode ? {
      text: String(projectAgentContextPrefixNode.textContent || "").replace(/\s+/g, " ").trim(),
      geometry: plainRect(projectAgentContextPrefixRect),
      clientWidth: Number(projectAgentContextPrefixNode.clientWidth || 0),
      clientHeight: Number(projectAgentContextPrefixNode.clientHeight || 0),
      scrollWidth: Number(projectAgentContextPrefixNode.scrollWidth || 0),
      scrollHeight: Number(projectAgentContextPrefixNode.scrollHeight || 0),
      whiteSpace: projectAgentContextPrefixStyle?.whiteSpace || "",
      writingMode: projectAgentContextPrefixStyle?.writingMode || "",
      flexShrink: projectAgentContextPrefixStyle?.flexShrink || "",
      lineHeight: projectAgentContextPrefixStyle?.lineHeight || ""
    } : null;
    const projectAgentContextValueText = normalizeContextText(projectAgentContextValueNode?.textContent);
    const projectAgentContextValueMinimumWidth = projectAgentContextValueText
      ? Math.min(16, Math.max(8, Number(projectAgentContextValueNode?.scrollWidth || projectAgentContextValueRect?.width || 0)))
      : 0;
    const projectAgentContextValueSingleLineOk = Boolean(
      projectAgentContextValueNode &&
      projectAgentContextValueRect &&
      projectAgentContextValueRect.height > 0 &&
      Number(projectAgentContextValueNode.scrollHeight || 0) <= Number(projectAgentContextValueNode.clientHeight || 0) + 1 &&
      projectAgentContextValueStyle?.whiteSpace === "nowrap" &&
      projectAgentContextValueStyle?.writingMode === "horizontal-tb"
    );
    const projectAgentContextValueVisibleOk = Boolean(
      projectAgentContextValueText &&
      projectAgentContextValueRect &&
      projectAgentContextValueRect.width + 1 >= projectAgentContextValueMinimumWidth &&
      projectAgentContextValueSingleLineOk
    );
    const projectAgentContextPrefixContentWidth = Math.max(
      Number(projectAgentContextPrefixNode?.scrollWidth || 0),
      Number(projectAgentContextPrefixRect?.width || 0)
    );
    const projectAgentContextControlWidth = projectAgentContextClearNode
      ? Math.min(22, Math.max(
        Number(projectAgentContextClearNode.clientWidth || 0),
        Number(projectAgentContextClearRect?.width || 0)
      ))
      : 0;
    const projectAgentContextMinimumContentWidth = Math.round(Math.max(
      70,
      projectAgentContextPrefixContentWidth + 40 + projectAgentContextControlWidth
    ));
    const projectAgentContextTextPresent = Boolean(currentSelectionText || projectAgentContextAriaLabel);
    const projectAgentContextWidthOk = Boolean(
      projectAgentContextRect &&
      projectAgentContextRect.width + 1 >= projectAgentContextMinimumContentWidth
    );
    const projectAgentContextHeightOk = Boolean(projectAgentContextRect && projectAgentContextRect.height >= 26);
    const projectAgentContextActuallyVisible = Boolean(
      projectAgentContextNode &&
      projectAgentContextRect &&
      projectAgentContextStyleVisible &&
      projectAgentContextCheckVisibilityOk &&
      projectAgentContextWidthOk &&
      projectAgentContextHeightOk &&
      projectAgentContextTextPresent &&
      projectAgentContextPrefixSingleLineOk &&
      projectAgentContextValueVisibleOk &&
      projectAgentContextViewportVisibleRatio >= 0.98 &&
      projectAgentContextAgentVisibleRatio >= 0.98 &&
      projectAgentContextHitTestOk
    );
    const projectAgentContextVisible = selectedNodeIds.length === 0
      ? !projectAgentContextNode
      : projectAgentContextActuallyVisible;
    const projectAgentContextMetrics = {
      present: Boolean(projectAgentContextNode),
      geometry: plainRect(projectAgentContextRect),
      width: metricRound(projectAgentContextRect?.width || 0),
      height: metricRound(projectAgentContextRect?.height || 0),
      display: projectAgentContextStyle?.display || "missing",
      visibility: projectAgentContextStyle?.visibility || "missing",
      opacity: metricRound(projectAgentContextOpacity),
      styleVisible: projectAgentContextStyleVisible,
      checkVisibilityOk: projectAgentContextCheckVisibilityOk,
      text: currentSelectionText,
      ariaLabel: projectAgentContextAriaLabel,
      textPresent: projectAgentContextTextPresent,
      prefixSingleLine: projectAgentContextPrefixSingleLineOk,
      valueText: projectAgentContextValueText,
      valueGeometry: plainRect(projectAgentContextValueRect),
      valueClientWidth: Number(projectAgentContextValueNode?.clientWidth || 0),
      valueScrollWidth: Number(projectAgentContextValueNode?.scrollWidth || 0),
      valueMinimumWidth: metricRound(projectAgentContextValueMinimumWidth),
      valueSingleLine: projectAgentContextValueSingleLineOk,
      valueVisible: projectAgentContextValueVisibleOk,
      minimumContentWidth: projectAgentContextMinimumContentWidth,
      widthMeetsContentMinimum: projectAgentContextWidthOk,
      heightMeetsMinimum: projectAgentContextHeightOk,
      viewportVisibleRatio: projectAgentContextViewportVisibleRatio,
      agentPanelVisibleRatio: projectAgentContextAgentVisibleRatio,
      hitTestOk: projectAgentContextHitTestOk,
      topHitTag: projectAgentContextTopHit?.tagName?.toLowerCase?.() || "",
      topHitClassName: typeof projectAgentContextTopHit?.className === "string" ? projectAgentContextTopHit.className : ""
    };
    const canvasSelectionTextOk = !currentSelectionText;
    const canvasSelectionAriaOk = !projectAgentContextAriaLabel;
    const canvasSelectionStateOk = Boolean(
      selectedNodeIds.length === 0 &&
      !projectAgentContextNode &&
      !canvasSelectionIndicatorNode &&
      canvasSelectionTextOk &&
      canvasSelectionAriaOk
    );
    const canvasSelectionMetrics = {
      noArtifactSelection: selectedNodeIds.length === 0,
      legacyCanvasSelectionFieldAbsent: !Object.prototype.hasOwnProperty.call(agentDebugState || {}, "canvasSelected"),
      selectedNodeIds,
      selectedNodeCount: selectedNodeIds.length,
      renderedText: currentSelectionText,
      ariaLabel: projectAgentContextAriaLabel,
      isCanvasClass: Boolean(projectAgentContextNode?.classList.contains("is-canvas")),
      hasArtifactClass: Boolean(projectAgentContextNode?.classList.contains("has-artifact")),
      contextHiddenWithoutSelection: !projectAgentContextNode,
      indicatorHiddenWithoutSelection: !canvasSelectionIndicatorNode,
      renderedTextEmpty: canvasSelectionTextOk,
      ariaLabelEmpty: canvasSelectionAriaOk
    };
    const normalizedSelectionIds = (value) => [...new Set(String(value || "").split(/\\s+/).map((item) => item.trim()).filter(Boolean))];
    const sameSelectionIds = (left, right) => left.length === right.length && left.every((id) => right.includes(id));
    const selectedCanvasNodeIds = selectedNodeHighlightMetrics.map((item) => item.id).filter(Boolean);
    const canvasSelectionIndicatorKind = String(canvasSelectionIndicatorNode?.getAttribute("data-selection-kind") || "");
    const canvasSelectionIndicatorCount = Number(canvasSelectionIndicatorNode?.getAttribute("data-selection-count") || -1);
    const canvasSelectionIndicatorIds = normalizedSelectionIds(canvasSelectionIndicatorNode?.getAttribute("data-selection-ids"));
    const composerSelectionKind = String(projectAgentContextNode?.getAttribute("data-selection-kind") || "");
    const composerSelectionCount = Number(projectAgentContextNode?.getAttribute("data-selection-count") || -1);
    const composerSelectionIds = normalizedSelectionIds(projectAgentContextNode?.getAttribute("data-selection-ids"));
    const canvasSelectionIndicatorText = normalizeContextText(canvasSelectionIndicatorNode?.textContent);
    const canvasSelectionIndicatorTitle = normalizeContextText(canvasSelectionIndicatorTitleNode?.textContent);
    const canvasSelectionIndicatorDetail = normalizeContextText(canvasSelectionIndicatorDetailNode?.textContent);
    const canvasSelectionIndicatorOpacityValue = Number.parseFloat(canvasSelectionIndicatorStyle?.opacity || "1");
    const canvasSelectionIndicatorOpacity = Number.isFinite(canvasSelectionIndicatorOpacityValue) ? canvasSelectionIndicatorOpacityValue : 1;
    const canvasSelectionIndicatorIntersection = intersectRect(canvasSelectionIndicatorRect, canvasRect);
    const canvasSelectionIndicatorArea = Math.max(1, rectArea(canvasSelectionIndicatorRect));
    const canvasSelectionIndicatorVisibleRatio = metricRound(rectArea(canvasSelectionIndicatorIntersection) / canvasSelectionIndicatorArea);
    const canvasSelectionIndicatorTitleSingleLineOk = Boolean(
      canvasSelectionIndicatorTitleNode &&
      canvasSelectionIndicatorTitleRect &&
      canvasSelectionIndicatorTitleRect.height >= 18 &&
      canvasSelectionIndicatorTitleRect.width >= 48 &&
      Number(canvasSelectionIndicatorTitleNode.scrollHeight || 0) <= Number(canvasSelectionIndicatorTitleNode.clientHeight || 0) + 2 &&
      canvasSelectionIndicatorTitleStyle?.whiteSpace === "nowrap" &&
      Number.parseFloat(canvasSelectionIndicatorTitleStyle?.fontSize || "0") >= 14
    );
    const canvasSelectionIndicatorActualGeometryOk = Boolean(
      canvasSelectionIndicatorRect &&
      canvasRect &&
      canvasSelectionIndicatorRect.width >= 200 &&
      canvasSelectionIndicatorRect.width <= 422 &&
      canvasSelectionIndicatorRect.height >= 58 &&
      canvasSelectionIndicatorRect.height <= 84 &&
      canvasSelectionIndicatorRect.top >= canvasRect.top + 8 &&
      canvasSelectionIndicatorRect.bottom <= canvasRect.bottom - 8 &&
      canvasSelectionIndicatorRect.left >= canvasRect.left + 10 &&
      canvasSelectionIndicatorRect.right <= canvasRect.right - 10 &&
      canvasSelectionIndicatorVisibleRatio >= 0.98 &&
      canvasSelectionIndicatorTitleSingleLineOk
    );
    const canvasSelectionIndicatorActuallyVisible = Boolean(
      canvasSelectionIndicatorNode &&
      canvasSelectionIndicatorStyle?.display !== "none" &&
      canvasSelectionIndicatorStyle?.visibility !== "hidden" &&
      canvasSelectionIndicatorStyle?.visibility !== "collapse" &&
      canvasSelectionIndicatorOpacity > 0 &&
      canvasSelectionIndicatorText &&
      canvasSelectionIndicatorActualGeometryOk
    );
    const canvasSelectionIndicatorGeometryOk = selectedNodeIds.length === 0
      ? !canvasSelectionIndicatorNode
      : canvasSelectionIndicatorActualGeometryOk;
    const canvasSelectionIndicatorVisibleOk = selectedNodeIds.length === 0
      ? !canvasSelectionIndicatorNode
      : canvasSelectionIndicatorActuallyVisible;
    const expectedSelectionKind = selectedNodeIds.length > 1 ? "multiple" : selectedNodeIds.length === 1 ? "single" : "none";
    const selectionSummaryTextOk = selectedNodeIds.length === 0
      ? !canvasSelectionIndicatorNode && !projectAgentContextNode
      : selectedNodeIds.length === 1
        ? Boolean(canvasSelectionIndicatorTitle && currentSelectionText.includes(canvasSelectionIndicatorTitle))
        : canvasSelectionIndicatorTitle === String(selectedNodeIds.length) + " 个成果" && currentSelectionText.includes(String(selectedNodeIds.length) + " 个选中成果");
    const selectionSurfacesConsistentOk = Boolean(
      (selectedNodeIds.length === 0
        ? !canvasSelectionIndicatorNode && !projectAgentContextNode && selectedCanvasNodeIds.length === 0
        : canvasSelectionIndicatorVisibleOk &&
          canvasSelectionIndicatorKind === expectedSelectionKind &&
          composerSelectionKind === expectedSelectionKind &&
          canvasSelectionIndicatorCount === selectedNodeIds.length &&
          composerSelectionCount === selectedNodeIds.length &&
          sameSelectionIds(canvasSelectionIndicatorIds, selectedNodeIds) &&
          sameSelectionIds(composerSelectionIds, selectedNodeIds) &&
          sameSelectionIds(selectedCanvasNodeIds, selectedNodeIds)) &&
      selectionSummaryTextOk
    );
    const canvasSelectionIndicatorMetrics = {
      present: Boolean(canvasSelectionIndicatorNode),
      geometry: plainRect(canvasSelectionIndicatorRect),
      display: canvasSelectionIndicatorStyle?.display || "missing",
      visibility: canvasSelectionIndicatorStyle?.visibility || "missing",
      opacity: metricRound(canvasSelectionIndicatorOpacity),
      visibleRatio: canvasSelectionIndicatorVisibleRatio,
      kind: canvasSelectionIndicatorKind,
      count: canvasSelectionIndicatorCount,
      ids: canvasSelectionIndicatorIds,
      text: canvasSelectionIndicatorText,
      title: canvasSelectionIndicatorTitle,
      detail: canvasSelectionIndicatorDetail,
      titleGeometry: plainRect(canvasSelectionIndicatorTitleRect),
      titleClientWidth: Number(canvasSelectionIndicatorTitleNode?.clientWidth || 0),
      titleClientHeight: Number(canvasSelectionIndicatorTitleNode?.clientHeight || 0),
      titleScrollWidth: Number(canvasSelectionIndicatorTitleNode?.scrollWidth || 0),
      titleScrollHeight: Number(canvasSelectionIndicatorTitleNode?.scrollHeight || 0),
      titleFontSize: canvasSelectionIndicatorTitleStyle?.fontSize || "",
      titleLineHeight: canvasSelectionIndicatorTitleStyle?.lineHeight || "",
      titleWhiteSpace: canvasSelectionIndicatorTitleStyle?.whiteSpace || "",
      titleSingleLine: canvasSelectionIndicatorTitleSingleLineOk,
      geometryOk: canvasSelectionIndicatorGeometryOk,
      actuallyVisible: canvasSelectionIndicatorActuallyVisible
    };
    const selectionSurfaceMetrics = {
      expectedKind: expectedSelectionKind,
      runtimeIds: selectedNodeIds,
      selectedCanvasNodeIds,
      indicatorKind: canvasSelectionIndicatorKind,
      indicatorCount: canvasSelectionIndicatorCount,
      indicatorIds: canvasSelectionIndicatorIds,
      composerKind: composerSelectionKind,
      composerCount: composerSelectionCount,
      composerIds: composerSelectionIds,
      summaryTextOk: selectionSummaryTextOk
    };
    const multiSelectionStateOk = Boolean(
      selectedNodeIds.length >= 2 &&
      selectedCanvasNodeCount === selectedNodeIds.length &&
      currentSelectionText.includes(String(selectedNodeIds.length) + " 个选中成果")
    );
    const layerRuntimeNodes = Array.isArray(agentDebugState?.nodes)
      ? agentDebugState.nodes.filter((node) => node?.layerGroup || node?.imageParams?.layerGroupId)
      : [];
    const layerRuntimeRoles = layerRuntimeNodes.map((node) => String(node?.layerGroup?.role || node?.imageParams?.layerRole || "")).filter(Boolean);
    const layerRuntimeGroupIds = Array.from(new Set(layerRuntimeNodes.map((node) => String(node?.layerGroup?.id || node?.imageParams?.layerGroupId || "")).filter(Boolean)));
    const layerRuntimeAnchors = new Set(layerRuntimeNodes.map((node) => String(node?.x) + ":" + String(node?.y)));
    const layerPngRuntimeOk = Boolean(
      window.__naimageLayersProbe?.ok &&
      Number(window.__naimageLayersProbe?.actionCount || 0) === 1 &&
      layerRuntimeNodes.length === 3 &&
      new Set(layerRuntimeNodes.map((node) => node?.id)).size === 3 &&
      layerRuntimeGroupIds.length === 1 &&
      layerRuntimeAnchors.size === 1 &&
      ["background", "subject", "foreground"].every((role) => layerRuntimeRoles.includes(role)) &&
      layerRuntimeNodes.every((node, index) =>
        node?.type === "image" &&
        node?.imageParams?.outputFormat === "png" &&
        node?.layerGroup?.order === index + 1 &&
        node?.layerGroup?.total === 3 &&
        node?.layerGroup?.detached === false &&
        !node?.layerComposition &&
        Number(node?.assetCount || 0) === 1
      )
    );
    const layerFolderActionVisible = Boolean(
      window.__naimageLayerMenuProbe?.ok &&
      Array.isArray(window.__naimageLayerMenuProbe?.texts) &&
      window.__naimageLayerMenuProbe.texts.some((item) => String(item).includes("打开图层文件夹"))
    );
    const variantsRuntimeNodes = Array.isArray(agentDebugState?.nodes)
      ? agentDebugState.nodes.filter((node) => /operation:\\s*variants/i.test(String(node?.prompt || "")) && node?.imageCollection?.kind === "batch")
      : [];
    const replaceRuntimeNode = Array.isArray(agentDebugState?.nodes)
      ? agentDebugState.nodes.find((node) => /operation:\\s*replace/i.test(String(node?.prompt || "")))
      : null;
    const variantsRuntimeOk = Boolean(
      variantsRuntimeNodes.length === 1 &&
      variantsRuntimeNodes.every((node) =>
        node?.parentId &&
        agentDebugState?.nodes?.some((source) => source.id === node.parentId && Number(source.assetCount || 0) >= 1) &&
        node.relationType === "variant" &&
        Number(node.assetCount || 0) === 4 &&
        Array.isArray(node.imageCollection?.items) &&
        node.imageCollection.items.length === 4 &&
        node.imageCollection.items.every((item) => item?.status === "done" && String(item?.prompt || "").trim())
      )
    );
    const replaceRuntimeOk = Boolean(
      replaceRuntimeNode?.parentId &&
      agentDebugState?.nodes?.some((node) => node.id === replaceRuntimeNode.parentId && Number(node.assetCount || 0) >= 1) &&
      replaceRuntimeNode.relationType === "derived-from" &&
      Number(replaceRuntimeNode.assetCount || 0) === 1
    );
    const referenceRuntimeNode = Array.isArray(agentDebugState?.nodes)
      ? agentDebugState.nodes.find((node) => /referenceImages:\\s*1/i.test(String(node?.prompt || "")))
      : null;
   const referenceImageRuntimeOk = Boolean(
     window.__naimageReferenceProbe?.ok &&
     referenceRuntimeNode &&
     Number(referenceRuntimeNode.assetCount || 0) === 1 &&
     !referenceRuntimeNode.parentId
   );
    const imageLayoutGroups = Array.isArray(agentDebugState?.layoutGroups) ? agentDebugState.layoutGroups : [];
    const finalImageLayoutGroup = imageLayoutGroups.find((group) => group?.id === window.__naimageContainerFinalGroupProbe?.group?.id) || imageLayoutGroups[0] || null;
    const groupedArtifactNodes = finalImageLayoutGroup && Array.isArray(agentDebugState?.nodes)
      ? finalImageLayoutGroup.memberNodeIds.map((id) => agentDebugState.nodes.find((node) => node?.id === id)).filter(Boolean)
      : [];
    const imageContainerRuntimeNodes = groupedArtifactNodes.filter((node) => node?.imageContainer === true);
    const imageContainerAssets = groupedArtifactNodes.flatMap((node) => Array.isArray(node?.assets) ? node.assets : []);
    const imageLibraryPathsOk = imageContainerAssets.length === 2 && imageContainerAssets.every((asset) => /output[\\\\/]imagegen[\\\\/]imports/i.test(String(asset?.path || "")));
    const imageLayoutSourcesRetainedOk = Boolean(
      finalImageLayoutGroup?.memberNodeIds?.length === 2 &&
      groupedArtifactNodes.length === 2 &&
      finalImageLayoutGroup.memberNodeIds.every((id) => groupedArtifactNodes.some((node) => node.id === id))
    );
    const imageLayoutCausalityOk = Boolean(
      window.__naimageContainerGroupProbe?.causalityPreserved &&
      window.__naimageContainerDissolveProbe?.causalityPreserved &&
      groupedArtifactNodes.every((node) => !node.parentId && !node.relationType)
    );
    const imageLayoutAutoDissolveOk = Boolean(
      window.__naimageContainerDissolveProbe?.ok && window.__naimageContainerDissolveProbe?.groupRemoved
    );
    const imageContainerTileNodes = Array.from(document.querySelectorAll(".flow-node.image-container .container-image-tile"));
    const imageContainerPreviewNode = element(".flow-node.image-container .image-container-preview");
    const imageContainerPreviewStyle = getComputedStyle(imageContainerPreviewNode || document.body);
    const imageResultContainerPreviews = Array.from(document.querySelectorAll(".flow-node .image-result-container-preview"));
    const imageResultContainerCoreOk = imageResultContainerPreviews.every((preview) => {
      const presentation = preview.getAttribute("data-container-presentation") || "";
      return preview.getAttribute("data-container-core") === "image-result-container" &&
        (presentation === "grid" || presentation === "series") &&
        preview.classList.contains("image-result-container-preview");
    });
    const imageContainerRuntimeOk = Boolean(
      window.__naimageContainerImportProbe?.ok &&
      window.__naimageContainerImportSettleProbe?.ok &&
      window.__naimageContainerMoveProbe?.ok &&
      window.__naimageContainerSplitProbe?.ok &&
      window.__naimageContainerGroupProbe?.ok &&
      window.__naimageContainerFinalGroupProbe?.ok &&
      imageLayoutAutoDissolveOk &&
      imageContainerRuntimeNodes.length === 1 &&
      imageContainerRuntimeNodes[0]?.id === finalImageLayoutGroup?.hostNodeId &&
      groupedArtifactNodes.length === 2 &&
      groupedArtifactNodes.every((node) => Number(node?.assetCount || 0) === 1) &&
      imageLayoutGroups.length === 1 && imageLayoutSourcesRetainedOk && imageLayoutCausalityOk && imageLibraryPathsOk
    );
    const imageContainerGridOk = Boolean(
      imageContainerTileNodes.length === 2 &&
      imageContainerPreviewNode && imageContainerPreviewStyle.display !== "none" &&
      imageContainerPreviewNode.getAttribute("data-image-count") === "2" &&
      groupedArtifactNodes.length === 2 &&
      imageContainerTileNodes.every((tile) => finalImageLayoutGroup?.memberNodeIds?.includes(tile.getAttribute("data-source-node-id") || ""))
    );
    const canvasImageContainerActionVisible = Boolean(
      Array.isArray(window.__naimageCanvasMenuProbe?.texts) &&
      ["创建生图工作", "导入图片", "创建图片容器"].every((label) =>
        window.__naimageCanvasMenuProbe.texts.some((item) => String(item).includes(label))
      )
    );
   const referenceContainerDropOk = Boolean(
     window.__naimageReferenceDropProbe?.ok &&
     Number(agentDebugState?.referenceImageCount || 0) === 2 &&
     /2\\s*张参考图/.test(text(".project-agent-references"))
   );
   const referenceCapacityNineOk = Number(window.__naimageReferenceCapacityProbe?.slots || 0) === 9;
   const referencePickerClosedOk = Boolean(
     window.__naimageReferencePickerCloseProbe?.ok &&
     !document.querySelector('[data-ui-surface="reference-picker"]')
   );
    const imageContainerAgentReferenceOk = Boolean(
      window.__naimageContainerAgentProbe?.ok === true &&
      window.__naimageContainerAgentProbe?.roleSet === true &&
      window.__naimageContainerAgentProbe?.generatedParentId === window.__naimageContainerGroupProbe?.group?.hostNodeId &&
      Number(window.__naimageContainerAgentProbe?.referenceImageCount || 0) === 2
    );
    const compactNativeDropProbe = (probe) => {
      const detail = probe?.regroup || probe?.result || probe || null;
      const gesture = detail?.gesture || null;
      const compactPoint = (point) => point ? {
        clientX: Number(point.clientX || 0),
        clientY: Number(point.clientY || 0),
        withinViewport: point.withinViewport !== false,
        candidateNodeIds: Array.isArray(point.candidateNodeIds) ? point.candidateNodeIds : [],
        groupingCandidateId: String(point.groupingCandidateId || "")
      } : null;
      return detail ? {
        ok: detail.ok === true,
        error: String(detail.error || ""),
        failureReasons: Array.isArray(detail.failureReasons) ? detail.failureReasons : [],
        checks: detail.checks || null,
        route: Array.isArray(detail.route) ? detail.route : [],
        gesture: gesture ? {
          kind: String(gesture.kind || ""),
          groupingThresholdPx: Number(gesture.groupingThresholdPx || 0),
          distancePx: Number(gesture.distancePx || 0),
          start: compactPoint(gesture.start),
          end: compactPoint(gesture.end)
        } : null,
        layoutGroup: detail.layoutGroup ? { ...detail.layoutGroup, memberNodeIds: [...(detail.layoutGroup.memberNodeIds || [])] } : null
      } : null;
    };
    const imageContainerTileMetrics = imageContainerTileNodes.map((tile) => {
      const box = tile.getBoundingClientRect();
      const image = tile.querySelector("img");
      return {
        nodeId: tile.closest(".flow-node")?.getAttribute("data-node-id") || "",
        assetIndex: tile.getAttribute("data-asset-index") || image?.getAttribute("data-asset-index") || "",
        sourceNodeId: tile.getAttribute("data-source-node-id") || "",
        width: metricRound(box.width),
        height: metricRound(box.height),
        visibleRatio: visibilityMetric(tile, rect(".workflow-canvas")).visibleRatio,
        imageLoaded: Boolean(image && image.naturalWidth > 0 && image.naturalHeight > 0)
      };
    });
    const imageContainerRuntimeMetrics = {
      import: window.__naimageContainerImportProbe || null,
      importSettle: window.__naimageContainerImportSettleProbe || null,
      move: window.__naimageContainerMoveProbe || null,
      split: window.__naimageContainerSplitProbe || null,
      group: {
        ok: window.__naimageContainerGroupProbe?.ok === true,
        targetId: String(window.__naimageContainerGroupProbe?.targetId || ""),
        sourceId: String(window.__naimageContainerGroupProbe?.sourceId || ""),
        sourceRetained: window.__naimageContainerGroupProbe?.sourceRetained === true,
        causalityPreserved: window.__naimageContainerGroupProbe?.causalityPreserved === true,
        group: window.__naimageContainerGroupProbe?.group || null,
        drop: compactNativeDropProbe(window.__naimageContainerGroupProbe)
      },
      agentReference: window.__naimageContainerAgentProbe || null,
      dissolve: window.__naimageContainerDissolveProbe || null,
      finalGroup: {
        ok: window.__naimageContainerFinalGroupProbe?.ok === true,
        group: window.__naimageContainerFinalGroupProbe?.group || null,
        drop: compactNativeDropProbe(window.__naimageContainerFinalGroupProbe)
      },
      runtimeContainerNodeIds: imageContainerRuntimeNodes.map((node) => node.id),
      importedNodes: groupedArtifactNodes.map((node) => ({
        id: node.id,
        title: node.title,
        imageContainer: node.imageContainer === true,
        imageContainerRole: node.imageContainerRole || "",
        parentId: node.parentId || "",
        relationType: node.relationType || "",
        assetCount: Number(node.assetCount || 0),
        assetPaths: (node.assets || []).map((asset) => String(asset.path || ""))
      })),
      layoutGroups: imageLayoutGroups.map((group) => ({ ...group, memberNodeIds: [...(group.memberNodeIds || [])] })),
      tileMetrics: imageContainerTileMetrics,
      preview: imageContainerPreviewNode ? {
        count: imageContainerPreviewNode.getAttribute("data-image-count") || "",
        display: imageContainerPreviewStyle.display,
        gridTemplateColumns: imageContainerPreviewStyle.gridTemplateColumns,
        gridTemplateRows: imageContainerPreviewStyle.gridTemplateRows,
        gap: imageContainerPreviewStyle.gap
      } : null
    };
    const referenceDropNoInlineThumbsOk = referenceContainerDropOk && document.querySelectorAll(".project-agent-composer .agent-reference-strip img").length === 0;
    const agentProgress = Array.isArray(agentDebugState?.progress) ? agentDebugState.progress : [];
    const nodeLayouts = Array.isArray(agentDebugState?.nodeLayouts) ? agentDebugState.nodeLayouts : [];
    const imageNodeLayouts = nodeLayouts.filter((item) => item?.type === "image");
    const nodeFooterGapMax = imageNodeLayouts.reduce((max, item) => Math.max(max, Number(item.footerGap || 0)), 0);
    const imageNodes = Array.from(document.querySelectorAll(".flow-node.image"));
    const selectedImageNode = imageNodes.find((node) => node.classList.contains("selected")) || null;
    const imageNodeViewportTarget = selectedImageNode || imageNodes[imageNodes.length - 1] || null;
    const latestImageNodeViewport = visibilityMetric(imageNodeViewportTarget, rect(".workflow-canvas"));
    const imageNodeViewportOk = imageNodes.length === 0 ? true : Boolean(agentDebugState?.imageNodeViewportOk && latestImageNodeViewport.ok);
    const flowNodes = Array.from(document.querySelectorAll(".flow-node"));
    const zoomText = String(element(".zoom-button")?.textContent || "");
    const zoomMatch = zoomText.match(/(\\d+(?:\\.\\d+)?)\\s*%/);
    const canvasZoomPercent = zoomMatch ? Number(zoomMatch[1]) : null;
    const canvasZoomScale = canvasZoomPercent == null ? null : metricRound(canvasZoomPercent / 100);
    const flowNodeMetrics = flowNodes.map((node, index) => {
      const box = node.getBoundingClientRect();
      const clipped = intersectRect(box, canvasRect);
      const area = rectArea(box);
      const visibleArea = rectArea(clipped);
      const style = getComputedStyle(node);
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const preview = node.querySelector(".node-image-preview") || node;
      const previewBox = preview.getBoundingClientRect();
      const previewCenter = { x: previewBox.left + previewBox.width / 2, y: previewBox.top + previewBox.height / 2 };
      const centerHitStack = hitStackAt(center.x, center.y);
      const previewHitStack = hitStackAt(previewCenter.x, previewCenter.y);
      const id = node.dataset.nodeId || "";
      return {
        index,
        node,
        id,
        type: node.classList.contains("image") ? "image" : "node",
        selected: node.classList.contains("selected"),
        box,
        clipped,
        area,
        visibleArea,
        visibleRatio: metricRound(visibleArea / Math.max(1, area)),
        visible: visibleArea >= 24 && style.display !== "none" && style.visibility !== "hidden",
        visuallyVisible: visibleArea >= 24 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.01,
        geometry: plainRect(box),
        clippedGeometry: plainRect(clipped),
        previewGeometry: plainRect(previewBox),
        computedStyle: visualStyle(node),
        previewComputedStyle: visualStyle(preview),
        centerPoint: { x: metricRound(center.x), y: metricRound(center.y) },
        previewCenterPoint: { x: metricRound(previewCenter.x), y: metricRound(previewCenter.y) },
        centerHitStack,
        previewHitStack,
        centerHitNodeId: centerHitStack.find((item) => item.nodeId)?.nodeId || "",
        previewHitNodeId: previewHitStack.find((item) => item.nodeId)?.nodeId || "",
        centerHitSelf: !centerHitStack.some((item) => item.nodeId) || centerHitStack.find((item) => item.nodeId)?.nodeId === id,
        previewHitSelf: !previewHitStack.some((item) => item.nodeId) || previewHitStack.find((item) => item.nodeId)?.nodeId === id
      };
    });
    const visibleFlowNodeMetrics = flowNodeMetrics.filter((item) => item.visible);
    const flowNodeVisualEvidence = flowNodeMetrics.map((item) => ({
      index: item.index,
      id: item.id,
      type: item.type,
      selected: item.selected,
      visible: item.visible,
      visuallyVisible: item.visuallyVisible,
      visibleRatio: item.visibleRatio,
      geometry: item.geometry,
      clippedGeometry: item.clippedGeometry,
      previewGeometry: item.previewGeometry,
      computedStyle: item.computedStyle,
      previewComputedStyle: item.previewComputedStyle,
      centerPoint: item.centerPoint,
      previewCenterPoint: item.previewCenterPoint,
      centerHitNodeId: item.centerHitNodeId,
      previewHitNodeId: item.previewHitNodeId,
      centerHitSelf: item.centerHitSelf,
      previewHitSelf: item.previewHitSelf,
      centerHitStack: item.centerHitStack,
      previewHitStack: item.previewHitStack
    }));
    const visibleNodeStyleFailures = flowNodeVisualEvidence.filter((item) => item.visible && (
      item.computedStyle?.display === "none" ||
      item.computedStyle?.visibility === "hidden" ||
      Number(item.computedStyle?.opacity || 0) <= 0.01
    ));
    const centerOccludedNodes = flowNodeVisualEvidence.filter((item) => item.visible && !item.centerHitSelf);
    const previewOccludedNodes = flowNodeVisualEvidence.filter((item) => item.visible && item.type === "image" && !item.previewHitSelf);
    const visualSurfaceMetrics = [
      ["shell", element(".ide-shell")],
      ["topbar", element(".ide-topbar")],
      ["canvas", element(".workflow-canvas")],
      ["agent", element(".project-agent-panel")],
      ["agent-feed", element(".agent-feed, .project-agent-feed")],
      ["composer", element(".agent-composer, .project-agent-composer")],
      ["auth-shell", element(".auth-shell")],
      ["auth-card", element(".auth-card")]
    ].map(([name, node]) => {
      const box = node?.getBoundingClientRect?.() || null;
      const style = visualStyle(node);
      const clipped = intersectRect(box, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight });
      const visibleRatio = metricRound(rectArea(clipped) / Math.max(1, rectArea(box)));
      return {
        name,
        present: Boolean(node),
        visible: Boolean(node && box && box.width >= 2 && box.height >= 2 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 0) > 0.01 && visibleRatio > 0.01),
        visibleRatio,
        geometry: plainRect(box),
        clippedGeometry: plainRect(clipped),
        computedStyle: style
      };
    });
    const visibleImageNodeCount = visibleFlowNodeMetrics.filter((item) => item.type === "image").length;
    const sampleImagePixels = async (image, assetPath = "", samplePolicy = {}) => {
      if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
        return { sampled: false, pixelOk: false, opaqueRatio: 0, channelSpread: 0, sampleSource: "none", error: "not-loaded" };
      }
      const sampleDrawable = (drawable) => {
        const transparentExpected = samplePolicy?.transparentExpected === true;
        const requestedOpaqueRatio = Number(samplePolicy?.minimumOpaqueRatio);
        const opaqueRatioThreshold = Number.isFinite(requestedOpaqueRatio)
          ? Math.max(0.001, Math.min(0.2, requestedOpaqueRatio))
          : transparentExpected
            ? 0.004
            : 0.2;
        const sourceWidth = Math.max(1, Number(drawable?.naturalWidth || drawable?.width || 1));
        const sourceHeight = Math.max(1, Number(drawable?.naturalHeight || drawable?.height || 1));
        const sourceArea = sourceWidth * sourceHeight;
        // A fixed 14x14 reduction can erase narrow title/body glyph strokes even
        // when the source PNG passes the full-resolution alpha/content gates.
        // Keep ordinary previews cheap, but give transparent layer assets enough
        // samples to retain content down to the existing 0.3% file-content floor.
        const sampleSize = transparentExpected
          ? Math.min(128, Math.max(64, Math.ceil(Math.sqrt(sourceArea / 32))))
          : Math.min(40, Math.max(18, Math.ceil(Math.sqrt(sourceArea / 512))));
        const sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = sampleSize;
        sampleCanvas.height = sampleSize;
        const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
        if (!context) return { sampled: false, pixelOk: false, opaqueRatio: 0, channelSpread: 0, sampleSource: "none", error: "no-context" };
        context.drawImage(drawable, 0, 0, sampleSize, sampleSize);
        const data = context.getImageData(0, 0, sampleSize, sampleSize).data;
        let opaque = 0;
        let minChannel = 255;
        let maxChannel = 0;
        let minVisibleX = sampleSize;
        let minVisibleY = sampleSize;
        let maxVisibleX = -1;
        let maxVisibleY = -1;
        const visibleSamples = [];
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3];
          if (alpha > 16) {
            opaque += 1;
            const pixelIndex = index / 4;
            const x = pixelIndex % sampleSize;
            const y = Math.floor(pixelIndex / sampleSize);
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            minChannel = Math.min(minChannel, red, green, blue);
            maxChannel = Math.max(maxChannel, red, green, blue);
            minVisibleX = Math.min(minVisibleX, x);
            minVisibleY = Math.min(minVisibleY, y);
            maxVisibleX = Math.max(maxVisibleX, x);
            maxVisibleY = Math.max(maxVisibleY, y);
            visibleSamples.push({ x, y, red, green, blue, alpha });
          }
        }
        const total = data.length / 4;
        const opaqueRatio = metricRound(opaque / Math.max(1, total));
        const channelSpread = opaque ? Math.round(maxChannel - minChannel) : 0;
        const representativeCount = Math.min(12, visibleSamples.length);
        const visibleSamplePoints = representativeCount
          ? Array.from({ length: representativeCount }, (_item, pointIndex) => {
              const sourceIndex = representativeCount === 1
                ? 0
                : Math.round(pointIndex * (visibleSamples.length - 1) / (representativeCount - 1));
              const point = visibleSamples[sourceIndex];
              return {
                x: metricRound((point.x + 0.5) / sampleSize),
                y: metricRound((point.y + 0.5) / sampleSize),
                red: point.red,
                green: point.green,
                blue: point.blue,
                alpha: point.alpha
              };
            })
          : [];
        const visibleBounds = opaque ? {
          left: metricRound(minVisibleX / sampleSize),
          top: metricRound(minVisibleY / sampleSize),
          right: metricRound((maxVisibleX + 1) / sampleSize),
          bottom: metricRound((maxVisibleY + 1) / sampleSize)
        } : null;
         return {
           sampled: true,
           pixelOk: opaqueRatio >= opaqueRatioThreshold && channelSpread >= 4,
           opaqueRatio,
           opaqueRatioThreshold,
           transparentExpected,
           channelSpread,
           sampleSize,
           visiblePixels: opaque,
           visibleBounds,
           visibleSamplePoints,
           sampleSource: "drawable",
           error: ""
         };
      };
      let bridgeError = "";
      if (assetPath && window.naimageConfig?.readAssetDataUrl) {
        try {
          const read = await window.naimageConfig.readAssetDataUrl({ path: assetPath });
          if (!read?.ok || !read?.dataUrl) throw new Error(read?.error || "asset bridge returned no data URL");
          const match = String(read.dataUrl).match(/^data:([^;,]+)?(;base64)?,([\\s\\S]*)$/);
          if (!match) throw new Error("asset bridge returned an invalid data URL");
          const mimeType = match[1] || "application/octet-stream";
          const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index) & 0xff;
          const blob = new Blob([bytes], { type: mimeType });
          const bitmap = await createImageBitmap(blob);
          const result = sampleDrawable(bitmap);
          if (typeof bitmap.close === "function") bitmap.close();
          return { ...result, sampleSource: "asset-bridge", assetPath };
        } catch (error) {
          bridgeError = error instanceof Error ? error.message : String(error);
        }
      }
      let fetchError = "";
      try {
        const source = image.currentSrc || image.src || "";
        // data: images are already decoded by the <img> element. Fetching them
        // needlessly routes the diagnostic through connect-src and produces CSP
        // errors even though canvas sampling below is valid and same-document.
        if (source && !/^data:/i.test(source) && typeof fetch === "function" && typeof createImageBitmap === "function") {
          const response = await fetch(source, { cache: "force-cache" });
          if (!response.ok) throw new Error("fetch " + response.status);
          const blob = await response.blob();
          const bitmap = await createImageBitmap(blob);
          const result = sampleDrawable(bitmap);
          if (typeof bitmap.close === "function") bitmap.close();
          return { ...result, sampleSource: "fetch", assetPath, bridgeError };
        }
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
      }
      try {
        return { ...sampleDrawable(image), sampleSource: "element", fetchError, bridgeError, assetPath };
      } catch (error) {
        return {
          sampled: false,
          pixelOk: false,
          opaqueRatio: 0,
          channelSpread: 0,
          sampleSource: "failed",
          assetPath,
          bridgeError,
          fetchError,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    };
    const imagePreviewMetricPromises = flowNodeMetrics
      .filter((item) => item.type === "image")
      .flatMap((item) =>
        Array.from(item.node.querySelectorAll(".node-image-preview img")).map(async (image, imageIndex) => {
          const box = image.getBoundingClientRect();
          const imageStyle = getComputedStyle(image);
          const clipped = intersectRect(box, canvasRect);
          const area = rectArea(box);
          const visibleArea = rectArea(clipped);
          const runtimeNode = agentDebugState?.nodes?.find((node) => node.id === item.id);
          const layoutGroup = Array.isArray(agentDebugState?.layoutGroups)
            ? agentDebugState.layoutGroups.find((group) => group?.hostNodeId === item.id)
            : null;
          const runtimeAssets = layoutGroup
            ? layoutGroup.memberNodeIds.flatMap((memberId) => agentDebugState?.nodes?.find((node) => node.id === memberId)?.assets || [])
            : (runtimeNode?.assets || []);
          const assetPath = String(runtimeAssets[imageIndex]?.path || "");
          const imageParams = runtimeNode?.imageParams || {};
          const layerRole = String(runtimeNode?.layerGroup?.role || imageParams.layerRole || "").toLowerCase();
          const transparentExpected = Boolean(
            (runtimeNode?.layerGroup && String(runtimeNode.layerGroup.role || "") !== "background") ||
            String(imageParams.background || "").toLowerCase() === "transparent" ||
            imageParams.transparentPreferred === true ||
            String(imageParams.layerRole || "").toLowerCase() === "cutout"
          );
          const minimumOpaqueRatio = transparentExpected
            ? layerRole === "text"
              ? 0.002
              : layerRole === "shadow"
                ? 0.003
                : 0.004
            : 0.2;
          const pixel = await sampleImagePixels(image, assetPath, { transparentExpected, minimumOpaqueRatio });
          return {
            nodeId: item.id || String(item.index),
            imageIndex,
            left: metricRound(box.left),
            top: metricRound(box.top),
            right: metricRound(box.right),
            bottom: metricRound(box.bottom),
            width: Math.round(box.width),
            height: Math.round(box.height),
            naturalWidth: Number(image.naturalWidth || 0),
            naturalHeight: Number(image.naturalHeight || 0),
            objectFit: imageStyle.objectFit || "",
            complete: Boolean(image.complete),
            visibleRatio: metricRound(visibleArea / Math.max(1, area)),
            visible: visibleArea >= 64,
            ...pixel
          };
        })
      );
    const imagePreviewMetrics = await Promise.all(imagePreviewMetricPromises);
    const visibleImagePreviewMetrics = imagePreviewMetrics.filter((item) => item.visible && item.visibleRatio >= 0.45 && item.width >= 12 && item.height >= 12);
    const visibleImagePreviewCount = visibleImagePreviewMetrics.length;
    const imagePreviewVisibleCountOk = visibleImageNodeCount === 0 || visibleImagePreviewCount >= 1;
    const imagePreviewLoadedOk = visibleImagePreviewMetrics.every((item) => item.complete && item.naturalWidth >= 2 && item.naturalHeight >= 2);
    const imagePreviewPixelSampleOk = visibleImagePreviewMetrics.every((item) => item.sampled && item.pixelOk);
    const imagePreviewVisualOk = imagePreviewVisibleCountOk && imagePreviewLoadedOk && imagePreviewPixelSampleOk;
    const previewDetailScale = Math.min(1, Math.max(0.28, Number(canvasZoomScale || 0.4)));
    const imagePreviewDetailThresholds = {
      minWidth: Math.round(Math.max(80, 250 * previewDetailScale)),
      minHeight: Math.round(Math.max(72, 235 * previewDetailScale)),
      minArea: Math.round(Math.max(7200, 76000 * previewDetailScale * previewDetailScale))
    };
    const imagePreviewDetailMetrics = visibleImagePreviewMetrics.map((item) => {
      const area = Math.round(Number(item.width || 0) * Number(item.height || 0));
      return {
        nodeId: item.nodeId,
        imageIndex: item.imageIndex,
        width: Number(item.width || 0),
        height: Number(item.height || 0),
        area,
        widthOk: Number(item.width || 0) >= imagePreviewDetailThresholds.minWidth,
        heightOk: Number(item.height || 0) >= imagePreviewDetailThresholds.minHeight,
        areaOk: area >= imagePreviewDetailThresholds.minArea
      };
    });
    const imagePreviewAreaMin = imagePreviewDetailMetrics.length
      ? Math.min(...imagePreviewDetailMetrics.map((item) => item.area))
      : 0;
    const imagePreviewDetailOk = visibleImageNodeCount === 0 || (
      visibleImagePreviewCount >= 1 &&
      imagePreviewDetailMetrics.every((item) => item.widthOk && item.heightOk && item.areaOk)
    );
    const selectedFlowNodeMetric =
      flowNodeMetrics.find((item) => item.selected) ||
      flowNodeMetrics.find((item) => item.id && item.id === String(agentDebugState?.selectedNodeId || ""));
    const sameStackedLayerGroup = (first, second) => {
      const firstGroup = String(first?.node?.dataset?.layerGroup || "");
      const secondGroup = String(second?.node?.dataset?.layerGroup || "");
      return Boolean(
        firstGroup &&
        firstGroup === secondGroup &&
        first?.node?.dataset?.layerDetached !== "true" &&
        second?.node?.dataset?.layerDetached !== "true"
      );
    };
    const rectGap = (first, second) => {
      if (!first || !second) return null;
      const dx = Math.max(0, Math.max(first.left, second.left) - Math.min(first.right, second.right));
      const dy = Math.max(0, Math.max(first.top, second.top) - Math.min(first.bottom, second.bottom));
      return metricRound(Math.hypot(dx, dy));
    };
    const selectedNeighborCandidates = selectedFlowNodeMetric
      ? flowNodeMetrics
          .filter((item) => item !== selectedFlowNodeMetric && !sameStackedLayerGroup(selectedFlowNodeMetric, item))
          .map((item) => ({
            id: item.id || String(item.index),
            type: item.type,
            visible: item.visible,
            gap: rectGap(selectedFlowNodeMetric.box, item.box)
          }))
          .filter((item) => item.gap != null)
          .sort((a, b) => Number(a.gap) - Number(b.gap))
      : [];
    const selectedNodeNearest = selectedNeighborCandidates[0] || null;
    const selectedNodeNearestVisible = selectedNeighborCandidates.find((item) => item.visible) || null;
    const selectedNodeNearestGap = selectedNodeNearest ? selectedNodeNearest.gap : null;
    const selectedNodeNearestVisibleGap = selectedNodeNearestVisible ? selectedNodeNearestVisible.gap : null;
    const selectedNodeSpacingOk = selectedNodeNearestVisibleGap == null || selectedNodeNearestVisibleGap >= 24;
    const selectedNodeId = String(agentDebugState?.selectedNodeId || selectedFlowNodeMetric?.id || "");
    const selectedNodeType = selectedFlowNodeMetric?.type || "";
    const selectedNodeVisibleRatio = selectedFlowNodeMetric ? selectedFlowNodeMetric.visibleRatio : null;
    const selectedNodeVisibleOk = !selectedFlowNodeMetric || (selectedFlowNodeMetric.visible && selectedFlowNodeMetric.visibleRatio >= 0.96);
    const selectedImageNodeViewportOk = selectedNodeType === "image" && selectedNodeVisibleOk;
    const selectedImagePreviewMetrics = imagePreviewMetrics.filter((item) => item.nodeId === selectedNodeId);
    const selectedImagePreviewVisibleMetrics = selectedImagePreviewMetrics.filter((item) => item.visible && item.visibleRatio >= 0.9);
    const selectedImagePreviewEffectiveArea = Math.round(selectedImagePreviewVisibleMetrics.reduce(
      (total, item) => total + Number(item.width || 0) * Number(item.height || 0) * Math.min(1, Math.max(0, Number(item.visibleRatio || 0))),
      0
    ));
    const selectedFlowVisualEvidence = flowNodeVisualEvidence.find((item) => item.id === selectedNodeId) || null;
    const selectedPreviewGeometry = selectedFlowVisualEvidence?.previewGeometry || null;
    const selectedImagePreviewGeometryOk = Boolean(
      selectedPreviewGeometry &&
      Number(selectedPreviewGeometry.width || 0) >= 120 &&
      Number(selectedPreviewGeometry.height || 0) >= 90 &&
      selectedImagePreviewEffectiveArea >= 12000
    );
    const selectedImagePreviewLoadedOk = selectedImagePreviewMetrics.length > 0 && selectedImagePreviewMetrics.every((item) => item.complete && item.naturalWidth >= 2 && item.naturalHeight >= 2);
    const selectedImagePreviewDomPixelOk = selectedImagePreviewMetrics.length > 0 && selectedImagePreviewMetrics.every((item) => item.sampled && item.pixelOk);
    const selectedImagePreviewFullyVisibleOk = selectedImagePreviewMetrics.length > 0 && selectedImagePreviewMetrics.every((item) => item.visibleRatio >= 0.9);
    const nodeOverlapPairs = [];
    let nodeOverlapAreaMax = 0;
    let nodeOverlapRatioMax = 0;
    for (let i = 0; i < visibleFlowNodeMetrics.length; i += 1) {
      for (let j = i + 1; j < visibleFlowNodeMetrics.length; j += 1) {
        const first = visibleFlowNodeMetrics[i];
        const second = visibleFlowNodeMetrics[j];
        if (sameStackedLayerGroup(first, second)) continue;
        const overlap = intersectRect(first.clipped || first.box, second.clipped || second.box);
        const area = rectArea(overlap);
        const ratio = metricRound(area / Math.max(1, Math.min(first.visibleArea || first.area, second.visibleArea || second.area)));
        if (area > nodeOverlapAreaMax) nodeOverlapAreaMax = area;
        if (ratio > nodeOverlapRatioMax) nodeOverlapRatioMax = ratio;
        if (area >= 18 && ratio >= 0.012) {
          nodeOverlapPairs.push({
            first: first.id || String(first.index),
            second: second.id || String(second.index),
            area: Math.round(area),
            ratio
          });
        }
      }
    }
    const nodeTitleMetrics = flowNodeMetrics.map((item) => {
      const title = item.node.classList.contains("layer-group-stacked")
        ? item.node.querySelector(".node-layer-member-tab > span")
        : item.node.querySelector(".node-title-block strong") || item.node.querySelector(".node-title-block");
      const titleBox = title?.getBoundingClientRect();
      const visibleBox = intersectRect(titleBox, item.box);
      const titleArea = rectArea(titleBox);
      const visibleRatio = metricRound(rectArea(visibleBox) / Math.max(1, titleArea));
      const textClipped = Boolean(title && (title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1));
      const text = String(title?.textContent || "").trim();
      const titleAttr = String(title?.getAttribute("title") || "").trim();
      const titleTooltipOk = !textClipped || Boolean(titleAttr && titleAttr === text);
      return {
        id: item.id || String(item.index),
        type: item.type,
        visible: item.visible,
        visibleRatio,
        textClipped,
        titleTooltipOk,
        width: Math.round(titleBox?.width || 0),
        height: Math.round(titleBox?.height || 0)
      };
    });
    const nodeTitleVisibleRatioMin = nodeTitleMetrics.length
      ? Math.min(...nodeTitleMetrics.map((item) => item.visibleRatio))
      : 1;
    const nodeTitleTextClippedCount = nodeTitleMetrics.filter((item) => item.textClipped).length;
    const visibleNodeTitleMetrics = nodeTitleMetrics.filter((item) => item.visible);
    const visibleNodeTitleTextClippedCount = visibleNodeTitleMetrics.filter((item) => item.textClipped).length;
    const nodeTitleTextClippingAccessibleOk = nodeTitleMetrics.every((item) => item.titleTooltipOk);
    const nodeTitleReadableHeightMin = Math.max(5, Math.round(16 * Math.min(1, Math.max(0.28, Number(canvasZoomScale || 0.4)))));
    const visibleNodeTitleHeightMin = visibleNodeTitleMetrics.length
      ? Math.min(...visibleNodeTitleMetrics.map((item) => item.height))
      : 0;
    const visibleNodeTitlesLegibleOk = visibleNodeTitleMetrics.every((item) =>
      item.visibleRatio >= 0.96 && item.width >= 16 && item.height >= nodeTitleReadableHeightMin
    );
    const nodeTitlesVisibleOk = nodeTitleMetrics.every((item) => item.visibleRatio >= 0.96 && item.width >= 16 && item.height >= 5);
    const selectedNodeTitleMetric = selectedFlowNodeMetric
      ? nodeTitleMetrics.find((item) => item.id === (selectedFlowNodeMetric.id || String(selectedFlowNodeMetric.index)))
      : null;
    const selectedNodeTitleVisibleOk = !selectedFlowNodeMetric || Boolean(
      selectedNodeTitleMetric &&
      selectedNodeTitleMetric.visibleRatio >= 0.96 &&
      selectedNodeTitleMetric.width >= 16 &&
      selectedNodeTitleMetric.height >= nodeTitleReadableHeightMin &&
      selectedNodeTitleMetric.titleTooltipOk
    );
    const selectedImagePreviewDetailOk = Boolean(
      selectedNodeType === "image" &&
      selectedNodeVisibleOk &&
      selectedImageNodeViewportOk &&
      selectedNodeTitleVisibleOk &&
      selectedImagePreviewGeometryOk &&
      selectedImagePreviewLoadedOk &&
      selectedImagePreviewFullyVisibleOk
    );
    const composerNodeOverlaps = composerRect
      ? visibleFlowNodeMetrics
          .map((item) => {
            const overlap = intersectRect(item.clipped || item.box, composerRect);
            const area = rectArea(overlap);
            return {
              id: item.id || String(item.index),
              type: item.type,
              area: Math.round(area),
              ratio: metricRound(area / Math.max(1, item.visibleArea || item.area))
            };
          })
          .filter((item) => item.area >= 12 && item.ratio >= 0.01)
      : [];
    const composerNodeOverlapRatioMax = composerNodeOverlaps.length
      ? Math.max(...composerNodeOverlaps.map((item) => item.ratio))
      : 0;
    const selectedNodeComposerOverlap = selectedFlowNodeMetric && composerRect ? intersectRect(selectedFlowNodeMetric.clipped || selectedFlowNodeMetric.box, composerRect) : null;
    const selectedNodeComposerOverlapArea = Math.round(rectArea(selectedNodeComposerOverlap));
    const selectedNodeComposerOverlapRatio = metricRound(selectedNodeComposerOverlapArea / Math.max(1, selectedFlowNodeMetric?.visibleArea || selectedFlowNodeMetric?.area || 1));
    const selectedNodeComposerOverlapOk = selectedNodeComposerOverlapArea <= 4;
    const nodeOverlapOk = nodeOverlapPairs.length === 0;
    const composerNodeOverlapOk = composerNodeOverlaps.length === 0;
    const canvasReadabilityOk = nodeOverlapOk && nodeTitlesVisibleOk && visibleNodeTitlesLegibleOk && nodeTitleTextClippingAccessibleOk && imagePreviewDetailOk && composerNodeOverlapOk;
    const requiredVisualSurfaceNames = authGateVisible ? ["auth-shell", "auth-card"] : ["shell", "canvas"];
    const agentCollapsedForEvidence = Boolean(mainNode?.classList.contains("agent-collapsed"));
    const visualSurfaceFailures = visualSurfaceMetrics.filter((item) =>
      (requiredVisualSurfaceNames.includes(item.name) && !item.visible) ||
      (!agentCollapsedForEvidence && ["agent", "composer"].includes(item.name) && item.present && !item.visible)
    );
    const domVisualEvidenceOk = stateLayerConsistencyOk && visibleNodeStyleFailures.length === 0 && visualSurfaceFailures.length === 0;
    const compactCanvasDensityOk = canvasReadabilityOk && selectedNodeSpacingOk && (imageNodeLayouts.length === 0 || visibleImageNodeCount >= 1);
    const canvasZoomUsableOk = canvasZoomPercent != null && canvasZoomPercent >= 20 && canvasZoomPercent <= 160;
    const visibleImageNodeCountOk = imageNodeLayouts.length === 0 || visibleImageNodeCount >= 1;
    const selectedImageFocusOk =
      selectedNodeType === "image" &&
      selectedNodeVisibleOk &&
      selectedNodeTitleVisibleOk &&
      selectedNodeSpacingOk &&
      selectedNodeComposerOverlapOk &&
      canvasZoomUsableOk &&
      visibleImageNodeCountOk &&
      selectedImageNodeViewportOk;
    const agentFeedScrolledToBottom = !agentFeedNode ||
      agentFeedNode.scrollHeight <= agentFeedNode.clientHeight + 2 ||
      Math.abs(agentFeedNode.scrollHeight - agentFeedNode.scrollTop - agentFeedNode.clientHeight) <= 4;
    const lastAgentMessageBottomGap = agentFeedRect && lastAgentMessageRect ? metricRound(agentFeedRect.bottom - lastAgentMessageRect.bottom) : null;
    const lastAgentMessageBottomVisible = !lastAgentMessageRect ||
      Boolean(agentFeedRect && lastAgentMessageRect.bottom <= agentFeedRect.bottom + 4 && lastAgentMessageRect.bottom >= agentFeedRect.top - 4);
    const composerLastMessageOverlapArea = Math.round(rectArea(intersectRect(composerRect, lastAgentMessageRect)));
    const composerDoesNotCoverLastMessage = composerLastMessageOverlapArea <= 4;
    const messageLayoutSelector = [
      ".agent-message",
      ".agent-message .markdown-body",
      ".agent-tool-trace",
      ".agent-thinking-block",
      ".markdown-code-block",
      ".markdown-code-block pre",
      ".agent-message-paste-block"
    ].join(", ");
    const messageLayoutMinWidth = Math.round(Math.max(140, Math.min(240, Number(agentFeedRect?.width || window.innerWidth) - 32)));
    const classifyMessageLayoutNode = (node) => {
      if (node.matches(".agent-message")) return "message";
      if (node.matches(".agent-tool-trace")) return "tool-trace";
      if (node.matches(".agent-thinking-block")) return "thinking";
      if (node.matches(".markdown-code-block pre")) return "code-pre";
      if (node.matches(".markdown-code-block")) return "code-block";
      if (node.matches(".agent-message-paste-block")) return "paste-block";
      if (node.matches(".markdown-body")) return "markdown";
      return "content";
    };
    const agentMessageLayoutMetrics = Array.from(document.querySelectorAll(messageLayoutSelector)).map((node, index) => {
      const box = node.getBoundingClientRect();
      const kind = classifyMessageLayoutNode(node);
      const horizontalOverflow = Number(node.scrollWidth || 0) > Number(node.clientWidth || 0) + 2;
      const insideFeedX = !agentFeedRect || (box.left >= agentFeedRect.left - 1 && box.right <= agentFeedRect.right + 1);
      const visibleY = !agentFeedRect || (box.bottom >= agentFeedRect.top - 1 && box.top <= agentFeedRect.bottom + 1);
      const allowHorizontalScroll = kind === "code-pre";
      const minWidth = kind === "paste-block"
        ? 72
        : kind === "code-pre"
          ? Math.min(180, messageLayoutMinWidth)
          : kind === "tool-trace"
            ? Math.min(120, messageLayoutMinWidth)
            : messageLayoutMinWidth;
      const minHeight = kind === "message" ? 18 : kind === "code-pre" ? 28 : 12;
      return {
        index,
        kind,
        left: metricRound(box.left),
        top: metricRound(box.top),
        right: metricRound(box.right),
        bottom: metricRound(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
        clientWidth: Number(node.clientWidth || 0),
        scrollWidth: Number(node.scrollWidth || 0),
        insideFeedX,
        visibleY,
        horizontalOverflow,
        allowHorizontalScroll,
        widthOk: box.width >= minWidth,
        heightOk: box.height >= minHeight,
        overflowOk: allowHorizontalScroll || !horizontalOverflow
      };
    });
    const agentMessageLayoutFailures = agentMessageLayoutMetrics.filter((item) =>
      !item.insideFeedX || !item.widthOk || !item.heightOk || !item.overflowOk
    );
    const agentMessageLayoutOk = agentMessageLayoutFailures.length === 0;
    const agentToolTraceMetrics = agentMessageLayoutMetrics.filter((item) => item.kind === "tool-trace");
    const agentToolTraceLayoutOk = agentToolTraceMetrics.every((item) => item.insideFeedX && item.widthOk && item.heightOk && item.overflowOk);
    const agentToolTraceTexts = Array.from(document.querySelectorAll(".agent-tool-trace")).map((node) =>
      String(node.textContent || "").replace(/\s+/g, " ").trim()
    );
    const agentTimelineRows = Array.from(document.querySelectorAll(".agent-message"));
    const imageGenStartIndex = agentTimelineRows.findIndex((row) => Boolean(row.querySelector('.agent-tool-trace.is-image-gen[data-tool-stage="start"]')));
    const imageGenResultIndex = agentTimelineRows.findLastIndex((row) => Boolean(row.querySelector('.agent-tool-trace.is-image-gen[data-tool-stage="result"]')));
    const imageGenFinalIndex = agentTimelineRows.findLastIndex((row) =>
      row.matches(".agent-message.assistant") &&
      !row.querySelector(".agent-tool-trace") &&
      String(row.textContent || "").trim().length > 0
    );
    const imageGenToolEvents = agentTimelineRows.flatMap((row) =>
      Array.from(row.querySelectorAll('.agent-tool-trace.is-image-gen[data-tool-stage]')).map((trace) => ({
        stage: String(trace.getAttribute("data-tool-stage") || ""),
        operationId: String(trace.getAttribute("data-tool-operation") || "")
      }))
    );
    const imageGenToolStages = imageGenToolEvents.map((event) => event.stage);
    const imageGenOperations = new Map();
    for (const event of imageGenToolEvents) {
      if (!event.operationId) continue;
      const stages = imageGenOperations.get(event.operationId) || [];
      stages.push(event.stage);
      imageGenOperations.set(event.operationId, stages);
    }
    const agentImageGenToolLifecycleOrderOk = imageGenToolEvents.length >= 2 &&
      imageGenToolEvents.every((event) => Boolean(event.operationId)) &&
      Array.from(imageGenOperations.values()).every((stages) => stages.length === 2 && stages[0] === "start" && stages[1] === "result");
    const agentImageGenTimelineOrderOk = imageGenStartIndex >= 0 && imageGenResultIndex > imageGenStartIndex && imageGenFinalIndex > imageGenResultIndex;
    const agentToolTraceOperationNodeCount = document.querySelectorAll(".agent-tool-trace-operation").length;
    const agentToolTraceLeakedTexts = agentToolTraceTexts.filter((text) =>
      /(operation=|kind=|style=|effect=|strength=|preset=|nodeId=|sourceId=|targetId=|parentId=|画布列表\s*·)/i.test(text)
    );
    const agentToolTraceOperationHiddenOk = agentToolTraceLeakedTexts.length === 0 && agentToolTraceOperationNodeCount === 0;
    const cssPx = (value) => {
      const parsed = Number.parseFloat(String(value || "0"));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const visibleBox = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const agentToolTraceStyleMetrics = Array.from(document.querySelectorAll(".agent-tool-trace")).map((node, index) => {
      const style = getComputedStyle(node);
      const beforeStyle = getComputedStyle(node, "::before");
      const afterStyle = getComputedStyle(node, "::after");
      const left = cssPx(style.borderLeftWidth);
      const right = cssPx(style.borderRightWidth);
      const top = cssPx(style.borderTopWidth);
      const bottom = cssPx(style.borderBottomWidth);
      const asymmetricLeftRule = left >= 1 && left > Math.max(right, top, bottom) + 0.5;
      const pseudoRail = (pseudoStyle) => {
        const hasContent = pseudoStyle.content && pseudoStyle.content !== "none" && pseudoStyle.content !== "normal";
        if (!hasContent || pseudoStyle.display === "none" || pseudoStyle.visibility === "hidden") return false;
        const pseudoWidth = cssPx(pseudoStyle.width);
        const pseudoHeight = cssPx(pseudoStyle.height);
        const pseudoBorderLeft = cssPx(pseudoStyle.borderLeftWidth);
        return (pseudoWidth > 0 && pseudoWidth <= 5 && pseudoHeight >= 12) || pseudoBorderLeft >= 1;
      };
      return {
        index,
        visible: visibleBox(node),
        borderLeftWidth: metricRound(left),
        borderRightWidth: metricRound(right),
        borderTopWidth: metricRound(top),
        borderBottomWidth: metricRound(bottom),
        borderLeftStyle: style.borderLeftStyle,
        borderLeftColor: style.borderLeftColor,
        boxShadow: style.boxShadow,
        beforeDisplay: beforeStyle.display,
        beforeContent: beforeStyle.content,
        beforeWidth: beforeStyle.width,
        beforeHeight: beforeStyle.height,
        afterDisplay: afterStyle.display,
        afterContent: afterStyle.content,
        afterWidth: afterStyle.width,
        afterHeight: afterStyle.height,
        asymmetricLeftRule,
        pseudoLeftRule: pseudoRail(beforeStyle) || pseudoRail(afterStyle)
      };
    });
    const agentToolTraceNoLeftRuleOk = agentToolTraceStyleMetrics.every((item) =>
      !item.visible ||
      item.borderLeftStyle === "none" ||
      (item.borderLeftWidth <= 1 && !item.asymmetricLeftRule)
    );
    const agentToolTraceNoPseudoLeftRuleOk = agentToolTraceStyleMetrics.every((item) => !item.visible || !item.pseudoLeftRule);
    const agentToolTraceStructureMetrics = Array.from(document.querySelectorAll(".agent-tool-trace")).map((node, index) => {
      const title = node.querySelector(".agent-tool-trace-title");
      const titlePrefix = title?.querySelector("span");
      const titleName = title?.querySelector("b");
      const brief = node.querySelector(".agent-tool-trace-brief");
      const timer = node.querySelector(".agent-tool-imagegen-timer");
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      const running = Boolean(node.closest(".agent-message.running"));
      const imageGen = /Image Gen/i.test(text);
      const timerText = String(timer?.textContent || "").replace(/\s+/g, " ").trim();
      return {
        index,
        visible: visibleBox(node),
        text,
        titlePrefix: String(titlePrefix?.textContent || "").trim(),
        titleName: String(titleName?.textContent || "").trim(),
        briefPresent: Boolean(brief),
        running,
        imageGen,
        timerText,
        structureOk: imageGen && timer
          ? Boolean(!brief && /^Image Gen (?:正在绘图\\s*\\d+s|绘图请求\\s*·\\s*\\d+s?)$/i.test(timerText) && !/正在使用工具|Brief/i.test(String(title?.textContent || "")))
          : Boolean(title && titlePrefix && titleName?.textContent?.trim() && !brief && !/Brief/i.test(text)),
        imageGenTimerOk: !running || !imageGen || /Image Gen 正在绘图\\s*\\d+s/i.test(String(timer?.textContent || ""))
      };
    });
    const agentToolTraceTitleBriefOk = agentToolTraceStructureMetrics.every((item) => !item.visible || item.structureOk);
    const agentImageGenTimerOk = agentToolTraceStructureMetrics.every((item) => !item.visible || item.imageGenTimerOk);
    const agentMessageTimelineMetrics = Array.from(document.querySelectorAll(".agent-message")).map((node, index) => {
      const style = getComputedStyle(node);
      return {
        index,
        visible: visibleBox(node),
        borderLeftWidth: metricRound(cssPx(style.borderLeftWidth)),
        borderLeftStyle: style.borderLeftStyle,
        borderLeftColor: style.borderLeftColor
      };
    });
    const agentTimelineLeftLineOk = agentMessageTimelineMetrics.some((item) =>
      item.visible && item.borderLeftWidth >= 0.5 && item.borderLeftStyle !== "none"
    );
    const agentThinkingBlockMetrics = Array.from(document.querySelectorAll(".agent-thinking-block")).map((node, index) => {
      const style = getComputedStyle(node);
      const message = node.closest(".agent-message");
      return {
        index,
        visible: visibleBox(node),
        open: Boolean(node.open),
        messageRunning: Boolean(message?.classList.contains("running")),
        messageDone: Boolean(message?.classList.contains("done")),
        borderLeftWidth: metricRound(cssPx(style.borderLeftWidth)),
        borderLeftStyle: style.borderLeftStyle,
        boxShadow: style.boxShadow,
        text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160)
      };
    });
    const agentThinkingNoLeftRuleOk = agentThinkingBlockMetrics.every((item) =>
      !item.visible || item.borderLeftStyle === "none" || item.borderLeftWidth <= 0.5
    );
    const agentThinkingBusy = agentDebugState?.agentStatus === "thinking" || agentDebugState?.agentStatus === "editing";
    const agentRunningThinkingOpenOk = !agentThinkingBusy || agentThinkingBlockMetrics.some((item) =>
      item.visible && item.messageRunning && item.open
    );
    const agentDoneThinkingCollapsedOk = agentThinkingBlockMetrics.every((item) =>
      !item.visible || !item.messageDone || !item.open
    );
    const agentImageGenProgressTexts = Array.from(document.querySelectorAll(".agent-tool-trace, .agent-tool-imagegen-timer, .agent-status, .agent-message.running")).map((node) =>
      String(node.textContent || "").replace(/\s+/g, " ").trim()
    ).filter(Boolean);
    const agentImageGenStillRunningTexts = agentImageGenProgressTexts.filter((text) => /仍在执行/.test(text));
    const agentImageGenStillRunningTextAbsent = agentImageGenStillRunningTexts.length === 0;
    const markdownCodeBlockMetrics = agentMessageLayoutMetrics.filter((item) => item.kind === "code-block" || item.kind === "code-pre");
    const markdownCodeBlockLayoutOk = markdownCodeBlockMetrics.every((item) => item.insideFeedX && item.widthOk && item.heightOk && item.overflowOk);
    const markdownCodeHeaderMetrics = Array.from(document.querySelectorAll(".markdown-code-block")).map((block, index) => {
      const blockBox = block.getBoundingClientRect();
      const head = block.querySelector(".markdown-code-head");
      const button = block.querySelector(".markdown-code-head button");
      const label = block.querySelector(".markdown-code-head span");
      const headBox = head?.getBoundingClientRect();
      const buttonBox = button?.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect();
      const headInsideBlock = Boolean(headBox) &&
        headBox.left >= blockBox.left - 1 &&
        headBox.right <= blockBox.right + 1 &&
        headBox.top >= blockBox.top - 1 &&
        headBox.bottom <= blockBox.bottom + 1;
      const buttonInsideHead = Boolean(headBox && buttonBox) &&
        buttonBox.left >= headBox.left - 1 &&
        buttonBox.right <= headBox.right + 1 &&
        buttonBox.top >= headBox.top - 1 &&
        buttonBox.bottom <= headBox.bottom + 1;
      const labelButtonOverlap = Math.round(rectArea(intersectRect(labelBox, buttonBox)));
      return {
        index,
        blockWidth: Math.round(blockBox.width),
        headHeight: Math.round(headBox?.height || 0),
        buttonWidth: Math.round(buttonBox?.width || 0),
        buttonHeight: Math.round(buttonBox?.height || 0),
        headInsideBlock,
        buttonInsideHead,
        labelButtonOverlap,
        ok: Boolean(headBox && buttonBox) &&
          headInsideBlock &&
          buttonInsideHead &&
          headBox.height >= 28 &&
          buttonBox.width >= 24 &&
          buttonBox.height >= 24 &&
          labelButtonOverlap <= 2
      };
    });
    const markdownCodeHeaderPolishOk = markdownCodeHeaderMetrics.every((item) => item.ok);
    const agentPasteBlockMetrics = agentMessageLayoutMetrics.filter((item) => item.kind === "paste-block");
    const agentPasteBlockLayoutOk = agentPasteBlockMetrics.every((item) => item.insideFeedX && item.widthOk && item.heightOk && item.overflowOk);
    const composerWithinAgentOk = Boolean(agentSurfaceRect && composerRect) &&
      composerRect.left >= agentSurfaceRect.left - 1 &&
      composerRect.right <= agentSurfaceRect.right + 1 &&
      composerRect.top >= agentSurfaceRect.top - 1 &&
      composerRect.bottom <= agentSurfaceRect.bottom + 1;
    const agentComposerBottomGap = agentSurfaceRect && composerRect ? metricRound(agentSurfaceRect.bottom - composerRect.bottom) : null;
    const agentNodeComposerMode = Boolean(element(".project-agent-panel .project-agent-composer"));
    const agentComposerBottomPinned = agentComposerBottomGap != null && agentComposerBottomGap >= -1 && agentComposerBottomGap <= (agentNodeComposerMode ? 18 : 2);
    const composerControlsVisibleOk = agentNodeComposerMode
      ? Boolean(composerRect && composerTextareaRect && composerToolbarRect && sendButtonRect) &&
        composerTextareaRect.height >= 52 &&
        composerToolbarRect.height >= 24 &&
        sendButtonRect.width >= 24 &&
        sendButtonRect.height >= 24 &&
        composerTextareaRect.left >= composerRect.left - 1 &&
        composerTextareaRect.right <= composerRect.right + 1 &&
        composerToolbarRect.left >= composerRect.left - 1 &&
        composerToolbarRect.right <= composerRect.right + 1
      : Boolean(composerRect && composerInputRect && composerTextareaRect && composerToolbarRect && sendButtonRect) &&
        composerInputRect.left >= composerRect.left - 1 &&
        composerInputRect.right <= composerRect.right + 1 &&
        composerTextareaRect.height >= 52 &&
        composerToolbarRect.height >= 28 &&
        composerToolbarRect.bottom <= composerRect.bottom + 1 &&
        sendButtonRect.width >= 28 &&
        sendButtonRect.height >= 28 &&
        sendButtonRect.right <= composerRect.right + 1 &&
        sendButtonRect.bottom <= composerRect.bottom + 1;
    const composerViewportVisibleOk = Boolean(composerRect && composerTextareaRect && composerToolbarRect && sendButtonRect) &&
      withinViewport(composerRect, 1) &&
      withinViewport(composerTextareaRect, 1) &&
      withinViewport(composerToolbarRect, 1) &&
      withinViewport(sendButtonRect, 1);
    const compactViewportFitOk =
      !documentVerticalOverflow &&
      !bodyVerticalOverflow &&
      !shellVerticalOverflow &&
      !mainVerticalOverflow &&
      !topbarVerticalOverflow &&
      topbarControlsDockedOk &&
      (!agentSurfaceRect || withinViewport(agentSurfaceRect, 1)) &&
      (!composerRect || composerViewportVisibleOk);
    const agentTimelineBottomOk =
      agentFeedScrolledToBottom &&
      lastAgentMessageBottomVisible &&
      composerDoesNotCoverLastMessage &&
      composerWithinAgentOk &&
      agentComposerBottomPinned &&
      composerControlsVisibleOk &&
      composerViewportVisibleOk;
    const agentWorkflowClearTool = agentProgress.some((item) => {
      const input = item?.input && typeof item.input === "object" ? item.input : {};
      return item?.tool === "workflow" && (item?.operation === "clear_canvas" || input.operation === "clear_canvas");
    });
    const agentModelRetry = agentProgress.some((item) => item?.phase === "model-retry" || item?.phase === "model-force");
    const agentBusy = agentDebugState?.agentStatus === "thinking" || agentDebugState?.agentStatus === "editing";
    const agentStatusText = String(agentStatusNode?.textContent || "").replace(/\\s+/g, " ").trim();
    const agentRunningStatusOk = Boolean(agentBusy && agentStatusNode && agentStatusRect?.width && agentStatusRect.height >= 24 && /(思考|执行|操作|生成|整理|处理|正在)/.test(agentStatusText));
    const visibleImageGenTimers = Array.from(document.querySelectorAll(".agent-tool-imagegen-timer")).filter((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const dynamicAgentStatusVisible = Boolean(
      agentStatusNode &&
      agentStatusRect?.width &&
      agentStatusRect.height > 0 &&
      /(思考|执行|操作|生成|整理|处理|正在|工作|输出|请求)/.test(agentStatusText)
    );
    const agentImageGenDynamicStatusOwners = [
      ...visibleImageGenTimers.map((node) => ({ kind: "image-gen-timer", text: String(node.textContent || "").replace(/\\s+/g, " ").trim() })),
      ...(dynamicAgentStatusVisible ? [{ kind: "agent-status", text: agentStatusText }] : []),
    ];
    const agentImageGenSingleDynamicStatusOk = !imageGenTimerRect || agentImageGenDynamicStatusOwners.length === 1;
    const stopButtonOk = Boolean(
      agentBusy &&
      sendButton &&
      (sendButton.classList.contains("is-stop") || sendButton.classList.contains("danger-secondary") || sendButton.classList.contains("ui-action-danger")) &&
      sendButton.getAttribute("aria-label") === "停止处理" &&
      sendButton.getAttribute("title") === "停止处理" &&
      !sendButton.disabled &&
      sendButtonRect &&
      sendButtonRect.width >= 24 &&
      sendButtonRect.height >= 24
    );
    const visibleRunningTimelineNode = Boolean(
      runningMessageNode &&
      runningDotRect &&
      runningDotRect.width >= 7 &&
      runningDotRect.height >= 7 &&
      runningMessageRect &&
      withinViewport(runningDotRect, 2)
    );
    const runningTimelineDotOk = Boolean(
      agentBusy &&
      runningMessageRect &&
      withinViewport(runningMessageRect, 2) &&
      visibleRunningTimelineNode
    );
    const composerBusyPlaceholderOk = Boolean(
      agentBusy &&
      composerTextarea &&
      ["补充要求...", "继续描述你的画面目标...", "描述工作内容，初始化当前 Agent..."].includes(composerTextarea.getAttribute("placeholder") || "") &&
      !composerTextarea.disabled &&
      composerTextareaRect &&
      composerTextareaRect.height >= 52
    );
    const supplementButtonGap = sendButtonRect && supplementButtonRect ? metricRound(supplementButtonRect.left - sendButtonRect.right) : null;
    const supplementButtonVisibleOk = Boolean(
      agentBusy &&
      supplementButton &&
      !supplementButton.disabled &&
      supplementButton.getAttribute("aria-label") === "发送补充" &&
      supplementButton.getAttribute("title") === "发送补充" &&
      supplementButtonRect &&
      supplementButtonRect.width >= 28 &&
      supplementButtonRect.height >= 28 &&
      composerRect &&
      supplementButtonRect.left >= composerRect.left - 1 &&
      supplementButtonRect.right <= composerRect.right + 1 &&
      withinViewport(supplementButtonRect, 1)
    );
    const supplementButtonPairOk = Boolean(stopButtonOk && supplementButtonVisibleOk && supplementButtonGap != null && supplementButtonGap >= 2);
    const supplementDraftPromptPresent = Boolean(composerTextarea && String(composerTextarea.value || "").includes("AIDEBUG_BUSY_DRAFT_"));
    const agentRunningUiOk = agentBusy && agentRunningStatusOk && stopButtonOk && composerBusyPlaceholderOk && composerControlsVisibleOk;
    const agentRunningSupplementDraftOk = agentRunningUiOk && supplementButtonPairOk && supplementDraftPromptPresent && composerViewportVisibleOk && agentTimelineBottomOk;
    const referenceThumbNodes = Array.from(document.querySelectorAll(".agent-reference-strip span"));
    const referenceRemoveButtons = Array.from(document.querySelectorAll(".agent-reference-strip span > button"));
    const referenceImageCount = referenceThumbNodes.length;
    const referenceStripToolbarOverlapArea = Math.round(rectArea(intersectRect(referenceStripRect, composerToolbarRect)));
    const referenceStripSendOverlapArea = Math.round(rectArea(intersectRect(referenceStripRect, sendButtonRect)));
    const referenceStripSupplementOverlapArea = Math.round(rectArea(intersectRect(referenceStripRect, supplementButtonRect)));
    const referenceStripToolbarGap = referenceStripRect && composerToolbarRect ? metricRound(composerToolbarRect.top - referenceStripRect.bottom) : null;
    const referenceThumbMetrics = await Promise.all(referenceThumbNodes.map(async (node, index) => {
      const box = node.getBoundingClientRect();
      const image = node.querySelector("img");
      const imageBox = image?.getBoundingClientRect();
      const remove = node.querySelector("button");
      const removeBox = remove?.getBoundingClientRect();
      const style = getComputedStyle(node);
      const radius = Math.max(
        parseFloat(style.borderTopLeftRadius || "0"),
        parseFloat(style.borderTopRightRadius || "0"),
        parseFloat(style.borderBottomRightRadius || "0"),
        parseFloat(style.borderBottomLeftRadius || "0")
      );
      const pixel = await sampleImagePixels(image);
      const size = Math.min(Number(box.width || 0), Number(box.height || 0));
      const removeSize = Math.max(Number(removeBox?.width || 0), Number(removeBox?.height || 0));
      return {
        index,
        width: Math.round(box.width),
        height: Math.round(box.height),
        radius: metricRound(radius),
        squareOk: Math.abs(box.width - box.height) <= 1 && box.width >= 38 && box.width <= 48,
        imageWidth: Math.round(imageBox?.width || 0),
        imageHeight: Math.round(imageBox?.height || 0),
        imageLoaded: Boolean(image && image.complete && image.naturalWidth >= 2 && image.naturalHeight >= 2),
        pixelOk: Boolean(pixel.sampled && pixel.pixelOk),
        pixel,
        removeWidth: Math.round(removeBox?.width || 0),
        removeHeight: Math.round(removeBox?.height || 0),
        removeRatio: metricRound(removeSize / Math.max(1, size)),
        removeLabelOk: Boolean(remove && remove.getAttribute("aria-label") === "移除参考图" && remove.getAttribute("title") === "移除参考图"),
        removeInside: Boolean(
          removeBox &&
          removeBox.left >= box.left + 1 &&
          removeBox.top >= box.top + 1 &&
          removeBox.right <= box.right - 1 &&
          removeBox.bottom <= box.bottom - 1
        )
      };
    }));
    const referenceThumbsVisibleOk =
      referenceImageCount > 0 &&
      referenceThumbNodes.every((node) => {
        const box = node.getBoundingClientRect();
        const image = node.querySelector("img");
        const imageBox = image?.getBoundingClientRect();
        return box.width >= 36 && box.height >= 36 && withinViewport(box, 1) && imageBox && imageBox.width >= 30 && imageBox.height >= 30;
      });
    const referenceThumbVisualOk =
      referenceImageCount > 0 &&
      referenceThumbMetrics.every((item) => item.imageLoaded && item.pixelOk);
    const referenceThumbPolishOk =
      referenceImageCount > 0 &&
      referenceThumbMetrics.every((item) =>
        item.squareOk &&
        item.radius <= 8.5 &&
        item.removeInside &&
        item.removeLabelOk &&
        item.removeRatio >= 0.3 &&
        item.removeRatio <= 0.45
      );
    const referenceRemoveButtonsOk =
      referenceRemoveButtons.length === referenceImageCount &&
      referenceRemoveButtons.every((node) => {
        const box = node.getBoundingClientRect();
        return box.width >= 14 && box.height >= 14 && withinViewport(box, 1);
      });
    const referenceStripVisibleOk = Boolean(
      agentBusy &&
      referenceStripNode &&
      referenceStripRect &&
      referenceStripRect.width >= 220 &&
      referenceStripRect.height >= 38 &&
      composerInputRect &&
      referenceStripRect.left >= composerInputRect.left - 1 &&
      referenceStripRect.right <= composerInputRect.right + 1 &&
      withinViewport(referenceStripRect, 1)
    );
    const referenceStripLayoutOk =
      referenceStripVisibleOk &&
      referenceThumbsVisibleOk &&
      referenceThumbVisualOk &&
      referenceThumbPolishOk &&
      referenceRemoveButtonsOk &&
      referenceStripToolbarOverlapArea <= 4 &&
      referenceStripSendOverlapArea <= 4 &&
      referenceStripSupplementOverlapArea <= 4 &&
      referenceStripToolbarGap != null &&
      referenceStripToolbarGap >= -1;
    const referenceAddButtonEnabledOk = Boolean(
      agentBusy &&
      composerToolButton &&
      !composerToolButton.disabled &&
      composerToolRect &&
      composerToolRect.width >= 28 &&
      composerToolRect.height >= 28 &&
      withinViewport(composerToolRect, 1)
    );
    const referenceAddButtonDisabledOk = Boolean(
      agentBusy &&
      composerToolButton &&
      composerToolButton.disabled &&
      composerToolRect &&
      composerToolRect.width >= 28 &&
      composerToolRect.height >= 28 &&
      withinViewport(composerToolRect, 1)
    );
    const busyReferencePromptPresent = Boolean(composerTextarea && String(composerTextarea.value || "").includes("AIDEBUG_BUSY_REFERENCE_DRAFT"));
    const agentRunningReferenceStripOk =
      agentRunningUiOk &&
      supplementButtonPairOk &&
      referenceStripLayoutOk &&
      busyReferencePromptPresent &&
      Boolean(composerTextareaRect && composerTextareaRect.height >= 76) &&
      composerViewportVisibleOk &&
      agentTimelineBottomOk;
    const motionMetrics = {
      stop: motionMetric(sendButton),
      supplement: motionMetric(supplementButton),
      referenceAdd: motionMetric(composerToolButton),
      referenceRemove: motionMetric(referenceRemoveButton),
      modelChip: motionMetric(composerModelButton),
      popover: motionMetric(element(".composer-model-popover")),
      runningDot: motionMetric(runningMessageNode)
    };
    const focusStability = {
      stop: focusStabilityMetric(sendButton),
      supplement: focusStabilityMetric(supplementButton),
      referenceAdd: focusStabilityMetric(composerToolButton),
      referenceRemove: focusStabilityMetric(referenceRemoveButton),
      modelChip: focusStabilityMetric(composerModelButton)
    };
    const agentMotionCoreOk =
      agentBusy &&
      motionMetrics.stop.hasTransition &&
      motionMetrics.referenceAdd.hasTransition &&
      motionMetrics.modelChip.hasTransition &&
      motionMetrics.runningDot.hasAnimation &&
      focusStability.stop.ok &&
      focusStability.referenceAdd.ok &&
      focusStability.modelChip.ok;
    const supplementMotionOk =
      !supplementButton ||
      (
        motionMetrics.supplement.hasTransition &&
        motionMetrics.supplement.hasAnimation &&
        focusStability.supplement.ok
      );
    const referenceRemoveMotionOk =
      !referenceRemoveButton ||
      (
        motionMetrics.referenceRemove.hasTransition &&
        focusStability.referenceRemove.ok &&
        referenceRemoveButtonRect &&
        referenceRemoveButtonRect.width >= 14 &&
        referenceRemoveButtonRect.height >= 14
      );
    const popoverMotionOk = !element(".composer-model-popover") || motionMetrics.popover.hasAnimation;
    const agentMotionOk = agentMotionCoreOk && supplementMotionOk && referenceRemoveMotionOk && popoverMotionOk;
    const runningMessageCount = document.querySelectorAll(".agent-message.running").length;
    const bodyText = document.body.innerText || "";
    const bodyContent = document.body.textContent || "";
    const agentStoppedStatusOk = Boolean(!agentBusy && agentDebugState?.agentStatus === "idle" && /就绪/.test(agentStatusText));
    const sendButtonIdleOk = Boolean(
      !agentBusy &&
      sendButton &&
      !sendButton.classList.contains("is-stop") &&
      !sendButton.classList.contains("danger-secondary") &&
      !sendButton.classList.contains("ui-action-danger") &&
      sendButton.getAttribute("aria-label") === "发送" &&
      sendButton.getAttribute("title") === "发送" &&
      sendButtonRect &&
      sendButtonRect.width >= 28 &&
      sendButtonRect.height >= 28
    );
    const agentInterruptMessageVisible = bodyText.includes("已中断当前前端追踪");
    const agentStopUiOk =
      agentStoppedStatusOk &&
      sendButtonIdleOk &&
      runningMessageCount === 0 &&
      agentInterruptMessageVisible &&
      composerViewportVisibleOk &&
      agentTimelineBottomOk;
    const agentDebugMessages = Array.isArray(agentDebugState?.messages) ? agentDebugState.messages : [];
    const interruptMessageCount = agentDebugMessages.filter((message) => String(message?.content || "").includes("已中断当前前端追踪")).length;
    const interruptMessageIndex = agentDebugMessages.findIndex((message) => String(message?.content || "").includes("已中断当前前端追踪"));
    const stopResendUserIndex = agentDebugMessages.findIndex((message) => message?.role === "user" && String(message?.content || "").includes("AIDEBUG_STOP_RESEND_"));
    const stopResendAssistantIndex = agentDebugMessages.findIndex((message, index) => index > stopResendUserIndex && message?.role === "assistant" && message?.status !== "running");
    const stopResendPromptVisible = bodyText.includes("AIDEBUG_STOP_RESEND_");
    const stopResendAfterInterruptOk = interruptMessageIndex >= 0 && stopResendUserIndex > interruptMessageIndex;
    const stopResendAssistantOk = stopResendAssistantIndex > stopResendUserIndex;
    const stopResendRuntimeRequestOk = agentProgress.some((item) => item?.phase === "runtime-request");
    const stopResendWorkflowToolOk = agentProgress.some((item) => {
      const input = item?.input && typeof item.input === "object" ? item.input : {};
      return item?.tool === "workflow" && (item?.operation === "list_nodes" || input.operation === "list_nodes");
    });
    const stopResendImageGenUsed = agentProgress.some((item) => item?.tool === "image_gen" || String(item?.phase || "").startsWith("image-"));
    const stopResendPromptCleared = !composerTextarea || composerTextarea.value.trim() === "";
    const agentStopResendOk =
      agentStoppedStatusOk &&
      sendButtonIdleOk &&
      runningMessageCount === 0 &&
      interruptMessageCount === 1 &&
      stopResendPromptVisible &&
      stopResendAfterInterruptOk &&
      stopResendAssistantOk &&
      stopResendRuntimeRequestOk &&
      stopResendWorkflowToolOk &&
      !stopResendImageGenUsed &&
      stopResendPromptCleared &&
      composerViewportVisibleOk &&
      agentTimelineBottomOk;
    const busySupplementUserIndex = agentDebugMessages.findIndex((message) => message?.role === "user" && String(message?.content || "").includes("AIDEBUG_BUSY_SUPPLEMENT_"));
    const busySupplementUserMessage = busySupplementUserIndex >= 0 ? agentDebugMessages[busySupplementUserIndex] : null;
    const busySupplementAssistantIndex = agentDebugMessages.findIndex((message, index) => index > busySupplementUserIndex && message?.role === "assistant" && message?.status !== "running");
    const busySupplementPromptVisible = bodyText.includes("AIDEBUG_BUSY_SUPPLEMENT_");
    const busySupplementClickPathOk = Boolean(window.__naimageBusySupplementButtonClicked);
    const busySupplementUserMetaOk = String(busySupplementUserMessage?.meta || "").includes("interrupt");
    const busySupplementRunId =
      [...agentProgress].reverse().find((item) => item?.runId && item.runId !== "debug-running-ui" && item.phase === "runtime-request")?.runId ||
      [...agentProgress].reverse().find((item) => item?.runId && item.runId !== "debug-running-ui")?.runId ||
      "";
    const busySupplementProgress = busySupplementRunId ? agentProgress.filter((item) => item?.runId === busySupplementRunId) : [];
    const busySupplementLatestProgressRunId = [...agentProgress].reverse().find((item) => item?.runId)?.runId || "";
    const busySupplementRuntimeRequestOk = busySupplementProgress.some((item) => item?.phase === "runtime-request");
    const busySupplementWorkflowToolOk = busySupplementProgress.some((item) => {
      const input = item?.input && typeof item.input === "object" ? item.input : {};
      return item?.tool === "workflow" && (item?.operation === "list_nodes" || input.operation === "list_nodes");
    });
    const busySupplementImageGenUsed = busySupplementProgress.some((item) => item?.tool === "image_gen" || String(item?.phase || "").startsWith("image-"));
    const busySupplementPromptCleared = !composerTextarea || composerTextarea.value.trim() === "";
    const busySupplementAssistantOk = busySupplementAssistantIndex > busySupplementUserIndex;
    const busySupplementLatestProgressOk = Boolean(busySupplementRunId && busySupplementLatestProgressRunId === busySupplementRunId);
    const agentBusySupplementOk =
      agentStoppedStatusOk &&
      sendButtonIdleOk &&
      runningMessageCount === 0 &&
      busySupplementPromptVisible &&
      busySupplementClickPathOk &&
      busySupplementUserMetaOk &&
      busySupplementAssistantOk &&
      busySupplementRuntimeRequestOk &&
      busySupplementWorkflowToolOk &&
      !busySupplementImageGenUsed &&
      busySupplementPromptCleared &&
      busySupplementLatestProgressOk &&
      composerViewportVisibleOk &&
      agentTimelineBottomOk;
    const buttonSizeMatch = agentNodeComposerMode
      ? Boolean(composerToolbarRect && sendButtonRect) &&
        Math.abs(sendButtonRect.height - composerToolbarRect.height) <= 1 &&
        sendButtonRect.width >= sendButtonRect.height &&
        sendButtonRect.width <= 120
      : Boolean(composerToolRect && composerModelRect && sendButtonRect) &&
        Math.abs(composerToolRect.width - composerModelRect.width) <= 1 &&
        Math.abs(composerToolRect.height - composerModelRect.height) <= 1 &&
        Math.abs(sendButtonRect.height - composerModelRect.height) <= 1 &&
        sendButtonRect.width >= composerModelRect.width &&
        sendButtonRect.width <= Math.max(120, composerModelRect.width * 3.5);
    const popoverBottomGap = composerPopoverRect && composerInputRect ? composerInputRect.bottom - composerPopoverRect.bottom : 0;
    const noPopoverShadow = composerPopoverStyle.boxShadow === "none" || /^rgba\\(0, 0, 0, 0\\)/.test(composerPopoverStyle.boxShadow || "");
    const popoverDocked = Boolean(composerPopoverRect && composerInputRect) &&
      Math.abs(composerPopoverRect.left - composerInputRect.left) <= 1 &&
      Math.abs(composerPopoverRect.right - composerInputRect.right) <= 2 &&
      popoverBottomGap >= 28 &&
      popoverBottomGap <= 76 &&
      noPopoverShadow &&
      parseFloat(composerPopoverStyle.borderTopLeftRadius || "0") <= 0.5;
    const popoverStopOverlapArea = Math.round(rectArea(intersectRect(composerPopoverRect, sendButtonRect)));
    const popoverSupplementOverlapArea = Math.round(rectArea(intersectRect(composerPopoverRect, supplementButtonRect)));
    const composerPopoverAvoidsActions = !composerPopoverRect || (popoverStopOverlapArea <= 4 && popoverSupplementOverlapArea <= 4);
    const busyModelPromptPresent = Boolean(composerTextarea && String(composerTextarea.value || "").includes("AIDEBUG_BUSY_MODEL_"));
    const busySupplementModelPopoverOk =
      agentBusy &&
      busyModelPromptPresent &&
      supplementButtonPairOk &&
      Boolean(composerPopoverRect) &&
      popoverDocked &&
      composerPopoverAvoidsActions &&
      composerViewportVisibleOk &&
      agentTimelineBottomOk;
    const transparentBorderColor = (value) => value === "transparent" || /^rgba\\([^)]*,\\s*0\\)$/.test(value);
    const settingsOpen = Boolean(element(".settings-drawer:not(.account-drawer)"));
    const accountOpen = Boolean(element(".account-drawer"));
    const shellFillsViewportOk = Boolean(
      shellRect &&
      Math.abs(shellRect.top) <= 1 &&
      Math.abs(shellRect.left) <= 1 &&
      Math.abs(shellRect.right - window.innerWidth) <= 1 &&
      Math.abs(shellRect.bottom - window.innerHeight) <= 1
    );
    const mainFillsViewportOk = Boolean(
      mainRect &&
      topbarRect &&
      Math.abs(mainRect.top - topbarRect.bottom) <= 1 &&
      Math.abs(mainRect.bottom - window.innerHeight) <= 1 &&
      mainRect.height >= window.innerHeight - topbarRect.height - 2
    );
    const canvasPanelFillsMainOk = Boolean(
      mainRect &&
      canvasPanelRect &&
      Math.abs(canvasPanelRect.top - mainRect.top) <= 1 &&
      Math.abs(canvasPanelRect.bottom - mainRect.bottom) <= 1 &&
      canvasPanelRect.height >= mainRect.height - 2
    );
    const canvasFooterDockedToPanelOk = Boolean(
      canvasPanelRect &&
      canvasFooterRect &&
      Math.abs(canvasFooterRect.bottom - canvasPanelRect.bottom) <= 1
    );
    const canvasViewportFillOk = shellFillsViewportOk && mainFillsViewportOk && canvasPanelFillsMainOk && canvasFooterDockedToPanelOk;
    const settingsDrawerFlushRightOk = !settingsOpen || Boolean(settingsDrawerRect && drawerFlushRight(settingsDrawerRect));
    const accountDrawerFlushRightOk = !accountOpen || Boolean(accountDrawerRect && drawerFlushRight(accountDrawerRect));
    const workbenchMinWidthOk = window.innerWidth >= ${workbenchMinWidth} - 1;
    const settingsDrawerWidthOk = !settingsOpen || Boolean(settingsDrawerRect && Math.abs(settingsDrawerRect.width - 420) <= 1);
    const accountDrawerWidthOk = !accountOpen || Boolean(accountDrawerRect && Math.abs(accountDrawerRect.width - 390) <= 1);
    const settingsHeaderBreathingOk = !settingsOpen || Boolean(
      settingsDrawerRect &&
      settingsHeaderRect &&
      settingsHeaderTitleRect &&
      settingsHeaderRect.height >= 64 &&
      settingsHeaderRect.height <= 82 &&
      settingsHeaderTitleRect.top - settingsDrawerRect.top >= 12 &&
      settingsHeaderRect.bottom - settingsHeaderTitleRect.bottom >= 12
    );
    const accountHeaderBreathingOk = !accountOpen || Boolean(
      accountDrawerRect &&
      accountHeaderRect &&
      accountHeaderTitleRect &&
      accountHeaderRect.height >= 64 &&
      accountHeaderRect.height <= 82 &&
      accountHeaderTitleRect.top - accountDrawerRect.top >= 12 &&
      accountHeaderRect.bottom - accountHeaderTitleRect.bottom >= 12
    );
    const settingsActiveSectionTitle = {
      接入: "服务接入",
      外观: "外观主题",
      模型: "模型配置",
      Agent: "Agent",
      更新: "软件更新"
    }[settingsActiveTabText] || "";
    const settingsLabelsOk = !settingsOpen || (
      settingsHeaderTitleText === "设置" &&
      settingsHeaderSubtitleText === "服务接入、外观、模型、Agent 与软件更新" &&
      settingsSectionEyebrowText === "" &&
      settingsSectionTitleText === settingsActiveSectionTitle
    );
    const settingsAppearanceControlsOk = !settingsOpen || settingsActiveTabText !== "外观" || (
      settingsThemeModeButtons.length === 3 &&
      settingsThemePaletteButtons.length === 11 &&
      settingsThemeModeActiveCount === 1 &&
      settingsThemePaletteActiveCount === 1
    );
    const settingsCustomThemeEditorOk = Boolean(
      settingsCustomThemeEditor &&
      settingsThemePaletteButtons.find((node) => node.getAttribute("data-palette") === "custom")?.getAttribute("aria-pressed") === "true" &&
      settingsCustomThemeColorInputs.length === 10 &&
      settingsCustomThemeModeButtons.length === 2 &&
      settingsCustomThemeModeButtons.filter((node) => node.getAttribute("aria-pressed") === "true").length === 1 &&
      ["导入 JSON", "导出 JSON", "恢复陶土模板"].every((label) => settingsCustomThemeActionTexts.includes(label))
    );
    const settingsThemeEditorScrollOk = Boolean(
      settingsSurfaceBody &&
      settingsSurfaceBodyRect &&
      settingsCustomThemeActionsRect &&
      settingsSurfaceBody.scrollHeight > settingsSurfaceBody.clientHeight &&
      settingsSurfaceBody.scrollTop > 0 &&
      settingsCustomThemeActionsRect.left >= settingsSurfaceBodyRect.left + 6 &&
      settingsCustomThemeActionsRect.right <= settingsSurfaceBodyRect.right - 6 &&
      settingsCustomThemeActionsRect.top >= settingsSurfaceBodyRect.top &&
      settingsCustomThemeActionsRect.bottom <= settingsSurfaceBodyRect.bottom
    );
    const settingsContextCustomControlsOk = Boolean(
      settingsContextStrategySelect?.value === "custom" &&
      ["auto", "codex", "claude", "naimage-balanced", "custom"].every((value) => settingsContextStrategyValues.includes(value)) &&
      settingsContextCustomInputs.length === 4 &&
      settingsContextCustomInputs.every((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
    );
    const settingsSaveControlsOk = !settingsOpen || (
      settingsSaveButtonText === "保存设置" &&
      (settingsRestoreButtonText === "恢复默认" || settingsRestoreButtonText === "确认恢复默认")
    );
    const settingsUpdateCenterOk = !settingsOpen || settingsActiveTabText !== "更新" || Boolean(
      settingsUpdateHeadingText === "软件更新" &&
      settingsUpdateCardRect &&
      settingsDrawerRect &&
      settingsUpdateCardRect.width >= 330 &&
      settingsUpdateCardRect.left >= settingsDrawerRect.left + 14 &&
      settingsUpdateCardRect.right <= settingsDrawerRect.right - 14 &&
      settingsUpdateActionText.length > 0 &&
      settingsUpdateSecurityText.includes("自动验证") &&
      settingsUpdateSecurityText.includes("保留当前版本") &&
      !/(?:SHA-?256|发布签名|网络限流)/i.test(settingsUpdateSecurityText)
    );
    const modelFetchButtonTextOk = !settingsOpen || settingsActiveTabText !== "模型" || modelFetchButtonText === "获取模型";
    const modelFetchButtonRightOk = !settingsOpen || settingsActiveTabText !== "模型" || Boolean(
      modelFetchButtonRect &&
      settingsSectionHeadRect &&
      settingsSectionTitleBlockRect &&
      modelFetchButtonRect.left >= settingsSectionTitleBlockRect.right + 6 &&
      Math.abs(modelFetchButtonRect.right - settingsSectionHeadRect.right) <= 2
    );
    const modelFetchButtonAlignedOk = !settingsOpen || settingsActiveTabText !== "模型" || Boolean(
      modelFetchButtonRect &&
      settingsSectionHeadRect &&
      modelFetchButtonRect.top >= settingsSectionHeadRect.top - 1 &&
      modelFetchButtonRect.bottom <= settingsSectionHeadRect.bottom + 1 &&
      modelFetchButtonRect.right <= settingsSectionHeadRect.right + 1
    );
    const walletCardThreeColumnOk = !accountOpen || walletCardItemRects.length === 0 || Boolean(
      walletCardRect &&
      walletCardItemRects.length >= 3 &&
      Math.max(...walletCardItemRects.map((box) => Math.abs(box.top - walletCardItemRects[0].top))) <= 1 &&
      walletCardItemRects[0].left < walletCardItemRects[1].left &&
      walletCardItemRects[1].left < walletCardItemRects[2].left &&
      walletCardItemRects.every((box) => box.width >= 70 && box.bottom <= walletCardRect.bottom + 1)
    );
    const usageLogListInsetOk = !accountOpen || !usageLogListRect || Boolean(
      accountDrawerRect &&
      usageLogListRect.left >= accountDrawerRect.left + 14 &&
      accountDrawerRect.right - usageLogListRect.right >= 14
    );
    const usageLogRowsCompactOk = !accountOpen || usageLogArticleRects.length === 0 || usageLogArticleRects.every((box) => box.height <= 92);
    const accountProfileCardOk = !accountOpen || Boolean(
      accountProfileCardRect &&
      accountProfileAvatarRect &&
      accountProfileCardRect.width >= 300 &&
      accountProfileCardRect.height >= 40 &&
      accountProfileAvatarRect.width >= 32 &&
      accountProfileAvatarRect.height >= 32 &&
      accountProfileStatusText.includes("已连接")
    );
    const accountActionButtonsDesignedOk = !accountOpen || Boolean(
      accountActionButtonMetrics.length === 2 &&
      accountActionButtonMetrics[0].text.includes("充值") &&
      accountActionButtonMetrics[1].text.includes("退出") &&
      accountActionButtonMetrics.every((item) => item.iconCount >= 1 && item.height >= 30 && item.radius >= 3 && item.width >= 72) &&
      accountActionButtonMetrics[0].left < accountActionButtonMetrics[1].left &&
      accountActionButtonMetrics[0].background !== accountActionButtonMetrics[1].background
    );
    const walletCardWidth = Number(walletCardRect?.width || 0);
    const walletCardHeight = Number(walletCardRect?.height || 0);
    const walletCardRadius = Number.parseFloat(walletCardStyle.borderTopLeftRadius || "0") || 0;
    const walletCardBorderWidth = Number.parseFloat(walletCardStyle.borderTopWidth || "0") || 0;
    const walletCardPolishParts = {
      radiusOk: walletCardRadius <= 4,
      borderOk: walletCardBorderWidth >= 0.5,
      heightOk: walletCardHeight >= 90,
      widthOk: walletCardWidth >= 330
    };
    const walletCardPolishedOk = !accountOpen || !walletCardRect || Object.values(walletCardPolishParts).every(Boolean);
    const accountDrawerUiOk = !accountOpen || Boolean(
      accountDrawerWidthOk &&
      accountProfileCardOk &&
      (!walletCardRect || walletCardThreeColumnOk) &&
      walletCardPolishedOk &&
      accountActionButtonsDesignedOk &&
      (!usageLogListRect || usageLogListRect.width >= Math.min(320, window.innerWidth - 40)) &&
      usageLogListInsetOk &&
      usageLogRowsCompactOk
    );
    const settingsDrawerUiOk = !settingsOpen || Boolean(
      settingsDrawerWidthOk &&
      modelFetchButtonTextOk &&
      modelFetchButtonRightOk &&
      modelFetchButtonAlignedOk
    );
    const projectMenuOpen = Boolean(element(".project-menu-popover:not(.file-command-popover)"));
    const fileMenuOpen = Boolean(element(".file-command-popover"));
    const modelPickerOpen = Boolean(modelPickerRect);
    const modelPickerPartsWithinViewport = !modelPickerOpen || [modelPickerRect, modelPickerHeadRect, modelPickerToolbarRect, modelPickerListRect, modelPickerActionsRect, modelPickerCloseRect].every((box) => withinViewport(box, 2));
    const modelPickerCloseButtonOk = !modelPickerOpen || Boolean(modelPickerCloseRect && modelPickerCloseRect.width >= 30 && modelPickerCloseRect.width <= 34 && modelPickerCloseRect.height >= 30 && modelPickerCloseRect.height <= 34);
    const modelPickerScrollOk = !modelPickerOpen || Boolean(
      modelPickerListNode &&
      /auto|scroll/.test(modelPickerListStyle.overflowY || "") &&
      modelPickerListNode.scrollHeight > modelPickerListNode.clientHeight + 2 &&
      modelPickerScrollProbe.moved === true
    );
    const modelPickerGpt56Ok = !modelPickerOpen || Boolean(gpt56Option);
    const modelPickerGpt55CleanOk = !modelPickerOpen || Boolean(gpt55Option && gpt55MetaText !== "O" && !modelPickerOptionNodes.some((node) => optionText(node, "small") === "O"));
    const cacheUiCopyHiddenOk = !/(?:60\s*秒|60s|不重复请求|读取缓存|模型缓存|缓存命中)/i.test(bodyText);
    const modelCacheSecondHitOk = !modelPickerOpen || Boolean(
      modelCacheProbe.ok &&
      modelCacheProbe.secondSource &&
      modelCacheProbe.secondSource !== "network" &&
      modelCacheProbe.agentSecondSource &&
      modelCacheProbe.agentSecondSource !== "network" &&
      Number(modelCacheProbe.count || 0) >= 15
    );
    const modelCacheForceRefreshOk = !modelPickerOpen || Boolean(
      Array.isArray(modelCacheProbe.standardSources) &&
      modelCacheProbe.standardSources.length === 5 &&
      modelCacheProbe.standardSources.every((source) => source && source !== "network") &&
      modelCacheProbe.forceSource === "network" &&
      modelCacheProbe.afterForceSource &&
      modelCacheProbe.afterForceSource !== "network"
    );
    const modelPickerLayoutOk = !modelPickerOpen || Boolean(modelPickerPartsWithinViewport && modelPickerCloseButtonOk && modelPickerScrollOk && modelPickerGpt56Ok && modelPickerGpt55CleanOk);
    const modalOpen = Boolean(element(".ui-surface[data-ui-surface]:not(.ui-drawer)"));
    const manualImageTaskDialog = element(".manual-image-task-dialog");
    const manualImageTaskRect = rect(".manual-image-task-dialog");
    const manualImageTaskSelects = manualImageTaskDialog ? Array.from(manualImageTaskDialog.querySelectorAll(".manual-image-task-controls select")) : [];
    const manualImageTaskPrompt = manualImageTaskDialog?.querySelector(".manual-image-task-prompt textarea") || null;
    const manualImageTaskReferenceButton = manualImageTaskDialog?.querySelector(".manual-image-reference-button") || null;
    const manualImageTaskSubmit = Array.from(manualImageTaskDialog?.querySelectorAll("button") || []).find((button) => String(button.textContent || "").trim() === "生成图片") || null;
    const manualImageTaskControlsOk = !manualImageTaskDialog || Boolean(
      manualImageTaskSelects.length === 4 &&
      manualImageTaskPrompt &&
      manualImageTaskReferenceButton &&
      manualImageTaskSubmit
    );
    const manualImageTaskLayoutOk = !manualImageTaskDialog || Boolean(
      manualImageTaskRect &&
      withinViewport(manualImageTaskRect, 2) &&
      manualImageTaskPrompt &&
      manualImageTaskPrompt.getBoundingClientRect().height >= 150
    );
    const topbarCanvasActionMetrics = Array.from(document.querySelectorAll(".project-quick-actions button")).map((node) => ({
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      fits: node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1
    }));
    const topbarCanvasActionLabels = topbarCanvasActionMetrics.map((item) => item.text);
    const topbarCanvasActionsFitOk = topbarCanvasActionMetrics.every((item) => item.fits);
    const emptyCanvasActionLabels = Array.from(document.querySelectorAll(".empty-canvas-actions button")).map((node) =>
      String(node.textContent || "").replace(/\s+/g, " ").trim()
    );
    const topbarCanvasActionLabelsOk =
      topbarCanvasActionLabels.length === 3 &&
      topbarCanvasActionLabels[0] === "新建项目" &&
      topbarCanvasActionLabels[1] === "移除" &&
      topbarCanvasActionLabels[2] === "重命名";
    const imageTaskButtons = Array.from(document.querySelectorAll(".project-agent-task-grid > button"));
    const imageTaskButtonMetrics = imageTaskButtons.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
        disabled: Boolean(node.disabled),
        width: box.width,
        height: box.height,
        withinComposer: Boolean(composerRect) && box.left >= composerRect.left - 1 && box.right <= composerRect.right + 1
      };
    });
    const imageTaskButtonsVisibleOk = imageTaskButtonMetrics.length === 0;
    const imageTaskButtonStateOk = imageTaskButtonMetrics.length === 0;
    const emptyCanvasArtifactOnlyOk = !element(".empty-canvas-hint") || emptyCanvasActionLabels.length === 0;
    const inactiveProvenanceEdge = element(".edge.provenance:not(.active):not(.input-reference)") || element(".edge.provenance:not(.active)");
    const activeProvenanceEdge = element(".edge.provenance.active");
    const inactiveProvenanceStyle = inactiveProvenanceEdge ? getComputedStyle(inactiveProvenanceEdge) : null;
    const activeProvenanceStyle = activeProvenanceEdge ? getComputedStyle(activeProvenanceEdge) : null;
    const provenanceLegacyEdgeStyleOk = Boolean(inactiveProvenanceStyle) &&
      Math.abs(Number.parseFloat(inactiveProvenanceStyle.strokeWidth) - 3) <= 0.1 &&
      Math.abs(Number.parseFloat(inactiveProvenanceStyle.opacity) - 0.7) <= 0.05 &&
      (inactiveProvenanceStyle.strokeDasharray === "none" || inactiveProvenanceStyle.strokeDasharray === "");
    const provenanceActiveEdgeFlowOk = Boolean(activeProvenanceStyle) &&
      Math.abs(Number.parseFloat(activeProvenanceStyle.strokeWidth) - 3) <= 0.1 &&
      Math.abs(Number.parseFloat(activeProvenanceStyle.opacity) - 1) <= 0.05 &&
      activeProvenanceStyle.animationName.split(",").map((item) => item.trim()).includes("edge-flow");
    const provenanceEdges = Array.from(document.querySelectorAll(".edge.provenance"));
    const provenanceEdgePathMetrics = provenanceEdges.map((edge) => {
      const path = String(edge.getAttribute("d") || "").replace(/\\s+/g, " ").trim();
      return {
        sourceId: edge.getAttribute("data-source-id") || "",
        targetId: edge.getAttribute("data-target-id") || "",
        path,
        cubicCount: (path.match(/\\bC\\b/g) || []).length,
        extraRouteCommandCount: (path.match(/\\b(?:L|Q|S|T|A|H|V)\\b/g) || []).length
      };
    });
    const provenanceSimpleStablePathOk = provenanceEdgePathMetrics.length > 0 && provenanceEdgePathMetrics.every((item) =>
      item.cubicCount === 1 && item.extraRouteCommandCount === 0 && /^M\\s[-+\\d.e]+\\s[-+\\d.e]+\\sC\\s/i.test(item.path)
    );
    const runtimeNodes = Array.isArray(agentDebugState?.nodes) ? agentDebugState.nodes : [];
    const runtimeNodeById = new Map(runtimeNodes.map((node) => [String(node?.id || ""), node]));
    const nodeStackMetrics = Array.from(document.querySelectorAll(".flow-node")).map((node) => {
      const id = node.getAttribute("data-node-id") || "";
      const runtimeNode = runtimeNodeById.get(id);
      const persistedZOrder = Number(runtimeNode?.zOrder);
      const computedZIndex = Number.parseInt(getComputedStyle(node).zIndex, 10);
      return {
        id,
        persistedZOrder: Number.isFinite(persistedZOrder) ? persistedZOrder : null,
        computedZIndex: Number.isFinite(computedZIndex) ? computedZIndex : 0,
        selected: node.classList.contains("selected"),
        dragging: node.classList.contains("dragging"),
        resizing: node.classList.contains("resizing")
      };
    });
    const edgeLayerNode = element(".edge-layer");
    const edgeLayerStyle = edgeLayerNode ? getComputedStyle(edgeLayerNode) : null;
    const parsedEdgeLayerZ = Number.parseInt(edgeLayerStyle?.zIndex || "", 10);
    const edgeLayerZIndex = Number.isFinite(parsedEdgeLayerZ) ? parsedEdgeLayerZ : 0;
    const provenanceEdgeLayerBelowNodesOk = Boolean(edgeLayerNode) && nodeStackMetrics.length > 0 &&
      nodeStackMetrics.every((item) => item.computedZIndex > edgeLayerZIndex);
    const zOrderDebugDataAvailable = nodeStackMetrics.length > 0 && nodeStackMetrics.every((item) => item.persistedZOrder !== null);
    const zOrderDebugDataMissingIds = nodeStackMetrics.filter((item) => item.persistedZOrder === null).map((item) => item.id);
    const persistedZOrders = nodeStackMetrics.map((item) => item.persistedZOrder).filter((value) => value !== null);
    const zOrderPersistenceContractOk = !zOrderDebugDataAvailable || (
      new Set(persistedZOrders).size === persistedZOrders.length &&
      nodeStackMetrics.every((item) => item.persistedZOrder === item.computedZIndex)
    );
    const canvasStatusDockedBottom = Boolean(
      canvasRect &&
      canvasFooterRect &&
      canvasStatusRect &&
      canvasStatusRect.top >= canvasFooterRect.top - 1 &&
      canvasStatusRect.bottom <= canvasFooterRect.bottom + 1 &&
      canvasStatusRect.top >= canvasRect.bottom - 2 &&
      (!canvasToolbarRect || canvasStatusRect.top >= canvasToolbarRect.bottom)
    );
    const canvasZoomDockedBottom = Boolean(
      canvasFooterRect &&
      canvasToolsRect &&
      canvasZoomButtonRect &&
      canvasToolsRect.top >= canvasFooterRect.top - 1 &&
      canvasToolsRect.bottom <= canvasFooterRect.bottom + 1 &&
      canvasZoomButtonRect.top >= canvasFooterRect.top - 1 &&
      canvasZoomButtonRect.bottom <= canvasFooterRect.bottom + 1
    );
    return {
      dialogLayoutKind: activeDialogSpec?.kind || "",
      dialogLayoutMiddleFillOk,
      dialogLayoutNestedScrollOk,
      dialogLayoutMetrics,
      uiControlFoundationOk,
      uiControlFoundationMetrics,
      authGateVisible,
      authGateOnlyOk,
      authGateLayoutOk,
      authGateSwitchHorizontalOk,
      authGateControlsStyledOk,
      authGateErrorStyledOk,
      authGateErrorVisible: Boolean(authMessageNode && /(?:错误|失败|失效|不可用|请重新登录|请输入)/i.test(String(authMessageNode.textContent || ""))),
      authGateModeLoginOk: !authGateVisible || !element(".auth-gate-form .basic-auth-name"),
      authGateModeRegisterOk: !authGateVisible || Boolean(element(".auth-gate-form .basic-auth-name")),
      authGateMetrics,
      authLogoutFlowOk: window.__naimageAuthProbe?.logoutFlowOk === true,
      authLogoutPendingClearedOk: window.__naimageAuthProbe?.logoutPendingCleared === true,
      authRefreshIsolationOk: window.__naimageAuthProbe?.refreshIsolationOk === true,
      authRegisterSwitchOk: window.__naimageAuthProbe?.registerSwitchOk === true,
      authErrorFlowOk: window.__naimageAuthProbe?.errorFlowOk === true,
      authReloginCleanOk: window.__naimageAuthReloginProbe?.ok === true,
      authFlowProbe: window.__naimageAuthProbe || null,
      authReloginProbe: window.__naimageAuthReloginProbe || null,
      settingsOpen,
      accountOpen,
      historyOpen: Boolean(element(".agent-history-popover")),
      composerPopoverOpen: Boolean(element(".composer-model-popover")),
      projectMenuOpen,
      fileMenuOpen,
      modalOpen,
      askUserOpen: Boolean(element('[data-ui-surface="ask-user"]')),
      referencePickerOpen: Boolean(element('[data-ui-surface="reference-picker"]')),
      agentTextEditorOpen: Boolean(element(".agent-text-editor-dialog")),
      agentTextEditorKind: String(element(".agent-text-editor-dialog")?.getAttribute("aria-label") || ""),
      imageTaskOpen: Boolean(element(".manual-image-task-dialog")),
      modelConfigOpen: modelPickerOpen,
      requirementEditorOpen: Boolean(agentDebugState?.requirementEditorOpen),
      requirementEditorUiOk: agentDebugState?.requirementEditorOpen ? agentDebugState?.requirementEditorUi?.ok === true : true,
      requirementEditorUi: agentDebugState?.requirementEditorUi || null,
      requirementNodeCount: (agentDebugState?.nodes || []).filter((node) => node.type === "requirement").length,
      requirementConnectionPortsVisible: Array.from(document.querySelectorAll(".flow-node.requirement-node")).every((node) => Boolean(node.querySelector(".node-port-in") && node.querySelector(".node-port-out"))),
      requirementGraphValid: (agentDebugState?.nodes || []).filter((node) => node.type === "requirement").every((node) => {
        const inputBindings = Array.isArray(node.requirement?.inputBindings) && node.requirement.inputBindings.length
          ? node.requirement.inputBindings
          : node.parentId ? [{ nodeId: node.parentId, role: "source" }] : [];
        const inputs = inputBindings.map((binding) => ({
          binding,
          node: (agentDebugState?.nodes || []).find((candidate) => candidate.id === binding.nodeId)
        }));
        const primaryInputId = inputBindings.find((binding) => binding.role === "source")?.nodeId || inputBindings[0]?.nodeId || "";
        const outputs = (agentDebugState?.nodes || []).filter((candidate) => candidate.parentId === node.id);
        return inputs.every(({ binding, node: input }) => input?.type === "image" && (binding.role === "source" || binding.role === "reference")) &&
          (!inputBindings.length || node.parentId === primaryInputId) &&
          (!inputBindings.length || node.relationType === "referenced") &&
          outputs.every((output) => output.type === "image" && (output.relationType || "derived-from") !== "referenced");
      }),
      requirementEdgeCount: document.querySelectorAll(".edge.provenance[data-relation='referenced']").length,
      modelPickerLayoutOk,
      modelPickerPartsWithinViewport,
      modelPickerCloseButtonOk,
      modelPickerScrollOk,
      modelPickerGpt56Ok,
      modelPickerGpt55CleanOk,
      cacheUiCopyHiddenOk,
      modelPickerOptionCount: modelPickerOptionNodes.length,
      modelPickerListMetrics: modelPickerListNode ? {
        clientHeight: modelPickerListNode.clientHeight,
        scrollHeight: modelPickerListNode.scrollHeight,
        scrollTop: modelPickerListNode.scrollTop,
        overflowY: modelPickerListStyle.overflowY
      } : null,
      modelCacheSecondHitOk,
      modelCacheForceRefreshOk,
      modelCacheProbe,
      publicAgentToolNames,
      publicImageOperations,
      publicAgentToolSchemaOk,
      layerPngRuntimeOk,
      layerRuntimeRoles,
      layerFolderActionVisible,
      variantsRuntimeOk,
      replaceRuntimeOk,
     referenceImageRuntimeOk,
      imageContainerRuntimeOk,
      imageContainerRuntimeMetrics,
      imageContainerGridOk,
      imageResultContainerCoreOk,
      imageLibraryPathsOk,
      imageLayoutSourcesRetainedOk,
      imageLayoutCausalityOk,
      imageLayoutAutoDissolveOk,
      canvasImageContainerActionVisible,
     referenceContainerDropOk,
     referenceCapacityNineOk,
     referencePickerClosedOk,
     imageContainerAgentReferenceOk,
      referenceDropNoInlineThumbsOk,
      conversationClearIsolationOk: Boolean(window.__naimageIsolationProbe?.clear?.ok),
      newConversationIsolationOk: Boolean(window.__naimageIsolationProbe?.conversation?.ok),
      newProjectIsolationOk: Boolean(window.__naimageIsolationProbe?.project?.ok),
      isolationProbe: window.__naimageIsolationProbe || null,
      imageContainerTileCount: imageContainerTileNodes.length,
      imageContainerRuntimeCount: imageContainerRuntimeNodes.length,
      imageLayoutGroupCount: imageLayoutGroups.length,
      imageLayoutGroup: finalImageLayoutGroup,
      agentReferencePathCount: Number(agentDebugState?.referenceImageCount || 0),
      inspectorWidth: Math.round(rect(".node-inspector")?.width || 0),
      compactInspectorHeaderOk,
      compactInspectorHeaderMetrics: {
        inspectorHeight: Math.round(inspectorRect?.height || 0),
        headerHeight: Math.round(inspectorHeadRect?.height || 0),
        titleHeight: Math.round(inspectorTitleRect?.height || 0),
        eyebrowDisplay: inspectorEyebrowNode ? getComputedStyle(inspectorEyebrowNode).display : "missing"
      },
      agentWidth: Math.round(agentRect?.width || 0),
      projectAgentCollapsed: Boolean(mainNode?.classList.contains("agent-collapsed")),
      projectAgentCollapseButtonVisible: Boolean(rightCollapseRect && rightCollapseRect.width >= 28 && rightCollapseRect.height >= 28),
      projectAgentCollapsedOk: Boolean(
        mainNode?.classList.contains("agent-collapsed") &&
        agentRect && collapsedAgentRailRect && mainRect && canvasPanelRect &&
        agentRect.width >= 46 && agentRect.width <= 52 &&
        Math.abs(agentRect.right - mainRect.right) <= 1 &&
        Math.abs(canvasPanelRect.right - agentRect.left) <= 2 &&
        collapsedAgentRailRect.width >= 44 &&
        collapsedAgentRailRect.height >= agentRect.height - 2
      ),
      projectAgentFixedOk: Boolean(agentRect && mainRect && canvasPanelRect) &&
        agentRect.top >= mainRect.top - 1 &&
        agentRect.bottom <= mainRect.bottom + 1 &&
        Math.abs(agentRect.right - mainRect.right) <= 1 &&
        Math.abs(canvasPanelRect.right - agentRect.left) <= 2 &&
        agentRect.width >= 350 &&
        agentRect.width <= 430,
      projectAgentContextVisible,
      projectAgentContextMetrics,
      projectAgentContextHasArtifact: Boolean(element(".project-agent-composer-context.has-artifact button")),
      projectAgentContextPrefixPresent,
      projectAgentContextPrefixSingleLineOk,
      projectAgentContextPrefixMetrics,
      currentSelectionText,
      selectedCanvasNodeCount,
      selectedNodeIds,
      selectionMode,
      selectionGesture,
      toolTimelineIdentityOk: toolTimelineEvidence.ok === true,
      toolTimelineEvidence,
      layerCommitOrderOk: layerCommitEvidence.ok === true,
      layerCommitEvidence,
      selectedNodeHighlightVisibleOk,
      selectedNodeHighlightMetrics,
      stateLayerConsistencyOk,
      stateLayerEvidence,
      stateLayerFailures,
      stateLayerClosureWarnings,
      canvasSelectionStateOk,
      canvasSelectionMetrics,
      canvasSelectionIndicatorVisibleOk,
      canvasSelectionIndicatorGeometryOk,
      canvasSelectionIndicatorMetrics,
      selectionSurfacesConsistentOk,
      selectionSurfaceMetrics,
      ctrlNodeSelectionOk: Boolean(window.__naimageCtrlNodeSelectionProbe?.ok),
      ctrlNodeSelectionProbe: window.__naimageCtrlNodeSelectionProbe || null,
      multiSelectionStateOk,
      multiSelectionSceneOk: window.__naimageMultiSelectionSceneProbe?.ok === true,
      multiSelectionSceneMetrics: window.__naimageMultiSelectionSceneProbe || null,
      canvasLeftPanSelectionOk: Boolean(window.__naimageCanvasLeftPanProbe?.moved && window.__naimageCanvasLeftPanProbe?.selectionPreserved),
      stickyMultiSelectionOk: Boolean(window.__naimageStickySelectionProbe?.ok),
      stickyMultiSelectionProbe: window.__naimageStickySelectionProbe || null,
      middleMarqueeSelectionOk: Boolean(window.__naimageMiddleMarqueeSelectionProbe?.ok),
      middleMarqueeSelectionProbe: window.__naimageMiddleMarqueeSelectionProbe || null,
      prunedMultiSelectionOk: Boolean(window.__naimageSelectionPruneProbe?.ok),
      selectionPruneProbe: window.__naimageSelectionPruneProbe || null,
      singleSelectionSwitchOk: Boolean(window.__naimageSingleSelectionSwitchProbe?.ok),
      singleSelectionSwitchProbe: window.__naimageSingleSelectionSwitchProbe || null,
      agentCoreNodeAbsent: !legacyAgentCanvasNodeMounted && !bodyText.includes("AGENT 核心节点"),
      manualWorkflowControlsAbsent: !element(".node-port:not(.provenance-port)") && !bodyText.includes("创建 AGENT 核心节点"),
      provenanceEdgeVisible: Boolean(element(".edge.provenance[data-relation='derived-from']")),
      provenanceVariantEdgeVisible: Boolean(element(".edge.provenance[data-relation='variant']")),
      provenanceConnectionPortsVisible: document.querySelectorAll(".flow-node .node-connection-port.input").length > 0 && document.querySelectorAll(".flow-node .node-connection-port.output").length > 0,
      provenanceArrowAbsent: !element("#provenance-arrow, .edge-arrow-shape") && Array.from(document.querySelectorAll(".edge.provenance, .edge-draft")).every((edge) => !edge.hasAttribute("marker-end")),
      provenanceConnectionPortRuntimeOk: Boolean(
        window.__naimageConnectionPortProbe?.ok === true &&
        window.__naimageConnectionPortProbe?.parentId === (window.__naimageArtifactSceneIds?.derivedId || "B")
      ),
      provenanceConnectionPortRuntimeMetrics: window.__naimageConnectionPortProbe || null,
      provenancePortStackingRuntimeOk: window.__naimageConnectionPortProbe?.stackingHitOk === true,
      provenanceLegacyEdgeStyleOk,
      provenanceActiveEdgeFlowOk,
      provenanceSimpleStablePathOk,
      provenanceEdgePathMetrics,
      provenanceEdgeLayerBelowNodesOk,
      provenanceEdgeLayerMetrics: {
        edgeLayerZIndex,
        edgeLayerZIndexRaw: edgeLayerStyle?.zIndex || "",
        nodeStackMetrics
      },
      provenanceStablePathRuntimeOk: window.__naimageEdgeStabilityProbe?.ok === true,
      provenanceStablePathRuntimeMetrics: window.__naimageEdgeStabilityProbe || null,
      provenanceObstacleNoRerouteRuntimeOk: window.__naimageEdgeObstacleProbe?.ok === true,
      provenanceObstacleNoRerouteRuntimeMetrics: window.__naimageEdgeObstacleProbe || null,
      provenanceEdgeCreationOrderRuntimeOk: window.__naimageEdgeOrderProbe?.creationAndDomOrderOk === true,
      provenanceEdgeCrossingRuntimeOk: window.__naimageEdgeOrderProbe?.crossingOk === true,
      provenanceEdgeCrossingPaintRuntimeOk: window.__naimageEdgeOrderProbe?.paintOrderOk === true,
      provenanceEdgeOrderRuntimeMetrics: window.__naimageEdgeOrderProbe || null,
      selectedNodeZOrderStableOk: window.__naimageEdgeStabilityProbe?.selectedNodeZOrderStable === true,
      zOrderDebugDataAvailable,
      zOrderDebugDataMissingIds,
      zOrderPersistenceContractOk,
      provenanceConnectedPortStateOk: document.querySelectorAll(".node-port.provenance-port.connected").length >= 3,
      provenanceSceneViewportOk: window.__naimageProvenanceSceneProbe?.ok === true,
      provenanceSceneViewportMetrics: window.__naimageProvenanceSceneProbe || null,
      workflowRelationTypeRuntimeOk: Boolean(
        window.__naimageRelationTypeProbe?.ok &&
        window.__naimageRelationTypeProbe?.actionCount === 1 &&
        /relation:\\s*variant/i.test(String(window.__naimageRelationTypeProbe?.envelope?.visibleOutput || ""))
      ),
      autoImageRelationRuntimeOk: Boolean(
        window.__naimageAutoImageProbe?.ok &&
        window.__naimageAutoImageProbe?.actionCount === 1 &&
        agentDebugState?.nodes?.some((node) => node.type === "image" && node.parentId === (window.__naimageArtifactSceneIds?.sourceId || "A"))
      ),
      agentImageGenTimerVisible: Boolean(imageGenTimerRect),
      agentToolPromptFoldOk: agentToolPromptBlocks.length > 0 && agentToolPromptBlocks.every((node) => !(node instanceof HTMLDetailsElement) || !node.open),
      agentToolPromptCount: agentToolPromptBlocks.length,
      agentToolBriefVisible: agentToolBriefNodes.length > 0,
      agentImageGenTimerPositionOk: !imageGenTimerRect || Boolean(
        imageGenTraceRect &&
        imageGenTimerRect.width <= imageGenTraceRect.width + 1 &&
        imageGenTimerRect.left >= imageGenTraceRect.left - 1 &&
        imageGenTimerRect.right <= imageGenTraceRect.right + 1 &&
        imageGenTimerRect.top >= imageGenTraceRect.top - 1 &&
        imageGenTimerRect.bottom <= imageGenTraceRect.bottom + 1 &&
        !imageGenTraceTitleRect &&
        (!imageGenTraceBriefRect || imageGenTraceBriefRect.bottom <= imageGenTraceRect.top + 1)
      ),
      agentImageGenTimerMetrics: {
        trace: imageGenTraceRect ? { left: imageGenTraceRect.left, top: imageGenTraceRect.top, right: imageGenTraceRect.right, bottom: imageGenTraceRect.bottom, width: imageGenTraceRect.width, height: imageGenTraceRect.height } : null,
        title: imageGenTraceTitleRect ? { left: imageGenTraceTitleRect.left, top: imageGenTraceTitleRect.top, right: imageGenTraceTitleRect.right, bottom: imageGenTraceTitleRect.bottom, width: imageGenTraceTitleRect.width, height: imageGenTraceTitleRect.height } : null,
        brief: imageGenTraceBriefRect ? { left: imageGenTraceBriefRect.left, top: imageGenTraceBriefRect.top, right: imageGenTraceBriefRect.right, bottom: imageGenTraceBriefRect.bottom, width: imageGenTraceBriefRect.width, height: imageGenTraceBriefRect.height } : null,
        timer: imageGenTimerRect ? { left: imageGenTimerRect.left, top: imageGenTimerRect.top, right: imageGenTimerRect.right, bottom: imageGenTimerRect.bottom, width: imageGenTimerRect.width, height: imageGenTimerRect.height } : null,
        widthOk: Boolean(imageGenTimerRect && imageGenTraceRect && imageGenTimerRect.width <= imageGenTraceRect.width + 1),
        topOk: Boolean(imageGenTimerRect && imageGenTraceRect && imageGenTimerRect.top >= imageGenTraceRect.top - 1),
        rightOk: Boolean(imageGenTimerRect && imageGenTraceRect && imageGenTimerRect.right <= imageGenTraceRect.right + 1),
        titleOverlap: Boolean(intersectRect(imageGenTimerRect, imageGenTraceTitleRect)),
        briefOverlap: Boolean(intersectRect(imageGenTimerRect, imageGenTraceBriefRect)),
        briefOutsideAbove: Boolean(imageGenTraceBriefRect && imageGenTraceRect && imageGenTraceBriefRect.bottom <= imageGenTraceRect.top + 1)
      },
      titlebarOverlay: getComputedStyle(element(".ide-topbar") || document.body).webkitAppRegion === "drag",
      titlebarBrandVisible: visible(".titlebar-brand") && /naimage/i.test(element(".titlebar-brand")?.textContent || ""),
      workbenchMinWidthOk,
      workbenchWidthMetrics: {
        innerWidth: Math.round(window.innerWidth),
        minWidth: ${workbenchMinWidth}
      },
      topbarCanvasActionLabels,
      topbarCanvasActionLabelsOk,
      topbarCanvasActionMetrics,
      topbarCanvasActionsFitOk,
      imageTaskButtonMetrics,
      imageTaskButtonsVisibleOk,
      imageTaskButtonStateOk,
      manualImageTaskControlsOk,
      manualImageTaskLayoutOk,
      manualImageTaskSubmitOk: window.__naimageManualTaskProbe?.ok === true,
      manualImageTaskProbe: window.__naimageManualTaskProbe || null,
      emptyCanvasActionLabels,
      emptyCanvasArtifactOnlyOk,
      canvasToolbarAbsent: !canvasToolbarRect,
      canvasStatusText: String(element(".canvas-status-line")?.textContent || "").replace(/\\s+/g, " ").trim(),
      canvasDynamicStatusTexts,
      canvasDynamicStatusCount: canvasDynamicStatusTexts.length,
      canvasDynamicStatusQuietOk: canvasDynamicStatusTexts.length === 0,
      canvasExecutionChrome,
      canvasExecutionChromeCount: canvasExecutionChrome.length,
      canvasExecutionChromeQuietOk: canvasExecutionChrome.length === 0,
      canvasStatusDockedBottom,
      canvasZoomDockedBottom,
      accountAvatarCircular: Boolean(avatarRect) && avatarRadius >= Math.floor(Math.min(avatarRect.width, avatarRect.height) / 2) - 1,
      oldAgentPanelUnmounted: !legacyAgentPanelMounted,
      rightCollapseAligned: Boolean(agentRect && rightCollapseRect) &&
        rightCollapseRect.right <= agentRect.right - 8 &&
        rightCollapseRect.top >= agentRect.top + 8 &&
        rightCollapseRect.bottom <= agentRect.top + 54,
      topbarCompactOk: Boolean(topbarRect && projectActionsRect && ideActionsRect && windowControlsRect) &&
        topbarRect.width <= window.innerWidth + 1 &&
        topbarRect.height <= 46 &&
        !topbarVerticalOverflow &&
        topbarCanvasActionsFitOk &&
        withinViewport(projectActionsRect, 1) &&
        withinViewport(ideActionsRect, 1) &&
        withinViewport(windowControlsRect, 1) &&
        topbarControlsDockedOk,
      topbarControlsDockedOk,
      shellFillsViewportOk,
      mainFillsViewportOk,
      canvasPanelFillsMainOk,
      canvasFooterDockedToPanelOk,
      canvasViewportFillOk,
      canvasViewportFillMetrics: {
        viewportHeight: Math.round(window.innerHeight),
        shellBottom: Math.round(shellRect?.bottom || 0),
        mainTop: Math.round(mainRect?.top || 0),
        mainBottom: Math.round(mainRect?.bottom || 0),
        canvasPanelTop: Math.round(canvasPanelRect?.top || 0),
        canvasPanelBottom: Math.round(canvasPanelRect?.bottom || 0),
        canvasFooterBottom: Math.round(canvasFooterRect?.bottom || 0),
        bottomBlankGap: canvasPanelRect ? Math.round(window.innerHeight - canvasPanelRect.bottom) : null
      },
      compactViewportFitOk,
      verticalOverflowFree: !documentVerticalOverflow && !bodyVerticalOverflow && !shellVerticalOverflow && !mainVerticalOverflow && !topbarVerticalOverflow,
      verticalOverflowMetrics: {
        document: documentVerticalOverflow,
        body: bodyVerticalOverflow,
        shell: shellVerticalOverflow,
        main: mainVerticalOverflow,
        topbar: topbarVerticalOverflow
      },
      menuWithinViewport: (!projectMenuOpen || withinViewport(projectMenuRect, 1)) && (!fileMenuOpen || withinViewport(fileMenuRect, 1)),
      canvasVisible: Boolean(canvasRect) && canvasRect.width >= 240 && canvasRect.height >= minVisibleCanvasHeight,
      agentPanelVisible: Boolean(agentSurfaceRect) && agentSurfaceRect.width >= 46 && agentSurfaceRect.height >= (window.innerWidth <= 740 ? 300 : 320),
      compactMainGridOk: Boolean(mainRect && canvasRect) &&
        mainRect.width <= window.innerWidth + 1 &&
        canvasRect.width >= 240 &&
        (canvasOnlyMain ? !legacyAgentPanelMounted : Boolean(agentRect && agentRect.width >= 220)),
      settingsDrawerWithinViewport: !settingsOpen || withinViewport(drawerRect, 1),
      settingsHeaderCompactOk: !settingsOpen || Boolean(settingsHeaderRect && settingsHeaderRect.height <= 82 && settingsHeaderRect.height >= 64),
      settingsHeaderBreathingOk,
      settingsDrawerBreathingOk: settingsDrawerFlushRightOk,
      settingsDrawerFlushRightOk,
      settingsDrawerWidthOk,
      settingsDrawerUiOk,
      accountDrawerFlushRightOk,
      accountDrawerWidthOk,
      accountHeaderBreathingOk,
      accountDrawerUiOk,
      settingsLabelsOk,
      settingsAppearanceControlsOk,
      settingsCustomThemeEditorOk,
      settingsThemeEditorScrollOk,
      customThemeInteractionOk: window.__naimageCustomThemeProbe?.ok === true,
      customThemeInteractionProbe: window.__naimageCustomThemeProbe || null,
      settingsContextCustomControlsOk,
      contextSettingsInteractionOk: window.__naimageContextSettingsProbe?.ok === true,
      contextSettingsInteractionProbe: window.__naimageContextSettingsProbe || null,
      settingsSaveControlsOk,
      settingsUpdateCenterOk,
      settingsLabelTexts: {
        headerTitle: settingsHeaderTitleText,
        headerSubtitle: settingsHeaderSubtitleText,
        sectionEyebrow: settingsSectionEyebrowText,
        sectionTitle: settingsSectionTitleText,
        modelFetchButton: modelFetchButtonText
      },
      modelFetchButtonTextOk,
      modelFetchButtonRightOk,
      modelFetchButtonAlignedOk,
      accountProfileCardOk,
      walletCardThreeColumnOk,
      walletCardPolishedOk,
      accountActionButtonsDesignedOk,
      usageLogListInsetOk,
      usageLogRowsCompactOk,
      accountDrawerUiMetrics: {
        width: Math.round(accountDrawerRect?.width || 0),
        actionButtons: accountActionButtonMetrics.map((item) => ({
          text: item.text,
          iconCount: item.iconCount,
          left: Math.round(item.left),
          top: Math.round(item.top),
          width: Math.round(item.width),
          height: Math.round(item.height),
          radius: Math.round(item.radius),
          background: item.background,
          color: item.color
        })),
        profileCard: {
          width: Math.round(accountProfileCardRect?.width || 0),
          height: Math.round(accountProfileCardRect?.height || 0),
          avatarWidth: Math.round(accountProfileAvatarRect?.width || 0),
          avatarHeight: Math.round(accountProfileAvatarRect?.height || 0),
          status: accountProfileStatusText
        },
        walletCard: {
          width: Math.round(walletCardWidth),
          height: Math.round(walletCardHeight),
          radius: Math.round(walletCardRadius),
          borderWidth: Math.round(walletCardBorderWidth),
          polishParts: walletCardPolishParts
        },
        walletColumns: walletCardItemRects.map((box) => ({
          left: Math.round(box.left),
          top: Math.round(box.top),
          width: Math.round(box.width),
          height: Math.round(box.height)
        })),
        usageLogLeftInset: usageLogListRect && accountDrawerRect ? Math.round(usageLogListRect.left - accountDrawerRect.left) : null,
        usageLogRightInset: usageLogListRect && accountDrawerRect ? Math.round(accountDrawerRect.right - usageLogListRect.right) : null,
        usageLogWidth: Math.round(usageLogListRect?.width || 0),
        usageLogRows: usageLogArticleRects.map((box) => ({
          top: Math.round(box.top),
          height: Math.round(box.height)
        })),
        headerTitleTopGap: accountHeaderTitleRect && accountDrawerRect ? Math.round(accountHeaderTitleRect.top - accountDrawerRect.top) : null,
        headerTitleBottomGap: accountHeaderRect && accountHeaderTitleRect ? Math.round(accountHeaderRect.bottom - accountHeaderTitleRect.bottom) : null
      },
      settingsDrawerUiMetrics: {
        width: Math.round(settingsDrawerRect?.width || 0),
        headerTitleTopGap: settingsHeaderTitleRect && settingsDrawerRect ? Math.round(settingsHeaderTitleRect.top - settingsDrawerRect.top) : null,
        headerTitleBottomGap: settingsHeaderRect && settingsHeaderTitleRect ? Math.round(settingsHeaderRect.bottom - settingsHeaderTitleRect.bottom) : null
      },
      settingsPromptActionFlowOk: !settingsOpen || !settingsPromptActionRect || !settingsDrawerRect ||
        settingsDrawerRect.bottom - settingsPromptActionRect.bottom >= Math.min(80, settingsDrawerRect.height * 0.14),
      modalWithinViewport: !modalOpen || withinViewport(activeDialogRect, 8),
      timelineNodeCount: document.querySelectorAll(".agent-message-node").length,
      timelineNodesVisible: Array.from(document.querySelectorAll(".agent-message-node")).some((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }),
      agentTimelineLeftLineOk,
      agentMessageTimelineMetrics: agentMessageTimelineMetrics.slice(-10),
      agentThinkingBlockMetrics: agentThinkingBlockMetrics.slice(-8),
      agentThinkingNoLeftRuleOk,
      agentRunningThinkingOpenOk,
      agentDoneThinkingCollapsedOk,
      composerModelCompact: Boolean(composerModelRect) && composerModelRect.width > 0 && composerModelRect.width <= 40,
      composerButtonsConsistent: buttonSizeMatch,
      agentTimelineBottomOk,
      agentFeedScrolledToBottom,
      lastAgentMessageBottomVisible,
      lastAgentMessageBottomGap,
      composerDoesNotCoverLastMessage,
      composerLastMessageOverlapArea,
      agentMessageLayoutOk,
      agentMessageLayoutMetrics: agentMessageLayoutMetrics.slice(-18),
      agentMessageLayoutFailures: agentMessageLayoutFailures.slice(0, 8),
      agentToolTraceLayoutOk,
      agentToolTraceOperationHiddenOk,
      agentToolTraceNoLeftRuleOk,
      agentToolTraceNoPseudoLeftRuleOk,
      agentToolTraceTitleBriefOk,
      agentToolTraceStyleMetrics: agentToolTraceStyleMetrics.slice(-8),
      agentToolTraceStructureMetrics: agentToolTraceStructureMetrics.slice(-8),
      agentToolTraceTexts: agentToolTraceTexts.slice(-6),
      agentImageGenToolLifecycleOrderOk,
      agentImageGenToolLifecycleOrderMetrics: {
        stages: imageGenToolStages,
        operationCount: imageGenOperations.size,
        operations: Array.from(imageGenOperations, ([operationId, stages]) => ({ operationId, stages }))
      },
      agentImageGenTimelineOrderOk,
      agentImageGenTimelineOrderMetrics: { imageGenStartIndex, imageGenResultIndex, imageGenFinalIndex },
      agentToolTraceLeakedTexts: agentToolTraceLeakedTexts.slice(0, 8),
      agentToolTraceOperationNodeCount,
      agentToolTracePresent: agentToolTraceMetrics.length > 0,
      agentToolTraceCount: agentToolTraceMetrics.length,
      agentImageGenStillRunningTextAbsent,
      agentImageGenTimerOk,
      agentImageGenSingleDynamicStatusOk,
      agentImageGenDynamicStatusOwnerCount: agentImageGenDynamicStatusOwners.length,
      agentImageGenDynamicStatusOwners,
      agentImageGenStillRunningTexts: agentImageGenStillRunningTexts.slice(0, 6),
      agentImageGenProgressTexts: agentImageGenProgressTexts.slice(-6),
      markdownCodeBlockLayoutOk,
      markdownCodeBlockPresent: markdownCodeBlockMetrics.length > 0,
      markdownCodeBlockCount: Math.floor(markdownCodeBlockMetrics.length / 2),
      markdownCodeHeaderPolishOk,
      markdownCodeHeaderMetrics: markdownCodeHeaderMetrics.slice(0, 6),
      agentPasteBlockLayoutOk,
      agentPasteBlockPresent: agentPasteBlockMetrics.length > 0,
      agentPasteBlockCount: agentPasteBlockMetrics.length,
      composerWithinAgentOk,
      agentComposerBottomPinned,
      agentComposerBottomGap,
      composerControlsVisibleOk,
      composerViewportVisibleOk,
      composerPopoverDocked: popoverDocked,
      composerPopoverAvoidsActions,
      popoverStopOverlapArea,
      popoverSupplementOverlapArea,
      busyModelPromptPresent,
      busySupplementModelPopoverOk,
      composerPopoverMetrics: {
        leftDelta: composerPopoverRect && composerInputRect ? Math.round((composerPopoverRect.left - composerInputRect.left) * 10) / 10 : null,
        rightDelta: composerPopoverRect && composerInputRect ? Math.round((composerPopoverRect.right - composerInputRect.right) * 10) / 10 : null,
        bottomGap: Math.round(popoverBottomGap * 10) / 10,
        boxShadow: composerPopoverStyle.boxShadow || "",
        radius: composerPopoverStyle.borderTopLeftRadius || ""
      },
      composerTextareaTall: Boolean(composerTextareaRect) && composerTextareaRect.height >= 76,
      settingsBoxless:
        parseFloat(settingListStyle.borderTopWidth || "0") === 0 &&
        parseFloat(settingListStyle.borderLeftWidth || "0") === 0 &&
        parseFloat(settingListStyle.borderRightWidth || "0") === 0,
      settingsRowsAiry: Boolean(settingConfigRowRect) && settingConfigRowRect.height >= 64,
      settingsChannelHidden: !bodyText.includes("当前渠道"),
      settingsThemeCopyRemovedOk: !settingsOpen || !bodyText.includes("主题与模型"),
      accountUsageLogLabel: bodyText.includes("使用日志") && !bodyText.includes("损耗日志"),
      accountUsageLogFailureVisibleOk: !accountOpen || usageLogTexts.some((value) => /生成失败/.test(value) && /输入 120 tokens/.test(value) && /输出 18 tokens/.test(value) && /耗时/.test(value)),
      accountUsageLogTimeOk: !accountOpen || usageLogTexts.every((value) => /20\\d{2}/.test(value) && !/1970|时间未知/.test(value)),
      accountSensitiveLogTextHiddenOk: !accountOpen || (!bodyContent.includes("aidebug-sensitive-token") && !bodyContent.includes("sk-aidebug12345678") && bodyContent.includes("敏感信息已隐藏")),
      accountUsageLogTexts: usageLogTexts,
      agentBridgeReady: Boolean(window.naimageAgent?.chat && window.naimageAgent?.runTool && window.naimageAgent?.tools && window.naimageAgent?.onProgress),
      agentDebugReady: Boolean(window.__naimageDebugSendAgentPrompt && window.__naimageDebugAgentState),
      agentDebugApiReady: Boolean(window.__naimageAIDebug?.runSuite && window.__naimageAIDebug?.runImageSuite && window.__naimageAIDebug?.runImageRecoverySuite && window.__naimageAIDebug?.runCanvasImageCollectionSuite && window.__naimageAIDebug?.runLayerStackSuite && window.__naimageAIDebug?.runCutoutSuite && window.__naimageAIDebug?.runRegionRedrawSuite && window.__naimageAIDebug?.runPosterBatchSuite && window.__naimageAIDebug?.runMixedStressSuite && window.__naimageAIDebug?.runTool),
      agentBusy,
      agentRunningUiOk,
      agentRunningStatusOk,
      agentStatusText,
      stopButtonOk,
      sendButtonDiagnostics: sendButton ? {
        className: String(sendButton.className || ""),
        text: String(sendButton.textContent || "").replace(/\s+/g, " ").trim(),
        ariaLabel: sendButton.getAttribute("aria-label") || "",
        title: sendButton.getAttribute("title") || "",
        disabled: Boolean(sendButton.disabled),
        width: metricRound(sendButtonRect?.width || 0),
        height: metricRound(sendButtonRect?.height || 0)
      } : null,
      composerControlDiagnostics: {
        nodeMode: agentNodeComposerMode,
        composer: composerRect ? { left: metricRound(composerRect.left), right: metricRound(composerRect.right), top: metricRound(composerRect.top), bottom: metricRound(composerRect.bottom), width: metricRound(composerRect.width), height: metricRound(composerRect.height) } : null,
        textarea: composerTextareaRect ? { left: metricRound(composerTextareaRect.left), right: metricRound(composerTextareaRect.right), height: metricRound(composerTextareaRect.height) } : null,
        toolbar: composerToolbarRect ? { left: metricRound(composerToolbarRect.left), right: metricRound(composerToolbarRect.right), height: metricRound(composerToolbarRect.height) } : null
      },
      runningTimelineDotOk,
      composerBusyPlaceholderOk,
      supplementButtonVisibleOk,
      supplementButtonPairOk,
      supplementButtonGap,
      supplementDraftPromptPresent,
      agentRunningSupplementDraftOk,
      referenceImageCount,
      referenceStripVisibleOk,
      referenceThumbsVisibleOk,
      referenceThumbVisualOk,
      referenceThumbPolishOk,
      referenceThumbMetrics,
      referenceRemoveButtonsOk,
      referenceStripToolbarOverlapArea,
      referenceStripSendOverlapArea,
      referenceStripSupplementOverlapArea,
      referenceStripToolbarGap,
      referenceStripLayoutOk,
      referenceAddButtonEnabledOk,
      referenceAddButtonDisabledOk,
      busyReferencePromptPresent,
      agentRunningReferenceStripOk,
      motionMetrics,
      focusStability,
      agentMotionCoreOk,
      supplementMotionOk,
      referenceRemoveMotionOk,
      popoverMotionOk,
      agentMotionOk,
      runningMessageCount,
      agentStoppedStatusOk,
      sendButtonIdleOk,
      agentInterruptMessageVisible,
      agentStopUiOk,
      interruptMessageCount,
      stopResendUserIndex,
      stopResendAssistantIndex,
      stopResendPromptVisible,
      stopResendAfterInterruptOk,
      stopResendAssistantOk,
      stopResendRuntimeRequestOk,
      stopResendWorkflowToolOk,
      stopResendImageGenUsed,
      stopResendPromptCleared,
      agentStopResendOk,
      busySupplementUserIndex,
      busySupplementAssistantIndex,
      busySupplementPromptVisible,
      busySupplementClickPathOk,
      busySupplementUserMetaOk,
      busySupplementRunId,
      busySupplementLatestProgressRunId,
      busySupplementRuntimeRequestOk,
      busySupplementWorkflowToolOk,
      busySupplementImageGenUsed,
      busySupplementPromptCleared,
      busySupplementAssistantOk,
      busySupplementLatestProgressOk,
      agentBusySupplementOk,
      agentIdle: agentDebugState?.agentStatus === "idle",
      agentNodeCount: Number(agentDebugState?.nodeCount || 0),
      agentImageNodeCount: Number.isFinite(Number(agentDebugState?.imageNodeCount))
        ? Number(agentDebugState.imageNodeCount)
        : Array.isArray(agentDebugState?.nodes)
          ? agentDebugState.nodes.filter((node) => node?.type === "image").length
          : 0,
      imageNodeCount: imageNodeLayouts.length,
      nodeFooterGapMax,
      nodeFooterGapOk: nodeFooterGapMax <= 18,
      imageNodeViewportOk,
      latestImageNodeViewport,
      selectedNodeId,
      selectedNodeType,
      selectedNodeVisibleRatio,
      selectedNodeVisibleOk,
      selectedImageNodeViewportOk,
      selectedNodeTitleVisibleOk,
      selectedImagePreviewDetailOk,
      selectedImagePreviewMetrics: selectedImagePreviewMetrics.slice(0, 12),
      selectedImagePreviewEffectiveArea,
      selectedImagePreviewGeometryOk,
      selectedImagePreviewLoadedOk,
      selectedImagePreviewDomPixelOk,
      selectedImagePreviewFullyVisibleOk,
      selectedPreviewGeometry,
      selectedNodeComposerOverlapArea,
      selectedNodeComposerOverlapRatio,
      selectedNodeComposerOverlapOk,
      selectedImageFocusOk,
      canvasZoomPercent,
      canvasZoomScale,
      canvasZoomUsableOk,
      visibleFlowNodeCount: visibleFlowNodeMetrics.length,
      visibleImageNodeCount,
      visibleImageNodeCountOk,
      visibleImagePreviewCount,
      imagePreviewVisibleCountOk,
      imagePreviewLoadedOk,
      imagePreviewPixelSampleOk,
      imagePreviewVisualOk,
      imagePreviewDetailOk,
      imagePreviewAreaMin,
      imagePreviewDetailThresholds,
      imagePreviewDetailMetrics: imagePreviewDetailMetrics.slice(0, 8),
      imagePreviewMetrics: [...imagePreviewMetrics]
        .sort((left, right) => Number(right.visible) - Number(left.visible) || Number(right.nodeId === selectedNodeId) - Number(left.nodeId === selectedNodeId))
        .slice(0, 24),
      selectedNodeNearestGap,
      selectedNodeNearestId: selectedNodeNearest?.id || "",
      selectedNodeNearestVisibleGap,
      selectedNodeNearestVisibleId: selectedNodeNearestVisible?.id || "",
      selectedNodeSpacingOk,
      compactCanvasDensityOk,
      canvasReadabilityOk,
      domVisualEvidenceOk,
      visualSurfaceMetrics,
      visualSurfaceFailures,
      flowNodeVisualEvidence: flowNodeVisualEvidence.slice(0, 24),
      visibleNodeStyleFailures: visibleNodeStyleFailures.slice(0, 12),
      centerOccludedNodeCount: centerOccludedNodes.length,
      centerOccludedNodes: centerOccludedNodes.slice(0, 12).map((item) => ({
        id: item.id,
        centerHitNodeId: item.centerHitNodeId,
        geometry: item.geometry,
        computedStyle: item.computedStyle,
        centerHitStack: item.centerHitStack
      })),
      previewOccludedNodeCount: previewOccludedNodes.length,
      previewOccludedNodes: previewOccludedNodes.slice(0, 12).map((item) => ({
        id: item.id,
        previewHitNodeId: item.previewHitNodeId,
        previewGeometry: item.previewGeometry,
        previewComputedStyle: item.previewComputedStyle,
        previewHitStack: item.previewHitStack
      })),
      nodeOverlapOk,
      nodeOverlapPairCount: nodeOverlapPairs.length,
      nodeOverlapAreaMax: Math.round(nodeOverlapAreaMax),
      nodeOverlapRatioMax: metricRound(nodeOverlapRatioMax),
      nodeOverlapPairs: nodeOverlapPairs.slice(0, 8),
      nodeTitlesVisibleOk,
      nodeTitleVisibleRatioMin: metricRound(nodeTitleVisibleRatioMin),
      nodeTitleTextClippedCount,
      visibleNodeTitleTextClippedCount,
      nodeTitleTextClippingAccessibleOk,
      visibleNodeTitlesLegibleOk,
      visibleNodeTitleHeightMin,
      nodeTitleReadableHeightMin,
      nodeTitleMetrics: nodeTitleMetrics.slice(0, 12),
      composerNodeOverlapOk,
      composerNodeOverlapCount: composerNodeOverlaps.length,
      composerNodeOverlapRatioMax: metricRound(composerNodeOverlapRatioMax),
      composerNodeOverlaps: composerNodeOverlaps.slice(0, 8),
      nodeLayouts,
      agentToolProgress: Number(agentDebugState?.toolProgressCount || 0) >= 3,
      agentForcedRetry: agentModelRetry,
      agentFinalMessage: /AIDebug Agent 已完成/.test(agentDebugState?.lastAssistant || ""),
      agentWorkflowClearTool,
      agentClearCanvasDone: agentDebugState?.agentStatus === "idle" && Number(agentDebugState?.nodeCount || 0) === 0 && agentWorkflowClearTool,
      agentClearCanvasFinal: /(清理|清空).{0,8}(完成|已完成)|节点已经清空|画布清理/.test(agentDebugState?.lastAssistant || ""),
      agentDebugState
    };
  })()`);
}
