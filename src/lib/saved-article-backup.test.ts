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
  it.each([2, 3, 8])("allows %i blocks to reference one image resource", count => {
    const source = article();
    const blocks = Array.from({ length: count }, (_, index) => ({ ...source.blocks[0], alt: `Reference ${index}` }));
    expect(portableArticleSchema.parse({ ...source, blocks })).toMatchObject({ blocks, images: source.images });
  });
  it.each([
    { contentVersion: 1 }, { sourceUrl: null }, { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:secret@example.org/" }, { extractedAt: "invalid" },
    { images: [] }, { images: [...article().images, ...article().images] },
    { blocks: [{ type: "script", content: "alert(1)" }] }, { leaseToken: "never portable" },
    { blocks: [{ type: "image", key: "b".repeat(64), alt: "Unknown" }] },
    { images: [...article().images, { ...article().images[0], imageKey: "b".repeat(64) }] },
    { images: [...article().images, { ...article().images[0], imageKey: "b".repeat(64), position: 1 }] },
  ])("rejects malformed content and transient worker fields %#", fields => {
    expect(portableArticleSchema.safeParse({ ...article(), ...fields }).success).toBe(false);
  });
});
