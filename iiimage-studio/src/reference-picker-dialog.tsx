import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";

import {
  imageAssetSrc,
  mergeReferenceImages,
  type ReferencePickerDraft
} from "./core";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  IconActionButton,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export function ReferencePickerDialog({ draft, setDraft, projectId, close, save }: {
  draft: ReferencePickerDraft;
  setDraft: Dispatch<SetStateAction<ReferencePickerDraft | null>>;
  projectId: string;
  close: () => void;
  save: () => void;
}) {
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 9;
  const pageCount = Math.max(1, Math.ceil(draft.max / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const pageStart = visiblePage * pageSize;
  const pageSlots = Math.min(pageSize, draft.max - pageStart);
  const itemLabel = draft.target.kind === "agent-source" || (
    draft.target.kind === "agent-request" && draft.target.role === "source"
  ) ? "原图" : "参考图";
  const remaining = Math.max(0, draft.max - draft.images.length);

  async function addImages() {
    if (remaining <= 0) return;
    const result = await window.iiimageConfig?.pickReferenceImages?.({ max: remaining, projectId, title: `选择${itemLabel}` });
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

  return (
    <DialogShell
      surface="reference-picker"
      ariaLabel={draft.title}
      layerClassName="reference-picker-layer"
      className="reference-picker-dialog"
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader title={draft.title} description={draft.detail} onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody className="reference-picker-body">
            <div className="reference-grid">
              {Array.from({ length: pageSlots }, (_item, offset) => {
                const index = pageStart + offset;
                const image = draft.images[index];
                return image ? (
                  <figure key={image.occurrenceId || `${image.path}:${index}`} className="reference-slot filled">
                    <img src={image.assetUrl || imageAssetSrc({ type: "file", path: image.path })} alt={image.name} loading="lazy" decoding="async" />
                    <figcaption>{image.name}</figcaption>
                    <IconActionButton className="reference-slot-remove" label={`移除${itemLabel}`} onClick={() => removeImage(index)} icon={<X size={14} />} />
                  </figure>
                ) : (
                  <ButtonBase key={`empty-${index}`} className="ui-choice-row reference-slot empty" type="button" onClick={addImages} aria-label={`添加${itemLabel}`}><Plus size={26} /></ButtonBase>
                );
              })}
            </div>
            <div className="reference-picker-status">
              <span>{draft.images.length}/{draft.max} 张{itemLabel}</span>
              {pageCount > 1 ? (
                <span className="reference-picker-pages">
                  <IconActionButton label="上一页" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={visiblePage === 0} icon={<span aria-hidden="true">‹</span>} />
                  <strong>{visiblePage + 1}/{pageCount}</strong>
                  <IconActionButton label="下一页" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={visiblePage >= pageCount - 1} icon={<span aria-hidden="true">›</span>} />
                </span>
              ) : null}
              {message ? <em>{message}</em> : null}
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={save}>保存</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
