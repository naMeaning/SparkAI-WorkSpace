import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { projectKnowledgeEntryFingerprint, projectKnowledgeSnapshotFingerprint } from "../runtime/project-knowledge-contract.mjs";
import { contextTargetKey, emptyResultSearchDraft, knowledgeDraftFor, knowledgeInputFromDraft, projectContextWindowProjection, resultSearchInput } from "../runtime/project-context-presentation.mjs";
import { createProjectContextWindowView } from "../runtime/project-context-window.mjs";

const checks = [], target = number => ({ assetId: `asset-${number}`, occurrenceId: `occurrence-${number}`, contentHash: String(number).repeat(64) });
function knowledge(source = "user", id = "brand") {
  const entry = { knowledgeId: id, revision: 1, type: "brand_rule", title: "品牌规范", content: "保持暖色与简洁排版", scope: { type: "project" }, source, status: source === "user" ? "active" : "suggested", authority: "project_knowledge", assetRefs: [] };
  return { ...entry, fingerprint: projectKnowledgeEntryFingerprint(entry) };
}
function result(number, observed = true) {
  return { target: target(number), nodeId: `node-${number}`, assetIndex: 0, locations: [{ nodeId: `node-${number}`, assetIndex: 0 }], name: `成果 ${number}`, tags: ["用户暖色标签"], usage: ["场景图"], objects: [], sources: [], intended: "需要暖色场景",
    observation: { status: observed ? "observed" : "unobserved", ...(observed ? { summary: "木桌旁的暖色音箱" } : {}) }, adoption: { state: "approved", current: true }, summary: "暖色音箱", createdAt: "2026-10-20", matchReasons: [{ field: "description", source: "observed", value: "暖色音箱" }] };
}
const entry = knowledge(), suggestion = knowledge("assumption", "suggestion");
const used = { version: 1, projectId: "project", revision: 1, objects: [], entries: [entry], budget: { maxEntries: 24, maxCharacters: 12000, usedCharacters: entry.title.length + entry.content.length, omittedEntries: 0 }, summary: entry.title };
used.fingerprint = projectKnowledgeSnapshotFingerprint(used);
const context = { projectId: "project", conversationId: "conversation", revision: 2, entries: [entry, suggestion], total: 2, objects: [], usedKnowledge: used,
  scopeOptions: [{ scope: { type: "project" }, label: "本项目" }], search: { projectId: "project", total: 2, offset: 0, limit: 20, hasMore: false, results: [result(1), result(2, false)] } };
const polluted = structuredClone(context); polluted.token = "PRIVATE-SECRET"; polluted.path = "C:\\private\\project";
polluted.search.results[0].path = "C:\\private\\image.png"; polluted.search.results[0].previewUrl = "https://private.example/signed";
polluted.search.results[1].observation = { status: "stale", summary: "旧观察不得继续展示" };
polluted.search.results[1].matchReasons.push({ field: "name", source: "label", value: "C:\\private\\image.png https://private.example/signed Bearer private-token" });
const projected = projectContextWindowProjection(polluted), json = JSON.stringify(projected);
assert.ok(projected && projected.usedKnowledge.fingerprint === used.fingerprint);
assert.equal(projected.search.results[1].observation.summary, undefined);
assert.ok(!json.includes("PRIVATE-SECRET") && !json.includes("C:\\\\private") && !json.includes("https://private.example") && !json.includes("private-token"));
assert.equal(projectContextWindowProjection({ ...context, projectId: "C:\\private" }), null);
assert.equal(projectContextWindowProjection({ ...context, search: { ...context.search, results: Array.from({ length: 100 }, () => result(1)) } }).search.results.length, 50);
checks.push("bounded window projection strips unknown fields, private text and stale observation without changing actual used knowledge");

const draft = knowledgeDraftFor(suggestion), input = knowledgeInputFromDraft(draft, { projectId: "project", revision: 2, entry: suggestion });
assert.equal(input.entry.source, "assumption"); assert.equal(input.expectedRevision, 2); assert.equal(input.expectedEntryRevision, 1);
assert.throws(() => knowledgeInputFromDraft({ ...draft, type: "style_reference" }, { projectId: "project", revision: 2 }), /已采用成果/);
const searchDraft = { ...emptyResultSearchDraft(), usage: "场景图", objectId: "RED-01", adoption: "approved", descriptionText: "暖色", descriptionSource: "observed", source: target(1) };
assert.deepEqual(resultSearchInput(searchDraft, "project").query, { usage: "场景图", objectId: "RED-01", adoption: "approved", description: { text: "暖色", source: "observed" }, source: target(1) });
checks.push("draft commands preserve source and CAS and combined search uses the exact occurrence");

class TestElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.className = ""; this.value = ""; this._text = ""; this.classList = { add: value => { this.className = [...new Set([...this.className.split(/\s+/), value])].filter(Boolean).join(" "); } }; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  setAttribute(name, value) { this.attributes[name] = value; }
  trigger(type) { for (const callback of this.listeners[type] || []) callback({ target: this, preventDefault() {} }); }
  querySelectorAll() { return all(this).filter(node => node.dataset.contextField); }
  focus() { globalThis.document.activeElement = this; }
}
const all = node => [node, ...node.children.flatMap(all)];
const find = (node, predicate) => all(node).find(predicate);
const click = (node, label) => { const control = find(node, item => item.tagName === "button" && item.textContent === label); assert.ok(control, `Missing action ${label}`); assert.equal(control.disabled, false, `${label} enabled`); control.trigger("click"); };
const previousDocument = globalThis.document;
globalThis.document = { createElement: tag => new TestElement(tag), activeElement: null };
const surface = new TestElement("details"), commands = [], windowView = createProjectContextWindowView(surface, command => commands.push(command));
windowView.render({ projectContext: projected });
assert.ok(surface.textContent.includes("AI 观察：木桌旁的暖色音箱") && surface.textContent.includes("用户标签：用户暖色标签"));
assert.ok(!surface.textContent.includes("旧观察不得继续展示") && !surface.textContent.includes("1".repeat(64)));
click(surface, "画布定位");
assert.deepEqual(commands.pop(), { type: "project-result-locate", expectedProjectId: "project", conversationId: "conversation", targets: [target(1)] });
let checkbox = find(surface, node => node.attributes["aria-label"] === "选择成果 成果 1"); checkbox.checked = true; checkbox.trigger("change");
click(surface, "作为参考图"); assert.deepEqual(commands.pop(), { type: "project-results-use", expectedProjectId: "project", conversationId: "conversation", targets: [target(1)], role: "reference" });
checkbox = find(surface, node => node.attributes["aria-label"] === "选择成果 成果 2"); checkbox.checked = true; checkbox.trigger("change");
click(surface, "比较两项"); assert.deepEqual(commands.pop().targets, [target(1), target(2)]);
click(surface, "编辑"); let contentField = find(surface, node => node.attributes["aria-label"] === "知识内容"); contentField.value = "未保存的本地草稿"; contentField.trigger("input");
windowView.render({ projectContext: { ...projected, revision: 3 } });
contentField = find(surface, node => node.attributes["aria-label"] === "知识内容"); assert.equal(contentField.value, "未保存的本地草稿");
assert.equal(find(surface, node => node.tagName === "button" && node.textContent === "保存知识").disabled, true);
assert.ok(surface.textContent.includes("知识已在另一窗口更新，草稿仍保留"));
assert.ok(all(surface).filter(node => node.tagName === "button").every(node => node.className.includes("ui-button-base") && ["button", "submit"].includes(node.type)));
checks.push("detached DOM emits project-scoped stable actions and preserves conflicting drafts while disabling stale saves");
globalThis.document = previousDocument;

const panelUrl = new URL("../src/project-context-panel.tsx", import.meta.url).href, primitiveUrl = new URL("../src/ui/primitives.tsx", import.meta.url).href;
const panelLoader = registerHooks({
  resolve(specifier, options, next) {
    if (options.parentURL === panelUrl && specifier === "./project-context") return { url: new URL("../src/project-context.ts", import.meta.url).href, shortCircuit: true };
    if (options.parentURL === panelUrl && specifier === "./ui/primitives") return { url: primitiveUrl, shortCircuit: true };
    return next(specifier, options);
  },
  load(url, options, next) { return [panelUrl, primitiveUrl].includes(url) ? { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText } : next(url, options); }
});
const { default: Panel } = await import(panelUrl); panelLoader.deregister();
const markup = renderToStaticMarkup(React.createElement(Panel, { projectContext: projected }));
for (const label of ["项目知识与成果检索", "品牌规范", "上次保存任务实际采用", "成果用途", "成果描述来源", "画布定位", "原要求："]) assert.ok(markup.includes(label), label);
assert.ok(!markup.includes("1".repeat(64)) && !markup.includes("PRIVATE-SECRET") && !markup.includes("private.example"));
checks.push("actual React panel and detached projection show the same knowledge and evidence sources without hashes or paths");

