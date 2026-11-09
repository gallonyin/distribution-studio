import React, { useEffect, useRef, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  Plus,
  Search,
  ShieldCheck,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { platforms, platformIds, type PlatformId } from "./domain";
import type {
  CredentialView,
  CredentialInput,
  VaultView,
} from "./vault-domain";
type Account = { id: string; name: string; platform: PlatformId };
type Listing = VaultView & { accounts: Account[] };
export function AccountVault({ helperId }: { helperId?: string }) {
  const [data, setData] = useState<Listing>({
    available: true,
    records: [],
    accounts: [],
  });
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CredentialInput | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlatform, setNewPlatform] = useState<PlatformId>("wechat");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const revealEpoch = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const refresh = async () => {
    try {
      setData((await window.studio.vault({ type: "list" })) as Listing);
    } catch {
      setMessage("无法读取账号资料，请检查系统钥匙串是否已解锁。");
    }
  };
  useEffect(() => {
    void refresh();
    const hide = () => {
      revealEpoch.current++;
      setSecrets({});
    };
    const focus = () => void refresh();
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("blur", hide);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      revealEpoch.current++;
      timers.current.forEach(clearTimeout);
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const copy = async (accountId: string, field: "username" | "password") => {
    try {
      await window.studio.vault({ type: "copy", accountId, field });
      setMessage(
        `${field === "password" ? "密码" : "账号"}已复制，30 秒后自动清理剪贴板。`,
      );
    } catch {
      setMessage("复制失败，请先填写并保存这项资料。");
    }
  };
  const reveal = async (id: string) => {
    if (secrets[id] !== undefined) {
      setSecrets((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      return;
    }
    try {
      const epoch = revealEpoch.current;
      const result = (await window.studio.vault({
        type: "reveal",
        accountId: id,
      })) as { password: string };
      if (epoch !== revealEpoch.current) return;
      setSecrets((s) => ({ ...s, [id]: result.password }));
      timers.current.push(
        setTimeout(
          () =>
            setSecrets((s) => {
              const n = { ...s };
              delete n[id];
              return n;
            }),
          15000,
        ),
      );
    } catch {
      setMessage("密码无法解密，请检查系统安全存储。");
    }
  };
  const edit = (id: string) => {
    const r = data.records.find((r) => r.accountId === id);
    setEditing({
      accountId: id,
      username: r?.username || "",
      contact: r?.contact || "",
      loginMethod: r?.loginMethod || "密码",
      notes: r?.notes || "",
      password: "",
    });
    setSecrets({});
    setMessage("");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await window.studio.vault({ type: "save", record: editing });
      setEditing(null);
      await refresh();
      setMessage("账号资料已加密保存。");
    } catch {
      setMessage("保存失败，资料未更新。请检查系统钥匙串与输入长度。");
    } finally {
      setBusy(false);
    }
  };
  const accounts = data.accounts.filter(
    (a) =>
      (!helperId || a.id === helperId) &&
      [
        a.name,
        platforms[a.platform].name,
        ...Object.values(data.records.find((r) => r.accountId === a.id) || {}),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const passwordCell = (a: Account, r?: CredentialView) => (
    <div className="vault-password">
      <code className={r?.hasPassword ? "vault-secret" : undefined}>
        {r?.hasPassword ? (secrets[a.id] ?? "••••••••") : "未填写"}
      </code>
      {r?.hasPassword && (
        <>
          <button
            type="button"
            aria-label={`${secrets[a.id] !== undefined ? "隐藏" : "显示"}${a.name}密码`}
            onClick={() => void reveal(a.id)}
          >
            {secrets[a.id] !== undefined ? (
              <EyeOff size={16} />
            ) : (
              <Eye size={16} />
            )}
          </button>
          <button
            type="button"
            aria-label={`复制${a.name}密码`}
            onClick={() => void copy(a.id, "password")}
          >
            <Copy size={16} />
          </button>
        </>
      )}
    </div>
  );
  return (
    <section className={helperId ? "vault-helper" : "vault-page"}>
      <header className="page-heading">
        <div>
          <div className="eyebrow">
            <ShieldCheck size={15} />{" "}
            {helperId ? "LOGIN ASSISTANT" : "ACCOUNT VAULT"}
          </div>
          <h1>{helperId ? "登录快捷卡片" : "账号资料表"}</h1>
          <p>
            {helperId
              ? "仅在本机显示，平台网页无法读取此卡片。"
              : "统一记录平台账号与登录资料，打开平台时随手复制。"}
          </p>
        </div>
        {!helperId && (
          <button
            onClick={() => {
              setCreating(!creating);
              setEditing(null);
            }}
          >
            <Plus size={16} />
            新增账号
          </button>
        )}
      </header>
      <div className="vault-notice">
        {data.available
          ? "系统安全存储加密 · 仅存本机 · 不随普通备份导出"
          : "系统安全存储不可用，暂不能保存资料"}
        。密码显示 15 秒后隐藏，窗口失焦立即隐藏。
      </div>
      {message && (
        <div role="status" className="vault-feedback">
          {message}
        </div>
      )}
      {creating && !helperId && (
        <form
          className="vault-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const s = await window.studio.command({
                type: "account.add",
                platform: newPlatform,
                name: newName,
              });
              const a = s.accounts[s.accounts.length - 1];
              await refresh();
              setCreating(false);
              setNewName("");
              edit(a.id);
            } catch {
              setMessage("账号创建失败，请检查名称。");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            平台
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as PlatformId)}
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
              required
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：链上说明书主号"
            />
          </label>
          <button disabled={busy} className="primary">
            创建并填写资料
          </button>
        </form>
      )}
      {editing && !helperId && (
        <form className="vault-form" onSubmit={save}>
          <h3>
            编辑 · {data.accounts.find((a) => a.id === editing.accountId)?.name}
          </h3>
          <label>
            登录账号
            <input
              autoComplete="off"
              maxLength={300}
              value={editing.username}
              onChange={(e) =>
                setEditing({ ...editing, username: e.target.value })
              }
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="new-password"
              maxLength={2000}
              value={editing.password || ""}
              placeholder="留空保留原密码"
              onChange={(e) =>
                setEditing({
                  ...editing,
                  password: e.target.value,
                  clearPassword: false,
                })
              }
            />
          </label>
          <label>
            登录方式
            <select
              value={editing.loginMethod}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  loginMethod: e.target.value as CredentialInput["loginMethod"],
                })
              }
            >
              {["密码", "扫码", "验证码", "其他"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            绑定邮箱／手机号
            <input
              maxLength={300}
              value={editing.contact}
              onChange={(e) =>
                setEditing({ ...editing, contact: e.target.value })
              }
            />
          </label>
          <label className="vault-wide">
            备注
            <textarea
              maxLength={4000}
              rows={3}
              value={editing.notes}
              onChange={(e) =>
                setEditing({ ...editing, notes: e.target.value })
              }
            />
          </label>
          <label className="vault-checkbox">
            <input
              type="checkbox"
              checked={!!editing.clearPassword}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  clearPassword: e.target.checked,
                  password: "",
                })
              }
            />
            清空已保存密码
          </label>
          <div className="button-row">
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="primary" disabled={busy || !data.available}>
              加密保存
            </button>
          </div>
        </form>
      )}
      {!helperId && (
        <div className="vault-search">
          <Search size={17} />
          <input
            aria-label="搜索账号资料"
            placeholder="搜索平台、名称、账号或备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {helperId ? (
        accounts.map((a) => {
          const r = data.records.find((r) => r.accountId === a.id);
          return (
            <article className="vault-login-card" key={a.id}>
              <h2>{platforms[a.platform].name}</h2>
              <p>{a.name}</p>
              <label>登录账号</label>
              <div className="vault-password">
                <span>{r?.username || "未填写"}</span>
                {r?.username && (
                  <button
                    aria-label="复制登录账号"
                    onClick={() => void copy(a.id, "username")}
                  >
                    <Copy size={16} />
                  </button>
                )}
              </div>
              <label>密码</label>
              {passwordCell(a, r)}
              <label>登录方式</label>
              <p>{r?.loginMethod || "未填写"}</p>
              {r?.notes && (
                <>
                  <label>备注</label>
                  <p>{r.notes}</p>
                </>
              )}
              <small>
                修改资料请到主窗口「账号资料表」。未自动填写或提交平台登录表单。
              </small>
            </article>
          );
        })
      ) : (
        <div className="vault-table-wrap">
          <table className="vault-table">
            <colgroup>
              {[90, 110, 155, 155, 80, 150, 170, 130, 160].map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {[
                  "平台",
                  "账号名称",
                  "登录账号",
                  "密码",
                  "登录方式",
                  "绑定邮箱／手机号",
                  "备注",
                  "更新时间",
                  "操作",
                ].map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const r = data.records.find((r) => r.accountId === a.id);
                return (
                  <tr key={a.id}>
                    <td>{platforms[a.platform].name}</td>
                    <td>
                      <strong>{a.name}</strong>
                    </td>
                    <td>
                      <div className="vault-password">
                        <span>{r?.username || "未填写"}</span>
                        {r?.username && (
                          <button
                            aria-label={`复制${a.name}账号`}
                            onClick={() => void copy(a.id, "username")}
                          >
                            <Copy size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td>{passwordCell(a, r)}</td>
                    <td>{r?.loginMethod || "—"}</td>
                    <td>{r?.contact || "—"}</td>
                    <td className="vault-notes">
                      <span className="vault-cell-text" title={r?.notes}>
                        {r?.notes || "—"}
                      </span>
                    </td>
                    <td>
                      {r?.updatedAt
                        ? new Date(r.updatedAt).toLocaleString()
                        : "尚未记录"}
                    </td>
                    <td>
                      <div className="button-row">
                        <button onClick={() => edit(a.id)}>
                          <Pencil size={15} />
                          编辑
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await window.studio.command({
                                type: "account.open",
                                id: a.id,
                              });
                            } catch {
                              setMessage("平台打开失败，请检查网络。");
                            }
                          }}
                        >
                          <ExternalLink size={15} />
                          登录
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!accounts.length && (
            <p className="vault-empty">
              {query
                ? "没有匹配的账号。"
                : "新增账号开始记录，已连接的平台账号会自动出现在这里。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
