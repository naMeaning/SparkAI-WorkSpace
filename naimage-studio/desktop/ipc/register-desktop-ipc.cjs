"use strict";

const { registerAgentIpc } = require("./agent-ipc.cjs");
const { registerAutomationIpc } = require("./automation-ipc.cjs");
const { registerAssetIpc } = require("./asset-ipc.cjs");
const { registerCommerceCatalogIpc } = require("./commerce-catalog-ipc.cjs");
const { registerCommerceExportIpc } = require("./commerce-export-ipc.cjs");
const { registerCommerceTemplateIpc } = require("./commerce-template-ipc.cjs");
const { registerGlassBackgroundIpc, registerRequirementLibraryIpc, registerSettingsIpc, registerSessionIpc } = require("./config-ipc.cjs");
const { registerDebugIpc } = require("./debug-ipc.cjs");
const { registerImageCollectionIpc } = require("./image-collection-ipc.cjs");
const { registerProjectIpc } = require("./project-ipc.cjs");
const { registerPluginIpc } = require("./plugin-ipc.cjs");
const { registerServerIpc } = require("./server-ipc.cjs");
const { registerScientificIpc } = require("./scientific-ipc.cjs");
const { registerSocialExportIpc } = require("./social-export-ipc.cjs");
const { registerUpdateIpc } = require("./update-ipc.cjs");
const { registerVideoTaskIpc } = require("./video-task-ipc.cjs");
const { registerWindowIpc } = require("./window-ipc.cjs");

function registerDesktopIpc(dependencies = {}) {
  registerSettingsIpc(dependencies);
  registerGlassBackgroundIpc(dependencies);
  registerRequirementLibraryIpc(dependencies);
  registerCommerceTemplateIpc(dependencies);
  registerCommerceCatalogIpc(dependencies);
  registerCommerceExportIpc(dependencies);
  registerSocialExportIpc(dependencies);
  registerScientificIpc(dependencies);
  registerPluginIpc(dependencies);
  registerAutomationIpc(dependencies);
  registerUpdateIpc(dependencies);
  registerSessionIpc(dependencies);
  registerAgentIpc(dependencies);
  registerWindowIpc(dependencies);
  registerDebugIpc(dependencies);
  registerProjectIpc(dependencies);
  registerImageCollectionIpc(dependencies);
  registerAssetIpc(dependencies);
  registerServerIpc(dependencies);
  registerVideoTaskIpc(dependencies);
}

module.exports = { registerDesktopIpc };
