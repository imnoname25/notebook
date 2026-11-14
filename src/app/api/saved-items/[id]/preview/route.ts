import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { classifySavedLink } from "@/lib/saved-link";
import { fetchSavedMetadataResource, savedRequestFailure, SavedMetadataError } from "@/lib/saved-metadata-network";
import { savedItemIdSchema } from "@/lib/saved-item-validation";
import { IMAGE_EXTENSIONS, isValidImageMime } from "@/lib/uploads";

export const runtime = "nodejs";
const maxConcurrent = 4;
const state = globalThis as typeof globalThis & { notebookPreviewRequests?: number };
const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const item = await db.savedItem.findFirst({
      where: { id: savedItemIdSchema.parse(id), userId: user.id }, select: { url: true, metadataImageUrl: true },
    });
    if (!item?.metadataImageUrl) throw new ApiError(404, "Превью недоступно");
    if ((state.notebookPreviewRequests ?? 0) >= maxConcurrent) {
      return NextResponse.json({ error: "Сервер занят загрузкой обложек", failure: "busy" }, {
        status: 429, headers: { ...privateHeaders, "retry-after": "2" },
      });
    }
    state.notebookPreviewRequests = (state.notebookPreviewRequests ?? 0) + 1;
    try {
      const image = await fetchSavedMetadataResource(item.metadataImageUrl, {
        signal: request.signal, maxBytes: 2 * 1024 * 1024, types: Object.keys(IMAGE_EXTENSIONS), rejectChallenge: true,
      });
      if (!isValidImageMime(image.mimeType, image.body)) throw new SavedMetadataError(false, "response");
      return new Response(new Uint8Array(image.body), { headers: {
        ...privateHeaders, "content-type": image.mimeType,
      } });
    } catch (error) {
      const { reason, httpStatus } = savedRequestFailure(error);
      const link = classifySavedLink(item.url ?? "");
      const provider = link.kind === "article" ? "article" : link.provider;
      if (!request.signal.aborted) console.warn("Notebook saved preview proxy unavailable", { provider, reason, httpStatus });
      if (reason === "destination") throw new ApiError(404, "Превью недоступно");
      return NextResponse.json({ error: "Не удалось загрузить обложку с источника", failure: reason }, {
        status: reason === "timeout" ? 504 : 502, headers: privateHeaders,
      });
    } finally {
      state.notebookPreviewRequests--;
    }
  } catch (error) {
    const response = apiError(error);
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  }
}
