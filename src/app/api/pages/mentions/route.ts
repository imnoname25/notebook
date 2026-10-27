import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getLinkTargets } from "@/lib/services/page-link-service";
export async function GET(request: NextRequest) {
  try { const user = await requireUser();return NextResponse.json({ pages: await getLinkTargets(user.id, undefined, (request.nextUrl.searchParams.get("q") ?? "").trim()) }); }
  catch (error) { return apiError(error); }
}
