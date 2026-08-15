const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/gif": (b) => String.fromCharCode(...b.slice(0, 6)) === "GIF87a" || String.fromCharCode(...b.slice(0, 6)) === "GIF89a",
  "image/webp": (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  "image/avif": (b) => String.fromCharCode(...b.slice(4, 12)).includes("ftypavif"),
};

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function isValidImageMime(mimeType: string, bytes: Uint8Array) {
  return Boolean(IMAGE_SIGNATURES[mimeType]?.(bytes));
}

export function maxUploadBytes() {
  const configured = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10);
  return (Number.isFinite(configured) && configured > 0 ? configured : 10) * 1024 * 1024;
}
