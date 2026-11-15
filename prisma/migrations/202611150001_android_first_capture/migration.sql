ALTER TYPE "SavedItemOperation" ADD VALUE 'deviceCapture';

ALTER TABLE "SavedItem"
  ADD COLUMN "deviceCapture" JSONB,
  ADD COLUMN "deviceCaptureUntil" TIMESTAMP(3),
  ADD COLUMN "deviceCaptureFailure" TEXT;
