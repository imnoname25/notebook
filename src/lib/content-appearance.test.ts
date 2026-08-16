import { describe, expect, it } from "vitest";
import { isAccentColor, isPageIcon } from "./content-appearance";
import { pageUpdateSchema, sectionUpdateSchema } from "./validation";
import { settingsUpdateSchema } from "./application-settings";
import { pageExportSchema } from "./data-format";

describe("appearance validation", () => {
  it("accepts curated section and page appearance", () => {
    expect(sectionUpdateSchema.parse({ color: "violet" }).color).toBe("violet");
    expect(pageUpdateSchema.parse({ icon: "💡", color: "blue", coverUploadId: "upload-1" }).icon).toBe("💡");
  });
  it("rejects CSS colors and text masquerading as emoji", () => {
    expect(isAccentColor("url(red)")).toBe(false);
    expect(isPageIcon("password")).toBe(false);
    expect(() => sectionUpdateSchema.parse({ color: "#fff" })).toThrow();
  });
  it("supports only comfortable and compact density", () => {
    expect(settingsUpdateSchema.parse({ interfaceDensity: "compact" }).interfaceDensity).toBe("compact");
    expect(() => settingsUpdateSchema.parse({ interfaceDensity: "tiny" })).toThrow();
  });
  it("keeps page appearance in the portable contract", () => {
    const now = new Date().toISOString();
    const parsed = pageExportSchema.parse({ manifest: { format: "notebook-page", version: 1, createdAt: now, app: "Notebook" }, page: { key: "p", title: "Page", icon: "📝", color: "green", coverAttachmentKey: "cover", content: [{ type: "paragraph", content: [] }], sortOrder: 0, isFavorite: false, createdAt: now, updatedAt: now }, attachments: [{ key: "cover", fileName: "cover.webp", mimeType: "image/webp", size: 1, sha256: null, dataBase64: "AA==" }] });
    expect(parsed.page).toMatchObject({ icon: "📝", color: "green", coverAttachmentKey: "cover" });
  });
});
