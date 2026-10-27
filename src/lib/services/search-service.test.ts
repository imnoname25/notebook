import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: query } }));
import { searchNotebook } from "./search-service";

describe("unified search query boundary", () => {
  beforeEach(() => query.mockReset().mockResolvedValue([]));
  it("binds filters and ownership as parameters, including tag ownership", async () => {
    await searchNotebook("owner", "needle", 25, 0, { notebookId: "book'); DROP TABLE x;--", sectionId: "section", tag: "сервер", group: "favorites", dateFrom: "2026-10-01", dateTo: "2026-10-27" });
    const sql = query.mock.calls[0]![0] as { text: string; values: unknown[] };
    expect(sql.text).not.toContain("DROP TABLE");
    expect(sql.values).toContain("book'); DROP TABLE x;--");
    expect(sql.values).toContain("owner"); expect(sql.values).toContain("сервер");
    expect(sql.text).toContain('tag."userId" =');
    expect(sql.text).toContain('note."userId" =');
    expect(sql.text).toContain('page."isFavorite" = true');
    expect(sql.values).toContainEqual(new Date("2026-10-28T00:00:00Z"));
  });
  it("returns safe text highlights and an ISO update date", async () => {
    query.mockResolvedValue([{ type: "page", id: "p", title: "Docker <script>", notebookId: "b", notebookTitle: "Book", notebookColor: "default", notebookIcon: "notebook", sectionId: "s", sectionTitle: "Section", snippet: "before __NOTEBOOK_HIGHLIGHT_START__Docker__NOTEBOOK_HIGHLIGHT_STOP__ <img>", updatedAt: new Date("2026-10-27T00:00:00Z") }]);
    const result = (await searchNotebook("owner", "Docker")).results[0]!;
    expect(result.updatedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(result.snippetParts).toContainEqual({ text: "Docker", highlight: true });
    expect(result.snippet).toBe("before Docker <img>");
  });
  it("bounds pagination and does not return a repeating cursor at the cap", async () => {
    const row = { type: "page", title: "Note", notebookId: "b", notebookTitle: "Book", notebookColor: "default", notebookIcon: "notebook" };
    query.mockResolvedValue(Array.from({ length: 26 }, (_, index) => ({ ...row, id: String(index) })));
    expect((await searchNotebook("owner", "Note", 25, 0)).nextOffset).toBe(25);
    expect((await searchNotebook("owner", "Note", 25, 250)).nextOffset).toBeNull();
  });
});
