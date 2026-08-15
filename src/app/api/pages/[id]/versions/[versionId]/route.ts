import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { deletePageVersion, getPageVersion } from "@/lib/services/page-version-service";

type Context = { params: Promise<{ id: string; versionId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try { const [user, { id, versionId }] = await Promise.all([requireUser(), params]); return NextResponse.json({ version: await getPageVersion(user.id, id, versionId) }); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: NextRequest, { params }: Context) {
  try { validateRequestOrigin(request); const [user, { id, versionId }] = await Promise.all([requireUser(), params]); await deletePageVersion(user.id, id, versionId); return NextResponse.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
