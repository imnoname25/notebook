import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { permanentlyDeleteTrashItem } from "@/lib/services/trash-service";
import { trashItemSchema } from "@/lib/validation";

type Context = { params: Promise<{ type: string; id: string }> };

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = trashItemSchema.parse(await params);
    await permanentlyDeleteTrashItem(user.id, input.type, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
