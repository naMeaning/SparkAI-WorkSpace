import registryJson from "../runtime/glass-theme-presets.json" with { type: "json" };

export const GLASS_THEME_IDS = [
  "dark-rose",
  "dark-ember",
  "dark-emerald",
  "light-lemon",
  "light-sky",
  "light-blush"
] as const;

export const GLASS_MATERIAL_PRESET_IDS = ["clear", "frosted", "dense"] as const;
export const GLASS_MATERIAL_IDS = [...GLASS_MATERIAL_PRESET_IDS, "custom"] as const;
export const GLASS_ACCENT_IDS = ["theme", "rose", "mint", "coral", "amber", "ice"] as const;
export const GLASS_NUMERIC_PARAMETER_KEYS = ["opacity", "blur", "saturation", "highlight", "shadow", "radius"] as const;

export type GlassThemeId = (typeof GLASS_THEME_IDS)[number];
export type GlassThemeMode = "dark" | "light";
export type GlassMaterialPresetId = (typeof GLASS_MATERIAL_PRESET_IDS)[number];
export type GlassMaterialId = (typeof GLASS_MATERIAL_IDS)[number];
export type GlassAccentId = (typeof GLASS_ACCENT_IDS)[number];
export type GlassNumericParameterKey = (typeof GLASS_NUMERIC_PARAMETER_KEYS)[number];

export type GlassNumericParameters = {
  /** Percentage points, not a 0..1 alpha. */
  opacity: number;
  /** CSS pixels. */
  blur: number;
  /** Percentage points, where 100 is unchanged. */
  saturation: number;
  /** Percentage points, not a 0..1 alpha. */
  highlight: number;
  /** Percentage points, not a 0..1 alpha. */
  shadow: number;
  /** CSS pixels. */
  radius: number;
};

export type GlassParameters = GlassNumericParameters & {
  accent: GlassAccentId;
  noise: boolean;
  reduceMotion: boolean;
};

export type GlassThemeSettings = {
  glassTheme: GlassThemeId;
  glassMaterial: GlassMaterialId;
  glassParameters: GlassParameters;
};

type GlassAccentToken = {
  name: string;
  color: string;
  rgb: string;
  ink: string;
};

type GlassThemeTokens = {
  glassRgb: string;
  accent: string;
  accentRgb: string;
  accentInk: string;
  secondary: string;
  secondaryRgb: string;
  canvas: string;
  canvasTint: string;
  surfaceSolid: string;
  surfaceRaised: string;
  nodeBg: string;
  ink: string;
  inkSoft: string;
  muted: string;
};

type GlassModeTokens = {
  line: string;
  lineStrong: string;
  solidControl: string;
  solidControlHover: string;
  success: string;
  danger: string;
};

export type GlassThemeRegistry = {
  schemaVersion: 1;
  type: "naimage-glass-theme-registry";
  defaults: {
    theme: GlassThemeId;
    material: GlassMaterialPresetId;
    accent: GlassAccentId;
    noise: boolean;
    reduceMotion: boolean;
  };
  themeOrder: GlassThemeId[];
  materialOrder: GlassMaterialPresetId[];
  accentOrder: GlassAccentId[];
  ranges: Record<GlassNumericParameterKey, { min: number; max: number; step: number; unit: "%" | "px" }>;
  accents: Record<Exclude<GlassAccentId, "theme">, GlassAccentToken>;
  modeTokens: Record<GlassThemeMode, GlassModeTokens>;
  materialPresets: Record<GlassThemeMode, Record<GlassMaterialPresetId, GlassNumericParameters>>;
  themes: Record<GlassThemeId, {
    name: string;
    mode: GlassThemeMode;
    accent: Exclude<GlassAccentId, "theme">;
    tokens: GlassThemeTokens;
  }>;
};

/**
 * The JSON registry is the single authored source for themes, material values,
 * accents and control ranges. The tuple constants above intentionally provide
 * narrow TypeScript unions; the focused registry self-test keeps both in lockstep.
 */
