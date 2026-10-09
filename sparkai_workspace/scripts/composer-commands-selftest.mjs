import assert from "node:assert/strict";
import { composerCommands, parseComposerInput, composerCommandSuggestions, composerCommandError } from "../runtime/composer-commands.mjs";

const idle = { busy: false, paused: false, stopPending: false, goalActive: false, goalAvailable: true };
assert.equal(new Set(composerCommands.map((item) => item.name)).size, 8);
assert.deepEqual(parseComposerInput(" 描述图片 https://example.com/goal "), { kind: "text", text: "描述图片 https://example.com/goal" });
assert.deepEqual(parseComposerInput(" /GOAL 把商品换成\n白色背景 "), { kind: "command", name: "goal", argument: "把商品换成\n白色背景" });
assert.deepEqual(parseComposerInput("/oops"), { kind: "unknown", name: "oops" });
assert.deepEqual(composerCommandSuggestions("/GO").map((item) => item.name), ["goal"]);
assert.equal(composerCommandSuggestions("/").length, 8);
assert.deepEqual(composerCommandSuggestions("/goal 要求"), []);
assert.deepEqual(composerCommandSuggestions("普通 /goal"), []);
assert.deepEqual(composerCommandSuggestions("/unknown"), []);
assert.match(composerCommandError(parseComposerInput("/"), idle), /未知命令/);
assert.match(composerCommandError(parseComposerInput("/oops"), idle), /未知命令/);
assert.match(composerCommandError(parseComposerInput("/goal"), idle), /处理要求/);
assert.match(composerCommandError(parseComposerInput("/goal 要求"), { ...idle, goalAvailable: false }), /暂无可执行/);
assert.match(composerCommandError(parseComposerInput("/goal 要求"), { ...idle, busy: true }), /先结束/);
assert.equal(composerCommandError(parseComposerInput("/goal 修改"), { ...idle, busy: true, goalActive: true }), "");
assert.equal(composerCommandError(parseComposerInput("/goal 要求"), idle), "");
for (const name of ["pause", "resume", "stop"]) assert.match(composerCommandError(parseComposerInput(`/${name}`), idle), /没有运行/);
assert.equal(composerCommandError(parseComposerInput("/pause"), { ...idle, busy: true }), "");
assert.match(composerCommandError(parseComposerInput("/pause"), { ...idle, busy: true, paused: true }), /已暂停/);
assert.match(composerCommandError(parseComposerInput("/resume"), { ...idle, busy: true }), /尚未暂停/);
assert.equal(composerCommandError(parseComposerInput("/resume"), { ...idle, busy: true, paused: true }), "");
assert.equal(composerCommandError(parseComposerInput("/stop"), { ...idle, busy: true }), "");
for (const command of composerCommands) {
  if (command.takesArgument) continue;
  assert.match(composerCommandError(parseComposerInput(`/${command.name} extra`), idle), /不需要参数/);
  if (["help", "status"].includes(command.name)) assert.equal(composerCommandError(parseComposerInput(`/${command.name}`), { ...idle, stopPending: true }), "");
  else assert.match(composerCommandError(parseComposerInput(`/${command.name}`), { ...idle, stopPending: true }), /正在确认结束/);
}
console.log(JSON.stringify({ ok: true, commands: composerCommands.length }));
