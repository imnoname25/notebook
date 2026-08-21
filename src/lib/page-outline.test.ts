import { describe, expect, it } from "vitest";
import { extractPageOutline } from "./page-outline";

describe("page outline", () => {
  it("extracts H1-H3 with stable BlockNote identifiers", () => {
    expect(extractPageOutline([
      { id: "intro", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Введение" }] },
      { id: "body", type: "paragraph", content: [{ type: "text", text: "Текст" }] },
      { id: "details", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Детали" }] },
    ])).toEqual([{ id: "intro", title: "Введение", level: 1 }, { id: "details", title: "Детали", level: 3 }]);
  });
  it("returns an empty outline without headings", () => {
    expect(extractPageOutline([{ type: "paragraph", content: [] }])).toEqual([]);
  });
});
