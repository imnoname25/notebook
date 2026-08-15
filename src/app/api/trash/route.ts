import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { emptyTrash, getTrash } from "@/lib/services/trash-service";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ items: await getTrash(user.id) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    await emptyTrash(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
