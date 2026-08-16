import { z } from "zod";

const encoded = z.string().min(16).max(1_500_000).regex(/^[A-Za-z0-9+/_=-]+$/, "Ожидались закодированные двоичные данные");
const id = z.string().min(1).max(128);

export const vaultProfileCreateSchema = z.object({
  kdfAlgorithm: z.literal("argon2id"),
  kdfSalt: encoded.max(256),
  kdfMemoryKiB: z.number().int().min(32_768).max(1_048_576),
  kdfIterations: z.number().int().min(2).max(20),
  kdfParallelism: z.number().int().min(1).max(16),
  verifier: encoded.max(512),
  encryptedKeyset: encoded,
  encryptionVersion: z.literal(1),
}).strict();

export const vaultFolderCreateSchema = z.object({ parentId: id.nullable().optional(), encryptedPayload: encoded, encryptionVersion: z.literal(1), sortOrder: z.number().int().min(0).max(1_000_000).optional() }).strict();
export const vaultFolderUpdateSchema = vaultFolderCreateSchema.partial().strict();
export const vaultItemCreateSchema = z.object({ folderId: id.nullable().optional(), itemType: z.enum(["login", "secure_note"]), encryptedPayload: encoded, encryptionVersion: z.literal(1), sortOrder: z.number().int().min(0).max(1_000_000).optional() }).strict();
export const vaultItemUpdateSchema = vaultItemCreateSchema.partial().strict();

export type VaultProfileCreate = z.infer<typeof vaultProfileCreateSchema>;
export type VaultFolderCreate = z.infer<typeof vaultFolderCreateSchema>;
export type VaultItemCreate = z.infer<typeof vaultItemCreateSchema>;
