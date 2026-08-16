import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { createVaultProfile, getVaultProfile } from "@/lib/services/vault-service";
import { vaultProfileCreateSchema } from "@/lib/vault/validation";

export async function GET() { try { const user = await requireUser(); return NextResponse.json({ profile: await getVaultProfile(user.id) }); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = vaultProfileCreateSchema.parse(await readJson(request)); return NextResponse.json({ profile: await createVaultProfile(user.id, input) }, { status: 201 }); } catch (error) { return apiError(error); } }
