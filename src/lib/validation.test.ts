import { describe, expect, it } from "vitest";
import { credentialsSchema, notebookCreateSchema, notebookReorderSchema, pageCreateSchema, pageMoveSchema, pageUpdateSchema, restoreVersionSchema, sectionCreateSchema, sectionMoveSchema, trashItemSchema } from "./validation";

describe("critical creation contracts", () => {
  it("normalizes login email and enforces password length", () => {
    expect(credentialsSchema.parse({ email: " User@Example.COM ", password: "long-enough" }).email).toBe("user@example.com");
    expect(() => credentialsSchema.parse({ email: "bad", password: "short" })).toThrow();
  });

  it("validates notebook creation", () => {
    expect(notebookCreateSchema.parse({ title: " Работа " }).title).toBe("Работа");
    expect(() => notebookCreateSchema.parse({ title: "" })).toThrow();
    expect(notebookCreateSchema.parse({ title: "Дом", color: "green", icon: "home" }).color).toBe("green");
    expect(() => notebookCreateSchema.parse({ title: "Дом", color: "url(red)" })).toThrow();
    expect(() => notebookCreateSchema.parse({ title: "Дом", icon: "ArbitraryComponent" })).toThrow();
  });

  it("validates move and restore concurrency inputs", () => {
    expect(pageMoveSchema.parse({ destinationSectionId: "section-2" }).destinationSectionId).toBe("section-2");
    expect(sectionMoveSchema.parse({ destinationNotebookId: "notebook-2" }).destinationNotebookId).toBe("notebook-2");
    expect(restoreVersionSchema.parse({ expectedRevision: 4 }).expectedRevision).toBe(4);
    expect(() => restoreVersionSchema.parse({ expectedRevision: -1 })).toThrow();
    expect(() => pageUpdateSchema.parse({ title: "A", sortOrder: 999 })).toThrow();
  });

  it("validates root and nested section creation", () => {
    expect(sectionCreateSchema.parse({ notebookId: "notebook-1", title: "Серверы", parentId: null }).parentId).toBeNull();
    expect(sectionCreateSchema.parse({ notebookId: "notebook-1", title: "Unraid", parentId: "section-1" }).parentId).toBe("section-1");
  });

  it("requires a section for page creation", () => {
    expect(pageCreateSchema.parse({ sectionId: "section-1" }).sectionId).toBe("section-1");
    expect(() => pageCreateSchema.parse({ sectionId: "" })).toThrow();
  });

  it("validates reorder and trash mutation payloads", () => {
    expect(notebookReorderSchema.parse({ ids: ["one", "two"] }).ids).toHaveLength(2);
    expect(() => notebookReorderSchema.parse({ ids: ["one", "one"] })).toThrow();
    expect(trashItemSchema.parse({ type: "page", id: "page-1" }).type).toBe("page");
    expect(() => trashItemSchema.parse({ type: "upload", id: "file-1" })).toThrow();
  });
});
