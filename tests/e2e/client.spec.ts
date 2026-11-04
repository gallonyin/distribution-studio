import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
let client: ElectronApplication, page: Page, data: string;
async function launch() {
  client = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
    timeout: 45000,
  });
  page = await client.firstWindow();
  await expect(page.getByText("本地工作区已连接")).toBeVisible();
}
test.beforeEach(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-e2e-"));
  await launch();
});
test.afterEach(async () => {
  await client?.close();
  fs.rmSync(data, { recursive: true, force: true });
});
test("拖动调整平台账号顺序并在重启后保留", async () => {
  await page.evaluate(async () => {
    await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "知乎主账号",
    });
    await window.studio.command({
      type: "account.add",
      platform: "wechat",
      name: "公众号主账号",
    });
    await window.studio.command({
      type: "account.add",
      platform: "csdn",
      name: "CSDN 主账号",
    });
  });
  await page.getByRole("button", { name: "平台账号", exact: false }).click();
  const cards = page.locator(".account-card");
  await expect(cards.locator("h3")).toHaveText([
    "知乎主账号",
    "公众号主账号",
    "CSDN 主账号",
  ]);

  await cards
    .filter({ hasText: "CSDN 主账号" })
    .getByRole("button", { name: "调整CSDN 主账号顺序" })
    .dragTo(cards.filter({ hasText: "知乎主账号" }), {
      targetPosition: { x: 20, y: 20 },
    });
  await expect(cards.locator("h3")).toHaveText([
    "CSDN 主账号",
    "知乎主账号",
    "公众号主账号",
  ]);

  const stored = (await page.evaluate(() => window.studio.bootstrap())).state;
  expect(stored.accounts.map((account) => account.name)).toEqual([
    "CSDN 主账号",
    "知乎主账号",
    "公众号主账号",
  ]);
  await client.close();
  await launch();
  await page.getByRole("button", { name: "平台账号", exact: false }).click();
  await expect(page.locator(".account-card h3")).toHaveText([
    "CSDN 主账号",
    "知乎主账号",
    "公众号主账号",
  ]);
});

test("删除与批量清理已取消记录：确认、保留排队任务和重启持久化", async () => {
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("任务清理测试");
  await page.getByLabel("文章正文").fill("保留这份原稿");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText(/已保存/);
  await page.evaluate(async () => {
    await window.studio.command({ type: "queue.pause", paused: true });
    const s = await window.studio.command({
      type: "account.add",
      platform: "wechat",
      name: "清理测试账号",
    });
    for (let i = 0; i < 4; i++) {
      const next = await window.studio.command({
        type: "queue.add",
        articleId: s.articles[0].id,
        accountIds: [s.accounts[0].id],
        scheduledAt: null,
      });
      if (i < 3)
        await window.studio.command({
          type: "job.cancel",
          id: next.jobs[0].id,
        });
    }
  });
  await page.getByRole("button", { name: "分发任务", exact: false }).click();
  await expect(page.locator(".job-card")).toHaveCount(4);
  await client.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1080, 800);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/task-deletion.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "删除记录", exact: true }),
  ).toHaveCount(3);
  await expect(
    page
      .locator(".job-card")
      .filter({ hasText: "等待执行" })
      .getByRole("button", { name: "删除记录", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("不删除原稿、素材或平台文章");
    await dialog.dismiss();
  });
  await page
    .getByRole("button", { name: "删除记录", exact: true })
    .first()
    .click();
  await expect(page.locator(".job-card")).toHaveCount(4);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "删除记录", exact: true })
    .first()
    .click();
  await expect(page.locator(".job-card")).toHaveCount(3);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "清理已取消记录（2）", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(3);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("2 条已取消记录");
    await dialog.accept();
  });
  await page
    .getByRole("button", { name: "清理已取消记录（2）", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "清理已取消记录（0）", exact: true }),
  ).toBeDisabled();
  await client.close();
  await launch();
  const restored = (await page.evaluate(() => window.studio.bootstrap())).state;
  expect(restored.jobs).toHaveLength(1);
  expect(restored.jobs[0].status).toBe("queued");
  expect(restored.articles[0].markdown).toBe("保留这份原稿");
  expect(restored.accounts).toHaveLength(1);
  expect(restored.settings.queuePaused).toBe(true);
  await page.getByRole("button", { name: "分发任务", exact: false }).click();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除记录", exact: true }).click();
  await expect(page.locator(".job-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "返回内容工作台", exact: true }),
  ).toBeVisible();
});

