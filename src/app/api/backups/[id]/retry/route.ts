import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { retryBackupRemote, serializeBackup } from "@/lib/services/backup-service";
import { withDataOperation } from "@/lib/operation-lock";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); await requireUser(); const { id } = await params; const provider = request.nextUrl.searchParams.get("provider") === "s3" ? "s3" : "webdav"; return await withDataOperation(`${provider} retry`, async () => NextResponse.json({ backup: serializeBackup(await retryBackupRemote(id, provider)) })); } catch (error) { return apiError(error); } }
