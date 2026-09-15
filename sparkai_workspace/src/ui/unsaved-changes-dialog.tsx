import type { ReactNode } from "react";

import { DialogShell, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./dialog-shell";
import { ActionButton } from "./primitives";

export type UnsavedChangesDialogProps = {
  surface: string;
  ariaLabel?: string;
  title: ReactNode;
  description?: ReactNode;
  detail?: ReactNode;
  busy?: boolean;
  onContinueEditing: () => void;
  onDiscard: () => void;
  discardLabel?: ReactNode;
  onSave?: () => void;
  saveLabel?: ReactNode;
  saveDisabled?: boolean;
};

/**
 * Shared nested prompt for a local draft that would otherwise be lost.
 *
 * Callers retain ownership of their draft and save semantics: record editors
 * can save and close, while transient tools can offer an explicit discard
 * decision only. The prompt itself never creates a second state store.
 */
export function UnsavedChangesDialog({
  surface,
  ariaLabel = "未保存修改",
  title,
  description,
  detail,
  busy = false,
  onContinueEditing,
  onDiscard,
  discardLabel = "放弃修改",
  onSave,
  saveLabel = "保存并关闭",
  saveDisabled = false
}: UnsavedChangesDialogProps) {
  return (
    <DialogShell
      surface={surface}
      ariaLabel={ariaLabel}
      layerLevel="nested"
      className="unsaved-changes-dialog"
      busy={busy}
      closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle", action: "when-idle" }}
      onRequestClose={onContinueEditing}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="未保存修改"
            title={title}
            description={description}
            onClose={() => requestClose("close-button")}
            closeLabel="继续编辑"
            closeDisabled={busy}
          />
          {detail ? <SurfaceBody className="unsaved-changes-body">{detail}</SurfaceBody> : null}
          <SurfaceFooter>
            <ActionButton onClick={onContinueEditing} disabled={busy}>继续编辑</ActionButton>
            <ActionButton variant="danger" onClick={onDiscard} disabled={busy}>{discardLabel}</ActionButton>
            {onSave ? (
              <ActionButton variant="primary" onClick={onSave} disabled={busy || saveDisabled}>
                {saveLabel}
              </ActionButton>
            ) : null}
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
