import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, State } from "../src/domain";
const bridge: Bridge = {
  vault: (action) => ipcRenderer.invoke("studio:vault", action),
  imageConfig: (action) => ipcRenderer.invoke("studio:image-config", action),
  generateImage: (request) =>
    ipcRenderer.invoke("studio:image-generate", request),
  bootstrap: () => ipcRenderer.invoke("studio:bootstrap"),
  command: (command) => ipcRenderer.invoke("studio:command", command),
  preview: (article, platform) =>
    ipcRenderer.invoke("studio:preview", article, platform),
  copy: (article, platform, format) =>
    ipcRenderer.invoke("studio:copy", article, platform, format),
  onState: (callback) => {
    const listener = (_event: unknown, state: State) => callback(state);
    ipcRenderer.on("studio:state", listener);
    return () => ipcRenderer.removeListener("studio:state", listener);
  },
};
contextBridge.exposeInMainWorld("studio", bridge);
