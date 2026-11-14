import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError } from "@/lib/api";
import { readDevicePreview, readIdempotencyKey, requireSavedItemMutation } from "@/lib/saved-item-api";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { getSavedItem, applySavedDevicePreview } from "@/lib/services/saved-item-service";
import { prepareDevicePreviewImage } from "@/lib/services/saved-device-preview-image";

export const runtime = "nodejs";
const state = globalThis as typeof globalThis & { notebookDeviceCoverWrites?: number };

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [user, param] = await Promise.all([requireSavedItemMutation(request), params]);
    const id = savedItemIdSchema.parse(param.id);
    const key = readIdempotencyKey(request);
    const item = await getSavedItem(user.id, id);
    if (!item.url) throw new ApiError(409, "У материала нет ссылки");
    if ((state.notebookDeviceCoverWrites ?? 0) >= 3) {
      return NextResponse.json({ error: "Сервер занят обработкой обложек" }, { status: 429, headers: { "retry-after": "5" } });
    }
    state.notebookDeviceCoverWrites = (state.notebookDeviceCoverWrites ?? 0) + 1;
    try {
      const { input, cover } = await readDevicePreview(request);
      await applySavedDevicePreview(user.id, id, key, input, cover && await prepareDevicePreviewImage(cover));
    } finally {
      state.notebookDeviceCoverWrites--;
    }
    return new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
