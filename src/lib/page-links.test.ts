import { describe, expect, it } from "vitest";
import { internalPageIdsInContent, rewriteInternalPageReferences } from "./portable-content";
import { extractBlockNoteText } from "./blocknote-text";
import { blockNoteToMarkdown } from "./markdown-export";
import { blockNoteToSafeHtml } from "./html-export";
const link = { type: "pageLink", props: { pageId: "target", text: "Русское название", alias: false } };
const content = [{ type: "paragraph", content: [link, { ...link, props: { ...link.props, text: "Мой текст", alias: true } }] }];
describe("stable internal page links", () => {
  it("deduplicates IDs and ignores external links and URL-like ordinary text", () => {
    expect([...internalPageIdsInContent([...content, { type: "paragraph", content: [{ type: "text", text: "/pages/ordinary" }, { type: "link", href: "https://example.test/pages/external" }, { type: "link", href: "/pages/legacy#block-ok" }] }])]).toEqual(["target", "legacy"]);
  });
  it("round trips portable IDs without changing aliases or external URLs", () => {
    const exported = rewriteInternalPageReferences(content, new Map([["target", "portable"]]), "export");
    const imported = rewriteInternalPageReferences(exported, new Map([["portable", "target"]]), "import");expect(imported).toEqual(content);
    const ordinary = [{ type: "paragraph", content: [{ type: "text", text: "/pages/target" }, { type: "link", href: "https://example.test/pages/target" }] }];
    expect(rewriteInternalPageReferences(ordinary, new Map([["target", "portable"]]), "export")).toEqual(ordinary);
  });
  it("keeps unavailable imported targets distinct and preserves labels in search and exports", () => {
    expect([...internalPageIdsInContent(rewriteInternalPageReferences(rewriteInternalPageReferences(content, new Map(), "export"), new Map(), "import"))]).toEqual(["missing-target"]);
    expect(extractBlockNoteText(content)).toContain("Русское название");expect(extractBlockNoteText(content)).toContain("Мой текст");
    expect(blockNoteToMarkdown("A", content)).toContain("Русское названиеМой текст");expect(blockNoteToSafeHtml(content, () => null)).toContain("Русское названиеМой текст");
  });
});
