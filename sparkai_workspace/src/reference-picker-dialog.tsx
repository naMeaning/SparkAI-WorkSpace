import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ImageIcon, Import, Plus, X } from "lucide-react";

import {
  imageAssetSrc,
  mergeReferenceImages,
  type ReferencePickerDraft
} from "./core";
import { sameComposerImage, type ComposerMaterialItem } from "./selection-reference-images";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  IconActionButton,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export function ReferencePickerDialog({ draft, setDraft, projectId, canvasMaterials, close, save }: {
  draft: ReferencePickerDraft;
  setDraft: Dispatch<SetStateAction<ReferencePickerDraft | null>>;
  projectId: string;
  canvasMaterials: ComposerMaterialItem[];
  close: () => void;
  save: () => void;
}) {
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasPage, setCanvasPage] = useState(0);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const imageSignature = (images: ReferencePickerDraft["images"]) => images.map((image) => (
    `${image.occurrenceId || image.assetId || image.path}|${image.canvasNodeId || ""}|${image.canvasAssetIndex ?? ""}`
  )).join("\n");
  const initialImagesRef = useRef(imageSignature(draft.images));
  const pageSize = 9;
  const pageCount = Math.max(1, Math.ceil(draft.max / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const pageStart = visiblePage * pageSize;
  const pageSlots = Math.min(pageSize, draft.max - pageStart);
  const itemLabel = draft.target.kind === "agent-source" || (
    draft.target.kind === "agent-request" && draft.target.role === "source"
  ) ? "原图" : "参考图";
  const remaining = Math.max(0, draft.max - draft.images.length);
  const dirty = imageSignature(draft.images) !== initialImagesRef.current;
  const canvasPageCount = Math.max(1, Math.ceil(canvasMaterials.length / pageSize));
  const visibleCanvasPage = Math.min(canvasPage, canvasPageCount - 1);

  function toggleCanvasImage(item: ComposerMaterialItem) {
    const selected = draft.images.some((image) => sameComposerImage(image, item.reference));
    if (!selected && remaining <= 0) {
      setMessage(`最多添加 ${draft.max} 张${itemLabel}。`);
      return;
    }
    setDraft((current) => current ? {
      ...current,
      images: selected
        ? current.images.filter((image) => !sameComposerImage(image, item.reference))
        : mergeReferenceImages(current.images, [{ ...item.reference, taskRole: itemLabel === "原图" ? "source" : "reference", role: itemLabel === "原图" ? "source" : "reference" }], current.max)
    } : current);
    setMessage(selected ? "已取消选取。" : `已加入${itemLabel}，保存后生效。`);
  }

  async function addImages() {
    if (remaining <= 0) return;
    const result = await window.naimageConfig?.pickReferenceImages?.({ max: remaining, projectId, title: `选择${itemLabel}` });
    if (!result?.ok || result.canceled) {
      if (result && !result.ok) setMessage(result.error ?? `${itemLabel}选择失败。`);
      return;
    }
    const incoming = result.images ?? (result.image ? [result.image] : []);
    setDraft((current) => current ? { ...current, images: mergeReferenceImages(current.images, incoming, current.max) } : current);
    if (incoming.length) setPage(Math.min(pageCount - 1, Math.floor(draft.images.length / pageSize)));
    setMessage(result.truncated ? `已添加到上限 ${draft.max} 张。` : incoming.length ? `已添加 ${incoming.length} 张。` : "");
  }

  function removeImage(imageIndex: number) {
    setDraft((current) => current ? { ...current, images: current.images.filter((_image, index) => index !== imageIndex) } : current);
    setMessage("");
  }

  function requestPickerClose() {
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  return (
    <>
      <DialogShell
        surface="reference-picker"
        ariaLabel={draft.title}
        layerClassName="reference-picker-layer"
        className="reference-picker-dialog"
        dirty={dirty}
        closePolicy={{ escape: "always", backdrop: "always", [CLOSE_BUTTON_REASON]: "always", action: "always" }}
        onRequestClose={requestPickerClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader title={draft.title} description={draft.detail} onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody className="reference-picker-body">
            <div className="reference-picker-sources" role="group" aria-label="素材来源">
              <ActionButton icon={<Import size={14} />} onClick={() => void addImages()} disabled={remaining <= 0}>本地文件</ActionButton>
              <ActionButton icon={<ImageIcon size={14} />} aria-pressed={canvasOpen} onClick={() => { setCanvasOpen((current) => !current); setMessage(""); }}>
                {canvasOpen ? "返回素材列表" : "从画布选取"}
              </ActionButton>
            </div>
            {canvasOpen ? (
              <>
                <p className="reference-canvas-hint">点击图片加入{itemLabel}，再次点击取消选取。</p>
                <div className="reference-grid reference-canvas-grid" aria-label="画布图片">
                  {canvasMaterials.slice(visibleCanvasPage * pageSize, (visibleCanvasPage + 1) * pageSize).map((item) => {
                    const selected = draft.images.some((image) => sameComposerImage(image, item.reference));
                    return (
                      <ButtonBase
                        key={item.key}
                        type="button"
                        className="reference-slot canvas-material-option"
                        aria-label={`选取 ${item.name}`}
                        aria-pressed={selected}
                        data-canvas-node-id={item.nodeId}
                        data-canvas-asset-index={item.assetIndex}
                        disabled={!selected && remaining <= 0}
                        title={item.name}
                        onClick={() => toggleCanvasImage(item)}
                      >
                        <img src={item.reference.assetUrl || imageAssetSrc({ type: "file", path: item.reference.path })} alt={item.name} loading="lazy" decoding="async" />
                        <span className="canvas-material-name">{item.name}</span>
                        {selected ? <span className="canvas-material-check"><Check size={16} /></span> : null}
                      </ButtonBase>
                    );
                  })}
                  {!canvasMaterials.length ? <p className="reference-canvas-empty">当前画布没有可用图片。</p> : null}
                </div>
              </>
            ) : (
            <div className="reference-grid">
              {Array.from({ length: pageSlots }, (_item, offset) => {
                const index = pageStart + offset;
                const image = draft.images[index];
                return image ? (
                  <figure key={image.occurrenceId || `${image.path}:${index}`} className="reference-slot filled">
                    <img src={image.assetUrl || imageAssetSrc({ type: "file", path: image.path })} alt={image.name} loading="lazy" decoding="async" />
                    <figcaption title={image.name}>{image.name}</figcaption>
                    <IconActionButton className="reference-slot-remove" label={`移除${itemLabel}`} onClick={() => removeImage(index)} icon={<X size={14} />} />
                  </figure>
                ) : (
                  <ButtonBase key={`empty-${index}`} className="ui-choice-row reference-slot empty" type="button" onClick={addImages} aria-label={`添加${itemLabel}`}><Plus size={26} /></ButtonBase>
                );
              })}
            </div>
            )}
            <div className="reference-picker-status">
              <span>{draft.images.length}/{draft.max} 张{itemLabel}</span>
              {(canvasOpen ? canvasPageCount : pageCount) > 1 ? (
                <span className="reference-picker-pages">
                  <IconActionButton label="上一页" onClick={() => canvasOpen ? setCanvasPage((current) => Math.max(0, current - 1)) : setPage((current) => Math.max(0, current - 1))} disabled={(canvasOpen ? visibleCanvasPage : visiblePage) === 0} icon={<span aria-hidden="true">‹</span>} />
                  <strong>{(canvasOpen ? visibleCanvasPage : visiblePage) + 1}/{canvasOpen ? canvasPageCount : pageCount}</strong>
                  <IconActionButton label="下一页" onClick={() => canvasOpen ? setCanvasPage((current) => Math.min(canvasPageCount - 1, current + 1)) : setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={canvasOpen ? visibleCanvasPage >= canvasPageCount - 1 : visiblePage >= pageCount - 1} icon={<span aria-hidden="true">›</span>} />
                </span>
              ) : null}
            </div>
            {message ? <p className="reference-picker-message" role="status">{message}</p> : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={save}>保存</ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="reference-picker-unsaved"
          ariaLabel={`保存${itemLabel}修改`}
          title={`关闭前要保存${itemLabel}修改吗？`}
          description={`当前${itemLabel}列表与打开时不同。`}
          detail={<p>保存会把当前列表应用到 Agent 输入；放弃不会删除项目素材或画布成果。</p>}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={close}
          onSave={save}
        />
      ) : null}
    </>
  );
}
