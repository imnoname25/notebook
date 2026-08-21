import { describe, expect, it } from "vitest";
import { blockNoteToSafeHtml, escapeHtml, standalonePageHtml } from "@/lib/html-export";

describe("standalone HTML export", () => {
  it("escapes text and never emits an internal authenticated URL", () => { const html = blockNoteToSafeHtml([{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>", styles: {} }, { type: "link", href: "/pages/abc", content: [{ type: "text", text: "Page", styles: {} }] }] }], () => null); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("/pages/abc"); expect(html).not.toContain("<script>"); });
  it("renders callouts, open toggles, bookmarks, code language and tables", () => { const html = blockNoteToSafeHtml([{ type: "callout", props: { title: "Важно" }, content: [] }, { type: "bookmark", props: { url: "https://example.com", title: "Example" } }, { type: "toggle", content: [{ type: "text", text: "More", styles: {} }], children: [{ type: "codeBlock", props: { language: "sql" }, content: [{ type: "text", text: "select 1", styles: {} }] }] }], () => null); expect(html).toContain("class=\"callout\""); expect(html).toContain("class=\"bookmark\""); expect(html).toContain("<details open>"); expect(html).toContain("data-language=\"sql\""); });
  it("creates a light standalone document", () => { const html = standalonePageHtml("A&B", new Date("2026-08-14T00:00:00Z"), "<p>safe</p>"); expect(html).toContain("A&amp;B"); expect(html).toContain("<!doctype html>"); expect(escapeHtml("'\"")).toBe("&#39;&quot;"); });
  it("exports semantic tabs, banners and dividers but omits variable values", () => {
    const html = blockNoteToSafeHtml([
      { type: "banner", props: { title: "Warning" }, content: [{ type: "text", text: "Read first" }] },
      { type: "divider", props: { style: "label" }, content: [{ type: "text", text: "Linux" }] },
      { type: "tabs", children: [{ type: "tabPanel", props: { label: "Docker" }, children: [{ type: "paragraph", content: [{ type: "text", text: "compose" }] }] }] },
      { type: "columns", props: { count: 2 }, children: [{ type: "columnPanel", children: [{ type: "paragraph", content: [{ type: "text", text: "left" }] }] }, { type: "columnPanel", children: [{ type: "paragraph", content: [{ type: "text", text: "right" }] }] }] },
      { type: "pageVariables", props: { data: "private value" } },
    ], () => null);
    expect(html).toContain("class=\"banner\"");
    expect(html).toContain("class=\"divider-label\"");
    expect(html).toContain("class=\"tabs\"");
    expect(html).toContain("<h2>Docker</h2>");
    expect(html).toContain("compose");
    expect(html).toContain("class=\"columns\"");
    expect(html).not.toContain("private value");
  });
});