export const glassThemeRegistry = registryJson as GlassThemeRegistry;

export const DEFAULT_GLASS_THEME = glassThemeRegistry.defaults.theme;
export const DEFAULT_GLASS_MATERIAL = glassThemeRegistry.defaults.material;

const themeIds = new Set<string>(GLASS_THEME_IDS);
const materialIds = new Set<string>(GLASS_MATERIAL_IDS);
const accentIds = new Set<string>(GLASS_ACCENT_IDS);
const numericParameterKeys = new Set<string>(GLASS_NUMERIC_PARAMETER_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedTheme(value: unknown): GlassThemeId {
  const candidate = String(value || "");
  return themeIds.has(candidate) ? candidate as GlassThemeId : DEFAULT_GLASS_THEME;
}

function normalizedMaterial(value: unknown): GlassMaterialId {
  const candidate = String(value || "");
  return materialIds.has(candidate) ? candidate as GlassMaterialId : DEFAULT_GLASS_MATERIAL;
}

function normalizedAccent(value: unknown): GlassAccentId {
  const candidate = String(value || "");
  return accentIds.has(candidate) ? candidate as GlassAccentId : glassThemeRegistry.defaults.accent;
}

function normalizedRangeValue(key: GlassNumericParameterKey, value: unknown, fallback: number) {
  const numeric = Number(value);
  const range = glassThemeRegistry.ranges[key];
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(range.min, Math.min(range.max, Math.round(numeric)));
}

function behaviorFrom(value: unknown): Pick<GlassParameters, "accent" | "noise" | "reduceMotion"> {
  const source = isRecord(value) ? value : {};
  return {
    accent: normalizedAccent(source.accent),
    noise: typeof source.noise === "boolean" ? source.noise : glassThemeRegistry.defaults.noise,
    reduceMotion: typeof source.reduceMotion === "boolean" ? source.reduceMotion : glassThemeRegistry.defaults.reduceMotion
  };
}

export function glassThemeMode(theme: GlassThemeId): GlassThemeMode {
  return glassThemeRegistry.themes[normalizedTheme(theme)].mode;
}

export function glassMaterialParameters(
  theme: GlassThemeId,
  material: GlassMaterialPresetId,
  behavior: Partial<Pick<GlassParameters, "accent" | "noise" | "reduceMotion">> = {}
): GlassParameters {
  const resolvedTheme = normalizedTheme(theme);
  const resolvedMaterial = GLASS_MATERIAL_PRESET_IDS.includes(material) ? material : DEFAULT_GLASS_MATERIAL;
  const numeric = glassThemeRegistry.materialPresets[glassThemeMode(resolvedTheme)][resolvedMaterial];
  const resolvedBehavior = behaviorFrom(behavior);
  return { ...numeric, ...resolvedBehavior };
}

export function normalizeGlassThemeSettings(value?: unknown): GlassThemeSettings {
  const source = isRecord(value) ? value : {};
  const glassTheme = normalizedTheme(source.glassTheme);
  const glassMaterial = normalizedMaterial(source.glassMaterial);
  const parameters = isRecord(source.glassParameters) ? source.glassParameters : {};
  const behavior = behaviorFrom(parameters);

  if (glassMaterial !== "custom") {
    return {
      glassTheme,
      glassMaterial,
      glassParameters: glassMaterialParameters(glassTheme, glassMaterial, behavior)
    };
  }

  const fallback = glassMaterialParameters(glassTheme, DEFAULT_GLASS_MATERIAL, behavior);
  return {
    glassTheme,
    glassMaterial,
    glassParameters: {
      opacity: normalizedRangeValue("opacity", parameters.opacity, fallback.opacity),
      blur: normalizedRangeValue("blur", parameters.blur, fallback.blur),
      saturation: normalizedRangeValue("saturation", parameters.saturation, fallback.saturation),
      highlight: normalizedRangeValue("highlight", parameters.highlight, fallback.highlight),
      shadow: normalizedRangeValue("shadow", parameters.shadow, fallback.shadow),
      radius: normalizedRangeValue("radius", parameters.radius, fallback.radius),
      ...behavior
    }
  };
}

function mergeGlassSettings<T extends GlassThemeSettings>(settings: T, patch: Partial<GlassThemeSettings>): T {
  const normalized = normalizeGlassThemeSettings({ ...settings, ...patch });
  return { ...settings, ...normalized };
}

export function withGlassTheme<T extends GlassThemeSettings>(settings: T, theme: GlassThemeId): T {
  return mergeGlassSettings(settings, { glassTheme: theme });
}

export function withGlassMaterial<T extends GlassThemeSettings>(settings: T, material: GlassMaterialId): T {
  return mergeGlassSettings(settings, { glassMaterial: material });
}

export function withGlassParameters<T extends GlassThemeSettings>(settings: T, patch: Partial<GlassParameters>): T {
  const touchesMaterial = Object.keys(patch).some((key) => numericParameterKeys.has(key));
  return mergeGlassSettings(settings, {
    glassMaterial: touchesMaterial ? "custom" : settings.glassMaterial,
    glassParameters: { ...settings.glassParameters, ...patch }
  });
}

type GlassRootElement = Pick<HTMLElement, "dataset" | "classList" | "style">;

export type GlassAppearanceProjection = {
  settings: GlassThemeSettings;
  mode: GlassThemeMode;
  resolvedAccent: Exclude<GlassAccentId, "theme">;
  variables: Record<string, string>;
};

function alpha(percentage: number) {
  return String(percentage / 100);
}

function mixHexColors(left: string, leftWeight: number, right: string) {
  const parse = (value: string) => /^#[0-9a-f]{6}$/i.test(value)
    ? [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
    : null;
  const leftRgb = parse(left);
  const rightRgb = parse(right);
  if (!leftRgb || !rightRgb) return left;
  const weight = Math.max(0, Math.min(1, leftWeight));
  return `#${leftRgb.map((channel, index) => Math.round(channel * weight + rightRgb[index] * (1 - weight))
    .toString(16)
    .padStart(2, "0")).join("")}`;
}

function resolvedAccentTokens(settings: GlassThemeSettings) {
  const theme = glassThemeRegistry.themes[settings.glassTheme];
  if (settings.glassParameters.accent === "theme") {
    return {
      id: theme.accent,
      color: theme.tokens.accent,
      rgb: theme.tokens.accentRgb,
      ink: theme.tokens.accentInk
    };
  }
  const accent = glassThemeRegistry.accents[settings.glassParameters.accent];
  return { id: settings.glassParameters.accent, ...accent };
}

/** One projection powers both live root application and the no-flash bootstrap snapshot. */
export function glassAppearanceProjection(value: GlassThemeSettings | unknown): GlassAppearanceProjection {
  const settings = normalizeGlassThemeSettings(value);
  const theme = glassThemeRegistry.themes[settings.glassTheme];
  const mode = glassThemeRegistry.modeTokens[theme.mode];
  const parameters = settings.glassParameters;
  const accent = resolvedAccentTokens(settings);
  const variables: Record<string, string> = {
    "--glass-rgb": theme.tokens.glassRgb,
    "--glass-opacity": alpha(parameters.opacity),
    "--glass-alpha": alpha(parameters.opacity),
    "--glass-blur": `${parameters.blur}px`,
    "--glass-saturation": `${parameters.saturation}%`,
    "--glass-highlight": alpha(parameters.highlight),
    "--glass-shadow": alpha(parameters.shadow),
    "--glass-radius": `${parameters.radius}px`,
    "--glass-noise-opacity": parameters.noise ? "0.025" : "0",
    "--noise-opacity": parameters.noise ? "0.025" : "0",
    "--glass-motion-duration": parameters.reduceMotion ? "0ms" : "180ms",
    "--accent": accent.color,
    "--accent-rgb": accent.rgb,
    "--accent-ink": accent.ink,
    "--secondary": theme.tokens.secondary,
    "--secondary-rgb": theme.tokens.secondaryRgb,
    "--canvas-tint": theme.tokens.canvasTint,
    "--node-bg": theme.tokens.nodeBg,
    "--solid-control": mode.solidControl,
    "--solid-control-hover": mode.solidControlHover,
    "--success": mode.success,
    "--danger": mode.danger,
    "--theme-bg": theme.tokens.surfaceSolid,
    "--theme-canvas": theme.tokens.canvas,
    "--theme-surface": theme.tokens.surfaceSolid,
    "--theme-surface-solid": theme.tokens.surfaceSolid,
    "--theme-surface-raised": theme.tokens.surfaceRaised,
    "--theme-ink": theme.tokens.ink,
    "--theme-ink-soft": theme.tokens.inkSoft,
    "--theme-muted": theme.tokens.muted,
    "--theme-line": mode.line,
    "--theme-line-strong": mode.lineStrong,
    "--theme-accent": accent.color,
    "--theme-accent-strong": mixHexColors(accent.color, 0.72, theme.tokens.ink),
    "--theme-blue": theme.tokens.secondary,
    "--theme-rose": mode.danger,
    "--theme-amber": glassThemeRegistry.accents.amber.color,
    "--theme-green": mode.success,
    "--theme-control-bg": mode.solidControl,
    "--theme-hover-bg": mode.solidControlHover,
    "--theme-active-bg": `rgba(${accent.rgb}, 0.16)`
  };
  for (const accentId of GLASS_ACCENT_IDS) {
    if (accentId === "theme") continue;
    variables[`--glass-accent-${accentId}`] = glassThemeRegistry.accents[accentId].color;
  }
  for (const themeId of GLASS_THEME_IDS) {
    const swatch = glassThemeRegistry.themes[themeId].tokens;
    variables[`--glass-swatch-${themeId}-canvas`] = swatch.canvas;
    variables[`--glass-swatch-${themeId}-accent`] = swatch.accent;
    variables[`--glass-swatch-${themeId}-surface`] = swatch.surfaceSolid;
  }
  return {
    settings,
    mode: theme.mode,
    resolvedAccent: accent.id,
    variables
  };
}

/**
 * Projects appearance onto the root element only. It deliberately has no React,
 * canvas, project-session or component-state side effects, so switching a theme
 * cannot remount or reinitialize the canvas.
 */
export function applyGlassAppearanceToRoot(
  value: GlassThemeSettings | unknown,
  root: GlassRootElement = document.documentElement
): GlassThemeSettings {
  const projection = glassAppearanceProjection(value);
  const { settings } = projection;
  const theme = glassThemeRegistry.themes[settings.glassTheme];
  const parameters = settings.glassParameters;

  root.dataset.glassTheme = settings.glassTheme;
  root.dataset.glassMode = theme.mode;
  root.dataset.glassMaterial = settings.glassMaterial;
  root.dataset.glassAccent = parameters.accent;
  root.dataset.glassAccentResolved = projection.resolvedAccent;
  root.dataset.glassNoise = parameters.noise ? "on" : "off";
  root.dataset.glassReduceMotion = parameters.reduceMotion ? "true" : "false";
  root.dataset.theme = theme.mode;
  root.dataset.uiTheme = settings.glassTheme;

  root.classList.toggle("glass-theme-active", true);
  root.classList.toggle("theme-dark", theme.mode === "dark");
  root.classList.toggle("theme-light", theme.mode === "light");
  root.classList.toggle("glass-no-noise", !parameters.noise);
  root.classList.toggle("glass-reduce-motion", parameters.reduceMotion);

  for (const [name, cssValue] of Object.entries(projection.variables)) {
    root.style.setProperty(name, cssValue);
  }
  root.style.colorScheme = theme.mode;
  return settings;
}
