import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { pageCreateSchema } from "@/lib/validation";

import { createPage } from "@/lib/services/page-service";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const sectionId = request.nextUrl.searchParams.get("sectionId");
    if (!sectionId) throw new ApiError(400, "Не указан sectionId");
    const section = await db.section.findFirst({ where: { id: sectionId, deletedAt: null, notebook: { userId: user.id, deletedAt: null } }, select: { id: true } });
    if (!section) throw new ApiError(404, "Раздел не найден");
    const pages = await db.page.findMany({ where: { sectionId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, sectionId: true, title: true, icon: true, color: true, coverUploadId: true, backgroundType: true, backgroundColor: true, backgroundGradient: true, backgroundPattern: true, backgroundUploadId: true, backgroundPosition: true, backgroundOverlay: true, appearancePreset: true, searchText: true, sortOrder: true, isFavorite: true, revision: true, createdAt: true, updatedAt: true, tags: { select: { tag: { select: { name: true, normalized: true } } } } } });
    return NextResponse.json({ pages: pages.map(({ searchText, tags, ...page }) => ({ ...page, previewText: searchText.slice(0, 240), tags: tags.map(({ tag }) => tag) })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = pageCreateSchema.parse(await readJson(request));
    const page = await createPage(user.id, input);
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return apiError(error); }
}
