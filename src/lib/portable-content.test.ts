import { describe, expect, it } from "vitest";
import { attachmentIdsInContent, internalPageIdsInContent, portableAttachmentKeysInContent, rewriteAttachmentReferences, rewriteInternalPageReferences } from "./portable-content";

describe("portable BlockNote references", () => {
  const content = [{ type: "image", props: { url: "/api/uploads/upload-1" } }, { type: "paragraph", content: [{ type: "link", href: "/pages/page-2", content: [{ type: "text", text: "Target", styles: {} }] }] }];
  it("extracts attachment and internal page references", () => { expect([...attachmentIdsInContent(content)]).toEqual(["upload-1"]); expect([...internalPageIdsInContent(content)]).toEqual(["page-2"]); });
  it("round-trips attachment references through a portable key", () => { const exported = rewriteAttachmentReferences(content, new Map([["upload-1", "asset-1"]]), "export"); expect([...portableAttachmentKeysInContent(exported)]).toEqual(["asset-1"]); const imported = rewriteAttachmentReferences(exported, new Map([["asset-1", "new-upload"]]), "import"); expect([...attachmentIdsInContent(imported)]).toEqual(["new-upload"]); });
  it("keeps internal links stable by page ID when display text changes", () => expect([...internalPageIdsInContent(JSON.parse(JSON.stringify(content).replace("Target", "Renamed")))]).toEqual(["page-2"]));
  it("remaps internal links across instances", () => { const exported = rewriteInternalPageReferences(content, new Map([["page-2", "portable-page"]]), "export"); const imported = rewriteInternalPageReferences(exported, new Map([["portable-page", "new-page"]]), "import"); expect([...internalPageIdsInContent(imported)]).toEqual(["new-page"]); });
});
