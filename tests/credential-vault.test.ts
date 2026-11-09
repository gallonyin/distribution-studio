import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CredentialVault } from "../electron/credential-vault";
import { credentialSchema, vaultActionSchema } from "../src/vault-domain";
const id = "00000000-0000-4000-8000-000000000001";
const fake = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};
describe("encrypted account vault", () => {
  it("encrypts all fields, redacts list results, persists changes, and explicitly clears secrets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-unit-"));
    try {
      const vault = new CredentialVault(dir, fake);
      vault.save(
        credentialSchema.parse({
          accountId: id,
          username: "private-user",
          password: "test-secret-8765",
          notes: "private-notes",
        }),
      );
      const disk = fs.readFileSync(vault.file, "utf8");
      for (const value of ["test-secret-8765", "private-user", "private-notes"])
        expect(disk).not.toContain(value);
      expect(JSON.stringify(vault.view([id]))).not.toContain(
        "test-secret-8765",
      );
      expect(vault.view([id]).records[0].hasPassword).toBe(true);
      expect(vault.view([]).records).toEqual([]);
      const next = new CredentialVault(dir, fake);
      next.save(
        credentialSchema.parse({
          accountId: id,
          username: "changed",
          password: "",
        }),
      );
      expect(next.secret(id, "password")).toBe("test-secret-8765");
      expect(next.view([id]).records[0].updatedAt).toBeTruthy();
      next.save(credentialSchema.parse({ accountId: id, clearPassword: true }));
      expect(next.secret(id, "password")).toBe("");
      next.remove(id);
      expect(next.view([id]).records).toEqual([]);
      if (process.platform !== "win32")
        expect(fs.statSync(next.file).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("refuses unsafe storage without creating plaintext files and preserves damaged files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-unit-"));
    try {
      for (const secrets of [
        { ...fake, isEncryptionAvailable: () => false },
        { ...fake, getSelectedStorageBackend: () => "basic_text" },
      ]) {
        const vault = new CredentialVault(dir, secrets);
        expect(() =>
          vault.save(
            credentialSchema.parse({ accountId: id, password: "SECRET" }),
          ),
        ).toThrow("系统安全存储不可用");
        expect(fs.existsSync(vault.file)).toBe(false);
      }
      const vault = new CredentialVault(dir, fake);
      fs.writeFileSync(vault.file, "damaged");
      expect(() =>
        vault.save(credentialSchema.parse({ accountId: id })),
      ).toThrow("无法解密");
      expect(fs.readFileSync(vault.file, "utf8")).toBe("damaged");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("validates actions strictly, never accepts external targets or arbitrary fields", () => {
    expect(() =>
      vaultActionSchema.parse({ type: "copy", accountId: id, field: "notes" }),
    ).toThrow();
    expect(() =>
      vaultActionSchema.parse({ type: "list", url: "https://evil.example" }),
    ).toThrow();
    expect(() =>
      credentialSchema.parse({ accountId: id, password: "x".repeat(2001) }),
    ).toThrow();
  });
});
