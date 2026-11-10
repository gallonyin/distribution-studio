import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("平台导航栏独立布局、历史导航、草稿保护和账号会话", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-toolbar-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const main = await app.firstWindow();
    await expect(main.getByText("本地工作区已连接")).toBeVisible();
    const id = await main.evaluate(async () => {
      const s = await window.studio.command({
        type: "account.add",
        platform: "sohu",
        name: "导航测试",
      });
      return s.accounts[0].id;
    });
    await app.evaluate(({ session }, id) => {
      const ses = session.fromPartition(`persist:account-${id}`);
      ses.protocol.handle(
        "https",
        () =>
          new Response(
            '<meta charset="utf-8"><input placeholder="标题"><div class="ql-editor" contenteditable="true" style="height:200px"></div><a href="https://mp.sohu.com/other?token=hidden-test">其他页面</a>',
            { headers: { "content-type": "text/html;charset=utf-8" } },
          ),
      );
    }, id);
    await main.evaluate(
      (id) => window.studio.command({ type: "account.open", id }),
      id,
    );
    const remote = app
      .context()
      .pages()
      .find((p) => p.url().includes("mp.sohu.com"))!;
    await expect(remote.locator("input")).toBeVisible();
    const toolbar = () =>
      app
        .context()
        .pages()
        .find((p) => p.url().endsWith("toolbar.html"));
    await expect.poll(() => !!toolbar()).toBe(true);
    const bar = toolbar()!;
    await expect(bar.locator("#host")).toHaveText("mp.sohu.com");
    const layout = await app.evaluate(({ BaseWindow }) => {
      const w = (BaseWindow.getAllWindows() as any[]).find((w) =>
        w.webContents.getURL().includes("mp.sohu.com"),
      )!;
      return w.contentView.children.map((v: Electron.View) => v.getBounds());
    });
    expect(layout[0].y).toBe(52);
    expect(layout[1].height).toBe(52);
    for (const mode of ["resize", "maximize", "restore"] as const) {
      await app.evaluate(({ BaseWindow }, mode) => {
        const w = (BaseWindow.getAllWindows() as any[]).find((w) =>
          w.webContents.getURL().includes("mp.sohu.com"),
        )!;
        if (mode === "resize") w.setSize(1000, 700);
        else if (mode === "maximize") w.maximize();
        else w.unmaximize();
      }, mode);
      await expect
        .poll(() =>
          app.evaluate(({ BaseWindow }) => {
            const w = (BaseWindow.getAllWindows() as any[]).find((w) =>
              w.webContents.getURL().includes("mp.sohu.com"),
            )!;
            return w.contentView.children[0].getBounds().y;
          }),
        )
        .toBe(52);
    }
    const expectedViewport = await app.evaluate(({ BaseWindow }) => {
      const w = (BaseWindow.getAllWindows() as any[]).find((w) =>
        w.webContents?.getURL().includes("mp.sohu.com"),
      )!;
      return w.getContentSize()[1] - 52;
    });
    expect(await remote.evaluate(() => window.innerHeight)).toBe(
      expectedViewport,
    );
    await remote.getByRole("link").click();
    await expect(remote).toHaveURL(/\/other/);
    await expect(bar.locator("#host")).not.toContainText("hidden-test");
    await bar.getByRole("button", { name: "后退", exact: true }).click();
    await expect(remote).toHaveURL(/addarticle/);
    await bar.getByRole("button", { name: "前进", exact: true }).click();
    await expect(remote).toHaveURL(/\/other/);
    await bar.getByRole("button", { name: "平台后台", exact: true }).click();
    await expect(remote).toHaveURL("https://mp.sohu.com/");
    await bar.getByRole("button", { name: "写文章", exact: true }).click();
    await expect(remote).toHaveURL(/addarticle/);
    await expect(
      bar.getByRole("button", { name: "前进", exact: true }),
    ).toBeDisabled();
    expect(await remote.evaluate(() => typeof window.studio)).toBe("undefined");
    expect(await bar.evaluate(() => typeof window.studio)).toBe("undefined");
    await remote.locator("input").fill("刷新自测");
    await bar.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(remote.locator("input")).toHaveValue("");
    // Exercise the same adapter execution used by Publisher, marking this window
    // as having received content without submitting to any real platform.
    await main.getByRole("button", { name: "新建文章", exact: true }).click();
    await main.getByLabel("文章标题").fill("隔离草稿");
    await main.getByLabel("文章正文").fill("隔离正文");
    await main.getByRole("button", { name: "保存", exact: true }).click();
    await expect(main.locator(".save-status")).toContainText("已保存");
    await main.evaluate(async (id) => {
      const s = (await window.studio.bootstrap()).state;
      await window.studio.command({
        type: "queue.add",
        articleId: s.articles[0].id,
        accountIds: [id],
        scheduledAt: null,
      });
    }, id);
    await expect(remote.locator("input")).toHaveValue("隔离草稿", {
      timeout: 30000,
    });
    await expect(remote.locator(".ql-editor")).toHaveText("隔离正文");
    await expect
      .poll(
        async () =>
          (await main.evaluate(() => window.studio.bootstrap())).state.jobs[0]
            .status,
      )
      .toBe("awaiting_review");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await bar.getByRole("button", { name: "平台后台", exact: true }).click();
    await expect(remote.locator("input")).toHaveValue("隔离草稿");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await bar.getByRole("button", { name: "平台后台", exact: true }).click();
    await expect(remote).toHaveURL("https://mp.sohu.com/");
    await bar.getByRole("button", { name: "登录资料", exact: true }).click();
    await expect
      .poll(() => app.windows().some((p) => p.url().includes("login-helper=")))
      .toBe(true);
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
