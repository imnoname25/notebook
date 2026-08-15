import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { reorderPages } from "@/lib/services/reorder-service";
import { pageReorderSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = pageReorderSchema.parse(await readJson(request));
    await reorderPages(user.id, input.sectionId, input.ids);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
