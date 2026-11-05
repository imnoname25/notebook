export async function register() {
  // Keep the import inside the positive runtime branch so Next can exclude
  // Node-only PostgreSQL/filesystem dependencies from its Edge compilation.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("@/lib/backup-scheduler");
    startBackupScheduler();
  }
}
