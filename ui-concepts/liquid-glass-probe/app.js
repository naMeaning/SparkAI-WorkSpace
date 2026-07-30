const body = document.body;
const root = document.documentElement;

const themeMeta = {
  "dark-rose": { name: "绯樱夜光", accent: "rose", mode: "dark" },
  "dark-ember": { name: "蜜橙熔光", accent: "coral", mode: "dark" },
  "dark-emerald": { name: "翡翠黑曜", accent: "mint", mode: "dark" },
  "light-lemon": { name: "柠檬晶糖", accent: "amber", mode: "light" },
  "light-sky": { name: "天青冰璃", accent: "ice", mode: "light" },
  "light-blush": { name: "蜜桃珍珠", accent: "rose", mode: "light" }
};

const accentMeta = {
  rose: { color: "#ff8eb8", rgb: "255, 142, 184", ink: "#3c1022" },
  mint: { color: "#73e3af", rgb: "115, 227, 175", ink: "#062a1c" },
  coral: { color: "#ff8b78", rgb: "255, 139, 120", ink: "#3d130d" },
  amber: { color: "#f4bd67", rgb: "244, 189, 103", ink: "#312000" },
  ice: { color: "#8bc9ee", rgb: "139, 201, 238", ink: "#092b3d" }
};

const directionMeta = {
  workbench: ["棱镜工作台", "同时查看素材、来源关系与 Agent 进度"],
  focus: ["专注画布", "放大当前成果，用胶片条连续迭代"],
  review: ["版本评审", "四版同屏比较，快速选择最终方向"]
};

const rangeMeta = {
  opacity: { property: "--glass-alpha", format: (value) => String(Number(value) / 100), suffix: "%" },
  blur: { property: "--glass-blur", format: (value) => `${value}px`, suffix: " px" },
  saturation: { property: "--glass-saturation", format: (value) => `${value}%`, suffix: "%" },
  highlight: { property: "--glass-highlight", format: (value) => String(Number(value) / 100), suffix: "%" },
  shadow: { property: "--glass-shadow", format: (value) => String(Number(value) / 100), suffix: "%" },
  radius: { property: "--glass-radius", format: (value) => `${value}px`, suffix: " px" }
};

const materialPresets = {
  dark: {
    clear: [10, 10, 112, 24, 20, 10],
    frosted: [22, 26, 138, 34, 40, 14],
    dense: [62, 18, 116, 20, 50, 12]
  },
  light: {
    clear: [24, 12, 112, 62, 12, 10],
    frosted: [44, 28, 128, 70, 18, 14],
    dense: [72, 20, 112, 76, 24, 12]
  }
};

let toastTimer = 0;
let activeMaterial = "frosted";

function queryAll(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function showToast(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  const label = toast.querySelector("span");
  if (label) label.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1300);
}

function writeUrlState() {
  const url = new URL(window.location.href);
  url.searchParams.set("theme", body.dataset.uiTheme || "dark-rose");
  url.searchParams.set("direction", body.dataset.direction || "workbench");
  url.searchParams.set("material", activeMaterial);

  Object.keys(rangeMeta).forEach((name) => {
    const input = document.querySelector(`#glass-${name}`);
    if (activeMaterial === "custom" && input instanceof HTMLInputElement) {
      url.searchParams.set(name, input.value);
    } else {
      url.searchParams.delete(name);
    }
  });

  if (body.dataset.accentCustom === "true" && accentMeta[body.dataset.accent]) {
    url.searchParams.set("accent", body.dataset.accent);
  } else {
    url.searchParams.delete("accent");
  }

  if (body.classList.contains("no-noise")) url.searchParams.set("noise", "0");
  else url.searchParams.delete("noise");

  if (body.classList.contains("reduce-motion")) url.searchParams.set("motion", "1");
  else url.searchParams.delete("motion");

  const panel = document.querySelector(".material-panel");
  url.searchParams.set("lab", panel?.classList.contains("is-hidden") ? "0" : "1");
  window.history.replaceState(null, "", url);
}

