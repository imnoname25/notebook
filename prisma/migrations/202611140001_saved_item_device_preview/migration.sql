ALTER TYPE "SavedItemOperation" ADD VALUE 'devicePreview';

CREATE TYPE "SavedPreviewField" AS ENUM ('title', 'description', 'siteName');

ALTER TABLE "SavedItem"
  ADD COLUMN "androidMetadataFields" "SavedPreviewField"[] NOT NULL DEFAULT ARRAY[]::"SavedPreviewField"[],
  ADD COLUMN "previewUploadId" TEXT;

CREATE UNIQUE INDEX "SavedItem_previewUploadId_key" ON "SavedItem"("previewUploadId");

ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_previewUploadId_fkey"
  FOREIGN KEY ("previewUploadId") REFERENCES "Upload"(id) ON DELETE NO ACTION ON UPDATE CASCADE;
