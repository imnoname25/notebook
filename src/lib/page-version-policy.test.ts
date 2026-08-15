import { describe, expect, it } from "vitest";
import { PAGE_SNAPSHOT_INTERVAL_MS, PAGE_VERSION_MAX_AGE_MS, PAGE_VERSION_MAX_COUNT, pageContentHash, retainedVersionIds, shouldCreateSnapshot } from "./page-version-policy";

describe("page snapshot policy", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");
  it("suppresses identical snapshots", () => expect(shouldCreateSnapshot({ currentHash: "same", latestHash: "same", latestCreatedAt: new Date(0), reason: "manual", now })).toBe(false));
  it("throttles autosave snapshots for five minutes", () => {
    expect(shouldCreateSnapshot({ currentHash: "new", latestHash: "old", latestCreatedAt: new Date(now.getTime() - PAGE_SNAPSHOT_INTERVAL_MS + 1), reason: "interval", now })).toBe(false);
    expect(shouldCreateSnapshot({ currentHash: "new", latestHash: "old", latestCreatedAt: new Date(now.getTime() - PAGE_SNAPSHOT_INTERVAL_MS), reason: "interval", now })).toBe(true);
  });
  it("allows manual and pre-restore snapshots immediately", () => {
    expect(shouldCreateSnapshot({ currentHash: "new", latestHash: "old", latestCreatedAt: now, reason: "manual", now })).toBe(true);
    expect(shouldCreateSnapshot({ currentHash: "new", latestHash: "old", latestCreatedAt: now, reason: "before_restore", now })).toBe(true);
  });
  it("hashes equivalent objects deterministically", () => expect(pageContentHash("A", [{ b: 2, a: 1 }])).toBe(pageContentHash("A", [{ a: 1, b: 2 }])));
  it("drops versions older than 30 days and caps the newest at 100", () => {
    const versions = Array.from({ length: PAGE_VERSION_MAX_COUNT + 10 }, (_, index) => ({ id: String(index), createdAt: new Date(now.getTime() - index * 1000) }));
    versions.push({ id: "old", createdAt: new Date(now.getTime() - PAGE_VERSION_MAX_AGE_MS - 1) });
    const retained = retainedVersionIds(versions, now);
    expect(retained).toHaveLength(PAGE_VERSION_MAX_COUNT); expect(retained).not.toContain("old"); expect(retained[0]).toBe("0");
  });
});
