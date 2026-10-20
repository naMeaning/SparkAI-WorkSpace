"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { redactText } = require("./debug-command-service.cjs");
const { normalizeCreationTaskContract } = require("../runtime/creation-task-contract.mjs");

const fail = (code, message) => Object.assign(new Error(message), { code });
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const clean = (value, limit = 2000) => redactText(String(value ?? "")).replace(/\u0000/g, "")
  .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]")
  .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace)\/[^\s<>"']+/g, "[路径已隐藏]").trim().slice(0, limit);
const identifier = value => /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(String(value || "")) ? String(value) : "";
const refEqual = (a, b) => Boolean(a && b && a.requirementId === b.requirementId && a.revision === b.revision && a.fingerprint === b.fingerprint);
const refOf = value => ({ requirementId: value.requirementId, revision: value.revision, fingerprint: value.fingerprint });

function normalizeCreationReference(value) {
  const requirementId = identifier(value?.requirementId);
  const revision = Number(value?.revision);
  const fingerprint = String(value?.fingerprint || "");
  return requirementId && Number.isSafeInteger(revision) && revision > 0 && /^creation-[a-f0-9]{64}$/.test(fingerprint)
    ? { requirementId, revision, fingerprint } : null;
}

function normalizeCreationTarget(value) {
  const assetId = identifier(value?.assetId), occurrenceId = identifier(value?.occurrenceId);
  const contentHash = String(value?.contentHash || "").toLowerCase();
  if (!assetId || !occurrenceId || !/^[a-f0-9]{64}$/.test(contentHash)) throw fail("CREATION_TARGET_INVALID", "成果需要完整的资产、出现身份和内容指纹。");
  return { assetId, occurrenceId, contentHash };
}
const targetKey = target => `${target.assetId}|${target.occurrenceId}|${target.contentHash}`;

function normalizeRequirements(value) {
  const fact = candidate => {
    const text = clean(candidate?.text, 200_000);
    if (!text || !["user", "assumption"].includes(candidate?.source)) throw fail("CREATION_REQUIREMENTS_INVALID", "每条创作要求必须有内容及 user/assumption 来源。");
    return { text, source: candidate.source };
  };
  const slots = (Array.isArray(value?.slots) ? value.slots : []).map(slot => {
    const slotId = identifier(slot?.slotId), label = clean(slot?.label, 120);
    if (!slotId || !label || !["user", "assumption"].includes(slot.source)) throw fail("CREATION_SLOT_INVALID", "输出槽位需要稳定身份、名称和来源。");
    return { slotId, label, source: slot.source };
  });
  if (!slots.length || slots.length > 200 || new Set(slots.map(slot => slot.slotId)).size !== slots.length) throw fail("CREATION_SLOT_INVALID", "需要 1 至 200 个不重复的稳定输出槽位。");
  const slotIds = new Set(slots.map(slot => slot.slotId)), criterionIds = new Set();
  const criteria = values => (Array.isArray(values) ? values : []).map(value => {
    const criterionId = identifier(value?.criterionId);
    if (!criterionId || criterionIds.has(criterionId)) throw fail("CREATION_CRITERION_INVALID", "验收条件需要不重复的稳定身份。");
    criterionIds.add(criterionId);
    const selectedSlots = [...new Set(value.slotIds || [])];
    if (selectedSlots.some(id => !slotIds.has(id))) throw fail("CREATION_SLOT_INVALID", "验收条件引用了不存在的输出槽位。");
    const kind = value.kind === "source_consistency" ? "source_consistency" : "visual";
    const sourceTargets = kind === "source_consistency" ? (value.sourceTargets || []).map(normalizeCreationTarget) : [];
    if (kind === "source_consistency" && !sourceTargets.length) throw fail("CREATION_SOURCE_REQUIRED", "来源一致性条件必须明确绑定来源图身份。");
    return { criterionId, ...fact(value), kind, ...(selectedSlots.length ? { slotIds: selectedSlots } : {}), ...(sourceTargets.length ? { sourceTargets } : {}) };
  });
  const preserve = criteria(value?.preserve), adjustable = criteria(value?.adjustable), conditions = criteria(value?.conditions);
  if (criterionIds.size > 400) throw fail("CREATION_REQUIREMENTS_INVALID", "创作条件超过本地上限。");
  const fileRules = {};
  for (const key of ["width", "height", "minWidth", "minHeight"]) if (value?.fileRules?.[key] !== undefined) {
    const number = Number(value.fileRules[key]);
    if (!Number.isSafeInteger(number) || number < 1 || number > 65535) throw fail("CREATION_FILE_RULE_INVALID", "文件尺寸条件无效。");
    fileRules[key] = number;
  }
  if (value?.fileRules?.formats?.length) {
    fileRules.formats = [...new Set(value.fileRules.formats)];
    if (fileRules.formats.some(format => !["png", "jpeg", "webp", "avif", "tiff"].includes(format))) throw fail("CREATION_FILE_RULE_INVALID", "文件格式条件无效。");
  }
  if (value?.fileRules?.alpha !== undefined) {
    if (!["any", "required", "forbidden"].includes(value.fileRules.alpha)) throw fail("CREATION_FILE_RULE_INVALID", "透明通道条件无效。");
    fileRules.alpha = value.fileRules.alpha;
  }
  return { goal: fact(value?.goal), usage: fact(value?.usage), slots, preserve, adjustable, conditions, ...(Object.keys(fileRules).length ? { fileRules } : {}) };
}

/** Main owns the complete contract. Session writers and the task ledger carry references only. */
function createProjectCreationService({ projectFor, readSession, catalogService, projectRelativePath, resolveProjectRelativePath,
  verifyObservationEvidence = () => false, resolveSavedResult = () => null, resolveMask = null, onChange = () => {}, sharp = null, metaDir = ".naimage" } = {}) {
  if (![projectFor, readSession, projectRelativePath, resolveProjectRelativePath].every(fn => typeof fn === "function")) throw new TypeError("creation project services are required");
  let taskResolver = () => null;
  const setTaskResolver = resolver => { taskResolver = resolver; };
  let maskResolver = resolveMask;
  const setMaskResolver = resolver => { maskResolver = resolver; };
  const projectOf = input => {
    const project = projectFor(input.expectedProjectId || input.projectId);
    if (!project?.id || !project.path) throw fail("PROJECT_NOT_FOUND", "创作所属项目不存在。");
    return project;
  };
  const location = project => path.join(project.path, metaDir, "creation.json");
  function read(project) {
    if (!fs.existsSync(location(project))) return { schemaVersion: 1, requirements: [], results: [], revisions: [] };
    try {
      const buffer = fs.readFileSync(location(project));
      if (buffer.length > 8 * 1024 * 1024) throw Error();
      const document = JSON.parse(buffer.toString("utf8"));
      if (document.schemaVersion !== 1 || ![document.requirements, document.results, document.revisions].every(Array.isArray)) throw Error();
      for (const requirement of document.requirements) {
        if (!normalizeCreationReference(requirement) || requirement.fingerprint !== `creation-${hash(normalizeRequirements(requirement))}`) throw Error();
      }
      for (const result of document.results) if (!normalizeCreationTarget(result.target) || !normalizeCreationReference(result.requirementRef) ||
        result.fileCheck && !["passed", "failed"].includes(result.fileCheck.status) ||
        result.visualReview && !["pass", "revise", "uncertain"].includes(result.visualReview.verdict)) throw Error();
      return document;
    } catch { throw fail("CREATION_STORE_INVALID", "创作要求或验收记录无法读取，原文件已保留；没有执行或覆盖。"); }
  }
  function write(project, document) {
    const file = location(project), temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const bytes = JSON.stringify(document);
      if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw fail("CREATION_STORE_FULL", "创作记录已达本地容量上限，未覆盖原记录。");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
    } catch (error) {
      error.creationPersistenceFailed = true; error.phase = "creation_save"; throw error;
    } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
    onChange(project.id);
  }
  function requirementsByRef({ projectId, expectedProjectId, requirementRef }) {
    const project = projectOf({ projectId, expectedProjectId });
    const found = read(project).requirements.find(value => refEqual(value, requirementRef));
    if (!found) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "对应版本的完整创作要求不存在。");
    return found;
  }
  function requirementFor(input, document, { latest = false } = {}) {
    const task = input.taskId ? taskResolver(input.expectedProjectId || input.projectId, input.taskId, input.conversationId) : null;
    const reference = task?.requirementRef || input.requirementRef;
    const requirementId = input.requirementId || reference?.requirementId;
    const candidates = document.requirements.filter(value => (!input.conversationId || value.conversationId === input.conversationId) &&
      (requirementId ? value.requirementId === requirementId : value.conversationId === input.conversationId));
    return !latest && reference ? candidates.find(value => refEqual(value, reference)) || null : candidates.at(-1) || null;
  }
  function getRequirements(input = {}) {
    const project = projectOf(input), requirements = requirementFor(input, read(project));
    return { ok: true, projectId: project.id, conversationId: input.conversationId, requirements, requirementRef: requirements ? refOf(requirements) : null };
  }
  function updateRequirements(input = {}) {
    const project = projectOf(input), document = read(project), previous = requirementFor(input, document, { latest: true });
    const expected = input.expectedRevision ?? input.expectedRequirementsRevision;
    if (input.requirementId && !previous) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "本会话没有对应的创作要求。");
    if (expected !== (previous?.revision || 0)) throw fail("CREATION_REQUIREMENTS_CONFLICT", "创作要求已在其他窗口变化，请刷新后重试。");
    const normalized = normalizeRequirements(input.requirements);
    const fingerprint = `creation-${hash(normalized)}`;
    if (previous?.fingerprint === fingerprint) return getRequirements({ ...input, requirementId: previous.requirementId, taskId: undefined });
    const conversationId = identifier(input.conversationId || previous?.conversationId);
    if (!conversationId) throw fail("CREATION_CONVERSATION_REQUIRED", "创作要求必须属于明确的会话。");
    const requirements = { requirementId: previous?.requirementId || `requirement-${randomUUID()}`, conversationId,
      revision: (previous?.revision || 0) + 1, fingerprint, ...normalized, updatedAt: new Date().toISOString() };
    document.requirements.push(requirements); write(project, document);
    return { ok: true, projectId: project.id, conversationId, requirements, requirementRef: refOf(requirements) };
  }
  function requirementRefForTask(input = {}) {
    if (input.creation) validateTaskContract({ ...input, creation: input.creation });
    if (input.requirementId && input.expectedRequirementsRevision !== undefined && !input.taskId) {
      const project = projectOf(input), requirement = read(project).requirements.find(value => value.requirementId === input.requirementId &&
        value.revision === input.expectedRequirementsRevision && value.conversationId === input.conversationId);
      if (!requirement) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "指定的创作要求版本不存在。");
      return refOf(requirement);
    }
    const existing = getRequirements(input);
    if (existing.requirementRef) return existing.requirementRef;
    if (input.requirementId || input.taskId) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "目标任务的创作要求不存在。");
    if (!String(input.prompt || "").trim()) return null;
    return updateRequirements({ ...input, expectedRevision: 0, requirements: {
      goal: { text: input.prompt, source: "user" }, usage: { text: "用途待用户确认", source: "assumption" },
      slots: [{ slotId: "output-1", label: "创作成果", source: "assumption" }], preserve: [], adjustable: [], conditions: []
    } }).requirementRef;
  }
  function validateTaskContract(input = {}) {
    const project = projectOf(input), document = read(project), creation = normalizeCreationTaskContract(input.creation);
    if (!creation || !document.requirements.some(value => refEqual(value, creation) && value.conversationId === input.conversationId)) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "任务没有绑定本会话持久化的完整要求版本。");
    if (creation.revisionPlan) {
      const stored = document.revisions.find(value => value.conversationId === input.conversationId && value.result.plan.revisionId === creation.revisionPlan.revisionId);
      const authoritative = stored && normalizeCreationTaskContract({ ...stored.result.requirementRef, revisionPlan: stored.result.plan });
      if (!authoritative || hash(authoritative) !== hash(creation)) throw fail("CREATION_REVISION_CONFLICT", "定向修改计划与项目权威记录不一致，未执行。");
    }
    return refOf(creation);
  }
  function currentRequirement(input, document) {
    const requirement = requirementFor(input, document, { latest: true });
    if (!requirement) throw fail("CREATION_REQUIREMENTS_NOT_FOUND", "请先保存创作要求。");
    const expected = input.expectedRevision ?? input.expectedRequirementsRevision;
    if (expected !== undefined && expected !== requirement.revision) throw fail("CREATION_REQUIREMENTS_CONFLICT", "创作要求版本已变化，旧验收不能复用。");
    if (input.taskId) {
      const task = taskResolver(input.expectedProjectId || input.projectId, input.taskId, input.conversationId);
      if (!refEqual(task?.requirementRef, requirement)) throw fail("CREATION_TASK_REQUIREMENTS_STALE", "任务冻结的要求版本已过期，未记录新的验收或执行。");
    }
    return requirement;
  }
  function locate(project, value, { verifyBytes = true, taskId = "", allowSavedResult = false } = {}) {
    const target = normalizeCreationTarget(value), session = readSession(project.id);
    const matches = [];
    for (const node of session?.nodes || []) if (node.type === "image") for (let index = 0; index < (node.assets || []).length; index++) {
      const asset = node.assets[index];
      if (asset.assetId === target.assetId && asset.occurrenceId === target.occurrenceId && asset.contentHash === target.contentHash) matches.push({ node, asset, assetIndex: index, inProject: true });
    }
    if (!matches.length && allowSavedResult && taskId) {
      const candidate = resolveSavedResult({ projectId: project.id, taskId, target });
      if (candidate?.asset && candidate.asset.assetId === target.assetId && candidate.asset.occurrenceId === target.occurrenceId && candidate.asset.contentHash === target.contentHash) {
        matches.push({ ...candidate, assetIndex: 0, inProject: false });
      }
    }
    if (!matches.length) throw fail("CREATION_TARGET_STALE", "目标成果已移除、替换或内容发生变化。");
    const found = matches[0], asset = found.asset;
    if (asset.status === "pending" || asset.status === "error") throw fail("CREATION_TARGET_UNSAVED", "目标成果尚未成功保存。");
    const relativePath = asset.relativePath || projectRelativePath(project.path, asset.path);
    const file = relativePath && resolveProjectRelativePath(project.path, relativePath);
    let bytes;
    if (verifyBytes) {
      try {
        if (!/^(?:assets\/|output\/(?:imagegen|post)\/|\.naimage\/assets\/)/.test(String(relativePath).replace(/\\/g, "/"))) throw Error();
        const stat = fs.lstatSync(file), relative = path.relative(fs.realpathSync(project.path), fs.realpathSync(file));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 128 * 1024 * 1024 || !relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error();
        bytes = fs.readFileSync(file);
      } catch { throw fail("CREATION_FILE_UNAVAILABLE", "项目成果文件不存在或不属于当前受管项目。"); }
      if (hash(bytes) !== target.contentHash) throw fail("CREATION_TARGET_STALE", "目标文件的内容指纹已变化，原验收已失效。");
    }
    return { ...found, target, file, bytes, relativePath };
  }
  function resultFor(document, target, requirement, slotId) {
    if (!slotId) {
      const prior = document.results.filter(value => value.requirementRef.requirementId === requirement.requirementId && targetKey(value.target) === targetKey(target) &&
        requirement.slots.some(slot => slot.slotId === value.slotId)).at(-1);
      slotId = prior?.slotId || (requirement.slots.length === 1 ? requirement.slots[0].slotId : undefined);
    }
    let record = document.results.find(value => targetKey(value.target) === targetKey(target) && refEqual(value.requirementRef, requirement));
    if (!record) {
      record = { target, requirementRef: refOf(requirement), ...(slotId ? { slotId } : {}) }; document.results.push(record);
    }
    if (slotId && !requirement.slots.some(value => value.slotId === slotId)) throw fail("CREATION_SLOT_INVALID", "成果绑定了不存在的输出槽位。");
    if (slotId && record.slotId && record.slotId !== slotId) throw fail("CREATION_SLOT_CONFLICT", "同一成果已绑定另一个稳定输出槽位。");
    if (slotId) record.slotId = slotId;
    return record;
  }
  function discoverResults(project, document, requirementId, indexSession) {
    for (const node of (indexSession ?? readSession(project.id))?.nodes || []) if (node.type === "image") for (const asset of node.assets || []) {
      if (!asset.assetId || !asset.occurrenceId || !asset.contentHash) continue;
      const collection = node.imageCollection?.items || node.imageContainerSpec?.collection?.items || [];
      const member = collection.find(value => value.assetId === asset.assetId && value.occurrenceId === asset.occurrenceId);
      const provenance = member?.taskProvenance || (node.assets.length === 1 ? node.taskProvenance : null);
      const reference = normalizeCreationReference(provenance?.creation);
      if (!reference || requirementId && reference.requirementId !== requirementId) continue;
      const requirement = document.requirements.find(value => refEqual(value, reference));
      if (!requirement) continue;
      const target = normalizeCreationTarget(asset), slotId = provenance.creationSlotId || (requirement.slots.length === 1 ? requirement.slots[0].slotId : undefined);
      const record = resultFor(document, target, requirement, slotId);
      if (provenance.creationRevisionId) record.revisionId = identifier(provenance.creationRevisionId);
      if (provenance.sourceAssetId && provenance.sourceOccurrenceId && provenance.sourceContentHash) {
        record.baseline = normalizeCreationTarget({ assetId: provenance.sourceAssetId, occurrenceId: provenance.sourceOccurrenceId, contentHash: provenance.sourceContentHash });
      }
    }
  }
  async function checkResults(input = {}) {
    const project = projectOf(input), initial = read(project), requirement = currentRequirement(input, initial);
    const targets = (input.targets || (input.target ? [input.target] : [])).map(normalizeCreationTarget);
    if (!targets.length || targets.length > 200) throw fail("CREATION_TARGET_INVALID", "本地文件检查需要 1 至 200 个明确成果。");
    const checked = [];
    for (const target of targets) {
      const fileCheck = { status: "passed", checkedAt: new Date().toISOString(), contentHash: target.contentHash, issues: [] };
      const issue = (code, message) => { fileCheck.status = "failed"; fileCheck.issues.push({ code, message, hard: true }); };
      try {
        const found = locate(project, target, { taskId: input.taskId, allowSavedResult: true }), decoder = sharp || require("sharp");
        const image = decoder(found.bytes, { failOn: "warning", limitInputPixels: 100_000_000 });
        const metadata = await image.metadata();
        // raw().toBuffer() forces complete pixel decoding; header metadata is insufficient.
        const decoded = await image.raw().toBuffer({ resolveWithObject: true });
        fileCheck.width = decoded.info.width; fileCheck.height = decoded.info.height;
        fileCheck.format = metadata.format; fileCheck.hasAlpha = Boolean(metadata.hasAlpha);
        fileCheck.hasTransparency = false;
        if (metadata.hasAlpha) for (let index = decoded.info.channels - 1; index < decoded.data.length; index += decoded.info.channels) {
          if (decoded.data[index] < 255) { fileCheck.hasTransparency = true; break; }
        }
        const rules = requirement.fileRules || {};
        for (const dimension of ["width", "height"]) {
          if (rules[dimension] && fileCheck[dimension] !== rules[dimension]) issue("FILE_DIMENSION", `${dimension} 不符合要求。`);
          if (rules[`min${dimension[0].toUpperCase()}${dimension.slice(1)}`] && fileCheck[dimension] < rules[`min${dimension[0].toUpperCase()}${dimension.slice(1)}`]) issue("FILE_DIMENSION", `${dimension} 低于最小要求。`);
        }
        if (rules.formats?.length && !rules.formats.includes(metadata.format)) issue("FILE_FORMAT", "实际文件格式不符合要求。");
        if (rules.alpha === "required" && (!metadata.hasAlpha || !fileCheck.hasTransparency)) issue("FILE_ALPHA", "成果没有要求的实际透明像素。");
        if (rules.alpha === "forbidden" && metadata.hasAlpha) issue("FILE_ALPHA", "成果包含不允许的 alpha 通道。");
        locate(project, target, { taskId: input.taskId, allowSavedResult: true }); // Revalidate identity after asynchronous decoding.
      } catch (error) { issue(error.code === "CREATION_TARGET_STALE" ? error.code : "FILE_DECODE_FAILED", error.code?.startsWith("CREATION_") ? error.message : "成果无法完成本地像素解码。"); }
      checked.push({ target, fileCheck });
    }
    const document = read(project); currentRequirement({ ...input, expectedRevision: requirement.revision }, document); discoverResults(project, document, requirement.requirementId);
    for (const check of checked) {
      const record = resultFor(document, check.target, requirement, input.slotId);
      record.fileCheck = check.fileCheck; if (input.taskId) record.taskId = identifier(input.taskId);
    }
    write(project, document);
    return getAcceptance(input);
  }
  function recordReview(input = {}) {
    const project = projectOf(input), document = read(project), requirement = currentRequirement(input, document), target = normalizeCreationTarget(input.target);
    discoverResults(project, document, requirement.requirementId);
    const record = resultFor(document, target, requirement, input.slotId || (requirement.slots.length === 1 ? requirement.slots[0].slotId : undefined));
    const slotId = record.slotId;
    if (!slotId) throw fail("CREATION_SLOT_REQUIRED", "多槽位成果需要明确绑定输出槽位后才能审查。");
    const allCriteria = [...requirement.preserve, ...requirement.adjustable, ...requirement.conditions];
    const findings = (input.findings || []).map(finding => {
      const criterion = allCriteria.find(value => value.criterionId === finding.criterionId);
      if (!criterion || !["pass", "fail", "uncertain"].includes(finding.status)) throw fail("CREATION_REVIEW_INVALID", "AI 审查引用了无效条件或状态。");
      return { criterionId: criterion.criterionId, status: finding.status, note: clean(finding.note, 2000) };
    });
    if (new Set(findings.map(value => value.criterionId)).size !== findings.length) throw fail("CREATION_REVIEW_INVALID", "同一条件不能被重复审查。");
    const relevant = allCriteria.filter(value => !value.slotIds?.length || value.slotIds.includes(slotId));
    if (relevant.some(value => !findings.some(finding => finding.criterionId === value.criterionId))) throw fail("CREATION_REVIEW_INCOMPLETE", "AI 审查尚未覆盖当前成果的全部要求。");
    const sourceTargets = [...new Map(relevant.filter(value => value.kind === "source_consistency").flatMap(value => value.sourceTargets).map(value => [targetKey(value), value])).values()];
    if (!verifyObservationEvidence(input.observationEvidence, { ...input, projectId: project.id, target, requirementId: requirement.requirementId,
      expectedRequirementsRevision: requirement.revision, sourceTargets })) throw fail("CREATION_PIXELS_NOT_CONSUMED", "主模型尚未消费目标及所需来源图的像素，不能登记 AI 审查。");
    locate(project, target, { taskId: input.taskId, allowSavedResult: true });
    for (const source of sourceTargets) locate(project, source, { taskId: input.taskId, allowSavedResult: true });
    if (!["pass", "revise", "uncertain"].includes(input.verdict)) throw fail("CREATION_REVIEW_INVALID", "AI 审查结论无效。");
    if (input.verdict === "pass" && findings.some(value => value.status !== "pass")) throw fail("CREATION_REVIEW_INVALID", "仍有未通过或不确定的条件，不能登记为 AI 通过。");
    record.visualReview = { reviewId: `review-${randomUUID()}`, verdict: input.verdict, reviewedAt: new Date().toISOString(),
      summary: clean(input.summary), findings, sourceTargets, modelRoundId: identifier(input.observationEvidence?.modelRoundId), runId: identifier(input.runId) };
    if (input.taskId) record.taskId = identifier(input.taskId);
    write(project, document); return getAcceptance(input);
  }
  function catalogLink(project, target) {
    const catalog = catalogService?.list({ expectedProjectId: project.id }).catalog;
    for (const product of catalog?.products || []) {
      const asset = product.assets.find(value => value.kind === "result" && value.assetId === target.assetId && value.contentHash === target.contentHash && value.occurrenceId === target.occurrenceId);
      if (asset) return { catalog, product, asset };
    }
    return null;
  }
  function validateResultApproval({ project, asset }) {
    const document = read(project); discoverResults(project, document);
    const records = document.results.filter(value => value.target.assetId === asset.assetId && value.target.contentHash === asset.contentHash && (!asset.occurrenceId || value.target.occurrenceId === asset.occurrenceId));
    // Existing catalog-only projects retain their established approval workflow.
    if (!records.length) return;
    const current = records.filter(record => refEqual(document.requirements.filter(value => value.requirementId === record.requirementRef.requirementId).at(-1), record.requirementRef));
    if (!current.length || current.some(record => record.fileCheck?.status !== "passed")) throw fail("CREATION_FILE_CHECK_REQUIRED", "成果的本地文件检查未通过或要求已变化，不能采用。");
    for (const record of current) locate(project, record.target);
  }
  function decideResult(input = {}) {
    const project = projectOf(input), document = read(project), requirement = currentRequirement(input, document), target = normalizeCreationTarget(input.target);
    const found = locate(project, target), record = resultFor(document, target, requirement, input.slotId);
    const states = { adopt: "approved", reject: "rejected", candidate: "candidate" }, state = states[input.decision];
    if (!state) throw fail("CREATION_DECISION_INVALID", "用户决定无效。");
    if (state === "approved" && record.fileCheck?.status !== "passed") throw fail("CREATION_FILE_CHECK_REQUIRED", "成果未通过本地完整文件检查，不能采用。");
    if (!catalogService?.ensureCreationResult) throw fail("CREATION_CATALOG_UNAVAILABLE", "成果采用服务不可用。");
    record.decisionReason = clean(input.reason); record.decidedAt = new Date().toISOString();
    write(project, document);
    const link = catalogService.ensureCreationResult({ expectedProjectId: project.id, nodeId: found.node.id, assetIndex: found.assetIndex,
      target, role: record.slotId || "creation" });
    catalogService.updateResultState({ expectedProjectId: project.id, expectedCatalogRevision: link.catalogRevision,
      expectedProductRevision: link.product.revision, productId: link.product.productId, linkId: link.asset.linkId, state });
    return getAcceptance(input);
  }
  function getAcceptance(input = {}) {
    const project = projectOf(input), document = read(project), requirement = requirementFor(input, document);
    if (!requirement) return { ...getRequirements(input), results: [] };
    discoverResults(project, document, requirement.requirementId);
    const records = document.results.filter(value => value.requirementRef.requirementId === requirement.requirementId);
    const selected = new Map();
    for (const record of records) {
      const previous = selected.get(targetKey(record.target));
      if (!previous || previous.requirementRef.revision <= record.requirementRef.revision) selected.set(targetKey(record.target), record);
    }
    const results = [...selected.values()].map(record => {
      const invalidReasons = [], latest = document.requirements.filter(value => value.requirementId === requirement.requirementId).at(-1);
      if (!refEqual(record.requirementRef, latest)) invalidReasons.push("requirements-changed");
      let found;
      try { found = locate(project, record.target, { taskId: record.taskId, allowSavedResult: true }); } catch { invalidReasons.push("asset-changed-or-unavailable"); }
      for (const source of record.visualReview?.sourceTargets || []) {
        try { locate(project, source, { taskId: record.taskId, allowSavedResult: true }); } catch { invalidReasons.push("source-changed-or-unavailable"); break; }
      }
      const link = catalogLink(project, record.target);
      const history = records.filter(value => value !== record && targetKey(value.target) === targetKey(record.target));
      const decisionReason = record.decisionReason || history.findLast(value => value.decisionReason)?.decisionReason;
      const slotLabel = requirement.slots.find(slot => slot.slotId === record.slotId)?.label;
      let baselineLabel = "历史成果";
      if (record.baseline) { try { baselineLabel = clean(locate(project, record.baseline, { verifyBytes: false }).node.title, 120) || baselineLabel; } catch {} }
      return { target: record.target, label: clean(found?.node.title || slotLabel || "历史成果", 120), generated: Boolean(record.taskId || found?.asset.generation || found?.asset.runId || found?.node.taskProvenance),
        saved: Boolean(found?.inProject), inProject: Boolean(found?.inProject), fileSaved: Boolean(found), ...(record.slotId ? { slotId: record.slotId } : {}), requirementRef: record.requirementRef,
        ...(record.fileCheck ? { fileCheck: record.fileCheck } : {}), ...(record.visualReview ? { visualReview: record.visualReview } : {}),
        ...(record.baseline ? { baseline: { target: record.baseline, label: baselineLabel } } : {}),
        ...(record.revisionId ? { revisionId: record.revisionId } : {}),
        ...(history.length ? { history: history.map(value => ({ requirementRef: value.requirementRef,
          ...(value.fileCheck ? { fileCheck: value.fileCheck } : {}), ...(value.visualReview ? { visualReview: value.visualReview } : {}) })) } : {}),
        decision: { state: link?.asset.state || "candidate", ...(decisionReason ? { reason: decisionReason } : {}) }, current: invalidReasons.length === 0, invalidReasons };
    });
    return { ok: true, projectId: project.id, conversationId: requirement.conversationId, requirements: requirement, requirementRef: refOf(requirement), results };
  }
  // Internal derived-index input. Reading does not create or rewrite any
  // acceptance record, and the index retains responsibility for invalidation.
  function searchSnapshot(input = {}, indexSession) {
    const project = projectOf(input), document = read(project);
    discoverResults(project, document, undefined, indexSession);
    return { requirements: document.requirements, results: document.results };
  }
  function resolveRevision(input = {}) {
    const project = projectOf(input), document = read(project);
    const submissionId = identifier(input.submissionId), conversationId = identifier(input.conversationId);
    if (!submissionId || !conversationId) throw fail("CREATION_REVISION_INVALID", "定向修订需要明确的会话和提交身份。");
    const targetInputs = input.targets || (input.target ? [input.target] : []);
    const targets = targetInputs.map(normalizeCreationTarget);
    if (!targets.length || targets.length > 200 || new Set(targets.map(targetKey)).size !== targets.length) throw fail("CREATION_REVISION_INVALID", "定向修订需要明确且不重复的成果目标。");
    const masks = targetInputs.map(value => value.mask === undefined ? null : normalizeCreationTarget(value.mask));
    if (masks.some(Boolean) && targets.length !== 1) throw fail("CREATION_MASK_SINGLE_TARGET", "精确区域修改一次只能选择一个成果。");
    const preserve = (Array.isArray(input.preserve) ? input.preserve : []).map(value => clean(value)).filter(Boolean);
    const changes = (Array.isArray(input.changes) ? input.changes : []).map(value => clean(value)).filter(Boolean);
    const deltas = targetInputs.map((value, index) => ({ preserve: (value.preserve || []).map(text => clean(text)).filter(Boolean), changes: (value.changes || []).map(text => clean(text)).filter(Boolean),
      ...(masks[index] ? { mask: masks[index] } : {}) }));
    if (!changes.length && deltas.some(value => !value.changes.length)) throw fail("CREATION_REVISION_INVALID", "请明确每个目标本次需要修改的部分。");
    const requestHash = hash({ requirementId: input.requirementId, expectedRevision: input.expectedRevision ?? input.expectedRequirementsRevision, targets, deltas, preserve, changes });
    const previous = document.revisions.find(value => value.submissionId === submissionId && value.conversationId === conversationId);
    if (previous) {
      if (previous.requestHash !== requestHash) throw fail("CREATION_REVISION_CONFLICT", "同一提交身份已用于不同定向修改，未执行新请求。");
      return { ...previous.result, duplicate: true };
    }
    for (const [index, mask] of masks.entries()) if (mask) {
      if (typeof maskResolver !== "function") throw fail("CREATION_MASK_UNAVAILABLE", "当前运行时无法验证区域修改蒙版，尚未执行修改。");
      maskResolver({ ...input, projectId: project.id, target: targets[index], mask });
    }
    const requirement = currentRequirement(input, document); discoverResults(project, document, requirement.requirementId);
    const resolved = targets.map((target, index) => {
      const found = locate(project, target), record = document.results.filter(value => targetKey(value.target) === targetKey(target) && value.requirementRef.requirementId === requirement.requirementId &&
        requirement.slots.some(slot => slot.slotId === value.slotId)).at(-1);
      const slotId = record?.slotId || (requirement.slots.length === 1 ? requirement.slots[0].slotId : undefined);
      if (!slotId) throw fail("CREATION_SLOT_REQUIRED", "定向修改需要目标成果的稳定输出槽位。");
      return { ...target, nodeId: found.node.id, slotId,
        ...(deltas[index].preserve.length ? { preserve: deltas[index].preserve } : {}), ...(deltas[index].changes.length ? { changes: deltas[index].changes } : {}),
        ...(deltas[index].mask ? { mask: deltas[index].mask } : {}) };
    });
    const baselineReviewIds = targets.flatMap(target => document.results.filter(value => targetKey(value.target) === targetKey(target) && value.visualReview).map(value => value.visualReview.reviewId));
    const revisionId = `revision-${randomUUID()}`;
    const selectedSlotIds = [...new Set(resolved.map(value => value.slotId))];
    const deltaCriteria = (kind, values, slotIds, prefix) => values.map((text, index) => ({ criterionId: `${revisionId}-${prefix}-${kind}-${index + 1}`, text, source: "user", slotIds }));
    const normalized = normalizeRequirements({ ...requirement,
      preserve: [...requirement.preserve, ...deltaCriteria("keep", preserve, selectedSlotIds, "all"), ...resolved.flatMap((value, index) => deltaCriteria("keep", value.preserve || [], [value.slotId], `t${index}`))],
      conditions: [...requirement.conditions, ...deltaCriteria("change", changes, selectedSlotIds, "all"), ...resolved.flatMap((value, index) => deltaCriteria("change", value.changes || [], [value.slotId], `t${index}`))] });
    const nextRequirement = { requirementId: requirement.requirementId, conversationId: requirement.conversationId,
      revision: requirement.revision + 1, fingerprint: `creation-${hash(normalized)}`, ...normalized, updatedAt: new Date().toISOString() };
    document.requirements.push(nextRequirement);
    const plan = { revisionId, baselineReviewIds, preserve, changes, deltaOnly: true, targets: resolved };
    const result = { requirementRef: refOf(nextRequirement), previousRequirementRef: refOf(requirement), targets: resolved, sourceNodeIds: [...new Set(resolved.map(value => value.nodeId))], plan };
    document.revisions.push({ conversationId, submissionId, requestHash, result }); write(project, document);
    return result;
  }
  if (catalogService?.setResultApprovalGuard) catalogService.setResultApprovalGuard(validateResultApproval);
  return { getRequirements, updateRequirements, requirementsByRef, requirementRefForTask, getAcceptance, searchSnapshot, checkResults, recordReview, decideResult,
    resolveRevision, validateTaskContract, validateResultApproval, setTaskResolver, setMaskResolver };
}

module.exports = { createProjectCreationService, normalizeCreationReference, normalizeCreationTarget, normalizeRequirements };
