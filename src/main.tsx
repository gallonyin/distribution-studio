import { AccountVault } from "./AccountVault";
import { ImageSettings, ImageGenerator } from "./ImageTools";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  FileText,
  Send,
  Users,
  Images,
  Settings,
  Plus,
  Search,
  Upload,
  Download,
  Copy,
  Check,
  ChevronRight,
  ArrowUpRight,
  Save,
  Trash2,
  Pause,
  Play,
  Clock,
  AlertCircle,
  X,
  BookOpen,
  Layers,
  PanelLeftClose,
  RefreshCw,
  ExternalLink,
  History,
  FolderOpen,
  CheckCircle2,
  GripVertical,
} from "lucide-react";
import {
  newArticle,
  platformIds,
  platforms,
  statusLabels,
  type Article,
  type State,
  type PlatformId,
  type Preview,
  type Command,
  type Job,
  type Asset,
} from "./domain";
import "./styles.css";
type View = "articles" | "jobs" | "accounts" | "assets" | "settings" | "vault";
const initial: State = {
  version: 1,
  articles: [],
  accounts: [],
  assets: [],
  jobs: [],
  settings: { queuePaused: false },
};
function Badge({ platform }: { platform: PlatformId }) {
  return (
    <span
      className="platform-icon"
      style={{ background: platforms[platform].color }}
    >
      {platforms[platform].short}
    </span>
  );
}
function App() {
  const [state, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [dataPath, setDataPath] = useState(""),
    [view, setView] = useState<View>("articles");
  const [draft, setDraft] = useState<Article | null>(null),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("全部内容");
  const [platform, setPlatform] = useState<PlatformId>("wechat"),
    [editing, setEditing] = useState<"source" | "variant">("source"),
    [preview, setPreview] = useState<Preview | null>(null),
    [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"publish" | "account" | "confirm" | null>(
      null,
    );
  const [accountPlatform, setAccountPlatform] = useState<PlatformId>("wechat"),
    [accountName, setAccountName] = useState(""),
    [selectedAccounts, setSelectedAccounts] = useState<string[]>([]),
    [schedule, setSchedule] = useState("");
  const [confirmJob, setConfirmJob] = useState<Job | null>(null),
    [resultUrl, setResultUrl] = useState("");
  const [draggedAccount, setDraggedAccount] = useState<string | null>(null),
    [accountDrop, setAccountDrop] = useState<{
      id: string;
      position: "before" | "after";
    } | null>(null);
  const [checkingAccounts, setCheckingAccounts] = useState<Set<string>>(
    new Set(),
  );
  const checkingRef = useRef(new Set<string>());
  async function checkAccount(id: string) {
    if (checkingRef.current.has(id)) return;
    checkingRef.current.add(id);
    setCheckingAccounts(new Set(checkingRef.current));
    try {
      const next = await window.studio.command({ type: "account.check", id });
      // Store pushes carry every account's latest result. A concurrent command's
      // response must not overwrite newer state from another operation.
      const account = next.accounts.find((a) => a.id === id);
      notify(
        account?.status === "editor_ready"
          ? "已识别标题与正文编辑器"
          : account?.checkMessage || "暂未确认，请手动打开平台",
      );
    } catch (error) {
      notify(String(error).replace(/^Error:.*?Error: /, ""), true);
    } finally {
      checkingRef.current.delete(id);
      setCheckingAccounts(new Set(checkingRef.current));
    }
  }
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const reorderAccount = useCallback(
    async (
      sourceId: string,
      targetId: string,
      position: "before" | "after",
    ) => {
      const current = state.accounts.map((account) => account.id);
      const ids = current.filter((id) => id !== sourceId);
      const targetIndex = ids.indexOf(targetId);
      if (targetIndex < 0) return;
      ids.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
      if (ids.every((id, index) => id === current[index])) return;
      const next = await act({ type: "account.reorder", ids });
      if (next) setState(next);
    },
    [state.accounts],
  );
  const moveAccount = useCallback(
    async (id: string, offset: number) => {
      const index = state.accounts.findIndex((account) => account.id === id);
      const target = state.accounts[index + offset];
      if (!target) return;
      await reorderAccount(id, target.id, offset < 0 ? "before" : "after");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[data-account-drag="${id}"]`)
          ?.focus(),
      );
    },
    [reorderAccount, state.accounts],
  );
  useEffect(() => {
    if (!window.studio) {
      notify("请通过桌面客户端启动，浏览器预览不连接本地数据。", true);
      return;
    }
    window.studio
      .bootstrap()
      .then((b) => {
        setState(b.state);
        setDataPath(b.dataPath);
        setReady(true);
        setDraft(b.state.articles[0] ?? null);
      })
      .catch((e) => notify(String(e), true));
    return window.studio.onState(setState);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.error ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    let ignore = false;
    const t = setTimeout(() => {
      if (draft)
        window.studio
          .preview(draft, platform)
          .then((p) => {
            if (!ignore) setPreview(p);
          })
          .catch((e) => notify(String(e), true));
      else setPreview(null);
    }, 220);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [draft, platform, state.assets]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "有未保存的修改。";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, []);
  async function act(c: Command) {
    setBusy(true);
    try {
      const next = await window.studio.command(c);
      // Store pushes are authoritative; a slow command response can be older.
      return next;
    } catch (e) {
      notify(String(e).replace(/^Error:.*?Error: /, ""), true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return null;
    const sent = draft;
    const next = await act({ type: "article.save", article: sent });
    if (next) {
      const saved = next.articles.find((a) => a.id === sent.id)!;
      if (draftRef.current !== sent && draftRef.current?.id === sent.id) {
        setDraft({
          ...draftRef.current,
          revision: saved.revision,
          history: saved.history,
        });
        setDirty(true);
        notify("保存期间有新修改，请再次保存。");
        return null;
      }
      setDraft(saved);
      setDirty(false);
      notify("已保存到本地");
      return saved;
    }
    return null;
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [draft]);
  function canLeave() {
    return !dirty || window.confirm("当前修改尚未保存。放弃这些修改？");
  }
  function selectArticle(a: Article) {
    if (!canLeave()) return;
    setDraft(structuredClone(a));
    setDirty(false);
    setView("articles");
    setEditing("source");
  }
  async function create(template = false) {
    if (!canLeave()) return;
    const a = newArticle();
    if (template) {
      a.title = "一份主稿，发布到多个平台";
      a.markdown =
        '## 这篇文章解决什么问题\n\n把核心事实写在主稿中，再为不同平台调整标题、篇幅和排版。\n\n## 操作步骤\n\n1. 整理文章和图片素材。\n2. 在平台稿中调整标题与表达。\n3. 预览后创建分发任务。\n4. 到平台检查并确认发布。\n\n> 这是一个写作模板，可替换为你的实际内容。\n\n```js\nconst article = { title: "一份主稿" };\n```\n';
    }
    setDraft(a);
    setDirty(true);
    setView("articles");
    setEditing("source");
  }
  function update(part: Partial<Article>) {
    if (draft) {
      setDraft({ ...draft, ...part });
      setDirty(true);
    }
  }
  function setContent(key: "title" | "markdown", value: string) {
    if (!draft) return;
    if (editing === "source") update({ [key]: value });
    else {
      const current = draft.overrides[platform] ?? {
        title: draft.title,
        markdown: draft.markdown,
      };
      update({
        overrides: {
          ...draft.overrides,
          [platform]: { ...current, [key]: value },
        },
      });
    }
  }
  async function openPublish() {
    const saved = dirty ? await save() : draft;
    if (!saved) return;
    setSelectedAccounts([]);
    setSchedule("");
    setModal("publish");
  }
  async function enqueue() {
    if (!draft) return;
    const next = await act({
      type: "queue.add",
      articleId: draft.id,
      accountIds: selectedAccounts,
      scheduledAt: schedule ? new Date(schedule).toISOString() : null,
    });
    if (next) {
      setModal(null);
      setView("jobs");
      notify("已创建分发任务");
    }
  }
  async function copy(format: "html" | "markdown" | "text") {
    if (!draft) return;
    try {
      await window.studio.copy(draft, platform, format);
      notify(
        format === "html" ? "已复制富文本，可粘贴到平台编辑器" : "已复制内容",
      );
    } catch (e) {
      notify(String(e), true);
    }
  }
  const counts = state.jobs.filter(
    (j) => !["published", "cancelled"].includes(j.status),
  ).length;
  const cancelledCount = state.jobs.filter(
    (j) => j.status === "cancelled",
  ).length;
  const articles = state.articles.filter(
    (a) =>
      (filter === "全部内容" || a.collection === filter) &&
      [a.title, a.markdown, ...a.tags]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const content = draft
    ? editing === "variant"
      ? (draft.overrides[platform] ?? {
          title: draft.title,
          markdown: draft.markdown,
        })
      : draft
    : null;
  const nav: [View, typeof FileText, string][] = [
    ["articles", FileText, "内容工作台"],
    ["jobs", Send, "分发任务"],
    ["accounts", Users, "平台账号"],
    ["vault", BookOpen, "账号资料表"],
    ["assets", Images, "素材库"],
    ["settings", Settings, "设置与备份"],
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            <Layers size={23} />
          </div>
          <div>
            分发工作台<small>DISTRIBUTION STUDIO</small>
          </div>
        </div>
        <div className="workspace-label">
          我的工作空间 <span>LOCAL</span>
        </div>
        <nav>
          {nav.map(([key, Icon, label]) => (
            <button
              key={key}
              className={view === key ? "nav active" : "nav"}
              onClick={() => setView(key)}
            >
              <Icon size={19} />
              {label}
              {key === "jobs" && counts > 0 && <b>{counts}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="online-dot" /> 本地存储 · 账号独立会话
          <p>
            让内容保持一致，
            <br />
            让表达适合每个平台。
          </p>
        </div>
        <div className="sidebar-bottom">图文分发 · v0.2.3</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            工作空间 <ChevronRight size={14} />
            <strong>{nav.find((n) => n[0] === view)?.[2]}</strong>
          </span>
          <span className="topbar-right">
            <span className="online-dot" />
            {ready ? "本地工作区已连接" : "正在连接工作区"}
          </span>
        </header>
        {view === "articles" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">WRITE ONCE, PUBLISH WITH CARE</div>
                <h1>内容工作台</h1>
                <p>一份主稿，适配每个平台。所有内容与修改保存在本机。</p>
              </div>
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!canLeave()) return;
                    const n = await act({ type: "article.import" });
                    if (n) {
                      setDraft(n.articles[0] ?? null);
                      setDirty(false);
                    }
                  }}
                >
                  <Upload size={16} />
                  导入 Markdown
                </button>
                <button className="primary" onClick={() => create()}>
                  <Plus size={17} />
                  新建文章
                </button>
              </div>
            </section>
            <section className="editor-layout">
              <aside className="article-list">
                <div className="list-head">
                  <b>内容库</b>
                  <span>{state.articles.length}</span>
                </div>
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="搜索文章"
                    placeholder="搜索标题或正文"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="内容分类"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option>全部内容</option>
                  <option>链上说明书</option>
                  <option>ToC 软件</option>
                  <option>其他</option>
                </select>
                <div className="article-items">
                  {articles.map((a) => (
                    <button
                      key={a.id}
                      className={
                        "article-item " + (draft?.id === a.id ? "selected" : "")
                      }
                      onClick={() => selectArticle(a)}
                    >
                      <span className="article-category">{a.collection}</span>
                      <strong>{a.title || "未命名文章"}</strong>
                      <p>
                        {a.markdown.replace(/[#*>`]/g, "").slice(0, 60) ||
                          "开始撰写正文…"}
                      </p>
                      <footer>
                        <span>
                          {new Date(a.updatedAt).toLocaleDateString("zh-CN")}
                        </span>
                        <span>v{a.revision}</span>
                      </footer>
                    </button>
                  ))}
                  {!articles.length && (
                    <div className="list-empty">
                      还没有文章
                      <br />
                      导入已有 Markdown 或新建主稿
                    </div>
                  )}
                </div>
              </aside>
              <div className="editor-workspace">
                {!draft ? (
                  <div className="empty editor-empty">
                    <div className="empty-icon">
                      <BookOpen size={32} />
                    </div>
                    <h2>从一份好内容开始</h2>
                    <p>
                      导入《链上说明书》或软件教程，
                      <br />
                      为各个平台保留独立的表达。
                    </p>
                    <button className="primary" onClick={() => create()}>
                      开始写作 <ChevronRight size={16} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => create(true)}
                    >
                      使用写作模板
                    </button>
                    <div className="platform-strip">
                      {platformIds.slice(0, 6).map((p) => (
                        <Badge key={p} platform={p} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="editor-toolbar">
                      <div className="tabs">
                        <button
                          className={editing === "source" ? "active" : ""}
                          onClick={() => setEditing("source")}
                        >
                          基础主稿
                        </button>
                        <button
                          className={editing === "variant" ? "active" : ""}
                          onClick={() => setEditing("variant")}
                        >
                          平台稿{" "}
                          {draft.overrides[platform] && (
                            <span className="tiny-dot" />
                          )}
                        </button>
                      </div>
                      <div className="button-row">
                        <span
                          className={"save-status " + (dirty ? "unsaved" : "")}
                        >
                          {dirty
                            ? "有未保存修改"
                            : `已保存 · v${draft.revision}`}
                        </span>
                        <button
                          className="small"
                          disabled={busy || !dirty}
                          onClick={save}
                        >
                          <Save size={15} />
                          保存
                        </button>
                        <button
                          className="primary small"
                          disabled={busy || !draft.title.trim()}
                          onClick={openPublish}
                        >
                          <Send size={15} />
                          分发
                        </button>
                      </div>
                    </div>
                    <div className="platform-bar">
                      <span>适配平台</span>
                      <select
                        aria-label="适配平台"
                        value={platform}
                        onChange={(e) =>
                          setPlatform(e.target.value as PlatformId)
                        }
                      >
                        {platformIds.map((p) => (
                          <option key={p} value={p}>
                            {platforms[p].name}
                          </option>
                        ))}
                      </select>
                      <span className="platform-caption">
                        {draft.overrides[platform] ? "独立平台稿" : "跟随主稿"}
                      </span>
                      {editing === "variant" && draft.overrides[platform] && (
                        <button
                          className="text-button"
                          onClick={() => {
                            if (
                              window.confirm(
                                "删除此平台的独立改写并重新跟随主稿？",
                              )
                            ) {
                              const overrides = { ...draft.overrides };
                              delete overrides[platform];
                              update({ overrides });
                            }
                          }}
                        >
                          恢复跟随主稿
                        </button>
                      )}
                    </div>
                    <div className="writing-columns">
                      <section className="writing-pane">
                        <div className="pane-caption">
                          {editing === "source"
                            ? "MARKDOWN · 主稿"
                            : "PLATFORM EDITION · " + platforms[platform].name}
                          <button
                            title="历史版本"
                            onClick={() => setShowHistory(!showHistory)}
                          >
                            <History size={15} />
                          </button>
                        </div>
                        {editing === "variant" && (
                          <div className="inline-note">
                            修改仅用于{platforms[platform].name}；主稿保持独立。
                            {platform === "xiaohongshu"
                              ? "请整理成短文配图。"
                              : ""}
                          </div>
                        )}
                        <input
                          className="title-input"
                          aria-label="文章标题"
                          placeholder="给文章一个清晰的标题"
                          value={content!.title}
                          onChange={(e) => setContent("title", e.target.value)}
                        />
                        <textarea
                          className="markdown-input"
                          aria-label="文章正文"
                          placeholder="从这里开始写作…\n\n支持 Markdown 标题、列表、代码块和图片。"
                          value={content!.markdown}
                          onChange={(e) =>
                            setContent("markdown", e.target.value)
                          }
                          spellCheck={false}
                        />
                        <div className="writing-footer">
                          <span>
                            {[...content!.markdown].length.toLocaleString()}{" "}
                            字符
                          </span>
                          <button
                            className="text-button"
                            onClick={() => setView("assets")}
                          >
                            <Images size={14} />
                            插入图片
                          </button>
                          <select
                            aria-label="文章集合"
                            value={draft.collection}
                            onChange={(e) =>
                              update({
                                collection: e.target
                                  .value as Article["collection"],
                              })
                            }
                          >
                            <option>链上说明书</option>
                            <option>ToC 软件</option>
                            <option>其他</option>
                          </select>
                        </div>
                      </section>
                      <section className="preview-pane">
                        <div className="pane-caption">
                          <span>平台预览 · {platforms[platform].name}</span>
                          <button
                            title="复制富文本"
                            onClick={() => copy("html")}
                          >
                            <Copy size={15} />
                          </button>
                        </div>
                        <div className="preview-paper">
                          <h2>{preview?.title || "文章预览"}</h2>
                          <iframe
                            title="平台文章预览"
                            sandbox=""
                            srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:"><style>body{margin:0;color:#3a4540;font:15px/1.9 -apple-system,sans-serif;word-break:break-word}h2{font-size:20px;color:#286b55}h3{font-size:17px}img{max-width:100%}pre{white-space:pre-wrap;background:#f4f6f3;border-radius:8px;padding:16px;font-size:12px}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #ddd;padding:6px}blockquote{border-left:3px solid #9cbdad;margin:16px 0;padding:4px 16px;color:#68786d}a{color:#277e5e}</style>${preview?.html ?? ""}`}
                          />
                        </div>
                      </section>
                    </div>
                    {showHistory && (
                      <div className="history-box">
                        <b>主稿历史（最近 30 次）</b>
                        {!draft.history.length && (
                          <span>首次保存后，后续修改将保留历史版本。</span>
                        )}
                        {[...draft.history].reverse().map((h) => (
                          <button
                            key={h.revision}
                            onClick={async () => {
                              if (!canLeave()) return;
                              const s = await act({
                                type: "article.restore",
                                id: draft.id,
                                revision: h.revision,
                              });
                              if (s) {
                                setDraft(
                                  s.articles.find((a) => a.id === draft.id)!,
                                );
                                setDirty(false);
                              }
                            }}
                          >
                            v{h.revision} · {h.title || "未命名"} ·{" "}
                            {new Date(h.at).toLocaleString()}{" "}
                            <span>恢复为新版本</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {preview && preview.warnings.length > 0 && (
                      <details className="warnings">
                        <summary>
                          <AlertCircle size={15} />
                          {preview.warnings.length} 项分发检查
                        </summary>
                        {preview.warnings.map((w) => (
                          <p key={w}>{w}</p>
                        ))}
                      </details>
                    )}
                    <div className="bottom-actions">
                      <div className="button-row">
                        <button
                          className="small"
                          onClick={() => copy("markdown")}
                        >
                          <Copy size={14} />
                          复制 Markdown
                        </button>
                        <button
                          className="small"
                          disabled={busy}
                          onClick={async () => {
                            const saved = dirty ? await save() : draft;
                            if (saved)
                              await act({
                                type: "article.export",
                                id: saved.id,
                              });
                          }}
                        >
                          <Download size={14} />
                          导出分发包
                        </button>
                      </div>
                      <div className="button-row">
                        <button
                          title="复制为新文章"
                          onClick={async () => {
                            const saved = dirty ? await save() : draft;
                            if (saved) {
                              const s = await act({
                                type: "article.duplicate",
                                id: saved.id,
                              });
                              if (s) setDraft(s.articles[0]);
                            }
                          }}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className="danger-icon"
                          title="删除文章"
                          onClick={async () => {
                            if (
                              window.confirm(
                                "删除这篇文章？未完成的任务会阻止删除。",
                              )
                            ) {
                              const s = await act({
                                type: "article.delete",
                                id: draft.id,
                              });
                              if (s) {
                                setDraft(s.articles[0] ?? null);
                                setDirty(false);
                              }
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          </>
        )}
        {view === "jobs" && (
          <>
            <section className="page-heading">
              <div className="eyebrow">PUBLISHING QUEUE</div>
              <div className="heading-line">
                <div>
                  <h1>分发任务</h1>
                  <p>
                    填充、检查、发布，每一步都有记录。预约任务仅在客户端运行时执行。
                  </p>
                </div>
                <div className="job-actions">
                  <button
                    disabled={busy || !cancelledCount}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `清理全部 ${cancelledCount} 条已取消记录？仅删除本地任务记录和执行日志，不删除原稿、素材或平台文章。删除后无法从任务中心恢复。`,
                        )
                      )
                        return;
                      if (await act({ type: "queue.clearCancelled" }))
                        notify("已清理已取消的任务记录");
                    }}
                  >
                    <Trash2 size={16} />
                    清理已取消记录（{cancelledCount}）
                  </button>
                  <button
                    disabled={
                      !state.jobs.some(
                        (j) => !["published", "cancelled"].includes(j.status),
                      )
                    }
                    onClick={() => act({ type: "queue.cancelAll" })}
                    title="取消所有未结束任务（含预约），保留平台已有内容"
                  >
                    全部取消（
                    {
                      state.jobs.filter(
                        (j) => !["published", "cancelled"].includes(j.status),
                      ).length
                    }
                    ）
                  </button>
                  <button
                    onClick={() =>
                      act({
                        type: "queue.pause",
                        paused: !state.settings.queuePaused,
                      })
                    }
                  >
                    {state.settings.queuePaused ? (
                      <Play size={16} />
                    ) : (
                      <Pause size={16} />
                    )}{" "}
                    {state.settings.queuePaused ? "恢复队列" : "暂停队列"}
                  </button>
                </div>
              </div>
              <p>
                暂停只停止后续调度；取消会停止工作台任务，平台已有草稿和文章保留。
              </p>
            </section>
            <div className="stats-grid">
              {[
                [
                  "排队与执行",
                  state.jobs.filter((j) =>
                    ["queued", "running", "cancelling"].includes(j.status),
                  ).length,
                ],
                [
                  "需要检查",
                  state.jobs.filter((j) =>
                    ["needs_attention", "awaiting_review", "failed"].includes(
                      j.status,
                    ),
                  ).length,
                ],
                [
                  "已确认发布",
                  state.jobs.filter((j) => j.status === "published").length,
                ],
              ].map(([label, value]) => (
                <div className="stat" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {!state.jobs.length ? (
              <Empty
                icon={Send}
                title="还没有分发任务"
                text="保存文章并选择平台账号，即可开始分发。"
                action={() => setView("articles")}
                actionText="返回内容工作台"
              />
            ) : (
              <div className="job-list">
                {state.jobs.map((j) => (
                  <article className="job-card" key={j.id}>
                    <div className="job-heading">
                      <Badge platform={j.platform} />
                      <div>
                        <h3>{j.snapshot.title}</h3>
                        <small>
                          {platforms[j.platform].name} ·{" "}
                          {state.accounts.find((a) => a.id === j.accountId)
                            ?.name ?? "账号已移除"}{" "}
                          · 主稿 v{j.revision}
                        </small>
                      </div>
                      <span className={"status status-" + j.status}>
                        {j.status === "running" && j.phase
                          ? {
                              opening: "打开平台",
                              waiting: "等待编辑器",
                              inspecting: "检查草稿",
                              filling: "填充并核对",
                            }[j.phase]
                          : statusLabels[j.status]}
                      </span>
                    </div>
                    <p className="job-message">{j.message}</p>
                    <div className="job-meta">
                      <span>
                        <Clock size={13} />
                        {j.scheduledAt
                          ? "预约 " + new Date(j.scheduledAt).toLocaleString()
                          : new Date(j.createdAt).toLocaleString()}
                      </span>
                      <span>执行 {j.attempts} 次</span>
                    </div>
                    <div className="job-actions">
                      <button
                        className="small"
                        disabled={busy}
                        onClick={() => act({ type: "job.open", id: j.id })}
                      >
                        <ExternalLink size={14} />
                        {j.status === "published" ? "查看文章" : "打开平台"}
                      </button>
                      {[
                        "needs_attention",
                        "failed",
                        "awaiting_review",
                        "cancelled",
                      ].includes(j.status) && (
                        <button
                          className="small"
                          disabled={busy}
                          onClick={() => act({ type: "job.retry", id: j.id })}
                        >
                          <RefreshCw size={14} />
                          {j.status === "cancelled" ? "重新执行" : "继续填充"}
                        </button>
                      )}
                      {j.status === "cancelled" && (
                        <button
                          className="small"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `删除「${j.snapshot.title}」的任务记录？仅删除本地任务记录和执行日志，不删除原稿、素材或平台文章。删除后无法从任务中心恢复。`,
                              )
                            )
                              return;
                            if (await act({ type: "job.delete", id: j.id }))
                              notify("任务记录已删除");
                          }}
                        >
                          <Trash2 size={14} />
                          删除记录
                        </button>
                      )}
                      {["awaiting_review", "needs_attention"].includes(
                        j.status,
                      ) && (
                        <button
                          className="primary small"
                          onClick={() => {
                            setConfirmJob(j);
                            setResultUrl("");
                            setModal("confirm");
                          }}
                        >
                          <Check size={14} />
                          登记已发布
                        </button>
                      )}
                      {!["cancelling", "published", "cancelled"].includes(
                        j.status,
                      ) && (
                        <button
                          className="small"
                          onClick={() => act({ type: "job.cancel", id: j.id })}
                        >
                          <X size={14} />
                          取消任务
                        </button>
                      )}
                      <details className="job-log">
                        <summary>执行记录</summary>
                        {j.logs.map((l, i) => (
                          <p key={i}>
                            <time>{new Date(l.at).toLocaleTimeString()}</time>
                            {l.message}
                          </p>
                        ))}
                      </details>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {view === "accounts" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">CONNECTED ACCOUNTS</div>
                <h1>平台账号</h1>
                <p>
                  每个账号使用独立浏览器会话。扫码与验证码在平台官方页面完成。
                </p>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setAccountName("");
                  setModal("account");
                }}
              >
                <Plus size={17} />
                添加账号
              </button>
            </section>
            <button
              className="account-check-all"
              disabled={
                busy ||
                (state.accounts.length > 0 &&
                  state.accounts.every((a) => checkingAccounts.has(a.id)))
              }
              onClick={() => {
                for (const account of state.accounts)
                  void checkAccount(account.id);
              }}
            >
              批量快速检测全部账号
            </button>
            <div className="info-banner">
              <AlertCircle size={17} />
              <span>
                后台并发检测，不弹出平台窗口。已登录不等于编辑器可用；网络失败会显示暂未确认。“编辑器已验证”表示最近一次检查识别到标题和正文，不代表平台账号永久在线。首次分发前请核对窗口中的账号。拖动卡片右上角手柄可调整顺序。
              </span>
            </div>
            <div className="account-grid">
              {state.accounts.map((a) => (
                <article
                  className={
                    "account-card" +
                    (draggedAccount === a.id ? " dragging" : "") +
                    (accountDrop?.id === a.id
                      ? ` drop-${accountDrop.position}`
                      : "")
                  }
                  key={a.id}
                  onDragOver={(event) => {
                    if (!draggedAccount || draggedAccount === a.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const vertical = (event.clientY - rect.top) / rect.height;
                    const horizontal = (event.clientX - rect.left) / rect.width;
                    const position =
                      vertical > 0.65 || (vertical >= 0.35 && horizontal > 0.5)
                        ? "after"
                        : "before";
                    if (
                      accountDrop?.id !== a.id ||
                      accountDrop.position !== position
                    )
                      setAccountDrop({ id: a.id, position });
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node)
                    )
                      setAccountDrop(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId =
                      draggedAccount ||
                      event.dataTransfer.getData("text/plain");
                    const position = accountDrop?.position ?? "before";
                    setDraggedAccount(null);
                    setAccountDrop(null);
                    if (sourceId && sourceId !== a.id)
                      void reorderAccount(sourceId, a.id, position);
                  }}
                >
                  <div className="account-top">
                    <Badge platform={a.platform} />
                    <div className="account-top-actions">
                      <span
                        className={
                          "account-status " +
                          (a.status === "editor_ready" ? "good" : "")
                        }
                      >
                        {a.status === "editor_ready"
                          ? "编辑器已验证"
                          : a.status === "authenticated"
                            ? "已登录"
                            : a.status === "needs_login"
                              ? "需要登录"
                              : "暂未确认"}
                      </span>
                      <button
                        type="button"
                        className="account-drag-handle"
                        draggable
                        data-account-drag={a.id}
                        aria-label={`调整${a.name}顺序`}
                        title="拖动排序；也可用方向键调整"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", a.id);
                          setDraggedAccount(a.id);
                        }}
                        onDragEnd={() => {
                          setDraggedAccount(null);
                          setAccountDrop(null);
                        }}
                        onKeyDown={(event) => {
                          if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
                            event.preventDefault();
                            void moveAccount(a.id, -1);
                          } else if (
                            ["ArrowRight", "ArrowDown"].includes(event.key)
                          ) {
                            event.preventDefault();
                            void moveAccount(a.id, 1);
                          }
                        }}
                      >
                        <GripVertical size={16} />
                      </button>
                    </div>
                  </div>
                  <h3>{a.name}</h3>
                  <p>{platforms[a.platform].name} · 独立会话</p>
                  <small>
                    {a.checkedAt
                      ? "最近检查 " + new Date(a.checkedAt).toLocaleString()
                      : "尚未检查编辑器"}
                  </small>
                  <small>
                    {a.checkMessage}
                    {a.checkMethod ? ` · ${a.checkMethod}` : ""}
                  </small>
                  <div className="button-row">
                    <button
                      className="small"
                      disabled={busy}
                      onClick={() => act({ type: "account.open", id: a.id })}
                    >
                      <ArrowUpRight size={15} />
                      登录 / 打开
                    </button>
                    <button
                      className="small"
                      disabled={busy || checkingAccounts.has(a.id)}
                      aria-busy={checkingAccounts.has(a.id)}
                      onClick={() => void checkAccount(a.id)}
                    >
                      <RefreshCw
                        size={14}
                        className={
                          checkingAccounts.has(a.id)
                            ? "account-check-spinner"
                            : undefined
                        }
                      />
                      {checkingAccounts.has(a.id) ? "检查中" : "检查"}
                    </button>
                    <button
                      className="danger-icon"
                      title="删除账号及登录会话"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "移除账号并清除其本地登录会话和已保存的登录资料？",
                          )
                        )
                          void act({ type: "account.delete", id: a.id });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
              <button
                className="add-account"
                onClick={() => setModal("account")}
              >
                <Plus size={24} />
                <strong>连接新的平台账号</strong>
                <span>支持同平台多个账号</span>
              </button>
            </div>
            <div className="supported">
              <h3>支持的图文分发渠道</h3>
              <div>
                {platformIds.map((p) => (
                  <span key={p}>
                    <Badge platform={p} />
                    {platforms[p].name}
                    <small>{platforms[p].group}</small>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
        {view === "assets" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">ASSET LIBRARY</div>
                <h1>图片素材</h1>
                <p>
                  图片按内容去重保存在本地。支持
                  PNG、JPEG、WebP、GIF，单张不超过 12 MB。
                </p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => act({ type: "asset.import" })}
              >
                <Upload size={16} />
                导入图片
              </button>
            </section>
            {draft && (
              <div className="info-banner">
                <FileText size={16} />
                当前文章：{draft.title || "未命名文章"} · 插入到
                {editing === "source"
                  ? "主稿"
                  : platforms[platform].name + "平台稿"}
              </div>
            )}
            <ImageGenerator />
            {!state.assets.length ? (
              <Empty
                icon={Images}
                title="把文章的配图放在这里"
                text="导入本地图片，再插入文章；导出包会自动包含引用的素材。"
                action={() => act({ type: "asset.import" })}
                actionText="导入图片"
              />
            ) : (
              <div className="asset-grid">
                {state.assets.map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    canInsert={!!draft}
                    busy={busy}
                    onDelete={async () => {
                      if (
                        draft &&
                        (draft.markdown.includes(`asset://${a.id}`) ||
                          Object.values(draft.overrides).some((v) =>
                            v?.markdown.includes(`asset://${a.id}`),
                          ))
                      ) {
                        notify(
                          "当前稿件仍在使用这张图片，请先移除引用。",
                          true,
                        );
                        return;
                      }
                      if (
                        !window.confirm(
                          `从素材库删除「${a.name}」？原图会保留在本地回收目录。`,
                        )
                      )
                        return;
                      if (await act({ type: "asset.delete", id: a.id }))
                        notify("图片已删除");
                    }}
                    onInsert={() => {
                      if (!content) return;
                      setContent(
                        "markdown",
                        content.markdown +
                          `\n\n![${a.name.replace(/[\[\]]/g, "")}](asset://${a.id})\n`,
                      );
                      setView("articles");
                      notify("图片已插入当前稿件");
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {view === "vault" && <AccountVault />}
        {view === "settings" && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">WORKSPACE SETTINGS</div>
                <h1>设置与备份</h1>
                <p>
                  内容归你所有。导出和恢复工作区，保留完整的写作与分发记录。
                </p>
              </div>
            </section>
            <ImageSettings />
            <div className="settings-card">
              <h2>本地工作区</h2>
              <p>
                主稿、平台稿、任务记录与图片保存在以下目录。登录会话由 Electron
                独立管理。
              </p>
              <code>{dataPath}</code>
              <button onClick={() => act({ type: "data.open" })}>
                <FolderOpen size={16} />
                打开数据目录
              </button>
            </div>
            <div className="settings-card">
              <h2>备份与迁移</h2>
              <p>
                备份包含文章、图片、账号名称和任务；不导出 Cookie
                或登录凭据。恢复后队列暂停，需要重新检查账号。
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act({ type: "backup.export" })}
                >
                  <Download size={16} />
                  导出完整备份
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!canLeave()) return;
                    const next = await act({ type: "backup.import" });
                    if (next) {
                      setDraft(next.articles[0] ?? null);
                      setDirty(false);
                    }
                  }}
                >
                  <Upload size={16} />
                  从备份恢复
                </button>
              </div>
            </div>
            <div className="settings-card">
              <h2>发布流程</h2>
              <p>
                客户端自动填充编辑器并回读内容。封面、分类、图片转存和最终发布在平台页面检查；“已发布”状态由你提供文章链接后确认。
              </p>
              <p>
                本地预约不支持关机运行。客户端退出期间到期的任务，会在下次启动后执行；中断的任务不会自动重复填充。
              </p>
              <p>
                生图仅在你点击生成时调用选定服务。平台稿可独立编辑，公众号自动应用排版样式，自建
                Web 可导出 HTML 和 Markdown。
              </p>
            </div>
          </>
        )}
      </main>
      {notice && (
        <div role="status" className={"toast " + (notice.error ? "error" : "")}>
          <span>
            {notice.error ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </span>
          {notice.text}
          <button onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <button
              className="modal-close"
              aria-label="关闭对话框"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "account" && (
              <>
                <div className="eyebrow">NEW ACCOUNT</div>
                <h2>添加平台账号</h2>
                <p>为每个账号命名，方便区分公司、产品或个人身份。</p>
                <label>
                  平台
                  <select
                    aria-label="账号平台"
                    value={accountPlatform}
                    onChange={(e) =>
                      setAccountPlatform(e.target.value as PlatformId)
                    }
                  >
                    {platformIds
                      .filter((p) => p !== "web")
                      .map((p) => (
                        <option key={p} value={p}>
                          {platforms[p].name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  账号名称
                  <input
                    aria-label="账号名称"
                    autoFocus
                    placeholder="例如：链上说明书 · 官方号"
                    value={accountName}
                    maxLength={80}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>取消</button>
                  <button
                    className="primary"
                    disabled={busy || !accountName.trim()}
                    onClick={async () => {
                      if (
                        await act({
                          type: "account.add",
                          platform: accountPlatform,
                          name: accountName.trim(),
                        })
                      ) {
                        setModal(null);
                        notify("账号已添加，请打开平台窗口登录");
                      }
                    }}
                  >
                    添加账号
                  </button>
                </div>
              </>
            )}
            {modal === "publish" && (
              <>
                <div className="eyebrow">NEW DISTRIBUTION</div>
                <h2>创建分发任务</h2>
                <p>{draft?.title} · 各平台稿会固定为本次快照。</p>
                <div className="account-picker-toolbar">
                  <span>
                    已选 {selectedAccounts.length} / {state.accounts.length}{" "}
                    个账号
                  </span>
                  <button
                    className="text-button"
                    disabled={!state.accounts.length}
                    onClick={() =>
                      setSelectedAccounts(
                        state.accounts.every((a) =>
                          selectedAccounts.includes(a.id),
                        )
                          ? []
                          : state.accounts.map((a) => a.id),
                      )
                    }
                  >
                    {state.accounts.length > 0 &&
                    state.accounts.every((a) => selectedAccounts.includes(a.id))
                      ? "清空选择"
                      : "全选"}
                  </button>
                </div>
                <div className="account-picker">
                  {state.accounts.map((a) => (
                    <label key={a.id}>
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(a.id)}
                        onChange={(e) =>
                          setSelectedAccounts(
                            e.target.checked
                              ? [...selectedAccounts, a.id]
                              : selectedAccounts.filter((id) => id !== a.id),
                          )
                        }
                      />
                      <Badge platform={a.platform} />
                      <span>
                        {a.name}
                        <small>{platforms[a.platform].name}</small>
                      </span>
                    </label>
                  ))}
                  {!state.accounts.length && (
                    <p>
                      尚未添加账号。
                      <button
                        className="text-button"
                        onClick={() => {
                          setModal(null);
                          setView("accounts");
                        }}
                      >
                        前往添加
                      </button>
                    </p>
                  )}
                </div>
                <label>
                  预约填充时间（留空立即执行）
                  <input
                    type="datetime-local"
                    aria-label="预约时间"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                </label>
                <div className="inline-note">
                  客户端需保持运行。填充完成后，请到平台检查并发布。相同账号的相同稿件不会重复创建任务。
                </div>
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>取消</button>
                  <button
                    className="primary"
                    disabled={busy || !selectedAccounts.length}
                    onClick={enqueue}
                  >
                    创建 {selectedAccounts.length} 个任务
                  </button>
                </div>
              </>
            )}
            {modal === "confirm" && confirmJob && (
              <>
                <div className="eyebrow">CONFIRM PUBLICATION</div>
                <h2>登记已发布文章</h2>
                <p>
                  请先在{platforms[confirmJob.platform].name}
                  确认文章已经发布，再填写文章链接。本操作只更新本地记录。
                </p>
                <label>
                  文章链接
                  <input
                    aria-label="已发布文章链接"
                    autoFocus
                    placeholder="https://…"
                    value={resultUrl}
                    onChange={(e) => setResultUrl(e.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>取消</button>
                  <button
                    className="primary"
                    disabled={busy || !resultUrl.trim()}
                    onClick={async () => {
                      if (
                        await act({
                          type: "job.confirm",
                          id: confirmJob.id,
                          url: resultUrl.trim(),
                        })
                      )
                        setModal(null);
                    }}
                  >
                    确认登记
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
  actionText,
}: {
  icon: typeof FileText;
  title: string;
  text: string;
  action: () => unknown;
  actionText: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={action}>
        {actionText}
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
function AssetCard({
  asset,
  canInsert,
  onInsert,
  onDelete,
  busy,
}: {
  asset: Asset;
  onDelete: () => void;
  busy: boolean;
  canInsert: boolean;
  onInsert: () => void;
}) {
  const [src, setSrc] = useState("");
  const [expanded, setExpanded] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let ignore = false;
    const a = newArticle();
    a.markdown = `![](asset://${asset.id})`;
    window.studio
      .preview(a, "web")
      .then((p) => {
        if (!ignore) setSrc(p.images[0]?.src ?? "");
      })
      .catch(() => {
        if (!ignore) setSrc("");
      });
    return () => {
      ignore = true;
    };
  }, [asset.id]);
  return (
    <article className="asset-card">
      <button
        ref={previewButton}
        className="asset-image asset-preview-trigger"
        aria-label={`放大查看 ${asset.name}`}
        title="点击放大查看"
        disabled={!src}
        onClick={() => setExpanded(true)}
      >
        {src && <img src={src} alt={asset.name} />}
        <span className="asset-zoom-hint">点击放大</span>
      </button>
      {expanded && (
        <ImageLightbox
          src={src}
          name={asset.name}
          onClose={() => {
            setExpanded(false);
            requestAnimationFrame(() => previewButton.current?.focus());
          }}
        />
      )}
      <h3 title={asset.name}>{asset.name}</h3>
      <p>
        {(asset.size / 1024).toFixed(0)} KB ·{" "}
        {asset.mime.split("/")[1].toUpperCase()}
      </p>
      <div className="asset-actions">
        <button
          className="small"
          disabled={!canInsert || busy}
          onClick={onInsert}
        >
          <Plus size={14} />
          插入当前稿件
        </button>
        <button
          className="small asset-delete"
          aria-label={`删除图片 ${asset.name}`}
          title="删除图片"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={14} />
          删除
        </button>
      </div>
    </article>
  );
}
function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState(false);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="image-lightbox"
      aria-label="图片预览"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="image-lightbox-panel">
        <header>
          <span title={name}>{name}</span>
          <div>
            <button onClick={() => setOriginal((v) => !v)}>
              {original ? "适应窗口" : "原始尺寸"}
            </button>
            <button autoFocus aria-label="关闭图片预览" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div
          className={"image-lightbox-canvas" + (original ? " original" : "")}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <img src={src} alt={name} />
        </div>
        <footer>点击空白处或按 Esc 关闭</footer>
      </div>
    </dialog>
  );
}
const helperId = location.hash.match(/^#login-helper=([a-f0-9-]{36})$/)?.[1];
createRoot(document.getElementById("root")!).render(
  helperId ? <AccountVault helperId={helperId} /> : <App />,
);
