ALTER TABLE "UserSettings"
  ADD COLUMN "sectionAccentIntensity" TEXT NOT NULL DEFAULT 'moderate',
  ADD COLUMN "pageListView" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "defaultPagePreset" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "Page"
  ADD COLUMN "backgroundType" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "backgroundColor" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "backgroundGradient" TEXT,
  ADD COLUMN "backgroundPattern" TEXT NOT NULL DEFAULT 'plain',
  ADD COLUMN "backgroundUploadId" TEXT,
  ADD COLUMN "backgroundPosition" TEXT NOT NULL DEFAULT 'center',
  ADD COLUMN "backgroundOverlay" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "appearancePreset" TEXT;

CREATE UNIQUE INDEX "Page_backgroundUploadId_key" ON "Page"("backgroundUploadId");
ALTER TABLE "Page" ADD CONSTRAINT "Page_backgroundUploadId_fkey"
  FOREIGN KEY ("backgroundUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
