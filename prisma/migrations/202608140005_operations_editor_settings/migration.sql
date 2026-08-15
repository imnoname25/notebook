-- Instance settings and private operational backup metadata.
CREATE TABLE "ApplicationSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "defaultTheme" TEXT NOT NULL DEFAULT 'system',
  "autosaveDelayMs" INTEGER NOT NULL DEFAULT 750,
  "pageVersionIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "pageVersionRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "pageVersionMaxCount" INTEGER NOT NULL DEFAULT 100,
  "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
  "backupSchedule" TEXT NOT NULL DEFAULT 'daily',
  "backupTime" TEXT NOT NULL DEFAULT '02:00',
  "backupRetentionCount" INTEGER NOT NULL DEFAULT 14,
  "backupRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "lastScheduledBackupAt" TIMESTAMP(3),
  "backupConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "webdavEnabled" BOOLEAN NOT NULL DEFAULT false,
  "webdavUrl" TEXT,
  "webdavUsername" TEXT,
  "webdavPasswordEncrypted" TEXT,
  "webdavRemoteDirectory" TEXT NOT NULL DEFAULT 'notebook-backups',
  "editorSpellcheck" BOOLEAN NOT NULL DEFAULT true,
  "editorCodeLineNumbers" BOOLEAN NOT NULL DEFAULT false,
  "editorCompactMode" BOOLEAN NOT NULL DEFAULT false,
  "editorContentWidth" TEXT NOT NULL DEFAULT 'normal',
  "lastStorageAuditAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackupRecord" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "filename" TEXT,
  "size" BIGINT,
  "sha256" TEXT,
  "remoteStatus" TEXT NOT NULL DEFAULT 'not_configured',
  "remoteEtag" TEXT,
  "errorCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupRecord_filename_key" ON "BackupRecord"("filename");
CREATE INDEX "BackupRecord_createdAt_idx" ON "BackupRecord"("createdAt");
CREATE INDEX "BackupRecord_status_createdAt_idx" ON "BackupRecord"("status", "createdAt");
