import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try { const user = await requireUser(); const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100); const pages = await db.page.findMany({ where: { deletedAt: null, ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}), section: { deletedAt: null, notebook: { userId: user.id, deletedAt: null } } }, orderBy: [{ updatedAt: "desc" }], take: 15, select: { id: true, title: true, section: { select: { id: true, title: true, notebook: { select: { id: true, title: true } } } } } }); return NextResponse.json({ pages: pages.map((page) => ({ id: page.id, title: page.title, sectionId: page.section.id, sectionTitle: page.section.title, notebookId: page.section.notebook.id, notebookTitle: page.section.notebook.title })) }); }
  catch (error) { return apiError(error); }
}
