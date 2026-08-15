import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { IMAGE_EXTENSIONS, isValidImageMime, maxUploadBytes } from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let writtenPath: string | null = null;
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    const pageId = form.get("pageId");
    if (!(file instanceof File)) throw new ApiError(400, "Файл не передан");
    if (file.size <= 0 || file.size > maxUploadBytes()) throw new ApiError(413, "Файл слишком большой");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension || !isValidImageMime(file.type, bytes)) throw new ApiError(415, "Поддерживаются JPEG, PNG, GIF, WebP и AVIF");
    if (typeof pageId !== "string" || !pageId) throw new ApiError(400, "Не указана страница вложения");
    const page = await db.page.findFirst({ where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId: user.id, deletedAt: null } } }, select: { id: true } });
    if (!page) throw new ApiError(404, "Страница не найдена");
    const storageName = `${user.id}/${randomUUID()}.${extension}`;
    const uploadRoot = path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./data/uploads");
    writtenPath = path.join(uploadRoot, storageName);
    await mkdir(path.dirname(writtenPath), { recursive: true });
    await writeFile(writtenPath, bytes, { flag: "wx" });
    const upload = await db.upload.create({ data: { userId: user.id, pageId: page.id, storageName, originalName: file.name.slice(0, 255), mimeType: file.type, size: file.size, sha256: createHash("sha256").update(bytes).digest("hex") } });
    return NextResponse.json({ id: upload.id, url: `/api/uploads/${upload.id}` }, { status: 201 });
  } catch (error) {
    if (writtenPath) await rm(writtenPath, { force: true }).catch(() => undefined);
    return apiError(error);
  }
}
