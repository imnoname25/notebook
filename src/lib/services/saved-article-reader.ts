import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { savedArticleBlocks, SAVED_ARTICLE_CONTENT_VERSION, SAVED_ARTICLE_IMAGE_VERSION } from "@/lib/saved-article-format";
import { resolveStoragePath } from "@/lib/storage";
import { SAVED_ARTICLE_IMAGE_MIME } from "./saved-article-images";

export const savedArticlePrivateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export async function readSavedArticle(userId: string, id: string) {
  const item = await db.savedItem.findFirst({
    where: { id, userId },
    select: {
      url: true,
      articleJob: { select: { status: true, finishedAt: true } },
      article: { include: {
        images: { orderBy: { position: "asc" }, select: {
          imageKey: true, upload: { select: { userId: true, mimeType: true } },
        } },
      } },
    },
  });
  if (!item) throw new ApiError(404, "Материал не найден");
  const job = item.articleJob;
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
  }, job };
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
