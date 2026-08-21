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
    const notebook = await db.notebook.findFirst({ where: { id, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!notebook) throw new ApiError(404, "Блокнот не найден");
    if (input.coverUploadId) {
      const upload = await db.upload.findFirst({ where: { id: input.coverUploadId, userId: user.id, pageId: null }, select: { id: true } });
      if (!upload) throw new ApiError(400, "Обложка должна принадлежать текущему пользователю");
    }
    const { coverUploadId, ...data } = input;
    const updated = await db.notebook.update({
      where: { id },
      data: {
        ...data,
        ...(coverUploadId === undefined ? {} : { coverUpload: coverUploadId ? { connect: { id: coverUploadId } } : { disconnect: true } }),
      },
    });
    return NextResponse.json({ notebook: updated });
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
