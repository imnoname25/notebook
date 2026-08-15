import type { BackupSchedule } from "@/lib/application-settings";

function timeOn(date: Date, value: string) { const [hour, minute] = value.split(":").map(Number); const result = new Date(date); result.setHours(hour ?? 0, minute ?? 0, 0, 0); return result; }
function periodDays(schedule: BackupSchedule) { return schedule === "daily" ? 1 : schedule === "every_3_days" ? 3 : 7; }

export function nextScheduledBackup(last: Date | null, schedule: BackupSchedule, localTime: string, now = new Date()) {
  if (!last) { const today = timeOn(now, localTime); return today.getTime() <= now.getTime() ? today : new Date(today.getTime() - periodDays(schedule) * 86_400_000); }
  const next = timeOn(last, localTime); next.setDate(next.getDate() + periodDays(schedule)); return next;
}

export function scheduledBackupIsDue(input: { enabled: boolean; schedule: BackupSchedule; localTime: string; last: Date | null }, now = new Date()) {
  return input.enabled && nextScheduledBackup(input.last, input.schedule, input.localTime, now).getTime() <= now.getTime();
}

