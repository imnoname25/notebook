import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { sectionCreateSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = sectionCreateSchema.parse(await readJson(request));
    const notebook = await db.notebook.findFirst({ where: { id: input.notebookId, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!notebook) throw new ApiError(404, "Блокнот не найден");
    if (input.parentId) {
      const parent = await db.section.findFirst({ where: { id: input.parentId, notebookId: input.notebookId, deletedAt: null }, select: { id: true } });
      if (!parent) throw new ApiError(400, "Родительский раздел не принадлежит блокноту");
    }
    const last = await db.section.aggregate({ where: { notebookId: input.notebookId, parentId: input.parentId ?? null, deletedAt: null }, _max: { sortOrder: true } });
    const section = await db.section.create({ data: { ...input, parentId: input.parentId ?? null, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) { return apiError(error); }
}
