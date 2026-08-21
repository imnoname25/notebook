import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { listRecentPages, recordRecentPage } from "@/lib/services/recent-page-service";
import { recentListSchema, recentPageSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const input = recentListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ recent: await listRecentPages(user.id, input.limit, input.notebookId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = recentPageSchema.parse(await readJson(request));
    return NextResponse.json({ recent: await recordRecentPage(user.id, input.pageId) });
  } catch (error) {
    return apiError(error);
  }
}
