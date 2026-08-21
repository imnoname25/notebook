import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("Today aggregation", () => {
  let db: typeof import("@/lib/db").db;
  let getToday: typeof import("./today-service").getToday;
  let recordRecentPage: typeof import("./recent-page-service").recordRecentPage;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ getToday } = await import("./today-service"));
    ({ recordRecentPage } = await import("./recent-page-service"));
  });
  beforeEach(async () => { await db.user.deleteMany(); });

  it("returns only the current user's lightweight workspace data", async () => {
    const user = await db.user.create({ data: { email: "today@test.local", name: "Today", passwordHash: "unused" } });
    const other = await db.user.create({ data: { email: "other-today@test.local", name: "Other", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Work" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Notes" } });
    const page = await db.page.create({ data: { sectionId: section.id, title: "Recent", content: [], isFavorite: true } });
    await recordRecentPage(user.id, page.id);
    await db.quickNote.create({ data: { userId: user.id, body: "Capture", color: "amber" } });
    const own = await getToday(user.id);
    expect(own.recent.map((item) => item.id)).toContain(page.id);
    expect(own.favorites.map((item) => item.id)).toContain(page.id);
    expect(own.inbox).toHaveLength(1);
    expect(await getToday(other.id)).toMatchObject({ inbox: [], recent: [], favorites: [], changed: [], tags: [], attention: [] });
  });
});
