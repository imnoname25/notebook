import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { reorderNotebooks } from "@/lib/services/reorder-service";
import { notebookReorderSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = notebookReorderSchema.parse(await readJson(request));
    await reorderNotebooks(user.id, input.ids);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
