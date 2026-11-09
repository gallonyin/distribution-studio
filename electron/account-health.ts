import { BrowserWindow, session } from "electron";
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
 return { url: location.href, text, editor: title && body, loginForm: !body && (password || (phone && /登录/.test(text))) };
})()`;
async function readPage(
  win: BrowserWindow,
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
        };
        return pageSignal(a.platform, s.url, s.text, s.editor, s.loginForm);
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
  existing?: BrowserWindow,
): Promise<HealthResult> {
  const fallback: HealthResult = {
    status: "unknown",
    method: "page",
    message: "限时内未确认状态，可手动打开平台；不等于账号失效",
  };
  if (a.platform === "web") return fallback;
  // A single deadline includes HTTP, loading and all DOM probes; hidden windows are always destroyed.
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
        if (result) return result;
      } catch {
        /* No credential inference from errors, 403 or captcha. */
      }
    }
    if (abort.signal.aborted) return fallback;
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
    if (abort.signal.aborted) return fallback;
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
    void hidden.loadURL(platforms[a.platform].url).catch(() => {});
    while (!abort.signal.aborted && !hidden.isDestroyed()) {
      const result = await readPage(hidden, a);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return fallback;
  };
  try {
    return await Promise.race([
      work(),
      new Promise<HealthResult>((resolve) => {
        deadline = setTimeout(() => {
          abort.abort();
          resolve(fallback);
        }, 16000);
      }),
    ]);
  } finally {
    clearTimeout(deadline!);
    abort.abort();
    if (hidden && !hidden.isDestroyed()) hidden.destroy();
  }
}
