import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { setImmediate as nextTurn } from "node:timers/promises";

// Exercise the actual hook with deterministic React state/effect scheduling and
// IPC responses; no renderer, application instance or model service is opened.
const hookKey = Symbol.for("sparkai.creation-session-hook-selftest");
const reactUrl = "sparkai-test:creation-session-react";
const reactHooks = ["useState", "useRef", "useCallback", "useEffect"];
const loader = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "react" ? { url: reactUrl, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === reactUrl ? { format: "module", shortCircuit: true,
      source: reactHooks.map(name => `export const ${name} = (...args) => globalThis[Symbol.for("sparkai.creation-session-hook-selftest")].${name}(...args);`).join("\n") }
      : next(url, context);
  }
});
const { useCreationSession } = await import("../src/use-creation-session.ts");
loader.deregister();

const sameDeps = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
function harness(invoke) {
  const cells = [], effects = [], timers = new Map();
  let cursor = 0, timerId = 0, props = ["project", "conversation", true];
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
      return [cells[slot], value => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value; }];
    },
    useRef(value) { const slot = cursor++; return cells[slot] ??= { current: value }; },
    useCallback(callback, deps) {
      const slot = cursor++;
      if (!sameDeps(cells[slot]?.deps, deps)) cells[slot] = { callback, deps };
      return cells[slot].callback;
    },
    useEffect(effect, deps) {
      const slot = cursor++, previous = cells[slot];
      if (sameDeps(previous?.deps, deps)) return;
      const current = cells[slot] = { deps };
      effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
    }
  };
  globalThis.window = { naimageAgent: { creationCommand: invoke },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const render = (nextProps = props) => {
    props = nextProps; cursor = 0; globalThis[hookKey] = hooks;
    const value = useCreationSession(...props);
    for (const effect of effects.splice(0)) effect();
    return value;
  };
  return { render, async poll() {
    const [id, callback] = timers.entries().next().value || [];
    assert.ok(callback, "The mounted hook schedules its next authority read");
    timers.delete(id); callback(); await nextTurn();
    return render();
  }, dispose() { for (const cell of cells) cell?.cleanup?.(); timers.clear(); } };
}

const locator = { expectedProjectId: "project", conversationId: "conversation" };
const authority = { ok: true, requirements: null, results: [] };
let mutation = { ok: false, error: "要求已在另一窗口更新。", errorCode: "CREATION_REQUIREMENTS_CONFLICT" };
let readResult = authority, reads = 0, writes = 0;
const instance = harness(async command => {
  if (command === "creation.acceptance.get") { reads++; return readResult; }
  writes++;
  if (mutation instanceof Error) throw mutation;
  return mutation;
});
try {
  let view = instance.render(); await nextTurn(); view = instance.render();
  const rejected = await view.execute("creation.requirements.update", locator);
  assert.equal(rejected.ok, false);
  view = instance.render();
  assert.equal(view.error, mutation.error, "A successful refresh must preserve the failed operation for both windows");
  assert.equal(view.busy, false);
  assert.ok(reads >= 2, "The rejected operation still refreshes the authority snapshot");
  for (let index = 0; index < 2; index++) view = await instance.poll();
  assert.equal(view.error, mutation.error, "Later automatic polls must not erase an unresolved operation error");

  mutation = { ok: true };
  await view.execute("creation.requirements.update", locator); view = instance.render();
  assert.equal(view.error, "", "A successful retry clears the prior operation error");

  readResult = { ok: false, error: "读取暂时失败。" };
  await view.refresh(); view = instance.render(); assert.equal(view.error, readResult.error);
  readResult = authority;
  await view.refresh(); view = instance.render(); assert.equal(view.error, "", "A recovered read clears only the read failure");

  mutation = new Error("IPC interrupted");
  const interrupted = await view.execute("creation.acceptance.decide", locator);
  view = await instance.poll();
  assert.equal(view.error, interrupted.error, "A lost mutation receipt remains visible after authority polling");

  view = instance.render(["project", "another-conversation", true]); await nextTurn(); view = instance.render();
  assert.equal(view.error, "", "Switching conversation clears errors from the old context");
  const beforeStale = writes;
  const stale = await view.execute("creation.acceptance.decide", locator); view = instance.render();
  assert.equal(stale.errorCode, "CREATION_SCOPE_STALE");
  assert.equal(view.error, stale.error, "A stale detached-window command receives visible feedback");
  assert.equal(writes, beforeStale, "A stale command never reaches IPC");
  console.log(JSON.stringify({ ok: true, checks: 7, reads, writes, realModelRequests: 0 }));
} finally { instance.dispose(); delete globalThis.window; delete globalThis[hookKey]; }
