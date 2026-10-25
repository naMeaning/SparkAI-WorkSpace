import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Keyboard, RotateCcw } from "lucide-react";

import {
  builtinPluginManifests,
  canvasToolShortcutFromKeyboardEvent,
  canvasToolShortcutLabel,
  canvasToolShortcutsConflict,
  normalizeCanvasToolShortcuts,
  normalizePluginStates
} from "./plugin-system";
import type { WorkspaceAssetRailTabId } from "./core";
import { ButtonBase } from "./ui";

type CanvasToolDockMode = "expanded" | "hover";

const assetRailOptions: Array<{ id: WorkspaceAssetRailTabId; label: string; description: string }> = [
  { id: "results", label: "成果", description: "生成、导入及处理中图片" },
  { id: "layers", label: "图层", description: "分层图片与合成结果" },
  { id: "requirements", label: "需求", description: "画布中的可复用需求" },
  { id: "templates", label: "模板", description: "保存在本机的需求模板" }
];

export default function CanvasToolsSettingsPanel({
  states,
  mode,
  wheelMode,
  onWheelModeChange,
  hiddenCommands,
  shortcuts,
  visibleAssetRailTabs,
  onModeChange,
  onHiddenCommandsChange,
  onShortcutsChange,
  onVisibleAssetRailTabsChange
}: {
  states: Parameters<typeof normalizePluginStates>[0];
  mode: CanvasToolDockMode;
  wheelMode: "zoom" | "pan";
  onWheelModeChange: (mode: "zoom" | "pan") => void;
  hiddenCommands: string[];
  shortcuts: Record<string, string>;
  visibleAssetRailTabs: WorkspaceAssetRailTabId[];
  onModeChange: (mode: CanvasToolDockMode) => void;
  onHiddenCommandsChange: (commands: string[]) => void;
  onShortcutsChange: (shortcuts: Record<string, string>) => void;
  onVisibleAssetRailTabsChange: (tabs: WorkspaceAssetRailTabId[]) => void;
}) {
  const [recordingCommand, setRecordingCommand] = useState("");
  const [shortcutFeedback, setShortcutFeedback] = useState<{ command: string; tone: "neutral" | "danger"; text: string } | null>(null);
  const normalizedStates = normalizePluginStates(states);
  const normalizedShortcuts = normalizeCanvasToolShortcuts(shortcuts);
  const hidden = new Set(hiddenCommands);
  const configuredRailTabs = visibleAssetRailTabs.filter((tab) => tab !== "history");
  const visibleRailTabs: WorkspaceAssetRailTabId[] = configuredRailTabs.length ? configuredRailTabs : ["results"];
  const tools = builtinPluginManifests.flatMap((manifest) => {
    const state = normalizedStates.find((item) => item.id === manifest.id);
    const available = Boolean(state?.enabled);
    return manifest.contributes.toolbar.map((tool) => ({
      ...tool,
      manifestName: manifest.name,
      available,
      visible: available && !hidden.has(tool.command),
      shortcut: normalizedShortcuts[tool.command] ?? tool.shortcut,
      customized: Object.prototype.hasOwnProperty.call(normalizedShortcuts, tool.command),
      statePresent: Boolean(state)
    }));
  });

  function setCommandVisible(command: string, visible: boolean) {
    const next = visible
      ? hiddenCommands.filter((item) => item !== command)
      : [...hiddenCommands.filter((item) => item !== command), command];
    setRecordingCommand("");
    setShortcutFeedback(null);
    onHiddenCommandsChange(next);
  }

  function resetShortcut(command: string) {
    const next = { ...normalizedShortcuts };
    delete next[command];
    setRecordingCommand("");
    setShortcutFeedback(null);
    onShortcutsChange(normalizeCanvasToolShortcuts(next));
  }

  function captureShortcut(event: ReactKeyboardEvent<HTMLButtonElement>, command: string) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingCommand("");
      setShortcutFeedback(null);
      return;
    }
    if (event.repeat) return;
    const shortcut = canvasToolShortcutFromKeyboardEvent({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey
    });
    if (!shortcut) {
      const modifierOnly = ["Alt", "Control", "Meta", "Shift"].includes(event.key);
      setShortcutFeedback({
        command,
        tone: modifierOnly ? "neutral" : "danger",
        text: modifierOnly ? "继续按字母、数字或功能键" : "请使用修饰键与字母、数字或 F1-F12 的组合"
      });
      return;
    }
    const conflict = tools.find((tool) => tool.command !== command
      && canvasToolShortcutsConflict(tool.shortcut, shortcut));
    if (conflict) {
      setShortcutFeedback({ command, tone: "danger", text: `与“${conflict.label}”的快捷键冲突` });
      return;
    }
    onShortcutsChange(normalizeCanvasToolShortcuts({ ...normalizedShortcuts, [command]: shortcut }));
    setRecordingCommand("");
    setShortcutFeedback(null);
  }

  function setAssetRailTabVisible(tab: WorkspaceAssetRailTabId, visible: boolean) {
    if (!visible && visibleRailTabs.length <= 1) return;
    onVisibleAssetRailTabsChange(assetRailOptions
      .map((item) => item.id)
      .filter((item) => item === tab ? visible : visibleRailTabs.includes(item)));
  }

  return (
    <div className="settings-canvas-tools">
      <div className="settings-canvas-tool-mode">
        <strong>滚轮与触控板</strong>
        <div className="ui-segment-control" role="group" aria-label="画布滚动方式">
          <ButtonBase type="button" className="ui-segment-action" aria-pressed={wheelMode === "zoom"} onClick={() => onWheelModeChange("zoom")}>滚轮缩放</ButtonBase>
          <ButtonBase type="button" className="ui-segment-action" aria-pressed={wheelMode === "pan"} onClick={() => onWheelModeChange("pan")}>双指平移</ButtonBase>
        </div>
        <small>捏合或 Ctrl / Cmd + 滚轮始终围绕光标缩放；Shift + 滚轮横向平移。画布缩放不改变图片像素。</small>
      </div>
      <p className="settings-category-hint">画布底部“工具”提供搜索、领域和最近使用；会话历史可从 Agent 会话名打开。</p>

      <section className="settings-canvas-tool-group" aria-labelledby="settings-asset-rail-visibility-label">
        <div className="settings-canvas-tool-group-heading">
          <strong id="settings-asset-rail-visibility-label">左侧素材栏</strong>
          <small>勾选需要显示的模块，至少保留一项。</small>
        </div>
        <div className="settings-canvas-tool-list" aria-label="左侧素材栏模块">
          {assetRailOptions.map((item) => {
            const visible = visibleRailTabs.includes(item.id);
            const lastVisible = visible && visibleRailTabs.length === 1;
            return (
              <label
                key={item.id}
                className={`settings-canvas-tool-row${lastVisible ? " is-required" : ""}`}
                data-asset-rail-tab={item.id}
                title={lastVisible ? "左侧素材栏至少需要保留一个模块" : undefined}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={lastVisible}
                  onChange={(event) => setAssetRailTabVisible(item.id, event.currentTarget.checked)}
                />
                <span className="settings-canvas-tool-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-canvas-tool-group" aria-labelledby="settings-toolbar-visibility-label">
        <div className="settings-canvas-tool-group-heading">
          <strong id="settings-toolbar-visibility-label">底部工具栏</strong>
          <small>勾选需要显示的工具。</small>
        </div>
        <div className="settings-canvas-tool-list" aria-label="底部工具栏工具">
        {tools.map((tool) => {
          const recording = recordingCommand === tool.command;
          const feedback = shortcutFeedback?.command === tool.command ? shortcutFeedback : null;
          return (
            <div
              key={tool.command}
              className={`settings-canvas-tool-row${tool.available ? "" : " is-unavailable"}`}
              data-canvas-tool-command={tool.command}
            >
              <input
                type="checkbox"
                aria-label={`${tool.visible ? "从工具栏隐藏" : "在工具栏显示"}${tool.label}`}
                checked={tool.visible}
                disabled={!tool.available}
                onChange={(event) => setCommandVisible(tool.command, event.currentTarget.checked)}
              />
              <span className="settings-canvas-tool-copy">
                <strong>{tool.label}</strong>
                <small>{tool.manifestName} · {tool.available
                  ? tool.visible ? "显示在底部工具栏" : "已从底部工具栏隐藏"
                  : tool.statePresent ? "插件已停用" : "插件未安装"}</small>
                <span>{tool.description}</span>
              </span>
              <span className="settings-canvas-tool-shortcut">
                <ButtonBase
                  type="button"
                  className={`settings-canvas-tool-shortcut-recorder${recording ? " is-recording" : ""}`}
                  data-shortcut-recorder
                  disabled={!tool.available}
                  aria-label={`修改${tool.label}快捷键`}
                  aria-pressed={recording}
                  title={recording ? "按 Esc 取消" : `修改快捷键：${canvasToolShortcutLabel(tool.shortcut) || "未设置"}`}
                  onClick={() => {
                    setRecordingCommand(tool.command);
                    setShortcutFeedback({ command: tool.command, tone: "neutral", text: "等待新的快捷键" });
                  }}
                  onKeyDown={(event) => recording && captureShortcut(event, tool.command)}
                  onBlur={() => {
                    if (!recording) return;
                    setRecordingCommand("");
                    setShortcutFeedback(null);
                  }}
                >
                  <Keyboard size={13} aria-hidden="true" />
                  <kbd>{recording ? "请按组合键" : canvasToolShortcutLabel(tool.shortcut) || "未设置"}</kbd>
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="settings-canvas-tool-shortcut-reset"
                  disabled={!tool.available || !tool.customized}
                  aria-label={`恢复${tool.label}的默认快捷键`}
                  title="恢复默认快捷键"
                  onClick={() => resetShortcut(tool.command)}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                </ButtonBase>
              </span>
              {feedback ? (
                <small className="settings-canvas-tool-feedback" data-tone={feedback.tone} role="status">
                  {feedback.text}
                </small>
              ) : null}
            </div>
          );
        })}
        </div>
      </section>
    </div>
  );
}