function applyAccent(accent, announce = false) {
  const meta = accentMeta[accent] || accentMeta.rose;
  body.dataset.accent = accent;
  body.dataset.accentCustom = "true";
  body.style.setProperty("--accent", meta.color);
  body.style.setProperty("--accent-rgb", meta.rgb);
  body.style.setProperty("--accent-ink", meta.ink);
  queryAll("[data-accent-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.accentValue === accent);
  });
  if (announce) showToast(`强调色 · ${buttonLabelForAccent(accent)}`);
}

function buttonLabelForAccent(accent) {
  return document.querySelector(`[data-accent-value="${accent}"]`)?.getAttribute("aria-label") || accent;
}

function applyTheme(theme, options = {}) {
  const nextTheme = themeMeta[theme] ? theme : "dark-rose";
  const meta = themeMeta[nextTheme];
  body.dataset.uiTheme = nextTheme;
  body.style.removeProperty("--accent");
  body.style.removeProperty("--accent-rgb");
  body.style.removeProperty("--accent-ink");
  body.dataset.accent = meta.accent;
  body.dataset.accentCustom = "false";
  queryAll("[data-theme-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeValue === nextTheme);
  });
  queryAll("[data-accent-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.accentValue === meta.accent);
  });
  if (activeMaterial === "custom") applyRanges();
  else applyMaterial(activeMaterial, false);
  if (options.announce !== false) showToast(`${meta.name} · ${meta.mode === "light" ? "浅色" : "深色"}`);
  writeUrlState();
}

function applyDirection(direction, announce = false) {
  const nextDirection = directionMeta[direction] ? direction : "workbench";
  body.dataset.direction = nextDirection;
  queryAll("[data-direction-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.directionValue === nextDirection);
  });
  const copy = directionMeta[nextDirection];
  const title = document.querySelector(".direction-title");
  const description = document.querySelector(".direction-description");
  if (title) title.textContent = copy[0];
  if (description) description.textContent = copy[1];
  if (announce) showToast(copy[0]);
  writeUrlState();
}

function applyRanges() {
  Object.entries(rangeMeta).forEach(([name, meta]) => {
    const input = document.querySelector(`#glass-${name}`);
    if (!(input instanceof HTMLInputElement)) return;
    body.style.setProperty(meta.property, meta.format(input.value));
    const output = input.closest("label")?.querySelector("output");
    if (output) output.textContent = `${input.value}${meta.suffix}`;
  });
}

function setCustomMaterial() {
  activeMaterial = "custom";
  body.dataset.material = "custom";
  queryAll("[data-preset]").forEach((button) => button.classList.remove("active"));
}

function applyCustomMaterial(params) {
  Object.keys(rangeMeta).forEach((name) => {
    const input = document.querySelector(`#glass-${name}`);
    const rawValue = params.get(name);
    if (rawValue === null) return;
    const raw = Number(rawValue);
    if (!(input instanceof HTMLInputElement) || !Number.isFinite(raw)) return;
    const min = Number(input.min);
    const max = Number(input.max);
    input.value = String(Math.min(max, Math.max(min, raw)));
  });
  setCustomMaterial();
  applyRanges();
  writeUrlState();
}

function applyMaterial(material, announce = true) {
  const nextMaterial = materialPresets.dark[material] ? material : "frosted";
  activeMaterial = nextMaterial;
  body.dataset.material = nextMaterial;
  const mode = themeMeta[body.dataset.uiTheme]?.mode || "dark";
  const values = materialPresets[mode][nextMaterial];
  ["opacity", "blur", "saturation", "highlight", "shadow", "radius"].forEach((name, index) => {
    const input = document.querySelector(`#glass-${name}`);
    if (input instanceof HTMLInputElement) input.value = String(values[index]);
  });
  queryAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === nextMaterial);
  });
  applyRanges();
  if (announce) showToast(`材质 · ${nextMaterial}`);
  writeUrlState();
}

function setLabVisible(visible, announce = false) {
  const panel = document.querySelector(".material-panel");
  const trigger = document.querySelector(".material-trigger");
  if (!visible && panel?.contains(document.activeElement)) trigger?.focus();
  panel?.classList.toggle("is-hidden", !visible);
  panel?.toggleAttribute("inert", !visible);
  panel?.setAttribute("aria-hidden", String(!visible));
  trigger?.classList.toggle("active", visible);
  trigger?.setAttribute("aria-expanded", String(visible));
  if (announce) showToast(visible ? "Glass Lab 已展开" : "Glass Lab 已收起");
  writeUrlState();
}

