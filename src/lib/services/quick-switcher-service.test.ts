import { describe, expect, it } from "vitest";
import type { SearchResult } from "./search-service";
import { rankQuickSwitcherResults } from "../quick-switcher";

const item = (id: string, title: string): SearchResult => ({ type: "page", id, title, titleParts: [{ text: title, highlight: false }], notebookId: "n", notebookTitle: "N", notebookColor: "default", notebookIcon: "notebook", sectionId: "s", sectionTitle: "S" });
describe("quick switcher ranking", () => {
  it("puts exact titles first, then recent, then favorites", () => {
    const ranked = rankQuickSwitcherResults([item("normal", "Other"), item("favorite", "Favorite"), item("recent", "Recent"), item("exact", "Target")], "target", new Set(["recent"]), new Set(["favorite"]));
    expect(ranked.map(({ id }) => id)).toEqual(["exact", "recent", "favorite", "normal"]);
  });
});
