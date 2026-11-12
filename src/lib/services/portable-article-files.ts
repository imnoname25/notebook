import sharp from "sharp";
import { readFile, stat } from "node:fs/promises";
import { ApiError } from "@/lib/errors";
import { MAX_ARTICLE_IMAGE_BYTES } from "./saved-article-images";

// Match the extraction decoder's resource boundary. Decode the entire raster,
// so a valid WebP signature alone cannot make a truncated archive acceptable.
export async function validatePortableArticleImage(file: string) {
  try {
    if ((await stat(file)).size > MAX_ARTICLE_IMAGE_BYTES) throw new Error("Image exceeds limit");
    // Buffer input avoids libvips' file cache retaining handles during restore cleanup.
    const image = sharp(await readFile(file), { limitInputPixels: 16_000_000, failOn: "warning" }).timeout({ seconds: 2 });
    const metadata = await image.metadata();
    if (metadata.format !== "webp" || (metadata.pages ?? 1) > 1) throw new Error("Invalid image");
    await image.raw().toBuffer();
  } catch {
    throw new ApiError(400, "Локальное изображение статьи повреждено");
  }
}
