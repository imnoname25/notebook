import { describe, expect, it } from "vitest";
import { blockNoteToSafeHtml, escapeHtml, standalonePageHtml } from "@/lib/html-export";

describe("standalone HTML export", () => {
  it("escapes text and never emits an internal authenticated URL", () => { const html = blockNoteToSafeHtml([{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>", styles: {} }, { type: "link", href: "/pages/abc", content: [{ type: "text", text: "Page", styles: {} }] }] }], () => null); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("/pages/abc"); expect(html).not.toContain("<script>"); });
  it("renders callouts, open toggles, code language and tables", () => { const html = blockNoteToSafeHtml([{ type: "callout", props: { title: "Важно" }, content: [] }, { type: "toggle", content: [{ type: "text", text: "More", styles: {} }], children: [{ type: "codeBlock", props: { language: "sql" }, content: [{ type: "text", text: "select 1", styles: {} }] }] }], () => null); expect(html).toContain("class=\"callout\""); expect(html).toContain("<details open>"); expect(html).toContain("data-language=\"sql\""); });
  it("creates a light standalone document", () => { const html = standalonePageHtml("A&B", new Date("2026-08-14T00:00:00Z"), "<p>safe</p>"); expect(html).toContain("A&amp;B"); expect(html).toContain("<!doctype html>"); expect(escapeHtml("'\"")).toBe("&#39;&quot;"); });
});
