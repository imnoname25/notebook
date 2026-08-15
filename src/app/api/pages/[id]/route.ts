import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { pageUpdateSchema } from "@/lib/validation";
import { savePage } from "@/lib/services/page-service";
import { softDeletePage } from "@/lib/services/trash-service";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

async function ownedPage(id: string, userId: string) {
  const page = await db.page.findFirst({ where: { id, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } });
  if (!page) throw new ApiError(404, "Страница не найдена");
  return page;
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json({ page: await ownedPage(id, user.id) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = pageUpdateSchema.parse(await readJson(request));
    return NextResponse.json({ page: await savePage(user.id, id, input) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    await softDeletePage(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
