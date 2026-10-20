import type { WorkflowNode } from "./core";
import type { CreationRegionRevisionInput, CreationRevisionInput, CreationResponse, CreationTarget } from "./creation-session";

/** Ephemeral editor admission; requirements, masks and tasks remain Main-owned. */
export type CreationRegionRevisionDraft = {
  input: CreationRegionRevisionInput;
  submissionId: string;
  submitted?: { prompt: string; dataUrl: string; request: CreationRevisionInput };
  inflight?: { prompt: string; dataUrl: string; work: Promise<CreationResponse> };
};

export function locateCreationTarget(nodes: WorkflowNode[], target: CreationTarget) {
  for (const node of nodes) {
    const assetIndex = node.assets?.findIndex(asset => asset.assetId === target.assetId &&
      asset.occurrenceId === target.occurrenceId && asset.contentHash === target.contentHash) ?? -1;
    if (node.type === "image" && assetIndex >= 0) return { node, assetIndex, asset: node.assets![assetIndex] };
  }
  return null;
}

type RegionSubmission = {
  projectId: string; conversationId: string; prompt: string; dataUrl: string;
  saveMask: (input: { expectedProjectId: string; conversationId: string; target: CreationTarget; dataUrl: string }) => Promise<{ ok: boolean; error?: string; mask?: CreationTarget }>;
  execute: (request: CreationRevisionInput) => Promise<CreationResponse>;
};

export function submitCreationRegionRevision(draft: CreationRegionRevisionDraft, input: RegionSubmission): Promise<CreationResponse> {
  if (draft.inflight) {
    if (draft.inflight.prompt !== input.prompt || draft.inflight.dataUrl !== input.dataUrl) {
      return Promise.reject(new Error("原修改正在提交，请等待回执后再编辑。"));
    }
    return draft.inflight.work;
  }
  const work = submitOnce(draft, input);
  draft.inflight = { prompt: input.prompt, dataUrl: input.dataUrl, work };
  const clear = () => { if (draft.inflight?.work === work) delete draft.inflight; };
  void work.then(clear, clear);
  return work;
}

async function submitOnce(draft: CreationRegionRevisionDraft, input: RegionSubmission) {
  if (draft.input.expectedProjectId !== input.projectId || draft.input.conversationId !== input.conversationId) {
    throw new Error("项目或会话已切换，请重新选择修改成果。");
  }
  if (draft.submitted && (draft.submitted.prompt !== input.prompt || draft.submitted.dataUrl !== input.dataUrl)) {
    throw new Error("原提交内容已冻结。请查询原任务回执；另一次修改请重新打开编辑器。");
  }
  if (!draft.submitted) {
    const { assetId, occurrenceId, contentHash } = draft.input.target;
    const target = { assetId, occurrenceId, contentHash };
    const saved = await input.saveMask({ expectedProjectId: input.projectId, conversationId: input.conversationId, target, dataUrl: input.dataUrl });
    if (!saved.ok || !saved.mask) throw new Error(saved.error || "蒙版保存失败，尚未启动修改。");
    draft.submitted = { prompt: input.prompt, dataUrl: input.dataUrl, request: {
      expectedProjectId: input.projectId, conversationId: input.conversationId,
      requirementId: draft.input.requirementId, expectedRevision: draft.input.expectedRevision,
      submissionId: draft.submissionId, preserve: [...draft.input.preserve], changes: [],
      targets: [{ ...target, mask: saved.mask, preserve: [...(draft.input.target.preserve || [])], changes: [input.prompt] }]
    } };
  }
  const result = await input.execute(draft.submitted.request);
  if (!result.ok || !result.accepted) throw new Error(result.error || "修改未受理，请查询原提交回执。");
  return result;
}
