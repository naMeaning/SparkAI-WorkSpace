import {
  glassThemeMode,
  glassThemeRegistry,
  normalizeGlassThemeSettings,
  type GlassThemeSettings,
} from "./glass-theme.ts";
import type { GlassBackgroundAsset, GlassBackgroundAssetMetadata } from "./core.ts";

export const GLASS_BACKGROUND_OVERLAY_MIN = 0;
export const GLASS_BACKGROUND_OVERLAY_MAX = 80;
export const GLASS_BACKGROUND_BLUR_MIN = 0;
export const GLASS_BACKGROUND_BLUR_MAX = 40;
export const DEFAULT_GLASS_BACKGROUND_OVERLAY = 38;
export const DEFAULT_GLASS_BACKGROUND_BLUR = 6;

const GLASS_BACKGROUND_ASSET_ID_PATTERN = /^glass-bg-[a-f0-9]{64}$/;
const MAX_BACKGROUND_NAME_LENGTH = 180;
const MAX_BACKGROUND_EDGE = 3_840;
const MAX_BACKGROUND_BYTES = 24 * 1024 * 1024;

export type GlassBackgroundSettings = {
  glassBackgroundEnabled: boolean;
  glassBackgroundAssetId: string;
  glassBackgroundAssetName: string;
  glassBackgroundAssetMetadata: GlassBackgroundAssetMetadata | null;
  glassBackgroundOverlay: number;
  glassBackgroundBlur: number;
};

export type { GlassBackgroundAsset };

export const defaultGlassBackgroundSettings: GlassBackgroundSettings = {
  glassBackgroundEnabled: false,
  glassBackgroundAssetId: "",
  glassBackgroundAssetName: "",
  glassBackgroundAssetMetadata: null,
  glassBackgroundOverlay: DEFAULT_GLASS_BACKGROUND_OVERLAY,
  glassBackgroundBlur: DEFAULT_GLASS_BACKGROUND_BLUR,
};

function clampedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizedAssetId(value: unknown) {
  const assetId = String(value || "").trim().toLowerCase();
  return GLASS_BACKGROUND_ASSET_ID_PATTERN.test(assetId) ? assetId : "";
}

function normalizedAssetName(value: unknown) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BACKGROUND_NAME_LENGTH);
}

export function normalizeGlassBackgroundSettings(value?: unknown): GlassBackgroundSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const glassBackgroundAssetId = normalizedAssetId(source.glassBackgroundAssetId);
  const metadataSource = source.glassBackgroundAssetMetadata;
  const metadataRecord = metadataSource && typeof metadataSource === "object" && !Array.isArray(metadataSource)
    ? metadataSource as Record<string, unknown>
    : null;
  const width = clampedInteger(metadataRecord?.width, 0, 0, MAX_BACKGROUND_EDGE);
  const height = clampedInteger(metadataRecord?.height, 0, 0, MAX_BACKGROUND_EDGE);
  const bytes = clampedInteger(metadataRecord?.bytes, 0, 0, MAX_BACKGROUND_BYTES);
  const glassBackgroundAssetMetadata = glassBackgroundAssetId
    && metadataRecord?.mimeType === "image/webp"
    && width > 0
    && height > 0
    && bytes > 0
    ? { mimeType: "image/webp" as const, width, height, bytes }
    : null;
  return {
    glassBackgroundEnabled: Boolean(source.glassBackgroundEnabled && glassBackgroundAssetId),
    glassBackgroundAssetId,
    glassBackgroundAssetName: glassBackgroundAssetId ? normalizedAssetName(source.glassBackgroundAssetName) : "",
    glassBackgroundAssetMetadata,
    glassBackgroundOverlay: clampedInteger(
      source.glassBackgroundOverlay,
      DEFAULT_GLASS_BACKGROUND_OVERLAY,
      GLASS_BACKGROUND_OVERLAY_MIN,
      GLASS_BACKGROUND_OVERLAY_MAX,
    ),
    glassBackgroundBlur: clampedInteger(
      source.glassBackgroundBlur,
      DEFAULT_GLASS_BACKGROUND_BLUR,
      GLASS_BACKGROUND_BLUR_MIN,
      GLASS_BACKGROUND_BLUR_MAX,
    ),
  };
}

export function withGlassBackground<T extends GlassBackgroundSettings>(
  settings: T,
  patch: Partial<GlassBackgroundSettings>,
): T {
  return {
    ...settings,
    ...normalizeGlassBackgroundSettings({ ...settings, ...patch }),
  };
}

type BackgroundRoot = Pick<HTMLElement, "dataset" | "style">;
type BackgroundAppearance = GlassThemeSettings & Partial<GlassBackgroundSettings>;

