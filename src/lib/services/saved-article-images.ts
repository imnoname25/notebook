import sharp from "sharp";
import type { ArticleImageCandidate } from "@/lib/saved-article-extraction";
import { MAX_ARTICLE_IMAGES } from "@/lib/saved-article-format";
import { fetchSavedMetadataResource } from "@/lib/saved-metadata-network";
import { isValidImageMime, maxUploadBytes } from "@/lib/uploads";
import { prepareUpload, type PreparedUpload } from "./upload-service";

const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_ARTICLE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ARTICLE_IMAGES_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MIN_DIMENSION = 32;
export const SAVED_ARTICLE_IMAGE_MIME = "image/webp";
export type PreparedArticleImage = ArticleImageCandidate & { file: PreparedUpload | null };

export async function downloadSavedArticleImages(
  candidates: ArticleImageCandidate[], signal: AbortSignal, fetchResource = fetchSavedMetadataResource,
): Promise<PreparedArticleImage[]> {
  const overall = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const images: PreparedArticleImage[] = [];
  let received = 0;
  let stored = 0;
  for (const candidate of candidates.slice(0, MAX_ARTICLE_IMAGES)) {
    signal.throwIfAborted();
    const entry: PreparedArticleImage = { ...candidate, file: null };
    images.push(entry);
    const maxBytes = Math.floor(Math.min(MAX_ARTICLE_IMAGE_BYTES, MAX_ARTICLE_IMAGES_BYTES - received, maxUploadBytes()));
    if (overall.aborted || maxBytes <= 0) continue;
    let transferred = 0;
    try {
      const requestSignal = AbortSignal.any([overall, AbortSignal.timeout(3_000)]);
      const resource = await fetchResource(candidate.sourceUrl, {
        maxBytes, types: MIME_TYPES, signal: requestSignal, rejectChallenge: true,
        onBytes: bytes => { transferred += bytes; },
      });
      transferred = Math.max(transferred, resource.body.byteLength);
      if (resource.body.byteLength > maxBytes || !MIME_TYPES.includes(resource.mimeType)
        || !isValidImageMime(resource.mimeType, resource.body)) continue;
      const image = sharp(resource.body, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).timeout({ seconds: 2 });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION
        || metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) > 1
        || `image/${metadata.format}` !== resource.mimeType) continue;
      overall.throwIfAborted();
      const output = await image.autoOrient().resize(2000, 2000, {
        fit: "inside", withoutEnlargement: true,
      }).webp({ quality: 85 }).toBuffer();
      overall.throwIfAborted();
      if (output.byteLength > Math.min(MAX_ARTICLE_IMAGE_BYTES, MAX_ARTICLE_IMAGES_BYTES - stored, maxUploadBytes())) continue;
      entry.file = await prepareUpload(new File([new Uint8Array(output)], "article-image.webp", { type: SAVED_ARTICLE_IMAGE_MIME }));
      stored += entry.file.size;
    } catch {
      signal.throwIfAborted();
    } finally {
      received += transferred;
    }
  }
  return images;
}
