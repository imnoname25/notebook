import { describe, expect, it } from "vitest";
import { templateImportSchema, validateTemplateContent } from "@/lib/page-templates";

describe("page templates", () => {
  it("accepts structured custom blocks", () => { expect(validateTemplateContent([{ type: "callout", props: { kind: "info" }, content: [] }, { type: "toggle", content: [], children: [{ type: "paragraph", content: [] }] }])).toHaveLength(2); });
  it("rejects private attachment references and unsafe imported content", () => { expect(() => validateTemplateContent([{ type: "image", props: { url: "/api/uploads/secret" } }])).toThrow("private изображения"); expect(() => validateTemplateContent([{ type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: [] }] }])).toThrow("небезопасную"); });
  it("requires the versioned portable format", () => { const valid = { format: "notebook-page-template", version: 1, template: { name: "Runbook", description: null, icon: "book-open", content: [{ type: "paragraph", content: [] }] } }; expect(templateImportSchema.parse(valid).version).toBe(1); expect(() => templateImportSchema.parse({ ...valid, version: 2 })).toThrow(); });
});
