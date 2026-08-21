import { describe, expect, it } from "vitest";
import { blockNoteToMarkdown } from "./markdown-export";

describe("BlockNote Markdown export", () => {
  it("exports headings, formatted text, lists, links, quotes, code, images and tables", () => {
    const markdown = blockNoteToMarkdown("Title", [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Heading", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "Bold", styles: { bold: true } }] },
      { type: "quote", content: [{ type: "link", href: "https://example.test", content: [{ type: "text", text: "Link", styles: {} }] }] },
      { type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const x = 1", styles: {} }] },
      { type: "bookmark", props: { url: "https://example.com", title: "Example", description: "Reference" } },
      { type: "image", props: { url: "/api/uploads/a", caption: "Image" } },
      { type: "table", content: { rows: [{ cells: [{ content: [{ type: "text", text: "A", styles: {} }] }, { content: [{ type: "text", text: "B", styles: {} }] }] }] } },
    ]);
    expect(markdown).toContain("# Title"); expect(markdown).toContain("## Heading"); expect(markdown).toContain("- **Bold**"); expect(markdown).toContain("> [Link]"); expect(markdown).toContain("```ts"); expect(markdown).toContain("![Image]"); expect(markdown).toContain("| A | B |"); expect(markdown).toContain("[Example](https://example.com)");
  });
  it("linearizes tabs and collapse without losing nested content", () => {
    const markdown = blockNoteToMarkdown("Runbook", [
      { type: "divider", props: { style: "label" }, content: [{ type: "text", text: "Infrastructure" }] },
      { type: "toggleListItem", content: [{ type: "text", text: "VPN" }], children: [{ type: "paragraph", content: [{ type: "text", text: "Secret-free instructions" }] }] },
      { type: "tabs", children: [
        { type: "tabPanel", props: { label: "Windows" }, children: [{ type: "paragraph", content: [{ type: "text", text: "PowerShell" }] }] },
        { type: "tabPanel", props: { label: "Linux" }, children: [{ type: "paragraph", content: [{ type: "text", text: "bash" }] }] },
      ] },
      { type: "columns", children: [{ type: "columnPanel", children: [{ type: "paragraph", content: [{ type: "text", text: "Left column" }] }] }, { type: "columnPanel", children: [{ type: "paragraph", content: [{ type: "text", text: "Right column" }] }] }] },
      { type: "pageVariables", props: { data: "[{\"name\":\"host\",\"value\":\"private\"}]" } },
    ]);
    expect(markdown).toContain("--- **Infrastructure** ---");
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("Secret-free instructions");
    expect(markdown).toContain("## Windows");
    expect(markdown).toContain("## Linux");
    expect(markdown.indexOf("Left column")).toBeLessThan(markdown.indexOf("Right column"));
    expect(markdown).not.toContain("private");
  });
});
