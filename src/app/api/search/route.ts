import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { searchNotebook } from "@/lib/services/search-service";
import { searchRequestSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const input = searchRequestSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (input.q.trim().length < 2) return NextResponse.json({ results: [], nextOffset: null });
    return NextResponse.json(await searchNotebook(user.id, input.q, 25, input.offset));
  } catch (error) { return apiError(error); }
}
