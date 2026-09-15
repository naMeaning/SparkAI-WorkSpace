"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("naimageAgentWindowSurface", {
  ready: () => ipcRenderer.send("naimage:agent-window:ready"),
  command: (payload) => ipcRenderer.send("naimage:agent-window:command", payload),
  onState: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:agent-window:state", listener);
    return () => ipcRenderer.removeListener("naimage:agent-window:state", listener);
  }
});
