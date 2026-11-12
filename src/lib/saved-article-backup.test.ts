import { describe, expect, it } from "vitest";
import { ARTICLES_DATA_FORMAT_VERSION, DATA_FORMAT_VERSION, FILE_INTEGRITY_DATA_FORMAT_VERSION,
  SAVED_ITEMS_DATA_FORMAT_VERSION, manifestSchema, portableArticleSchema } from "./data-format";

const key = "a".repeat(64);
const article = () => ({
  contentVersion: 2, sourceUrl: "https://example.org/story", extractedAt: "2026-11-12T10:00:00.000Z",
  blocks: [{ type: "image", key, alt: "Unavailable" }],
  images: [{ imageKey: key, sourceUrl: "https://example.org/image", position: 0, attachmentKey: null }],
});

describe("portable Saved Article v7 contracts", () => {
  it("pins each capability independently of the current writer version", () => {
    expect(DATA_FORMAT_VERSION).toBe(7);
    expect(SAVED_ITEMS_DATA_FORMAT_VERSION).toBe(6);
    expect(FILE_INTEGRITY_DATA_FORMAT_VERSION).toBe(6);
    expect(ARTICLES_DATA_FORMAT_VERSION).toBe(7);
  });
  it.each([1, 2, 3, 4, 5, 6, 7])("continues accepting manifest v%i", version => {
    expect(manifestSchema.parse({ format: "notebook-backup", version, createdAt: "2026-11-12T10:00:00.000Z",
      app: "Notebook", scope: "backup", includesHistory: true, attachmentCount: 0 }).version).toBe(version);
  });
  it("represents an unavailable image without a fabricated attachment", () => {
    expect(portableArticleSchema.parse(article()).images[0].attachmentKey).toBeNull();
  });
  it.each([
    { contentVersion: 1 }, { sourceUrl: null }, { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:secret@example.org/" }, { extractedAt: "invalid" },
    { images: [] }, { images: [...article().images, ...article().images] },
    { blocks: [{ type: "script", content: "alert(1)" }] }, { leaseToken: "never portable" },
    { blocks: [...article().blocks, ...article().blocks] },
  ])("rejects malformed content and transient worker fields %#", fields => {
    expect(portableArticleSchema.safeParse({ ...article(), ...fields }).success).toBe(false);
  });
});
