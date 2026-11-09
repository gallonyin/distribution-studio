import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("batch health uses isolated sessions, retries delayed editors, and never opens visible platform windows", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-health-e2e-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    const accounts = await page.evaluate(async () => {
      for (const platform of [
        "wechat",
        "baijiahao",
        "toutiao",
        "csdn",
        "bilibili",
      ] as const)
        await window.studio.command({
          type: "account.add",
          platform,
          name: platform,
        });
      return (await window.studio.bootstrap()).state.accounts;
    });
    await app.evaluate(async ({ session }, accounts) => {
      for (const a of accounts) {
        const ses = session.fromPartition(`persist:account-${a.id}`);
        await ses.protocol.handle("https", (request) => {
          if (request.method !== "GET")
            return new Response("NO WRITES", { status: 405 });
          if (a.platform === "bilibili")
            return Response.json({
              code: 0,
              data: { isLogin: true, mid: 123 },
            });
          const html =
            a.platform === "wechat"
              ? "微信扫一扫，选择公众平台账号登录"
              : a.platform === "csdn"
                ? "滑块验证"
                : `<script>setTimeout(()=>{document.body.innerHTML='<div contenteditable="true" data-lexical-editor="true" data-placeholder="请输入标题"></div><div contenteditable="true" class="ProseMirror" style="height:100px">请输入正文</div>';document.querySelector('[data-lexical-editor]').style.height='30px';},1200)</script>`;
          return new Response("<html><body>" + html + "</body></html>", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        });
      }
    }, accounts);
    const result = await page.evaluate(() =>
      window.studio.command({ type: "account.checkAll" }),
    );
    expect(result.accounts.find((a) => a.platform === "wechat")?.status).toBe(
      "needs_login",
    );
    expect(result.accounts.find((a) => a.platform === "csdn")?.status).toBe(
      "unknown",
    );
    for (const p of ["baijiahao", "toutiao"])
      expect(result.accounts.find((a) => a.platform === p)?.status).toBe(
        "editor_ready",
      );
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    expect(
      result.accounts.find((a) => a.platform === "bilibili"),
    ).toMatchObject({ status: "authenticated", checkMethod: "api" });
    expect(result.jobs).toHaveLength(0);
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test("account checks stay independent and share a three-request concurrency limit", async () => {
  const data = fs.mkdtempSync(
    path.join(os.tmpdir(), "studio-health-parallel-"),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    const accounts = await page.evaluate(async () => {
      for (const name of ["A", "B", "C", "D", "E"])
        await window.studio.command({
          type: "account.add",
          platform: "bilibili",
          name,
        });
      return (await window.studio.bootstrap()).state.accounts;
    });
    await app.evaluate(async ({ session }, accounts) => {
      const fixture = { active: 0, max: 0, started: 0, release: false };
      (globalThis as any).healthFixture = fixture;
      for (const account of accounts)
        await session
          .fromPartition(`persist:account-${account.id}`)
          .protocol.handle("https", async () => {
            fixture.active++;
            fixture.started++;
            fixture.max = Math.max(fixture.max, fixture.active);
            try {
              while (!fixture.release)
                await new Promise((resolve) => setTimeout(resolve, 20));
              return Response.json({
                code: 0,
                data: { isLogin: true, mid: 123 },
              });
            } finally {
              fixture.active--;
            }
          });
    }, accounts);
    await page.getByRole("button", { name: "平台账号", exact: true }).click();
    const cards = page.locator(".account-card");
    await cards
      .nth(0)
      .getByRole("button", { name: "检查", exact: true })
      .click();
    await expect(
      cards.nth(0).getByRole("button", { name: "检查中", exact: true }),
    ).toBeDisabled();
    await expect(
      cards.nth(0).getByRole("button", { name: "登录 / 打开", exact: true }),
    ).toBeEnabled();
    await expect(
      cards.nth(1).getByRole("button", { name: "检查", exact: true }),
    ).toBeEnabled();
    await cards
      .nth(1)
      .getByRole("button", { name: "检查", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).healthFixture.started))
      .toBe(2);
    // Batch adds the remaining accounts and does not submit A/B twice.
    await page.getByRole("button", { name: "批量快速检测全部账号" }).click();
    await expect(
      page.getByRole("button", { name: "检查中", exact: true }),
    ).toHaveCount(5);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).healthFixture.started))
      .toBe(3);
    await expect(
      page.getByRole("button", { name: "添加账号", exact: true }),
    ).toBeEnabled();
    await app.evaluate(() => {
      (globalThis as any).healthFixture.release = true;
    });
    await expect(
      page.locator(".account-status").filter({ hasText: "已登录" }),
    ).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: "检查", exact: true }),
    ).toHaveCount(5);
    expect(
      await app.evaluate(() => {
        const { max, started } = (globalThis as any).healthFixture;
        return { max, started };
      }),
    ).toEqual({ max: 3, started: 5 });
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test("recognizes logged-in backend shells and continues past Zhihu identity to its editor", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-health-shell-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    const accounts = await page.evaluate(async () => {
      for (const platform of [
        "wechat",
        "xiaohongshu",
        "sohu",
        "zhihu",
        "jianshu",
      ] as const)
        await window.studio.command({
          type: "account.add",
          platform,
          name: platform,
        });
      return (await window.studio.bootstrap()).state.accounts;
    });
    await app.evaluate(async ({ session }, accounts) => {
      for (const account of accounts) {
        await session
          .fromPartition(`persist:account-${account.id}`)
          .protocol.handle("https", (request) => {
            const url = new URL(request.url);
            if (request.method !== "GET")
              return new Response("NO WRITES", { status: 405 });
            if (account.platform === "jianshu")
              return new Response(
                '<input placeholder="标题"><div contenteditable="true">body</div>',
                {
                  status: 403,
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                },
              );
            if (url.pathname === "/api/v4/me")
              return Response.json({ id: "fixture", name: "fixture" });
            if (account.platform === "wechat" && url.pathname === "/")
              return Response.redirect("https://mp.weixin.qq.com/cgi-bin/home");
            const html =
              account.platform === "wechat"
                ? '<div class="weui-desktop-account__info"><span class="acount_box-nickname">fixture</span></div>新的创作 内容管理'
                : account.platform === "xiaohongshu"
                  ? '<div class="user-info"><img class="user_avatar" style="width:30px;height:30px"></div>发布笔记 笔记管理 上传图文'
                  : account.platform === "sohu"
                    ? '<div class="user-info-wrap has-more"><section class="user-info">fixture</section></div>账号信息'
                    : '<textarea placeholder="请输入标题"></textarea><div contenteditable="true" style="height:100px"></div>';
            return new Response(`<html><body>${html}</body></html>`, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          });
      }
    }, accounts);
    const state = await page.evaluate(() =>
      window.studio.command({ type: "account.checkAll" }),
    );
    for (const platform of ["wechat", "xiaohongshu", "sohu"])
      expect(state.accounts.find((a) => a.platform === platform)?.status).toBe(
        "authenticated",
      );
    expect(state.accounts.find((a) => a.platform === "zhihu")?.status).toBe(
      "editor_ready",
    );
    expect(state.accounts.find((a) => a.platform === "jianshu")).toMatchObject({
      status: "unknown",
      checkMessage: expect.stringContaining("HTTP 403"),
    });
    expect(state.jobs).toHaveLength(0);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
