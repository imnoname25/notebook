-- Portable data operations and attachment integrity metadata.
ALTER TABLE "Upload"
  ADD COLUMN "pageId" TEXT,
  ADD COLUMN "sha256" TEXT;

CREATE INDEX "Upload_userId_createdAt_idx" ON "Upload"("userId", "createdAt");
CREATE INDEX "Upload_pageId_idx" ON "Upload"("pageId");
CREATE INDEX "Upload_userId_sha256_idx" ON "Upload"("userId", "sha256");

ALTER TABLE "Upload" ADD CONSTRAINT "Upload_pageId_fkey"
FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
