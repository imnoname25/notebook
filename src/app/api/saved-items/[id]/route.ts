import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { readSavedItemJson, requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemIdSchema, savedItemUpdateSchema } from "@/lib/saved-item-validation";
import { deleteSavedItem, getSavedItem, updateSavedItem } from "@/lib/services/saved-item-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const item = await getSavedItem(user.id, savedItemIdSchema.parse(id));
    return NextResponse.json({ item }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    const input = savedItemUpdateSchema.parse(await readSavedItemJson(request));
    const item = await updateSavedItem(user.id, savedItemIdSchema.parse(id), input);
    return NextResponse.json({ item });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    await deleteSavedItem(user.id, savedItemIdSchema.parse(id));
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
