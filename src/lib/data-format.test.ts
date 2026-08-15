import { describe, expect, it } from "vitest";
import { archiveDataSchema, DATA_FORMAT_VERSION, manifestSchema, pageExportSchema } from "./data-format";

describe("portable data contracts", () => {
  it("accepts the current versioned export manifest", () => expect(manifestSchema.parse({ format: "notebook-export", version: DATA_FORMAT_VERSION, createdAt: new Date().toISOString(), app: "Notebook", scope: "all", includesHistory: false, attachmentCount: 0 }).version).toBe(2));
  it("rejects unsupported versions and extra fields", () => {
    expect(() => manifestSchema.parse({ format: "notebook-export", version: 3, createdAt: new Date().toISOString(), app: "Notebook", scope: "all", includesHistory: false, attachmentCount: 0 })).toThrow();
    expect(() => manifestSchema.parse({ format: "notebook-export", version: 1, createdAt: new Date().toISOString(), app: "Notebook", scope: "all", includesHistory: false, attachmentCount: 0, sessions: [] })).toThrow();
  });
  it("keeps v1 readable and validates v2 template data", () => { const base = { format: "notebook-backup", createdAt: new Date().toISOString(), app: "Notebook", scope: "backup", includesHistory: true, attachmentCount: 0 } as const; expect(manifestSchema.parse({ ...base, version: 1 }).version).toBe(1); expect(manifestSchema.parse({ ...base, version: 2 }).version).toBe(2); expect(() => archiveDataSchema.parse({ notebooks: [], attachments: [], templates: [{ name: "Unsafe", description: null, icon: "arbitrary", content: [], sortOrder: 0 }] })).toThrow(); });
  it("rejects malformed BlockNote content", () => expect(() => archiveDataSchema.parse({ notebooks: [{ key: "n", title: "N", icon: "notebook", color: "slate", sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sections: [{ key: "s", parentKey: null, title: "S", icon: null, sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pages: [{ key: "p", title: "P", content: [{ content: [] }], sortOrder: 0, isFavorite: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }] }], attachments: [] })).toThrow());
  it("validates a standalone page export without internal IDs", () => {
    const value = pageExportSchema.parse({ manifest: { format: "notebook-page", version: 1, createdAt: new Date().toISOString(), app: "Notebook" }, page: { key: "portable", title: "Page", content: [{ type: "paragraph", content: [] }], sortOrder: 0, isFavorite: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, attachments: [] });
    expect(value).not.toHaveProperty("userId"); expect(value.page).not.toHaveProperty("revision");
  });
});
