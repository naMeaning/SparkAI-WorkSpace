import { builtinPluginManifests, normalizePluginStates } from "./plugin-system";
import { ButtonBase } from "./ui";

type CanvasToolDockMode = "expanded" | "hover";

function shortcutLabel(shortcut?: string) {
  return shortcut ? shortcut.replace("Mod", "Ctrl/⌘").replace(/\+/g, " ") : "";
}

export default function CanvasToolsSettingsPanel({
  states,
  mode,
  disabledCommands,
  onModeChange,
  onDisabledCommandsChange
}: {
  states: Parameters<typeof normalizePluginStates>[0];
  mode: CanvasToolDockMode;
  disabledCommands: string[];
  onModeChange: (mode: CanvasToolDockMode) => void;
  onDisabledCommandsChange: (commands: string[]) => void;
}) {
  const normalizedStates = normalizePluginStates(states);
  const disabled = new Set(disabledCommands);

  function setCommandEnabled(command: string, enabled: boolean) {
    const next = enabled
      ? disabledCommands.filter((item) => item !== command)
      : [...disabledCommands.filter((item) => item !== command), command];
    onDisabledCommandsChange(next);
  }

  return (
    <div className="settings-canvas-tools">
      <div className="settings-canvas-tool-mode" aria-labelledby="settings-canvas-tool-mode-label">
        <strong id="settings-canvas-tool-mode-label">工具栏展开方式</strong>
        <div className="ui-segment-control" role="group" aria-label="工具栏展开方式">
          <ButtonBase
            type="button"
            className="ui-segment-action"
            aria-pressed={mode === "expanded"}
            onClick={() => onModeChange("expanded")}
          >
            一直展开
          </ButtonBase>
          <ButtonBase
            type="button"
            className="ui-segment-action"
            aria-pressed={mode === "hover"}
            onClick={() => onModeChange("hover")}
          >
            悬停展开
          </ButtonBase>
        </div>
      </div>

      <div className="settings-canvas-tool-list" aria-label="画布工具">
        {builtinPluginManifests.flatMap((manifest) => {
          const state = normalizedStates.find((item) => item.id === manifest.id);
          const available = Boolean(state?.enabled);
          return manifest.contributes.toolbar.map((tool) => {
            const enabled = !disabled.has(tool.command);
            return (
              <label
                key={tool.command}
                className={`settings-canvas-tool-row${available ? "" : " is-unavailable"}`}
                data-canvas-tool-command={tool.command}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!available}
                  onChange={(event) => setCommandEnabled(tool.command, event.currentTarget.checked)}
                />
                <span className="settings-canvas-tool-copy">
                  <strong>{tool.label}</strong>
                  <small>{manifest.name} · {available ? "已加入画布工具栏" : state ? "插件已停用" : "插件未安装"}</small>
                  <span>{tool.description}</span>
                </span>
                {tool.shortcut ? <kbd>{shortcutLabel(tool.shortcut)}</kbd> : null}
              </label>
            );
          });
        })}
      </div>
    </div>
  );
}
