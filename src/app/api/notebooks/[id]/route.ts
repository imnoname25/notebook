import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { notebookUpdateSchema } from "@/lib/validation";
import { softDeleteNotebook } from "@/lib/services/trash-service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = notebookUpdateSchema.parse(await readJson(request));
    const updated = await db.notebook.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: input });
    if (!updated.count) throw new ApiError(404, "Блокнот не найден");
    return NextResponse.json({ notebook: await db.notebook.findUniqueOrThrow({ where: { id } }) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    await softDeleteNotebook(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
