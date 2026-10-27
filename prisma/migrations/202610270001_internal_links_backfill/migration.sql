-- Repair the derived index only. Never rewrite Page content or create versions.
BEGIN;
CREATE TEMP TABLE notebook_link_backfill ON COMMIT DROP AS
SELECT DISTINCT source.id AS source_id, target.id AS target_id
FROM "Page" source
JOIN "Section" ss ON ss.id = source."sectionId"
JOIN "Notebook" sn ON sn.id = ss."notebookId"
CROSS JOIN LATERAL jsonb_path_query(source.content, 'strict $.** ? (@.type == "link" || @.type == "pageLink")') node
JOIN "Page" target ON target.id = CASE WHEN node->>'type' = 'pageLink'
  THEN CASE WHEN node->'props'->>'pageId' ~ '^[A-Za-z0-9_-]{1,200}$' THEN node->'props'->>'pageId' END
  ELSE substring(node->>'href' from '^/pages/([A-Za-z0-9_-]+)(?:[?#].*)?$') END
JOIN "Section" ts ON ts.id = target."sectionId"
JOIN "Notebook" tn ON tn.id = ts."notebookId" AND tn."userId" = sn."userId"
WHERE source.id <> target.id;
DELETE FROM "PageLink" link WHERE NOT EXISTS (SELECT 1 FROM notebook_link_backfill expected WHERE expected.source_id = link."sourcePageId" AND expected.target_id = link."targetPageId");
INSERT INTO "PageLink" ("sourcePageId", "targetPageId", "createdAt") SELECT source_id, target_id, CURRENT_TIMESTAMP FROM notebook_link_backfill ON CONFLICT DO NOTHING;
COMMIT;
