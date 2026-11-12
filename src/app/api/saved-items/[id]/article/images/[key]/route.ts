import { NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { savedArticleImageKey } from "@/lib/saved-article-format";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { readSavedArticleImage, savedArticlePrivateHeaders } from "@/lib/services/saved-article-reader";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  try {
    const [user, { id, key }] = await Promise.all([requireUser(), params]);
    return await readSavedArticleImage(user.id, savedItemIdSchema.parse(id), savedArticleImageKey.parse(key),
      request.nextUrl.searchParams.get("copy") ?? undefined);
  } catch (error) {
    const response = apiError(error);
    for (const [name, value] of Object.entries(savedArticlePrivateHeaders)) response.headers.set(name, value);
    return response;
  }
}
