import { describe, it, expect } from "vitest";
import {
  pageSignal,
  zhihuIdentity,
  boundedMap,
} from "../electron/account-health-signals";
import { accountSchema } from "../src/domain";
import { parseCommand } from "../electron/commands";
describe("account health evidence", () => {
  it("login redirects and CSDN embedded login override a partial editor", () => {
    expect(
      pageSignal(
        "xiaohongshu",
        "https://creator.xiaohongshu.com/login?x=secret",
        "",
      )?.status,
    ).toBe("needs_login");
    expect(
      pageSignal(
        "csdn",
        "https://passport.csdn.net/login",
        "微信登录 验证码登录",
        true,
      )?.status,
    ).toBe("needs_login");
  });
  it("public navigation login label alone is not proof of logout", () => {
    expect(
      pageSignal("zhihu", "https://zhuanlan.zhihu.com/write", "登录"),
    ).toBeNull();
  });
  it("distinguishes a valid identity from editor readiness and denies errors", () => {
    expect(zhihuIdentity(200, { id: "123", name: "Alice" })?.status).toBe(
      "authenticated",
    );
    expect(zhihuIdentity(403, { id: "123", name: "Alice" })).toBeNull();
    expect(zhihuIdentity(200, { error: { code: 401 } })).toBeNull();
    expect(zhihuIdentity(401, {})?.status).toBe("needs_login");
  });
  it("requires both editor fields and treats challenges as unknown", () => {
    expect(
      pageSignal(
        "toutiao",
        "https://mp.toutiao.com/profile_v4/graphic/publish",
        "",
        true,
      )?.status,
    ).toBe("editor_ready");
    expect(
      pageSignal(
        "toutiao",
        "https://mp.toutiao.com/profile_v4/graphic/publish",
        "滑块验证",
        true,
      )?.status,
    ).toBe("unknown");
  });
  it("never returns query tokens as a result", () => {
    expect(
      JSON.stringify(
        pageSignal(
          "jianshu",
          "https://www.jianshu.com/sign_in?token=SECRET",
          "",
        ),
      ),
    ).not.toContain("SECRET");
  });
  it("keeps old account records compatible and rejects extra command arguments", () => {
    expect(
      accountSchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        platform: "zhihu",
        name: "test",
        status: "unknown",
      }).status,
    ).toBe("unknown");
    expect(parseCommand({ type: "account.checkAll" }).type).toBe(
      "account.checkAll",
    );
    expect(() =>
      parseCommand({ type: "account.checkAll", url: "https://evil.test" }),
    ).toThrow();
  });
  it("limits concurrency and runs each account exactly once", async () => {
    let active = 0,
      peak = 0;
    const done: number[] = [];
    await boundedMap([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      done.push(n);
      active--;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
