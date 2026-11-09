import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("account vault encrypts records, copies secrets, and scopes the separate login helper", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-vault-e2e-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  const password = "fixture-secret-8127";
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    const accounts = await page.evaluate(async () => {
      await window.studio.command({
        type: "account.add",
        platform: "bilibili",
        name: "B站测试号",
      });
      return (
        await window.studio.command({
          type: "account.add",
          platform: "zhihu",
          name: "知乎隔离号",
        })
      ).accounts;
    });
    await app.evaluate(async ({ session }, id) => {
      session
        .fromPartition(`persist:account-${id}`)
        .protocol.handle(
          "https",
          () =>
            new Response(
              '<html><body><h1>官方登录夹具</h1><input placeholder="账号"><input type="password"></body></html>',
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            ),
        );
    }, accounts[0].id);
    await page.getByRole("button", { name: "账号资料表", exact: true }).click();
    const row = page.locator("tbody tr").filter({ hasText: "B站测试号" });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("登录账号", { exact: true }).fill("fixture-login");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByLabel("备注", { exact: true }).fill("主号备注");
    await page.getByRole("button", { name: "加密保存", exact: true }).click();
    await expect(row).toContainText("fixture-login");
    await expect(row).toContainText("••••••••");
    expect(await page.locator("body").innerText()).not.toContain(password);
    expect(
      fs.readFileSync(path.join(data, "account-vault.encrypted.json"), "utf8"),
    ).not.toContain(password);
    expect(
      fs.readFileSync(path.join(data, "workspace.json"), "utf8"),
    ).not.toContain(password);
    const snapshot = await page.evaluate(async () =>
      JSON.stringify([
        await window.studio.bootstrap(),
        await window.studio.vault({ type: "list" }),
      ]),
    );
    expect(snapshot).not.toContain(password);
    await row.getByRole("button", { name: "显示B站测试号密码" }).click();
    await expect(row).toContainText(password);
    await row.getByRole("button", { name: "隐藏B站测试号密码" }).click();
    await expect(row).not.toContainText(password);
    await row.getByRole("button", { name: "复制B站测试号密码" }).click();
    expect(
      await app.evaluate(async ({ clipboard }) => await clipboard.readText()),
    ).toBe(password);
    await expect
      .poll(
        () => app.evaluate(async ({ clipboard }) => await clipboard.readText()),
        { timeout: 35000, intervals: [1000] },
      )
      .toBe("");
    await row.getByRole("button", { name: "登录", exact: true }).click();
    await expect
      .poll(() => app.windows().some((p) => p.url().includes("#login-helper=")))
      .toBe(true);
    const helper = app
      .windows()
      .find((p) => p.url().includes("#login-helper="))!;
    await expect(
      helper.getByRole("heading", { name: "登录快捷卡片" }),
    ).toBeVisible();
    await expect(
      helper.getByText("fixture-login", { exact: true }),
    ).toBeVisible();
    await expect(helper.locator("body")).not.toContainText("知乎隔离号");
    const blocked = await helper.evaluate(async (id) => {
      try {
        await window.studio.vault({ type: "reveal", accountId: id });
        return false;
      } catch {
        return true;
      }
    }, accounts[1].id);
    expect(blocked).toBe(true);
    const remote = app
      .windows()
      .find((p) => p.url().includes("member.bilibili.com"))!;
    expect(await remote.evaluate(() => typeof (window as any).studio)).toBe(
      "undefined",
    );
    await helper
      .getByRole("button", { name: "复制登录账号", exact: true })
      .click();
    expect(
      await app.evaluate(async ({ clipboard }) => await clipboard.readText()),
    ).toBe("fixture-login");
    await remote.close();
    await expect
      .poll(() => app.windows().some((p) => p.url().includes("#login-helper=")))
      .toBe(false);
  } finally {
    await app
      .evaluate(async ({ clipboard }) => {
        const text = await clipboard.readText();
        if (["fixture-login", "fixture-secret-8127"].includes(text))
          await clipboard.clear();
      })
      .catch(() => {});
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
