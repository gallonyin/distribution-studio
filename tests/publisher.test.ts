import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { PlatformWindow as BrowserWindow } from "../electron/platform-window";
import { Publisher } from "../electron/publisher";
import { Execution } from "../electron/execution";
import type { Store } from "../electron/store";
import type { FillRequest } from "../electron/inject";
import type { Account } from "../src/domain";

vi.mock("electron", () => ({
  BrowserWindow: {},
  BaseWindow: class {},
  Menu: {},
  session: {},
  dialog: {},
}));
const disposed = () =>
  Error("Render frame was disposed before WebFrameMain could be accessed");
const account: Account = {
  id: "test",
  name: "test",
  platform: "wechat",
  status: "unknown",
};
const request: FillRequest = {
  mode: "probe",
  platform: "wechat",
  title: "测试",
  text: "正文",
  html: "<p>正文</p>",
  markdown: "正文",
  images: [],
};
const found = {
  titleFound: true,
  bodyFound: true,
  titleFilled: false,
  bodyFilled: false,
  conflict: false,
  message: "",
  imagesSubmitted: 0,
};
function setup() {
  const frame = {
    url: "https://mp.weixin.qq.com/",
    executeJavaScript: vi.fn(async () => found),
    framesInSubtree: [] as unknown[],
  };
  frame.framesInSubtree = [frame];
  const webContents = {
    isDestroyed: () => false,
    getURL: () => frame.url,
    mainFrame: frame,
  };
  // Only Electron's lifetime boundary is simulated; exercise the real evaluator.
  const win = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  const publisher = new Publisher(
    {} as Store,
    fileURLToPath(new URL("../electron/inject.ts", import.meta.url)),
  );
  return { frame, webContents, win, publisher };
}
describe("页面 frame 生命周期", () => {
  for (const mode of ["probe", "inspect", "fill"] as const)
    it(`${mode} 阶段子 frame 的弹窗关闭失败会停止任务`, async () => {
      const { frame, win, publisher } = setup();
      const after = {
        url: "https://mp.weixin.qq.com/editor",
        executeJavaScript: vi.fn(),
      };
      frame.framesInSubtree.push(
        {
          url: "https://mp.weixin.qq.com/editor",
          executeJavaScript: async () => ({
            ...found,
            blocked: true,
            notice: "弹窗未能关闭，请人工处理。",
          }),
        },
        after,
      );
      await expect(
        publisher.evaluate(win, account, { ...request, mode }),
      ).rejects.toThrow("弹窗未能关闭");
      expect(after.executeJavaScript).not.toHaveBeenCalled();
    });

  it("探测时子 frame 地址读取失效，丢弃本轮结果并允许重新探测", async () => {
    const { frame, win, publisher } = setup();
    frame.framesInSubtree.push({
      get url() {
        throw disposed();
      },
    });
    expect(await publisher.evaluate(win, account, request)).toEqual([]);
    frame.framesInSubtree = [frame];
    expect(await publisher.evaluate(win, account, request)).toEqual([found]);
  });
  it("获取 frame 列表时失效也可以重新探测", async () => {
    const { frame, win, publisher } = setup();
    Object.defineProperty(frame, "framesInSubtree", {
      get() {
        throw disposed();
      },
    });
    expect(await publisher.evaluate(win, account, request)).toEqual([]);
  });
  it("主 frame 脚本因跳转失效，不直接终止探测", async () => {
    const { frame, win, publisher } = setup();
    frame.executeJavaScript.mockRejectedValueOnce(disposed());
    expect(await publisher.evaluate(win, account, request)).toEqual([]);
    expect(await publisher.evaluate(win, account, request)).toEqual([found]);
  });
  for (const mode of ["inspect", "fill"] as const)
    it(`${mode} 阶段失效时停止并提示检查草稿，不自动重写`, async () => {
      const { frame, win, publisher } = setup();
      frame.executeJavaScript.mockRejectedValueOnce(disposed());
      await expect(
        publisher.evaluate(win, account, { ...request, mode }),
      ).rejects.toThrow("页面已切换或编辑器已关闭");
      expect(frame.executeJavaScript).toHaveBeenCalledTimes(1);
    });
  it("取消优先于失效重试", async () => {
    const { frame, win, publisher } = setup();
    const execution = new Execution();
    frame.executeJavaScript.mockImplementationOnce(async () => {
      execution.abort("用户取消任务。");
      throw disposed();
    });
    await expect(
      publisher.evaluate(win, account, request, execution),
    ).rejects.toThrow("用户取消任务");
  });
  it("主 frame 的其他脚本错误不被当作跳转忽略", async () => {
    const { frame, win, publisher } = setup();
    frame.executeJavaScript.mockRejectedValueOnce(Error("脚本逻辑错误"));
    await expect(publisher.evaluate(win, account, request)).rejects.toThrow(
      "脚本逻辑错误",
    );
  });
  it("未允许的子 frame 仍不能执行脚本", async () => {
    const { frame, win, publisher } = setup();
    const other = { url: "https://example.com/", executeJavaScript: vi.fn() };
    frame.framesInSubtree.push(other);
    expect(await publisher.evaluate(win, account, request)).toEqual([found]);
    expect(other.executeJavaScript).not.toHaveBeenCalled();
  });
});
