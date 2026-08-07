import type { FormEvent } from "react";
import { Check, Microscope, Plus, Share2, Shield, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import {
  type ConfirmDialogDraft,
  type DeleteNodeDraft,
  type ImageQuotaDialogState,
  type ProjectNameDraft,
  type WorkflowNode,
  yuan
} from "./core";
import { ActionButton, ButtonBase, DialogShell, Field, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import { normalizeWorkspaceDomain, workspaceDomainDefinitions } from "./workspace-domain.ts";

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;

export function ProjectNameDialog({
  draft,
  setDraft,
  close,
  submit,
  busy
}: {
  draft: ProjectNameDraft;
  setDraft: (draft: ProjectNameDraft | null) => void;
  close: () => void;
  submit: () => void | Promise<void>;
  busy: boolean;
}) {
  const isRename = draft.mode === "rename";
  const isFolder = draft.mode === "create-folder";
  const title = isRename ? "重命名项目" : isFolder ? "新建项目文件夹" : "新建项目";
  const submitLabel = isRename ? "保存" : isFolder ? "选择文件夹并创建" : "创建";
  const selectedDomain = normalizeWorkspaceDomain(draft.workspaceDomain);
  const domainIcon = (icon: string) => icon === "shopping-bag"
    ? <ShoppingBag size={19} />
    : icon === "share-2"
      ? <Share2 size={19} />
      : icon === "microscope"
        ? <Microscope size={19} />
        : <Sparkles size={19} />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    await submit();
  }

  return (
    <DialogShell
      surface="project-name"
      ariaLabel={title}
      className={`project-create-dialog ${isRename ? "" : "has-workspace-domains"}`.trim()}
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={title}
            description={!isRename ? "选择初始工作台；四种模式仍共用同一张无限画布，可随时切换。" : undefined}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel={`关闭${title}`}
            closeDisabled={busy}
          />
          <SurfaceBody className="project-create-body">
            <form id="project-name-form" onSubmit={handleSubmit} className="project-create-form">
              <Field label="项目名称">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  autoFocus
                  maxLength={60}
                  placeholder="例如：产品主视觉"
                />
              </Field>
              {!isRename ? (
                <fieldset className="project-domain-fieldset">
                  <legend>初始工作台</legend>
                  <div className="project-domain-grid">
                    {workspaceDomainDefinitions.map((domain) => (
                      <ButtonBase
                        key={domain.id}
                        type="button"
                        className={`project-domain-card ${selectedDomain === domain.id ? "is-selected" : ""}`}
                        aria-pressed={selectedDomain === domain.id}
                        onClick={() => setDraft({ ...draft, workspaceDomain: domain.id })}
                      >
                        <span className="project-domain-card-icon" aria-hidden="true">{domainIcon(domain.icon)}</span>
                        <span>
                          <strong>{domain.title}</strong>
                          <small>{domain.description}</small>
                        </span>
                        {selectedDomain === domain.id ? <Check size={15} aria-hidden="true" /> : null}
                      </ButtonBase>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </form>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton variant="primary" type="submit" form="project-name-form" busy={busy} icon={<Plus size={16} />}>
              {submitLabel}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function QuotaDialog({
  quota,
  close,
  openAccount
}: {
  quota: ImageQuotaDialogState;
  close: () => void;
  openAccount: () => void;
}) {
  return (
    <DialogShell surface="quota" ariaLabel="余额不足" className="quota-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title="余额不足" onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody>
            <div className="quota-summary">
              <strong>本次生图需要支付 {yuan(quota.requiredCents)}，当前余额 {yuan(quota.balanceCents)}。</strong>
              <p>
                请求 {quota.requestedCount} 张，试用额度抵扣 {quota.trialImagesUsed} 张，剩余 {quota.paidImages} 张按 {yuan(quota.imageCostCents)} / 张计费。
              </p>
              <div>
                <span>还差</span>
                <em>{yuan(quota.deficitCents)}</em>
              </div>
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>知道了</ActionButton>
            <ActionButton variant="primary" onClick={openAccount} icon={<Shield size={16} />}>打开账户</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function DeleteNodeDialog({
  draft,
  node,
  close,
  deleteOnly,
  deleteBranch
}: {
  draft: DeleteNodeDraft;
  node: WorkflowNode | null;
  close: () => void;
  deleteOnly: () => void;
  deleteBranch: () => void;
}) {
  return (
    <DialogShell surface="delete-node" ariaLabel="删除成果确认" className="delete-node-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title="删除成果" onClose={() => requestClose(CLOSE_BUTTON_REASON)} />
          <SurfaceBody>
            <div className="delete-node-summary">
              <span className="node-dock-id">{draft.nodeId}</span>
              <div>
                <strong>{node?.title ?? "成果"}</strong>
                <p>
                  这个成果有 {draft.descendantCount} 个衍生结果。你可以只删除当前成果并保留衍生结果，也可以连同全部衍生结果一起删除。
                </p>
              </div>
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="secondary" onClick={deleteOnly}>只删除当前成果</ActionButton>
            <ActionButton variant="danger" onClick={deleteBranch}>删除全部衍生结果</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function ConfirmDialog({
  draft,
  busy,
  close,
  submit
}: {
  draft: ConfirmDialogDraft;
  busy: boolean;
  close: () => void;
  submit: () => void;
}) {
  return (
    <DialogShell
      surface="confirm"
      ariaLabel={draft.title}
      className={`confirm-dialog ${draft.tone === "danger" ? "danger" : ""}`}
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow={draft.eyebrow}
            title={draft.title}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeDisabled={busy}
          />
          <SurfaceBody>
            <div className="confirm-summary">
              <strong>{draft.message}</strong>
              {draft.detail ? <p>{draft.detail}</p> : null}
              {draft.tone === "danger" ? <small>此操作不可从 SparkAI WorkSpace 内恢复。</small> : null}
            </div>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant={draft.tone === "danger" ? "danger" : "primary"}
              onClick={submit}
              busy={busy}
              icon={draft.tone === "danger" ? <Trash2 size={16} /> : <Check size={16} />}
            >
              {draft.confirmLabel}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
