import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeAppearance } from "../appearance-preferences";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("user appearance persistence and isolation", () => {
  let db: typeof import("@/lib/db").db;
  let update: typeof import("./account-preferences").updateAccountPreferences;
  let owner: string, other: string, pageId: string;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ updateAccountPreferences: update } = await import("./account-preferences"));
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    owner = (await db.user.create({ data: { email: "appearance@example.test", name: "Synthetic", passwordHash: "unused" } })).id;
    other = (await db.user.create({ data: { email: "other-appearance@example.test", name: "Other", passwordHash: "unused" } })).id;
    const notebook = await db.notebook.create({ data: { userId: owner, title: "Synthetic" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Synthetic" } });
    pageId = (await db.page.create({ data: { sectionId: section.id, title: "Typography", content: [{ id: "legacy", type: "paragraph", props: { backgroundColor: "transparent" }, content: "Кириллица" }] } })).id;
  });
  it("keeps presentation outside content, revisions and history", async () => {
    const before = await db.page.findUniqueOrThrow({ where: { id: pageId } });
    const versions = await db.pageVersion.count({ where: { pageId } });
    await update(owner, { appearance: { theme: "paper-coffee", uiFont: "inter", editorFont: "literata", editorSize: 21, lineHeight: "relaxed" } });
    expect(await db.page.findUniqueOrThrow({ where: { id: pageId } })).toEqual(before);
    expect(await db.pageVersion.count({ where: { pageId } })).toBe(versions);
    expect(normalizeAppearance((await db.userSettings.findUniqueOrThrow({ where: { userId: owner } })).appearance).editorSize).toBe(21);
  });
  it("atomically preserves concurrent partial fields and account isolation", async () => {
    await update(owner, { appearance: { theme: "midnight-ink" } });
    const second = await update(other, { appearance: { theme: "nord-studio" } });
    await Promise.all([update(owner, { appearance: { uiFont: "inter" } }), update(owner, { appearance: { editorFont: "jetbrains-mono" } })]);
    const saved = normalizeAppearance((await db.userSettings.findUniqueOrThrow({ where: { userId: owner } })).appearance);
    expect(saved).toMatchObject({ theme: "midnight-ink", uiFont: "inter", editorFont: "jetbrains-mono" });
    expect(await db.userSettings.findUniqueOrThrow({ where: { userId: other } })).toEqual(second);
  });
  it("preserves old preference updates and rejects invalid input", async () => {
    await update(owner, { appearance: { theme: "forest-terminal", editorSize: 19 } });
    await update(owner, { editorContentWidth: "wide", startScreen: "today" });
    const saved = await db.userSettings.findUniqueOrThrow({ where: { userId: owner } });
    expect(saved.appearance).toEqual({ theme: "forest-terminal", editorSize: 19 });
    await expect(update(owner, { userId: other, appearance: { theme: "dark" } })).rejects.toThrow();
    await expect(update(owner, { appearance: { uiFont: "arbitrary-css" } })).rejects.toThrow();
    expect(await db.userSettings.findUniqueOrThrow({ where: { userId: owner } })).toEqual(saved);
  });
  it("keeps additive migration defaults compatible with old settings rows", async () => {
    const row = await db.userSettings.create({ data: { userId: owner } });
    expect(row.appearance).toEqual({});
    expect(normalizeAppearance(row.appearance).theme).toBe("system");
  });
});
