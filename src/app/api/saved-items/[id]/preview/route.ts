import { NextRequest } from "next/server";
import { ApiError, apiError, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { fetchSavedMetadataResource } from "@/lib/saved-metadata-network";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { IMAGE_EXTENSIONS, isValidImageMime } from "@/lib/uploads";

export const runtime = "nodejs";
const maxConcurrent = 4;
const state = globalThis as typeof globalThis & { notebookPreviewRequests?: number };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const item = await db.savedItem.findFirst({
      where: { id: savedItemIdSchema.parse(id), userId: user.id }, select: { metadataImageUrl: true },
    });
    if (!item?.metadataImageUrl) throw new ApiError(404, "Превью недоступно");
    if ((state.notebookPreviewRequests ?? 0) >= maxConcurrent) throw new ApiError(429, "Превью временно недоступно");
    state.notebookPreviewRequests = (state.notebookPreviewRequests ?? 0) + 1;
    try {
      const image = await fetchSavedMetadataResource(item.metadataImageUrl, {
        signal: request.signal, maxBytes: 2 * 1024 * 1024, types: Object.keys(IMAGE_EXTENSIONS),
      });
      if (!isValidImageMime(image.mimeType, image.body)) throw new ApiError(404, "Превью недоступно");
      return new Response(new Uint8Array(image.body), { headers: {
        "content-type": image.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      } });
    } catch {
      throw new ApiError(404, "Превью недоступно");
    } finally {
      state.notebookPreviewRequests--;
    }
  } catch (error) { return apiError(error); }
}