test("运行中取消后删除记录，迟到的平台跳转回调不报错", async () => {
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("取消后删除");
  await page.getByLabel("文章正文").fill("测试正文");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText(/已保存/);
  const setup = await page.evaluate(async () => {
    const s = await window.studio.command({
      type: "account.add",
      platform: "wechat",
      name: "跳转测试",
    });
    return { accountId: s.accounts[0].id, articleId: s.articles[0].id };
  });
  await client.evaluate(({ session }, id) => {
    session.fromPartition(`persist:account-${id}`).protocol.handle(
      "https",
      () =>
        new Response("<html><body>等待编辑器</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
  }, setup.accountId);
  const jobId = await page.evaluate(async ({ accountId, articleId }) => {
    const s = await window.studio.command({
      type: "queue.add",
      articleId,
      accountIds: [accountId],
      scheduledAt: null,
    });
    return s.jobs[0].id;
  }, setup);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .phase,
    )
    .toBe("waiting");
  // Keep a callback captured before cancellation to deterministically exercise a late event.
  const listeners = await client.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("mp.weixin.qq.com"),
    )!;
    (win as any).__lateNavigation = win.webContents.listeners(
      "did-start-navigation",
    );
    return (win as any).__lateNavigation.length;
  });
  expect(listeners).toBeGreaterThan(0);
  await page.evaluate(async (id) => {
    await window.studio.command({ type: "job.cancel", id });
    await window.studio.command({ type: "job.delete", id });
  }, jobId);
  await client.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("mp.weixin.qq.com"),
    )!;
    for (const callback of (win as any).__lateNavigation)
      callback({}, "https://mp.weixin.qq.com/", false, true);
  });
  expect(
    (await page.evaluate(() => window.studio.bootstrap())).state.jobs,
  ).toHaveLength(0);
});

test("等待编辑器期间页面跳转，重新检测后完成填充", async () => {
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("页面跳转填充测试");
  await page.getByLabel("文章正文").fill("跳转后填入一次正文。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText(/已保存/);
  const setup = await page.evaluate(async () => {
    const state = await window.studio.command({
      type: "account.add",
      platform: "wechat",
      name: "页面跳转测试",
    });
    return { accountId: state.accounts[0].id, articleId: state.articles[0].id };
  });
  await client.evaluate(({ session }, id) => {
    session
      .fromPartition(`persist:account-${id}`)
      .protocol.handle(
        "https",
        (request) =>
          new Response(
            request.url.endsWith("/editor")
              ? '<meta charset="utf-8"><textarea id="title"></textarea><div class="ProseMirror" contenteditable="true" style="height:300px"></div>'
              : '<meta charset="utf-8"><p>等待跳转</p><script>setTimeout(() => location.replace("/editor"), 1000)</script>',
            { headers: { "content-type": "text/html" } },
          ),
      );
  }, setup.accountId);
  await page.evaluate(async ({ accountId, articleId }) => {
    await window.studio.command({
      type: "queue.add",
      accountIds: [accountId],
      articleId,
      scheduledAt: null,
    });
  }, setup);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 20000 },
    )
    .toBe("awaiting_review");
  const remote = client
    .windows()
    .find((p) => p.url().startsWith("https://mp.weixin.qq.com/"))!;
  await expect(remote.locator("#title")).toHaveValue("页面跳转填充测试");
  await expect(remote.locator(".ProseMirror")).toHaveText(
    "跳转后填入一次正文。",
  );
});

