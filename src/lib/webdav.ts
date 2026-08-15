import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApiError } from "@/lib/errors";
import { normalizeWebdavDirectory } from "@/lib/application-settings";
import type { BackupRemoteTarget, RemoteUploadInput } from "@/lib/remote-backup";

export type WebdavConfig = { url: string; username?: string | null; password?: string | null; remoteDirectory: string };
type Fetcher = typeof fetch;
type NodeRequestInit = RequestInit & { duplex?: "half" };
const TIMEOUT_MS = 10_000;

function validatedBase(value: string) {
  const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ApiError(400, "Некорректный WebDAV URL"); url.hash = ""; url.search = ""; return url;
}

function joinUrl(base: URL, parts: string[]) { const url = new URL(base); url.pathname = `${url.pathname.replace(/\/+$/, "")}/${parts.map(encodeURIComponent).join("/")}`; return url; }

async function request(fetcher: Fetcher, config: WebdavConfig, url: URL, init: NodeRequestInit) {
  const origin = validatedBase(config.url).origin; let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const headers = new Headers(init.headers); if (config.username) headers.set("authorization", `Basic ${Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64")}`);
    const response = await fetcher(current, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (![301, 302, 307, 308].includes(response.status)) return response;
    if (init.body) throw new ApiError(502, "WebDAV redirect для upload/probe запрещён");
    const location = response.headers.get("location"); if (!location || redirects === 3) throw new ApiError(502, "Слишком много WebDAV redirects"); const next = new URL(location, current); if (next.origin !== origin) throw new ApiError(502, "WebDAV redirect на другой origin запрещён"); current = next;
  }
  throw new ApiError(502, "WebDAV redirect error");
}

function categorize(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "WebDAV timeout";
  return "WebDAV connect/DNS/TLS error";
}

async function ensureDirectory(config: WebdavConfig, fetcher: Fetcher) {
  const base = validatedBase(config.url); const parts = normalizeWebdavDirectory(config.remoteDirectory).split("/");
  for (let index = 1; index <= parts.length; index++) {
    const target = joinUrl(base, parts.slice(0, index)); const check = await request(fetcher, config, target, { method: "PROPFIND", headers: { depth: "0" } });
    if (check.ok || check.status === 207) continue;
    if (check.status === 401) throw new ApiError(502, "WebDAV unauthorized"); if (check.status === 403) throw new ApiError(502, "WebDAV forbidden"); if (check.status !== 404) throw new ApiError(502, `WebDAV PROPFIND ${check.status}`);
    const created = await request(fetcher, config, target, { method: "MKCOL" }); if (!(created.ok || created.status === 405)) throw new ApiError(502, `WebDAV MKCOL ${created.status}`);
  }
  return joinUrl(base, parts);
}

export async function testWebdavConnection(config: WebdavConfig, fetcher: Fetcher = fetch) {
  try { const directory = await ensureDirectory(config, fetcher); const probe = new URL(`${directory.toString().replace(/\/$/, "")}/.notebook-probe-${crypto.randomUUID()}.txt`); const uploaded = await request(fetcher, config, probe, { method: "PUT", headers: { "content-type": "text/plain" }, body: "Notebook WebDAV probe" }); if (uploaded.status === 401) throw new ApiError(502, "WebDAV unauthorized"); if (uploaded.status === 403) throw new ApiError(502, "WebDAV forbidden"); if (!uploaded.ok) throw new ApiError(502, `WebDAV PUT ${uploaded.status}`); const removed = await request(fetcher, config, probe, { method: "DELETE" }); if (!(removed.ok || removed.status === 404)) throw new ApiError(502, `WebDAV DELETE ${removed.status}`); return { ok: true as const }; }
  catch (error) { throw new ApiError(502, categorize(error)); }
}

export async function uploadBackupToWebdav(config: WebdavConfig, filename: string, filePath: string, size: bigint, fetcher: Fetcher = fetch) {
  try { const directory = await ensureDirectory(config, fetcher); const target = new URL(`${directory.toString().replace(/\/$/, "")}/${encodeURIComponent(filename)}`); const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream; const response = await request(fetcher, config, target, { method: "PUT", headers: { "content-type": "application/zip", "content-length": size.toString() }, body, duplex: "half" }); if (response.status === 401) throw new ApiError(502, "WebDAV unauthorized"); if (response.status === 403) throw new ApiError(502, "WebDAV forbidden"); if (!response.ok) throw new ApiError(502, `WebDAV PUT ${response.status}`); return { etag: response.headers.get("etag") }; }
  catch (error) { throw new ApiError(502, categorize(error)); }
}

function validBackupName(value: string) { if (!/^notebook-backup-[A-Za-z0-9._-]+\.zip$/u.test(value)) throw new ApiError(400, "Некорректное имя WebDAV backup"); return value; }

export async function downloadBackupFromWebdav(config: WebdavConfig, filename: string, targetPath: string, maxBytes: bigint, fetcher: Fetcher = fetch) {
  try {
    const directory = await ensureDirectory(config, fetcher); const target = new URL(`${directory.toString().replace(/\/$/, "")}/${encodeURIComponent(validBackupName(filename))}`);
    const response = await request(fetcher, config, target, { method: "GET" }); if (!response.ok || !response.body) throw new ApiError(502, `WebDAV GET ${response.status}`);
    const declared = BigInt(response.headers.get("content-length") ?? 0); if (declared > maxBytes) throw new ApiError(413, "Remote backup превышает допустимый размер");
    let received = 0n; const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += BigInt(chunk.byteLength); if (received > maxBytes) callback(new ApiError(413, "Remote backup превышает допустимый размер")); else callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(targetPath, { flags: "wx" })); return { size: received };
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, categorize(error)); }
}

export async function deleteBackupFromWebdav(config: WebdavConfig, filename: string, fetcher: Fetcher = fetch) {
  try { const directory = await ensureDirectory(config, fetcher); const target = new URL(`${directory.toString().replace(/\/$/, "")}/${encodeURIComponent(validBackupName(filename))}`); const response = await request(fetcher, config, target, { method: "DELETE" }); if (!(response.ok || response.status === 404)) throw new ApiError(502, `WebDAV DELETE ${response.status}`); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, categorize(error)); }
}

export class WebdavBackupTarget implements BackupRemoteTarget {
  readonly provider = "webdav" as const;
  constructor(private readonly config: WebdavConfig, private readonly fetcher: Fetcher = fetch) {}
  ownsKey(remoteKey: string) { return /^notebook-backup-[A-Za-z0-9._-]+\.zip$/u.test(remoteKey); }
  async test() { await testWebdavConnection(this.config, this.fetcher); }
  async upload(input: RemoteUploadInput) { const response = await uploadBackupToWebdav(this.config, input.filename, input.filePath, input.size, this.fetcher); return { remoteKey: input.filename, etag: response.etag }; }
  async download(remoteKey: string, targetPath: string, maxBytes: bigint) { if (!this.ownsKey(remoteKey)) throw new ApiError(400, "WebDAV object не принадлежит Notebook"); return downloadBackupFromWebdav(this.config, remoteKey, targetPath, maxBytes, this.fetcher); }
  async delete(remoteKey: string) { if (!this.ownsKey(remoteKey)) throw new ApiError(400, "WebDAV object не принадлежит Notebook"); await deleteBackupFromWebdav(this.config, remoteKey, this.fetcher); }
}
