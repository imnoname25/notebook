import { describe, expect, it } from "vitest";
import { nextScheduledBackup, scheduledBackupIsDue } from "./backup-schedule";

describe("backup schedule", () => {
  const now = new Date(2026, 7, 14, 12, 0, 0);
  it("runs one overdue daily backup", () => expect(scheduledBackupIsDue({ enabled: true, schedule: "daily", localTime: "02:00", last: new Date(2026, 7, 13, 2, 0, 0) }, now)).toBe(true));
  it("does not run when disabled", () => expect(scheduledBackupIsDue({ enabled: false, schedule: "daily", localTime: "02:00", last: null }, now)).toBe(false));
  it("calculates every-three-days and weekly without a backlog", () => { expect(nextScheduledBackup(new Date(2026, 7, 12, 2), "every_3_days", "02:00", now)).toEqual(new Date(2026, 7, 15, 2)); expect(nextScheduledBackup(new Date(2026, 7, 8, 2), "weekly", "02:00", now)).toEqual(new Date(2026, 7, 15, 2)); });
  it("starts a newly enabled schedule as one overdue run", () => expect(scheduledBackupIsDue({ enabled: true, schedule: "weekly", localTime: "23:00", last: null }, now)).toBe(true));
});

