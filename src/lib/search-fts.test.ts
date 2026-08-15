import { describe, expect, it } from "vitest";
import { highlightTitle, normalizeSearchQuery, parseSearchHeadline } from "@/lib/services/search-service";

describe("FTS helpers", () => {
  it("normalizes whitespace and bounds user input", () => { expect(normalizeSearchQuery("  docker\n  backup  ")).toBe("docker backup"); expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(300); });
  it("converts trusted headline markers to safe text parts", () => { expect(parseSearchHeadline("до __NOTEBOOK_HIGHLIGHT_START__PostgreSQL__NOTEBOOK_HIGHLIGHT_STOP__ после")).toEqual([{ text: "до ", highlight: false }, { text: "PostgreSQL", highlight: true }, { text: " после", highlight: false }]); });
  it("highlights title terms without producing HTML", () => { const parts = highlightTitle("<PostgreSQL> backup", "postgr"); expect(parts.some((part) => part.highlight && part.text === "Postgr")).toBe(true); expect(parts.map((part) => part.text).join("")).toBe("<PostgreSQL> backup"); });
});
