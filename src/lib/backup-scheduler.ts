import { db } from "@/lib/db";
import { scheduledBackupIsDue } from "@/lib/backup-schedule";
import type { BackupSchedule } from "@/lib/application-settings";
import { createOperationalBackup } from "@/lib/services/backup-service";
import { getApplicationSettings } from "@/lib/services/settings-service";
import { withDataOperation } from "@/lib/operation-lock";

const state = globalThis as typeof globalThis & { notebookBackupScheduler?: { timer: ReturnType<typeof setInterval>; running: boolean }; notebookBackupShutdownHooks?: boolean };

export async function runScheduledBackupIfDue(now = new Date()) {
  const settings = await getApplicationSettings();
  if (!scheduledBackupIsDue({ enabled: settings.backupEnabled, schedule: settings.backupSchedule as BackupSchedule, localTime: settings.backupTime, last: settings.lastScheduledBackupAt }, now)) return false;
  const user = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }); if (!user) return false;
  await withDataOperation("scheduled backup", () => createOperationalBackup(user.id, "scheduled", now)); return true;
}

export function startBackupScheduler() {
  if (state.notebookBackupScheduler) return;
  const tick = async () => { if (state.notebookBackupScheduler?.running) return; if (state.notebookBackupScheduler) state.notebookBackupScheduler.running = true; try { await runScheduledBackupIfDue(); } catch (error) { console.error("Notebook scheduled backup tick failed", { category: error instanceof Error ? error.name : "unknown" }); } finally { if (state.notebookBackupScheduler) state.notebookBackupScheduler.running = false; } };
  const timer = setInterval(() => void tick(), 60_000); timer.unref(); state.notebookBackupScheduler = { timer, running: false }; setTimeout(() => void tick(), 5_000).unref();
  if (!state.notebookBackupShutdownHooks) { state.notebookBackupShutdownHooks = true; const shutdown = () => stopBackupScheduler(); process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown); }
}

export function stopBackupScheduler() { if (!state.notebookBackupScheduler) return; clearInterval(state.notebookBackupScheduler.timer); state.notebookBackupScheduler = undefined; }
