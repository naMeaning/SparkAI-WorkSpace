"use strict";

// Repository-only mock model backend. Host state stays explicit so this module
// cannot reach Electron paths, settings, fixtures, or process globals by accident.
function createAidebugBackend({ enabled, log } = {}) {
  if (enabled !== true) throw new Error("AIDebug backend may only be created in AIDebug mode.");
  if (typeof log !== "function") throw new TypeError("AIDebug backend requires a log function.");

  function aidebugMessageText(message = {}) {
    const content = message?.content;
    if (typeof content === "string") return content;
    return content === undefined ? "" : JSON.stringify(content);
  }

  function aidebugLatestUserText(messages = []) {
    const latest = [...messages].reverse().find((message) => message?.role === "user");
    return aidebugMessageText(latest);
  }

  function aidebugIsRuntimeRetryText(text = "") {
    return /你刚才只回复了计划|重新判断|tool_calls|不要只说/i.test(String(text || ""));
  }

  function aidebugTaskText(messages = []) {
    const latestTask = [...messages].reverse().find((message) => message?.role === "user" && !aidebugIsRuntimeRetryText(aidebugMessageText(message)));
    return aidebugMessageText(latestTask);
  }

  function aidebugIsClearCanvasTask(text = "") {
    const intentText = String(text || "").replace(
      /(?:不要|无需|不需要|不用|别|禁止|避免|请勿|不得)(?:主动)?(?:清理|清空|清除|整理|删除|移除)(?:画布|工作台|节点|图片|图像|内容|任务|结果|重复|冗余节点|canvas|nodes?)?/gi,
      ""
    );
    return /(清理|清空|清除|整理).{0,12}(画布|节点|canvas|node)|(画布|节点|canvas|node).{0,12}(清理|清空|清除|整理)/i.test(intentText);
  }

  function aidebugIsImageTask(text = "") {
    const value = String(text || "").replace(
      /(?:不要|无需|不需要|不用|别|禁止|避免|请勿|不得)(?:主动)?(?:清理|清空|清除|整理|删除|移除)(?:画布|工作台|节点|图片|图像|内容|任务|结果|重复|冗余节点|canvas|nodes?)?/gi,
      ""
    );
    if (/(不要|无需|不需要|别|禁止).{0,12}(生图|生成图片|生成图像|出图|画图|绘图|图片|图像|image|generate)/i.test(value)) return false;
    return (
      /(生图|生成|画|绘制|出图|图片|图像|海报|封面|头像|角色|插画|写实|image|generate|poster)/i.test(value) ||
      /(?:再来|继续|接着|补|多来|多做).{0,12}(?:一|二|两|三|四|五|\d)?\s*(?:张|版|个版本|个方案)|按刚才.{0,16}(?:感觉|方向|风格).{0,16}(?:再来|继续|做|生成)/i.test(value)
    );
  }

  function aidebugLatestImageNodeId(messages = []) {
    const text = messages.map(aidebugMessageText).join("\n");
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of [...lines].reverse()) {
      if (!line.includes(" · ") || !/\simage\s/i.test(line)) continue;
      const match = line.match(/^([A-Za-z0-9_-]+)\s+/);
      if (match) return match[1];
    }
    return "";
  }

  function aidebugSelectedImageNodeId(messages = []) {
    const text = messages.map(aidebugMessageText).join("\n");
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of [...lines].reverse()) {
      if (!line.includes(" · ") || !/\simage\s/i.test(line)) continue;
      if (!/\bselected\s*=\s*(?:current|true|yes|1)\b/i.test(line)) continue;
      const match = line.match(/^([A-Za-z0-9_-]+)\s+/);
      if (match) return match[1];
    }
    const selectedId = text.match(/Current Selected Node:\s*(?:\r?\n\s*)?([A-Za-z0-9_-]+)/i)?.[1] || "";
    if (!selectedId) return "";
    const selectedPattern = new RegExp(`^${aidebugEscapeRegExp(selectedId)}\\s+`, "i");
    return lines.some((line) => selectedPattern.test(line) && /\simage\s/i.test(line)) ? selectedId : "";
  }

  function aidebugSelectedPromptNodeId(messages = []) {
    const text = messages.map(aidebugMessageText).join("\n");
    const selectedId = text.match(/Current Selected Node:\s*(?:\r?\n\s*)?([A-Za-z0-9_-]+)/i)?.[1] || "";
    if (!selectedId) return "";
    const selectedPattern = new RegExp(`^${aidebugEscapeRegExp(selectedId)}\\s+`, "i");
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.some((line) => selectedPattern.test(line) && /\beffect=prompt\b/i.test(line)) ? selectedId : "";
  }

  function aidebugWantsImageContinuation(text = "") {
    return /(基于|当前|选中|继续|变体|参考|延展|沿用).{0,28}(节点|图片|图像|图|image)|(?:再来|继续|接着|补|多来|多做).{0,16}(?:\d+|一|二|两|三|四|五|六|七|八|九|十)?\s*(?:张|版|个版本|个方案)|current selected|selected image|continue/i.test(String(text || ""));
  }

  function aidebugImageNodeRatio(messages = [], nodeId = "") {
    const cleanId = String(nodeId || "").trim();
    if (!cleanId) return "";
    const linePattern = new RegExp(`^${aidebugEscapeRegExp(cleanId)}\\s+`, "i");
    const line = messages
      .map(aidebugMessageText)
      .join("\n")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => linePattern.test(item) && /\simage\s/i.test(item));
    return String(line?.match(/\bratio=([^·\s]+)/i)?.[1] || "").trim();
  }

  function aidebugRequestedImageCount(text = "") {
    const value = String(text || "");
    const explicit = value.match(/\bcount\s*[:=]\s*(10|[1-9])\b/i);
    if (explicit) return Math.max(1, Math.min(Number(explicit[1]) || 1, 10));
    const withoutProgressFractions = value.replace(/(?:第\s*)?\d+\s*[\/／]\s*\d+\s*(?=张|个|轮|次)/g, "");
    const match = withoutProgressFractions.match(/(?:再来|继续|接着|补|生成|画|绘制|做|出|来)?\s*(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:张|版|个版本|个方案|种款式)/i);
    if (!match) return 1;
    const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return Math.max(1, Math.min(Number(match[1]) || map[match[1]] || 1, 10));
  }

  function aidebugPreviousImageRequest(messages = [], currentText = "") {
    return [...messages]
      .reverse()
      .filter((message) => message?.role === "user")
      .map(aidebugMessageText)
      .find((text) => text && text !== currentText && aidebugIsImageTask(text) && !aidebugWantsImageContinuation(text)) || "";
  }

  function aidebugWantsContextReadBeforeImage(text = "") {
    const value = String(text || "");
    return aidebugIsImageTask(value) && /\bcontext_manage\b.{0,80}\bread\b|(?:读取|读回|检索).{0,40}(?:经验|FastMemory|上下文|context|entry|selector)/i.test(value);
  }

  function aidebugHasToolResult(messages = [], toolName = "") {
    const needle = String(toolName || "");
    if (!needle) return false;
    return messages.some((message) => message?.role === "tool" && aidebugMessageText(message).includes(needle));
  }

  function aidebugHasContextReadResult(messages = []) {
    return messages.some((message) => {
      if (message?.role !== "tool") return false;
      const text = aidebugMessageText(message);
      return text.includes("context_manage") && /"action"\s*:\s*"read"|已读取|selectedEntryIds/i.test(text);
    });
  }

  function aidebugLineForExperienceMarker(text = "", marker = "") {
    const value = String(text || "");
    const sentinel = marker || (value.match(/\bAIDEBUG_(?:CONTEXT_PERSIST|AGENT_EXPERIENCE)_\d+\b/g) || []).pop() || "";
    if (!sentinel) return "";
    const line =
      [...value
        .split(/\r?\n/)
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter((item) => item.includes(sentinel))].pop() || sentinel;
    const sentinelIndex = line.indexOf(sentinel);
    if (sentinelIndex < 0) return line.slice(0, 260);
    const start = Math.max(0, sentinelIndex - 110);
    return line.slice(start, start + 260);
  }

  function aidebugEscapeRegExp(text = "") {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function aidebugSelectorFromTask(text = "") {
    const value = String(text || "");
    return (
      value.match(/\bselector\s*[=:]?\s*([a-z]+-[a-z0-9_-]+)/i)?.[1] ||
      value.match(/\bentry(?:Id)?\s*[=:]?\s*([a-z]+-[a-z0-9_-]+)/i)?.[1] ||
      ""
    );
  }

  function aidebugMessageSources(message = {}) {
    const text = aidebugMessageText(message);
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    return [parsed.visibleOutput, parsed.summary, text].map((item) => String(item || "")).filter(Boolean);
  }

  function aidebugExperienceHintForSelector(messages = [], selector = "") {
    const selected = String(selector || "").trim();
    if (!selected) return "";
    const selectedPattern = aidebugEscapeRegExp(selected);
    const markerAfterSelector = new RegExp(`${selectedPattern}[\\s\\S]{0,1400}?(AIDEBUG_(?:CONTEXT_PERSIST|AGENT_EXPERIENCE)_\\d+)`, "i");
    const markerBeforeSelector = new RegExp(`(AIDEBUG_(?:CONTEXT_PERSIST|AGENT_EXPERIENCE)_\\d+)[\\s\\S]{0,420}?${selectedPattern}`, "i");
    for (const message of [...messages].reverse()) {
      for (const source of aidebugMessageSources(message)) {
        if (!source.includes(selected)) continue;
        const primarySource = source.split(/AIDebug preserved markers:/i)[0] || source;
        const match =
          primarySource.match(markerAfterSelector) ||
          primarySource.match(markerBeforeSelector) ||
          source.match(markerAfterSelector) ||
          source.match(markerBeforeSelector);
        if (match?.[1]) return aidebugLineForExperienceMarker(primarySource.includes(match[1]) ? primarySource : source, match[1]);
      }
    }
    return "";
  }

  function aidebugLatestContextReadExperienceHint(messages = []) {
    for (const message of [...messages].reverse()) {
      if (message?.role !== "tool") continue;
      const text = aidebugMessageText(message);
      if (!text.includes("context_manage") || !/"action"\s*:\s*"read"|已读取|selectedEntryIds/i.test(text)) continue;
      for (const source of aidebugMessageSources(message)) {
        const hint = aidebugLineForExperienceMarker(source);
        if (hint) return hint;
      }
    }
    return "";
  }

  function aidebugMessageMarkers(text = "") {
    return Array.from(new Set(String(text || "").match(/\bAIDEBUG_[A-Z0-9_]+_\d+\b/g) || []));
  }

  function aidebugLogContextReadImageProbe(messages = [], taskText = "") {
    if (!enabled) return;
    const selector = aidebugSelectorFromTask(taskText);
    const rows = messages
      .map((message, index) => {
        const text = aidebugMessageText(message);
        return {
          index,
          role: message?.role || "",
          toolCallId: message?.tool_call_id || "",
          markers: aidebugMessageMarkers(text),
          hasContextManage: text.includes("context_manage"),
          hasRead: /"action"\s*:\s*"read"|\\?"action\\?"\s*:\s*\\?"read\\?"|已读取|selectedEntryIds/i.test(text)
        };
      })
      .filter((item) => item.markers.length || item.hasContextManage || item.hasRead || item.role === "tool");
    try {
      log(`aidebug context-read-image selector=${selector} selectorHint=${JSON.stringify(aidebugExperienceHintForSelector(messages, selector))} taskMarkers=${JSON.stringify(aidebugMessageMarkers(taskText))} hint=${JSON.stringify(aidebugLatestContextReadExperienceHint(messages))} messages=${JSON.stringify(rows)}`);
    } catch {
      log("aidebug context-read-image probe failed to serialize messages");
    }
  }

  function aidebugPersistenceExperienceHint(messages = [], taskText = "") {
    const task = String(taskText || "");
    if (!/AIDEBUG_(?:CONTEXT_PERSIST|AGENT_EXPERIENCE)_\d+|跨.?重启|persistence|persisted|FastMemory|绘画经验|经验/i.test(task)) return "";
    const selectorHint = aidebugExperienceHintForSelector(messages, aidebugSelectorFromTask(task));
    if (selectorHint) return selectorHint;
    const readHint = aidebugLatestContextReadExperienceHint(messages);
    if (readHint) return readHint;
    const text = messages.map(aidebugMessageText).join("\n");
    return aidebugLineForExperienceMarker(text);
  }

  function aidebugCompactSummaryHint(messages = [], taskText = "") {
    const task = String(taskText || "");
    if (!/AIDEBUG_COMPACT_SUMMARY_\d+|压缩摘要|compact summary|早期.{0,12}标记|summary marker/i.test(task)) return "";
    const text = messages.map(aidebugMessageText).join("\n");
    const sentinel = text.match(/\bAIDEBUG_COMPACT_SUMMARY_\d+\b/)?.[0] || "";
    if (!sentinel) return "";
    const line =
      text
        .split(/\r?\n/)
        .map((item) => item.trim().replace(/\s+/g, " "))
        .find((item) => item.includes(sentinel)) || sentinel;
    return line.slice(0, 260);
  }

  function aidebugTaskScopeSources(messages = []) {
    const text = messages.map(aidebugMessageText).join("\n");
    const sourceMarker = "SOURCE（需要处理）:";
    const referenceMarker = "REFERENCE（仅作参考，不决定输出数量）:";
    const sections = [];
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(sourceMarker, cursor);
      if (start < 0) break;
      const bodyStart = start + sourceMarker.length;
      const end = text.indexOf(referenceMarker, bodyStart);
      if (end < 0) break;
      sections.push(text.slice(bodyStart, end));
      cursor = end + referenceMarker.length;
    }
    const section = sections.at(-1) || "";
    return section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => {
        const [displayCode = "", ...fields] = line.slice(2).split("|").map((field) => field.trim());
        const values = Object.fromEntries(fields.map((field) => {
          const separator = field.indexOf("=");
          return separator > 0
            ? [field.slice(0, separator).trim(), field.slice(separator + 1).trim()]
            : ["", ""];
        }).filter(([key]) => key));
        return {
          displayCode,
          bindingId: values.bindingId && values.bindingId !== "-" ? values.bindingId : "",
          nodeId: values.node && values.node !== "-" ? values.node : ""
        };
      })
      .filter((source) => source.bindingId);
  }

  function aidebugImageArgs(text = "", messages = [], scopedSource = null) {
    const value = String(text || "");
    const taskScopeSource = scopedSource || aidebugTaskScopeSources(messages)[0] || null;
    const continuation = aidebugWantsImageContinuation(value) || Boolean(taskScopeSource);
    const parentId = taskScopeSource?.nodeId || (continuation
      ? aidebugSelectedImageNodeId(messages) || aidebugSelectedPromptNodeId(messages) || aidebugLatestImageNodeId(messages)
      : "");
    const explicitRatio = value.match(/(?:\bratio\s*[:=]\s*)?(21\s*[:：]\s*9|9\s*[:：]\s*21|16\s*[:：]\s*9|9\s*[:：]\s*16|4\s*[:：]\s*5|4\s*[:：]\s*3|3\s*[:：]\s*4|3\s*[:：]\s*2|2\s*[:：]\s*3|1\s*[:：]\s*1)/i)?.[1]
      ?.replace(/\s+/g, "")
      .replace("：", ":");
    let ratio = explicitRatio || (/3\s*[:：]\s*4|竖屏|竖版|海报|portrait/i.test(value) ? "3:4" : "1:1");
    if (continuation && parentId) ratio = aidebugImageNodeRatio(messages, parentId) || ratio;
    const explicitResolution = value.match(/\b(720P|1080P|2K|4K)\b/i)?.[1]?.toUpperCase();
    const explicitQuality = value.match(/\bquality\s*[:=]\s*(low|medium|high|auto)\b/i)?.[1]?.toLowerCase();
    const memoryHint = aidebugPersistenceExperienceHint(messages, value);
    const compactSummaryHint = aidebugCompactSummaryHint(messages, value);
    const hintLines = [
      memoryHint ? `跨重启绘画经验：${memoryHint}` : "",
      compactSummaryHint ? `压缩摘要保留标记：${compactSummaryHint}` : ""
    ].filter(Boolean);
    let prompt = hintLines.length
      ? `${value.slice(0, 380) || "AIDebug Agent 生图测试。"}\n${hintLines.join("\n")}`
      : value.slice(0, 480) || "AIDebug Agent 生图测试。";
    const previousImageRequest = continuation ? aidebugPreviousImageRequest(messages, value) : "";
    if (continuation && previousImageRequest) {
      prompt = [
        "基于来源图片节点继续生成新的独立完整图片。",
        `来源画面要求：${previousImageRequest.slice(0, 900)}`,
        `用户本次调整：${value.slice(0, 500)}`,
        "保留来源图的主体、风格和构图方向；多张结果必须为独立图片，不要拼图。",
        ...hintLines
      ].filter(Boolean).join("\n");
    }
    const args = {
      operation: taskScopeSource ? "edit" : "generate",
      prompt,
      ratio,
      resolution: explicitResolution || "720P",
      count: scopedSource ? 1 : aidebugRequestedImageCount(value),
      quality: explicitQuality || "auto",
      brief: "执行 AIDebug Agent 生图任务。"
    };
    if (parentId) args.parentId = parentId;
    if (taskScopeSource?.bindingId) args.sourceBindingId = taskScopeSource.bindingId;
    return args;
  }

  function aidebugImageFunctionCalls(prefix, text = "", messages = []) {
    const sources = aidebugTaskScopeSources(messages).slice(0, 10);
    if (sources.length <= 1) {
      return [aidebugFunctionCall(aidebugFunctionCallId(prefix), "image_gen", aidebugImageArgs(text, messages, sources[0] || null))];
    }
    return sources.map((source, index) => aidebugFunctionCall(
      aidebugFunctionCallId(`${prefix}-${index + 1}`),
      "image_gen",
      aidebugImageArgs(text, messages, source)
    ));
  }

  function aidebugCommandArgs(text = "") {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!/\bshell_command\b|\bcommand\b|Get-Content|rg\s+(?:--files|-n)|Get-Location|node\s+--version|npm\s+--version|pnpm\s+--version|git\s+status|git\s+branch/i.test(value)) return null;
    const getContent = value.match(/Get-Content\s+([^\s，,。]+)\s+-TotalCount\s+(\d{1,3})/i);
    if (getContent) {
      return {
        command: `Get-Content ${getContent[1]} -TotalCount ${getContent[2]}`,
        reason: "AIDebug stub 按用户明确请求读取项目文件片段。"
      };
    }
    const rgFiles = value.match(/rg\s+--files(?:\s+([^\s，,。]+))?/i);
    if (rgFiles) {
      return {
        command: `rg --files ${rgFiles[1] || "."}`.trim(),
        reason: "AIDebug stub 按用户明确请求列出项目文件。"
      };
    }
    const rgSearch = value.match(/rg\s+-n\s+([^\s，,。]+)\s+([^\s，,。]+)/i);
    if (rgSearch) {
      return {
        command: `rg -n ${rgSearch[1]} ${rgSearch[2]}`,
        reason: "AIDebug stub 按用户明确请求搜索项目源码。"
      };
    }
    for (const command of ["Get-Location", "node --version", "npm --version", "pnpm --version", "git status --short --branch", "git branch --show-current", "rg --version"]) {
      if (value.toLowerCase().includes(command.toLowerCase())) {
        return { command, reason: "AIDebug stub 按用户明确请求执行只读诊断命令。" };
      }
    }
    return null;
  }

  function aidebugContextManageArgs(text = "") {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!/\bcontext_manage\b/i.test(value)) return null;
    const asksToWriteExperience =
      /\badd_experience\b/i.test(value) ||
      /(?:记录|写入|新增|保存|添加).{0,18}(?:经验|experience)|(?:经验|experience).{0,10}(?:记录|写入|新增|保存|添加)/i.test(value);
    if (asksToWriteExperience) {
      const experienceText = value
        .replace(/^请调用\s*context_manage\s*add_experience\s*/i, "")
        .replace(/不要生成图片.*$/i, "")
        .trim();
      return {
        action: "add_experience",
        title: "AIDebug Agent 自主经验",
        text: experienceText || "AIDebug stub 按用户明确请求记录一条绘画经验。",
        rating: "note",
        brief: "AIDebug stub 记录一条绘画经验。"
      };
    }
    if (/\bread\b|读取|读回|检索/i.test(value)) {
      const targetMatch = value.match(/\btarget\s*[=:]?\s*(prompt|fastmemory|memorycontext|context)\b/i);
      const selectorMatch = value.match(/\bselector\s*[=:]?\s*([a-z]+-[a-z0-9_-]+)/i) || value.match(/\bentry(?:Id)?\s*[=:]?\s*([a-z]+-[a-z0-9_-]+)/i);
      return {
        action: "read",
        target: targetMatch ? targetMatch[1].toLowerCase() : "fastmemory",
        selector: selectorMatch ? selectorMatch[1] : "all",
        brief: "AIDebug stub 按用户明确请求读取外置上下文。"
      };
    }
    return null;
  }

  function aidebugExperienceArgs(text = "") {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (/(?:读取|读回|读一下|读|看看|参考).{0,48}(?:经验|绘画经验|FastMemory|fastmemory)|(?:经验|绘画经验|FastMemory|fastmemory).{0,32}(?:读取|读回|读一下|读|看看|参考|用上)/i.test(value)) {
      return {
        action: "read",
        brief: "读取 FastMemory 绘画经验。"
      };
    }
    if (/(?:记住|记一下|记录|保存|沉淀).{0,96}(?:经验|偏好|风格|这张|这个|这种|这版|下次|以后|感觉)|(?:下次|以后).{0,48}(?:按|照|沿用|保留|参考)/i.test(value)) {
      return {
        action: "add",
        title: "AIDebug 绘画经验",
        text: value.replace(/^(别画图|不要生图|别生图)[，,。；;\s]*/i, "") || "AIDebug mock 记录一条绘画经验。",
        rating: "note",
        brief: "记录 FastMemory 绘画经验。"
      };
    }
    return null;
  }

  function aidebugAskUserArgs(text = "") {
    const value = String(text || "");
    if (/AIDEBUG_ASK_SOURCE/i.test(value)) {
      return {
        kind: "source_images",
        title: "需要原图",
        question: "请上传本次真正需要处理的 SOURCE 原图。",
        detail: "上传后应恢复同一个任务与冻结的画布作用域。",
        suggestedAnswer: "已补充原图，请基于刚上传的 SOURCE 生成一张 1:1 蓝金电商测试图。",
        maxSourceImages: 12,
        brief: "请求用户上传待处理原图。"
      };
    }
    if (/AIDEBUG_ASK_REFERENCE/i.test(value)) {
      return {
        kind: "reference_images",
        title: "需要参考图",
        question: "请上传本次仅作视觉参考的 REFERENCE 图片。",
        detail: "参考图不能被提升为待修改原图。",
        suggestedAnswer: "已补充参考图，请参考它生成一张 1:1 蓝金电商测试图。",
        maxReferenceImages: 9,
        brief: "请求用户上传视觉参考图。"
      };
    }
    if (/AIDEBUG_ASK_CONFIRM/i.test(value)) {
      return {
        kind: "confirm",
        title: "确认继续",
        question: "这次批量任务采用哪种执行方式？",
        detail: "选择后必须恢复同一任务与冻结的 TaskScope，而不是创建裸的新请求。",
        suggestedAnswer: "先生成 3 版供我核对，确认方向后再扩大批量。",
        options: [
          { id: "preview-3", label: "先做 3 版", description: "先核对画面方向，再扩大批量。", answer: "先生成 3 版供我核对，确认方向后再扩大批量。", recommended: true },
          { id: "staged", label: "阶段性批量", description: "按阶段分批生成并逐步核对。", answer: "按阶段分批生成，每批完成后继续。" },
          { id: "direct", label: "直接批量", description: "已确认要求，立即处理全部素材。", answer: "我确认直接批量处理全部素材。" }
        ],
        brief: "请求用户确认继续。"
      };
    }
    if (/AIDEBUG_ASK_CLARIFY/i.test(value)) {
      return {
        kind: "clarify",
        title: "补充版式要求",
        question: "请确认本次图片的版式与配色。",
        detail: "回答后应恢复原任务、Requirement 与 SOURCE 归属。",
        suggestedAnswer: "采用 3:4 竖版与蓝金配色，请直接按原任务生成图片。",
        brief: "请求用户补充关键版式。"
      };
    }
    if (!/(参考图|源图|原图|reference\s*image).{0,40}(还没上传|没上传|没有|缺少|问我要|让我上传|请先问|先问)|(?:问我要|让我上传|请先问|先问).{0,40}(参考图|源图|原图|reference\s*image)/i.test(value)) return null;
    return {
      kind: "reference_images",
      title: "需要参考图",
      question: "请先上传参考图，我拿到参考图后再继续处理。",
      detail: "当前请求依赖参考图，但工作台里还没有可用参考图。",
      maxReferenceImages: 9,
      brief: "请求用户上传参考图。"
    };
  }

  function aidebugWebSearchArgs(text = "") {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!/\bweb_search\b|联网|搜索|查一下|检索/i.test(value)) return null;
    const query =
      value.match(/(?:web_search|搜索|查一下|检索)\s*([^，。；;]+?)(?:，|。|；|;|不要|$)/i)?.[1]?.trim() ||
      "naimage Agent 工具 schema 设计";
    return {
      query,
      brief: "执行联网检索请求。"
    };
  }

  function aidebugViewImageArgs(text = "") {
    const value = String(text || "").trim();
    if (!/\bview_image\b|观察这张本地图片|观察.*本地图片|检查.*本地图片/i.test(value)) return null;
    const pathMatch = value.match(/([A-Za-z]:\\[^，。；;\n]+?\.(?:png|jpe?g|webp))/i);
    return {
      path: pathMatch ? pathMatch[1].trim() : "",
      detail: "high"
    };
  }

  function aidebugToolNames(tools = []) {
    return new Set((Array.isArray(tools) ? tools : []).map((tool) => {
      const name = String(tool?.function?.name || tool?.name || "").trim();
      if (name) return name;
      return String(tool?.type || "") === "web_search" ? "web_search" : "";
    }).filter(Boolean));
  }

  function aidebugWorkflowOperations(tools = []) {
    const workflow = (Array.isArray(tools) ? tools : []).find((tool) => tool?.function?.name === "workflow");
    const operations = workflow?.function?.parameters?.properties?.operation?.enum;
    return new Set(Array.isArray(operations) ? operations.map((item) => String(item || "")) : []);
  }

  function aidebugWorkflowOperationForPrompt(text = "", availableOperations = new Set()) {
    const value = String(text || "").toLowerCase();
    const candidates = [
      { operation: "clear_canvas", terms: ["清理", "清空", "清除", "整理", "画布", "canvas", "clear", "clean"] },
      { operation: "delete_node", terms: ["删除", "移除", "delete", "remove", "节点", "node"] },
      { operation: "connect_nodes", terms: ["连接", "连线", "connect", "source", "target", "节点", "node"] },
      { operation: "disconnect_node", terms: ["断开", "取消连接", "disconnect", "unlink", "节点", "node"] },
      { operation: "focus_node", terms: ["定位", "聚焦", "focus", "找到", "节点", "node"] },
      { operation: "describe_node", terms: ["详情", "描述", "查看", "describe", "节点", "node"] },
      { operation: "list_nodes", terms: ["列出", "查看", "看看", "列表", "有哪些", "list", "画布", "节点", "canvas", "node"] }
    ];
    let best = { operation: "list_nodes", score: 0 };
    for (const candidate of candidates) {
      if (!availableOperations.has(candidate.operation)) continue;
      const explicitClear =
        candidate.operation === "clear_canvas" &&
        (/(清理|清空|清除|整理).{0,8}(画布|节点|canvas|node)|(画布|节点|canvas|node).{0,8}(清理|清空|清除|整理)/i.test(value) || /\bclear_canvas\b|clear\s+(?:canvas|nodes?)/i.test(value));
      const score =
        candidate.operation === "clear_canvas" && !explicitClear
          ? 0
          : candidate.terms.reduce((total, term) => total + (value.includes(term) ? 1 : 0), 0);
      const phraseBonus = explicitClear ? 3 : 0;
      if (score + phraseBonus > best.score) best = { operation: candidate.operation, score: score + phraseBonus };
    }
    if (best.score > 0 && availableOperations.has(best.operation)) return best.operation;
    return availableOperations.has("list_nodes") ? "list_nodes" : "";
  }

  function aidebugWorkflowArgs(operation = "list_nodes") {
    const briefByOperation = {
      clear_canvas: "清理当前画布。",
      delete_node: "删除指定成果。",
      connect_nodes: "维护成果关系。",
      disconnect_node: "移除成果关系。",
      focus_node: "定位成果。",
      describe_node: "查看成果详情。",
      list_nodes: "读取当前成果列表。"
    };
    return {
      operation,
      ...(operation === "connect_nodes" ? { relationType: "derived-from" } : {}),
      brief: briefByOperation[operation] || "执行工作台操作。"
    };
  }

  function aidebugFunctionCall(callId, name, args) {
    return {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify(args)
    };
  }

  function aidebugToolChoiceFunctionName(payload = {}) {
    const choice = payload.tool_choice ?? payload.toolChoice;
    if (!choice || typeof choice !== "object") return "";
    return String(choice.function?.name || "").trim();
  }

  function aidebugResponseFromOutput(output, model, stream, onStreamEvent) {
    const outputText = output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .map((part) => part.text || "")
      .join("");
    const response = { model, status: "completed", output, output_text: outputText };
    const chunks = [];
    for (const item of output.filter((entry) => entry.type === "web_search_call")) {
      chunks.push(
        { type: "response.output_item.added", output_index: output.indexOf(item), item: { ...item, status: "in_progress" } },
        { type: "response.web_search_call.searching", item_id: item.id, action: item.action },
        { type: "response.output_item.done", output_index: output.indexOf(item), item: { ...item, status: "completed" } }
      );
    }
    chunks.push({ type: "response.completed", response });
    if (typeof onStreamEvent === "function") chunks.forEach((chunk) => onStreamEvent(chunk));
    if (stream) return { stream: true, chunks, model };
    return response;
  }

  function aidebugFinalTextForToolResults(messages = []) {
    const toolText = messages.filter((message) => message?.role === "tool").map((message) => String(message.content || "")).join("\n");
    if (/clear_canvas|清理当前画布|WORKBENCH 清理/.test(toolText)) {
      return "画布清理已完成，当前工作台节点已经清空。";
    }
    if (/image_gen|IMAGE 绘图|AIDebug Agent 生图/.test(toolText)) {
      if (/"ok"\s*:\s*false|"errorCategory"\s*:\s*"(?:invalid_input|missing_reference|auth|quota|policy)"/i.test(toolText)) {
        return "AIDebug Agent 图片工具返回失败，任务尚未完成。";
      }
      return "AIDebug Agent 生图任务已完成，图片节点已同步到画布。";
    }
    return "AIDebug Agent 已完成工具链验证：正文、工具调用和工具返回都已同步。";
  }

  function aidebugCurrentTurnMessages(messages = []) {
    const source = Array.isArray(messages) ? messages : [];
    let lastUserIndex = -1;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (source[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    return lastUserIndex >= 0 ? source.slice(lastUserIndex) : source;
  }

  let aidebugFunctionCallSequence = 0;

  function aidebugFunctionCallId(name = "tool") {
    aidebugFunctionCallSequence = (aidebugFunctionCallSequence + 1) % Number.MAX_SAFE_INTEGER;
    const cleanName = String(name || "tool").trim().replace(/[^a-z0-9_-]+/gi, "-") || "tool";
    return `aidebug-${cleanName}-${Date.now().toString(36)}-${aidebugFunctionCallSequence.toString(36)}`;
  }

  function aidebugChatCompletion(payload = {}) {
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const turnMessages = aidebugCurrentTurnMessages(messages);
    const toolNames = aidebugToolNames(payload.tools);
    const workflowOperations = aidebugWorkflowOperations(payload.tools);
    const model = String(payload.model || "aidebug-agent");
    const hasToolResult = turnMessages.some((message) => message?.role === "tool");
    const userText = aidebugTaskText(messages) || aidebugLatestUserText(messages);
    log(`aidebug model classify imageTask=${aidebugIsImageTask(userText)} continuation=${aidebugWantsImageContinuation(userText)} hasToolResult=${hasToolResult} turnMessages=${turnMessages.length} historyMessages=${messages.length} user=${JSON.stringify(String(userText || "").slice(0, 180))}`);
    const wantsContextReadBeforeImage = aidebugWantsContextReadBeforeImage(userText) && toolNames.has("context_manage") && toolNames.has("image_gen");
    const wantsExperienceReadBeforeImage =
      aidebugIsImageTask(userText) &&
      toolNames.has("experience") &&
      toolNames.has("image_gen") &&
      /(?:先|先去|先看看|看看|读取|读回|读一下|读|参考).{0,48}(?:经验|绘画经验|FastMemory|fastmemory)|(?:经验|绘画经验|FastMemory|fastmemory).{0,32}(?:读取|读回|读一下|读|看看|参考|用上|按)/i.test(userText);
    const hasImageToolResult = aidebugHasToolResult(turnMessages, "image_gen");
    const hasContextReadResult = aidebugHasContextReadResult(turnMessages);
    const hasExperienceResult = aidebugHasToolResult(turnMessages, "experience");
    const forcedToolName = aidebugToolChoiceFunctionName(payload);
    const hasPriorPlanOnly = turnMessages.some(
      (message) =>
        message?.role === "assistant" &&
        /我会直接清理画布|我先(?:查看|读取).*画布|保留有效成图|删除失败.*重复冗余节点/i.test(aidebugMessageText(message))
    );
    const date = new Date().toISOString().slice(0, 10);
    if (!hasToolResult && forcedToolName === "image_gen" && toolNames.has("image_gen")) {
      return aidebugResponseFromOutput(
        [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我会直接调用 image_gen 创建测试图片节点。"
              }
            ]
          },
          ...aidebugImageFunctionCalls("image-gen-forced", userText, messages)
        ],
        model,
        Boolean(payload.stream),
        payload.onStreamEvent
      );
    }
    if (!hasToolResult && toolNames.has("ask_user")) {
      const askArgs = aidebugAskUserArgs(userText);
      if (askArgs) {
        return aidebugResponseFromOutput(
          [
            {
              type: "message",
              content: [{ type: "output_text", text: "我需要先向用户请求参考图。" }]
            },
            aidebugFunctionCall(aidebugFunctionCallId("ask-user"), "ask_user", askArgs)
          ],
          model,
          Boolean(payload.stream),
          payload.onStreamEvent
        );
      }
    }
    if (!hasToolResult && toolNames.has("experience")) {
      const experienceArgs = aidebugExperienceArgs(userText);
      if (experienceArgs) {
        return aidebugResponseFromOutput(
          [
            {
              type: "message",
              content: [{ type: "output_text", text: "我会通过 experience 处理绘画经验。" }]
            },
            aidebugFunctionCall(aidebugFunctionCallId("experience"), "experience", experienceArgs)
          ],
          model,
          Boolean(payload.stream),
          payload.onStreamEvent
        );
      }
    }
    if (!hasToolResult && toolNames.has("web_search")) {
      const searchArgs = aidebugWebSearchArgs(userText);
      if (searchArgs) {
        const output = [
          {
            type: "web_search_call",
            id: "aidebug-web-search",
            status: "completed",
            action: { type: "search", query: searchArgs.query }
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "已使用原生网页搜索核对相关资料。" }]
          }
        ];
        if (aidebugIsImageTask(userText) && toolNames.has("image_gen")) {
          output.push(...aidebugImageFunctionCalls("image-after-search", userText, messages));
        }
        return aidebugResponseFromOutput(
          output,
          model,
          Boolean(payload.stream),
          payload.onStreamEvent
        );
      }
    }
    if (!hasToolResult && toolNames.has("view_image")) {
      const viewArgs = aidebugViewImageArgs(userText);
      if (viewArgs) {
        return aidebugResponseFromOutput(
          [
            {
              type: "message",
              content: [{ type: "output_text", text: "我会调用 view_image 观察本地图片。" }]
            },
            aidebugFunctionCall(aidebugFunctionCallId("view-image"), "view_image", viewArgs)
          ],
          model,
          Boolean(payload.stream),
          payload.onStreamEvent
        );
      }
    }
    if (!hasToolResult && aidebugIsClearCanvasTask(userText) && !hasPriorPlanOnly) {
      return aidebugResponseFromOutput(
        [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我会直接清理当前画布。"
              }
            ]
          },
          aidebugFunctionCall(aidebugFunctionCallId("workflow-clear"), "workflow", aidebugWorkflowArgs("clear_canvas", userText))
        ],
        model,
        Boolean(payload.stream),
        payload.onStreamEvent
      );
    }
    if (!hasToolResult && aidebugIsImageTask(userText) && toolNames.has("image_gen") && !wantsContextReadBeforeImage) {
      return aidebugResponseFromOutput(
        [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我会直接调用 image_gen 创建测试图片节点。"
              }
            ]
          },
          ...aidebugImageFunctionCalls("image-gen", userText, messages)
        ],
        model,
        Boolean(payload.stream),
        payload.onStreamEvent
      );
    }
    if (hasToolResult && wantsContextReadBeforeImage && hasContextReadResult && !hasImageToolResult) {
      aidebugLogContextReadImageProbe(messages, userText);
      return aidebugResponseFromOutput(
        [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我已读回绘画经验，会把读回内容用于 image_gen。"
              }
            ]
          },
          ...aidebugImageFunctionCalls("experience-image-gen", userText, messages)
        ],
        model,
        Boolean(payload.stream),
        payload.onStreamEvent
      );
    }
    if (hasToolResult && wantsExperienceReadBeforeImage && hasExperienceResult && !hasImageToolResult) {
      return aidebugResponseFromOutput(
        [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我已读取绘画经验，会继续调用 image_gen 生成新版本。"
              }
            ]
          },
          ...aidebugImageFunctionCalls("experience-read-image-gen", userText, messages)
        ],
        model,
        Boolean(payload.stream),
        payload.onStreamEvent
      );
    }
    const output = hasToolResult
      ? [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: aidebugFinalTextForToolResults(turnMessages)
              }
            ]
          }
        ]
      : [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "我会根据当前工作台状态执行需要的操作。"
              }
            ]
          }
        ];

    if (!hasToolResult && toolNames.has("context_manage")) {
      const contextArgs = aidebugContextManageArgs(userText);
      if (contextArgs) {
        output.push(aidebugFunctionCall(aidebugFunctionCallId("context-manage"), "context_manage", contextArgs));
      }
    }
    if (!hasToolResult && toolNames.has("shell_command")) {
      const commandArgs = aidebugCommandArgs(userText);
      if (commandArgs) {
        output.push(aidebugFunctionCall(aidebugFunctionCallId("shell-command"), "shell_command", commandArgs));
      }
    }
    if (!hasToolResult && toolNames.has("workflow") && !wantsContextReadBeforeImage) {
      const operation = aidebugWorkflowOperationForPrompt(userText, workflowOperations);
      if (operation) {
        output.push(aidebugFunctionCall(aidebugFunctionCallId("workflow"), "workflow", aidebugWorkflowArgs(operation, userText)));
      }
    }
    if (!hasToolResult && !output.some((item) => item.type === "function_call") && toolNames.has("context_manage")) {
      output.push({
        type: "function_call",
        call_id: aidebugFunctionCallId("context"),
        name: "context_manage",
        arguments: JSON.stringify({
          action: "add",
          target: "fastmemory",
          section: "surface",
          title: "AIDebug Agent 工具链验证",
          text: "AIDebug 验证 Agent 能在同一条 assistant 消息中输出正文和工具调用。",
          keywords: ["aidebug", "agent", "tool"]
        })
      });
    }
    if (!hasToolResult && !output.some((item) => item.type === "function_call") && toolNames.has("memory")) {
      output.push({
        type: "function_call",
        call_id: aidebugFunctionCallId("memory"),
        name: "memory",
        arguments: JSON.stringify({
          operation: "add",
          target: "datememory",
          entries: [
            {
              date,
              title: "AIDebug Agent 工具链验证",
              content: "Agent 主链路返回正文后继续执行工具，并向前端发送工具进度。",
              keywords: ["aidebug", "agent"]
            }
          ]
        })
      });
    }
    return aidebugResponseFromOutput(output, model, Boolean(payload.stream), payload.onStreamEvent);
  }

  return Object.freeze({
    chatCompletion: aidebugChatCompletion
  });
}

module.exports = {
  createAidebugBackend
};
