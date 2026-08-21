import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { hashtagQuery } from "@/lib/hashtags";

export const SEARCH_QUERY_MAX_LENGTH = 300;
export const SEARCH_PAGE_SIZE = 25;

export type HighlightPart = { text: string; highlight: boolean };
export type SearchResult = {
  type: "page" | "section" | "notebook" | "tag" | "quickNote";
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor: string;
  notebookIcon: string;
  sectionId?: string;
  sectionTitle?: string;
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

export async function searchNotebook(userId: string, rawQuery: string, limit = SEARCH_PAGE_SIZE, offset = 0) {
  const query = normalizeSearchQuery(rawQuery);
  const take = Math.min(Math.max(limit, 1), 30);
  const skip = Math.min(Math.max(offset, 0), 250);
  const tag = hashtagQuery(query);
  if (tag) {
    const matchedTag = await db.tag.findFirst({
      where: { userId, normalized: tag },
      select: {
        name: true, normalized: true,
        pages: {
          where: { page: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } },
          orderBy: { page: { updatedAt: "desc" } },
          take,
          select: { page: { select: { id: true, title: true, searchText: true, section: { select: { id: true, title: true, notebook: { select: { id: true, title: true, color: true, icon: true } } } } } } },
        },
        quickNotes: {
          where: { quickNote: { userId, status: "INBOX" } },
          orderBy: { quickNote: { updatedAt: "desc" } },
          take,
          select: { quickNote: { select: { id: true, title: true, body: true } } },
        },
      },
    });
    const pages = matchedTag?.pages.map(({ page }) => page) ?? [];
    const quickNotes = matchedTag?.quickNotes.map(({ quickNote }) => quickNote) ?? [];
    const tagResults: SearchResult[] = matchedTag ? [{ type: "tag", id: matchedTag.normalized, title: `#${matchedTag.name}`, titleParts: highlightTitle(`#${matchedTag.name}`, query), notebookId: "", notebookTitle: "", notebookColor: "default", notebookIcon: "notebook" }] : [];
    return {
      results: [...tagResults, ...pages.map((page): SearchResult => ({
        type: "page",
        id: page.id,
        title: page.title,
        titleParts: highlightTitle(page.title, `#${tag}`),
        notebookId: page.section.notebook.id,
        notebookTitle: page.section.notebook.title,
        notebookColor: page.section.notebook.color,
        notebookIcon: page.section.notebook.icon,
        sectionId: page.section.id,
        sectionTitle: page.section.title,
        snippet: page.searchText.slice(0, 180),
      })), ...quickNotes.map((note): SearchResult => ({
        type: "quickNote", id: note.id,
        title: note.title || note.body.split(/\s+/).slice(0, 6).join(" "),
        titleParts: highlightTitle(note.title || note.body, query),
        notebookId: "", notebookTitle: "", notebookColor: "default", notebookIcon: "notebook",
        snippet: note.body.slice(0, 180),
      }))].slice(skip, skip + take),
      nextOffset: null,
    };
  }
  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH search_input AS (
      SELECT websearch_to_tsquery('simple', ${query}) AS query,
             lower(${query}) AS normalized
    ), ranked AS (
      SELECT 'page'::text AS type, page.id, page.title,
             notebook.id AS "notebookId", notebook.title AS "notebookTitle",
             notebook.color AS "notebookColor", notebook.icon AS "notebookIcon",
             section.id AS "sectionId", section.title AS "sectionTitle",
             CASE WHEN to_tsvector('simple', coalesce(page."searchText", '')) @@ input.query
               THEN ts_headline('simple', page."searchText", input.query,
                 'StartSel=${Prisma.raw(START)}, StopSel=${Prisma.raw(STOP)}, MaxWords=22, MinWords=8, ShortWord=2')
               ELSE NULL END AS snippet,
             CASE
               WHEN lower(page.title) = input.normalized THEN 600
               WHEN lower(page.title) LIKE input.normalized || '%' THEN 500
               WHEN to_tsvector('simple', page.title) @@ input.query THEN 400
               ELSE 300
             END AS priority,
             ts_rank_cd(page."searchVector", input.query, 32) AS score,
             page."updatedAt" AS recency
      FROM "Page" page
      JOIN "Section" section ON section.id = page."sectionId"
      JOIN "Notebook" notebook ON notebook.id = section."notebookId"
      CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId}
        AND page."deletedAt" IS NULL AND section."deletedAt" IS NULL AND notebook."deletedAt" IS NULL
        AND (page."searchVector" @@ input.query OR lower(page.title) LIKE '%' || input.normalized || '%')
      UNION ALL
      SELECT 'section', section.id, section.title,
             notebook.id, notebook.title, notebook.color, notebook.icon,
             section.id, section.title, NULL,
             200, ts_rank_cd(section."searchVector", input.query, 32), section."updatedAt"
      FROM "Section" section
      JOIN "Notebook" notebook ON notebook.id = section."notebookId"
      CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId}
        AND section."deletedAt" IS NULL AND notebook."deletedAt" IS NULL
        AND (section."searchVector" @@ input.query OR lower(section.title) LIKE '%' || input.normalized || '%')
      UNION ALL
      SELECT 'notebook', notebook.id, notebook.title,
             notebook.id, notebook.title, notebook.color, notebook.icon,
             NULL, NULL, NULL,
             100, ts_rank_cd(notebook."searchVector", input.query, 32), notebook."updatedAt"
      FROM "Notebook" notebook
      CROSS JOIN search_input input
      WHERE notebook."userId" = ${userId} AND notebook."deletedAt" IS NULL
        AND (notebook."searchVector" @@ input.query OR lower(notebook.title) LIKE '%' || input.normalized || '%')
    )
    SELECT type, id, title, "notebookId", "notebookTitle", "notebookColor", "notebookIcon",
           "sectionId", "sectionTitle", snippet
    FROM ranked
    ORDER BY priority DESC, score DESC, recency DESC, title ASC
    LIMIT ${take + 1} OFFSET ${skip}
  `);
  const page = rows.slice(0, take).map((row): SearchResult => ({
    type: row.type,
    id: row.id,
    title: row.title,
    titleParts: highlightTitle(row.title, query),
    notebookId: row.notebookId,
    notebookTitle: row.notebookTitle,
    notebookColor: row.notebookColor,
    notebookIcon: row.notebookIcon,
    ...(row.sectionId ? { sectionId: row.sectionId } : {}),
    ...(row.sectionTitle ? { sectionTitle: row.sectionTitle } : {}),
    ...(row.snippet ? { snippet: row.snippet.replaceAll(START, "").replaceAll(STOP, ""), snippetParts: parseSearchHeadline(row.snippet) } : {}),
  }));
  return { results: page, nextOffset: rows.length > take ? skip + take : null };
}
