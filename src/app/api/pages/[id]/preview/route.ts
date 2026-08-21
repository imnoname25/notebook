import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const page = await db.page.findFirst({
      where: { id, deletedAt: null, section: { deletedAt: null, notebook: { userId: user.id, deletedAt: null } } },
      select: { id: true, title: true, icon: true, searchText: true, section: { select: { title: true, notebook: { select: { title: true } } } } },
    });
    if (!page) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
    return NextResponse.json({ preview: { id: page.id, title: page.title, icon: page.icon, excerpt: page.searchText.slice(0, 180), sectionTitle: page.section.title, notebookTitle: page.section.notebook.title } });
  } catch (error) { return apiError(error); }
}
