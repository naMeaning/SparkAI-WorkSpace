"use strict";

const glassThemeRegistry = require("./glass-theme-presets.json");

const glassThemeIds = new Set(glassThemeRegistry.themeOrder);
const glassMaterialPresetIds = new Set(glassThemeRegistry.materialOrder);
const glassMaterialIds = new Set([...glassMaterialPresetIds, "custom"]);
const glassAccentIds = new Set(glassThemeRegistry.accentOrder);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedRangeValue(key, value, fallback) {
  const numeric = Number(value);
  const range = glassThemeRegistry.ranges[key];
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(range.min, Math.min(range.max, Math.round(numeric)));
}

function normalizedBehavior(value) {
  const source = record(value);
  return {
    accent: glassAccentIds.has(String(source.accent)) ? String(source.accent) : glassThemeRegistry.defaults.accent,
    noise: typeof source.noise === "boolean" ? source.noise : glassThemeRegistry.defaults.noise,
    reduceMotion: typeof source.reduceMotion === "boolean" ? source.reduceMotion : glassThemeRegistry.defaults.reduceMotion
  };
}

function glassMaterialParameters(theme, material, behavior = {}) {
  const normalizedTheme = glassThemeIds.has(String(theme)) ? String(theme) : glassThemeRegistry.defaults.theme;
  const normalizedMaterial = glassMaterialPresetIds.has(String(material)) ? String(material) : glassThemeRegistry.defaults.material;
  const mode = glassThemeRegistry.themes[normalizedTheme].mode;
  return {
    ...glassThemeRegistry.materialPresets[mode][normalizedMaterial],
    ...normalizedBehavior(behavior)
  };
}

function normalizeGlassThemeSettings(value) {
  const source = record(value);
  const glassTheme = glassThemeIds.has(String(source.glassTheme)) ? String(source.glassTheme) : glassThemeRegistry.defaults.theme;
  const glassMaterial = glassMaterialIds.has(String(source.glassMaterial)) ? String(source.glassMaterial) : glassThemeRegistry.defaults.material;
  const parameters = record(source.glassParameters);
  const behavior = normalizedBehavior(parameters);
  if (glassMaterial !== "custom") {
    return {
      glassTheme,
      glassMaterial,
      glassParameters: glassMaterialParameters(glassTheme, glassMaterial, behavior)
    };
  }
  const fallback = glassMaterialParameters(glassTheme, glassThemeRegistry.defaults.material, behavior);
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

function nativeWindowBackgroundColor(settings) {
  const appearance = normalizeGlassThemeSettings(settings);
  return glassThemeRegistry.themes[appearance.glassTheme].tokens.canvas;
}

const defaultGlassAppearance = normalizeGlassThemeSettings();

module.exports = {
  defaultGlassAppearance,
  glassMaterialParameters,
  glassThemeRegistry,
  nativeWindowBackgroundColor,
  normalizeGlassThemeSettings
};
