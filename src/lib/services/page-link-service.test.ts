import { describe, expect, it } from "vitest";
import { rankRelatedPages } from "./page-link-service";

describe("related page ranking", () => {
  it("uses deterministic direct, backlink, tag and section weights", () => {
    const now = new Date("2026-08-21T10:00:00Z");
    const ranked = rankRelatedPages([
      { id: "same-section", updatedAt: now, sameSection: true, sharedTagCount: 0, directlyLinked: false, linksBack: false },
      { id: "shared-tags", updatedAt: now, sameSection: false, sharedTagCount: 2, directlyLinked: false, linksBack: false },
      { id: "backlink", updatedAt: now, sameSection: false, sharedTagCount: 0, directlyLinked: false, linksBack: true },
      { id: "direct", updatedAt: now, sameSection: false, sharedTagCount: 0, directlyLinked: true, linksBack: false },
    ]);
    expect(ranked.map(({ id, score }) => [id, score])).toEqual([
      ["direct", 5], ["shared-tags", 4], ["backlink", 3], ["same-section", 1],
    ]);
  });

  it("drops unrelated candidates and uses recency as a stable tie-breaker", () => {
    const ranked = rankRelatedPages([
      { id: "old", updatedAt: new Date("2026-01-01"), sameSection: true, sharedTagCount: 0, directlyLinked: false, linksBack: false },
      { id: "new", updatedAt: new Date("2026-02-01"), sameSection: true, sharedTagCount: 0, directlyLinked: false, linksBack: false },
      { id: "none", updatedAt: new Date(), sameSection: false, sharedTagCount: 0, directlyLinked: false, linksBack: false },
    ]);
    expect(ranked.map(({ id }) => id)).toEqual(["new", "old"]);
  });
});
