"use strict";
const path = require("node:path");
const { createHash } = require("node:crypto");
const { normalizeCreationTaskContract, normalizeCreationMaskAssets } = require("./creation-task-contract.mjs");
const { callCreationService, requirementsFromResult } = require("./creation-tools.cjs");
const { readRuntimeImageFile, viewImagePathAllowed } = require("./view-image-payload.cjs");
let sharpImage;
try { sharpImage = require("sharp"); } catch { sharpImage = null; }

const sameTarget = (asset, target) => asset?.assetId === target.assetId && asset?.occurrenceId === target.occurrenceId && asset?.contentHash === target.contentHash;
function creationRevisionJobs(args, context = {}, requirements) {
  const creation = normalizeCreationTaskContract(context.taskScope?.creation), plan = creation?.revisionPlan;
  if (!plan?.revisionId || !plan.targets.length || plan.targets.some(target => !plan.changes.length && !target.changes?.length)) throw new Error("定向修订缺少冻结目标或修改要求。");
  const requirementRef = normalizeCreationTaskContract(requirements);
  if (!requirementRef || ["requirementId", "revision", "fingerprint"].some(key => requirementRef[key] !== creation[key])) throw new Error("定向修订的完整创作要求与冻结版本不一致，图片未派发。");
  const maskedTargets = plan.targets.filter(target => target.mask), maskAssets = normalizeCreationMaskAssets(context.taskScope.maskAssets);
  if (maskedTargets.length && (plan.targets.length !== 1 || maskAssets.length !== 1)) throw new Error("精确区域修改只能绑定一个目标及其唯一受管蒙版。");
  if (!maskedTargets.length && maskAssets.length) throw new Error("定向修订包含未绑定目标的蒙版，图片未派发。");
  if (!(maskedTargets.length ? ["edit", "replace", "redraw"] : ["edit", "replace"]).includes(args.operation)) throw new Error("定向修订只允许 image_gen edit/replace；受管蒙版任务由 Runtime 执行 redraw。");
  const allowedKeys = new Set(["operation", "prompt", "count", "brief", "model", "ratio", "resolution", "quality", "outputFormat", "projectId", "conversationId"]);
  if (Object.keys(args).some(key => !allowedKeys.has(key))) throw new Error("定向修订不能添加冻结范围外的图片参数。");
  if (args.count !== undefined && args.count !== plan.targets.length) throw new Error("定向修订张数必须精确等于冻结目标数量。");
  for (const key of ["items", "batchItems", "parentId", "sourceBindingId", "sourceAssetId", "sourceImage", "editImage", "assetIndex", "referenceImages", "scopeExecution", "maskImage", "maskDataUrl"]) {
    if (args[key] !== undefined && args[key] !== null) throw new Error(`定向修订的 ${key} 由原任务冻结范围确定。`);
  }
  const configuration = context.taskScope.imageConfig;
  if (!configuration) throw new Error("定向修订缺少原图片配置快照。");
  for (const [field, frozen] of Object.entries({ model: configuration.model, ratio: configuration.ratio, resolution: configuration.resolution, quality: configuration.quality, outputFormat: configuration.outputFormat })) {
    if (args[field] !== undefined && args[field] !== frozen) throw new Error(`定向修订不能覆盖原 ${field} 配置。`);
  }
  if (args.size !== undefined || args.background !== undefined || args.inputFidelity !== undefined) throw new Error("定向修订不能覆盖原图片配置。");
  const materials = context.taskScope.materials?.length ? context.taskScope.materials : context.taskScope.sourceAssets || [];
  const seen = new Set();
  const texts = values => [...new Set(values.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))];
  const applicable = (criteria, slotId) => (criteria || []).filter(criterion => !criterion.slotIds?.length || criterion.slotIds.includes(slotId)).map(criterion => criterion.text);
  return plan.targets.map((target, index) => {
    if (!target.assetId || !target.occurrenceId || !/^[a-f0-9]{64}$/.test(target.contentHash) || !target.nodeId) throw new Error("定向修订目标需要完整稳定资产身份。");
    const identityKey = `${target.assetId}:${target.occurrenceId}:${target.contentHash}`;
    if (seen.has(identityKey)) throw new Error("定向修订重复引用同一目标。");
    seen.add(identityKey);
    const matches = materials.filter(asset => sameTarget(asset, target) && asset.nodeId === target.nodeId);
    if (matches.length !== 1) throw new Error("定向修订目标不属于原任务冻结素材，或出现身份不唯一。");
    const source = matches[0];
    if (target.mask && (!target.mask.assetId || !target.mask.occurrenceId || !/^[a-f0-9]{64}$/.test(target.mask.contentHash) ||
      !sameTarget(maskAssets[0], target.mask) || !sameTarget(maskAssets[0].target, target))) throw new Error("区域修改蒙版与冻结目标不一致，图片未派发。");
    const node = (context.nodes || []).find(candidate => candidate.id === target.nodeId);
    const currentSlots = (node?.assets || []).flatMap((asset, slot) => sameTarget(asset, target) ? [slot] : []);
    if (currentSlots.length !== 1) throw new Error("定向修订目标已经移除、替换或变更，未派发图片请求。");
    const frozenSlot = source.ownerAssetIndex ?? source.assetIndex ?? source.containerSlot;
    if (frozenSlot !== undefined && Number(frozenSlot) !== currentSlots[0]) throw new Error("定向修订的来源槽位已经变化，请重新建立冻结范围。");
    const preserve = texts([...applicable(requirements.preserve, target.slotId), ...plan.preserve, ...(target.preserve || [])]);
    const changes = texts([...plan.changes, ...(target.changes || [])]);
    const conditions = texts(applicable(requirements.conditions, target.slotId)).filter(text => !preserve.includes(text) && !changes.includes(text));
    return { target, source, index, args: {
      operation: target.mask ? "redraw" : args.operation,
      prompt: ["基于所附来源图片制作修订，保留未要求修改的内容。",
        ...(target.mask ? ["只修改用户蒙版的透明区域，严格保留未涂抹区域的主体、构图、颜色、光线和细节。"] : []),
        ...(requirements.goal?.text ? [`创作目标：${requirements.goal.text}`] : []),
        ...(requirements.usage?.text ? [`使用用途：${requirements.usage.text}`] : []),
        ...preserve.map(text => `保持：${text}`), ...conditions.map(text => `验收条件：${text}`), ...changes.map(text => `修改：${text}`)].join("\n"),
      count: 1, parentId: target.nodeId,
      ...(source.bindingId ? { sourceBindingId: source.bindingId } : { sourceAssetId: source.assetId }),
      model: configuration.model, ratio: configuration.ratio, resolution: configuration.resolution, quality: configuration.quality,
      outputFormat: configuration.outputFormat,
      projectId: context.projectId, conversationId: context.conversationId,
      runId: `${context.runId || "revision"}-${plan.revisionId}-${index + 1}`
    }, provenance: {
      creation: { requirementId: creation.requirementId, revision: creation.revision, fingerprint: creation.fingerprint },
      ...(target.slotId ? { creationSlotId: target.slotId } : {}), creationRevisionId: plan.revisionId,
      creationBaselineReviewIds: [...plan.baselineReviewIds], creationPreserve: [...plan.preserve, ...(target.preserve || [])], creationChanges: [...plan.changes, ...(target.changes || [])],
      sourceAssetId: target.assetId, sourceOccurrenceId: target.occurrenceId, sourceContentHash: target.contentHash
    } };
  });
}

