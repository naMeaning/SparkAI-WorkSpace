import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createCreationWindowView } from "../runtime/creation-session-window.mjs";
import { creationSessionSummary } from "../runtime/creation-session-status.mjs";

const panelUrl = new URL("../src/creation-session-panel.tsx", import.meta.url).href;
const primitiveUrl = new URL("../src/ui/primitives.tsx", import.meta.url).href;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === panelUrl && specifier === "./creation-session") {
      return { url: new URL("../src/creation-session.ts", import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL === panelUrl && specifier === "./ui/primitives") return { url: primitiveUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== panelUrl && url !== primitiveUrl) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
    }).outputText };
  }
});
const { default: CreationSessionPanel } = await import(panelUrl);
loader.deregister();

class TestElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.dataset = {}; this.className = ""; this.value = ""; this._text = ""; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
}
function findClass(node, className) {
  if (node.className === className) return node;
  for (const child of node.children) { const match = findClass(child, className); if (match) return match; }
}
function allElements(node) { return [node, ...node.children.flatMap(allElements)]; }
function renderSurfaces(session) {
  const markup = renderToStaticMarkup(React.createElement(CreationSessionPanel, { creationSession: session }));
  const buttons = [...markup.matchAll(/<button\b([^>]*)>/g)];
  assert.ok(buttons.length > 0);
  assert.ok(buttons.every(([, attributes]) => /class="[^"]*\bui-button-base\b/.test(attributes) && /type="button"/.test(attributes)), "All main creation actions use the existing ButtonBase contract");
  detached.render({ creationSession: session, creationBusy: false, busy: false });
  const detachedButtons = allElements(surface).filter(node => node.tagName === "button");
  assert.ok(detachedButtons.length > 0);
  assert.ok(detachedButtons.every(node => node.className.split(/\s+/).includes("ui-button-base") && node.type === "button"), "The detached button factory preserves the same base contract");
  return markup;
}
const previousDocument = globalThis.document;
globalThis.document = { createElement: tag => new TestElement(tag) };
const surface = new TestElement("details"), detached = createCreationWindowView(surface, () => { throw new Error("Rendering cannot execute a command"); });
const baseline = {
  projectId: "project", conversationId: "conversation",
  requirements: { requirementId: "requirement", conversationId: "conversation", revision: 2, fingerprint: `creation-${"a".repeat(64)}`,
    goal: { text: "创作目标", source: "user" }, usage: { text: "作品展示", source: "user" },
    slots: [{ slotId: "hero", label: "主图", source: "user" }], preserve: [], adjustable: [], conditions: [] },
  results: [{ target: { assetId: "asset", occurrenceId: "occurrence", contentHash: "a".repeat(64) }, label: "作品一", generated: true, saved: true,
    current: true, invalidReasons: [], decision: { state: "approved" }, fileCheck: { status: "passed", contentHash: "a".repeat(64), checkedAt: "2026-10-20", issues: [] },
    visualReview: { reviewId: "review", verdict: "pass", reviewedAt: "2026-10-20", findings: [], modelRoundId: "round", runId: "run" } }]
};
const scenarios = [
  { name: "current pass", reasons: [], local: "本地检查通过", marker: "passed" },
  { name: "requirements changed", reasons: ["requirements-changed"], local: "本地检查已过期", marker: "stale" },
  { name: "target replaced or missing", reasons: ["asset-changed-or-unavailable"], local: "本地检查已过期", marker: "stale" },
  { name: "only the visual source changed", reasons: ["source-changed-or-unavailable"], local: "本地检查通过", marker: "passed" },
  { name: "current file check failed", reasons: [], fileStatus: "failed", local: "本地检查失败", marker: "failed" },
  { name: "no local evidence", reasons: ["requirements-changed"], unchecked: true, local: "本地未检查" },
  { name: "old failure is also historical", reasons: ["requirements-changed"], fileStatus: "failed", local: "本地检查已过期", marker: "stale" }
];
try {
  for (const scenario of scenarios) {
    const session = structuredClone(baseline), result = session.results[0];
    result.invalidReasons = scenario.reasons; result.current = !scenario.reasons.length;
    if (scenario.unchecked) delete result.fileCheck;
    else if (scenario.fileStatus) result.fileCheck.status = scenario.fileStatus;
    const markup = renderSurfaces(session);
    const statuses = markup.match(/<div class="creation-result-states">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(statuses, `${scenario.name}: the main surface renders its evidence statuses`);
    assert.ok(statuses.includes(scenario.marker ? `<span data-status="${scenario.marker}">${scenario.local}</span>` : `<span>${scenario.local}</span>`), scenario.name);
    assert.ok(statuses.includes("用户已采用"), "Evidence invalidation does not rewrite the catalog decision");
    const detachedStatuses = findClass(surface, "creation-result-states");
    assert.equal(detachedStatuses.children[2].textContent, scenario.local, `${scenario.name}: detached label`);
    assert.equal(detachedStatuses.children[2].dataset.status, scenario.marker, `${scenario.name}: detached marker`);
    assert.equal(detachedStatuses.children[4].textContent, "用户已采用");
    if (!result.current) {
      assert.ok(statuses.includes('<span data-status="stale">AI 检查已过期</span>'));
      assert.equal(detachedStatuses.children[3].dataset.status, "stale");
    }
  }
  const mixed = structuredClone(baseline);
  mixed.requirements.slots = Array.from({ length: 7 }, (_, index) => ({ slotId: `slot-${index}`, label: `交付项${index + 1}`, source: "user" }));
  mixed.results = Array.from({ length: 7 }, (_, index) => ({ ...structuredClone(baseline.results[0]), label: `作品${index + 1}`,
    target: { assetId: `asset-${index}`, occurrenceId: `occ-${index}`, contentHash: "a".repeat(64) }, decision: { state: "candidate" } }));
  mixed.results[0].decision.state = "approved";
  mixed.results[1].visualReview.verdict = "revise";
  mixed.results[2].visualReview.verdict = "uncertain";
  delete mixed.results[3].fileCheck; delete mixed.results[3].visualReview;
  mixed.results[4].current = false; mixed.results[4].invalidReasons = ["requirements-changed"]; mixed.results[4].decision.state = "approved";
  mixed.results[5].current = false; mixed.results[5].invalidReasons = ["source-changed-or-unavailable"]; mixed.results[5].fileCheck.status = "failed";
  mixed.results[6].current = false; mixed.results[6].invalidReasons = ["asset-changed-or-unavailable"]; mixed.results[6].saved = false;
  mixed.results[6].fileCheck.status = "failed"; mixed.results[6].visualReview.verdict = "revise";
  const expectedSummary = "目标 7 项 · 已保存 6 项 · 待检查 4 项 · 有疑问 3 项 · 已采用 2 项";
  assert.deepEqual(creationSessionSummary(mixed), { targetCount: 7, savedCount: 6, pendingCheckCount: 4, doubtCount: 3, adoptedCount: 2, text: expectedSummary });
  const mixedMarkup = renderSurfaces(mixed);
  assert.ok(mixedMarkup.includes(`<span data-creation-summary="true">${expectedSummary}</span>`));
  assert.equal(surface.children[0].children[1].textContent, expectedSummary, "Both surfaces expose the same current evidence counts while collapsed");
  mixed.results.reverse(); assert.equal(creationSessionSummary(mixed).text, expectedSummary, "Reordering stable results cannot change counts");
  const noRequirements = { ...structuredClone(baseline), requirements: null, results: [] };
  assert.equal(creationSessionSummary(noRequirements).text, "目标待确认 · 已保存 0 项 · 待检查 0 项 · 有疑问 0 项 · 已采用 0 项");
  renderSurfaces(noRequirements);
  console.log(JSON.stringify({ ok: true, checks: scenarios.length + 3, surfaces: ["main React markup", "detached DOM projection"], buttonFoundation: true, realModelRequests: 0 }));
} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
