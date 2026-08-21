CREATE TYPE "QuickNoteStatus" AS ENUM ('INBOX', 'ARCHIVED', 'CONVERTED');

ALTER TABLE "QuickNote" ADD COLUMN "status" "QuickNoteStatus" NOT NULL DEFAULT 'INBOX';
UPDATE "QuickNote" SET "status" = 'ARCHIVED' WHERE "archivedAt" IS NOT NULL;

DROP INDEX "QuickNote_userId_archivedAt_isPinned_updatedAt_idx";
CREATE INDEX "QuickNote_userId_status_isPinned_updatedAt_idx" ON "QuickNote"("userId", "status", "isPinned", "updatedAt");

CREATE TABLE "QuickNoteTag" (
  "quickNoteId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "QuickNoteTag_pkey" PRIMARY KEY ("quickNoteId", "tagId")
);

CREATE TABLE "PageLink" (
  "sourcePageId" TEXT NOT NULL,
  "targetPageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageLink_pkey" PRIMARY KEY ("sourcePageId", "targetPageId")
);

CREATE INDEX "QuickNoteTag_tagId_quickNoteId_idx" ON "QuickNoteTag"("tagId", "quickNoteId");
CREATE INDEX "PageLink_targetPageId_sourcePageId_idx" ON "PageLink"("targetPageId", "sourcePageId");

ALTER TABLE "QuickNoteTag" ADD CONSTRAINT "QuickNoteTag_quickNoteId_fkey" FOREIGN KEY ("quickNoteId") REFERENCES "QuickNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickNoteTag" ADD CONSTRAINT "QuickNoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill tags for quick notes created before this migration.
WITH extracted AS (
  SELECT DISTINCT q."userId", lower(matches.value[1]) AS normalized, matches.value[1] AS name
  FROM "QuickNote" q
  CROSS JOIN LATERAL regexp_matches(q.title || ' ' || q.body, '(?:^|[^[:alnum:]_])#([[:alnum:]][[:alnum:]_-]{0,63})', 'g') AS matches(value)
)
INSERT INTO "Tag" (id, "userId", name, normalized, "createdAt")
SELECT 'tag_' || md5("userId" || ':' || normalized), "userId", min(name), normalized, CURRENT_TIMESTAMP
FROM extracted
GROUP BY "userId", normalized
ON CONFLICT ("userId", normalized) DO NOTHING;

WITH quick_note_tags AS (
  SELECT DISTINCT q.id AS "quickNoteId", q."userId", lower(matches.value[1]) AS normalized
  FROM "QuickNote" q
  CROSS JOIN LATERAL regexp_matches(q.title || ' ' || q.body, '(?:^|[^[:alnum:]_])#([[:alnum:]][[:alnum:]_-]{0,63})', 'g') AS matches(value)
)
INSERT INTO "QuickNoteTag" ("quickNoteId", "tagId")
SELECT quick_note_tags."quickNoteId", tag.id
FROM quick_note_tags
JOIN "Tag" tag ON tag."userId" = quick_note_tags."userId" AND tag.normalized = quick_note_tags.normalized
ON CONFLICT DO NOTHING;

-- Existing internal links are safe to index only when source and target have the same owner.
WITH extracted_links AS (
  SELECT DISTINCT source.id AS "sourcePageId", matches.value[1] AS "targetPageId", source_notebook."userId"
  FROM "Page" source
  JOIN "Section" source_section ON source_section.id = source."sectionId"
  JOIN "Notebook" source_notebook ON source_notebook.id = source_section."notebookId"
  CROSS JOIN LATERAL regexp_matches(source.content::text, '/pages/([A-Za-z0-9_-]+)', 'g') AS matches(value)
)
INSERT INTO "PageLink" ("sourcePageId", "targetPageId", "createdAt")
SELECT links."sourcePageId", target.id, CURRENT_TIMESTAMP
FROM extracted_links links
JOIN "Page" target ON target.id = links."targetPageId" AND target.id <> links."sourcePageId"
JOIN "Section" target_section ON target_section.id = target."sectionId"
JOIN "Notebook" target_notebook ON target_notebook.id = target_section."notebookId" AND target_notebook."userId" = links."userId"
ON CONFLICT DO NOTHING;
