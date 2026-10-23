import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Star } from "lucide-react";
import { computedSizeFor, frameOptionsForModel, normalizeImageFrameRatio, normalizeImageResolutionPreset, sizePresetsForModel, uniqueImageModels, IMAGE_COUNT_OPTIONS, QUALITY_OPTIONS, type AppSettings, type ImageModelConfig } from "./core";
import { filterImagePickerModels } from "./model-ux";
import { imageQualityValues, preferredImageTaskModel } from "../runtime/image-model-policy.mjs";
import { ActionButton, ButtonBase, DialogShell, GlassSelect, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export default function ProjectAgentImageConfig({
  imageModels, imageModelConfigs, selectedImageModels, imageRatio, imageResolution, imageCount, imageQuality,
  locked, onModelsChange, onFrameChange, onOutputChange, requestImageModels, close, localAgent = false, localImageEnabled = false, openLocalConfig
}: {
  imageModels: string[];
  imageModelConfigs: ImageModelConfig[];
  selectedImageModels: string[];
  imageRatio: AppSettings["imageRatio"];
  imageResolution: AppSettings["imageResolution"];
  imageCount: number;
  imageQuality: AppSettings["imageQuality"];
  locked: boolean;
  localAgent?: boolean;
  localImageEnabled?: boolean;
  openLocalConfig?: () => void;
  onModelsChange: (models: string[]) => Promise<void>;
  onFrameChange: (ratio: AppSettings["imageRatio"], resolution: AppSettings["imageResolution"]) => Promise<void>;
  onOutputChange: (count: number, quality: AppSettings["imageQuality"]) => Promise<void>;
  requestImageModels: (forceRefresh?: boolean) => void | Promise<void>;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [pending, setPending] = useState(0);
  const lastSave = useRef<(() => Promise<void>) | null>(null);
  const saveRevision = useRef(0);
  const availableModels = filterImagePickerModels(uniqueImageModels([...imageModels, ...selectedImageModels]));
  const activeModels = filterImagePickerModels(uniqueImageModels(selectedImageModels));
  const defaultModel = activeModels[0] || "";
  const automaticModel = preferredImageTaskModel(activeModels, defaultModel);
  const capabilities = imageModelConfigs.find((config) => config.model.toLowerCase() === defaultModel.toLowerCase())?.capabilities;
  const ratio = normalizeImageFrameRatio(imageRatio);
  const resolution = normalizeImageResolutionPreset(imageResolution);
  const ratioOptions = frameOptionsForModel(resolution, defaultModel, capabilities);
  const resolutionOptions = sizePresetsForModel(ratio, defaultModel, capabilities);
  const compatibleQualities = QUALITY_OPTIONS.filter(option => activeModels.every(model => {
    const config = imageModelConfigs.find(item => item.model.toLowerCase() === model.toLowerCase());
    return imageQualityValues(model, config?.capabilities, config?.protocol === "auto" ? "" : config?.protocol).includes(option.value);
  }));
  const parameterIssue = !compatibleQualities.some(option => option.value === imageQuality)
    ? "当前质量不适用于全部已启用模型，请选择支持的质量；不会静默改写请求。"
    : activeModels.some(model => { const config = imageModelConfigs.find(item => item.model.toLowerCase() === model.toLowerCase()); return !frameOptionsForModel(resolution, model, config?.capabilities).some(option => option.ratio === ratio) || !sizePresetsForModel(ratio, model, config?.capabilities).some(option => option.resolution === resolution); })
      ? "部分启用模型不支持当前画幅或清晰度；实际派发前会再次校验，请调整配置或模型。" : "";
  const filteredModels = availableModels
    .filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => Number(right.toLowerCase() === defaultModel.toLowerCase()) - Number(left.toLowerCase() === defaultModel.toLowerCase()));

  async function refreshModels(forceRefresh = true) {
    setLoading(true);
    setRefreshError("");
    try { await requestImageModels(forceRefresh); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!localAgent) void refreshModels(false); }, [localAgent]);

  async function save(action: () => Promise<void>) {
    const revision = ++saveRevision.current;
    lastSave.current = action;
    setPending(value => value + 1);
    setSaveNotice("正在保存…");
    setSaveError(false);
    try {
      await action();
      if (revision === saveRevision.current) setSaveNotice("已保存");
    } catch (error) {
      if (revision !== saveRevision.current) return;
      setSaveNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      setSaveError(true);
    } finally { setPending(value => value - 1); }
  }

  function toggleModel(model: string) {
    if (locked) return;
    const selected = activeModels.some((item) => item.toLowerCase() === model.toLowerCase());
    if (selected && activeModels.length <= 1) return;
    void save(() => onModelsChange(selected ? activeModels.filter((item) => item.toLowerCase() !== model.toLowerCase()) : [...activeModels, model]));
  }

  function makeDefault(model: string) {
    if (locked || model.toLowerCase() === defaultModel.toLowerCase()) return;
    void save(() => onModelsChange([model, ...activeModels.filter((item) => item.toLowerCase() !== model.toLowerCase())]));
  }

  function changeRatio(value: string) {
    const nextRatio = normalizeImageFrameRatio(value, ratio);
    const options = sizePresetsForModel(nextRatio, defaultModel, capabilities);
    const nextResolution = options.some((option) => option.resolution === resolution) ? resolution : options[0]?.resolution || resolution;
    setAdjustment(nextResolution !== resolution ? `此比例不支持 ${resolution}，清晰度已调整为 ${nextResolution}。` : "");
    void save(() => onFrameChange(nextRatio, nextResolution));
  }

  function changeResolution(value: string) {
    const nextResolution = normalizeImageResolutionPreset(value, resolution);
    const options = frameOptionsForModel(nextResolution, defaultModel, capabilities);
    const nextRatio = options.some((option) => option.ratio === ratio) ? ratio : options[0]?.ratio || ratio;
    setAdjustment(nextRatio !== ratio ? `此清晰度不支持 ${ratio}，比例已调整为 ${nextRatio}。` : "");
    void save(() => onFrameChange(nextRatio, nextResolution));
  }

  if (localAgent) return <DialogShell surface="agent-image-config" ariaLabel="本机图片配置" className="project-agent-image-config" onRequestClose={close}>
    {({ requestClose }) => <><SurfaceHeader eyebrow="LOCAL IMAGE" title="本机图片配置" onClose={() => requestClose("close-button")} />
      <SurfaceBody><p>{localImageEnabled ? "Agent 已配置本机 ComfyUI；后续任务将冻结所选连接和工作流。" : "本机生图尚未启用。严格离线下 image_gen 不可用。"}</p><ActionButton disabled={locked} onClick={openLocalConfig}>配置本机 ComfyUI</ActionButton></SurfaceBody>
      <SurfaceFooter><ActionButton onClick={() => requestClose("action")}>关闭</ActionButton></SurfaceFooter></>}
  </DialogShell>;
  return (
    <DialogShell surface="agent-image-config" ariaLabel="图片配置" className="project-agent-image-config" busy={pending > 0} dirty={saveError}
      closePolicy={{ escape: "when-idle-and-clean", backdrop: "when-idle-and-clean", "close-button": "when-idle-and-clean", action: "when-idle-and-clean" }}
      onCloseBlocked={() => setSaveNotice(pending ? "正在保存，请稍候再关闭。" : "保存失败仍未解决，请重试保存后关闭。") } onRequestClose={close}>
      {({ requestClose }) => <>
        <SurfaceHeader eyebrow="IMAGE" title="图片配置" description="修改后自动保存，用于后续生图。" onClose={() => requestClose("close-button")} />
        <SurfaceBody className="project-agent-image-config-body">
          {locked ? <p role="status">任务运行中，图片配置暂不可修改。</p> : null}
          <div className="project-agent-image-config-fields">
            <label><span>比例</span><GlassSelect ariaLabel="默认生图比例" value={ratio} disabled={locked} onChange={changeRatio} options={ratioOptions.map((option) => ({ value: option.ratio, label: `${option.ratio} · ${option.label}` }))} /></label>
            <label><span>清晰度</span><GlassSelect ariaLabel="默认生图清晰度" value={resolution} disabled={locked} onChange={changeResolution} options={resolutionOptions.map((option) => ({ value: option.resolution, label: option.resolution }))} /></label>
            <label><span>每批数量</span><GlassSelect ariaLabel="每批图片数量" value={String(imageCount)} disabled={locked} onChange={(value) => void save(() => onOutputChange(Number(value), imageQuality))} options={IMAGE_COUNT_OPTIONS.map((count) => ({ value: String(count), label: `${count} 张` }))} /></label>
            <label><span>质量</span><GlassSelect ariaLabel="生图质量" value={imageQuality} disabled={locked} onChange={(value) => void save(() => onOutputChange(imageCount, value as AppSettings["imageQuality"]))} options={compatibleQualities.map((option) => ({ value: option.value, label: option.label }))} /></label>
          </div>
          <p className="project-agent-image-config-summary">请求尺寸 {computedSizeFor(ratio, resolution)} · 手动默认 {defaultModel || "尚未选择"} · Agent 自动选择 {automaticModel || "尚未选择"}</p>
          <small>多个模型是可选池，每次按任务选择一个模型；Agent 自动优先 Image 2。此配置仅用于后续请求，画布缩放和界面文字不改变生成像素；成果详情保留文件实测尺寸。</small>
          {parameterIssue ? <p role="status" className="project-agent-model-error">{parameterIssue}</p> : null}
          {adjustment ? <p role="status">{adjustment}</p> : null}
          <div className="project-agent-image-config-heading"><strong>生图模型 <small>已启用 {activeModels.length} / {availableModels.length}</small></strong><ActionButton type="button" variant="secondary" disabled={loading} icon={loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} onClick={() => void refreshModels()}>刷新列表</ActionButton></div>
          <label className="project-agent-model-search"><Search size={13} /><input type="search" aria-label="搜索生图模型" placeholder="搜索模型" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 160))} /></label>
          <div className="project-agent-model-options" role="group" aria-label="上游生图模型">
            {filteredModels.map((model) => {
              const selected = activeModels.some((item) => item.toLowerCase() === model.toLowerCase());
              const isDefault = model.toLowerCase() === defaultModel.toLowerCase();
              const lastSelected = selected && activeModels.length === 1;
              return <div key={model.toLowerCase()} className={`project-agent-model-row${selected ? " active" : ""}${isDefault ? " is-default" : ""}${lastSelected ? " is-required" : ""}`}>
                <label className="project-agent-model-option" title={lastSelected ? "至少保留一个生图模型" : model}><input type="checkbox" aria-label={`启用生图模型：${model}`} checked={selected} disabled={locked || lastSelected} onChange={() => toggleModel(model)} /><span>{model}</span><small>{selected ? "已启用" : "未启用"}</small></label>
                <ButtonBase type="button" className={`project-agent-model-default${isDefault ? " is-default" : ""}`} disabled={locked} aria-pressed={isDefault} aria-label={isDefault ? `默认生图模型：${model}` : `设为默认生图模型：${model}`} title={isDefault ? "当前默认生图模型" : "设为默认并启用此模型"} onClick={(event) => { event.stopPropagation(); makeDefault(model); }}><Star size={14} aria-hidden="true" fill={isDefault ? "currentColor" : "none"} />{isDefault ? "默认" : "设默认"}</ButtonBase>
              </div>;
            })}
            {!filteredModels.length ? <p>没有匹配的模型</p> : null}
          </div>
          <small>勾选启用模型；星标设为默认并自动启用，默认模型置顶。至少保留一个。</small>
          {refreshError ? <p className="project-agent-model-error" role="status">刷新失败，已保留当前模型：{refreshError}</p> : null}
          <p className={saveError ? "project-agent-model-error" : "project-agent-image-config-summary"} role="status">{saveNotice}</p>
          {saveError ? <ActionButton onClick={() => { if (lastSave.current) void save(lastSave.current); }}>重试保存</ActionButton> : null}
        </SurfaceBody>
        <SurfaceFooter><ActionButton type="button" variant="primary" onClick={() => requestClose("action")}>完成</ActionButton></SurfaceFooter>
      </>}
    </DialogShell>
  );
}
