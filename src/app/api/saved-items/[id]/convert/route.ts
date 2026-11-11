import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { readIdempotencyKey, readSavedItemJson, requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemConvertSchema, savedItemIdSchema } from "@/lib/saved-item-validation";
import { convertSavedItem } from "@/lib/services/saved-item-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    const key = readIdempotencyKey(request);
    const { sectionId } = savedItemConvertSchema.parse(await readSavedItemJson(request));
    const { pageId, replayed } = await convertSavedItem(user.id, savedItemIdSchema.parse(id), sectionId, key);
    return NextResponse.json({ pageId }, { status: replayed ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
