import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { notebookCreateSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireUser();
    const notebooks = await db.notebook.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { sections: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return NextResponse.json({ notebooks });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = notebookCreateSchema.parse(await readJson(request));
    const last = await db.notebook.aggregate({ where: { userId: user.id, deletedAt: null }, _max: { sortOrder: true } });
    const notebook = await db.notebook.create({ data: { ...input, userId: user.id, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    return NextResponse.json({ notebook: { ...notebook, sections: [] } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
