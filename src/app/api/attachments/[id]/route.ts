import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { deleteUnusedAttachment } from "@/lib/services/attachment-service";
import { withDataOperation } from "@/lib/operation-lock";
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); return await withDataOperation("удаление вложения", async () => { await deleteUnusedAttachment(user.id, id); return NextResponse.json({ ok: true }); }); } catch (error) { return apiError(error); } }
