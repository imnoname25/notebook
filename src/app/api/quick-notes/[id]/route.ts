import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { deleteQuickNote, getQuickNote, updateQuickNote } from "@/lib/services/quick-note-service";
import { quickNoteUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json({ note: await getQuickNote(user.id, id) });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json({ note: await updateQuickNote(user.id, id, quickNoteUpdateSchema.parse(await readJson(request))) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    await deleteQuickNote(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
