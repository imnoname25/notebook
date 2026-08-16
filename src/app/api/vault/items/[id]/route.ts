import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { deleteVaultItem, updateVaultItem } from "@/lib/services/vault-service";
import { vaultItemUpdateSchema } from "@/lib/vault/validation";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); const input = vaultItemUpdateSchema.parse(await readJson(request)); return NextResponse.json({ item: await updateVaultItem(user.id, id, input) }); } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); await deleteVaultItem(user.id, id); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
