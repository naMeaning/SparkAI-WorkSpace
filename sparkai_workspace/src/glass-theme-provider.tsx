import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ReactNode
} from "react";
import {
  applyGlassAppearanceToRoot,
  normalizeGlassThemeSettings,
  type GlassThemeSettings
} from "./glass-theme";
import {
  applyGlassBackgroundToRoot,
  type GlassBackgroundSettings,
} from "./glass-background";
import { writeGlassThemeBootstrapSnapshot } from "./settings-persistence";

const defaultAppearance = normalizeGlassThemeSettings();
const GlassThemeContext = createContext<GlassThemeSettings>(defaultAppearance);

type GlassAppearanceTraceEntry = {
  source: "bootstrap" | "react-layout";
  glassTheme: string;
  mode: string;
  glassMaterial: string;
  accent: string;
  opacity: number;
  blur: number;
  saturation: number;
  highlight: number;
  shadow: number;
  radius: number;
  noise: boolean;
  reduceMotion: boolean;
};

type GlassBootState = {
  appearanceTrace?: GlassAppearanceTraceEntry[];
};

function appendReactAppearanceTrace(appearance: GlassThemeSettings, target: HTMLElement) {
  if (typeof window === "undefined" || target !== document.documentElement) return;
  const bootWindow = window as typeof window & { __naimageGlassBootState?: GlassBootState };
  const bootState = bootWindow.__naimageGlassBootState;
  if (!bootState) return;
  try {
    const parameters = appearance.glassParameters;
    const nextTrace = [
      ...(Array.isArray(bootState.appearanceTrace) ? bootState.appearanceTrace : []),
      {
        source: "react-layout" as const,
        glassTheme: appearance.glassTheme,
        mode: target.dataset.glassMode || "",
        glassMaterial: appearance.glassMaterial,
        accent: parameters.accent,
        opacity: parameters.opacity,
        blur: parameters.blur,
        saturation: parameters.saturation,
        highlight: parameters.highlight,
        shadow: parameters.shadow,
        radius: parameters.radius,
        noise: parameters.noise,
        reduceMotion: parameters.reduceMotion
      }
    ];
    bootState.appearanceTrace = nextTrace.length <= 8
      ? nextTrace
      : [nextTrace[0], ...nextTrace.slice(-7)];
  } catch {
    // Diagnostics must not be able to block the live appearance projection.
  }
}

export type GlassThemeProviderProps = {
  settings: GlassThemeSettings & Partial<GlassBackgroundSettings>;
  children: ReactNode;
  /** Useful for isolated previews and tests; the application uses documentElement. */
  root?: HTMLElement | null;
  /** Disable only for transient previews that must not survive a restart. */
  persistBootstrap?: boolean;
};

/**
 * A state-preserving appearance boundary. It renders no wrapper element and
 * projects only root datasets, classes and CSS custom properties.
 */
export function GlassThemeProvider({
  settings,
  children,
  root,
  persistBootstrap = true
}: GlassThemeProviderProps) {
  const appearance = useMemo(() => normalizeGlassThemeSettings(settings), [
    settings.glassTheme,
    settings.glassMaterial,
    settings.glassParameters.opacity,
    settings.glassParameters.blur,
    settings.glassParameters.saturation,
    settings.glassParameters.highlight,
    settings.glassParameters.shadow,
    settings.glassParameters.radius,
    settings.glassParameters.accent,
    settings.glassParameters.noise,
    settings.glassParameters.reduceMotion
  ]);

  useLayoutEffect(() => {
    const target = root === undefined
      ? typeof document === "undefined" ? null : document.documentElement
      : root;
    if (!target) return;
    applyGlassAppearanceToRoot(appearance, target);
    if (persistBootstrap) {
      appendReactAppearanceTrace(appearance, target);
      writeGlassThemeBootstrapSnapshot(appearance);
    }
  }, [appearance, persistBootstrap, root]);

  useEffect(() => {
    const target = root === undefined
      ? typeof document === "undefined" ? null : document.documentElement
      : root;
    if (!target) return;
    void applyGlassBackgroundToRoot(settings, target);
  }, [
    root,
    settings.glassTheme,
    settings.glassMaterial,
    settings.glassParameters.opacity,
    settings.glassBackgroundEnabled,
    settings.glassBackgroundAssetId,
    settings.glassBackgroundAssetName,
    settings.glassBackgroundOverlay,
    settings.glassBackgroundBlur,
  ]);

  return <GlassThemeContext.Provider value={appearance}>{children}</GlassThemeContext.Provider>;
}

export function useGlassTheme() {
  return useContext(GlassThemeContext);
}

export default GlassThemeProvider;