test("编辑、平台稿、图片、重启与导出备份", async () => {
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("链上说明书：一份主稿，多平台表达");
  await page
    .getByLabel("文章正文")
    .fill(
      "## 为什么保留主稿？\n\n核心事实保持一致，表达可以不同。\n\n```js\nconst draft = true;\n```",
    );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存 · v1");
  await page.getByRole("button", { name: "平台稿", exact: true }).click();
  await page.getByLabel("文章标题").fill("公众号的专用标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "基础主稿", exact: true }).click();
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "链上说明书：一份主稿，多平台表达",
  );
  await expect(page.locator(".preview-paper h2")).toHaveText(
    "公众号的专用标题",
  );
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  // Native file dialog is stubbed; the actual main-process importer and filesystem are exercised.
  const imagePath = path.join(data, "pixel.png");
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await client.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, imagePath);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page
    .getByRole("button", { name: "导入图片", exact: true })
    .first()
    .click();
  await expect(page.getByText("pixel.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "插入当前稿件" }).click();
  await expect(page.getByLabel("文章正文")).toHaveValue(/asset:\/\//);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const zipPath = path.join(data, "bundle.zip");
  await client.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, zipPath);
  await page.getByRole("button", { name: "导出分发包" }).click();
  await expect.poll(() => fs.existsSync(zipPath)).toBe(true);
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(fs.readFileSync(zipPath));
  expect(Object.keys(zip).filter((k) => k.endsWith("article.md"))).toHaveLength(
    10,
  );
  expect(strFromU8(zip["wechat/article.md"])).toContain("公众号的专用标题");
  expect(Object.keys(zip).some((k) => k.startsWith("assets/"))).toBe(true);
  const backupPath = path.join(data, "backup.json");
  await client.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, backupPath);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await expect.poll(() => fs.existsSync(backupPath)).toBe(true);
  expect(
    JSON.parse(fs.readFileSync(backupPath, "utf8")).state.articles,
  ).toHaveLength(1);
  await client.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, backupPath);
  await page.getByRole("button", { name: "从备份恢复" }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.settings
          .queuePaused,
    )
    .toBe(true);
  await client.close();
  await launch();
  await expect(page.getByLabel("文章标题")).toHaveValue(
    "链上说明书：一份主稿，多平台表达",
  );
  await expect(page.getByLabel("文章正文")).toHaveValue(/asset:\/\//);
});
test("真实 Electron 窗口：队列填充、重复拦截与人工登记", async () => {
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.getByLabel("账号平台").selectOption("zhihu");
  await page.getByLabel("账号名称").fill("本地验收账号");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加账号", exact: true })
    .click();
  const account = (await page.evaluate(() => window.studio.bootstrap())).state
    .accounts[0];
  await client.evaluate(
    ({ session }, { id }) => {
      session
        .fromPartition(`persist:account-${id}`)
        .protocol.handle(
          "https",
          () =>
            new Response(
              '<!doctype html><meta charset="utf-8"><style>textarea{width:500px;height:50px}.public-DraftEditor-content{min-height:400px;border:1px solid #ccc}</style><textarea placeholder="请输入标题"></textarea><div class="public-DraftEditor-content" contenteditable="true"></div><button id="publish">发布</button><script>window.publishClicks=0;document.querySelector("button").onclick=()=>window.publishClicks++;</script>',
              { headers: { "content-type": "text/html" } },
            ),
        );
    },
    { id: account.id },
  );
  await page.getByRole("button", { name: "内容工作台", exact: true }).click();
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("平台填充验收");
  await page
    .getByLabel("文章正文")
    .fill("## 完整正文\n\n测试强调 **内容** 与列表。\n\n- 第一步\n- 第二步");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "分发", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建 0 个任务" }),
  ).toBeDisabled();
  await expect(page.locator(".account-picker input:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "创建 1 个任务" }).click();
  await expect(page.getByText("待检查发布", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const remote = client.windows().find((p) => p !== page)!;
  expect(
    await client.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) =>
        w.getTitle().includes("本地验收账号"),
      ),
    ),
  ).toBe(true);
  await expect(remote.locator("textarea")).toHaveValue("平台填充验收");
  await expect(remote.locator("[contenteditable]")).toContainText("第一步");
  expect(
    await remote.evaluate(() => ({
      node: typeof (window as any).require,
      bridge: typeof (window as any).studio,
      clicks: (window as any).publishClicks,
    })),
  ).toEqual({ node: "undefined", bridge: "undefined", clicks: 0 });
  const dataState = (await page.evaluate(() => window.studio.bootstrap()))
    .state;
  const err = await page.evaluate(
    async ({ id, accountId }) => {
      try {
        await window.studio.command({
          type: "queue.add",
          articleId: id,
          accountIds: [accountId],
          scheduledAt: null,
        });
        return "";
      } catch (e) {
        return String(e);
      }
    },
    { id: dataState.articles[0].id, accountId: account.id },
  );
  expect(err).toContain("相同");
  await page.getByRole("button", { name: "登记已发布" }).click();
  await page
    .getByLabel("已发布文章链接")
    .fill("https://zhuanlan.zhihu.com/p/123");
  await page.getByRole("button", { name: "确认登记" }).click();
  await expect(page.getByText("已人工确认发布", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/tasks.png", fullPage: true });
});
test("已有草稿不覆盖", async () => {
  const state = await page.evaluate(async () => {
    const a = await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "冲突测试",
    });
    return a;
  });
  const account = state.accounts[0];
  await client.evaluate(({ session }, id) => {
    session
      .fromPartition(`persist:account-${id}`)
      .protocol.handle(
        "https",
        () =>
          new Response(
            '<meta charset="utf-8"><textarea placeholder="标题">不能覆盖的原稿</textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px">旧正文</div>',
            { headers: { "content-type": "text/html" } },
          ),
      );
  }, account.id);
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("文章标题").fill("新的标题");
  await page.getByLabel("文章正文").fill("新的正文");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "分发", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建 0 个任务" }),
  ).toBeDisabled();
  await expect(page.locator(".account-picker input:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "创建 1 个任务" }).click();
  await expect(
    page.getByText("标题栏已有其他内容，未覆盖。", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const remote = client.windows().find((p) => p !== page)!;
  await expect(remote.locator("textarea")).toHaveValue("不能覆盖的原稿");
  await expect(remote.locator("[contenteditable]")).toHaveText("旧正文");
});

test("九个平台夹具、公众号 iframe 与 CSDN 跨域 iframe：同一任务链路", async () => {
  const setup = await page.evaluate(async () => {
    await window.studio.command({ type: "queue.pause", paused: true });
    const platformIds = [
      "wechat",
      "zhihu",
      "csdn",
      "xiaohongshu",
      "baijiahao",
      "sohu",
      "toutiao",
      "netease",
      "jianshu",
    ] as const;
    let s;
    for (const platform of platformIds)
      s = await window.studio.command({
        type: "account.add",
        platform,
        name: platform + " 验收",
      });
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "九平台兼容检查",
        markdown: "## 一个步骤\n\n正文与 **重点**。",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {
          xiaohongshu: {
            title: "短稿配图检查",
            markdown:
              "一段清晰的短稿。\n\n![配图](https://example.com/image.png)",
          },
        },
      },
    });
    return { accounts: s!.accounts, id };
  });
  for (const a of setup.accounts)
    await client.evaluate(({ session }, a) => {
      session
        .fromPartition(`persist:account-${a.id}`)
        .protocol.handle("https", (request) => {
          const title =
            '<textarea id="title" placeholder="请输入标题" style="width:500px;height:50px"></textarea>';
          let body =
            '<div class="ProseMirror" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "wechat")
            body = `<iframe id="ueditor_0" onload="this.contentDocument.body.contentEditable='true';this.contentDocument.body.style.minHeight='300px'" style="height:400px;width:600px"></iframe>`;
          if (a.platform === "zhihu")
            body =
              '<div class="public-DraftEditor-content" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "sohu" || a.platform === "netease")
            body =
              '<div class="ql-editor" contenteditable="true" style="height:300px"></div>';
          if (a.platform === "jianshu")
            body =
              '<textarea id="content" style="height:300px;width:500px"></textarea>';
          if (a.platform === "csdn") {
            if (request.url.includes("editor.csdn.net"))
              return new Response(
                '<meta charset="utf-8"><body contenteditable="true" style="min-height:300px"></body>',
                { headers: { "content-type": "text/html" } },
              );
            body =
              '<iframe src="https://editor.csdn.net/editor" style="height:400px;width:600px"></iframe>';
          }
          return new Response('<meta charset="utf-8">' + title + body, {
            headers: { "content-type": "text/html" },
          });
        });
    }, a);
  await page.evaluate(async (setup) => {
    await window.studio.command({
      type: "queue.add",
      articleId: setup.id,
      accountIds: setup.accounts.map((a) => a.id),
      scheduledAt: null,
    });
    await window.studio.command({ type: "queue.pause", paused: false });
  }, setup);
  await expect
    .poll(
      async () => {
        const s = (await page.evaluate(() => window.studio.bootstrap())).state;
        return s.jobs.map((j) => [j.platform, j.status]).sort();
      },
      { timeout: 45000 },
    )
    .toEqual(setup.accounts.map((a) => [a.platform, "awaiting_review"]).sort());
  const csdn = client.windows().find((p) => p.url().includes("mp.csdn.net"))!;
  await expect(csdn.frameLocator("iframe").locator("body")).toContainText(
    "正文与",
  );
  const wechat = client
    .windows()
    .find((p) => p.url().includes("mp.weixin.qq.com"))!;
  await expect(wechat.frameLocator("iframe").locator("body")).toContainText(
    "正文与",
  );
});

