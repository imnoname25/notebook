import { NextRequest, NextResponse } from "next/server";
import { apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { backupRecordFile, deleteBackup } from "@/lib/services/backup-service";
import { fileDownloadResponse } from "@/lib/download";
import { withDataOperation } from "@/lib/operation-lock";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) { try { await requireAdmin(); const { id } = await params; const { record, filePath } = await backupRecordFile(id); return fileDownloadResponse(filePath, record.filename!); } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); await requireAdmin(); const { id } = await params; return await withDataOperation("удаление backup", async () => { await deleteBackup(id); return NextResponse.json({ ok: true }); }); } catch (error) { return apiError(error); } }

