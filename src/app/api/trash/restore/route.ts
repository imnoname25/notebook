import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { restoreTrashItem } from "@/lib/services/trash-service";
import { trashItemSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = trashItemSchema.parse(await readJson(request));
    await restoreTrashItem(user.id, input.type, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
