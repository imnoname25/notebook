import { createHash } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { MIN_ARTICLE_PROSE, savedArticleBlocks } from "@/lib/saved-article-format";
import { savedHtmlAccessLabel, savedHtmlLoginUrl } from "@/lib/saved-html-access";
import type { DeviceCaptureInput } from "@/lib/saved-item-validation";
import { metadataUrl } from "@/lib/saved-metadata-network";
import { maxUploadBytes } from "@/lib/uploads";
import { MAX_ARTICLE_IMAGE_BYTES, MAX_ARTICLE_IMAGES_BYTES, prepareSavedArticleImage, type PreparedArticleImage } from "./saved-article-images";

export type PreparedDeviceArticle = {
  blocks: NonNullable<DeviceCaptureInput["article"]>["blocks"];
  images: (PreparedArticleImage & { file: NonNullable<PreparedArticleImage["file"]> })[];
};

export async function prepareDeviceArticle(article: DeviceCaptureInput["article"], files: Map<string, File>): Promise<PreparedDeviceArticle | undefined> {
  if (!article) {
    if (files.size) throw new ApiError(400, "Получены изображения без статьи");
    return;
  }
  const blocks = savedArticleBlocks.parse(article.blocks);
  const textBlocks = blocks.filter(block => block.type !== "image");
  const lead = textBlocks.slice(0, 3).map(block => block.content.map(part => part.text).join(""));
  const proseLength = textBlocks.filter(block => block.type !== "heading").reduce((total, block) =>
    total + block.content.reduce((length, part) => length + (part.type === "text" ? part.text.trim().length : 0), 0), 0);
  if (proseLength < MIN_ARTICLE_PROSE || lead.some(savedHtmlAccessLabel)) {
    throw new ApiError(422, "Не удалось подтвердить содержимое статьи");
  }
  const keys = new Set(blocks.flatMap(block => block.type === "image" ? [block.key] : []));
  const sources = new Map(article.images.map(image => [image.key, image.sourceUrl]));
  if (keys.size !== article.images.length || keys.size !== files.size || [...keys].some(key => !sources.has(key) || !files.has(key))) {
    throw new ApiError(400, "Изображения должны соответствовать блокам статьи");
  }
  for (const [key, sourceUrl] of sources) {
    try {
      const url = metadataUrl(sourceUrl);
      if (savedHtmlLoginUrl(url) || createHash("sha256").update(sourceUrl).digest("hex") !== key) throw new Error();
    } catch { throw new ApiError(422, "Некорректный источник изображения статьи"); }
  }
  const sizes = [...files.values()].map(file => file.size);
  if (sizes.some(size => size > Math.min(maxUploadBytes(), MAX_ARTICLE_IMAGE_BYTES))
    || sizes.reduce((sum, size) => sum + size, 0) > MAX_ARTICLE_IMAGES_BYTES) {
    throw new ApiError(413, "Превышен размер изображений статьи");
  }
  const images: PreparedDeviceArticle["images"] = [];
  let outputBytes = 0;
  for (const key of keys) {
    const file = await prepareSavedArticleImage(Buffer.from(await files.get(key)!.arrayBuffer()));
    if (!file) throw new ApiError(415, "Не удалось обработать изображение статьи");
    outputBytes += file.size;
    if (outputBytes > MAX_ARTICLE_IMAGES_BYTES) throw new ApiError(413, "Превышен размер изображений статьи");
    images.push({ key, sourceUrl: sources.get(key)!, file });
  }
  return { blocks, images };
}
