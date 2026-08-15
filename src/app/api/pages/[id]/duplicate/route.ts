import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { duplicatePage } from "@/lib/services/move-service";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json({ page: await duplicatePage(user.id, id) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