const hookKey = Symbol.for("sparkai.project-context-hook-selftest"), reactUrl = "sparkai-test:project-context-react";
const hookLoader = registerHooks({
  resolve(specifier, options, next) { return specifier === "react" ? { url: reactUrl, shortCircuit: true } : next(specifier, options); },
  load(url, options, next) { return url === reactUrl ? { format: "module", shortCircuit: true, source: ["useState", "useRef", "useCallback", "useEffect"].map(name => `export const ${name} = (...args) => globalThis[Symbol.for("sparkai.project-context-hook-selftest")].${name}(...args);`).join("\n") } : next(url, options); }
});
const { useProjectContext } = await import("../src/use-project-context.ts"); hookLoader.deregister();
const sameDeps = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
function harness(invoke) {
  const cells = [], effects = [], timers = new Map(); let cursor = 0, timerId = 0, props = ["project", "conversation", true];
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial; return [cells[slot], value => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value; }]; },
    useRef(value) { const slot = cursor++; return cells[slot] ??= { current: value }; },
    useCallback(callback, deps) { const slot = cursor++; if (!sameDeps(cells[slot]?.deps, deps)) cells[slot] = { callback, deps }; return cells[slot].callback; },
    useEffect(effect, deps) { const slot = cursor++, previous = cells[slot]; if (sameDeps(previous?.deps, deps)) return; const current = cells[slot] = { deps }; effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); }); }
  };
  globalThis.window = { naimageAgent: { projectContextCommand: invoke }, setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const render = (nextProps = props) => { props = nextProps; cursor = 0; globalThis[hookKey] = hooks; const value = useProjectContext(...props); for (const effect of effects.splice(0)) effect(); return value; };
  return { render, async poll() { const [id, callback] = timers.entries().next().value || []; assert.ok(callback); timers.delete(id); callback(); await nextTurn(); return render(); }, dispose() { for (const cell of cells) cell?.cleanup?.(); timers.clear(); } };
}
let authority = { ok: true, ...context }, searchAuthority = { ok: true, ...context.search }, mutation = { ok: false, error: "项目知识已在其他窗口变化，请刷新后重试。", errorCode: "KNOWLEDGE_CONFLICT" };
let holdSearch = null, reads = 0, searches = 0, writes = 0;
const instance = harness(async (command, args) => {
  if (command === "project.context.get") { reads++; return { ...authority, projectId: args.expectedProjectId }; }
  if (command === "project.results.search") { searches++; if (holdSearch) { const held = holdSearch; holdSearch = null; return held.promise; } return { ...searchAuthority, projectId: args.expectedProjectId }; }
  writes++; assert.equal(args.conversationId, undefined, "Knowledge schema never receives an accidental conversation field"); if (mutation instanceof Error) throw mutation; return mutation;
});
try {
  let view = instance.render(); await nextTurn(); view = instance.render();
  await view.execute("project.results.search", { expectedProjectId: "project", query: { text: "暖色" } }); view = instance.render(); assert.equal(view.snapshot.search.results.length, 2);
  await view.execute("project.knowledge.save", { expectedProjectId: "project", expectedRevision: 0, conversationId: "conversation" }); view = instance.render(); assert.equal(view.error, mutation.error);
  searchAuthority = { ...searchAuthority, results: [{ ...result(1), adoption: { state: "candidate", current: false } }] };
  view = await instance.poll(); assert.equal(view.snapshot.search.results[0].adoption.state, "candidate"); assert.equal(view.error, mutation.error, "Polling must keep CAS errors visible");
  checks.push("actual hook refreshes shown search after adoption revocation and preserves operation errors through successful polling");
  let resolveOld; holdSearch = { promise: new Promise(resolve => { resolveOld = resolve; }) };
  view = await instance.poll();
  searchAuthority = { ...searchAuthority, results: [result(2)] };
  await view.execute("project.results.search", { query: { text: "新查询" } }); view = instance.render(); assert.equal(view.snapshot.search.results[0].target.assetId, "asset-2");
  resolveOld({ ok: true, ...context.search }); await nextTurn(); view = instance.render(); assert.equal(view.snapshot.search.results[0].target.assetId, "asset-2", "Late refresh cannot replace a newer explicit search");
  checks.push("older polling search cannot replace a newer explicit query");
  mutation = new Error("IPC interrupted"); const interrupted = await view.execute("project.knowledge.status", {}); view = await instance.poll(); assert.equal(view.error, interrupted.error);
  let resolveOldProject; holdSearch = { promise: new Promise(resolve => { resolveOldProject = resolve; }) };
  const pending = view.execute("project.results.search", { query: { text: "旧项目查询" } }); await nextTurn();
  view = instance.render(["other-project", "other-conversation", true]); await nextTurn(); view = instance.render(); assert.equal(view.searchResults, null);
  resolveOldProject({ ok: true, ...context.search }); await pending; view = instance.render(); assert.equal(view.searchResults, null);
  const beforeStale = writes; const rejected = await view.execute("project.knowledge.save", { expectedProjectId: "project" }); assert.equal(rejected.errorCode, "PROJECT_CONTEXT_SCOPE_STALE"); assert.equal(writes, beforeStale);
  checks.push("disconnects remain visible, switched projects clear search, and late results and stale commands cannot cross projects");
} finally { instance.dispose(); delete globalThis.window; delete globalThis[hookKey]; }
const report = { ok: true, checks, reads, searches, writes, realModelRequests: 0 };
const reportDir = path.resolve(".diagnostics/project-context-projection", new Date().toISOString().replace(/[:.]/g, "-")); mkdirSync(reportDir, { recursive: true }); writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, report: path.join(reportDir, "report.json") }));
