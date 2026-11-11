import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { readIdempotencyKey, readSavedItemCreate, requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemListSchema } from "@/lib/saved-item-validation";
import { createSavedItem, listSavedItems } from "@/lib/services/saved-item-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const input = savedItemListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listSavedItems(user.id, input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSavedItemMutation(request);
    const key = readIdempotencyKey(request);
    const { input, files } = await readSavedItemCreate(request);
    const { item, replayed } = await createSavedItem(user.id, key, input, files);
    return NextResponse.json({ item }, { status: replayed ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
