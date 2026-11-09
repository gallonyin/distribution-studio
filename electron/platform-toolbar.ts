import {
  BrowserWindow,
  View,
  WebContentsView,
  ipcMain,
  dialog,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { platforms, type Account } from "../src/domain";

const homes: Partial<Record<Account["platform"], string>> = {
  wechat: "https://mp.weixin.qq.com/",
  zhihu: "https://www.zhihu.com/creator",
  csdn: "https://mp.csdn.net/",
  xiaohongshu: "https://creator.xiaohongshu.com/",
  baijiahao: "https://baijiahao.baidu.com/builder/rc/home",
  sohu: "https://mp.sohu.com/",
  toutiao: "https://mp.toutiao.com/",
  netease: "https://mp.163.com/",
  jianshu: "https://www.jianshu.com/writer",
  bilibili: "https://member.bilibili.com/",
};

export function attachPlatformToolbar(
  win: BrowserWindow,
  account: Account,
  helper: () => void,
  hasFilledContent: () => boolean,
) {
  const remote = win.webContents;
  const platformView = win.contentView;
  const root = new View();
  win.setContentView(root);
  root.addChildView(platformView);
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  root.addChildView(toolbar);
  const resize = () => {
    const [width, height] = win.getContentSize();
    platformView.setBounds({
      x: 0,
      y: 52,
      width,
      height: Math.max(0, height - 52),
    });
    toolbar.setBounds({ x: 0, y: 0, width, height: 52 });
  };
  resize();
  win.on("resize", resize);
  const url = pathToFileURL(path.join(__dirname, "toolbar.html")).href;
  toolbar.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  toolbar.webContents.on("will-navigate", (e) => e.preventDefault());
  toolbar.webContents.on("will-redirect", (e) => e.preventDefault());
  const update = () => {
    if (toolbar.webContents.isDestroyed() || remote.isDestroyed()) return;
    let host = "";
    try {
      host = new URL(remote.getURL()).hostname;
    } catch {}
    toolbar.webContents.send("platform:state", {
      back: remote.navigationHistory.canGoBack(),
      forward: remote.navigationHistory.canGoForward(),
      loading: remote.isLoading(),
      host,
      label: `${platforms[account.platform].name} · ${account.name}`,
    });
  };
  let pending = false;
  const action = async (name: string) => {
    if (win.isDestroyed() || remote.isDestroyed()) return;
    if (name === "helper") {
      helper();
      return;
    }
    if (name === "stop") {
      remote.stop();
      return;
    }
    if (pending) return;
    if (!["back", "forward", "reload", "home", "write"].includes(name)) return;
    pending = true;
    try {
      if (hasFilledContent()) {
        const { response } = await dialog.showMessageBox(win, {
          type: "question",
          message: "离开当前平台页面？",
          detail: "工作台曾向此页填入内容，请确认已在平台保存草稿。",
          buttons: ["留在此页", "继续"],
          defaultId: 0,
          cancelId: 0,
        });
        if (response !== 1 || win.isDestroyed()) return;
      }
      if (name === "back" && remote.navigationHistory.canGoBack())
        remote.navigationHistory.goBack();
      if (name === "forward" && remote.navigationHistory.canGoForward())
        remote.navigationHistory.goForward();
      if (name === "reload") remote.reload();
      if (name === "home" || name === "write")
        await remote.loadURL(
          name === "home"
            ? homes[account.platform] || platforms[account.platform].url
            : platforms[account.platform].url,
        );
    } catch (error) {
      if (
        !win.isDestroyed() &&
        (error as { code?: string }).code !== "ERR_ABORTED"
      )
        await dialog.showMessageBox(win, {
          message: "平台页面加载失败，请检查网络后重试。",
        });
    } finally {
      pending = false;
      update();
    }
  };
  const listener = (event: Electron.IpcMainEvent, name: unknown) => {
    if (
      event.sender === toolbar.webContents &&
      event.senderFrame === toolbar.webContents.mainFrame &&
      event.senderFrame.url === url &&
      typeof name === "string"
    )
      void action(name);
  };
  ipcMain.on("platform:action", listener);
  remote.on("did-start-loading", update);
  remote.on("did-stop-loading", update);
  remote.on("did-navigate", update);
  remote.on("did-navigate-in-page", update);
  remote.on("will-prevent-unload", (event) => {
    const response = dialog.showMessageBoxSync(win, {
      type: "question",
      message: "平台提示当前页面有未完成的编辑",
      detail: "离开可能丢失尚未保存的内容。",
      buttons: ["留在此页", "离开页面"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
  });
  toolbar.webContents.on("did-finish-load", update);
  remote.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    let name: string | undefined;
    if ((input.meta || input.control) && input.key === "[") name = "back";
    if ((input.meta || input.control) && input.key === "]") name = "forward";
    if (
      ((input.meta || input.control) && input.key.toLowerCase() === "r") ||
      input.key === "F5"
    )
      name = "reload";
    if (input.alt && input.key === "ArrowLeft") name = "back";
    if (input.alt && input.key === "ArrowRight") name = "forward";
    if (name) {
      event.preventDefault();
      void action(name);
    }
  });
  win.once("closed", () => {
    ipcMain.removeListener("platform:action", listener);
    if (!toolbar.webContents.isDestroyed()) toolbar.webContents.close();
  });
  void toolbar.webContents.loadURL(url);
  return action;
}
