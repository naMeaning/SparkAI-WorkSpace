(function bootstrapNaimageGlassAppearance() {
  "use strict";

  var storageKey = "naimage.glassTheme.bootstrap.v1";
  var legacyStorageKey = "naimage.glassAppearance.v1";
  // This startup-only projection mirrors runtime/glass-theme-presets.json.
  // The focused glass-theme self-test checks every theme/material/accent against
  // the TypeScript projection so drift fails before packaging.
  var registry = {
    defaults: { theme: "dark-ember", material: "frosted", accent: "theme", noise: true, reduceMotion: false },
    ranges: {
      opacity: { min: 8, max: 72 },
      blur: { min: 0, max: 48 },
      saturation: { min: 70, max: 180 },
      highlight: { min: 8, max: 70 },
      shadow: { min: 0, max: 70 },
      radius: { min: 4, max: 24 }
    },
    accents: {
      rose: { color: "#ff8eb8", rgb: "255, 142, 184", ink: "#3c1022" },
      mint: { color: "#73e3af", rgb: "115, 227, 175", ink: "#062a1c" },
      coral: { color: "#ff8b78", rgb: "255, 139, 120", ink: "#3d130d" },
      amber: { color: "#f4bd67", rgb: "244, 189, 103", ink: "#312000" },
      ice: { color: "#8bc9ee", rgb: "139, 201, 238", ink: "#092b3d" }
    },
    modes: {
      dark: {
        line: "rgba(255, 255, 255, 0.1)",
        lineStrong: "rgba(255, 255, 255, 0.18)",
        solidControl: "rgba(255, 255, 255, 0.065)",
        solidControlHover: "rgba(255, 255, 255, 0.105)",
        success: "#78ddb2",
        danger: "#ff8477"
      },
      light: {
        line: "rgba(43, 48, 45, 0.09)",
        lineStrong: "rgba(43, 48, 45, 0.16)",
        solidControl: "rgba(255, 255, 255, 0.44)",
        solidControlHover: "rgba(255, 255, 255, 0.68)",
        success: "#278662",
        danger: "#c4473d"
      }
    },
    materials: {
      dark: {
        clear: { opacity: 10, blur: 10, saturation: 112, highlight: 24, shadow: 20, radius: 10 },
        frosted: { opacity: 22, blur: 26, saturation: 138, highlight: 34, shadow: 40, radius: 14 },
        dense: { opacity: 62, blur: 18, saturation: 116, highlight: 20, shadow: 50, radius: 12 }
      },
      light: {
        clear: { opacity: 24, blur: 12, saturation: 112, highlight: 62, shadow: 12, radius: 10 },
        frosted: { opacity: 44, blur: 28, saturation: 128, highlight: 70, shadow: 18, radius: 14 },
        dense: { opacity: 72, blur: 20, saturation: 112, highlight: 76, shadow: 24, radius: 12 }
      }
    },
    themes: {
      "dark-rose": {
        mode: "dark", accent: "rose",
        glassRgb: "48, 30, 40", accentColor: "#ff8eb8", accentRgb: "255, 142, 184", accentInk: "#3c1022",
        secondary: "#ffb06f", secondaryRgb: "255, 176, 111", canvas: "#100b0f", canvasTint: "rgba(180, 54, 103, 0.06)",
        surfaceSolid: "#1c151a", surfaceRaised: "#281b22", nodeBg: "rgba(27, 21, 25, 0.95)",
        ink: "#fff7fa", inkSoft: "#ddcbd2", muted: "#9d858f"
      },
      "dark-ember": {
        mode: "dark", accent: "coral",
        glassRgb: "54, 34, 22", accentColor: "#ff9867", accentRgb: "255, 152, 103", accentInk: "#3c1707",
        secondary: "#ffd36f", secondaryRgb: "255, 211, 111", canvas: "#110c08", canvasTint: "rgba(220, 100, 38, 0.06)",
        surfaceSolid: "#1d1712", surfaceRaised: "#2a2018", nodeBg: "rgba(30, 23, 17, 0.95)",
        ink: "#fff9f3", inkSoft: "#e2d0c0", muted: "#a18c79"
      },
      "dark-emerald": {
        mode: "dark", accent: "mint",
        glassRgb: "22, 48, 39", accentColor: "#73e3af", accentRgb: "115, 227, 175", accentInk: "#062a1c",
        secondary: "#9ccdf1", secondaryRgb: "156, 205, 241", canvas: "#07100d", canvasTint: "rgba(41, 151, 111, 0.055)",
        surfaceSolid: "#101c18", surfaceRaised: "#172820", nodeBg: "rgba(16, 27, 23, 0.95)",
        ink: "#f3fff9", inkSoft: "#c3ded2", muted: "#7fa092"
      },
      "light-silver": {
        mode: "light", accent: "ice",
        glassRgb: "213, 218, 224", accentColor: "#63798c", accentRgb: "99, 121, 140", accentInk: "#111c24",
        secondary: "#9b7568", secondaryRgb: "155, 117, 104", canvas: "#dfe3e7", canvasTint: "rgba(93, 109, 123, 0.07)",
        surfaceSolid: "#f4f6f8", surfaceRaised: "#ffffff", nodeBg: "rgba(245, 247, 249, 0.96)",
        ink: "#252b31", inkSoft: "#46515b", muted: "#5f6b75"
      },
      "light-lemon": {
        mode: "light", accent: "amber",
        glassRgb: "255, 244, 164", accentColor: "#d4a91e", accentRgb: "212, 169, 30", accentInk: "#312600",
        secondary: "#71b68f", secondaryRgb: "113, 182, 143", canvas: "#f4f1dd", canvasTint: "rgba(225, 190, 45, 0.08)",
        surfaceSolid: "#fffdf3", surfaceRaised: "#ffffff", nodeBg: "rgba(255, 254, 247, 0.96)",
        ink: "#29281e", inkSoft: "#504d3b", muted: "#756f53"
      },
      "light-sky": {
        mode: "light", accent: "ice",
        glassRgb: "191, 227, 244", accentColor: "#389bc9", accentRgb: "56, 155, 201", accentInk: "#06293a",
        secondary: "#79cba8", secondaryRgb: "121, 203, 168", canvas: "#e8f2f6", canvasTint: "rgba(56, 154, 201, 0.075)",
        surfaceSolid: "#f7fcfe", surfaceRaised: "#ffffff", nodeBg: "rgba(248, 253, 255, 0.96)",
        ink: "#203039", inkSoft: "#455d69", muted: "#5d7480"
      },
      "light-blush": {
        mode: "light", accent: "rose",
        glassRgb: "255, 206, 220", accentColor: "#e76f99", accentRgb: "231, 111, 153", accentInk: "#431125",
        secondary: "#f5a16f", secondaryRgb: "245, 161, 111", canvas: "#f8ebee", canvasTint: "rgba(231, 111, 153, 0.075)",
        surfaceSolid: "#fff8fa", surfaceRaised: "#ffffff", nodeBg: "rgba(255, 249, 251, 0.96)",
        ink: "#38272e", inkSoft: "#654a55", muted: "#836773"
      }
    }
  };
  var themeIds = new Set(Object.keys(registry.themes));
  var materialPresetIds = new Set(["clear", "frosted", "dense"]);
  var materialIds = new Set(["clear", "frosted", "dense", "custom"]);
  var accentIds = new Set(["theme", "rose", "mint", "coral", "amber", "ice"]);
  var numericKeys = ["opacity", "blur", "saturation", "highlight", "shadow", "radius"];

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (_error) {
      return null;
    }
  }

  function behavior(value) {
    var source = record(value);
    return {
      accent: accentIds.has(source.accent) ? source.accent : registry.defaults.accent,
      noise: typeof source.noise === "boolean" ? source.noise : registry.defaults.noise,
      reduceMotion: typeof source.reduceMotion === "boolean" ? source.reduceMotion : registry.defaults.reduceMotion
    };
  }

  function rangeValue(key, value, fallback) {
    var numeric = Number(value);
    var range = registry.ranges[key];
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(range.min, Math.min(range.max, Math.round(numeric)));
  }

  function materialParameters(theme, material, options) {
    var mode = registry.themes[theme].mode;
    return Object.assign({}, registry.materials[mode][material], behavior(options));
  }

  function normalizeAppearance(value) {
    var source = record(value);
    var theme = themeIds.has(source.glassTheme) ? source.glassTheme : registry.defaults.theme;
    var material = materialIds.has(source.glassMaterial) ? source.glassMaterial : registry.defaults.material;
    var parameters = record(source.glassParameters);
    var options = behavior(parameters);
    if (material !== "custom") {
      return { glassTheme: theme, glassMaterial: material, glassParameters: materialParameters(theme, material, options) };
    }
    var fallback = materialParameters(theme, registry.defaults.material, options);
    var custom = {};
    numericKeys.forEach(function normalizeNumeric(key) {
      custom[key] = rangeValue(key, parameters[key], fallback[key]);
    });
    return { glassTheme: theme, glassMaterial: material, glassParameters: Object.assign(custom, options) };
  }

  function alpha(percentage) {
    return String(percentage / 100);
  }

  function mixHexColors(left, leftWeight, right) {
    function parse(value) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
      return [1, 3, 5].map(function channel(offset) { return Number.parseInt(value.slice(offset, offset + 2), 16); });
    }
    var leftRgb = parse(left);
    var rightRgb = parse(right);
    if (!leftRgb || !rightRgb) return left;
    var weight = Math.max(0, Math.min(1, leftWeight));
    return "#" + leftRgb.map(function mixedChannel(channel, index) {
      return Math.round(channel * weight + rightRgb[index] * (1 - weight)).toString(16).padStart(2, "0");
    }).join("");
  }

  function appearanceProjection(value) {
    var settings = normalizeAppearance(value);
    var theme = registry.themes[settings.glassTheme];
    var mode = registry.modes[theme.mode];
    var parameters = settings.glassParameters;
    var accent = parameters.accent === "theme"
      ? { id: theme.accent, color: theme.accentColor, rgb: theme.accentRgb, ink: theme.accentInk }
      : Object.assign({ id: parameters.accent }, registry.accents[parameters.accent]);
    var variables = {
      "--glass-rgb": theme.glassRgb,
      "--glass-opacity": alpha(parameters.opacity),
      "--glass-alpha": alpha(parameters.opacity),
      "--glass-blur": parameters.blur + "px",
      "--glass-saturation": parameters.saturation + "%",
      "--glass-highlight": alpha(parameters.highlight),
      "--glass-shadow": alpha(parameters.shadow),
      "--glass-radius": parameters.radius + "px",
      "--glass-noise-opacity": parameters.noise ? "0.025" : "0",
      "--noise-opacity": parameters.noise ? "0.025" : "0",
      "--glass-motion-duration": parameters.reduceMotion ? "0ms" : "180ms",
      "--accent": accent.color,
      "--accent-rgb": accent.rgb,
      "--accent-ink": accent.ink,
      "--secondary": theme.secondary,
      "--secondary-rgb": theme.secondaryRgb,
      "--canvas-tint": theme.canvasTint,
      "--node-bg": theme.nodeBg,
      "--solid-control": mode.solidControl,
      "--solid-control-hover": mode.solidControlHover,
      "--success": mode.success,
      "--danger": mode.danger,
      "--theme-bg": theme.surfaceSolid,
      "--theme-canvas": theme.canvas,
      "--theme-surface": theme.surfaceSolid,
      "--theme-surface-solid": theme.surfaceSolid,
      "--theme-surface-raised": theme.surfaceRaised,
      "--theme-ink": theme.ink,
      "--theme-ink-soft": theme.inkSoft,
      "--theme-muted": theme.muted,
      "--theme-line": mode.line,
      "--theme-line-strong": mode.lineStrong,
      "--theme-accent": accent.color,
      "--theme-accent-strong": mixHexColors(accent.color, 0.72, theme.ink),
      "--theme-blue": theme.secondary,
      "--theme-rose": mode.danger,
      "--theme-amber": registry.accents.amber.color,
      "--theme-green": mode.success,
      "--theme-control-bg": mode.solidControl,
      "--theme-hover-bg": mode.solidControlHover,
      "--theme-active-bg": "rgba(" + accent.rgb + ", 0.16)"
    };
    Object.keys(registry.accents).forEach(function accentVariable(id) {
      variables["--glass-accent-" + id] = registry.accents[id].color;
    });
    Object.keys(registry.themes).forEach(function swatchVariables(id) {
      var swatch = registry.themes[id];
      variables["--glass-swatch-" + id + "-canvas"] = swatch.canvas;
      variables["--glass-swatch-" + id + "-accent"] = swatch.accentColor;
      variables["--glass-swatch-" + id + "-surface"] = swatch.surfaceSolid;
    });
    return { settings: settings, mode: theme.mode, resolvedAccent: accent.id, variables: variables };
  }

  var snapshot = readJson(storageKey);
  var validSnapshot = Boolean(snapshot && snapshot.schemaVersion === 1 && snapshot.type === "naimage-glass-theme-bootstrap");
  var legacySnapshot = validSnapshot ? null : readJson(legacyStorageKey);
  var saved = validSnapshot ? snapshot : legacySnapshot;
  var source = record(saved);
  var legacyParameters = source.glassParameters || {
    accent: source.accent,
    noise: source.noise,
    reduceMotion: source.reduceMotion
  };
  var projection = appearanceProjection({
    glassTheme: source.glassTheme || source.theme,
    glassMaterial: source.glassMaterial || source.material,
    glassParameters: legacyParameters
  });
  var settings = projection.settings;
  var parameters = settings.glassParameters;
  var root = document.documentElement;

  root.dataset.glassTheme = settings.glassTheme;
  root.dataset.glassMode = projection.mode;
  root.dataset.glassMaterial = settings.glassMaterial;
  root.dataset.glassAccent = parameters.accent;
  root.dataset.glassAccentResolved = projection.resolvedAccent;
  root.dataset.glassNoise = parameters.noise ? "on" : "off";
  root.dataset.glassReduceMotion = parameters.reduceMotion ? "true" : "false";
  root.dataset.theme = projection.mode;
  root.dataset.uiTheme = settings.glassTheme;
  root.classList.toggle("glass-theme-active", true);
  root.classList.toggle("theme-dark", projection.mode === "dark");
  root.classList.toggle("theme-light", projection.mode === "light");
  root.classList.toggle("glass-no-noise", !parameters.noise);
  root.classList.toggle("glass-reduce-motion", parameters.reduceMotion);
  Object.keys(projection.variables).forEach(function applyVariable(name) {
    root.style.setProperty(name, projection.variables[name]);
  });
  root.style.colorScheme = projection.mode;

  window.__naimageGlassBootState = {
    glassTheme: settings.glassTheme,
    mode: projection.mode,
    glassMaterial: settings.glassMaterial,
    accent: parameters.accent,
    restored: Boolean(saved),
    schema: validSnapshot ? "v1" : legacySnapshot ? "legacy" : "default",
    appearanceTrace: [{
      source: "bootstrap",
      glassTheme: settings.glassTheme,
      mode: projection.mode,
      glassMaterial: settings.glassMaterial,
      accent: parameters.accent,
      opacity: parameters.opacity,
      blur: parameters.blur,
      saturation: parameters.saturation,
      highlight: parameters.highlight,
      shadow: parameters.shadow,
      radius: parameters.radius,
      noise: parameters.noise,
      reduceMotion: parameters.reduceMotion
    }]
  };
})();
