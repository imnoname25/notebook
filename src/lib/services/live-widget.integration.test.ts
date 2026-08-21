import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("Live Widget ownership and cache", () => {
  let db: typeof import("@/lib/db").db;
  let service: typeof import("./live-widget-service");
  let ids: { user: string; other: string; page: string; block: string };
  beforeAll(async () => { ({ db } = await import("@/lib/db")); service = await import("./live-widget-service"); });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "widget@test.local", name: "Widget", passwordHash: "unused" } });
    const other = await db.user.create({ data: { email: "other-widget@test.local", name: "Other", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Ops" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Services" } });
    const block = "stable-widget-block";
    const content = [{ id: block, type: "liveWidget", props: { widgetType: "HTTP_STATUS", title: "Public", config: JSON.stringify({ type: "HTTP_STATUS", url: "https://example.com/", method: "HEAD", expectedMin: 200, expectedMax: 399 }), refreshMode: "MANUAL", displaySize: "NORMAL", targetLabel: "https://example.com/" } }];
    const page = await db.page.create({ data: { sectionId: section.id, title: "Runbook", content } });
    await db.$transaction((tx) => service.syncLiveWidgetIndex(tx, page.id, content));
    const widget = await db.liveWidgetIndex.findFirstOrThrow({ where: { pageId: page.id, blockId: block } });
    await db.liveWidgetResult.create({ data: { widgetId: widget.id, status: "WARNING", value: "HTTP 503", checkedAt: new Date() } });
    ids = { user: user.id, other: other.id, page: page.id, block };
  });
  it("returns cache only through Page ownership and rejects foreign refresh", async () => {
    expect(await service.getLiveWidgetResult(ids.user, ids.page, ids.block)).toMatchObject({ status: "WARNING", value: "HTTP 503" });
    await expect(service.getLiveWidgetResult(ids.other, ids.page, ids.block)).rejects.toMatchObject({ status: 404 });
    await expect(service.refreshLiveWidget(ids.other, ids.page, ids.block)).rejects.toMatchObject({ status: 404 });
  });
  it("removes transient cache when canonical config changes", async () => {
    const changed = [{ id: ids.block, type: "liveWidget", props: { widgetType: "HTTP_STATUS", title: "Changed", config: JSON.stringify({ type: "HTTP_STATUS", url: "https://example.org/", method: "HEAD", expectedMin: 200, expectedMax: 399 }), refreshMode: "MANUAL", displaySize: "NORMAL", targetLabel: "https://example.org/" } }];
    await db.$transaction((tx) => service.syncLiveWidgetIndex(tx, ids.page, changed));
    expect(await service.getLiveWidgetResult(ids.user, ids.page, ids.block)).toMatchObject({ status: "UNKNOWN" });
  });
});
