import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { convertQuickNote } from "@/lib/services/quick-note-service";
import { quickNoteConvertSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = quickNoteConvertSchema.parse(await readJson(request));
    return NextResponse.json({ page: await convertQuickNote(user.id, id, input.sectionId) });
  } catch (error) { return apiError(error); }
}
