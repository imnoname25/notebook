-- Existing installations were single-administrator instances. Backfill existing
-- accounts as administrators before changing the default used for future users.
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

ALTER TABLE "User"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "role" = 'ADMIN';

CREATE INDEX "User_role_disabledAt_idx" ON "User"("role", "disabledAt");

CREATE TABLE "UserSettings" (
  "userId" TEXT NOT NULL,
  "interfaceDensity" TEXT NOT NULL DEFAULT 'comfortable',
  "editorSpellcheck" BOOLEAN NOT NULL DEFAULT true,
  "editorCodeLineNumbers" BOOLEAN NOT NULL DEFAULT false,
  "editorCompactMode" BOOLEAN NOT NULL DEFAULT false,
  "editorContentWidth" TEXT NOT NULL DEFAULT 'normal',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
