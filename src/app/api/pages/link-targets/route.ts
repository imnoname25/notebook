import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { getLinkTargets } from "@/lib/services/page-link-service";
const idsSchema = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)).min(1).max(200);
export async function GET(request: NextRequest) {
  try { const user = await requireUser();const ids = idsSchema.parse((request.nextUrl.searchParams.get("ids") ?? "").split(","));return NextResponse.json({ pages: await getLinkTargets(user.id, ids) }); }
  catch (error) { return apiError(error); }
}
