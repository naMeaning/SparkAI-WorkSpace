"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const MAX_EVENTS = 300;
const kinds = new Set(["agent", "model", "image", "view_image"]);
const phases = new Set(["request", "response", "retry", "failure", "partial", "done"]);
const protocols = new Set(["chat-completions", "responses", "openai-images", "xai-images", "gemini-native"]);
const stages = new Set(["input", "generation", "result", "conversation", "tool"]);
const categories = new Set(["AUTH_ERROR", "INSUFFICIENT_BALANCE", "MODEL_NOT_FOUND", "UNSUPPORTED_PARAMETER", "CONTENT_POLICY", "RATE_LIMIT", "UPSTREAM_ERROR", "NETWORK_ERROR", "TIMEOUT", "TASK_FAILED", "RESULT_DOWNLOAD_FAILED", "INVALID_RESPONSE", "image_result_download", "image_result_processing"]);

// Only explicit metadata fields enter this store. Never redact-and-copy an
// upstream body, error message, prompt, credential, file path or image URL.
function publicEvent(value = {}) {
  if (!value || typeof value !== "object") return null;
  if (!kinds.has(value.kind) || !phases.has(value.phase)) return null;
  const event = { time: new Date().toISOString(), kind: value.kind, phase: value.phase };
  if (typeof value.time === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.time)) event.time = value.time;
  if (value.runId) event.run = createHash("sha256").update(String(value.runId)).digest("hex").slice(0, 12);
  if (/^[a-f0-9]{12}$/.test(value.run || "")) event.run = value.run;
  if (/^[a-zA-Z0-9_.:/-]{1,100}$/.test(value.model || "") && !/sk-|https?:|[A-Za-z]:[\\/]/i.test(value.model)) event.model = value.model;
  if (protocols.has(value.protocol)) event.protocol = value.protocol;
  if (stages.has(value.stage)) event.stage = value.stage;
  if (categories.has(value.category)) event.category = value.category;
  for (const key of ["status", "durationMs", "count", "round", "attempt"]) {
    const number = Number(value[key]);
    if (value[key] !== undefined && Number.isFinite(number) && number >= 0 && number <= 86_400_000) event[key] = Math.floor(number);
  }
  return event;
}

function createRuntimeDiagnostics({ filePath, version = "" }) {
  let events = [];
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size <= 512 * 1024) {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      events = (Array.isArray(saved.events) ? saved.events : []).map(publicEvent).filter(Boolean).slice(-MAX_EVENTS);
    }
  } catch {} // Diagnostics must never block normal work.
  const snapshot = () => ({ version: 1, appVersion: version, events: events.map((event) => ({ ...event })) });
  const record = (value) => {
    const event = publicEvent(value);
    if (!event) return;
    events.push(event);
    events = events.slice(-MAX_EVENTS);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(snapshot()), "utf8");
      fs.renameSync(`${filePath}.tmp`, filePath);
    } catch {}
  };
  const exportTo = (target) => { fs.writeFileSync(target, JSON.stringify(snapshot(), null, 2) + "\n", "utf8"); };
  return { record, snapshot, exportTo };
}

module.exports = { createRuntimeDiagnostics, publicEvent, MAX_EVENTS };
