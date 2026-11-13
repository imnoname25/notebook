ALTER TABLE "SavedItemMetadataJob" ADD COLUMN "failureReason" TEXT
  CHECK ("failureReason" IN ('access', 'dns', 'tls', 'timeout', 'http', 'request', 'destination', 'redirect', 'mime', 'encoding', 'size', 'response'));