test("未登录时可暂停、继续，账号会话彼此隔离", async () => {
  const s = await page.evaluate(async () => {
    await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "账号 A",
    });
    return window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "账号 B",
    });
  });
  for (const a of s.accounts)
    await client.evaluate(({ session }, id) => {
      session.fromPartition(`persist:account-${id}`).protocol.handle(
        "https",
        () =>
          new Response("<h1>请登录</h1>", {
            headers: { "content-type": "text/html" },
          }),
      );
    }, a.id);
  await client.evaluate(async ({ session }, accounts) => {
    await session
      .fromPartition(`persist:account-${accounts[0].id}`)
      .cookies.set({
        url: "https://zhuanlan.zhihu.com",
        name: "test-session",
        value: "account-a",
      });
  }, s.accounts);
  expect(
    await client.evaluate(
      async ({ session }, id) =>
        (
          await session
            .fromPartition(`persist:account-${id}`)
            .cookies.get({ name: "test-session" })
        ).length,
      s.accounts[1].id,
    ),
  ).toBe(0);
  const id = await page.evaluate(async (accountId) => {
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "登录恢复测试",
        markdown: "正文",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {},
      },
    });
    await window.studio.command({
      type: "queue.add",
      articleId: id,
      accountIds: [accountId],
      scheduledAt: null,
    });
    return id;
  }, s.accounts[0].id);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 25000 },
    )
    .toBe("needs_attention");
  const remote = client.windows().find((p) => p !== page)!;
  await remote.setContent(
    '<textarea placeholder="标题"></textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px"></div>',
  );
  await page.evaluate(async () => {
    const s = (await window.studio.bootstrap()).state;
    await window.studio.command({ type: "queue.pause", paused: true });
    await window.studio.command({ type: "job.retry", id: s.jobs[0].id });
  });
  await page.waitForTimeout(2000);
  expect(
    (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0].status,
  ).toBe("queued");
  await page.evaluate(() =>
    window.studio.command({ type: "queue.pause", paused: false }),
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 15000 },
    )
    .toBe("awaiting_review");
  await expect(remote.locator("textarea")).toHaveValue("登录恢复测试");
});

