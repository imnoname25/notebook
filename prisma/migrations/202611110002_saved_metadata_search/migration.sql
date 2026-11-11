BEGIN;

ALTER TABLE "SavedItem"
  ADD COLUMN "metadataTitle" TEXT,
  ADD COLUMN "metadataDescription" TEXT,
  ADD COLUMN "metadataSiteName" TEXT,
  ADD COLUMN "metadataImageUrl" TEXT,
  ADD COLUMN "searchTags" TEXT NOT NULL DEFAULT '';

UPDATE "SavedItem" AS item
SET "searchTags" = labels.names
FROM (
  SELECT link."savedItemId", string_agg(tag.normalized, ' ' ORDER BY tag.normalized) AS names
  FROM "SavedItemTag" AS link
  JOIN "Tag" AS tag ON tag.id = link."tagId"
  GROUP BY link."savedItemId"
) AS labels
WHERE item.id = labels."savedItemId";

ALTER TABLE "SavedItem" DROP COLUMN "searchVector";
ALTER TABLE "SavedItem" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', "title"), 'A') ||
  setweight(to_tsvector('simple', coalesce("metadataTitle", '') || ' ' || "searchTags"), 'B') ||
  setweight(to_tsvector('simple', "text" || ' ' || coalesce("metadataDescription", '')), 'C') ||
  setweight(to_tsvector('simple', coalesce("url", '') || ' ' || coalesce("metadataSiteName", '')), 'D')
) STORED;
CREATE INDEX "SavedItem_searchVector_idx" ON "SavedItem" USING GIN ("searchVector");

COMMIT;
