import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { sectionUpdateSchema } from "@/lib/validation";
import { softDeleteSection } from "@/lib/services/trash-service";

type Context = { params: Promise<{ id: string }> };

async function ownedSection(id: string, userId: string) {
  const section = await db.section.findFirst({ where: { id, deletedAt: null, notebook: { userId, deletedAt: null } } });
  if (!section) throw new ApiError(404, "Раздел не найден");
  return section;
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const section = await ownedSection(id, user.id);
    const input = sectionUpdateSchema.parse(await readJson(request));
    if (input.parentId !== undefined && input.parentId !== null) {
      let cursor: string | null = input.parentId;
      for (let depth = 0; cursor && depth < 100; depth += 1) {
        if (cursor === id) throw new ApiError(400, "Раздел нельзя переместить внутрь себя");
        const candidate: { parentId: string | null; notebookId: string; deletedAt: Date | null } | null = await db.section.findUnique({ where: { id: cursor }, select: { parentId: true, notebookId: true, deletedAt: true } });
        if (!candidate || candidate.deletedAt || candidate.notebookId !== section.notebookId) throw new ApiError(400, "Некорректный родительский раздел");
        cursor = candidate.parentId;
      }
    }
    return NextResponse.json({ section: await db.section.update({ where: { id }, data: input }) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    await softDeleteSection(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
