BEGIN;

CREATE TABLE "SavedArticleImage" (
  "savedItemId" TEXT NOT NULL REFERENCES "SavedArticle"("savedItemId") ON DELETE CASCADE ON UPDATE CASCADE,
  "imageKey" TEXT NOT NULL CHECK ("imageKey" ~ '^[a-f0-9]{64}$'),
  "sourceUrl" TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  "uploadId" TEXT REFERENCES "Upload"(id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY ("savedItemId", "imageKey")
);
CREATE UNIQUE INDEX "SavedArticleImage_savedItemId_position_key" ON "SavedArticleImage"("savedItemId", position);
CREATE UNIQUE INDEX "SavedArticleImage_uploadId_key" ON "SavedArticleImage"("uploadId");

ALTER TABLE "SavedArticleJob"
  ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

COMMIT;
