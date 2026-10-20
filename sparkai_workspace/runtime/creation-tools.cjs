"use strict";
const { normalizeCreationTaskContract } = require("./creation-task-contract.mjs");

const methods = { get_requirements: "getRequirements", update_requirements: "updateRequirements", get_acceptance: "getAcceptance", check_results: "checkResults", record_review: "recordReview", revise_results: "resolveRevision" };
const targetSchema = () => ({ type: "object", additionalProperties: false, properties: {
  assetId: { type: "string" }, occurrenceId: { type: "string" }, contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" }
}, required: ["assetId", "occurrenceId", "contentHash"] });
function creationToolSchema() {
  const textList = { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 2000 } };
  const revisionTarget = targetSchema();
  Object.assign(revisionTarget.properties, { preserve: textList, changes: textList });
  const attributedText = { type: "object", additionalProperties: false, properties: { text: { type: "string" }, source: { type: "string", enum: ["user", "assumption"] } }, required: ["text", "source"] };
  const criterion = { type: "object", additionalProperties: false, properties: {
    criterionId: { type: "string" }, text: { type: "string" }, source: { type: "string", enum: ["user", "assumption"] },
    kind: { type: "string", enum: ["visual", "source_consistency"] },
    sourceTargets: { type: "array", maxItems: 40, items: targetSchema(), description: "source_consistency 必须复制冻结素材的稳定身份；验收须实际看到全部这些来源的像素。" },
    slotIds: { type: "array", items: { type: "string" } }
  }, required: ["criterionId", "text", "source"] };
  return { type: "function", function: { name: "creation", description: "当前任务的版本化创作要求、结构化验收与定向修改。自然理解对话后记录目标、用途、输出槽位、保留项、可改项、验收条件；用户未明确的内容标为 assumption。通过 get_requirements 查询后用精确版本更新。record_review 只接受本run中 view_image 成功送入并由后续成功主模型回合消费的当前图片，不从文件名或口头描述判断。来源一致性条件必须同时消费已绑定来源像素。用户只改指定成果时使用 revise_results，targets复制精确资产身份并填写逐图preserve/changes；顶层列表适用于全部目标，共同changes为空时每个目标必须有自己的changes。该操作结束当前run，只有原任务成果成功保存后才由Main启动关联修订任务，再使用唯一image_gen；不得在当前run额外生图。", parameters: {
    type: "object", additionalProperties: false, properties: {
      operation: { type: "string", enum: Object.keys(methods) }, expectedRequirementsRevision: { type: "integer", minimum: 0 },
      requirements: { type: "object", additionalProperties: false, properties: {
        goal: attributedText, usage: attributedText,
        slots: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, properties: { slotId: { type: "string" }, label: { type: "string" }, source: { type: "string", enum: ["user", "assumption"] } }, required: ["slotId", "label", "source"] } },
        preserve: { type: "array", maxItems: 40, items: criterion }, adjustable: { type: "array", maxItems: 40, items: criterion }, conditions: { type: "array", maxItems: 40, items: criterion },
        fileRules: { type: "object", additionalProperties: false, properties: { formats: { type: "array", items: { type: "string", enum: ["png", "jpeg", "webp"] } }, minWidth: { type: "integer", minimum: 1 }, minHeight: { type: "integer", minimum: 1 }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, alpha: { type: "string", enum: ["any", "required", "forbidden"] } } }
      } },
      target: targetSchema(), slotId: { type: "string" }, verdict: { type: "string", enum: ["pass", "revise", "uncertain"] },
      targets: { type: "array", minItems: 1, maxItems: 200, items: revisionTarget }, preserve: textList, changes: textList,
      findings: { type: "array", minItems: 1, maxItems: 40, items: { type: "object", additionalProperties: false, properties: { criterionId: { type: "string" }, status: { type: "string", enum: ["pass", "fail", "uncertain"] }, note: { type: "string", maxLength: 600 } }, required: ["criterionId", "status", "note"] } },
      summary: { type: "string", maxLength: 600 }
    }, required: ["operation"]
  } } };
}

