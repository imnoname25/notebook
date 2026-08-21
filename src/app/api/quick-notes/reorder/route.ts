import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { reorderQuickNotes } from "@/lib/services/quick-note-service";
import { quickNoteReorderSchema } from "@/lib/validation";

export async function PUT(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const { ids } = quickNoteReorderSchema.parse(await readJson(request));
    await reorderQuickNotes(user.id, ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
