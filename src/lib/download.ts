import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { contentDisposition, safeDownloadName } from "@/lib/storage";

export async function fileDownloadResponse(filePath: string, fileName: string, cleanupDirectory?: string) {
  const info = await stat(filePath); const source = createReadStream(filePath);
  if (cleanupDirectory) source.once("close", () => { void rm(cleanupDirectory, { recursive: true, force: true }); });
  return new Response(Readable.toWeb(source) as ReadableStream, { headers: { "content-type": "application/zip", "content-length": String(info.size), "content-disposition": contentDisposition(safeDownloadName(fileName)), "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
