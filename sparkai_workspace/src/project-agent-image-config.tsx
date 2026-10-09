import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Search, Star } from "lucide-react";
import { computedSizeFor, frameOptionsForModel, normalizeImageFrameRatio, normalizeImageResolutionPreset, sizePresetsForModel, uniqueImageModels, IMAGE_COUNT_OPTIONS, QUALITY_OPTIONS, type AppSettings, type ImageModelConfig } from "./core";
import { filterImagePickerModels } from "./model-ux";
import { ActionButton, ButtonBase, DialogShell, GlassSelect, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export default function ProjectAgentImageConfig({
  imageModels, imageModelConfigs, selectedImageModels, imageRatio, imageResolution, imageCount, imageQuality,
  locked, onModelsChange, onFrameChange, onOutputChange, requestImageModels, close
}: {
  imageModels: string[];
  imageModelConfigs: ImageModelConfig[];
  selectedImageModels: string[];
  imageRatio: AppSettings["imageRatio"];
  imageResolution: AppSettings["imageResolution"];
  imageCount: number;
  imageQuality: AppSettings["imageQuality"];
  locked: boolean;
  onModelsChange: (models: string[]) => Promise<void>;
  onFrameChange: (ratio: AppSettings["imageRatio"], resolution: AppSettings["imageResolution"]) => Promise<void>;
  onOutputChange: (count: number, quality: AppSettings["imageQuality"]) => Promise<void>;
  requestImageModels: () => void | Promise<void>;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const saveRevision = useRef(0);
  const availableModels = filterImagePickerModels(uniqueImageModels([...imageModels, ...selectedImageModels]));
  const activeModels = filterImagePickerModels(uniqueImageModels(selectedImageModels));
  const defaultModel = activeModels[0] || availableModels[0] || "";
  const capabilities = imageModelConfigs.find((config) => config.model.toLowerCase() === defaultModel.toLowerCase())?.capabilities;
  const ratio = normalizeImageFrameRatio(imageRatio);
  const resolution = normalizeImageResolutionPreset(imageResolution);
  const ratioOptions = frameOptionsForModel(resolution, defaultModel, capabilities);
  const resolutionOptions = sizePresetsForModel(ratio, defaultModel, capabilities);
  const filteredModels = availableModels.filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()));

  async function refreshModels() {
    setLoading(true);
    setRefreshError("");
    try { await requestImageModels(); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refreshModels(); }, []);

  async function save(action: () => Promise<void>) {
    const revision = ++saveRevision.current;
    setSaveNotice("正在保存…");
    setSaveError(false);
    try {
      await action();
      if (revision === saveRevision.current) setSaveNotice("已保存");
    } catch (error) {
      if (revision !== saveRevision.current) return;
      setSaveNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      setSaveError(true);
    }
  }

  function toggleModel(model: string) {
    const selected = activeModels.some((item) => item.toLowerCase() === model.toLowerCase());
    if (selected && activeModels.length <= 1) return;
    void save(() => onModelsChange(selected ? activeModels.filter((item) => item.toLowerCase() !== model.toLowerCase()) : [...activeModels, model]));
  }

  function changeRatio(value: string) {
    const nextRatio = normalizeImageFrameRatio(value, ratio);
    const options = sizePresetsForModel(nextRatio, defaultModel, capabilities);
    const nextResolution = options.some((option) => option.resolution === resolution) ? resolution : options[0]?.resolution || resolution;
    void save(() => onFrameChange(nextRatio, nextResolution));
  }

  function changeResolution(value: string) {
    const nextResolution = normalizeImageResolutionPreset(value, resolution);
    const options = frameOptionsForModel(nextResolution, defaultModel, capabilities);
    const nextRatio = options.some((option) => option.ratio === ratio) ? ratio : options[0]?.ratio || ratio;
    void save(() => onFrameChange(nextRatio, nextResolution));
  }

  return (
    <DialogShell surface="agent-image-config" ariaLabel="图片配置" className="project-agent-image-config" onRequestClose={close}>
      {({ requestClose }) => <>
        <SurfaceHeader eyebrow="IMAGE" title="图片配置" description="修改后自动保存，用于后续生图。" onClose={() => requestClose("close-button")} />
        <SurfaceBody className="project-agent-image-config-body">
          {locked ? <p role="status">任务运行中，图片配置暂不可修改。</p> : null}
          <div className="project-agent-image-config-fields">
            <label><span>比例</span><GlassSelect ariaLabel="默认生图比例" value={ratio} disabled={locked} onChange={changeRatio} options={ratioOptions.map((option) => ({ value: option.ratio, label: `${option.ratio} · ${option.label}` }))} /></label>
            <label><span>清晰度</span><GlassSelect ariaLabel="默认生图清晰度" value={resolution} disabled={locked} onChange={changeResolution} options={resolutionOptions.map((option) => ({ value: option.resolution, label: option.resolution }))} /></label>
            <label><span>每批数量</span><GlassSelect ariaLabel="每批图片数量" value={String(imageCount)} disabled={locked} onChange={(value) => void save(() => onOutputChange(Number(value), imageQuality))} options={IMAGE_COUNT_OPTIONS.map((count) => ({ value: String(count), label: `${count} 张` }))} /></label>
            <label><span>质量</span><GlassSelect ariaLabel="生图质量" value={imageQuality} disabled={locked} onChange={(value) => void save(() => onOutputChange(imageCount, value as AppSettings["imageQuality"]))} options={QUALITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} /></label>
          </div>
          <p className="project-agent-image-config-summary">交付尺寸 {computedSizeFor(ratio, resolution)} · 默认模型 {defaultModel || "尚未选择"}</p>
          <div className="project-agent-image-config-heading"><strong>生图模型</strong><ActionButton type="button" variant="secondary" disabled={loading} icon={loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} onClick={() => void refreshModels()}>刷新列表</ActionButton></div>
          <label className="project-agent-model-search"><Search size={13} /><input type="search" aria-label="搜索生图模型" placeholder="搜索模型" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 160))} /></label>
          <div className="project-agent-model-options" role="listbox" aria-label="上游生图模型" aria-multiselectable="true">
            {filteredModels.map((model) => {
              const selected = activeModels.some((item) => item.toLowerCase() === model.toLowerCase());
              const isDefault = model.toLowerCase() === defaultModel.toLowerCase();
              const lastSelected = selected && activeModels.length === 1;
              return <div key={model.toLowerCase()} className={`project-agent-model-row${selected ? " active" : ""}${lastSelected ? " is-required" : ""}`} role="option" aria-selected={selected}>
                <label className="project-agent-model-option" title={lastSelected ? "至少保留一个生图模型" : model}><input type="checkbox" checked={selected} disabled={locked || lastSelected} onChange={() => toggleModel(model)} /><span>{model}</span>{selected ? <Check size={13} /> : null}</label>
                <ButtonBase type="button" className={`project-agent-model-default${isDefault ? " is-default" : ""}`} disabled={locked} aria-label={isDefault ? `默认生图模型：${model}` : `设为默认生图模型：${model}`} title="设为默认生图模型" onClick={() => void save(() => onModelsChange([model, ...activeModels.filter((item) => item.toLowerCase() !== model.toLowerCase())]))}><Star size={14} fill={isDefault ? "currentColor" : "none"} /></ButtonBase>
              </div>;
            })}
            {!filteredModels.length ? <p>没有匹配的模型</p> : null}
          </div>
          <small>勾选可用模型，星标设为默认；至少保留一个。</small>
          {refreshError ? <p className="project-agent-model-error" role="status">刷新失败，已保留当前模型：{refreshError}</p> : null}
          <p className={saveError ? "project-agent-model-error" : "project-agent-image-config-summary"} role="status">{saveNotice}</p>
        </SurfaceBody>
        <SurfaceFooter><ActionButton type="button" variant="primary" onClick={() => requestClose("action")}>完成</ActionButton></SurfaceFooter>
      </>}
    </DialogShell>
  );
}
