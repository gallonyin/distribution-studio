import { BrowserWindow } from "electron";
function chromeIdentity() {
  const fullVersion = process.versions.chrome;
  const version = fullVersion.split(".")[0];
  const mac = process.platform === "darwin";
  const windows = process.platform === "win32";
  const platform = mac ? "macOS" : windows ? "Windows" : "Linux";
  const system = mac
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : windows
      ? "Windows NT 10.0; Win64; x64"
      : "X11; Linux x86_64";
  return {
    userAgent: `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVersion} Safari/537.36`,
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    platform,
    userAgentMetadata: {
      brands: [
        { brand: "Not_A Brand", version: "99" },
        { brand: "Chromium", version },
        { brand: "Google Chrome", version },
      ],
      fullVersionList: [
        { brand: "Not_A Brand", version: "99.0.0.0" },
        { brand: "Chromium", version: fullVersion },
        { brand: "Google Chrome", version: fullVersion },
      ],
      fullVersion,
      platform,
      platformVersion: mac ? "10.15.7" : windows ? "10.0.0" : "6.0.0",
      architecture: process.arch === "arm64" ? "arm" : "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
  };
}
export async function applyChromeIdentity(
  win: Pick<BrowserWindow, "webContents" | "isDestroyed">,
) {
  try {
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Network.enable");
    await win.webContents.debugger.sendCommand(
      "Network.setUserAgentOverride",
      chromeIdentity(),
    );
  } catch {}
}
