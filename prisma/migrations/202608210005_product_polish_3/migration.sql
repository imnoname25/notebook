ALTER TABLE "UserSettings" ADD COLUMN "startScreen" TEXT NOT NULL DEFAULT 'last';

ALTER TABLE "Notebook"
  ADD COLUMN "coverType" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "coverValue" TEXT,
  ADD COLUMN "coverUploadId" TEXT;

CREATE UNIQUE INDEX "Notebook_coverUploadId_key" ON "Notebook"("coverUploadId");
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_coverUploadId_fkey" FOREIGN KEY ("coverUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
