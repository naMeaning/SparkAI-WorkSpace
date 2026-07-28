"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { createAgentWindowService, maximumStateBytes, serializablePayload } = require("../desktop/agent-window-service.cjs");

let nextWindowId = 1;
const ownerWindows = new Map();

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.sent = [];
  }

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

class FakeWindow extends EventEmitter {
  static instances = [];

  static fromWebContents(webContents) {
    return ownerWindows.get(webContents) || null;
  }

  constructor(options) {
    super();
    this.id = nextWindowId++;
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.visible = false;
    this.focused = false;
    this.minimized = false;
    FakeWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; }
  show() { this.visible = true; }
  focus() { this.focused = true; }
  loadFile(filePath) { this.loadedFile = filePath; return Promise.resolve(); }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.emit("closed");
  }
}

const ownerWebContents = new FakeWebContents();
const ownerWindow = new FakeWindow({ owner: true });
ownerWindows.set(ownerWebContents, ownerWindow);
const service = createAgentWindowService({
  BrowserWindow: FakeWindow,
  htmlPath: "C:\\app\\agent-window.html",
  preloadPath: "C:\\app\\agent-window-preload.cjs",
  applicationName: "naimage",
  icon: { fixture: true }
});

const opened = service.open(ownerWebContents);
assert.equal(opened.ok, true);
assert.equal(opened.reused, false);
const surfaceWindow = FakeWindow.instances.at(-1);
assert.equal(surfaceWindow.loadedFile, "C:\\app\\agent-window.html");
assert.equal(surfaceWindow.options.webPreferences.nodeIntegration, false);
assert.equal(surfaceWindow.options.webPreferences.contextIsolation, true);
assert.equal(surfaceWindow.options.webPreferences.sandbox, true);
assert.equal(surfaceWindow.options.parent, undefined, "The Agent window must be free to move outside the main window");
assert.deepEqual(surfaceWindow.webContents.windowOpenHandler(), { action: "deny" });

const foreignWebContents = new FakeWebContents();
assert.equal(service.publishState(foreignWebContents, { version: 1 }).ok, false);
assert.equal(service.publishState(ownerWebContents, { version: 1, projectName: "fixture" }).ok, true);
assert.deepEqual(surfaceWindow.webContents.sent.at(-1), {
  channel: "naimage:agent-window:state",
  payload: { version: 1, projectName: "fixture" }
});

assert.equal(service.surfaceReady(foreignWebContents).ok, false);
assert.equal(service.surfaceReady(surfaceWindow.webContents).ok, true);
assert.deepEqual(ownerWebContents.sent.at(-1), {
  channel: "naimage:agent-window:command",
  payload: { type: "request-state" }
});

assert.equal(service.forwardCommand(foreignWebContents, { type: "stop" }).ok, false);
assert.equal(service.forwardCommand(surfaceWindow.webContents, { type: "stop" }).ok, true);
assert.deepEqual(ownerWebContents.sent.at(-1).payload, { type: "stop" });
assert.equal(service.forwardCommand(surfaceWindow.webContents, { type: "edit-memory" }).ok, true);
assert.equal(ownerWindow.visible, true);
assert.equal(ownerWindow.focused, true);

assert.equal(serializablePayload({ value: "x".repeat(maximumStateBytes) }, maximumStateBytes), null);
assert.equal(service.publishState(ownerWebContents, { value: "x".repeat(maximumStateBytes) }).ok, false);
assert.equal(service.open(ownerWebContents).reused, true);
assert.equal(service.status(ownerWebContents).open, true);
assert.equal(service.status(ownerWebContents).owner, true);

assert.equal(service.close(foreignWebContents).ok, false);
assert.equal(service.close(ownerWebContents).ok, true);
assert.equal(service.status(ownerWebContents).open, false);
assert.deepEqual(ownerWebContents.sent.at(-1), {
  channel: "naimage:agent-window:command",
  payload: { type: "closed" }
});

const reopened = service.open(ownerWebContents);
assert.equal(reopened.ok, true);
const reopenedWindow = FakeWindow.instances.at(-1);
ownerWebContents.destroyed = true;
ownerWebContents.emit("destroyed");
assert.equal(reopenedWindow.destroyed, true, "The Agent window must close when its authoritative renderer disappears");

const repoRoot = path.resolve(__dirname, "..");
const packagedSurfaceFiles = ["agent-window.html", "agent-window.css", "agent-window-renderer.js", "agent-window-preload.cjs"];
const packageMetadata = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
for (const file of packagedSurfaceFiles) {
  assert.equal(existsSync(path.join(repoRoot, file)), true, `Missing Agent window surface file: ${file}`);
  assert.equal(packageMetadata.build.files.includes(file), true, `Agent window surface is not packaged: ${file}`);
}
const surfaceHtml = readFileSync(path.join(repoRoot, "agent-window.html"), "utf8");
assert.match(surfaceHtml, /agent-window\.css/);
assert.match(surfaceHtml, /agent-window-renderer\.js/);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 36 })}\n`);
