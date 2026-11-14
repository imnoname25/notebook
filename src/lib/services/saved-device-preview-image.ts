import sharp from "sharp";
import { ApiError } from "@/lib/errors";
import { DEVICE_PREVIEW_MIME, MAX_DEVICE_PREVIEW_BYTES } from "@/lib/saved-item-validation";
import { isValidImageMime, maxUploadBytes } from "@/lib/uploads";
import { prepareUpload } from "./upload-service";

const maxPixels = 16_000_000;

export async function prepareDevicePreviewImage(file: File) {
  const limit = Math.min(MAX_DEVICE_PREVIEW_BYTES, maxUploadBytes());
  if (!file.size || file.size > limit) throw new ApiError(413, "Обложка превышает допустимый размер");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = ["image/jpeg", "image/png", DEVICE_PREVIEW_MIME].find(type => isValidImageMime(type, bytes));
  if (!mime) throw new ApiError(415, "Поддерживаются JPEG, PNG и WebP");
  let normalized: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: "warning", animated: true }).timeout({ seconds: 2 });
    const info = await image.metadata();
    if (mime !== `image/${info.format}` || info.width < 32 || info.height < 32
      || info.width > 8192 || info.height > 8192 || info.width * info.height > maxPixels || (info.pages ?? 1) !== 1) {
      throw new Error("Invalid preview");
    }
    normalized = await image.autoOrient().resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
  } catch {
    throw new ApiError(415, "Не удалось обработать обложку");
  }
  if (normalized.byteLength > limit) throw new ApiError(413, "Обложка превышает допустимый размер");
  return prepareUpload(new File([new Uint8Array(normalized)], "preview.webp", { type: DEVICE_PREVIEW_MIME }));
}
