"use strict";
const { createHash } = require("node:crypto");
const { readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");

// Capabilities never cross IPC or JSON persistence. A caller cannot turn a
// convincing-looking observation DTO into proof that a model consumed pixels.
const issuedProofs = new WeakSet();
const canonicalPath = value => {
  if (!value) return "";
  const resolved = path.resolve(value);
  try { return realpathSync(resolved).toLowerCase(); } catch { return resolved.toLowerCase(); }
};
const identity = value => ({ assetId: String(value?.assetId || ""), occurrenceId: String(value?.occurrenceId || ""), contentHash: String(value?.contentHash || "").toLowerCase() });
const sameIdentity = (left, right) => {
  const a = identity(left), b = identity(right);
  return Boolean(a.assetId && a.contentHash && a.assetId === b.assetId && a.occurrenceId === b.occurrenceId && a.contentHash === b.contentHash);
};
const currentHash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const scopeMatches = (proof, payload) => ["projectId", "conversationId", "taskId", "runId", "requirementId"].every(key => String(proof[key] || "") === String(payload[key] || ""))
  && proof.requirementsRevision === Number(payload.expectedRequirementsRevision ?? payload.requirementsRevision ?? payload.revision);

function verifyObservationEvidence(proof, payload = {}) {
  if (!proof || !issuedProofs.has(proof) || !scopeMatches(proof, payload) || !sameIdentity(proof, payload.target)) return false;
  const sources = Array.isArray(payload.sourceTargets) ? payload.sourceTargets : [];
  return sources.every(source => proof.sourceObservations.some(observed => sameIdentity(observed, source)));
}

function successfulModelResponse(response) {
  if (!response || response.error || response.incomplete_details) return false;
  if (response.status && response.status !== "completed") return false;
  const reason = response.choices?.[0]?.finish_reason;
  return ["stop", "completed", "tool_calls", "function_call"].includes(reason) || (!reason && (response.status === "completed" || Array.isArray(response.output)));
}

function createImageObservationLedger(scope = {}) {
  const pending = new Map();
  const consumed = [];
  let active = true;
  function stage({ imagePath, modelImage, assets = [], requirementRef }) {
    if (!active || !requirementRef?.requirementId || !requirementRef?.revision) return;
    const imageKey = canonicalPath(imagePath);
    const targets = assets.filter(asset => {
      const locators = [asset.path, asset.relativePath].filter(Boolean);
      return locators.some(locator => canonicalPath(path.isAbsolute(locator) ? locator : path.resolve(scope.projectRoot || "", locator)) === imageKey);
    }).map(identity).filter(target => target.assetId && /^[a-f0-9]{64}$/.test(target.contentHash) && target.contentHash === modelImage.sourceContentHash);
    // One file may be referenced by multiple logical occurrences. Keep those
    // exact identities; identical bytes from another locator confer no proof.
    if (!targets.length) return;
    pending.set(imageKey, { imagePath, pixels: modelImage.dataUrl, requirementRef: { ...requirementRef }, targets });
  }
  function consume(messages, response, modelRoundId) {
    if (!active || !successfulModelResponse(response)) return;
    const pixels = new Set((messages || []).flatMap(message => Array.isArray(message?.content) ? message.content : [])
      .filter(part => part?.type === "input_image").map(part => part.image_url));
    for (const [key, record] of pending) {
      if (!pixels.has(record.pixels)) continue;
      pending.delete(key);
      const consumedAt = new Date().toISOString();
      for (const target of record.targets) consumed.push({ ...target, ...record.requirementRef, imagePath: record.imagePath, modelRoundId, consumedAt });
    }
  }
  function proofFor({ target, requirementId, expectedRequirementsRevision, sourceTargets = [] }) {
    if (!active) throw new Error("当前 run 的图片观察证据已经失效。");
    const find = requested => consumed.findLast(record => sameIdentity(record, requested) && record.requirementId === requirementId && record.revision === Number(expectedRequirementsRevision));
    const observed = find(target);
    if (!observed) throw new Error("验收需要当前要求版本、当前 run 中成功消费的目标图片像素。");
    const sourceObservations = sourceTargets.map(source => {
      const entry = find(source);
      if (!entry) throw new Error("来源一致性验收需要当前 run 已消费的全部来源图片像素。");
      return entry;
    });
    for (const record of [observed, ...sourceObservations]) {
      if (currentHash(record.imagePath) !== record.contentHash) throw new Error("观察后的图片字节已经改变，请重新观察当前图片。");
    }
    const proof = Object.freeze({ ...identity(observed), projectId: String(scope.projectId || ""), conversationId: String(scope.conversationId || ""),
      taskId: String(scope.taskId || ""), runId: String(scope.runId || ""), requirementId, requirementsRevision: Number(expectedRequirementsRevision),
      modelRoundId: observed.modelRoundId, consumedAt: observed.consumedAt,
      sourceObservations: Object.freeze(sourceObservations.map(record => Object.freeze({ ...identity(record), modelRoundId: record.modelRoundId, consumedAt: record.consumedAt }))) });
    issuedProofs.add(proof);
    return proof;
  }
  return { stage, consume, proofFor, close() { active = false; pending.clear(); consumed.length = 0; } };
}

module.exports = { createImageObservationLedger, verifyObservationEvidence, successfulModelResponse };
