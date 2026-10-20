"use strict";
const { normalizeCreationTaskContract } = require("./creation-task-contract.mjs");
const { callCreationService } = require("./creation-tools.cjs");
// Native execution consumes this process-private marker separately from the
// successful image envelope. Symbols never enter JSON/DTOs or model messages.
const creationCheckUnrecorded = Symbol("creation-check-unrecorded");

const identity = asset => ({ assetId: asset?.assetId, occurrenceId: asset?.occurrenceId, contentHash: asset?.contentHash });
const sameTarget = (left, right) => ["assetId", "occurrenceId", "contentHash"].every(key => left?.[key] === right?.[key]);

// One checker belongs to one Runtime. Weak scope keys keep repeated deliveries
// idempotent without retaining completed projects or leaking state across runs.
function createSavedCreationActionChecker(service) {
  const scopes = new WeakMap();
  return async function checkSavedCreationActions(result, context = {}) {
    const scope = context.taskScope, ref = normalizeCreationTaskContract(scope?.creation);
    if (!ref || ref.revisionPlan && !context.creationRevisionChild) return result;
    const outputs = [];
    for (const action of result.actions || []) {
      const node = action.node;
      for (const [index, asset] of (node?.assets || []).entries()) {
        if (!asset?.assetId || !asset.occurrenceId || !/^[a-f0-9]{64}$/.test(asset.contentHash || "") || !asset.path && !asset.relativePath) continue;
        const members = node.imageCollection?.items || node.imageContainerSpec?.collection?.items || [];
        const member = members.find(item => item.occurrenceId === asset.occurrenceId && (!item.assetId || item.assetId === asset.assetId)) ||
          members.find(item => item.status === "done" && Number(item.assetIndex) === index + 1);
        const provenance = member?.taskProvenance || node.taskProvenance;
        outputs.push({ target: identity(asset), slotId: provenance?.creationSlotId });
      }
    }
    if (!outputs.length) return result;
    let checked = scopes.get(scope);
    if (!checked) { checked = new Map(); scopes.set(scope, checked); }
    const outcomes = [];
    for (const output of outputs) {
      const key = JSON.stringify([ref.requirementId, ref.revision, ref.fingerprint, output.target]);
      if (checked.has(key)) continue;
      const pending = (async () => {
        try {
          const response = await callCreationService(service, "check_results", {
            projectId: context.projectId, conversationId: context.conversationId, taskId: context.taskId, runId: context.runId,
            requirementId: ref.requirementId, expectedRequirementsRevision: ref.revision, target: output.target,
            ...(output.slotId ? { slotId: output.slotId } : {})
          });
          if (response?.ok === false) throw Error();
          const record = response?.results?.find(value => sameTarget(value.target, output.target));
          if (!["passed", "failed"].includes(record?.fileCheck?.status)) throw Error();
          return record.fileCheck.status;
        } catch { return "unrecorded"; }
      })();
      checked.set(key, pending);
      outcomes.push(await pending);
    }
    if (!outcomes.length) return result;
    const unrecorded = outcomes.includes("unrecorded");
    const summary = unrecorded
      ? "本地验收记录失败；生成的原结果已保留，请重试本地检查。AI 未检查。"
      : `本地文件检查已完成：通过 ${outcomes.filter(value => value === "passed").length} 项，未通过 ${outcomes.filter(value => value === "failed").length} 项。AI 未检查。`;
    // Acceptance persistence is separate from image delivery. Neither a hard
    // file-rule failure nor a failed record write may discard or regenerate it.
    try { context.progress?.({ phase: "creation-check", summary }); } catch {}
    const note = `${summary}\nThe original images are already saved. Do not repeat image_gen to fix a local check or acceptance-record failure. Retry creation(check_results) for the same targets instead. AI review requires view_image and a later successful model round, against the original requirements and this revision's preserve/changes.`;
    const envelope = result.envelope || {};
    return { ...result, ...(unrecorded ? { [creationCheckUnrecorded]: true } : {}), envelope: { ...envelope,
      modelOutput: Array.isArray(envelope.modelOutput)
        ? [...envelope.modelOutput, { type: "input_text", text: note }]
        : [envelope.modelOutput || envelope.visibleOutput || envelope.summary, note].filter(Boolean).join("\n")
    } };
  };
}

module.exports = { createSavedCreationActionChecker, creationCheckUnrecorded };
