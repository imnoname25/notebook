import { Prisma } from "@/generated/prisma/client";
import { resolveSavedItemTitle } from "@/lib/saved-item-title";
import { db } from "@/lib/db";
import type { SearchFilters } from "@/lib/workspace-search";
import { hashtagQuery } from "@/lib/hashtags";
import { isSimplePrefixSearch } from "@/lib/search-query";

export const SEARCH_QUERY_MAX_LENGTH = 300;
export const SEARCH_PAGE_SIZE = 25;

export type HighlightPart = { text: string; highlight: boolean };
export type SearchResult = {
  type: "page" | "section" | "notebook" | "tag" | "quickNote" | "savedItem";
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor: string;
  notebookIcon: string;
  sectionId?: string;
  sectionTitle?: string;
  updatedAt?: string;
  snippet?: string;
  snippetParts?: HighlightPart[];
  titleParts: HighlightPart[];
};

type SearchRow = {
  type: SearchResult["type"];
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor: string;
  notebookIcon: string;
  sectionId: string | null;
  sectionTitle: string | null;
  snippet: string | null;
  updatedAt: Date;
  savedTitleInput: Parameters<typeof resolveSavedItemTitle>[0] | null;
};

const START = "__NOTEBOOK_HIGHLIGHT_START__";
const STOP = "__NOTEBOOK_HIGHLIGHT_STOP__";

export function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}

export function parseSearchHeadline(value: string | null): HighlightPart[] | undefined {
  if (!value) return undefined;
  const parts: HighlightPart[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(START, cursor);
    if (start < 0) { if (cursor < value.length) parts.push({ text: value.slice(cursor), highlight: false }); break; }
    if (start > cursor) parts.push({ text: value.slice(cursor, start), highlight: false });
    const contentStart = start + START.length;
    const stop = value.indexOf(STOP, contentStart);
    if (stop < 0) { parts.push({ text: value.slice(start), highlight: false }); break; }
    parts.push({ text: value.slice(contentStart, stop), highlight: true });
    cursor = stop + STOP.length;
  }
  return parts.length ? parts : [{ text: value, highlight: false }];
}

