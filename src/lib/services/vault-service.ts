import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import type { VaultFolderCreate, VaultItemCreate, VaultProfileCreate } from "@/lib/vault/validation";

export async function getVaultProfile(userId: string) {
  return db.vaultProfile.findUnique({ where: { userId }, omit: { userId: true } });
}

export async function createVaultProfile(userId: string, input: VaultProfileCreate) {
  if (await db.vaultProfile.findUnique({ where: { userId }, select: { id: true } })) throw new ApiError(409, "Хранилище уже настроено");
  return db.vaultProfile.create({ data: { userId, ...input }, omit: { userId: true } });
}

async function profileId(userId: string) {
  const profile = await db.vaultProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new ApiError(404, "Хранилище не настроено");
  return profile.id;
}

async function validateFolder(profile: string, folderId: string | null | undefined) {
  if (!folderId) return;
  const folder = await db.vaultFolder.findFirst({ where: { id: folderId, vaultProfileId: profile }, select: { id: true } });
  if (!folder) throw new ApiError(400, "Папка хранилища недоступна");
}

async function validateFolderParent(profile: string, folderId: string, parentId: string | null | undefined) {
  let cursor = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === folderId || visited.has(cursor)) throw new ApiError(400, "Папку нельзя переместить внутрь своего дерева");
    visited.add(cursor);
    const parent = await db.vaultFolder.findFirst({ where: { id: cursor, vaultProfileId: profile }, select: { parentId: true } });
    if (!parent) throw new ApiError(400, "Папка хранилища недоступна");
    cursor = parent.parentId;
  }
}

export async function listVaultItems(userId: string) { const id = await profileId(userId); return db.vaultItem.findMany({ where: { vaultProfileId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], omit: { vaultProfileId: true } }); }
export async function createVaultItem(userId: string, input: VaultItemCreate) { const id = await profileId(userId); await validateFolder(id, input.folderId); return db.vaultItem.create({ data: { vaultProfileId: id, ...input }, omit: { vaultProfileId: true } }); }
export async function updateVaultItem(userId: string, itemId: string, input: Partial<VaultItemCreate>) { const id = await profileId(userId); const item = await db.vaultItem.findFirst({ where: { id: itemId, vaultProfileId: id }, select: { id: true } }); if (!item) throw new ApiError(404, "Элемент хранилища не найден"); await validateFolder(id, input.folderId); return db.vaultItem.update({ where: { id: item.id }, data: input, omit: { vaultProfileId: true } }); }
export async function deleteVaultItem(userId: string, itemId: string) { const id = await profileId(userId); const result = await db.vaultItem.deleteMany({ where: { id: itemId, vaultProfileId: id } }); if (result.count !== 1) throw new ApiError(404, "Элемент хранилища не найден"); }

export async function listVaultFolders(userId: string) { const id = await profileId(userId); return db.vaultFolder.findMany({ where: { vaultProfileId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], omit: { vaultProfileId: true } }); }
export async function createVaultFolder(userId: string, input: VaultFolderCreate) { const id = await profileId(userId); await validateFolder(id, input.parentId); return db.vaultFolder.create({ data: { vaultProfileId: id, ...input }, omit: { vaultProfileId: true } }); }
export async function updateVaultFolder(userId: string, folderId: string, input: Partial<VaultFolderCreate>) { const id = await profileId(userId); const folder = await db.vaultFolder.findFirst({ where: { id: folderId, vaultProfileId: id }, select: { id: true } }); if (!folder) throw new ApiError(404, "Папка хранилища не найдена"); await validateFolderParent(id, folder.id, input.parentId); return db.vaultFolder.update({ where: { id: folder.id }, data: input, omit: { vaultProfileId: true } }); }
export async function deleteVaultFolder(userId: string, folderId: string) { const id = await profileId(userId); const result = await db.vaultFolder.deleteMany({ where: { id: folderId, vaultProfileId: id } }); if (result.count !== 1) throw new ApiError(404, "Папка хранилища не найдена"); }
