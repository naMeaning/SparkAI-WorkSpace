import { useState } from "react";
import { Send } from "lucide-react";

import type { AskUserDraft } from "./core";
import { ActionButton, ButtonBase, DialogShell, Field, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export default function AskUserDialog({
  draft,
  close,
  submit,
}: {
  draft: AskUserDraft;
  close: () => void;
  submit: (answer: string, selectedOptionId?: string) => void;
}) {
  const options = Array.isArray(draft.options) ? draft.options.slice(0, 3) : [];
  const [answer, setAnswer] = useState(draft.suggestedAnswer ?? "");
  const [selectedOptionId, setSelectedOptionId] = useState(() => options.find((option) => option.answer === draft.suggestedAnswer)?.id || "");
  return (
    <DialogShell surface="ask-user" ariaLabel={draft.title} layerClassName="ask-user-layer" className="ask-user-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title={draft.title} onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody className={`ask-user-body${options.length ? " has-options" : ""}`}>
            <div className="ask-user-copy"><strong>{draft.question}</strong>{draft.detail ? <p>{draft.detail}</p> : null}</div>
            {options.length ? (
              <div className="ask-user-options" role="radiogroup" aria-label="可选方案">
                {options.map((option) => (
                  <ButtonBase
                    key={option.id}
                    type="button"
                    className={`ui-choice-row ask-user-option${selectedOptionId === option.id ? " current" : ""}`}
                    role="radio"
                    aria-checked={selectedOptionId === option.id}
                    onClick={() => {
                      setSelectedOptionId(option.id);
                      setAnswer(option.answer);
                    }}
                  >
                    <span className="ask-user-option-title">
                      <strong>{option.label}</strong>
                      {option.recommended ? <em>建议</em> : null}
                    </span>
                    {option.description ? <small>{option.description}</small> : null}
                  </ButtonBase>
                ))}
              </div>
            ) : null}
            <Field className="ask-user-answer-field" label={options.length ? "补充或自定义回复" : "回复"}>
              <textarea
                value={answer}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  if (options.every((option) => option.answer !== event.target.value)) setSelectedOptionId("");
                }}
                rows={options.length ? 3 : 5}
                autoFocus={!options.length}
              />
            </Field>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={() => submit(answer.trim(), selectedOptionId || undefined)} disabled={!answer.trim()} icon={<Send size={16} />}>
              发送给 Agent
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