export function highlightTitle(title: string, query: string): HighlightPart[] {
  const terms = [...new Set(normalizeSearchQuery(query).split(" ").filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return [{ text: title, highlight: false }];
  const expression = new RegExp(`(${terms.join("|")})`, "iu");
  return title.split(expression).filter(Boolean).map((text) => ({ text, highlight: expression.test(text) }));
}

export async function searchNotebook(userId: string, rawQuery: string, limit = SEARCH_PAGE_SIZE, offset = 0, filters: Partial<SearchFilters> = {}) {
  const normalized = normalizeSearchQuery(rawQuery);
  const queryTag = hashtagQuery(normalized);
  const query = queryTag ? "" : normalized;
  const tags = [...new Set([queryTag, hashtagQuery(`#${filters.tag?.replace(/^#/, "") ?? ""}`)].filter((tag): tag is string => Boolean(tag)))];
  const take = Math.min(Math.max(limit, 1), 30);
  const skip = Math.min(Math.max(offset, 0), 250);
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00Z`) : null;
  const until = filters.dateTo ? new Date(new Date(`${filters.dateTo}T00:00:00Z`).getTime() + 86400000) : null;
  const pageScope = Prisma.sql`
    ${filters.notebookId ? Prisma.sql`AND notebook.id = ${filters.notebookId}` : Prisma.empty}
    ${filters.sectionId ? Prisma.sql`AND section.id = ${filters.sectionId}` : Prisma.empty}
    ${from ? Prisma.sql`AND page."updatedAt" >= ${from}` : Prisma.empty}
    ${until ? Prisma.sql`AND page."updatedAt" < ${until}` : Prisma.empty}
    ${filters.group === "favorites" ? Prisma.sql`AND page."isFavorite" = true` : Prisma.empty}
    ${filters.group === "recent" ? Prisma.sql`AND EXISTS (SELECT 1 FROM "RecentPage" recent WHERE recent."pageId" = page.id AND recent."userId" = ${userId})` : Prisma.empty}
    ${tags.length ? Prisma.join(tags.map(tag => Prisma.sql`AND EXISTS (SELECT 1 FROM "PageTag" link JOIN "Tag" tag ON tag.id = link."tagId" WHERE link."pageId" = page.id AND tag."userId" = ${userId} AND tag.normalized = ${tag})`), " ") : Prisma.empty}
  `;
  const pagesOnly = Boolean(!query || tags.length || filters.dateFrom || filters.dateTo || (filters.group && filters.group !== "all"));
  const tsquery = Prisma.sql`websearch_to_tsquery('simple', ${query}) ${isSimplePrefixSearch(query) ? Prisma.sql`|| coalesce((
    SELECT to_tsquery('simple', string_agg(quote_literal(token) || ':*', ' & '))
    FROM unnest(tsvector_to_array(to_tsvector('simple', ${query}))) AS token
  ), ''::tsquery)` : Prisma.empty}`;
  const savedTitle = Prisma.sql`coalesce(nullif(saved.title, ''), saved."metadataTitle", nullif(left(saved.text, 80), ''), saved.url, 'Сохранённый материал')`;
  const savedSnippet = Prisma.sql`concat_ws(' ', nullif(saved.text, ''), saved."metadataDescription", saved."metadataSiteName", saved.url, nullif(saved."searchTags", ''))`;
  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH search_input AS (
      SELECT ${tsquery} AS query, lower(${query}) AS normalized
    ), ranked AS (
      SELECT 'page'::text AS type, page.id, page.title,
             notebook.id AS "notebookId", notebook.title AS "notebookTitle",
             notebook.color AS "notebookColor", notebook.icon AS "notebookIcon",
             section.id AS "sectionId", section.title AS "sectionTitle",
             CASE WHEN to_tsvector('simple', coalesce(page."searchText", '')) @@ input.query
               THEN ts_headline('simple', page."searchText", input.query,
                 'StartSel=${Prisma.raw(START)}, StopSel=${Prisma.raw(STOP)}, MaxWords=22, MinWords=8, ShortWord=2')
               ELSE left(page."searchText", 180) END AS snippet,
             page."updatedAt" AS "updatedAt",
             CASE WHEN lower(page.title) = input.normalized THEN 600
               WHEN lower(page.title) LIKE input.normalized || '%' THEN 500
               WHEN to_tsvector('simple', page.title) @@ input.query THEN 400 ELSE 300 END AS priority,
             ts_rank_cd(page."searchVector", input.query, 32) AS score,
             CASE WHEN ${filters.group === "recent"} THEN (SELECT recent."lastOpenedAt" FROM "RecentPage" recent WHERE recent."pageId" = page.id AND recent."userId" = ${userId}) ELSE page."updatedAt" END AS recency
      FROM "Page" page
      JOIN "Section" section ON section.id = page."sectionId"
      JOIN "Notebook" notebook ON notebook.id = section."notebookId"
      CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId}
        AND page."deletedAt" IS NULL AND section."deletedAt" IS NULL AND notebook."deletedAt" IS NULL
        AND (${query === ""} OR page."searchVector" @@ input.query OR lower(page.title) LIKE '%' || input.normalized || '%')
        ${pageScope}
      UNION ALL
      SELECT 'section', section.id, section.title, notebook.id, notebook.title, notebook.color, notebook.icon,
             section.id, section.title, NULL, section."updatedAt", 200, ts_rank_cd(section."searchVector", input.query, 32), section."updatedAt"
      FROM "Section" section JOIN "Notebook" notebook ON notebook.id = section."notebookId"
      CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId} AND section."deletedAt" IS NULL AND notebook."deletedAt" IS NULL
        AND ${!pagesOnly} AND (section."searchVector" @@ input.query OR lower(section.title) LIKE '%' || input.normalized || '%')
        ${filters.notebookId ? Prisma.sql`AND notebook.id = ${filters.notebookId}` : Prisma.empty}
        ${filters.sectionId ? Prisma.sql`AND section.id = ${filters.sectionId}` : Prisma.empty}
      UNION ALL
      SELECT 'notebook', notebook.id, notebook.title, notebook.id, notebook.title, notebook.color, notebook.icon,
             NULL, NULL, NULL, notebook."updatedAt", 100, ts_rank_cd(notebook."searchVector", input.query, 32), notebook."updatedAt"
      FROM "Notebook" notebook CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId} AND notebook."deletedAt" IS NULL AND ${!pagesOnly && !filters.sectionId}
        AND (notebook."searchVector" @@ input.query OR lower(notebook.title) LIKE '%' || input.normalized || '%')
        ${filters.notebookId ? Prisma.sql`AND notebook.id = ${filters.notebookId}` : Prisma.empty}
      UNION ALL
      SELECT 'quickNote', note.id, coalesce(nullif(note.title, ''), left(note.body, 80)), '', '', 'default', 'notebook',
             NULL, NULL,
             CASE WHEN ${query !== ""} THEN ts_headline('simple', note.body, input.query,
               'StartSel=${Prisma.raw(START)}, StopSel=${Prisma.raw(STOP)}, MaxWords=22, MinWords=8, ShortWord=2') ELSE left(note.body, 180) END,
             note."updatedAt", 250, 0, note."updatedAt"
      FROM "QuickNote" note CROSS JOIN search_input input
      WHERE note."userId" = ${userId} AND note.status = 'INBOX'
        AND ${!filters.notebookId && !filters.sectionId && (!filters.group || filters.group === "all")}
        AND (${query === ""} OR to_tsvector('simple', note.title || ' ' || note.body) @@ input.query OR lower(note.title) LIKE '%' || input.normalized || '%')
        ${from ? Prisma.sql`AND note."updatedAt" >= ${from}` : Prisma.empty}
        ${until ? Prisma.sql`AND note."updatedAt" < ${until}` : Prisma.empty}
        ${tags.length ? Prisma.join(tags.map(tag => Prisma.sql`AND EXISTS (SELECT 1 FROM "QuickNoteTag" link JOIN "Tag" tag ON tag.id = link."tagId" WHERE link."quickNoteId" = note.id AND tag."userId" = ${userId} AND tag.normalized = ${tag})`), " ") : Prisma.empty}
      UNION ALL
      SELECT 'savedItem', saved.id, ${savedTitle}, '', '', 'default', 'notebook', NULL, NULL,
             CASE WHEN ${query !== ""} THEN ts_headline('simple', ${savedSnippet}, input.query,
               'StartSel=${Prisma.raw(START)}, StopSel=${Prisma.raw(STOP)}, MaxWords=22, MinWords=8, ShortWord=2')
               ELSE left(${savedSnippet}, 180) END,
             saved."updatedAt", 260, ts_rank_cd(saved."searchVector", input.query, 32), saved."updatedAt"
      FROM "SavedItem" saved CROSS JOIN search_input input
      WHERE saved."userId" = ${userId} AND saved."archivedAt" IS NULL
        AND ${!filters.notebookId && !filters.sectionId && (!filters.group || filters.group === "all")}
        AND (${query === ""} OR saved."searchVector" @@ input.query)
        ${from ? Prisma.sql`AND saved."updatedAt" >= ${from}` : Prisma.empty}
        ${until ? Prisma.sql`AND saved."updatedAt" < ${until}` : Prisma.empty}
        ${tags.length ? Prisma.join(tags.map(tag => Prisma.sql`AND EXISTS (SELECT 1 FROM "SavedItemTag" link JOIN "Tag" tag ON tag.id = link."tagId" WHERE link."savedItemId" = saved.id AND tag."userId" = ${userId} AND tag.normalized = ${tag})`), " ") : Prisma.empty}
    )
    SELECT result.*, CASE WHEN result.type = 'savedItem' THEN (
      SELECT jsonb_build_object(
        'title', saved.title, 'titleOrigin', saved."titleOrigin", 'sharedTitle', saved."sharedTitle",
        'metadataTitle', saved."metadataTitle", 'text', saved.text, 'url', saved.url,
        'fileName', (SELECT upload."originalName" FROM "SavedItemAttachment" attachment
          JOIN "Upload" upload ON upload.id = attachment."uploadId" AND upload."userId" = saved."userId"
          WHERE attachment."savedItemId" = saved.id ORDER BY attachment.position LIMIT 1)
      ) FROM "SavedItem" saved WHERE saved.id = result.id AND saved."userId" = ${userId}
    ) END AS "savedTitleInput"
    FROM (
      SELECT * FROM ranked ORDER BY priority DESC, score DESC, recency DESC, title ASC, id ASC
      LIMIT ${take + 1} OFFSET ${skip}
    ) result
    ORDER BY priority DESC, score DESC, recency DESC, title ASC, id ASC
  `);
  return { results: rows.slice(0, take).map((row): SearchResult => {
    const title = row.savedTitleInput ? resolveSavedItemTitle(row.savedTitleInput) : row.title;
    return {
      type: row.type, id: row.id, title, titleParts: highlightTitle(title, query),
      notebookId: row.notebookId, notebookTitle: row.notebookTitle, notebookColor: row.notebookColor, notebookIcon: row.notebookIcon,
      ...(row.sectionId ? { sectionId: row.sectionId } : {}), ...(row.sectionTitle ? { sectionTitle: row.sectionTitle } : {}),
      ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
      ...(row.snippet ? { snippet: row.snippet.replaceAll(START, "").replaceAll(STOP, ""), snippetParts: parseSearchHeadline(row.snippet) } : {}),
    };
  }), nextOffset: rows.length > take && skip + take <= 250 ? skip + take : null };
}
