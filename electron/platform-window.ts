import {
  BaseWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
} from "electron";

// Platform content is an ordinary child view. BrowserWindow's managed primary
// view may override native geometry when reparented alongside a toolbar.
export class PlatformWindow extends BaseWindow {
  readonly platformView: WebContentsView;
  readonly webContents: WebContentsView["webContents"];
  constructor(options: BrowserWindowConstructorOptions) {
    const { webPreferences, ...windowOptions } = options;
    super(windowOptions);
    this.platformView = new WebContentsView({ webPreferences });
    this.webContents = this.platformView.webContents;
    this.contentView.addChildView(this.platformView);
    this.on("close", (event) => {
      if (!this.webContents.isDestroyed()) {
        event.preventDefault();
        this.webContents.close({ waitForBeforeUnload: true });
      }
    });
    this.webContents.once("destroyed", () => {
      if (!this.isDestroyed()) this.destroy();
    });
    this.once("closed", () => {
      if (!this.webContents.isDestroyed()) this.webContents.close();
    });
  }
  loadURL(url: string) {
    return this.webContents.loadURL(url);
  }
}
