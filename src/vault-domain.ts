import { z } from "zod";
export const credentialSchema = z
  .object({
    accountId: z.string().uuid(),
    username: z.string().max(300).default(""),
    password: z.string().max(2000).optional(),
    clearPassword: z.boolean().optional(),
    contact: z.string().max(300).default(""),
    loginMethod: z.enum(["密码", "扫码", "验证码", "其他"]).default("密码"),
    notes: z.string().max(4000).default(""),
  })
  .strict();
export type CredentialInput = z.infer<typeof credentialSchema>;
export type CredentialView = Omit<
  CredentialInput,
  "password" | "clearPassword"
> & { hasPassword: boolean; updatedAt: string };
export type VaultView = { available: boolean; records: CredentialView[] };
export type VaultAction =
  | { type: "list" }
  | { type: "save"; record: CredentialInput }
  | { type: "reveal"; accountId: string }
  | { type: "copy"; accountId: string; field: "username" | "password" };
export type VaultResult = VaultView | { password: string } | { copied: true };
export const vaultActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("save"), record: credentialSchema }).strict(),
  z
    .object({ type: z.literal("reveal"), accountId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("copy"),
      accountId: z.string().uuid(),
      field: z.enum(["username", "password"]),
    })
    .strict(),
]);
