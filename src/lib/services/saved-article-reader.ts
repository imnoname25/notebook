import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { savedArticleBlocks, SAVED_ARTICLE_CONTENT_VERSION, SAVED_ARTICLE_IMAGE_VERSION, type SavedArticleBlocks } from "@/lib/saved-article-format";
import { savedHtmlBrowserLabel } from "@/lib/saved-html-access";
import { resolveStoragePath } from "@/lib/storage";
import { SAVED_ARTICLE_IMAGE_MIME } from "./saved-article-images";
import { lockUserUploads } from "./upload-service";

export const savedArticlePrivateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

function isBrowserPlaceholder(blocks: SavedArticleBlocks) {
  const [heading, instructions, ...rest] = blocks.filter(block => block.type !== "image");
  return heading?.type === "heading" && heading.level === 1 && instructions?.type === "paragraph" && rest.length <= 1
    && savedHtmlBrowserLabel(heading.content.map(part => part.text).join(""))
    && /(?:обновите (?:свой )?браузер|(?:update|upgrade) (?:your |the )?browser)/iu
      .test(instructions.content.map(part => part.text).join(""));
}

export async function readSavedArticle(userId: string, id: string) {
  const item = await db.savedItem.findFirst({
    where: { id, userId },
    select: {
      url: true,
      articleJob: { select: { status: true, finishedAt: true, reason: true } },
      article: { include: {
        images: { orderBy: { position: "asc" }, select: {
          imageKey: true, upload: { select: { userId: true, mimeType: true } },
        } },
      } },
    },
  });
  if (!item) throw new ApiError(404, "Материал не найден");
  const job = item.articleJob && {
    status: item.articleJob.status, finishedAt: item.articleJob.finishedAt, accessLimited: item.articleJob.reason === "access",
  };
  const article = item.article;
  if (!article || article.sourceUrl !== item.url ||
    ![SAVED_ARTICLE_CONTENT_VERSION, SAVED_ARTICLE_IMAGE_VERSION].includes(article.contentVersion)) return { article: null, job };
  const blocks = savedArticleBlocks.safeParse(article.blocks);
  if (!blocks.success || (article.contentVersion === SAVED_ARTICLE_CONTENT_VERSION && blocks.data.some(block => block.type === "image"))) {
    return { article: null, job };
  }
  const copy = article.extractedAt.getTime();
  const images = article.images.filter(({ upload }) => upload?.userId === userId && upload.mimeType === SAVED_ARTICLE_IMAGE_MIME)
    .map(({ imageKey }) => ({ key: imageKey, url: `/api/saved-items/${encodeURIComponent(id)}/article/images/${imageKey}?copy=${copy}` }));
  return { article: {
    blocks: blocks.data, images, contentVersion: article.contentVersion, extractedAt: article.extractedAt,
    browserPlaceholder: isBrowserPlaceholder(blocks.data),
  }, job };
}

export async function discardSavedBrowserPlaceholder(userId: string, id: string, extractedAt: Date) {
  await db.$transaction(async tx => {
    await lockUserUploads(tx, userId);
    const [item] = await tx.$queryRaw<{ url: string | null }[]>(Prisma.sql`
      SELECT url FROM "SavedItem" WHERE id = ${id} AND "userId" = ${userId} FOR NO KEY UPDATE`);
    if (!item) throw new ApiError(404, "Материал не найден");
    const copy = await tx.savedArticle.findUnique({ where: { savedItemId: id } });
    if (!copy || copy.sourceUrl !== item.url || copy.extractedAt.getTime() !== extractedAt.getTime()) {
      throw new ApiError(409, "Копия изменилась. Откройте материал заново");
    }
    const blocks = savedArticleBlocks.safeParse(copy.blocks);
    if (!blocks.success || !isBrowserPlaceholder(blocks.data)) throw new ApiError(409, "Копия не распознана как служебная страница");
    const job = await tx.savedArticleJob.findUnique({ where: { savedItemId: id }, select: { status: true } });
    if (job && ["queued", "running", "retry"].includes(job.status)) throw new ApiError(409, "Копия обновляется. Дождитесь завершения");
    await tx.savedArticle.delete({ where: { savedItemId: id } });
    if (job?.status === "ready") {
      await tx.savedArticleJob.update({ where: { savedItemId: id }, data: { status: "fallback", reason: "access" } });
    }
  });
}

export async function readSavedArticleImage(userId: string, id: string, imageKey: string, copy?: string) {
  const image = await db.savedArticleImage.findFirst({
    where: { savedItemId: id, imageKey, article: { savedItem: { userId } }, upload: { userId, mimeType: SAVED_ARTICLE_IMAGE_MIME } },
    select: { upload: { select: { storageName: true } }, article: { select: { sourceUrl: true, extractedAt: true, savedItem: { select: { url: true } } } } },
  });
  if (!image?.upload || image.article.sourceUrl !== image.article.savedItem.url
    || (copy !== undefined && copy !== String(image.article.extractedAt.getTime()))) throw new ApiError(404, "Изображение недоступно");
  const file = await open(resolveStoragePath(image.upload.storageName), "r").catch(() => null);
  if (!file) throw new ApiError(404, "Изображение недоступно");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new ApiError(404, "Изображение недоступно");
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, { headers: {
      ...savedArticlePrivateHeaders, "content-type": SAVED_ARTICLE_IMAGE_MIME, "content-length": String(stat.size),
    } });
  } catch (error) {
    await file.close();
    throw error;
  }
}
