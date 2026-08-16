ALTER TABLE "Section" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Page" ADD COLUMN "icon" TEXT;
ALTER TABLE "Page" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Page" ADD COLUMN "coverUploadId" TEXT;
ALTER TABLE "ApplicationSettings" ADD COLUMN "interfaceDensity" TEXT NOT NULL DEFAULT 'comfortable';
ALTER TABLE "Notebook" ALTER COLUMN "color" SET DEFAULT 'default';

CREATE UNIQUE INDEX "Page_coverUploadId_key" ON "Page"("coverUploadId");
ALTER TABLE "Page" ADD CONSTRAINT "Page_coverUploadId_fkey" FOREIGN KEY ("coverUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