function requirementsFromResult(result) { return result?.requirements || result?.requirement || result; }
function refFromResult(result) {
  const ref = result?.requirementRef || requirementsFromResult(result);
  return normalizeCreationTaskContract(ref);
}
async function callCreationService(service, operation, payload) {
  if (typeof service === "function") return service({ operation, ...payload });
  const method = methods[operation];
  if (!method || typeof service?.[method] !== "function") throw new Error("当前任务的创作要求服务不可用。");
  return service[method](payload);
}

async function runCreationTool(args, context, { service, beforeRequirements, onRequirements, onRevision } = {}) {
  if (!methods[args.operation]) throw new Error("未知的创作要求操作。");
  if ("observationEvidence" in args || "proof" in args || "sourceObservations" in args) throw new Error("图片观察证据只能由 Runtime 在成功主模型回合后提供。");
  const base = { projectId: context.projectId, conversationId: context.conversationId, taskId: context.taskId, runId: context.runId };
  if (!base.projectId || !base.conversationId) throw new Error("创作要求必须绑定当前项目及会话。");
  const ref = normalizeCreationTaskContract(context.taskScope?.creation);
  const input = { ...base, ...(ref ? { requirementId: ref.requirementId } : {}) };
  if (args.expectedRequirementsRevision !== undefined) input.expectedRequirementsRevision = args.expectedRequirementsRevision;
  if (args.operation === "revise_results") {
    if (!ref || !base.taskId || args.expectedRequirementsRevision !== ref.revision || typeof onRevision !== "function") throw new Error("定向修改必须绑定当前任务及其精确要求版本。");
    // The facade adds these two identities for every tool; neither can replace
    // the trusted execution context or become part of the deferred payload.
    const allowed = new Set(["operation", "expectedRequirementsRevision", "targets", "preserve", "changes", "projectId", "conversationId"]);
    if (Object.keys(args).some(key => !allowed.has(key)) || args.projectId && args.projectId !== base.projectId || args.conversationId && args.conversationId !== base.conversationId) throw new Error("定向修改只接受明确目标、保留项和修改项，不能覆盖图片配置或执行身份。");
    const list = value => {
      if (!Array.isArray(value) || value.length > 200 || value.some(text => typeof text !== "string" || !text.trim() || text.length > 2000)) throw new Error("定向修改的保留项和修改项必须是有界的非空文本列表。");
      return value.map(text => text.trim());
    };
    const preserve = list(args.preserve || []), changes = list(args.changes || []);
    if (!Array.isArray(args.targets) || !args.targets.length || args.targets.length > 200) throw new Error("定向修改需要明确的成果目标。");
    const available = [...(context.nodes || []).flatMap(node => node.assets || []), ...(context.pendingActions || []).flatMap(action => action.node?.assets || [])];
    const seen = new Set();
    const targets = args.targets.map(value => {
      if (!value || Object.keys(value).some(key => !["assetId", "occurrenceId", "contentHash", "preserve", "changes"].includes(key)) ||
        ![value.assetId, value.occurrenceId].every(id => typeof id === "string" && id.length > 0 && id.length <= 180) || !/^[a-f0-9]{64}$/.test(value.contentHash || "")) throw new Error("定向修改目标需要完整稳定资产身份。");
      const identity = { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash };
      const key = JSON.stringify(identity);
      if (seen.has(key) || !available.some(asset => Object.keys(identity).every(field => asset[field] === identity[field]))) throw new Error("定向修改目标不在当前成果或本轮已保存输出中，或目标重复。");
      seen.add(key);
      const targetPreserve = list(value.preserve || []), targetChanges = list(value.changes || []);
      if (!changes.length && !targetChanges.length) throw new Error("请明确每个定向修改目标本次需要改变的部分。");
      return { ...identity, ...(targetPreserve.length ? { preserve: targetPreserve } : {}), ...(targetChanges.length ? { changes: targetChanges } : {}) };
    });
    await onRevision({ input: { expectedProjectId: base.projectId, conversationId: base.conversationId, submissionId: `${base.taskId}-revision`,
      requirementId: ref.requirementId, expectedRevision: ref.revision, targets, preserve, changes }, parentTaskId: base.taskId });
    return { ok: true, deferred: true, summary: `已准备 ${targets.length} 个指定成果的修改；原任务成功保存后启动关联修订。`, targets };
  }
  if (args.operation === "update_requirements") {
    if (context.taskScope?.creation?.revisionPlan) throw new Error("定向修订的要求版本已经冻结，请另开新修订更新要求。");
    if (!args.requirements || !Number.isSafeInteger(args.expectedRequirementsRevision)) throw new Error("更新创作要求必须提供完整要求及精确版本。");
    input.requirements = args.requirements;
    await beforeRequirements?.({ ...base, previousRef: ref });
  } else if (args.operation === "record_review") {
    if (!ref || args.expectedRequirementsRevision !== ref.revision) throw new Error("验收要求版本与当前任务合同不一致，请读取最新要求。");
    const fetched = await callCreationService(service, "get_requirements", input);
    const current = refFromResult(fetched);
    if (!current || current.requirementId !== ref.requirementId || current.revision !== ref.revision || current.fingerprint !== ref.fingerprint) throw new Error("创作要求已更新，本轮旧观察不能用于当前验收。");
    const requirements = requirementsFromResult(fetched);
    const criteria = [...(requirements?.preserve || []), ...(requirements?.conditions || []), ...(requirements?.adjustable || [])];
    const sourceTargets = [];
    for (const finding of Array.isArray(args.findings) ? args.findings : []) {
      const criterion = criteria.find(entry => entry.criterionId === finding.criterionId);
      if (!criterion) throw new Error("验收条件不存在于当前要求版本。");
      if (criterion.kind === "source_consistency") {
        if (!Array.isArray(criterion.sourceTargets) || !criterion.sourceTargets.length) throw new Error("来源一致性条件尚未绑定冻结来源。");
        sourceTargets.push(...criterion.sourceTargets);
      }
    }
    if (!context.observationLedger) throw new Error("验收必须由实际主 Agent run 提交；直接工具或CLI不能提供观察证明。");
    Object.assign(input, { target: args.target, slotId: args.slotId, verdict: args.verdict, findings: args.findings, summary: args.summary,
      observationEvidence: context.observationLedger.proofFor({ target: args.target, requirementId: ref.requirementId, expectedRequirementsRevision: ref.revision, sourceTargets }) });
  } else if (args.target) input.target = args.target;
  const result = await callCreationService(service, args.operation, input);
  if (result?.ok === false) throw new Error(result.error || result.message || "创作要求操作未完成。");
  if (args.operation === "update_requirements") {
    const requirementRef = refFromResult(result);
    if (!requirementRef) throw new Error("创作要求服务没有返回有效版本。");
    await onRequirements?.({ ...base, previousRef: ref, requirementRef });
  }
  return result;
}

function creationSlotsForImage(args, requirements) {
  const slots = requirements?.slots || [], count = Number(args.count || 1), items = args.batchItems || args.items || [];
  if (!slots.length) throw new Error("当前创作要求没有输出槽位。");
  const ids = slots.map(slot => slot.slotId);
  return Array.from({ length: count }, (_, index) => {
    const slotId = items[index]?.creationSlotId || args.creationSlotId || (slots.length === 1 ? ids[0] : slots.length === count ? ids[index] : "");
    if (!ids.includes(slotId)) throw new Error("图片执行必须关联当前创作要求的明确输出槽位。");
    return slotId;
  });
}

module.exports = { creationToolSchema, callCreationService, refFromResult, requirementsFromResult, runCreationTool, creationSlotsForImage };
