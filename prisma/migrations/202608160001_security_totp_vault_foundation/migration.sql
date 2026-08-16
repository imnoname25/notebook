-- TOTP second-factor state and short-lived pre-session challenges.
ALTER TABLE "User"
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpSecretEncrypted" TEXT,
  ADD COLUMN "totpPendingSecretEncrypted" TEXT,
  ADD COLUMN "totpPendingCreatedAt" TIMESTAMP(3);

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TotpRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- Vault payloads are opaque client ciphertext. No plaintext secret fields belong here.
CREATE TABLE "VaultProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kdfAlgorithm" TEXT NOT NULL DEFAULT 'argon2id',
  "kdfSalt" TEXT NOT NULL,
  "kdfMemoryKiB" INTEGER NOT NULL DEFAULT 65536,
  "kdfIterations" INTEGER NOT NULL DEFAULT 3,
  "kdfParallelism" INTEGER NOT NULL DEFAULT 1,
  "verifier" TEXT NOT NULL,
  "encryptedKeyset" TEXT NOT NULL,
  "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VaultProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultFolder" (
  "id" TEXT NOT NULL,
  "vaultProfileId" TEXT NOT NULL,
  "parentId" TEXT,
  "encryptedPayload" TEXT NOT NULL,
  "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultItem" (
  "id" TEXT NOT NULL,
  "vaultProfileId" TEXT NOT NULL,
  "folderId" TEXT,
  "itemType" TEXT NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VaultItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");
CREATE INDEX "AuthChallenge_userId_idx" ON "AuthChallenge"("userId");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
CREATE UNIQUE INDEX "TotpRecoveryCode_codeHash_key" ON "TotpRecoveryCode"("codeHash");
CREATE INDEX "TotpRecoveryCode_userId_usedAt_idx" ON "TotpRecoveryCode"("userId", "usedAt");
CREATE UNIQUE INDEX "VaultProfile_userId_key" ON "VaultProfile"("userId");
CREATE INDEX "VaultFolder_vaultProfileId_parentId_sortOrder_idx" ON "VaultFolder"("vaultProfileId", "parentId", "sortOrder");
CREATE INDEX "VaultItem_vaultProfileId_folderId_sortOrder_idx" ON "VaultItem"("vaultProfileId", "folderId", "sortOrder");
CREATE INDEX "VaultItem_vaultProfileId_itemType_idx" ON "VaultItem"("vaultProfileId", "itemType");

ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultProfile" ADD CONSTRAINT "VaultProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_vaultProfileId_fkey" FOREIGN KEY ("vaultProfileId") REFERENCES "VaultProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_vaultProfileId_fkey" FOREIGN KEY ("vaultProfileId") REFERENCES "VaultProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
