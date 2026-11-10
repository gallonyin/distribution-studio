import { BrowserWindow, session } from "electron";
import { applyChromeIdentity } from "./browser-identity";
import {
  platformNavigationUrl,
  platformNavigationFilters,
} from "./platform-navigation";
import type { Account } from "../src/domain";
import { platforms, allowedPlatformUrl } from "../src/domain";
import {
  pageSignal,
  zhihuIdentity,
  bilibiliIdentity,
  type HealthResult,
} from "./account-health-signals";

// Purely reads DOM, including visible login controls. Never clicks, types, submits or exports tokens.
const probe = `(() => {
 const visible = e => !!(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
 const text = (document.body?.innerText || '').slice(0,60000);
 const inputs = [...document.querySelectorAll('input,textarea')].filter(visible);
 const label = e => [e.placeholder,e.name,e.id,e.getAttribute('data-placeholder'),e.getAttribute('aria-label')].join(' ');
 const fields = [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible);
 const titleEl = fields.find(e => /标题|title/i.test(label(e))) || document.querySelector('[data-lexical-editor="true"][contenteditable="true"]');
 const title = !!titleEl && visible(titleEl);
 const body = fields.some(e => e !== titleEl && !/标题|title/i.test(label(e)) && (e.isContentEditable || /正文|内容|markdown|content/i.test(label(e)))) || Object.values(globalThis.UE_V2?.instants || {}).some(e => e?.isReady && e?.body && typeof e.getContentTxt === "function");
 const password = inputs.some(e => e.type === 'password');
 const phone = inputs.some(e => /手机号|验证码|邮箱号/.test(e.placeholder || ''));
 const accountControl = [...document.querySelectorAll('.weui-desktop-account__info .acount_box-nickname, .weui-desktop-account__nickname, .user-info .user_avatar, .user-info-wrap.has-more')].some(visible);
 return { url: location.href, text, accountControl, editor: title && body, loginForm: !body && (password || (phone && /登录/.test(text))) };
})()`;
async function readPage(
  win: Pick<BrowserWindow, "webContents" | "isDestroyed">,
  a: Account,
): Promise<HealthResult | null> {
  if (win.isDestroyed()) return null;
  const frames = win.webContents.mainFrame.framesInSubtree;
  const results = await Promise.all(
    frames.slice(0, 12).map(async (frame) => {
      try {
        // Do not evaluate third-party advertisement or unrelated frames.
        if (!allowedPlatformUrl(a.platform, frame.url)) return null;
        const s = (await frame.executeJavaScript(probe)) as {
          url: string;
          text: string;
          editor: boolean;
          loginForm: boolean;
          accountControl: boolean;
        };
        return pageSignal(
          a.platform,
          s.url,
          s.text,
          s.editor,
          s.loginForm,
          s.accountControl,
        );
      } catch {
        return null;
      }
    }),
  );
  return (
    results.find((r) => r?.status === "needs_login") ||
    results.find((r) => r?.status === "editor_ready") ||
    results.find((r) => r?.status === "authenticated") ||
    results.find(Boolean) ||
    null
  );
}
export async function checkAccountHealth(
  a: Account,
  existing?: Pick<BrowserWindow, "webContents" | "isDestroyed">,
): Promise<HealthResult> {
  const fallback: HealthResult = {
    status: "unknown",
    method: "page",
    message: "限时内未确认状态，可手动打开平台；不等于账号失效",
  };
  if (a.platform === "web") return fallback;
  // A single deadline includes HTTP, loading and all DOM probes; hidden windows are always destroyed.
  let identity: HealthResult | undefined;
  let loadFailure: string | undefined;
  const unconfirmed = () =>
    identity ??
    (loadFailure ? { ...fallback, message: loadFailure } : fallback);
  const abort = new AbortController();
  let hidden: BrowserWindow | undefined;
  let deadline: ReturnType<typeof setTimeout>;
  const work = async (): Promise<HealthResult> => {
    if (existing && !existing.isDestroyed()) {
      const result = await readPage(existing, a);
      if (result) return result;
    }
    const ses = session.fromPartition(`persist:account-${a.id}`);
    if (a.platform === "zhihu" || a.platform === "bilibili") {
      try {
        const response = await ses.fetch(
          a.platform === "bilibili"
            ? "https://api.bilibili.com/x/web-interface/nav"
            : "https://www.zhihu.com/api/v4/me",
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3500)]),
          },
        );
        const result = (
          a.platform === "bilibili" ? bilibiliIdentity : zhihuIdentity
        )(response.status, await response.json());
        if (
          result?.status === "needs_login" ||
          (result && a.platform === "bilibili")
        )
          return result;
        if (result) identity = result;
      } catch {
        /* No credential inference from errors, 403 or captcha. */
      }
    }
    if (abort.signal.aborted) return unconfirmed();
    // Read-only entry request is sufficient for explicit login redirects; SPA shells remain unknown.
    try {
      const response = await ses.fetch(platforms[a.platform].url, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3500)]),
      });
      if (response.status === 401)
        return {
          status: "needs_login",
          method: "http",
          message: "创作入口返回未登录",
        };
      if (response.ok && allowedPlatformUrl(a.platform, response.url)) {
        const result = pageSignal(a.platform, response.url, "");
        if (result?.status === "needs_login")
          return { ...result, method: "http" };
      }
      await response.body?.cancel();
    } catch {
      /* fall back to a bounded background browser */
    }
    if (abort.signal.aborted) return unconfirmed();
    hidden = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    const filters = platformNavigationFilters(a.platform);
    if (filters.length)
      ses.webRequest.onBeforeRequest({ urls: filters }, (details, cb) => {
        const target =
          details.resourceType === "mainFrame" && details.method === "GET"
            ? platformNavigationUrl(a.platform, details.url)
            : undefined;
        cb(target && target !== details.url ? { redirectURL: target } : {});
      });
    await hidden.loadURL("about:blank");
    if (abort.signal.aborted || hidden.isDestroyed()) return unconfirmed();
    await applyChromeIdentity(hidden);
    if (abort.signal.aborted || hidden.isDestroyed()) return unconfirmed();
    hidden.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    hidden.webContents.on("will-navigate", (e, url) => {
      if (!allowedPlatformUrl(a.platform, url)) e.preventDefault();
    });
    hidden.webContents.on("will-redirect", (e, url) => {
      if (!allowedPlatformUrl(a.platform, url)) e.preventDefault();
    });
    hidden.webContents.session.setPermissionRequestHandler((_wc, _p, cb) =>
      cb(false),
    );
    hidden.webContents.on("will-attach-webview", (e) => e.preventDefault());
    hidden.webContents.on(
      "did-fail-load",
      (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3)
          loadFailure = `平台页面加载失败（网络错误 ${code}），暂未确认登录`;
      },
    );
    let httpRejected = false;
    hidden.webContents.on("did-navigate", (_event, _url, httpResponseCode) => {
      if (httpResponseCode >= 400) {
        httpRejected = true;
        loadFailure = `平台页面返回 HTTP ${httpResponseCode}，暂未确认登录`;
      }
    });
    void hidden.loadURL(platforms[a.platform].url).catch(() => {});
    while (!abort.signal.aborted && !hidden.isDestroyed()) {
      if (httpRejected) return { ...fallback, message: loadFailure! };
      const result = await readPage(hidden, a);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return unconfirmed();
  };
  try {
    return await Promise.race([
      work(),
      new Promise<HealthResult>((resolve) => {
        deadline = setTimeout(() => {
          if (
            !loadFailure &&
            hidden &&
            !hidden.isDestroyed() &&
            hidden.webContents.isLoading()
          )
            loadFailure = "平台页面加载超时，暂未确认登录";
          abort.abort();
          resolve(unconfirmed());
        }, 16000);
      }),
    ]);
  } finally {
    clearTimeout(deadline!);
    abort.abort();
    if (hidden && !hidden.isDestroyed()) hidden.destroy();
  }
}
