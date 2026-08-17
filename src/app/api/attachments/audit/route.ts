import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { auditStorage, cleanupStorage } from "@/lib/services/attachment-service";
import { withDataOperation } from "@/lib/operation-lock";

export async function GET() { try { const user = await requireUser(); return NextResponse.json({ audit: await auditStorage(user.id) }); } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); return await withDataOperation("очистка вложений", async () => NextResponse.json(await cleanupStorage(user.id))); } catch (error) { return apiError(error); } }