async function frozenMaskDataUrl(job, context, projectRoot) {
  try {
    const mask = normalizeCreationMaskAssets(context.taskScope.maskAssets)[0];
    if (!sharpImage || !projectRoot || !mask || !sameTarget(mask, job.target.mask) || !sameTarget(mask.target, job.target)) throw Error();
    const directory = path.resolve(projectRoot, ".naimage", "creation-masks");
    const expectedPath = path.resolve(projectRoot, mask.relativePath);
    if (!/^\.naimage\/creation-masks\/[^/]+\.png$/.test(mask.relativePath) || path.relative(expectedPath, path.resolve(mask.path)) ||
      !viewImagePathAllowed(directory, [projectRoot]) || !viewImagePathAllowed(mask.path, [directory])) throw Error();
    const sourcePath = job.source.path || path.resolve(projectRoot, job.source.relativePath || "");
    if (!viewImagePathAllowed(sourcePath, [projectRoot])) throw Error();
    const maskBytes = readRuntimeImageFile(mask.path, 20 * 1024 * 1024, "区域修改蒙版");
    const sourceBytes = readRuntimeImageFile(sourcePath, 128 * 1024 * 1024, "区域修改来源");
    const digest = bytes => createHash("sha256").update(bytes).digest("hex");
    if (digest(maskBytes) !== mask.contentHash || digest(sourceBytes) !== job.target.contentHash) throw Error();
    if (maskBytes.length < 33 || !maskBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error();
    const [source, decoded] = await Promise.all([
      sharpImage(sourceBytes, { failOn: "warning", limitInputPixels: 64_000_000 }).metadata(),
      sharpImage(maskBytes, { failOn: "warning", limitInputPixels: 64_000_000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    ]);
    if (decoded.info.width !== mask.width || decoded.info.height !== mask.height || source.width !== mask.width || source.height !== mask.height) throw Error();
    let editedPixels = 0;
    for (let index = 3; index < decoded.data.length && editedPixels < 24; index += 4) if (decoded.data[index] < 255) editedPixels++;
    if (editedPixels < 24) throw Error();
    return `data:image/png;base64,${maskBytes.toString("base64")}`;
  } catch {
    throw new Error("区域修改蒙版或来源文件读取校验失败，图片未派发；请重新选择成果并绘制蒙版。");
  }
}

async function runCreationRevision(args, context, { creationService, projectRoot, normalizeImageArgs, runImageTool }) {
  const state = context.creationRevisionExecution;
  if (!state || state.accepted || state.preparing) throw new Error("本定向修订已派发或不能从直接工具入口执行；请查询原任务。");
  state.preparing = true;
  try {
    const current = await callCreationService(creationService, "get_requirements", { projectId: context.projectId, conversationId: context.conversationId,
      taskId: context.taskId, runId: context.runId, requirementId: context.taskScope?.creation?.requirementId,
      requirementRef: context.taskScope?.creation });
    const jobs = creationRevisionJobs(args, context, requirementsFromResult(current));
    // All deterministic checks run before the first request. Once accepted, the
    // model cannot retry this plan, including after a save or uncertain failure.
    const prepared = [];
    for (const job of jobs) {
      const maskDataUrl = job.target.mask ? await frozenMaskDataUrl(job, context, projectRoot) : null;
      prepared.push({ ...job, args: normalizeImageArgs({ ...job.args, ...(maskDataUrl ? { maskDataUrl } : {}) }, context) });
    }
    state.accepted = true;
    const actions = [], outputs = [];
    for (const job of prepared) {
      await context.waitUntilRunnable?.(context.signal);
      if (context.signal?.aborted) throw context.signal.reason || new Error("定向修订已结束。");
      const toolRunId = `${context.toolRunId || context.runId || "revision"}-target-${job.index + 1}`;
      job.args.taskProvenance = { ...job.args.taskProvenance, ...job.provenance };
      try {
        const result = await runImageTool(job.args, { ...context, toolRunId, operationId: toolRunId, creationRevisionChild: true });
        actions.push(...(result.actions || [])); outputs.push(result.envelope.modelOutput || result.envelope.visibleOutput || result.envelope.summary);
        if (result.envelope.ok === false) throw new Error(result.envelope.error || "定向修订未完成。");
      } catch (error) {
        return { envelope: { ok: false, tool: "image_gen", summary: `已保留 ${actions.filter(action => action.node?.assets?.length).length} 个完成成果；定向修订已停止。`,
          error: error.message || String(error), errorCategory: error.category || error.errorCategory || "creation_revision_failed", retriable: false,
          unsafeToRetry: true, modelOutput: [...outputs, "Revision stopped. Do not repeat image_gen; query/recover the original task."].join("\n") }, actions };
      }
    }
    return { envelope: { ok: true, tool: "image_gen", summary: `已完成 ${jobs.length} 个指定成果的定向修订。`, modelOutput: outputs.join("\n") }, actions };
  } finally { state.preparing = false; }
}

module.exports = { creationRevisionJobs, runCreationRevision };
