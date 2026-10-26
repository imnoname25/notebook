import { describe, expect, it } from "vitest";
import { blockNoteToSafeHtml } from "./html-export";
import { blockNoteToMarkdown } from "./markdown-export";
import { extractPageOutline } from "./page-outline";
import { unsupportedEditorBlocks } from "./editor-compatibility";
import { blockNoteContentSchema } from "./data-format";
import { rewriteAttachmentReferences } from "./portable-content";

const leaf = { type: "paragraph", content: [{ type: "text", text: "Hidden child <script>safe text</script>", styles: { bold: true } }] };
describe("Editor 3.0 content integrity", () => {
  it.each(["heading", "quote", "checkListItem", "bulletListItem", "numberedListItem", "callout", "banner", "codeBlock", "table"])("exports children of %s exactly once", type => {
    const doc = [{ type, props: { level: 4, isToggleable: true, kind: "warning" }, content: [{ type: "text", text: "Parent" }], children: [leaf] }];
    const html = blockNoteToSafeHtml(doc, () => null);
    expect(html.match(/Hidden child/g)).toHaveLength(1);
    expect(html).toContain("&lt;script&gt;safe text&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(blockNoteToMarkdown("Document", doc)).toContain("Hidden child");
  });
  it("exports a toggle heading with its actual level and all descendants", () => {
    const html = blockNoteToSafeHtml([{ type: "heading", props: { level: 6, isToggleable: true }, content: "Summary", children: [leaf] }], () => null);
    expect(html).toContain("<details open><summary><h6>Summary</h6></summary>");
    expect(extractPageOutline([{ id: "h6", type: "heading", props: { level: 6 }, content: [{ type: "text", text: "Deep" }] }])).toEqual([{ id: "h6", title: "Deep", level: 6 }]);
  });
  it("escapes raw HTML in Markdown details summaries", () => {
    expect(blockNoteToMarkdown("Test", [{ type: "toggle", content: "<img src=x onerror=alert(1)>", children: [leaf] }])).toContain("<summary>&lt;img src=x onerror=alert(1)&gt;</summary>");
  });
  it("keeps code whitespace and uses a fence longer than user backticks", () => {
    const text = "  function demo() {\n\treturn `hello`;\n}\n```\n";
    const markdown = blockNoteToMarkdown("Test", [{ type: "codeBlock", props: { language: "typescript" }, content: [{ type: "text", text, styles: { bold: true } }] }]);
    expect(markdown).toContain("````typescript\n" + text + "\n````");
  });
  it("escapes HTML prose and rejects executable Markdown link schemes", () => {
    const markdown = blockNoteToMarkdown("<script>title</script>", [{ type: "paragraph", content: [{ type: "text", text: "<img src=x>" }, { type: "link", href: "javascript:alert(1)", content: "label" }] }]);
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("<img");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).toContain("&lt;img src=x&gt;");
  });
  it("guards nested unknown blocks without rewriting JSON or portable metadata", () => {
    const doc = [{ type: "heading", children: [{ type: "future-widget", props: { opaque: { untouched: true }, url: "/api/uploads/upload1" }, children: [leaf] }] }];
    const before = structuredClone(doc);
    expect(unsupportedEditorBlocks(doc)).toEqual(["future-widget"]);
    const validated = blockNoteContentSchema.parse(JSON.parse(JSON.stringify(doc)));
    const exported = rewriteAttachmentReferences(validated, new Map([["upload1", "file1"]]), "export");
    expect(rewriteAttachmentReferences(exported, new Map([["file1", "upload1"]]), "import")).toEqual(before);
    expect(doc).toEqual(before);
  });
  it("does not confuse table cells or inline text with unsupported blocks", () => {
    expect(unsupportedEditorBlocks([{ type: "table", content: { type: "tableContent", columnWidths: [220, 220], rows: [{ cells: ["A", "B"] }] } }])).toEqual([]);
  });
  it("retains safe table widths, headers and merged-cell spans in HTML", () => {
    const content = { columnWidths: [220, "1px; color:red"], headerRows: 1, rows: [{ cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 1 }, content: "Merged" }] }] };
    const html = blockNoteToSafeHtml([{ type: "table", content }], () => null);
    expect(html).toContain('<col style="width:220px">');
    expect(html).toContain('<th colspan="2" rowspan="1">Merged</th>');
    expect(html).not.toContain("color:red");
  });
});