test("正文冲突预检不先改标题；框架回滚不能误报成功", async () => {
  const s = await page.evaluate(() =>
    window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "回读测试",
    }),
  );
  const a = s.accounts[0];
  await client.evaluate(({ session }, id) => {
    session
      .fromPartition(`persist:account-${id}`)
      .protocol.handle(
        "https",
        () =>
          new Response(
            '<meta charset="utf-8"><textarea placeholder="标题"></textarea><div class="public-DraftEditor-content" contenteditable="true" style="height:200px">原有正文</div>',
            { headers: { "content-type": "text/html" } },
          ),
      );
  }, a.id);
  await page.evaluate(async (accountId) => {
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await window.studio.command({
      type: "article.save",
      article: {
        id,
        title: "新标题",
        markdown: "新正文",
        collection: "其他",
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        history: [],
        overrides: {},
      },
    });
    await window.studio.command({
      type: "queue.add",
      articleId: id,
      accountIds: [accountId],
      scheduledAt: null,
    });
  }, a.id);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .status,
      { timeout: 15000 },
    )
    .toBe("needs_attention");
  const remote = client.windows().find((p) => p !== page)!;
  await expect(remote.locator("textarea")).toHaveValue("");
  await remote.evaluate(() => {
    const el = document.querySelector("[contenteditable]")!;
    el.textContent = "";
    el.addEventListener("input", () =>
      setTimeout(() => (el.textContent = ""), 50),
    );
  });
  await page.evaluate(async () => {
    const s = (await window.studio.bootstrap()).state;
    await window.studio.command({ type: "job.retry", id: s.jobs[0].id });
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.bootstrap())).state.jobs[0]
          .message,
      { timeout: 15000 },
    )
    .toContain("填充回读未通过");
});

