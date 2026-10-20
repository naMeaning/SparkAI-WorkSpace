"use strict";

const { validateSchemaValue, redactText } = require("./debug-command-service.cjs");
const definitions = new Map(require("../integrations/naimage-control/references/commands.schema.json").sections.flatMap(section => section.commands).map(command => [command.name, command]));
const COMMANDS = ["creation.requirements.get", "creation.requirements.update", "creation.acceptance.get", "creation.acceptance.check", "creation.acceptance.decide", "creation.revision.start"];

/** Public adapters share the Main project owner; they never accept observation proofs. */
function createCreationCommandService({ creationService, taskService, maskService }) {
  const revisions = new Map();
  function enqueueRevision(input, operation) {
    const key = JSON.stringify([input.expectedProjectId, input.conversationId]);
    const work = (revisions.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    revisions.set(key, work);
    void work.finally(() => { if (revisions.get(key) === work) revisions.delete(key); }).catch(() => {});
    return work;
  }
  async function execute(command, input = {}) {
    if (!COMMANDS.includes(command)) throw Object.assign(new Error("不支持的创作操作。"), { code: "CREATION_COMMAND_UNKNOWN" });
    // IPC structured clone retains undefined optionals; public HTTP JSON does
    // not. Validate the same JSON contract for both adapters.
    input = JSON.parse(JSON.stringify(input));
    validateSchemaValue(command, definitions.get(command)?.parameters, input);
    const args = { ...input, projectId: input.expectedProjectId };
    if (command === "creation.requirements.get") return creationService.getRequirements(args);
    if (command === "creation.requirements.update") return creationService.updateRequirements(args);
    if (command === "creation.acceptance.get") return creationService.getAcceptance(args);
    if (command === "creation.acceptance.check") return creationService.checkResults(args);
    if (command === "creation.acceptance.decide") return creationService.decideResult(args);
    return enqueueRevision(input, async () => {
      const available = taskService.assertStartAvailable(input);
      if (available.duplicate && !available.revisionId) throw Object.assign(new Error("同一提交身份已用于其他任务，未改变创作要求。"), { code: "TASK_SUBMISSION_CONFLICT" });
      // A durable duplicate must reach its original receipt even if the target
      // or old references have since moved or changed. It never dispatches.
      const context = available.duplicate ? null : taskService.revisionContext(args);
      const masked = input.targets.some(target => target.mask !== undefined);
      if (!available.duplicate && masked && !maskService?.freeze) throw Object.assign(new Error("当前运行时无法冻结区域修改蒙版，尚未执行修改。"), { code: "CREATION_MASK_UNAVAILABLE" });
      const maskAssets = !available.duplicate && masked ? maskService.freeze(args) : [];
      const revision = creationService.resolveRevision(args);
      const creation = { ...revision.requirementRef, revisionPlan: { ...revision.plan, targets: revision.targets } };
      const prompt = ["仅为这次明确选择的成果生成新版本，每个目标一张；保留全部原图和非目标成果。",
        `保留要求：${revision.plan.preserve.join("；") || "沿用原创作要求"}`,
        `共同修改要求：${revision.plan.changes.join("；") || "使用下列逐目标要求"}`,
        ...revision.targets.map(target => `${target.label || target.slotId || "所选成果"}：${(target.changes || []).join("；")}`)].join("\n");
      return taskService.startInternal({ expectedProjectId: input.expectedProjectId, conversationId: input.conversationId,
        submissionId: input.submissionId, prompt, title: `定向修改 ${revision.targets.length} 张成果`,
        sourceNodeIds: revision.sourceNodeIds, requirementId: revision.requirementRef.requirementId, creation,
        ...(context ? context : {}), ...(maskAssets.length ? { maskAssets } : {}) });
    });
  }
  async function invoke(command, input) {
    try { return { ok: true, ...await execute(command, input) }; }
    catch (error) { return { ok: false, errorCode: error?.code || "CREATION_FAILED", error: redactText(error?.message || "创作记录操作失败。")
      .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]").replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]") }; }
  }
  return { commands: COMMANDS, execute, invoke };
}

module.exports = { createCreationCommandService, CREATION_COMMANDS: COMMANDS };
