import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  credentialSchema,
  type CredentialInput,
  type VaultView,
} from "../src/vault-domain";
import type { SecretStorage } from "./image-config";
const diskSchema = z
  .array(
    credentialSchema.extend({
      password: z.string().max(10000).optional(),
      updatedAt: z.string().datetime(),
    }),
  )
  .max(200);
export class CredentialVault {
  readonly file: string;
  constructor(
    directory: string,
    private secrets: SecretStorage & {
      getSelectedStorageBackend?: () => string;
    },
  ) {
    this.file = path.join(directory, "account-vault.encrypted.json");
  }
  available() {
    return (
      this.secrets.isEncryptionAvailable() &&
      this.secrets.getSelectedStorageBackend?.() !== "basic_text"
    );
  }
  private read() {
    if (!fs.existsSync(this.file)) return [];
    if (!this.available())
      throw Error("系统安全存储不可用，请解锁系统钥匙串后重试。");
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        raw.format !== "studio-account-vault-v1" ||
        typeof raw.payload !== "string"
      )
        throw Error();
      return diskSchema.parse(
        JSON.parse(
          this.secrets.decryptString(Buffer.from(raw.payload, "base64")),
        ),
      );
    } catch {
      throw Error("账号资料无法解密或格式损坏，请检查本机钥匙串与原文件。");
    }
  }
  private write(records: z.infer<typeof diskSchema>) {
    if (!this.available()) throw Error("系统安全存储不可用，未保存账号资料。");
    const payload = this.secrets
      .encryptString(JSON.stringify(diskSchema.parse(records)))
      .toString("base64");
    fs.writeFileSync(
      this.file + ".tmp",
      JSON.stringify({ format: "studio-account-vault-v1", payload }),
      { mode: 0o600 },
    );
    fs.renameSync(this.file + ".tmp", this.file);
    fs.chmodSync(this.file, 0o600);
  }
  view(ids: string[]): VaultView {
    return {
      available: this.available(),
      records: this.read()
        .filter((r) => ids.includes(r.accountId))
        .map(({ password, clearPassword, ...r }) => ({
          ...r,
          hasPassword: !!password,
        })),
    };
  }
  save(input: CredentialInput) {
    if (!this.available()) throw Error("系统安全存储不可用，未保存账号资料。");
    const r = credentialSchema.parse(input),
      records = this.read();
    const old = records.find((x) => x.accountId === r.accountId);
    const { clearPassword, ...fields } = r;
    const next = {
      ...fields,
      // Keep passwords separately encrypted even while metadata is being read.
      password: clearPassword
        ? ""
        : r.password
          ? this.secrets.encryptString(r.password).toString("base64")
          : old?.password || "",
      updatedAt: new Date().toISOString(),
    };
    this.write([...records.filter((x) => x.accountId !== r.accountId), next]);
  }
  secret(id: string, field: "username" | "password") {
    const value = this.read().find((r) => r.accountId === id)?.[field] || "";
    if (field !== "password" || !value) return value;
    try {
      return this.secrets.decryptString(Buffer.from(value, "base64"));
    } catch {
      throw Error("密码无法解密，请检查系统安全存储。");
    }
  }
  remove(id: string) {
    if (fs.existsSync(this.file))
      this.write(this.read().filter((r) => r.accountId !== id));
  }
}
