import { useState } from "react";
import { Image as ImageIcon, Send, Workflow } from "lucide-react";
import {
  ActionButton,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog,
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;

export default function RequirementEditorDialog({
  mode,
  title,
  text,
  error,
  dirty,
  agentExecutionBusy,
  requirementCode,
  sourceCount,
  referenceCount,
  close,
  changeTitle,
  changeText,
  save,
}: {
  mode: "create" | "edit";
  title: string;
  text: string;
  error?: string;
  dirty: boolean;
  agentExecutionBusy: boolean;
  requirementCode: string;
  sourceCount: number;
  referenceCount: number;
  close: () => void;
  changeTitle: (value: string) => void;
  changeText: (value: string) => void;
  save: (runAfterSave: boolean) => boolean;
}) {
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const hasInputs = sourceCount + referenceCount > 0;

  function requestEditorClose() {
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  return (
    <>
      <DialogShell
        surface="requirement-editor"
        ariaLabel={mode === "create" ? "创建图片处理需求" : "编辑图片处理需求"}
        layerClassName="requirement-editor-layer"
        className="requirement-editor-dialog"
        dirty={dirty}
        closePolicy={{ escape: "always", backdrop: "always", [CLOSE_BUTTON_REASON]: "always", action: "always" }}
        onRequestClose={requestEditorClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader
            title={mode === "create" ? "创建可复用需求" : "编辑可复用需求"}
            description="原图、参考图、需求与成果保持连线；无素材时可先创建纯文生图需求。"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
          />
          <SurfaceBody className="requirement-editor-body">
            <div className="requirement-relation-preview" aria-label="来源到需求再到成果">
              <span className={hasInputs ? "ready" : "missing"}>
                <ImageIcon size={15} />
                <small>输入素材</small>
                <strong>{hasInputs ? `原图 ${sourceCount} · 参考 ${referenceCount}` : "纯文需求"}</strong>
              </span>
              <i aria-hidden="true">→</i>
              <span className="active"><Workflow size={15} /><small>需求</small><strong>{requirementCode}</strong></span>
              <i aria-hidden="true">→</i>
              <span><ImageIcon size={15} /><small>成果</small><strong>自动归档</strong></span>
            </div>
            <Field className="requirement-title-field" label="需求名称">
              <input
                value={title}
                maxLength={120}
                onChange={(event) => changeTitle(event.target.value)}
                placeholder="例如：跨境电商多语言海报"
              />
            </Field>
            <Field className="requirement-text-field" label="给 Agent 的要求" hint={`${text.length.toLocaleString()}/24,000`}>
              <textarea
                autoFocus
                value={text}
                maxLength={24000}
                onChange={(event) => changeText(event.target.value)}
                placeholder="描述要修改什么、哪些内容必须保持不变、希望得到多少方案；Agent 会自行理解并调用合适的图片工具。"
              />
            </Field>
            {error ? <InlineNotice className="requirement-editor-error" tone="danger">{error}</InlineNotice> : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton variant="ghost" onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="secondary" onClick={() => { save(false); }}>
              {mode === "create" ? "仅创建" : "保存"}
            </ActionButton>
            <ActionButton variant="primary" onClick={() => { save(true); }} disabled={agentExecutionBusy} icon={<Send size={14} />}>
              {mode === "create" ? "创建并执行" : "保存并执行"}
            </ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="requirement-editor-unsaved"
          ariaLabel={mode === "create" ? "保存新需求" : "保存需求修改"}
          title={mode === "create" ? "关闭前要创建这条需求吗？" : "关闭前要保存需求修改吗？"}
          description="需求名称或正文还有未保存的修改。"
          detail={<p>保存后会保留在当前画布，但不会自动执行；放弃只丢弃本次编辑。</p>}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={close}
          onSave={() => {
            if (!save(false)) setClosePromptOpen(false);
          }}
          saveLabel={mode === "create" ? "创建并关闭" : "保存并关闭"}
          saveDisabled={!text.trim()}
        />
      ) : null}
    </>
  );
}
