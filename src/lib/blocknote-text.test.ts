import { describe, expect, it } from "vitest";
import { createSearchSnippet, extractBlockNoteText } from "./blocknote-text";

describe("BlockNote search normalization", () => {
  it("extracts nested inline and table text without serializing structural props", () => {
    const content = [{ type: "paragraph", props: { textColor: "red" }, content: [{ type: "text", text: "Первый абзац", styles: { bold: true } }] }, { type: "table", content: { rows: [{ cells: [[{ type: "text", text: "Ячейка" }]] }] } }];
    expect(extractBlockNoteText(content)).toBe("Первый абзац Ячейка");
  });

  it("normalizes whitespace and safely handles invalid input", () => {
    expect(extractBlockNoteText({ content: [{ text: "  много   пробелов " }, { text: "здесь" }] })).toBe("много пробелов здесь");
    expect(extractBlockNoteText(null)).toBe("");
  });

  it("creates a bounded snippet around the match", () => {
    const snippet = createSearchSnippet(`${"a".repeat(100)} needle ${"b".repeat(100)}`, "needle", 20);
    expect(snippet).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("indexes nested tabs and collapse content without derived TOC duplication", () => {
    const content = [
      { type: "tabs", children: [{ type: "tabPanel", props: { label: "Linux" }, children: [{ type: "paragraph", content: [{ type: "text", text: "Docker compose" }] }] }] },
      { type: "toggleListItem", content: [{ type: "text", text: "VPN" }], children: [{ type: "paragraph", content: [{ type: "text", text: "WireGuard" }] }] },
      { type: "tableOfContents", props: { title: "Оглавление" } },
    ];
    expect(extractBlockNoteText(content)).toBe("Linux Docker compose VPN WireGuard");
  });
});
