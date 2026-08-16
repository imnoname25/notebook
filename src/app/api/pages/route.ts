import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { pageCreateSchema } from "@/lib/validation";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { validateTemplateContent } from "@/lib/page-templates";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const sectionId = request.nextUrl.searchParams.get("sectionId");
    if (!sectionId) throw new ApiError(400, "Не указан sectionId");
    const section = await db.section.findFirst({ where: { id: sectionId, deletedAt: null, notebook: { userId: user.id, deletedAt: null } }, select: { id: true } });
    if (!section) throw new ApiError(404, "Раздел не найден");
    const pages = await db.page.findMany({ where: { sectionId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, sectionId: true, title: true, icon: true, color: true, coverUploadId: true, sortOrder: true, isFavorite: true, revision: true, createdAt: true, updatedAt: true } });
    return NextResponse.json({ pages });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = pageCreateSchema.parse(await readJson(request));
    const section = await db.section.findFirst({ where: { id: input.sectionId, deletedAt: null, notebook: { userId: user.id, deletedAt: null } }, select: { id: true } });
    if (!section) throw new ApiError(404, "Раздел не найден");
    const template = input.templateId ? await db.pageTemplate.findFirst({ where: { id: input.templateId, userId: user.id }, select: { name: true, content: true } }) : null;
    if (input.templateId && !template) throw new ApiError(404, "Шаблон не найден");
    const content = template ? validateTemplateContent(template.content) : [{ type: "paragraph", content: [] }];
    const last = await db.page.aggregate({ where: { sectionId: input.sectionId, deletedAt: null }, _max: { sortOrder: true } });
    const page = await db.page.create({ data: { sectionId: input.sectionId, title: input.title ?? template?.name ?? "Без названия", sortOrder: (last._max.sortOrder ?? -1) + 1, content: content as Prisma.InputJsonValue, searchText: extractBlockNoteText(content) } });
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return apiError(error); }
}
