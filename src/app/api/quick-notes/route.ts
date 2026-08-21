import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { createQuickNote, listQuickNotes } from "@/lib/services/quick-note-service";
import { quickNoteCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    return NextResponse.json({ notes: await listQuickNotes(user.id, request.nextUrl.searchParams.get("archived") === "1") });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const note = await createQuickNote(user.id, quickNoteCreateSchema.parse(await readJson(request)));
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) { return apiError(error); }
}
