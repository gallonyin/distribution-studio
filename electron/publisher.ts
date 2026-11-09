import { checkAccountHealth } from "./account-health";
import { boundedMap } from "./account-health-signals";
import { BrowserWindow, Menu, session, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  platforms,
  allowedPlatformUrl,
  type Account,
  type Job,
} from "../src/domain";
import { Store } from "./store";
import { makePreview } from "./content";
import type { FillRequest, FillResult } from "./inject";
import { Execution } from "./execution";
import { randomUUID } from "node:crypto";
import { attachPlatformToolbar } from "./platform-toolbar";
import {
  platformNavigationUrl,
  platformNavigationFilters,
} from "./platform-navigation";
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
async function applyChromeIdentity(win: BrowserWindow) {
  try {
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Network.enable");
    await win.webContents.debugger.sendCommand(
      "Network.setUserAgentOverride",
      chromeIdentity(),
    );
  } catch {}
}
function frameWasDisposed(error: unknown) {
  return /Render frame was disposed before WebFrameMain could be accessed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
export class Publisher {
  private filledWindows = new WeakSet<BrowserWindow>();
  windows = new Map<string, BrowserWindow>();
  busy = false;
  private active?: {
    job: Job;
    execution: Execution;
    id: string;
    done: Promise<void>;
  };
  private cancellingAll = false;
  private cooldown = new Map<string, number>();
  timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private store: Store,
    private bundlePath: string,
    private loginHelper?: (id: string, win: BrowserWindow) => void,
  ) {}
  start() {
    this.timer = setInterval(() => void this.tick(), 1500);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  account(id: string) {
    const a = this.store.state.accounts.find((a) => a.id === id);
    if (!a) throw Error("账号不存在");
    return a;
  }
  async open(
    id: string,
    execution = new Execution(),
    withHelper = false,
  ): Promise<BrowserWindow> {
    execution.check();
    const a = this.account(id);
    let win = this.windows.get(id);
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      if (withHelper) this.loginHelper?.(id, win);
      return win;
    }
    const partition = `persist:account-${a.id}`;
    const ses = session.fromPartition(partition);
    const navigationFilters = platformNavigationFilters(a.platform);
    if (navigationFilters.length)
      ses.webRequest.onBeforeRequest(
        { urls: navigationFilters },
        (details, cb) => {
          // Do not rewrite API requests, POST bodies, images or signed assets.
          if (
            details.resourceType !== "mainFrame" ||
            details.method !== "GET"
          ) {
            cb({});
            return;
          }
          const target = platformNavigationUrl(a.platform, details.url);
          cb(target && target !== details.url ? { redirectURL: target } : {});
        },
      );
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    win = new BrowserWindow({
      width: 1200,
      height: 860,
      minWidth: 720,
      minHeight: 480,
      title: `${a.name} · ${platforms[a.platform].name}`,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.on("page-title-updated", (event) => {
      event.preventDefault();
      win!.setTitle(`${a.name} · ${platforms[a.platform].name}`);
    });
    if (a.platform !== "web") {
      await win.loadURL("about:blank");
      await applyChromeIdentity(win);
    }
    const navigate = (url: string) => {
      void win!.loadURL(url).catch((error: Error & { code?: string }) => {
        if (error.code === "ERR_ABORTED") return;
        if (!win!.isDestroyed())
          void dialog.showMessageBox(win!, {
            type: "error",
            message: "平台页面加载失败",
            detail: "请检查网络连接，再从平台窗口菜单重新加载。",
          });
      });
    };
    let showingBlockedNavigation = false;
    const blockedNavigation = (value: string) => {
      if (showingBlockedNavigation || win!.isDestroyed()) return;
      showingBlockedNavigation = true;
      // Never expose login tokens, query parameters, fragments or credentials.
      let destination = "无法识别的地址";
      try {
        const url = new URL(value);
        destination = url.origin;
      } catch {}
      void dialog
        .showMessageBox(win!, {
          type: "info",
          message: "已拦截平台范围外的跳转",
          detail: `这是分发工作台的导航限制，并非平台风控提示。目标站点：${destination}。若登录停留在原页，请从「平台窗口」菜单重新打开创作入口。`,
        })
        .finally(() => {
          showingBlockedNavigation = false;
        });
    };
    const safe = (_event: Electron.Event, url: string) => {
      const target = platformNavigationUrl(a.platform, url);
      if (!target) {
        _event.preventDefault();
        blockedNavigation(url);
      } else if (new URL(url).protocol === "http:") {
        _event.preventDefault();
        navigate(target);
      }
    };
    win.webContents.on("will-navigate", safe);
    win.webContents.on("will-redirect", safe);
    win.webContents.setWindowOpenHandler(({ url }) => {
      const target = platformNavigationUrl(a.platform, url);
      if (target) navigate(target);
      else blockedNavigation(url);
      return { action: "deny" };
    });
    win.webContents.on("will-attach-webview", (e) => e.preventDefault());
    const platformWindow = win;
    const toolbarAction = attachPlatformToolbar(
      win,
      a,
      () => this.loginHelper?.(id, platformWindow),
      () => this.filledWindows.has(platformWindow),
    );
    win.webContents.on("did-navigate", () =>
      this.filledWindows.delete(platformWindow),
    );
    const platformMenu = Menu.buildFromTemplate([
      { label: "分发工作台", submenu: [{ role: "about" }, { role: "quit" }] },
      {
        label: "平台窗口",
        submenu: [
          {
            label: "返回",
            click: () => {
              void toolbarAction("back");
            },
          },
          { label: "前进", click: () => void toolbarAction("forward") },
          { label: "重新加载", click: () => void toolbarAction("reload") },
          { label: "平台后台", click: () => void toolbarAction("home") },
          {
            label: "打开创作入口",
            click: () => void toolbarAction("write"),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]);
    win.setMenu(platformMenu);
    if (process.platform === "darwin")
      win.on("focus", () => Menu.setApplicationMenu(platformMenu));
    this.windows.set(id, win);
    if (withHelper) this.loginHelper?.(id, win);
    win.on("closed", () => this.windows.delete(id));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let ready!: () => void;
    const domReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    win.webContents.once("dom-ready", ready);
    try {
      await execution.wait(
        Promise.race([
          win.loadURL(platforms[a.platform].url),
          domReady,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              if (!win!.isDestroyed()) win!.webContents.stop();
              reject(Error("平台页面加载超时，请检查网络后重新加载。"));
            }, 30000);
          }),
        ]),
        31000,
        "平台页面加载超时，请检查网络后重新加载。",
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!win.isDestroyed())
        win.webContents.removeListener("dom-ready", ready);
    }
    return win;
  }
  async evaluate(
    win: BrowserWindow,
    account: Account,
    request: FillRequest,
    execution = new Execution(),
  ): Promise<FillResult[]> {
    execution.check();
    if (win.isDestroyed() || win.webContents.isDestroyed())
      throw Error("平台窗口已关闭，请重新打开后继续。");
    if (!allowedPlatformUrl(account.platform, win.webContents.getURL()))
      throw Error("当前不是该平台的安全页面。");
    const bundle = fs.readFileSync(this.bundlePath, "utf8");
    const result: FillResult[] = [];
    try {
      const mainFrame = win.webContents.mainFrame;
      // Snapshot handles can become invalid while awaiting another frame's script.
      // Keep both enumeration and URL access inside the lifetime error boundary.
      for (const frame of mainFrame.framesInSubtree) {
        execution.check();
        if (
          frame.url !== "about:blank" &&
          !allowedPlatformUrl(account.platform, frame.url)
        )
          continue;
        let filled: FillResult;
        try {
          const deadline = Math.min(Date.now() + 8000, execution.deadline);
          execution.leaseUntil = Math.max(execution.leaseUntil, deadline);
          const r = await execution.wait(
            frame.executeJavaScript(
              `${bundle}\nStudioAdapter.run(${JSON.stringify({ ...request, deadline })})`,
              true,
            ),
            8000,
            "编辑器脚本响应超时，请检查平台草稿后继续。",
          );
          filled = r as FillResult;
          if (
            request.mode === "fill" &&
            (filled.titleFilled || filled.bodyFilled)
          )
            this.filledWindows.add(win);
        } catch (e) {
          execution.check();
          if (frame === mainFrame || frameWasDisposed(e)) throw e;
          continue;
        }
        if (filled.notice && request.taskId)
          this.store.updateJob(request.taskId, {}, filled.notice);
        if (filled.blocked)
          throw Error(filled.notice ?? "平台弹窗需要人工处理。");
        result.push(filled);
      }
      return result;
    } catch (error) {
      execution.check();
      if (win.isDestroyed() || win.webContents.isDestroyed())
        throw Error("平台窗口已关闭，请重新打开后继续。");
      if (!frameWasDisposed(error)) throw error;
      // The bounded probe loop will reacquire frames. Never replay writes.
      if (request.mode === "probe") return [];
      throw Error(
        "平台页面已切换或编辑器已关闭，本次填充已停止。请检查平台草稿，待页面加载完成后再继续填充。",
      );
    }
  }
  private healthChecks = new Map<string, Promise<boolean>>();
  private allHealth?: Promise<void>;
  private activeHealthChecks = 0;
  private healthWaiters: Array<() => void> = [];
  check(id: string): Promise<boolean> {
    const current = this.healthChecks.get(id);
    if (current) return current;
    const task = (async () => {
      if (this.activeHealthChecks < 3) this.activeHealthChecks++;
      else
        await new Promise<void>((resolve) => this.healthWaiters.push(resolve));
      try {
        const a = this.account(id);
        const result = await checkAccountHealth(a, this.windows.get(id));
        this.store.change((s) => {
          const target = s.accounts.find((x) => x.id === id);
          if (!target) return;
          Object.assign(target, {
            status: result.status,
            checkedAt: new Date().toISOString(),
            checkMethod: result.method,
            checkMessage: result.message,
          });
        });
        return result.status === "editor_ready";
      } finally {
        const next = this.healthWaiters.shift();
        if (next) next();
        else this.activeHealthChecks--;
      }
    })().finally(() => this.healthChecks.delete(id));
    this.healthChecks.set(id, task);
    return task;
  }
  checkAll(): Promise<void> {
    if (this.allHealth) return this.allHealth;
    this.allHealth = boundedMap(
      [...this.store.state.accounts],
      3,
      async (a) => {
        try {
          await this.check(a.id);
        } catch {
          this.store.change((s) => {
            const target = s.accounts.find((x) => x.id === a.id);
            if (target)
              Object.assign(target, {
                status: "unknown",
                checkedAt: new Date().toISOString(),
                checkMessage: "检测失败，请手动确认",
              });
          });
        }
      },
    ).finally(() => {
      this.allHealth = undefined;
    });
    return this.allHealth;
  }
  async tick() {
    if (
      this.busy ||
      this.cancellingAll ||
      this.store.state.settings.queuePaused
    )
      return;
    const j = [...this.store.state.jobs]
      .reverse()
      .find(
        (j) =>
          j.status === "queued" &&
          (this.cooldown.get(j.accountId) ?? 0) <= Date.now() &&
          (!j.scheduledAt || Date.parse(j.scheduledAt) <= Date.now()),
      );
    if (!j) return;
    this.busy = true;
    const execution = new Execution();
    let finish!: () => void;
    const active = {
      job: j,
      execution,
      id: randomUUID(),
      done: new Promise<void>((r) => {
        finish = r;
      }),
    };
    this.active = active;
    try {
      await execution.wait(
        this.execute(j, execution, active.id),
        90000,
        "任务执行超时，请检查平台草稿后继续。",
      );
    } catch (error) {
      if (this.store.job(j.id).status === "running")
        this.store.updateJob(
          j.id,
          { status: "needs_attention", phase: undefined },
          String(error instanceof Error ? error.message : error),
        );
    } finally {
      try {
        // Stop cooperative page continuations. Unresponsive pages also carry a
        // short lease, so the same account cannot race a previous attempt.
        execution.abort("本次执行已结束。");
        await this.invalidate(j.accountId, active.id, execution.leaseUntil);
        if (this.store.job(j.id).status === "cancelling")
          this.store.updateJob(
            j.id,
            { status: "cancelled", phase: undefined },
            "用户取消任务；平台已填入的内容保留。",
          );
      } finally {
        this.active = undefined;
        this.busy = false;
        finish();
      }
    }
  }
  private async invalidate(accountId: string, id: string, leaseUntil: number) {
    const win = this.windows.get(accountId);
    if (!win || win.isDestroyed() || leaseUntil <= Date.now()) return;
    this.cooldown.set(accountId, leaseUntil);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const platform = this.account(accountId).platform;
      const frames = win.webContents.mainFrame.framesInSubtree.filter(
        (frame) =>
          frame.url === "about:blank" ||
          allowedPlatformUrl(platform, frame.url),
      );
      const acknowledged = await Promise.race([
        Promise.all(
          frames.map((frame) =>
            frame
              .executeJavaScript(
                `((window.__studioCancelledRuns ??= new Set()).add(${JSON.stringify(id)}), true)`,
              )
              .catch(() => false),
          ),
        ).then((results) => results.every(Boolean)),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 500);
        }),
      ]);
      if (acknowledged) this.cooldown.delete(accountId);
    } catch {
      /* The page may disappear while cancelling; the lease still expires. */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async cancel(id: string) {
    const job = this.store.job(id);
    if (["published", "cancelled"].includes(job.status)) return;
    const active = this.active;
    if (active?.job.id === id) {
      if (job.status !== "cancelling")
        this.store.updateJob(
          id,
          { status: "cancelling" },
          "正在停止本次填充；平台已有内容保留。",
        );
      active.execution.abort("用户取消任务。");
      await active.done;
    } else
      this.store.updateJob(
        id,
        { status: "cancelled", phase: undefined },
        "用户取消任务；平台已有内容保留。",
      );
  }
  async cancelAll() {
    if (this.cancellingAll) {
      await this.active?.done;
      return;
    }
    this.cancellingAll = true;
    try {
      const activeId = this.active?.job.id;
      this.store.change((s) => {
        for (const job of s.jobs) {
          if (["published", "cancelled"].includes(job.status)) continue;
          job.status = job.id === activeId ? "cancelling" : "cancelled";
          job.phase = undefined;
          job.updatedAt = new Date().toISOString();
          job.message =
            job.id === activeId
              ? "正在停止本次填充。"
              : "用户全部取消；平台已有内容保留。";
          job.logs = [
            ...job.logs,
            { at: job.updatedAt, message: job.message },
          ].slice(-200);
        }
      });
      if (activeId) await this.cancel(activeId);
    } finally {
      this.cancellingAll = false;
    }
  }
  async execute(job: Job, execution: Execution, runId: string) {
    this.store.updateJob(
      job.id,
      { status: "running", phase: "opening", attempts: job.attempts + 1 },
      "正在打开账号编辑器。",
    );
    const account = this.account(job.accountId);
    const win = await this.open(job.accountId, execution);
    execution.check();
    const onClosed = () =>
      execution.abort("平台窗口已关闭，请重新打开后继续。");
    const onGone = () =>
      execution.abort("平台页面异常退出，请重新打开后继续。");
    const onNavigate = (
      _event: Electron.Event,
      _url: string,
      inPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (
        !execution.controller.signal.aborted &&
        isMainFrame &&
        !inPlace &&
        ["inspecting", "filling"].includes(this.store.job(job.id).phase ?? "")
      )
        execution.abort("填充期间页面发生跳转，请检查新页面后继续。");
    };
    win.once("closed", onClosed);
    win.webContents.once("render-process-gone", onGone);
    win.webContents.on("did-start-navigation", onNavigate);
    try {
      this.store.updateJob(
        job.id,
        { phase: "waiting" },
        "平台页面已打开，正在等待标题和正文编辑器。",
      );
      const article = this.store.article(job.articleId);
      const snapshot = {
        ...article,
        title: job.snapshot.title,
        markdown: job.snapshot.markdown,
        overrides: { [job.platform]: job.snapshot },
      };
      const preview = await makePreview(
        snapshot,
        job.platform,
        this.store.state.assets,
        (a) => this.store.assetData(a),
      );
      execution.check();
      if (
        preview.warnings.some(
          (w) => w.includes("本地图片缺失") || w.includes("图片地址未解析"),
        )
      ) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          "稿件包含缺失或未导入的图片。请取消任务、修复素材后重新创建。",
        );
        return;
      }
      if (
        job.platform === "xiaohongshu" &&
        (preview.text.length > 1000 ||
          [...preview.title].length > 20 ||
          !preview.images.length)
      ) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          "小红书稿需要 20 字内标题、1000 字内正文和至少一张配图。请取消任务、修改平台稿后重新创建。",
        );
        return;
      }
      let probe: FillResult[] = [];
      const until = Date.now() + 12000;
      do {
        if (win.isDestroyed()) throw Error("平台窗口已关闭。");
        probe = await this.evaluate(
          win,
          account,
          {
            ...preview,
            mode: "probe",
            platform: job.platform,
            taskId: job.id,
            runId,
          },
          execution,
        );
        if (probe.some((r) => r.titleFound) && probe.some((r) => r.bodyFound))
          break;
        await new Promise((r) => setTimeout(r, 500));
        execution.check();
      } while (Date.now() < until);
      if (!probe.some((r) => r.titleFound) || !probe.some((r) => r.bodyFound)) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          "未识别到完整编辑器。请在平台窗口登录并打开空白文章，再点击继续填充。",
        );
        return;
      }
      this.store.updateJob(
        job.id,
        { phase: "inspecting" },
        "已识别编辑器，正在检查是否有其他草稿。",
      );
      const inspection = await this.evaluate(
        win,
        account,
        {
          ...preview,
          mode: "inspect",
          platform: job.platform,
          taskId: job.id,
          runId,
        },
        execution,
      );
      const existing = inspection.find((r) => r.conflict);
      if (existing) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          existing.message,
        );
        return;
      }
      this.store.updateJob(
        job.id,
        { phase: "filling" },
        "正在填充标题和正文并核对写入结果。",
      );
      const results = await this.evaluate(
        win,
        account,
        {
          ...preview,
          mode: "fill",
          platform: job.platform,
          taskId: job.id,
          runId,
        },
        execution,
      );
      const conflict = results.find((r) => r.conflict);
      if (conflict) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          conflict.message,
        );
        return;
      }
      const title = results.some((r) => r.titleFilled),
        body = results.some((r) => r.bodyFilled);
      if (!title || !body) {
        this.store.updateJob(
          job.id,
          { status: "needs_attention" },
          `填充回读未通过（标题${title ? "已写入" : "未确认"}，正文${body ? "已写入" : "未确认"}）。请检查编辑器；可复制平台稿手动完成。`,
        );
        return;
      }
      this.store.change((s) => {
        const a = s.accounts.find((a) => a.id === account.id)!;
        a.status = "editor_ready";
        a.checkedAt = new Date().toISOString();
      });
      this.store.updateJob(
        job.id,
        { status: "awaiting_review" },
        `标题和正文已填入。${platforms[job.platform].hint}确认平台已发布后，再在任务中登记文章链接。`,
      );
    } finally {
      win.removeListener("closed", onClosed);
      if (!win.webContents.isDestroyed()) {
        win.webContents.removeListener("render-process-gone", onGone);
        win.webContents.removeListener("did-start-navigation", onNavigate);
      }
    }
  }
  async removeAccount(id: string) {
    if (
      this.store.state.jobs.some(
        (j) =>
          j.accountId === id && !["published", "cancelled"].includes(j.status),
      )
    )
      throw Error("请先处理或取消该账号的未完成任务。");
    this.windows.get(id)?.destroy();
    const ses = session.fromPartition(`persist:account-${id}`);
    await ses.clearStorageData();
    await ses.clearCache();
    this.store.change((s) => {
      s.accounts = s.accounts.filter((a) => a.id !== id);
    });
  }
}
