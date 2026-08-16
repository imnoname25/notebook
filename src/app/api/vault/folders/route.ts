import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { createVaultFolder, listVaultFolders } from "@/lib/services/vault-service";
import { vaultFolderCreateSchema } from "@/lib/vault/validation";

export async function GET() { try { const user = await requireUser(); return NextResponse.json({ folders: await listVaultFolders(user.id) }); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = vaultFolderCreateSchema.parse(await readJson(request)); return NextResponse.json({ folder: await createVaultFolder(user.id, input) }, { status: 201 }); } catch (error) { return apiError(error); } }
