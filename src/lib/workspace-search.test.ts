import { describe, expect, it } from "vitest";
import { canSearch, EMPTY_SEARCH, searchFromUrl, searchHref, workspaceSearchSchema } from "./workspace-search";
import { searchRequestSchema } from "./validation";

describe("workspace search URLs and API input", () => {
  it("round-trips Cyrillic query and all filters without a fake page ID", () => {
    const state = { ...EMPTY_SEARCH, q: "резервное копирование & сеть", notebookId: "book", sectionId: "section", tag: "#сервер", dateFrom: "2026-10-01", dateTo: "2026-10-27", group: "favorites" as const };
    expect(searchFromUrl(searchHref(state))).toEqual(state);
    expect(searchFromUrl("/pages/book")).toBeNull();
    expect(searchFromUrl("/app?view=today")).toBeNull();
  });
  it("does not fetch the library for an empty query or one character", () => {
    expect(canSearch(EMPTY_SEARCH)).toBe(false);
    expect(canSearch({ ...EMPTY_SEARCH, q: "a" })).toBe(false);
    expect(canSearch({ ...EMPTY_SEARCH, q: "сервер" })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, group: "recent" })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, notebookId: "book" })).toBe(true);
  });
  it("bounds text, pagination, IDs and dates", () => {
    expect(searchRequestSchema.safeParse({ q: "x".repeat(301) }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ q: "ok", offset: 251 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ q: "ok", dateFrom: "2026-10-27", dateTo: "2026-10-01" }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ q: "ok", dateFrom: "2026-02-30" }).success).toBe(false);
    expect(workspaceSearchSchema.safeParse({ tag: "two tags" }).success).toBe(false);
    expect(searchFromUrl("/app?view=search&group=invalid")).toEqual(EMPTY_SEARCH);
  });
});
