import type { Account, PlatformId } from "../src/domain";
export type HealthResult = {
  status: Account["status"];
  method: "api" | "http" | "page";
  message: string;
};
export function pageSignal(
  platform: PlatformId,
  url: string,
  text: string,
  editor = false,
  loginForm = false,
): HealthResult | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (
    /captcha|challenge|verify|安全验证|访问过于频繁|操作频繁|人机验证|滑块验证/i.test(
      u.pathname + " " + text,
    )
  )
    return {
      status: "unknown",
      method: "page",
      message: "遇到验证或访问限制，请手动确认",
    };
  if (
    /\/(?:sign_in|signin|login)(?:[./]|$)/i.test(u.pathname) ||
    loginForm ||
    (platform === "wechat" && /微信扫一扫，选择公众平台账号登录/.test(text)) ||
    (platform === "csdn" && /微信登录/.test(text) && /验证码登录/.test(text))
  )
    return {
      status: "needs_login",
      method: "page",
      message: "检测到登录页，请重新登录",
    };
  if (editor)
    return {
      status: "editor_ready",
      method: "page",
      message: "已识别标题和正文编辑区；未执行填充",
    };
  if (
    platform === "wechat" &&
    /退出/.test(text) &&
    /内容管理|新的创作|草稿箱/.test(text)
  )
    return {
      status: "authenticated",
      method: "page",
      message: "后台已登录，尚未验证编辑器",
    };
  if (platform === "sohu" && /登录\/注册/.test(text))
    return {
      status: "needs_login",
      method: "page",
      message: "平台返回未登录首页",
    };
  return null;
}
export function zhihuIdentity(
  status: number,
  data: unknown,
): HealthResult | null {
  if (status === 401)
    return {
      status: "needs_login",
      method: "api",
      message: "身份接口返回未登录",
    };
  if (status !== 200 || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.id === "string" &&
    d.id.length > 0 &&
    typeof d.name === "string" &&
    !d.error
  )
    return {
      status: "authenticated",
      method: "api",
      message: "只读身份接口验证通过；尚未验证编辑器",
    };
  return null;
}
export async function boundedMap<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await run(item);
      }
    }),
  );
}

// Bilibili's read-only nav endpoint uses JSON code/isLogin, not HTTP 200 alone.
export function bilibiliIdentity(
  status: number,
  data: unknown,
): HealthResult | null {
  if (status !== 200 || !data || typeof data !== "object") return null;
  const d = data as {
    code?: unknown;
    data?: { isLogin?: unknown; mid?: unknown };
  };
  if (d.code === -101 && d.data?.isLogin === false)
    return {
      status: "needs_login",
      method: "api",
      message: "只读身份接口确认未登录，请登录 Bilibili",
    };
  if (
    d.code === 0 &&
    d.data?.isLogin === true &&
    typeof d.data.mid === "number" &&
    Number.isSafeInteger(d.data.mid) &&
    d.data.mid > 0
  )
    return {
      status: "authenticated",
      method: "api",
      message: "Bilibili 身份接口验证通过；尚未验证图文编辑器",
    };
  return null;
}
