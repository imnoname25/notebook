import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

export function uploadRoot() { return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./data/uploads"); }

export function resolveStoragePath(storageName: string) {
  if (!storageName || path.isAbsolute(storageName) || storageName.includes("\0")) throw new Error("Некорректное имя файла хранилища");
  const root = uploadRoot(); const resolved = path.resolve(root, storageName);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Путь выходит за пределы хранилища");
  return resolved;
}

export function safeDownloadName(value: string, fallback = "download") {
  const cleaned = value.normalize("NFKC").replace(/[\x00-\x1f\x7f"\\/:*?<>|]+/g, "_").replace(/\.{2,}/g, "_").replace(/_+/g, "_").replace(/^\.+/, "").trim().slice(0, 180);
  return cleaned || fallback;
}

export function contentDisposition(fileName: string, disposition: "attachment" | "inline" = "attachment") {
  const safe = safeDownloadName(fileName).replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName(fileName))}`;
}

export async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
