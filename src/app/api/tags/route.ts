import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getTagView, listTags } from "@/lib/services/tag-service";
import { tagListSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { limit, tag } = tagListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (tag) return NextResponse.json({ tag: await getTagView(user.id, tag.toLocaleLowerCase("ru-RU")) });
    return NextResponse.json({ tags: await listTags(user.id, limit) });
  } catch (error) { return apiError(error); }
}
