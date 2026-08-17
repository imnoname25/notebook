import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { restoreRecordedBackup } from "@/lib/services/backup-restore-service";
import { withDataOperation } from "@/lib/operation-lock";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const user = await requireAdmin(); if (request.headers.get("x-notebook-confirmation") !== "RESTORE") throw new ApiError(400, "Введите RESTORE для подтверждения"); const { id } = await params; return await withDataOperation("restore local backup", async () => NextResponse.json(await restoreRecordedBackup(user.id, id))); } catch (error) { return apiError(error); } }
