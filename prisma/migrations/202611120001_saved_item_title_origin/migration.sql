BEGIN;

CREATE TYPE "SavedItemTitleOrigin" AS ENUM ('system', 'manual', 'share', 'legacy');

ALTER TABLE "SavedItem"
  ADD COLUMN "titleOrigin" "SavedItemTitleOrigin" NOT NULL DEFAULT 'system',
  ADD COLUMN "sharedTitle" TEXT;

UPDATE "SavedItem" SET "titleOrigin" = 'legacy' WHERE "title" <> '';

ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_title_origin_check" CHECK (
  ("titleOrigin" IN ('manual', 'legacy') AND "title" <> '') OR
  ("titleOrigin" = 'share' AND "title" = '' AND coalesce("sharedTitle", '') <> '') OR
  ("titleOrigin" = 'system' AND "title" = '')
);

ALTER TABLE "SavedItem" DROP COLUMN "searchVector";
ALTER TABLE "SavedItem" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', "title"), 'A') ||
  setweight(to_tsvector('simple', coalesce("metadataTitle", '') || ' ' || coalesce("sharedTitle", '') || ' ' || "searchTags"), 'B') ||
  setweight(to_tsvector('simple', "text" || ' ' || coalesce("metadataDescription", '')), 'C') ||
  setweight(to_tsvector('simple', coalesce("url", '') || ' ' || coalesce("metadataSiteName", '')), 'D')
) STORED;
CREATE INDEX "SavedItem_searchVector_idx" ON "SavedItem" USING GIN ("searchVector");

COMMIT;
