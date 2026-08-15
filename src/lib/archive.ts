import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipArchive, type Archiver } from "archiver";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { ApiError } from "@/lib/errors";
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_JSON_BYTES, maxImportArchiveBytes, maxImportUncompressedBytes } from "@/lib/data-limits";

export async function createDataTempDirectory(prefix = "notebook-data-") { return mkdtemp(path.join(tmpdir(), prefix)); }

export function assertSafeArchivePath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new ApiError(400, "Архив содержит небезопасный путь");
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.split("/").includes("..")) throw new ApiError(400, "Архив содержит path traversal");
  return normalized;
}

export async function writeRequestToFile(request: Request, target: string) {
  if (!request.body) throw new ApiError(400, "Файл не передан");
  const declared = Number(request.headers.get("content-length") ?? 0);
  const maximum = maxImportArchiveBytes();
  if (declared > maximum) throw new ApiError(413, "Архив превышает допустимый размер");
  let total = 0;
  const reader = request.body.getReader(); const output = createWriteStream(target, { flags: "wx" });
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > maximum) throw new ApiError(413, "Архив превышает допустимый размер"); if (!output.write(chunk.value)) await new Promise<void>((resolve) => output.once("drain", resolve)); }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) { output.destroy(); await rm(target, { force: true }); throw error; }
  return total;
}

export async function detectImportKind(filePath: string) {
  const handle = await import("node:fs/promises").then(({ open }) => open(filePath, "r"));
  try { const bytes = Buffer.alloc(4); await handle.read(bytes, 0, 4, 0); const zipSignature = bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08)); if (zipSignature) return "zip" as const; const first = bytes.toString("utf8").trimStart(); if (first.startsWith("{") || first.startsWith("[")) return "json" as const; throw new ApiError(415, "Поддерживается Notebook JSON или ZIP-архив"); }
  finally { await handle.close(); }
}

function openZip(filePath: string) { return new Promise<ZipFile>((resolve, reject) => yauzl.open(filePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("ZIP не открыт")) : resolve(zip))); }
function entryStream(zip: ZipFile, entry: Entry) { return new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error("ZIP entry не прочитан")) : resolve(stream))); }

export async function extractZipSafely(filePath: string, destination: string) {
  const zip = await openZip(filePath); const seen = new Set<string>(); let entries = 0; let total = 0;
  return new Promise<{ entries: number; uncompressedBytes: number }>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => { if (settled) return; settled = true; zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => { if (!settled) { settled = true; resolve({ entries, uncompressedBytes: total }); } });
    zip.on("entry", (entry) => { void (async () => {
      entries += 1; if (entries > MAX_IMPORT_ENTRIES) throw new ApiError(413, "В архиве слишком много файлов");
      const name = assertSafeArchivePath(entry.fileName); if (seen.has(name)) throw new ApiError(400, "Архив содержит повторяющиеся пути"); seen.add(name);
      if ((entry.generalPurposeBitFlag & 1) !== 0) throw new ApiError(400, "Зашифрованные ZIP entries не поддерживаются");
      const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff; if ((unixMode & 0o170000) === 0o120000) throw new ApiError(400, "Symlink entries запрещены");
      total += entry.uncompressedSize; if (total > maxImportUncompressedBytes()) throw new ApiError(413, "Распакованный архив слишком большой");
      const target = path.resolve(destination, ...name.split("/")); if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new ApiError(400, "Архив содержит path traversal");
      if (entry.fileName.endsWith("/")) await mkdir(target, { recursive: true });
      else { await mkdir(path.dirname(target), { recursive: true }); const source = await entryStream(zip, entry); await pipeline(source, createWriteStream(target, { flags: "wx" })); }
      zip.readEntry();
    })().catch(fail); });
    zip.readEntry();
  });
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const info = await stat(filePath); if (info.size > MAX_IMPORT_JSON_BYTES) throw new ApiError(413, "JSON в архиве слишком большой");
  try { return JSON.parse(await readFile(filePath, "utf8")) as unknown; } catch { throw new ApiError(400, "Некорректный JSON"); }
}

export async function createZipArchive(target: string, build: (archive: Archiver) => Promise<void>) {
  await mkdir(path.dirname(target), { recursive: true });
  const output = createWriteStream(target, { flags: "wx" }); const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
  archive.pipe(output);
  try { await build(archive); await archive.finalize(); await done; }
  catch (error) { archive.abort(); output.destroy(); await rm(target, { force: true }); throw error; }
}

export { createReadStream };
