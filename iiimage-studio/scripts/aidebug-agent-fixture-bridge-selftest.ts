import assert from "node:assert/strict";

import { installAgentFixtureBridge } from "../src/aidebug/agent-fixture-bridge.ts";

type TimerRecord = { callback: () => void; delay: number };

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const timers = new Map<number, TimerRecord>();
let nextTimerId = 1;
const testWindow = {
  setTimeout(callback: () => void, delay: number) {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id: number) {
    timers.delete(id);
  }
};
Object.defineProperty(globalThis, "window", { configurable: true, value: testWindow });

let stagedMessages: any[] = [];
const publishedMessages: any[][] = [];
const appliedActions: unknown[][] = [];

try {
  const cleanup = installAgentFixtureBridge({
    applyActions(actions) {
      appliedActions.push(actions);
    },
    readMessages() {
      return stagedMessages;
    },
    stageMessages(messages) {
      stagedMessages = messages;
    },
    publishMessages(messages) {
      publishedMessages.push(messages);
    },
    nowLabel() {
      return "10:30";
    }
  });

  const actionHook = testWindow.__iiimageDebugApplyAgentActions!;
  const messageHook = testWindow.__iiimageDebugSeedAgentMessages!;
  assert.equal(actionHook({} as never), false);
  const actions = [{ type: "workflow.canvas.clear", mode: "all" }];
  assert.equal(actionHook(actions as never), true);
  assert.equal(appliedActions.length, 1);
  assert.equal(appliedActions[0], actions);

  assert.equal(messageHook(), false);
  assert.equal(messageHook(null), false);
  assert.equal(messageHook({ messages: [] }), false);

  const pasteBlocks = Array.from({ length: 6 }, (_, index) => ({
    id: index === 0 ? "paste-explicit" : "",
    text: `paste-${index}`,
    createdAt: index === 0 ? "09:00" : undefined
  }));
  const prompts = Array.from({ length: 12 }, (_, index) => ({ title: `title-${index}`, prompt: `prompt-${index}` }));
  assert.equal(messageHook({
    messages: [{
      id: "stream-message",
      role: "invalid" as never,
      content: "start|",
      status: "running",
      pasteBlocks,
      toolTrace: { stage: "result", label: "", name: "", operation: "", params: "p", brief: "b", prompts }
    }]
  }), true);
  assert.equal(stagedMessages.length, 1);
  assert.equal(stagedMessages[0].role, "assistant");
  assert.equal(stagedMessages[0].status, "running");
  assert.equal(stagedMessages[0].createdAt, "10:30");
  assert.equal(stagedMessages[0].pasteBlocks.length, 4);
  assert.equal(stagedMessages[0].pasteBlocks[0].id, "paste-explicit");
  assert.equal(stagedMessages[0].pasteBlocks[1].createdAt, "10:30");
  assert.equal(stagedMessages[0].toolTrace.prompts.length, 10);
  assert.equal(stagedMessages[0].toolTrace.stage, "result");
  assert.equal(stagedMessages[0].toolTrace.label, "工具");
  assert.equal(stagedMessages[0].toolTrace.name, "debug_tool");
  assert.equal(stagedMessages[0].toolTrace.operation, "测试操作");
  assert.equal(publishedMessages.at(-1), stagedMessages);

  const publishCountBeforeStream = publishedMessages.length;
  assert.equal(messageHook({ streamDelta: { id: "missing", delta: "nope" } }), false);
  assert.equal(messageHook({ streamDelta: { id: "stream-message", delta: "A", status: "running" } }), true);
  assert.equal(stagedMessages[0].content, "start|A");
  assert.equal(publishedMessages.length, publishCountBeforeStream);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0]?.delay, 32);
  assert.equal(messageHook({ streamDelta: { id: "stream-message", delta: "B", status: "running" } }), true);
  assert.equal(stagedMessages[0].content, "start|AB");
  assert.equal(timers.size, 1);

  const [flushTimerId, flushTimer] = [...timers.entries()][0]!;
  timers.delete(flushTimerId);
  flushTimer.callback();
  assert.equal(publishedMessages.at(-1)?.[0]?.content, "start|AB");
  assert.notEqual(publishedMessages.at(-1), stagedMessages);

  assert.equal(messageHook({ streamDelta: { id: "stream-message", delta: "C", status: "running" } }), true);
  assert.equal(timers.size, 1);
  assert.equal(messageHook({ streamDelta: { id: "stream-message", delta: "D", status: "done" } }), true);
  assert.equal(timers.size, 0);
  assert.equal(stagedMessages[0].content, "start|ABCD");
  assert.equal(stagedMessages[0].status, "done");
  assert.equal(publishedMessages.at(-1)?.[0]?.content, "start|ABCD");

  const manyMessages = Array.from({ length: 130 }, (_, index) => ({ id: `old-${index}`, role: "assistant" as const, content: String(index) }));
  assert.equal(messageHook({ messages: manyMessages, maxMessages: 1000 }), true);
  assert.equal(stagedMessages.length, 130);
  assert.equal(messageHook({ messages: [{ id: "new", role: "user", content: "new" }], append: true, maxMessages: 1 }), true);
  assert.equal(stagedMessages.length, 120);
  assert.equal(stagedMessages[0].id, "old-11");
  assert.equal(stagedMessages.at(-1)?.id, "new");

  assert.equal(messageHook({ streamDelta: { id: "new", delta: "pending", status: "running" } }), true);
  assert.equal(timers.size, 1);
  assert.equal(messageHook({ clear: true }), true);
  assert.equal(timers.size, 0);
  assert.deepEqual(stagedMessages, []);
  assert.deepEqual(publishedMessages.at(-1), []);

  assert.equal(messageHook({ messages: [{ id: "cleanup-stream", role: "assistant", content: "start", status: "running" }] }), true);
  assert.equal(messageHook({ streamDelta: { id: "cleanup-stream", delta: "pending", status: "running" } }), true);
  assert.equal(timers.size, 1);
  cleanup();
  assert.equal(testWindow.__iiimageDebugApplyAgentActions, undefined);
  assert.equal(testWindow.__iiimageDebugSeedAgentMessages, undefined);
  assert.equal(timers.size, 0);
} finally {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, cases: 57 })}\n`);
