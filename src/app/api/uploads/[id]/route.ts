import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { ApiError, apiError, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { contentDisposition, resolveStoragePath } from "@/lib/storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const upload = await db.upload.findFirst({ where: { id, userId: user.id } });
    if (!upload) throw new ApiError(404, "Файл не найден");
    const filePath = resolveStoragePath(upload.storageName); const info = await stat(filePath).catch(() => null); if (!info?.isFile()) throw new ApiError(404, "Файл вложения отсутствует");
    const headers: Record<string, string> = { "content-type": upload.mimeType, "content-length": String(info.size), "cache-control": "private, max-age=86400, immutable", "x-content-type-options": "nosniff", "content-disposition": contentDisposition(upload.originalName, _request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline") };
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers });
  } catch (error) { return apiError(error); }
}