queryAll("[data-theme-value]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeValue));
});

queryAll("[data-direction-value]").forEach((button) => {
  button.addEventListener("click", () => applyDirection(button.dataset.directionValue, true));
});

queryAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => applyMaterial(button.dataset.preset));
});

queryAll(".range-control input").forEach((input) => {
  input.addEventListener("input", () => {
    setCustomMaterial();
    applyRanges();
    writeUrlState();
    showToast("玻璃参数已更新");
  });
});

queryAll("[data-accent-value]").forEach((button) => {
  button.addEventListener("click", () => {
    applyAccent(button.dataset.accentValue, true);
    writeUrlState();
  });
});

document.querySelector(".material-trigger")?.addEventListener("click", () => {
  const panel = document.querySelector(".material-panel");
  setLabVisible(Boolean(panel?.classList.contains("is-hidden")), true);
});

document.querySelector(".material-close")?.addEventListener("click", () => setLabVisible(false, true));
document.querySelector("#reset-settings")?.addEventListener("click", () => {
  applyTheme(body.dataset.uiTheme || "dark-rose", { announce: false });
  applyMaterial("frosted", false);
  showToast("已恢复推荐参数");
});

document.querySelector("#noise-toggle")?.addEventListener("change", (event) => {
  body.classList.toggle("no-noise", !event.target.checked);
  writeUrlState();
  showToast(event.target.checked ? "微噪点已开启" : "微噪点已关闭");
});

document.querySelector("#motion-toggle")?.addEventListener("change", (event) => {
  body.classList.toggle("reduce-motion", event.target.checked);
  writeUrlState();
  showToast(event.target.checked ? "已减少动态" : "动态反馈已恢复");
});

queryAll(".film-item").forEach((button) => {
  button.addEventListener("click", () => {
    queryAll(".film-item").forEach((item) => item.classList.toggle("active", item === button));
  });
});

queryAll(".rail-button").forEach((button) => {
  button.addEventListener("click", () => {
    queryAll(".rail-button").forEach((item) => item.classList.toggle("active", item === button));
  });
});

queryAll(".composer-mode button").forEach((button) => {
  button.addEventListener("click", () => {
    queryAll(".composer-mode button").forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.querySelector(".send-button")?.addEventListener("click", () => showToast("原型模式 · 未发送"));

const params = new URLSearchParams(window.location.search);
const initialTheme = params.get("theme") || "dark-rose";
const initialDirection = params.get("direction") || "workbench";
const initialMaterial = params.get("material") || "frosted";
const labVisible = params.get("lab") !== "0";

body.dataset.uiTheme = themeMeta[initialTheme] ? initialTheme : "dark-rose";
activeMaterial = materialPresets.dark[initialMaterial] ? initialMaterial : "frosted";
applyTheme(body.dataset.uiTheme, { announce: false });
applyDirection(initialDirection, false);
if (initialMaterial === "custom") applyCustomMaterial(params);
else applyMaterial(activeMaterial, false);

const initialAccent = params.get("accent");
if (initialAccent && accentMeta[initialAccent]) applyAccent(initialAccent, false);

const noiseEnabled = params.get("noise") !== "0";
const noiseToggle = document.querySelector("#noise-toggle");
if (noiseToggle instanceof HTMLInputElement) noiseToggle.checked = noiseEnabled;
body.classList.toggle("no-noise", !noiseEnabled);

const motionReduced = params.get("motion") === "1";
const motionToggle = document.querySelector("#motion-toggle");
if (motionToggle instanceof HTMLInputElement) motionToggle.checked = motionReduced;
body.classList.toggle("reduce-motion", motionReduced);

setLabVisible(labVisible, false);

window.__naimageProbe = {
  themes: Object.keys(themeMeta),
  setTheme: (theme) => applyTheme(theme, { announce: false }),
  setDirection: (direction) => applyDirection(direction, false),
  setMaterial: (material) => applyMaterial(material, false),
  setLabVisible,
  getState: () => ({
    theme: body.dataset.uiTheme,
    direction: body.dataset.direction,
    material: activeMaterial,
    labVisible: !document.querySelector(".material-panel")?.classList.contains("is-hidden")
  })
};
