/*
Theme Palette Picker

Owns the settings surface for light/dark mode and named color palettes. Palette
names follow the New API theme taxonomy, while naimage keeps its own semantic
tokens and independently authored colors in styles/01-theme-palettes.css.
*/

import type { ThemeChoice, ThemePaletteChoice } from "./core";
import { THEME_PALETTE_VALUES } from "./settings-persistence";
import { ButtonBase, SegmentButton, SegmentedControl } from "./ui";

const themeModes: [ThemeChoice, string][] = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"]
];

export default function ThemePalettePicker({
  theme,
  palette,
  onThemeChange,
  onPaletteChange
}: {
  theme: ThemeChoice;
  palette: ThemePaletteChoice;
  onThemeChange: (choice: ThemeChoice) => void;
  onPaletteChange: (choice: ThemePaletteChoice) => void;
}) {
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
                onClick={() => onPaletteChange(value)}
              >
                <span className="theme-palette-swatch" data-palette={value} aria-hidden="true" />
              </ButtonBase>
            );
          })}
      </div>
    </div>
  );
}
