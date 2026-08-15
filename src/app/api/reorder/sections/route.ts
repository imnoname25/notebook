import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { reorderSections } from "@/lib/services/reorder-service";
import { sectionReorderSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = sectionReorderSchema.parse(await readJson(request));
    await reorderSections(user.id, input.notebookId, input.parentId, input.ids);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
