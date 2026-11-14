import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { readSavedItemJson, requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { enqueueSavedArticle } from "@/lib/services/saved-article-queue";
import { discardSavedBrowserPlaceholder, readSavedArticle, savedArticlePrivateHeaders } from "@/lib/services/saved-article-reader";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const discardRequest = z.strictObject({ extractedAt: z.iso.datetime() });

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
    return NextResponse.json({ job: { status: "queued", finishedAt: null, accessLimited: false } }, { status: 202, headers: savedArticlePrivateHeaders });
  } catch (error) { return privateError(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    const { extractedAt } = discardRequest.parse(await readSavedItemJson(request));
    await discardSavedBrowserPlaceholder(user.id, savedItemIdSchema.parse(id), new Date(extractedAt));
    return NextResponse.json(await readSavedArticle(user.id, id), { headers: savedArticlePrivateHeaders });
  } catch (error) { return privateError(error); }
}
