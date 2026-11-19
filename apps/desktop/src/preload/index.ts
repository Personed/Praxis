import { contextBridge, ipcRenderer } from "electron";
import { createModusApi } from "./api";
import type { ModusTransport } from "./transport";

const transport: ModusTransport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  env: {
    platform: process.platform,
    systemVersion: process.getSystemVersion?.() ?? "",
    argv: process.argv,
  },
};

contextBridge.exposeInMainWorld("modus", createModusApi(transport));
