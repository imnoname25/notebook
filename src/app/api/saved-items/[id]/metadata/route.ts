import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { retrySavedItemMetadata } from "@/lib/services/saved-item-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [user, { id }] = await Promise.all([requireSavedItemMutation(request), params]);
    const item = await retrySavedItemMetadata(user.id, savedItemIdSchema.parse(id));
    return NextResponse.json({ item }, { status: 202 });
  } catch (error) { return apiError(error); }
}
