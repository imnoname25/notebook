export type RemoteProvider = "webdav" | "s3";
export type RemoteUploadInput = { filename: string; filePath: string; size: bigint; sha256: string };
export type RemoteUploadResult = { remoteKey: string; etag?: string | null; versionId?: string | null };

export interface BackupRemoteTarget {
  readonly provider: RemoteProvider;
  test(): Promise<void>;
  upload(input: RemoteUploadInput): Promise<RemoteUploadResult>;
  download(remoteKey: string, targetPath: string, maxBytes: bigint): Promise<{ size: bigint }>;
  delete(remoteKey: string): Promise<void>;
  ownsKey(remoteKey: string): boolean;
}
