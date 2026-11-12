import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { enqueueSavedArticle } from "@/lib/services/saved-article-queue";
import { readSavedArticle, savedArticlePrivateHeaders } from "@/lib/services/saved-article-reader";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function privateError(error: unknown) {
  const response = apiError(error);
  for (const [name, value] of Object.entries(savedArticlePrivateHeaders)) response.headers.set(name, value);
  if (response.status === 429) response.headers.set("retry-after", "60");
  return response;
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json(await readSavedArticle(user.id, savedItemIdSchema.parse(id)), { headers: savedArticlePrivateHeaders });
  } catch (error) { return privateError(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    await enqueueSavedArticle(user.id, savedItemIdSchema.parse(id), { manual: true });
    return NextResponse.json({ job: { status: "queued", finishedAt: null } }, { status: 202, headers: savedArticlePrivateHeaders });
  } catch (error) { return privateError(error); }
}
