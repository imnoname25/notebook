import { describe, expect, it } from "vitest";
import { portableTemplateReferences, restoreTemplateReferences, templateReferenceWarnings } from "./template-portability";
import { validateTemplateContent } from "./page-templates";
import { cloneBlocksWithFreshIds } from "./document-state";
import { internalPageIdsInContent } from "./portable-content";
import { blockNoteToSafeHtml } from "./html-export";
const text = (text: string) => ({ type: "text", text, styles: {} });
const link = (pageId: string, alias = true) => ({ type: "pageLink", props: { pageId, text: "Своя подпись", alias } });
const content = [{ id: "root", type: "callout", content: [link("target")], children: [{ id: "child", type: "table", content: { type: "tableContent", rows: [{ cells: [[link("target", false)], [{ type: "link", href: "/pages/target#anchor", content: [text("Native alias")] }]] }] } }] }];
describe("template portability and identity", () => {
  it("round trips nested links, cells and aliases through explicit keys without mutating the source", () => {
    const source = structuredClone(content);
    const portable = portableTemplateReferences(content, new Map([["target", "page-key"]]));
    expect(JSON.stringify(portable)).toContain("notebook-page://page-key");
    const restored = restoreTemplateReferences(portable, new Map([["page-key", "new-target"]]), 5);
    expect(restored.unavailableLinks).toBe(0);
    expect([...internalPageIdsInContent(restored.content)]).toEqual(["new-target"]);
    expect(JSON.stringify(restored.content)).toContain("/pages/new-target#anchor");
    expect(JSON.stringify(restored.content)).toContain("Своя подпись");
    expect(content).toEqual(source);
  });
  it.each([1, 2, 3, 4])("legacy v%i never guesses targets even when a raw ID equals a portable key", version => {
    const result = restoreTemplateReferences(content, new Map([["target", "foreign-page"]]), version);
    expect(result.unavailableLinks).toBe(3);
    expect([...internalPageIdsInContent(result.content)].filter(id => !id.startsWith("missing-"))).toEqual([]);
    expect(JSON.stringify(result.content)).toContain("Своя подпись");
    expect(templateReferenceWarnings([content], new Map(), version)[0]).toContain("старый формат");
  });
  it("rejects raw IDs as v5 targets and reports missing keys without revealing metadata", () => {
    expect(restoreTemplateReferences(content, new Map([["target", "foreign-page"]]), 5).unavailableLinks).toBe(3);
    const portable = portableTemplateReferences(content, new Map());
    expect(restoreTemplateReferences(portable, new Map(), 5).unavailableLinks).toBe(3);
    expect(templateReferenceWarnings([portable], new Map(), 5)).toHaveLength(1);
  });
  it("keeps unavailable IDs stable over repeated backup and restore cycles", () => {
    const first = restoreTemplateReferences(portableTemplateReferences(content, new Map()), new Map(), 5).content;
    let restored = first;
    for (let cycle = 0; cycle < 5; cycle++) restored = restoreTemplateReferences(portableTemplateReferences(restored, new Map()), new Map(), 5).content;
    expect(restored).toEqual(first);
  });
  it("gives each new document fresh root and nested block IDs while leaving inline page IDs intact", () => {
    const a = cloneBlocksWithFreshIds(content), b = cloneBlocksWithFreshIds(content);
    const ids = (blocks: Record<string, unknown>[]): string[] => blocks.flatMap(block => [String(block.id), ...ids((block.children ?? []) as Record<string, unknown>[])]);
    const all = [...ids(a), ...ids(b)];expect(new Set(all).size).toBe(4);
    expect(all).not.toContain("root");expect(all).not.toContain("child");
    expect([...internalPageIdsInContent(a)]).toEqual(["target"]);expect(content[0]!.id).toBe("root");
  });
});
describe("context-aware template validation", () => {
  it("accepts literal schemes and HTML as text, code and formatted table cells", () => {
    const literal = '<script>alert(1)</script> data: blob: javascript: /api/uploads/example';
    const blocks = [{ type: "codeBlock", content: [text(literal)] }, { type: "paragraph", content: [text(literal)] }, { type: "table", content: { type: "tableContent", rows: [{ cells: [{ type: "tableCell", content: [text(literal)] }] }] } }];
    expect(validateTemplateContent(blocks)).toEqual(blocks);
    const html = blockNoteToSafeHtml(blocks, url => url);expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "blob:https://example.test/x", "java\tscript:alert(1)", "//other.test/x", "\\evil.test/x"])("rejects unsafe href %s", href => {
    expect(() => validateTemplateContent([{ type: "paragraph", content: [{ type: "link", href, content: [text("label")] }] }])).toThrow();
  });
  it.each(["/api/uploads/private", "https://example.test/api/%75ploads/private", "attachment://private"])("rejects private uploads in real URL fields: %s", url => {
    expect(() => validateTemplateContent([{ type: "image", props: { url } }])).toThrow("private");
    expect(() => validateTemplateContent([{ type: "paragraph", content: [{ type: "link", href: url, content: [] }] }])).toThrow("private");
  });
  it("preserves Live Widget validation and checks its real URL without interpreting label text", () => {
    const props = { widgetType: "HTTP_STATUS", title: "data: example", targetLabel: "blob: example", refreshMode: "MANUAL", displaySize: "NORMAL", config: JSON.stringify({ type: "HTTP_STATUS", url: "https://example.test/status" }) };
    expect(validateTemplateContent([{ type: "liveWidget", props }])).toHaveLength(1);
    expect(() => validateTemplateContent([{ type: "liveWidget", props: { ...props, config: JSON.stringify({ type: "HTTP_STATUS", url: "https://example.test/api/uploads/private" }) } }])).toThrow("private");
    expect(() => validateTemplateContent([{ type: "liveWidget", props: { ...props, config: JSON.stringify({ type: "HTTP_STATUS", url: "javascript:alert(1)" }) } }])).toThrow();
  });
  it("checks nested and table inline fields and refuses unknown types without conversion", () => {
    expect(() => validateTemplateContent([{ type: "toggle", children: [{ type: "alien", content: [] }] }])).toThrow();
    expect(() => validateTemplateContent([{ type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "link", href: "javascript:alert(1)", content: [] }]] }] } }])).toThrow();
    expect(() => validateTemplateContent([{ type: "paragraph", content: [{ type: "alien", text: "x" }] }])).toThrow();
    expect(validateTemplateContent([{ type: "paragraph", content: [{ type: "link", href: "https://example.test", content: [text("safe")] }, link("target")] }])).toHaveLength(1);
  });
});
