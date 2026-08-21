import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("quick note integration", () => {
  let db: typeof import("@/lib/db").db;
  let service: typeof import("./quick-note-service");
  let ids: { user: string; other: string; section: string };
  beforeAll(async () => { ({ db } = await import("@/lib/db")); service = await import("./quick-note-service"); });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "quick@test.local", name: "Quick", passwordHash: "unused" } });
    const other = await db.user.create({ data: { email: "other-quick@test.local", name: "Other", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Notebook" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Inbox target" } });
    ids = { user: user.id, other: other.id, section: section.id };
  });

  it("keeps ownership, archive/pin state and converts without losing text", async () => {
    const note = await service.createQuickNote(ids.user, { title: "VPN #работа", body: "Настроить туннель", color: "blue" });
    expect(await service.listQuickNotes(ids.other)).toEqual([]);
    await expect(service.updateQuickNote(ids.other, note.id, { isPinned: true })).rejects.toMatchObject({ status: 404 });
    const pinned = await service.updateQuickNote(ids.user, note.id, { isPinned: true });
    expect(pinned.isPinned).toBe(true);
    expect(await db.quickNoteTag.count({ where: { quickNoteId: note.id } })).toBe(1);
    const page = await service.convertQuickNote(ids.user, note.id, ids.section);
    expect(page).toMatchObject({ title: "VPN #работа", sectionId: ids.section, color: "blue" });
    expect(await service.listQuickNotes(ids.user)).toEqual([]);
    expect((await service.listQuickNotes(ids.user, true))[0]).toMatchObject({ id: note.id, status: "CONVERTED" });
    expect(await db.pageTag.count({ where: { pageId: page.id } })).toBe(1);
  });
});
