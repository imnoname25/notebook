ALTER TABLE "Notebook"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionGroupId" TEXT,
  ADD COLUMN "isDeletionRoot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Section"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionGroupId" TEXT,
  ADD COLUMN "isDeletionRoot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Page"
  ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "deletionGroupId" TEXT,
  ADD COLUMN "isDeletionRoot" BOOLEAN NOT NULL DEFAULT false;

-- Preserve pages that were already in the MVP trash before deletion groups existed.
UPDATE "Page"
SET "deletionGroupId" = "id", "isDeletionRoot" = true
WHERE "deletedAt" IS NOT NULL;

-- Backfill searchable plain text from BlockNote JSON without searching raw JSON at runtime.
UPDATE "Page" AS page
SET "searchText" = COALESCE((
  SELECT string_agg(value #>> '{}', ' ')
  FROM jsonb_path_query(page."content", '$.**.text') AS value
), '');

CREATE INDEX "Notebook_userId_deletedAt_idx" ON "Notebook"("userId", "deletedAt");
CREATE INDEX "Section_notebookId_deletedAt_idx" ON "Section"("notebookId", "deletedAt");
CREATE INDEX "Section_deletionGroupId_idx" ON "Section"("deletionGroupId");
CREATE INDEX "Page_deletionGroupId_idx" ON "Page"("deletionGroupId");
