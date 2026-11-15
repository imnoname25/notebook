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

export async function prepareSavedArticleImage(bytes: Buffer, expectedMime?: string) {
  const limit = Math.min(MAX_ARTICLE_IMAGE_BYTES, maxUploadBytes());
  if (!bytes.length || bytes.length > limit) return null;
  const mime = MIME_TYPES.find(type => isValidImageMime(type, bytes));
  if (!mime || (expectedMime && expectedMime !== mime)) return null;
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "warning", animated: true }).timeout({ seconds: 2 });
    const info = await image.metadata();
    if (`image/${info.format}` !== mime || info.width < MIN_DIMENSION || info.height < MIN_DIMENSION
      || info.width > 8192 || info.height > 8192 || info.width * info.height > MAX_PIXELS || (info.pages ?? 1) > 1) return null;
    const output = await image.autoOrient().resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    if (output.byteLength > limit) return null;
    return await prepareUpload(new File([new Uint8Array(output)], "article-image.webp", { type: SAVED_ARTICLE_IMAGE_MIME }));
  } catch { return null; }
}

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
      if (resource.body.byteLength > maxBytes) continue;
      const output = await prepareSavedArticleImage(resource.body, resource.mimeType);
      overall.throwIfAborted();
      if (!output || output.size > MAX_ARTICLE_IMAGES_BYTES - stored) continue;
      entry.file = output;
      stored += entry.file.size;
    } catch {
      signal.throwIfAborted();
    } finally {
      received += transferred;
    }
  }
  return images;
}
