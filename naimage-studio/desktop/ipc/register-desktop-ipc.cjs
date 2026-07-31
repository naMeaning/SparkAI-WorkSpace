"use strict";

const { registerAgentIpc } = require("./agent-ipc.cjs");
const { registerAutomationIpc } = require("./automation-ipc.cjs");
const { registerAssetIpc } = require("./asset-ipc.cjs");
const { registerRequirementLibraryIpc, registerSettingsIpc, registerSessionIpc } = require("./config-ipc.cjs");
const { registerDebugIpc } = require("./debug-ipc.cjs");
const { registerProjectIpc } = require("./project-ipc.cjs");
const { registerPluginIpc } = require("./plugin-ipc.cjs");
const { registerServerIpc } = require("./server-ipc.cjs");
const { registerUpdateIpc } = require("./update-ipc.cjs");
const { registerWindowIpc } = require("./window-ipc.cjs");

function registerDesktopIpc(dependencies = {}) {
  registerSettingsIpc(dependencies);
  registerRequirementLibraryIpc(dependencies);
  registerPluginIpc(dependencies);
  registerAutomationIpc(dependencies);
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
