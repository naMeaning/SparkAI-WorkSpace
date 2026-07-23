"use strict";

const { registerAgentIpc } = require("./agent-ipc.cjs");
const { registerAssetIpc } = require("./asset-ipc.cjs");
const { registerSettingsIpc, registerSessionIpc } = require("./config-ipc.cjs");
const { registerDebugIpc } = require("./debug-ipc.cjs");
const { registerProjectIpc } = require("./project-ipc.cjs");
const { registerServerIpc } = require("./server-ipc.cjs");
const { registerUpdateIpc } = require("./update-ipc.cjs");
const { registerWindowIpc } = require("./window-ipc.cjs");

function registerDesktopIpc(dependencies = {}) {
  registerSettingsIpc(dependencies);
  registerUpdateIpc(dependencies);
  registerSessionIpc(dependencies);
  registerAgentIpc(dependencies);
  registerWindowIpc(dependencies);
  registerDebugIpc(dependencies);
  registerProjectIpc(dependencies);
  registerAssetIpc(dependencies);
  registerServerIpc(dependencies);
}

module.exports = { registerDesktopIpc };
