import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { ApiError } from "@/lib/errors";
import { normalizeS3Prefix } from "@/lib/application-settings";
import type { BackupRemoteTarget, RemoteUploadInput } from "@/lib/remote-backup";

export type S3BackupConfig = { endpoint?: string | null; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string; forcePathStyle: boolean };
type S3Sender = Pick<S3Client, "send">;
const S3_TIMEOUT_MS = 15_000;

export function validateS3Config(config: S3BackupConfig) {
  if (config.endpoint) { const url = new URL(config.endpoint); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ApiError(400, "Некорректный S3 endpoint"); }
  if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey) throw new ApiError(400, "S3 настроен не полностью");
  return { ...config, prefix: normalizeS3Prefix(config.prefix) };
}

export function createS3Client(config: S3BackupConfig) {
  const valid = validateS3Config(config);
  const options: S3ClientConfig = { region: valid.region, forcePathStyle: valid.forcePathStyle, credentials: { accessKeyId: valid.accessKeyId, secretAccessKey: valid.secretAccessKey }, ...(valid.endpoint ? { endpoint: valid.endpoint } : {}) };
  return new S3Client(options);
}

export class S3BackupTarget implements BackupRemoteTarget {
  readonly provider = "s3" as const;
  private readonly config: ReturnType<typeof validateS3Config>;
  constructor(config: S3BackupConfig, private readonly client: S3Sender = createS3Client(config)) { this.config = validateS3Config(config); }
  private key(filename: string) { if (!/^notebook-backup-[A-Za-z0-9._-]+\.zip$/u.test(filename)) throw new ApiError(400, "Некорректное имя backup"); return this.config.prefix ? `${this.config.prefix}/${filename}` : filename; }
  ownsKey(key: string) { const prefix = this.config.prefix ? `${this.config.prefix}/` : ""; return key.startsWith(prefix) && /^notebook-backup-[A-Za-z0-9._-]+\.zip$/u.test(key.slice(prefix.length)); }
  async test() { try { await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }); await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: this.config.prefix ? `${this.config.prefix}/` : undefined, MaxKeys: 1 }), { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }); } catch { throw new ApiError(502, "Не удалось подключиться к S3: проверьте endpoint, region, bucket и credentials"); } }
  async upload(input: RemoteUploadInput) { const remoteKey = this.key(input.filename); try { const response = await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: remoteKey, Body: createReadStream(input.filePath), ContentLength: Number(input.size), ContentType: "application/zip", Metadata: { "notebook-sha256": input.sha256 } }), { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }); return { remoteKey, etag: response.ETag ?? null, versionId: response.VersionId ?? null }; } catch { throw new ApiError(502, "S3 upload failed"); } }
  async download(remoteKey: string, targetPath: string, maxBytes: bigint) { if (!this.ownsKey(remoteKey)) throw new ApiError(400, "S3 object не принадлежит Notebook"); try { const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: remoteKey }), { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }); const declared = BigInt(response.ContentLength ?? 0); if (declared > maxBytes) throw new ApiError(413, "Remote backup превышает допустимый размер"); if (!response.Body || !("pipe" in response.Body)) throw new ApiError(502, "S3 не вернул поток backup"); let size = 0n; const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += BigInt(chunk.byteLength); if (size > maxBytes) callback(new ApiError(413, "Remote backup превышает допустимый размер")); else callback(null, chunk); } }); await pipeline(response.Body as NodeJS.ReadableStream, limiter, createWriteStream(targetPath, { flags: "wx" })); return { size }; } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, "S3 download failed"); } }
  async delete(remoteKey: string) { if (!this.ownsKey(remoteKey)) throw new ApiError(400, "S3 object не принадлежит Notebook"); try { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: remoteKey }), { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }); } catch { throw new ApiError(502, "S3 delete failed"); } }
}
