-- PostgreSQL FTS, page templates, normalized remote copies, S3 settings and operational notifications.

-- Generated vectors use the `simple` dictionary so mixed Russian/English technical notes
-- keep predictable tokens. They are maintained by PostgreSQL for every write path.
ALTER TABLE "Page" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("searchText", '')), 'D')
) STORED;
ALTER TABLE "Section" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '')), 'A')) STORED;
ALTER TABLE "Notebook" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '')), 'A')) STORED;

CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
CREATE INDEX "Section_searchVector_idx" ON "Section" USING GIN ("searchVector");
CREATE INDEX "Notebook_searchVector_idx" ON "Notebook" USING GIN ("searchVector");

CREATE TABLE "PageTemplate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT NOT NULL DEFAULT 'file-text',
  "content" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
  "builtInKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageTemplate_userId_builtInKey_key" ON "PageTemplate"("userId", "builtInKey");
CREATE INDEX "PageTemplate_userId_sortOrder_idx" ON "PageTemplate"("userId", "sortOrder");
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationSettings"
  ADD COLUMN "s3Enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "s3Endpoint" TEXT,
  ADD COLUMN "s3Region" TEXT NOT NULL DEFAULT 'us-east-1',
  ADD COLUMN "s3Bucket" TEXT,
  ADD COLUMN "s3AccessKeyId" TEXT,
  ADD COLUMN "s3SecretAccessKeyEncrypted" TEXT,
  ADD COLUMN "s3Prefix" TEXT NOT NULL DEFAULT 'notebook-backups',
  ADD COLUMN "s3ForcePathStyle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "s3ProviderLabel" TEXT,
  ADD COLUMN "remoteRetentionCount" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "remoteRetentionDays" INTEGER NOT NULL DEFAULT 90;

CREATE TABLE "BackupRemoteCopy" (
  "id" TEXT NOT NULL,
  "backupRecordId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "remoteKey" TEXT NOT NULL,
  "etag" TEXT,
  "versionId" TEXT,
  "size" BIGINT,
  "sha256" TEXT,
  "errorCategory" TEXT,
  "uploadedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupRemoteCopy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackupRemoteCopy_backupRecordId_provider_key" ON "BackupRemoteCopy"("backupRecordId", "provider");
CREATE INDEX "BackupRemoteCopy_provider_status_uploadedAt_idx" ON "BackupRemoteCopy"("provider", "status", "uploadedAt");
ALTER TABLE "BackupRemoteCopy" ADD CONSTRAINT "BackupRemoteCopy_backupRecordId_fkey"
FOREIGN KEY ("backupRecordId") REFERENCES "BackupRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing WebDAV upload metadata from stage 5.
INSERT INTO "BackupRemoteCopy" (
  "id", "backupRecordId", "provider", "status", "remoteKey", "etag", "size", "sha256",
  "errorCategory", "uploadedAt", "lastAttemptAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-webdav-' || "id", "id", 'webdav', "remoteStatus", coalesce("filename", ''),
  "remoteEtag", "size", "sha256", "errorCategory",
  CASE WHEN "remoteStatus" = 'success' THEN coalesce("completedAt", "createdAt") ELSE NULL END,
  coalesce("completedAt", "createdAt"), "createdAt", coalesce("completedAt", "createdAt")
FROM "BackupRecord"
WHERE "remoteStatus" <> 'not_configured' AND "filename" IS NOT NULL;

CREATE TABLE "SystemNotification" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "dedupKey" TEXT,
  "readAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SystemNotification_readAt_createdAt_idx" ON "SystemNotification"("readAt", "createdAt");
CREATE INDEX "SystemNotification_dedupKey_resolvedAt_idx" ON "SystemNotification"("dedupKey", "resolvedAt");
