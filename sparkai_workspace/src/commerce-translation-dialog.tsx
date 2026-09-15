import CommerceSetDialog from "./commerce-set-dialog";

// Backward-compatible adapter for the existing plugin command. The full
// CommerceSetDialog also supports generated sets and Requirement/Skill
// persistence, while this legacy entry keeps the current translation-only
// submit contract until the shared command runtime is wired by the host.
export default function CommerceTranslationDialog({ sourceCount, sourceLabel, executionBusy, close, submit }: {
  sourceCount: number;
  sourceLabel: string;
  executionBusy?: boolean;
  close: () => void;
  submit: (payload: { languageCodes: string[] }) => void;
}) {
  return (
    <CommerceSetDialog
      sourceCount={sourceCount}
      sourceLabel={sourceLabel}
      executionBusy={executionBusy}
      initialMode="translate"
      allowModeSwitch={false}
      allowPersistence={false}
      close={close}
      submit={(payload) => submit({ languageCodes: payload.languageCodes })}
    />
  );
}

export { CommerceSetDialog };
export type { CommerceSetDialogProps, CommerceSetDialogSubmitPayload } from "./commerce-set-dialog";
