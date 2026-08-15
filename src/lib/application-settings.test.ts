import { describe, expect, it } from "vitest";
import { normalizeWebdavDirectory, settingsUpdateSchema } from "./application-settings";

describe("application settings validation", () => {
  it("accepts bounded editor and retention values", () => expect(settingsUpdateSchema.parse({ autosaveDelayMs: 750, pageVersionMaxCount: 100, backupSchedule: "weekly", editorContentWidth: "wide" })).toBeTruthy());
  it.each([{ autosaveDelayMs: 200 }, { backupRetentionDays: -1 }, { backupSchedule: "cron" }, { editorContentWidth: "huge" }, { webdavUrl: "ftp://host/path" }, { webdavUrl: "https://user:password@host/path" }])("rejects unsafe settings %#", (input) => expect(() => settingsUpdateSchema.parse(input)).toThrow());
  it("normalizes safe remote directories and rejects traversal", () => { expect(normalizeWebdavDirectory("/nas/notebook/")).toBe("nas/notebook"); expect(() => normalizeWebdavDirectory("nas/../secret")).toThrow(); expect(() => normalizeWebdavDirectory("nas\\secret")).toThrow(); });
});

