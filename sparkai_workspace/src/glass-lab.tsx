import React, { useState } from "react";
import { Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";

import "./styles/04b-glass-lab.css";

import type { AppSettings } from "./core";
import {
  GLASS_BACKGROUND_BLUR_MAX,
  GLASS_BACKGROUND_BLUR_MIN,
  GLASS_BACKGROUND_OVERLAY_MAX,
  GLASS_BACKGROUND_OVERLAY_MIN,
  primeGlassBackgroundDataUrl,
  withGlassBackground,
} from "./glass-background";
import {
  GLASS_ACCENT_IDS,
  GLASS_MATERIAL_PRESET_IDS,
  GLASS_NUMERIC_PARAMETER_KEYS,
  GLASS_THEME_IDS,
  DEFAULT_GLASS_MATERIAL,
  glassThemeRegistry,
  withGlassMaterial,
  withGlassParameters,
  withGlassTheme,
  type GlassAccentId,
  type GlassMaterialPresetId,
  type GlassNumericParameterKey,
  type GlassParameters,
  type GlassThemeId,
} from "./glass-theme";
import { ActionButton, ButtonBase } from "./ui";

const THEME_DETAILS: Record<GlassThemeId, string> = {
  "dark-rose": "深色 · 粉",
  "dark-ember": "深色 · 橙",
  "dark-emerald": "深色 · 绿",
  "light-silver": "浅色 · 灰",
  "light-lemon": "浅色 · 黄",
  "light-sky": "浅色 · 蓝",
  "light-blush": "浅色 · 粉橙",
};

const THEME_OPTIONS = GLASS_THEME_IDS.map((id) => ({
  id,
  name: glassThemeRegistry.themes[id].name,
  detail: THEME_DETAILS[id],
}));

const MATERIAL_COPY: Record<GlassMaterialPresetId, { name: string; detail: string }> = {
  clear: { name: "Clear", detail: "清透" },
  frosted: { name: "Frosted", detail: "推荐" },
  dense: { name: "Dense", detail: "稳重" },
};

const MATERIAL_OPTIONS = GLASS_MATERIAL_PRESET_IDS.map((id) => ({ id, ...MATERIAL_COPY[id] }));

const RANGE_LABELS: Record<GlassNumericParameterKey, string> = {
  opacity: "表面不透明度",
  blur: "背景模糊",
  saturation: "背景饱和度",
  highlight: "边缘高光",
  shadow: "悬浮阴影",
  radius: "圆角",
};

const RANGE_OPTIONS = GLASS_NUMERIC_PARAMETER_KEYS.map((key) => {
  const range = glassThemeRegistry.ranges[key];
  return {
    key,
    label: RANGE_LABELS[key],
    detail: key === "opacity" ? "数值越低越透明，越高越接近实色。" : "",
    min: range.min,
    max: range.max,
    step: range.step,
    suffix: range.unit === "px" ? " px" : "%",
  };
});

const ACCENT_LABELS: Record<GlassAccentId, string> = {
  theme: "跟随主题",
  rose: "樱粉",
  mint: "薄荷绿",
  coral: "珊瑚红",
  amber: "琥珀金",
  ice: "冰川蓝",
};

const ACCENT_OPTIONS = GLASS_ACCENT_IDS.map((id) => ({ id, label: ACCENT_LABELS[id] }));

function formatBackgroundBytes(value: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function GlassLab({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const { glassTheme, glassMaterial, glassParameters } = settings;
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const hasBackground = Boolean(settings.glassBackgroundAssetId);

  async function pickBackground() {
    if (!window.naimageConfig?.pickGlassBackground) {
      setBackgroundError("当前运行环境不支持自定义工作区背景。");
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      const result = await window.naimageConfig.pickGlassBackground();
      if (result?.canceled) return;
      if (!result?.ok || !result.asset?.assetId) {
        throw new Error(result?.error || "无法导入工作区背景。");
      }
      if (result.dataUrl) primeGlassBackgroundDataUrl(result.asset.assetId, result.dataUrl);
      onChange(withGlassBackground(settings, {
        glassBackgroundEnabled: true,
        glassBackgroundAssetId: result.asset.assetId,
        glassBackgroundAssetName: result.asset.name || "工作区背景",
        glassBackgroundAssetMetadata: {
          mimeType: result.asset.mimeType,
          width: result.asset.width,
          height: result.asset.height,
          bytes: result.asset.bytes,
        },
      }));
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackgroundBusy(false);
    }
  }

  function removeBackground() {
    const assetId = settings.glassBackgroundAssetId;
    onChange(withGlassBackground(settings, {
      glassBackgroundEnabled: false,
      glassBackgroundAssetId: "",
      glassBackgroundAssetName: "",
      glassBackgroundAssetMetadata: null,
    }));
    setBackgroundError("");
    if (assetId) void window.naimageConfig?.clearGlassBackground?.({ assetId });
  }

  function updateParameters(patch: Partial<GlassParameters>) {
    onChange(withGlassParameters(settings, patch));
  }

  function restoreRecommended() {
    const recommended = withGlassMaterial(settings, DEFAULT_GLASS_MATERIAL);
    onChange(withGlassParameters(recommended, {
      accent: glassThemeRegistry.defaults.accent,
      noise: glassThemeRegistry.defaults.noise,
      reduceMotion: glassThemeRegistry.defaults.reduceMotion,
    }));
  }

  return (
    <div
      className="glass-lab"
      data-glass-lab="true"
      data-glass-theme={glassTheme}
      data-glass-material={glassMaterial}
      data-glass-custom={glassMaterial === "custom" ? "true" : "false"}
    >
      <section className="glass-lab-section" aria-labelledby="glass-theme-heading" data-glass-section="themes">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-theme-heading">彩色玻璃主题</h4>
            <small>七套主题共享同一组语义设计变量，切换不会重建画布。</small>
          </div>
          <span className="settings-update-status available">实时预览</span>
        </div>
        <div className="glass-theme-grid" role="group" aria-label="彩色玻璃主题">
          {THEME_OPTIONS.map((option) => {
            const active = glassTheme === option.id;
            return (
              <ButtonBase
                key={option.id}
                className={`glass-theme-card${active ? " active" : ""}`}
                data-glass-theme={option.id}
                aria-label={`${option.name}${option.detail.replace(" · ", "")}主题`}
                aria-pressed={active}
                onClick={() => onChange(withGlassTheme(settings, option.id))}
              >
                <span className="glass-theme-swatch" aria-hidden="true" />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </span>
              </ButtonBase>
            );
          })}
        </div>
      </section>

      <section className="glass-lab-section" aria-labelledby="glass-background-heading" data-glass-section="background">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-background-heading">工作区背景</h4>
            <small>自定义底图只作用于界面玻璃层，画布作品保持原色。</small>
          </div>
          {hasBackground ? (
            <span className={`settings-update-status ${settings.glassBackgroundEnabled ? "available" : "checking"}`}>
              {settings.glassBackgroundEnabled ? "已启用" : "已停用"}
            </span>
          ) : null}
        </div>

        <div className={`glass-background-picker${hasBackground ? " has-image" : ""}`}>
          <div className="glass-background-thumbnail" aria-hidden="true">
            {hasBackground ? <span /> : <ImagePlus size={22} />}
          </div>
          <div className="glass-background-copy">
            <strong>{hasBackground ? settings.glassBackgroundAssetName || "工作区背景" : "选择背景图片"}</strong>
            <small>
              {hasBackground
                ? settings.glassBackgroundAssetMetadata
                  ? `${settings.glassBackgroundAssetMetadata.width} × ${settings.glassBackgroundAssetMetadata.height} · ${formatBackgroundBytes(settings.glassBackgroundAssetMetadata.bytes)}`
                  : "已导入的 WebP 背景"
                : "PNG、JPEG、WebP、AVIF、TIFF 或 GIF"}
            </small>
          </div>
          <div className="glass-background-actions">
            <ActionButton
              variant="secondary"
              icon={<ImagePlus size={14} aria-hidden="true" />}
              busy={backgroundBusy}
              onClick={() => { void pickBackground(); }}
            >
              {hasBackground ? "替换" : "选择"}
            </ActionButton>
            {hasBackground ? (
              <ActionButton
                variant="ghost"
                className="glass-background-remove"
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={removeBackground}
              >
                移除
              </ActionButton>
            ) : null}
          </div>
        </div>

        {hasBackground ? (
          <div className="glass-background-controls">
            <label className="glass-background-toggle">
              <span>
                <strong>启用背景</strong>
                <small>关闭后保留图片与参数</small>
              </span>
              <input
                type="checkbox"
                checked={settings.glassBackgroundEnabled}
                onChange={(event) => onChange(withGlassBackground(settings, {
                  glassBackgroundEnabled: event.currentTarget.checked,
                }))}
              />
              <i aria-hidden="true" />
            </label>
            <div className="glass-background-range-grid">
              <label className="glass-range" htmlFor="glass-background-mask">
                <span>
                  <strong>可读遮罩</strong>
                  <output htmlFor="glass-background-mask">{settings.glassBackgroundOverlay}%</output>
                </span>
                <input
                  id="glass-background-mask"
                  type="range"
                  min={GLASS_BACKGROUND_OVERLAY_MIN}
                  max={GLASS_BACKGROUND_OVERLAY_MAX}
                  value={settings.glassBackgroundOverlay}
                  onChange={(event) => onChange(withGlassBackground(settings, {
                    glassBackgroundOverlay: Number(event.currentTarget.value),
                  }))}
                />
              </label>
              <label className="glass-range" htmlFor="glass-background-blur">
                <span>
                  <strong>底图柔化</strong>
                  <output htmlFor="glass-background-blur">{settings.glassBackgroundBlur} px</output>
                </span>
                <input
                  id="glass-background-blur"
                  type="range"
                  min={GLASS_BACKGROUND_BLUR_MIN}
                  max={GLASS_BACKGROUND_BLUR_MAX}
                  value={settings.glassBackgroundBlur}
                  onChange={(event) => onChange(withGlassBackground(settings, {
                    glassBackgroundBlur: Number(event.currentTarget.value),
                  }))}
                />
              </label>
            </div>
          </div>
        ) : null}

        {backgroundError ? <p className="glass-background-error" role="alert">{backgroundError}</p> : null}
      </section>

      <section className="glass-lab-section" aria-labelledby="glass-material-heading" data-glass-section="materials">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-material-heading">材质预设</h4>
            <small>手动调整下方参数后会进入自定义材质。</small>
          </div>
          <ActionButton
            variant="ghost"
            className="glass-reset-action"
            data-glass-action="reset-recommended"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={restoreRecommended}
          >
            恢复推荐参数
          </ActionButton>
        </div>
        <div className="glass-material-grid" role="group" aria-label="玻璃材质预设">
          {MATERIAL_OPTIONS.map((option) => {
            const active = glassMaterial === option.id;
            return (
              <ButtonBase
                key={option.id}
                className={`glass-material-card${active ? " active" : ""}`}
                data-glass-material={option.id}
                aria-pressed={active}
                onClick={() => onChange(withGlassMaterial(settings, option.id))}
              >
                <span className="glass-material-sample" aria-hidden="true" />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </span>
              </ButtonBase>
            );
          })}
        </div>
      </section>

      <section className="glass-lab-section" aria-labelledby="glass-parameters-heading" data-glass-section="parameters">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-parameters-heading">玻璃参数</h4>
            <small>{glassMaterial === "custom" ? "自定义材质" : `${MATERIAL_OPTIONS.find((option) => option.id === glassMaterial)?.name || "自定义"} 预设`}</small>
          </div>
        </div>
        <div className="glass-control-grid">
          {RANGE_OPTIONS.map((control) => {
            const inputId = `glass-${control.key}`;
            const value = glassParameters[control.key];
            return (
              <label
                key={control.key}
                className="glass-range"
                htmlFor={inputId}
                data-glass-control={control.key}
              >
                <span>
                  <strong>{control.label}</strong>
                  <output htmlFor={inputId}>{value}{control.suffix}</output>
                </span>
                <input
                  id={inputId}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={value}
                  aria-valuetext={control.key === "opacity"
                    ? `表面不透明度 ${value}${control.suffix}，数值越低越透明`
                    : `${value}${control.suffix}`}
                  onChange={(event) => updateParameters({ [control.key]: Number(event.currentTarget.value) })}
                />
                {control.detail ? <small>{control.detail}</small> : null}
              </label>
            );
          })}
        </div>
      </section>

      <section className="glass-lab-section" aria-labelledby="glass-accent-heading" data-glass-section="accent">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-accent-heading">强调色</h4>
            <small>用于状态、选中项和键盘焦点，不改变作品颜色。</small>
          </div>
        </div>
        <div className="glass-accent-grid" role="group" aria-label="强调色">
          {ACCENT_OPTIONS.map((option) => {
            const active = glassParameters.accent === option.id;
            return (
              <ButtonBase
                key={option.id}
                className={`glass-accent-swatch${active ? " active" : ""}`}
                data-glass-accent={option.id}
                aria-label={option.label}
                aria-pressed={active}
                title={option.label}
                onClick={() => updateParameters({ accent: option.id })}
              >
                <span aria-hidden="true" />
                <small>{option.label}</small>
              </ButtonBase>
            );
          })}
        </div>
      </section>

      <section className="glass-lab-section glass-toggle-row" aria-label="材质辅助选项" data-glass-section="behavior">
        <label data-glass-toggle="noise">
          <span>
            <strong>微噪点</strong>
            <small>增加玻璃的实体质感</small>
          </span>
          <input
            type="checkbox"
            checked={glassParameters.noise}
            onChange={(event) => updateParameters({ noise: event.currentTarget.checked })}
          />
          <i aria-hidden="true" />
        </label>
        <label data-glass-toggle="reduce-motion">
          <span>
            <strong>减少动态</strong>
            <small>关闭材质切换与悬浮过渡</small>
          </span>
          <input
            type="checkbox"
            checked={glassParameters.reduceMotion}
            onChange={(event) => updateParameters({ reduceMotion: event.currentTarget.checked })}
          />
          <i aria-hidden="true" />
        </label>
      </section>

      <section className="glass-lab-section" aria-labelledby="glass-preview-heading" data-glass-section="preview">
        <div className="settings-section-header">
          <div>
            <h4 id="glass-preview-heading">实时预览</h4>
            <small>玻璃只覆盖界面控制面；作品区域保持不透明、清晰和锐利。</small>
          </div>
        </div>
        <div
          className="glass-preview"
          data-glass-preview="true"
          data-glass-theme={glassTheme}
          data-glass-material={glassMaterial}
          data-glass-accent={glassParameters.accent}
          data-glass-background={settings.glassBackgroundEnabled && hasBackground ? "on" : "off"}
          aria-label="当前玻璃外观预览"
        >
          <div className="glass-preview-topbar" aria-hidden="true"><span /><span /><span /></div>
          <div className="glass-preview-assets" aria-hidden="true"><span /><span /><span /></div>
          <div className="glass-preview-canvas" aria-hidden="true"><span className="glass-preview-artwork" /></div>
          <div className="glass-preview-agent" aria-hidden="true"><strong>Agent</strong><span /><span /><span /></div>
          <div className="glass-preview-toolbar" aria-hidden="true"><span /><span /><span /><span /></div>
        </div>
        <div className="glass-readability-state" data-glass-readability="pass">
          <Check size={14} aria-hidden="true" />
          <span><strong>内容层保持清晰</strong><small>图片与画布内容不应用透明度或背景模糊。</small></span>
        </div>
      </section>
    </div>
  );
}
