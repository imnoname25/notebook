import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { prepareUpload, withUploadWrites } from "@/lib/services/upload-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    const pageId = form.get("pageId");
    const notebookId = form.get("notebookId");
    if (!(file instanceof File)) throw new ApiError(400, "Файл не передан");
    const prepared = await prepareUpload(file);
    const pageTarget = typeof pageId === "string" && pageId ? pageId : undefined;
    const notebookTarget = typeof notebookId === "string" && notebookId ? notebookId : undefined;
    if (Boolean(pageTarget) === Boolean(notebookTarget)) throw new ApiError(400, "Укажите ровно один объект вложения");
    const upload = await withUploadWrites(user.id, async (tx, store) => {
      if (pageTarget && !await tx.page.findFirst({ where: { id: pageTarget, deletedAt: null, section: { deletedAt: null, notebook: { userId: user.id, deletedAt: null } } }, select: { id: true } })) {
        throw new ApiError(404, "Страница не найдена");
      }
      if (notebookTarget && !await tx.notebook.findFirst({ where: { id: notebookTarget, userId: user.id, deletedAt: null }, select: { id: true } })) {
        throw new ApiError(404, "Блокнот не найден");
      }
      return store(prepared, pageTarget);
    });
    return NextResponse.json({ id: upload.id, url: `/api/uploads/${upload.id}` }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