test("知乎登录旧 HTTP 返回地址升级为 HTTPS，保留账号会话", async () => {
  const accountId = await page.evaluate(async () => {
    const state = await window.studio.command({
      type: "account.add",
      platform: "zhihu",
      name: "登录跳转测试",
    });
    return state.accounts.at(-1)!.id;
  });
  await client.evaluate(({ session }, id) => {
    let loginSeen = false;
    const ses = session.fromPartition(`persist:account-${id}`);
    ses.protocol.handle("https", (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin") {
        loginSeen = true;
        return new Response(
          `<html><body><p id="next">${url.searchParams.get("next")}</p><a href="http://zhuanlan.zhihu.com/write">模拟登录成功</a></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (!loginSeen)
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.zhihu.com/signin?next=http%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite",
          },
        });
      return new Response("<html><body><h1>已进入创作页</h1></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
  }, accountId);
  const opened = client.waitForEvent("window");
  await page.evaluate(
    (id) => window.studio.command({ type: "account.open", id }),
    accountId,
  );
  const remote = await opened;
  await expect(remote.locator("#next")).toHaveText(
    "https://zhuanlan.zhihu.com/write",
  );
  await remote.getByRole("link", { name: "模拟登录成功" }).click();
  await expect(
    remote.getByRole("heading", { name: "已进入创作页" }),
  ).toBeVisible();
  await expect(remote).toHaveURL("https://zhuanlan.zhihu.com/write");
});

test("百家号 stoken 登录与注册 HTTP 回跳升级为 HTTPS", async () => {
  const accountId = await page.evaluate(async () => {
    const state = await window.studio.command({
      type: "account.add",
      platform: "baijiahao",
      name: "登录跳转测试",
    });
    return state.accounts.at(-1)!.id;
  });
  await client.evaluate(({ session }, id) => {
    let loginSeen = false;
    const ses = session.fromPartition(`persist:account-${id}`);
    ses.protocol.handle("https", (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/builder/fe-react/stoken.html") {
        loginSeen = true;
        return new Response(
          `<html><body><p id="next">${url.searchParams.get("u")}</p><a href="http://baijiahao.baidu.com/builder/rc/home">模拟登录成功</a></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (!loginSeen)
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://baijiahao.baidu.com/builder/fe-react/stoken.html?u=http%3A%2F%2Fbaijiahao.baidu.com%2Fbuilder%2Frc%2Fhome",
          },
        });
      return new Response("<html><body><h1>已进入创作页</h1></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
  }, accountId);
  const opened = client.waitForEvent("window");
  await page.evaluate(
    (id) => window.studio.command({ type: "account.open", id }),
    accountId,
  );
  const remote = await opened;
  await expect(remote.locator("#next")).toHaveText(
    "https://baijiahao.baidu.com/builder/rc/home",
  );
  await remote.getByRole("link", { name: "模拟登录成功" }).click();
  await expect(
    remote.getByRole("heading", { name: "已进入创作页" }),
  ).toBeVisible();
  await expect(remote).toHaveURL("https://baijiahao.baidu.com/builder/rc/home");
});

test("百家号新版编辑器检查后立即更新账号卡片状态", async () => {
  const accountId = await page.evaluate(async () => {
    const state = await window.studio.command({
      type: "account.add",
      platform: "baijiahao",
      name: "百家号新版编辑器",
    });
    return state.accounts.at(-1)!.id;
  });
  await client.evaluate(({ session }, id) => {
    session.fromPartition(`persist:account-${id}`).protocol.handle(
      "https",
      () =>
        new Response(
          `<meta charset="utf-8">
             <div data-lexical-editor="true" contenteditable="true" style="width:500px;height:50px"></div>
             <script>
               window.UE_V2 = { instants: { editor: {
                 isReady: true,
                 body: {},
                 value: "",
                 getContentTxt() { return this.value; },
                 setContent(value) { this.value = value.replace(/<[^>]+>/g, ""); }
               } } };
             </script>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
  }, accountId);
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  const card = page.locator(".account-card").filter({
    has: page.getByRole("heading", { name: "百家号新版编辑器" }),
  });
  await expect(card.getByText("暂未确认", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "检查", exact: true }).click();
  await expect(card.getByText("编辑器已验证", { exact: true })).toBeVisible();
  await expect(card.getByText(/最近检查/)).toBeVisible();
});

test("平台账号窗口使用完整 Chrome 浏览器身份", async () => {
  const accountId = await page.evaluate(async () => {
    const state = await window.studio.command({
      type: "account.add",
      platform: "toutiao",
      name: "头条登录身份测试",
    });
    return state.accounts.at(-1)!.id;
  });
  await client.evaluate(({ session }, id) => {
    session.fromPartition(`persist:account-${id}`).protocol.handle(
      "https",
      () =>
        new Response("<html><body>identity</body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
  }, accountId);
  const opened = client.waitForEvent("window");
  await page.evaluate(
    (id) => window.studio.command({ type: "account.open", id }),
    accountId,
  );
  const remote = await opened;
  const identity = await remote.evaluate(() => {
    const agentData = (
      navigator as Navigator & {
        userAgentData?: {
          brands: { brand: string }[];
          platform: string;
        };
      }
    ).userAgentData;
    return {
      userAgent: navigator.userAgent,
      brands: agentData?.brands.map((item) => item.brand) ?? [],
      platform: agentData?.platform,
    };
  });
  expect(identity.userAgent).toContain("Chrome/");
  expect(identity.userAgent).not.toContain("Electron/");
  expect(identity.brands).toContain("Google Chrome");
  expect(identity.platform).toBe("macOS");
});
