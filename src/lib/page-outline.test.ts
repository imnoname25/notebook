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
  it("includes headings nested in collapsible groups and tab panels", () => {
    expect(extractPageOutline([
      { id: "group", type: "toggleListItem", children: [{ id: "inside-collapse", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "VPN" }] }] },
      { id: "tabs", type: "tabs", children: [{ id: "linux", type: "tabPanel", props: { label: "Linux" }, children: [{ id: "inside-tab", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Docker" }] }] }] },
    ])).toEqual([
      { id: "inside-collapse", title: "VPN", level: 2 },
      { id: "inside-tab", title: "Docker", level: 3 },
    ]);
  });
});
