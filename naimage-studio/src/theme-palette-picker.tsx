/*
Theme Palette Picker

Owns the settings surface for light/dark mode and named color palettes. Palette
names follow the New API theme taxonomy, while naimage keeps its own semantic
tokens and independently authored colors in styles/01-theme-palettes.css.
*/

import { useState } from "react";
import type { CustomThemeColorKey, CustomThemePreset, ThemeChoice, ThemePaletteChoice } from "./core";
import { THEME_PALETTE_VALUES } from "./settings-persistence";
import { ActionButton, ButtonBase, Field, InlineNotice, SegmentButton, SegmentedControl } from "./ui";

const themeModes: [ThemeChoice, string][] = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"]
];

const customColorLabels = "应用背景|画布背景|普通表面|浮层表面|主要文字|弱化文字|边框|主色|危险色|成功色".split("|");
const customThemeColorKeys: CustomThemeColorKey[] = [
  "--theme-bg", "--theme-canvas", "--theme-surface", "--theme-surface-raised", "--theme-ink",
  "--theme-muted", "--theme-line", "--theme-accent", "--theme-rose", "--theme-green"
];
function customThemeMode(colors: string[]) {
  return Object.fromEntries(customThemeColorKeys.map((key, index) => [key, colors[index]])) as CustomThemePreset["light"];
}

const defaultCustomTheme: CustomThemePreset = {
  schemaVersion: 1,
  type: "naimage-theme",
  name: "陶土自定义",
  light: customThemeMode("#f4eee5 #faf6ef #f1e8dc #fffdf8 #332a25 #88766a #ded0c2 #cd674a #b84d52 #667d54".split(" ")),
  dark: customThemeMode("#201b18 #241f1b #2a231f #352c26 #eadfd5 #9f8c7e #493b33 #e07b5d #ef7880 #9cb785".split(" "))
};

export default function ThemePalettePicker({
  theme,
  palette,
  customTheme,
  onThemeChange,
  onPaletteChange,
  onCustomThemeChange
}: {
  theme: ThemeChoice;
  palette: ThemePaletteChoice;
  customTheme: CustomThemePreset | null;
  onThemeChange: (choice: ThemeChoice) => void;
  onPaletteChange: (choice: ThemePaletteChoice) => void;
  onCustomThemeChange: (preset: CustomThemePreset) => void;
}) {
  const [customMode, setCustomMode] = useState<"light" | "dark">("light");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const editableTheme = customTheme ?? defaultCustomTheme;

  function selectPalette(value: ThemePaletteChoice) {
    if (value === "custom" && !customTheme) onCustomThemeChange(defaultCustomTheme);
    onPaletteChange(value);
    setMessage(null);
  }

  function updateCustomTheme(next: CustomThemePreset) {
    onCustomThemeChange(next);
    onPaletteChange("custom");
    setMessage(null);
  }

  async function transferTheme(action: "import" | "export") {
    setBusy(true);
    setMessage(null);
    try {
      const result = action === "import"
        ? await window.naimageConfig?.importThemePreset?.()
        : await window.naimageConfig?.exportThemePreset?.(editableTheme);
      if (!result || result.canceled) return;
      if (!result.ok) throw new Error(result.error || `主题${action === "import" ? "导入" : "导出"}失败。`);
      if (action === "import") {
        if (!("theme" in result) || !result.theme) throw new Error("主题导入结果无效。");
        updateCustomTheme(result.theme);
        setMessage({ error: false, text: `已导入 ${result.sourceName || result.theme.name}` });
      } else {
        setMessage({ error: false, text: `已导出 ${"fileName" in result ? result.fileName || editableTheme.name : editableTheme.name}` });
      }
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="theme-palette-picker">
      <SegmentedControl className="theme-mode-options" aria-label="明暗模式">
        {themeModes.map(([value, label]) => (
          <SegmentButton
            key={value}
            className="theme-mode-option"
            active={theme === value}
            onClick={() => onThemeChange(value)}
          >
            {label}
          </SegmentButton>
        ))}
      </SegmentedControl>

      <div className="theme-palette-grid" role="group" aria-label="主题配色">
          {THEME_PALETTE_VALUES.map((value) => {
            const active = palette === value;
            return (
              <ButtonBase
                key={value}
                className="ui-choice-row theme-palette-option"
                data-palette={value}
                aria-pressed={active}
                aria-label={value}
                onClick={() => selectPalette(value)}
              >
                <span
                  className="theme-palette-swatch"
                  data-palette={value}
                  style={value === "custom" ? { background: `linear-gradient(135deg, ${editableTheme.light["--theme-canvas"]} 0 46%, ${editableTheme.light["--theme-accent"]} 46% 74%, ${editableTheme.dark["--theme-bg"]} 74%)` } : undefined}
                  aria-hidden="true"
                />
              </ButtonBase>
            );
          })}
      </div>

      {palette === "custom" ? (
        <section className="theme-custom-editor" aria-label="自定义主题编辑器">
          <Field label="主题名称">
            <input
              value={editableTheme.name}
              maxLength={48}
              onChange={(event) => updateCustomTheme({ ...editableTheme, name: event.target.value })}
            />
          </Field>
          <SegmentedControl className="theme-custom-mode" aria-label="编辑明暗配色">
            <SegmentButton active={customMode === "light"} onClick={() => setCustomMode("light")}>浅色配色</SegmentButton>
            <SegmentButton active={customMode === "dark"} onClick={() => setCustomMode("dark")}>深色配色</SegmentButton>
          </SegmentedControl>
          <div className="theme-custom-color-grid">
            {customThemeColorKeys.map((key, index) => (
              <Field key={key} label={customColorLabels[index]}>
                <span className="theme-custom-color-control">
                  <input
                    type="color"
                    value={editableTheme[customMode][key]}
                    aria-label={`${customColorLabels[index]}颜色`}
                    onChange={(event) => updateCustomTheme({
                      ...editableTheme,
                      [customMode]: { ...editableTheme[customMode], [key]: event.target.value }
                    })}
                  />
                  <code>{editableTheme[customMode][key]}</code>
                </span>
              </Field>
            ))}
          </div>
          <div className="theme-custom-actions">
            <ActionButton variant="secondary" onClick={() => void transferTheme("import")} busy={busy}>导入 JSON</ActionButton>
            <ActionButton variant="secondary" onClick={() => void transferTheme("export")} disabled={busy}>导出 JSON</ActionButton>
            <ActionButton variant="secondary" onClick={() => updateCustomTheme(defaultCustomTheme)} disabled={busy}>恢复陶土模板</ActionButton>
          </div>
          {message ? <InlineNotice tone={message.error ? "danger" : "info"}>{message.text}</InlineNotice> : null}
        </section>
      ) : null}
    </div>
  );
}
