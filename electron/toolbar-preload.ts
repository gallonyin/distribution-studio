import { ipcRenderer } from "electron";
window.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll<HTMLButtonElement>("button[data-action]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        ipcRenderer.send("platform:action", button.dataset.action),
      );
    });
  ipcRenderer.on("platform:state", (_event, state) => {
    (
      document.querySelector('[data-action="back"]') as HTMLButtonElement
    ).disabled = !state.back;
    (
      document.querySelector('[data-action="forward"]') as HTMLButtonElement
    ).disabled = !state.forward;
    const refresh = document.querySelector(
      "[data-refresh]",
    ) as HTMLButtonElement;
    refresh.dataset.action = state.loading ? "stop" : "reload";
    refresh.textContent = state.loading ? "停止" : "刷新";
    document.getElementById("label")!.textContent = state.label;
    document.getElementById("host")!.textContent = state.host;
  });
});
