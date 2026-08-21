-- Quick capture notes remain outside Notebook content until explicitly converted.
CREATE TABLE "QuickNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'amber',
    "icon" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuickNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageTag" (
    "pageId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "PageTag_pkey" PRIMARY KEY ("pageId","tagId")
);

CREATE INDEX "QuickNote_userId_archivedAt_isPinned_updatedAt_idx" ON "QuickNote"("userId", "archivedAt", "isPinned", "updatedAt");
CREATE UNIQUE INDEX "Tag_userId_normalized_key" ON "Tag"("userId", "normalized");
CREATE INDEX "Tag_userId_name_idx" ON "Tag"("userId", "name");
CREATE INDEX "PageTag_tagId_pageId_idx" ON "PageTag"("tagId", "pageId");
ALTER TABLE "QuickNote" ADD CONSTRAINT "QuickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTag" ADD CONSTRAINT "PageTag_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTag" ADD CONSTRAINT "PageTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the derived tag index for existing active and deleted pages alike.
WITH extracted AS (
  SELECT DISTINCT n."userId", lower(matches.value[1]) AS normalized, matches.value[1] AS name
  FROM "Page" p
  JOIN "Section" s ON s.id = p."sectionId"
  JOIN "Notebook" n ON n.id = s."notebookId"
  CROSS JOIN LATERAL regexp_matches(p.title || ' ' || coalesce(p."searchText", ''), '(?:^|[^[:alnum:]_])#([[:alnum:]][[:alnum:]_-]{0,63})', 'g') AS matches(value)
)
INSERT INTO "Tag" (id, "userId", name, normalized, "createdAt")
SELECT 'tag_' || md5("userId" || ':' || normalized), "userId", min(name), normalized, CURRENT_TIMESTAMP
FROM extracted
GROUP BY "userId", normalized
ON CONFLICT ("userId", normalized) DO NOTHING;

WITH page_tags AS (
  SELECT DISTINCT p.id AS "pageId", n."userId", lower(matches.value[1]) AS normalized
  FROM "Page" p
  JOIN "Section" s ON s.id = p."sectionId"
  JOIN "Notebook" n ON n.id = s."notebookId"
  CROSS JOIN LATERAL regexp_matches(p.title || ' ' || coalesce(p."searchText", ''), '(?:^|[^[:alnum:]_])#([[:alnum:]][[:alnum:]_-]{0,63})', 'g') AS matches(value)
)
INSERT INTO "PageTag" ("pageId", "tagId")
SELECT page_tags."pageId", tag.id
FROM page_tags
JOIN "Tag" tag ON tag."userId" = page_tags."userId" AND tag.normalized = page_tags.normalized
ON CONFLICT DO NOTHING;
