import type { Prisma } from "@/generated/prisma/client";
import { SAVED_ARTICLE_CONTENT_VERSION, SAVED_ARTICLE_IMAGE_VERSION, type SavedArticleBlocks } from "@/lib/saved-article-format";
import type { PreparedArticleImage } from "./saved-article-images";
import type { PreparedUpload } from "./upload-service";

export async function writeSavedArticle(
  tx: Prisma.TransactionClient,
  store: (file: PreparedUpload) => Promise<{ id: string }>,
  id: string,
  sourceUrl: string,
  blocks: SavedArticleBlocks,
  images: PreparedArticleImage[],
  signal?: AbortSignal,
) {
  const orderedKeys = new Set(blocks.flatMap(block => block.type === "image" ? [block.key] : []));
  const assets = new Map(images.map(image => [image.key, image]));
  if (orderedKeys.size !== images.length || [...orderedKeys].some(key => !assets.has(key))) {
    throw new Error("Invalid article image references");
  }
  const data = { contentVersion: orderedKeys.size ? SAVED_ARTICLE_IMAGE_VERSION : SAVED_ARTICLE_CONTENT_VERSION,
    blocks, sourceUrl, extractedAt: new Date() };
  await tx.savedArticle.upsert({ where: { savedItemId: id }, create: { savedItemId: id, ...data }, update: data });
  await tx.savedArticleImage.deleteMany({ where: { savedItemId: id } });
  let position = 0;
  for (const imageKey of orderedKeys) {
    signal?.throwIfAborted();
    const image = assets.get(imageKey)!;
    const upload = image.file ? await store(image.file) : null;
    await tx.savedArticleImage.create({ data: { savedItemId: id, imageKey, sourceUrl: image.sourceUrl,
      position: position++, uploadId: upload?.id } });
  }
}
