import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { duplicateQuickNote } from "@/lib/services/quick-note-service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json({ note: await duplicateQuickNote(user.id, id) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
