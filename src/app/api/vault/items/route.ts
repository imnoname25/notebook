import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { createVaultItem, listVaultItems } from "@/lib/services/vault-service";
import { vaultItemCreateSchema } from "@/lib/vault/validation";

export async function GET() { try { const user = await requireUser(); return NextResponse.json({ items: await listVaultItems(user.id) }); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = vaultItemCreateSchema.parse(await readJson(request)); return NextResponse.json({ item: await createVaultItem(user.id, input) }, { status: 201 }); } catch (error) { return apiError(error); } }
