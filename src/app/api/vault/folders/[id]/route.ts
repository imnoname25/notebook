import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { deleteVaultFolder, updateVaultFolder } from "@/lib/services/vault-service";
import { vaultFolderUpdateSchema } from "@/lib/vault/validation";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); const input = vaultFolderUpdateSchema.parse(await readJson(request)); return NextResponse.json({ folder: await updateVaultFolder(user.id, id, input) }); } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); await deleteVaultFolder(user.id, id); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
