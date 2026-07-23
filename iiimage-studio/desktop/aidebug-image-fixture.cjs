"use strict";

const { createHash } = require("node:crypto");
const { PNG } = require("pngjs");

function aidebugImageDimensions(size = "512x512") {
  const match = String(size || "").match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
  const sourceWidth = Math.max(1, Number(match?.[1] || 512));
  const sourceHeight = Math.max(1, Number(match?.[2] || 512));
  const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(96, Math.round(sourceWidth * scale)),
    height: Math.max(96, Math.round(sourceHeight * scale))
  };
}

function aidebugLayerFixtureHint(payload = {}) {
  const prompt = String(payload.prompt || "");
  const explicitRole = String(payload.layerRole || "").trim().toLowerCase();
  const explicitId = String(payload.layerId || "").trim().toLowerCase();
  const layerTitle = prompt.match(/本次只输出图层[「"]([^」"]+)[」"]/u)?.[1]?.trim() || "";
  const isLayerPrompt = Boolean(layerTitle) && (
    /#ff00ff|色键背景|客户端会自动移除色键背景/i.test(prompt) ||
    /纯背景层|背景必须不透明/.test(prompt)
  );
  let role = explicitRole;
  if (!role && isLayerPrompt) {
    if (/纯背景层|背景必须不透明/.test(prompt)) role = "background";
    else {
      const roleText = `${layerTitle} ${payload.runId || ""}`.toLowerCase();
      if (/foreground|前景/.test(roleText)) role = "foreground";
      else if (/decor|prop|道具|装饰/.test(roleText)) role = "decoration";
      else if (/title|heading|headline|body-text|text|标题|文字|文案/.test(roleText)) role = "text";
      else if (/subject|character|人物|主体|角色|模特/.test(roleText)) role = "subject";
      else role = "fixture-layer";
    }
  }
  const id = explicitId || (isLayerPrompt
    ? String(layerTitle || payload.runId || role)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
    : "");
  const explicitComplete = Boolean(explicitRole && explicitId);
  return {
    role,
    id,
    isLayerPrompt,
    source: explicitComplete ? "explicit" : isLayerPrompt ? "prompt-compat" : "none"
  };
}

function aidebugImageBase64(index = 0, payload = {}) {
  const { width, height } = aidebugImageDimensions(payload.size);
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  const layerHint = aidebugLayerFixtureHint(payload);
  const layerRole = layerHint.role;
  const layerId = layerHint.id;
  const mode = String(payload.mode || payload.operation || "").trim().toLowerCase();
  const isLayerMask = String(payload.layerOutputMode || "").trim().toLowerCase() === "mask" && layerHint.role !== "background";
  // The recoverable-layer suite must compare two executions of the same
  // visual fixture. A random runtime group id changing the fixture palette
  // makes the local fidelity gate probabilistic and hides real regressions.
  const deterministicRecoverySeed = /AIDebug 分层恢复测试/i.test(String(payload.prompt || ""))
    ? "layers-1784503314030-cg8tf"
    : "";
  const layerGroupSeed = deterministicRecoverySeed || String(payload.layerGroupId || payload.runId || "").match(/layers-\d+-[a-z0-9]+/i)?.[0] || "";
  const signature = (layerGroupSeed
    ? [layerGroupSeed, index]
    : [payload.runId, payload.prompt, layerRole, layerId, index]
  ).map((value) => String(value || "")).join("|");
  const digest = createHash("sha256").update(signature).digest();
  const base = [
    34 + digest[0] % 92,
    48 + digest[1] % 104,
    72 + digest[2] % 116,
    255
  ];
  const accent = isLayerMask ? [255, 255, 255, 255] : [
    174 + digest[3] % 82,
    174 + digest[4] % 82,
    174 + digest[5] % 82,
    255
  ];
  const secondary = isLayerMask ? [255, 255, 255, 255] : [
    72 + digest[6] % 150,
    72 + digest[7] % 150,
    72 + digest[8] % 150,
    255
  ];
  const magenta = [255, 0, 255, 255];
  const clear = [0, 0, 0, 0];
  const transparentRequested = (
    payload.transparentPreferred === true ||
    String(payload.background || "").toLowerCase() === "transparent" ||
    mode === "cutout"
  );
  const transparentDirect = Boolean(
    transparentRequested && (!layerRole || (layerRole !== "background" && !isLayerMask))
  );
  // The mixed layer pipeline now asks the image service for genuine full-colour
  // transparent subject/product assets. Mock that native response directly so
  // GUI tests exercise the same existing-alpha path as production. Chroma-key
  // plates remain a compatibility fallback for non-transparent legacy hints.
  const isLayerChroma = Boolean(layerRole && layerRole !== "background" && !isLayerMask && !transparentDirect);
  const isLayerPreview = Boolean(layerGroupSeed && /-preview(?:-|$)/i.test(String(payload.runId || "")));

  const setPixel = (x, y, color) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const offset = (py * width + px) * 4;
    png.data[offset] = color[0];
    png.data[offset + 1] = color[1];
    png.data[offset + 2] = color[2];
    png.data[offset + 3] = (isLayerMask || (!transparentDirect && !isLayerChroma)) ? 255 : color[3] ?? 255;
  };
  const fill = (color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) setPixel(x, y, color);
    }
  };
  const rect = (x, y, w, h, color) => {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(width, Math.ceil(x + w));
    const bottom = Math.min(height, Math.ceil(y + h));
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) setPixel(px, py, color);
    }
  };
  const circle = (cx, cy, radius, color) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    const squared = radius * radius;
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        if ((px - cx) ** 2 + (py - cy) ** 2 <= squared) setPixel(px, py, color);
      }
    }
  };
  const diamond = (cx, cy, radius, color) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        if (Math.abs(px - cx) + Math.abs(py - cy) <= radius) setPixel(px, py, color);
      }
    }
  };
  const line = (x1, y1, x2, y2, thickness, color) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      circle(x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress, thickness / 2, color);
    }
  };
  const gradientBackground = () => {
    for (let y = 0; y < height; y += 1) {
      const mix = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x += 1) {
        const checker = (Math.floor(x / Math.max(8, width / 16)) + Math.floor(y / Math.max(8, height / 16))) % 2 === 0 ? 8 : 0;
        setPixel(x, y, [
          Math.min(255, Math.round(base[0] * (1 - mix) + secondary[0] * mix) + checker),
          Math.min(255, Math.round(base[1] * (1 - mix) + secondary[1] * mix) + checker),
          Math.min(255, Math.round(base[2] * (1 - mix) + secondary[2] * mix) + checker),
          255
        ]);
      }
    }
  };
  const drawSubject = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const detail = overrideColor || [255, 255, 255, 185];
    const centerX = width * (0.42 + (digest[9] % 17) / 100);
    circle(centerX, height * 0.32, Math.min(width, height) * 0.09, primary);
    rect(centerX - width * 0.11, height * 0.4, width * 0.22, height * 0.36, primary);
    rect(centerX - width * 0.055, height * 0.43, width * 0.04, height * 0.28, detail);
  };
  const drawBackground = () => {
    gradientBackground();
    circle(width * 0.78, height * 0.24, Math.min(width, height) * 0.13, [accent[0], accent[1], accent[2], 255]);
    line(width * 0.08, height * 0.84, width * 0.92, height * 0.62, Math.max(4, width * 0.012), [secondary[0], secondary[1], secondary[2], 255]);
  };
  const drawForeground = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || [secondary[0], secondary[1], secondary[2], 255];
    const pale = overrideColor || [255, 255, 255, 205];
    const paleSecondary = overrideColor || [255, 255, 255, 170];
    rect(0, height * 0.72, width, height * 0.28, secondaryColor);
    rect(width * 0.08, height * 0.68, width * 0.84, height * 0.07, primary);
    circle(width * 0.18, height * 0.72, width * 0.09, pale);
    circle(width * 0.78, height * 0.76, width * 0.12, paleSecondary);
  };
  const drawDecoration = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || secondary;
    line(width * 0.12, height * 0.78, width * 0.84, height * 0.22, Math.max(5, width * 0.018), primary);
    for (let marker = 0; marker < 5; marker += 1) {
      circle(width * (0.18 + marker * 0.15), height * (0.26 + (marker % 2) * 0.12), Math.max(5, width * (0.018 + marker * 0.002)), marker % 2 ? secondaryColor : primary);
    }
  };
  const drawTextLayer = (titleLayer, overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || [secondary[0], secondary[1], secondary[2], 255];
    const pale = overrideColor || [255, 255, 255, 230];
    const startY = titleLayer ? height * 0.12 : height * 0.79;
    const barHeight = Math.max(5, height * (titleLayer ? 0.035 : 0.018));
    rect(width * 0.12, startY, width * (titleLayer ? 0.62 : 0.46), barHeight, primary);
    rect(width * 0.12, startY + barHeight * 2.1, width * (titleLayer ? 0.42 : 0.58), barHeight, secondaryColor);
    rect(width * 0.12, startY + barHeight * 4.2, width * (titleLayer ? 0.24 : 0.34), barHeight, pale);
  };

  if (isLayerMask) fill([0, 0, 0, 255]);
  else if (isLayerChroma) fill(magenta);
  else if (transparentDirect) fill(clear);
  else gradientBackground();

  if (isLayerPreview) {
    drawBackground();
    drawForeground();
    drawSubject();
    drawDecoration();
    drawTextLayer(true);
    drawTextLayer(false);
  } else if (layerRole === "background") {
    drawBackground();
  } else if (layerRole === "foreground") {
    drawForeground();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawSubject(erase);
      drawDecoration(erase);
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "subject") {
    drawSubject();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawDecoration(erase);
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "decoration") {
    drawDecoration();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "text") {
    const titleLayer = /title|heading|headline/i.test(layerId);
    drawTextLayer(titleLayer);
    if (isLayerMask && titleLayer) drawTextLayer(false, [0, 0, 0, 255]);
  } else if (layerRole) {
    diamond(width * 0.5, height * 0.5, Math.min(width, height) * 0.2, accent);
  } else if (transparentDirect) {
    drawSubject();
    circle(width * 0.7, height * 0.34, Math.min(width, height) * 0.055, secondary);
  } else {
    drawSubject();
    diamond(width * 0.74, height * 0.42, Math.min(width, height) * (0.08 + (index % 3) * 0.018), accent);
    line(width * 0.1, height * (0.78 - (index % 3) * 0.06), width * 0.9, height * (0.64 + (index % 2) * 0.08), Math.max(5, width * 0.016), [255, 255, 255, 210]);
    const markerSize = Math.max(18, Math.min(width, height) * 0.12);
    rect(width * 0.05, height * 0.05, markerSize, markerSize, [18, 24, 36, 220]);
    for (let bit = 0; bit < 4; bit += 1) {
      if (((index + 1 + digest[10]) >> bit) & 1) rect(width * 0.065 + bit * markerSize * 0.18, height * 0.07, markerSize * 0.1, markerSize * 0.62, accent);
    }
  }

  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true }).toString("base64");
}

module.exports = {
  aidebugImageBase64,
  aidebugLayerFixtureHint
};