const dataUrlCache = new Map<string, string>();
const loadRequests = new Map<string, Promise<string>>();
const rootRequestIds = new WeakMap<object, number>();

function rememberDataUrl(assetId: string, dataUrl: string) {
  dataUrlCache.delete(assetId);
  dataUrlCache.set(assetId, dataUrl);
  while (dataUrlCache.size > 2) {
    const oldest = dataUrlCache.keys().next().value;
    if (!oldest) break;
    dataUrlCache.delete(oldest);
  }
}

async function loadBackgroundDataUrl(assetId: string, name: string) {
  const cached = dataUrlCache.get(assetId);
  if (cached) return cached;
  const active = loadRequests.get(assetId);
  if (active) return active;
  const request = (async () => {
    const bridge = typeof window === "undefined" ? undefined : window.naimageConfig;
    if (!bridge?.loadGlassBackground) throw new Error("当前运行环境不支持自定义工作区背景。");
    const result = await bridge.loadGlassBackground({ assetId, name });
    const dataUrl = String(result?.dataUrl || "");
    if (!result?.ok || !/^data:image\/webp;base64,[a-z0-9+/=]+$/i.test(dataUrl)) {
      throw new Error(result?.error || "工作区背景已丢失或无法读取。");
    }
    rememberDataUrl(assetId, dataUrl);
    return dataUrl;
  })().finally(() => {
    loadRequests.delete(assetId);
  });
  loadRequests.set(assetId, request);
  return request;
}

function applyReadableBackgroundTokens(
  value: BackgroundAppearance,
  background: GlassBackgroundSettings,
  root: BackgroundRoot,
) {
  const appearance = normalizeGlassThemeSettings(value);
  const mode = glassThemeMode(appearance.glassTheme);
  const theme = glassThemeRegistry.themes[appearance.glassTheme];
  const requestedSurfaceAlpha = appearance.glassParameters.opacity / 100;
  const readableSurfaceAlpha = Math.max(requestedSurfaceAlpha, mode === "dark" ? 0.46 : 0.5);
  const readableStrongAlpha = Math.min(0.86, readableSurfaceAlpha + 0.1);
  const maskAlpha = background.glassBackgroundOverlay / 100;

  root.style.setProperty("--glass-background-mask", mode === "dark"
    ? `rgba(3, 7, 9, ${maskAlpha})`
    : `rgba(250, 252, 255, ${maskAlpha})`);
  root.style.setProperty("--glass-background-blur", `${background.glassBackgroundBlur}px`);
  root.style.setProperty("--glass-readable-surface-fill", `rgba(${theme.tokens.glassRgb}, ${readableSurfaceAlpha})`);
  root.style.setProperty("--glass-readable-surface-fill-strong", `rgba(${theme.tokens.glassRgb}, ${readableStrongAlpha})`);
}

/**
 * Loads only the managed WebP referenced by settings, then projects it as a
 * root CSS variable. Request sequencing prevents a slow old draft from
 * replacing a newer background or a user-requested disable.
 */
export async function applyGlassBackgroundToRoot(
  value: BackgroundAppearance,
  root: BackgroundRoot = document.documentElement,
) {
  const background = normalizeGlassBackgroundSettings(value);
  const requestId = (rootRequestIds.get(root) || 0) + 1;
  rootRequestIds.set(root, requestId);
  applyReadableBackgroundTokens(value, background, root);

  if (!background.glassBackgroundEnabled || !background.glassBackgroundAssetId) {
    root.dataset.glassBackground = "off";
    root.style.setProperty("--glass-workspace-background-image", "none");
    return { ...background, status: "off" as const };
  }

  root.dataset.glassBackground = "loading";
  try {
    const dataUrl = await loadBackgroundDataUrl(
      background.glassBackgroundAssetId,
      background.glassBackgroundAssetName,
    );
    if (rootRequestIds.get(root) !== requestId) return { ...background, status: "stale" as const };
    root.style.setProperty("--glass-workspace-background-image", `url(${JSON.stringify(dataUrl)})`);
    root.dataset.glassBackground = "ready";
    return { ...background, status: "ready" as const };
  } catch (error) {
    if (rootRequestIds.get(root) !== requestId) return { ...background, status: "stale" as const };
    root.style.setProperty("--glass-workspace-background-image", "none");
    root.dataset.glassBackground = "error";
    return {
      ...background,
      status: "error" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function primeGlassBackgroundDataUrl(assetId: string, dataUrl: string) {
  const normalized = normalizedAssetId(assetId);
  if (!normalized || !/^data:image\/webp;base64,[a-z0-9+/=]+$/i.test(dataUrl)) return false;
  rememberDataUrl(normalized, dataUrl);
  return true;
}
