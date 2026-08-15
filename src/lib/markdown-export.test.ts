import { describe, expect, it } from "vitest";
import { blockNoteToMarkdown } from "./markdown-export";

describe("BlockNote Markdown export", () => {
  it("exports headings, formatted text, lists, links, quotes, code, images and tables", () => {
    const markdown = blockNoteToMarkdown("Title", [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Heading", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "Bold", styles: { bold: true } }] },
      { type: "quote", content: [{ type: "link", href: "https://example.test", content: [{ type: "text", text: "Link", styles: {} }] }] },
      { type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const x = 1", styles: {} }] },
      { type: "image", props: { url: "/api/uploads/a", caption: "Image" } },
      { type: "table", content: { rows: [{ cells: [{ content: [{ type: "text", text: "A", styles: {} }] }, { content: [{ type: "text", text: "B", styles: {} }] }] }] } },
    ]);
    expect(markdown).toContain("# Title"); expect(markdown).toContain("## Heading"); expect(markdown).toContain("- **Bold**"); expect(markdown).toContain("> [Link]"); expect(markdown).toContain("```ts"); expect(markdown).toContain("![Image]"); expect(markdown).toContain("| A | B |");
  });
});
