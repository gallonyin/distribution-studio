import { ImageConfigStore } from "./image-config";
import { generateImage } from "./image-api";
import {
  imageConfigSchema,
  imageRequestSchema,
  providerIdSchema,
} from "../src/image-domain";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  ClipboardItem,
  Menu,
  safeStorage,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import {
  articleSchema,
  platformSchema,
  platformIds,
  stateSchema,
  type Article,
  type Asset,
  type State,
  allowedPlatformUrl,
} from "../src/domain";
import { makePreview, htmlDocument } from "./content";
import { Store } from "./store";
import { Publisher } from "./publisher";
import { parseCommand } from "./commands";
if (!app.isPackaged && process.env.STUDIO_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.STUDIO_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.quit();
let main: BrowserWindow;
let store: Store;
let publisher: Publisher;
const rendererPath = path.join(__dirname, "../dist/index.html");
function trusted(event: Electron.IpcMainInvokeEvent) {
  const expected =
    !app.isPackaged && process.env.STUDIO_DEV_URL
      ? process.env.STUDIO_DEV_URL
      : pathToFileURL(rendererPath).href;
  if (
    event.sender !== main.webContents ||
    event.senderFrame !== main.webContents.mainFrame ||
    event.senderFrame.url !== expected
  )
    throw Error("拒绝非工作台页面请求。");
}
function send(state: State) {
  if (main && !main.isDestroyed()) main.webContents.send("studio:state", state);
}
async function preview(
  article: Article,
  platform: z.infer<typeof platformSchema>,
) {
  return makePreview(article, platform, store.state.assets, (a) =>
    store.assetData(a),
  );
}
function safeName(s: string) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 70) || "article";
}
async function saveFile(defaultPath: string, filters: Electron.FileFilter[]) {
  const result = await dialog.showSaveDialog(main, { defaultPath, filters });
  return result.canceled ? null : result.filePath;
}
async function importArticle() {
  const result = await dialog.showOpenDialog(main, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  if (result.canceled) return;
  for (const file of result.filePaths) {
    if (fs.statSync(file).size > 1024 * 1024)
      throw Error("单篇文章不能超过 1 MB。");
    let markdown = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    let title = path.basename(file, path.extname(file));
    const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (frontmatter) {
      const match = frontmatter[1].match(/^title:\s*["']?(.*?)["']?\s*$/m);
      if (match) title = match[1];
      markdown = markdown.slice(frontmatter[0].length);
    }
    const heading = markdown.match(/^# (.+)\r?\n/);
    if (heading) {
      title = heading[1];
      markdown = markdown.slice(heading[0].length);
    }
    const base = fs.realpathSync(path.dirname(file));
    markdown = markdown.replace(
      /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
      (whole, alt, src) => {
        if (/^(https?:|data:|asset:)/i.test(src)) return whole;
        let relative: string;
        try {
          relative = decodeURIComponent(src);
        } catch {
          return whole;
        }
        const candidate = path.resolve(base, relative);
        if (!fs.existsSync(candidate)) return whole;
        const real = fs.realpathSync(candidate);
        if (!real.startsWith(base + path.sep)) return whole;
        if (fs.statSync(real).size > 12 * 1024 * 1024)
          throw Error("文章中图片超过 12 MB。");
        const asset = store.addAsset(
          fs.readFileSync(real),
          path.basename(real),
        );
        return `![${alt}](asset://${asset.id})`;
      },
    );
    const now = new Date().toISOString();
    store.save({
      id: randomUUID(),
      title,
      markdown,
      collection: "链上说明书",
      tags: [],
      createdAt: now,
      updatedAt: now,
      revision: 1,
      overrides: {},
      history: [],
    });
  }
}
async function exportArticle(id: string) {
  const a = store.article(id);
  const dest = await saveFile(safeName(a.title) + "-分发包.zip", [
    { name: "ZIP", extensions: ["zip"] },
  ]);
  if (!dest) return;
  const files: Record<string, Uint8Array> = {};
  for (const p of platformIds) {
    const v = await preview(a, p);
    files[`${p}/article.html`] = strToU8(htmlDocument(v.title, v.html));
    const md = v.markdown.replace(/asset:\/\/([a-f0-9]{64})/g, (_, id) => {
      const asset = store.state.assets.find((a) => a.id === id);
      if (!asset) return "";
      const ext = asset.mime.split("/")[1];
      files[`assets/${id}.${ext}`] = store.assetBuffer(asset);
      return `../assets/${id}.${ext}`;
    });
    files[`${p}/article.md`] = strToU8(`# ${v.title}\n\n${md}`);
    files[`${p}/检查清单.txt`] = strToU8(v.warnings.join("\n"));
  }
  files["README.txt"] = strToU8(
    "分发工作台导出包\n各平台目录包含 Markdown、HTML 和检查清单；图片放在 assets。HTML 内嵌本地图片，可独立预览。导出不代表已提交平台。",
  );
  fs.writeFileSync(dest, zipSync(files, { level: 6 }));
}
async function backupExport() {
  const dest = await saveFile(
    `分发工作台备份-${new Date().toISOString().slice(0, 10)}.json`,
    [{ name: "JSON", extensions: ["json"] }],
  );
  if (!dest) return;
  const assets = Object.fromEntries(
    store.state.assets.map((a) => [
      a.id,
      store.assetBuffer(a).toString("base64"),
    ]),
  );
  fs.writeFileSync(
    dest,
    JSON.stringify({
      format: "distribution-studio-backup",
      state: store.state,
      assets,
    }),
    { mode: 0o600 },
  );
}
async function backupImport() {
  if (publisher.busy) throw Error("请等待当前填充任务结束后再恢复备份。");
  const r = await dialog.showOpenDialog(main, {
    properties: ["openFile"],
    filters: [{ name: "工作台备份", extensions: ["json"] }],
  });
  if (r.canceled) return;
  if (fs.statSync(r.filePaths[0]).size > 250 * 1024 * 1024)
    throw Error("备份文件超过 250 MB。");
  const raw = z
    .object({
      format: z.literal("distribution-studio-backup"),
      state: stateSchema,
      assets: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")));
  const buffers = new Map<string, Buffer>();
  for (const a of raw.state.assets) {
    const buf = Buffer.from(raw.assets[a.id] ?? "", "base64");
    if (
      buf.length !== a.size ||
      createHash("sha256").update(buf).digest("hex") !== a.id
    )
      throw Error("备份图片校验失败。");
    buffers.set(a.id, buf);
  }
  const confirm = await dialog.showMessageBox(main, {
    type: "question",
    buttons: ["取消", "恢复备份"],
    defaultId: 0,
    cancelId: 0,
    message: "用备份替换当前工作区？",
    detail:
      "当前 workspace.json 会保留为 .bak；账号登录凭据不包含在备份中。恢复后队列暂停，所有未完成任务需检查。",
  });
  if (confirm.response !== 1) return;
  // Recheck after the dialog: the scheduler may have started while the user was reviewing it.
  if (publisher.busy) throw Error("有任务正在运行，请暂停队列后重试。");
  for (const [id, buf] of buffers)
    fs.writeFileSync(path.join(store.directory, "assets", id), buf, {
      mode: 0o600,
    });
  for (const w of publisher.windows.values()) w.destroy();
  raw.state.settings.queuePaused = true;
  for (const a of raw.state.accounts) a.status = "unknown";
  for (const j of raw.state.jobs)
    if (!["published", "cancelled"].includes(j.status)) {
      j.status = "needs_attention";
      j.message = "从备份恢复，请检查平台草稿后继续。";
    }
  store.change((s) => Object.assign(s, raw.state));
}
async function command(input: unknown) {
  const c = parseCommand(input);
  switch (c.type) {
    case "article.save":
      store.save(c.article);
      break;
    case "article.delete":
      if (
        store.state.jobs.some(
          (j) =>
            j.articleId === c.id &&
            !["published", "cancelled"].includes(j.status),
        )
      )
        throw Error("请先处理或取消该文章的未完成任务。");
      store.change((s) => {
        s.articles = s.articles.filter((a) => a.id !== c.id);
      });
      break;
    case "article.duplicate": {
      const a = structuredClone(store.article(c.id));
      a.id = randomUUID();
      a.title += "（副本）";
      a.history = [];
      a.revision = 1;
      store.save(a);
      break;
    }
    case "article.restore": {
      const a = structuredClone(store.article(c.id));
      const h = a.history.find((h) => h.revision === c.revision);
      if (!h) throw Error("历史版本不存在。");
      a.title = h.title;
      a.markdown = h.markdown;
      store.save(a);
      break;
    }
    case "account.add":
      if (c.platform === "web") throw Error("自建 Web 请使用导出包。");
      store.change((s) =>
        s.accounts.push({
          id: randomUUID(),
          platform: c.platform,
          name: c.name,
          status: "unknown",
        }),
      );
      break;
    case "account.delete":
      await publisher.removeAccount(c.id);
      break;
    case "account.open":
      await publisher.open(c.id);
      break;
    case "account.checkAll":
      await publisher.checkAll();
      break;
    case "account.check":
      await publisher.check(c.id);
      break;
    case "account.reorder": {
      const currentIds = store.state.accounts.map((account) => account.id);
      if (
        c.ids.length !== currentIds.length ||
        c.ids.some((id) => !currentIds.includes(id))
      )
        throw Error("账号排序与当前账号不一致，请刷新后重试。");
      store.change((s) => {
        const accounts = new Map(
          s.accounts.map((account) => [account.id, account]),
        );
        s.accounts = c.ids.map((id) => accounts.get(id)!);
      });
      break;
    }
    case "queue.add":
      store.enqueue(c.articleId, c.accountIds, c.scheduledAt);
      break;
    case "queue.cancelAll":
      await publisher.cancelAll();
      break;
    case "queue.clearCancelled":
      store.clearCancelledJobs();
      break;
    case "job.delete":
      store.deleteJob(c.id);
      break;
    case "queue.pause":
      store.change((s) => {
        s.settings.queuePaused = c.paused;
      });
      break;
    case "job.retry": {
      store.retry(c.id);
      break;
    }
    case "job.cancel": {
      await publisher.cancel(c.id);
      break;
    }
    case "job.open": {
      const j = store.job(c.id);
      if (j.status === "published" && j.resultUrl) {
        if (!allowedPlatformUrl(j.platform, j.resultUrl))
          throw Error("文章链接不属于该平台。");
        await shell.openExternal(j.resultUrl);
      } else await publisher.open(j.accountId);
      break;
    }
    case "job.confirm":
      store.confirm(c.id, c.url);
      break;
    case "asset.delete":
      store.deleteAsset(c.id);
      break;
    case "asset.import": {
      const r = await dialog.showOpenDialog(main, {
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (!r.canceled)
        for (const f of r.filePaths) {
          if (fs.statSync(f).size > 12 * 1024 * 1024)
            throw Error("图片超过 12 MB。");
          store.addAsset(fs.readFileSync(f), path.basename(f));
        }
      break;
    }
    case "article.import":
      await importArticle();
      break;
    case "article.export":
      await exportArticle(c.id);
      break;
    case "backup.export":
      await backupExport();
      break;
    case "backup.import":
      await backupImport();
      break;
    case "data.open":
      await shell.openPath(store.directory);
      break;
  }
  return structuredClone(store.state);
}
async function healthReport(argv: string[]) {
  const requestId = argv
    .find((x) => /^--check-accounts=[a-f0-9-]{36}$/.test(x))
    ?.split("=")[1];
  if (!requestId) return;
  try {
    await publisher.checkAll();
    const report = {
      requestId,
      checkedAt: new Date().toISOString(),
      accounts: store.state.accounts.map(
        ({
          id,
          platform,
          name,
          status,
          checkedAt,
          checkMethod,
          checkMessage,
        }) => ({
          id,
          platform,
          name,
          status,
          checkedAt,
          checkMethod,
          checkMessage,
        }),
      ),
    };
    const dest = path.join(store.directory, "account-health-report.json");
    fs.writeFileSync(dest + ".tmp", JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(dest + ".tmp", dest);
  } catch {
    /* The CLI deadline reports failures without logging credentials. */
  }
}
app.on("second-instance", (_event, argv) => {
  if (argv.some((x) => x.startsWith("--check-accounts="))) {
    void healthReport(argv);
    return;
  }
  main?.show();
  main?.focus();
});
app.whenReady().then(async () => {
  try {
    app.userAgentFallback = app.userAgentFallback
      .split(" ")
      .filter(
        (token) =>
          !/[\u0080-\uffff]/.test(token) && !token.startsWith("Electron/"),
      )
      .join(" ");
    store = new Store(app.getPath("userData"), send);
    const imageConfig = new ImageConfigStore(store.directory, safeStorage);
    let imageBusy = false;
    publisher = new Publisher(store, path.join(__dirname, "inject.js"));
    main = new BrowserWindow({
      width: 1480,
      height: 960,
      minWidth: 1080,
      minHeight: 720,
      title: "分发工作台",
      backgroundColor: "#f5f6f2",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const workspaceMenu = Menu.buildFromTemplate([
      {
        label: "分发工作台",
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }] },
    ]);
    Menu.setApplicationMenu(workspaceMenu);
    main.on("focus", () => Menu.setApplicationMenu(workspaceMenu));
    main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    main.webContents.on("will-navigate", (e) => e.preventDefault());
    main.webContents.on("will-attach-webview", (e) => e.preventDefault());
    main.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    ipcMain.handle("studio:image-config", async (e, input) => {
      trusted(e);
      const action = z
        .discriminatedUnion("type", [
          z.object({ type: z.literal("get") }).strict(),
          z
            .object({
              type: z.literal("select"),
              provider: providerIdSchema,
              model: z.string().trim().min(1).max(120).optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("save"),
              config: imageConfigSchema,
              clearKeys: z.array(providerIdSchema).optional(),
            })
            .strict(),
          z
            .object({ type: z.literal("export"), includeSecrets: z.boolean() })
            .strict(),
          z.object({ type: z.literal("import") }).strict(),
        ])
        .parse(input);
      if (action.type === "select")
        return imageConfig.select(action.provider, action.model);
      if (action.type === "save")
        return imageConfig.save(action.config, action.clearKeys);
      if (action.type === "export") {
        const dest = await saveFile(
          path.join(app.getPath("documents"), "image-providers.user.json"),
          [{ name: "生图配置 JSON", extensions: ["json"] }],
        );
        if (dest) {
          const output = dest.endsWith(".user.json")
            ? dest
            : dest.replace(/\.json$/i, "") + ".user.json";
          if (path.resolve(output) === path.resolve(imageConfig.file))
            throw Error("请选择其他导出位置，不能覆盖当前加密配置。");
          fs.writeFileSync(output, imageConfig.export(action.includeSecrets), {
            mode: 0o600,
          });
          fs.chmodSync(output, 0o600);
        }
      }
      if (action.type === "import") {
        const r = await dialog.showOpenDialog(main, {
          properties: ["openFile"],
          filters: [{ name: "生图配置 JSON", extensions: ["json"] }],
        });
        if (!r.canceled) {
          if (fs.statSync(r.filePaths[0]).size > 65536)
            throw Error("配置文件超过 64 KB。");
          imageConfig.import(fs.readFileSync(r.filePaths[0], "utf8"));
        }
      }
      return imageConfig.view();
    });
    ipcMain.handle("studio:image-generate", async (e, input) => {
      trusted(e);
      const request = imageRequestSchema.parse(input);
      if (imageBusy) throw Error("已有生图请求正在运行，请等待完成。");
      imageBusy = true;
      const start = Date.now();
      const config = imageConfig.get();
      try {
        const buffer = await generateImage(config, request);
        const asset = store.addAsset(
          buffer,
          `${request.provider}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
        );
        const ext = asset.mime.split("/")[1];
        store.change((s) => {
          const a = s.assets.find((a) => a.id === asset.id)!;
          a.name = a.name.replace(/\.png$/, "." + ext);
        });
        const result = {
          assetId: asset.id,
          provider: request.provider,
          model: config.providers[request.provider].model,
          elapsedMs: Date.now() - start,
        };
        fs.mkdirSync(path.join(store.directory, "image-history"), {
          recursive: true,
          mode: 0o700,
        });
        fs.writeFileSync(
          path.join(store.directory, "image-history", randomUUID() + ".json"),
          JSON.stringify(
            { ...result, ...request, createdAt: new Date().toISOString() },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        return result;
      } finally {
        imageBusy = false;
      }
    });
    ipcMain.handle("studio:bootstrap", (e) => {
      trusted(e);
      return {
        state: structuredClone(store.state),
        dataPath: store.directory,
        version: app.getVersion(),
      };
    });
    ipcMain.handle("studio:command", async (e, c) => {
      trusted(e);
      return command(c);
    });
    ipcMain.handle("studio:preview", async (e, a, p) => {
      trusted(e);
      return preview(articleSchema.parse(a), platformSchema.parse(p));
    });
    ipcMain.handle("studio:copy", async (e, a, p, f) => {
      trusted(e);
      const format = z.enum(["html", "markdown", "text"]).parse(f);
      const v = await preview(articleSchema.parse(a), platformSchema.parse(p));
      if (format === "html")
        await clipboard.write([
          new ClipboardItem({ "text/html": v.html, "text/plain": v.text }),
        ]);
      else
        await clipboard.writeText(format === "markdown" ? v.markdown : v.text);
    });
    if (!app.isPackaged && process.env.STUDIO_DEV_URL)
      await main.loadURL(process.env.STUDIO_DEV_URL);
    else await main.loadFile(rendererPath);
    publisher.start();
    void healthReport(process.argv);
    main.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(main, {
        type: "question",
        buttons: ["继续编辑", "放弃修改并退出"],
        defaultId: 0,
        cancelId: 0,
        message: "有未保存的文章修改。",
      });
      if (choice === 1) event.preventDefault();
    });
    main.on("closed", () => {
      publisher.stop();
      for (const w of publisher.windows.values()) w.destroy();
    });
  } catch (e) {
    dialog.showErrorBox("工作台启动失败", String(e));
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
