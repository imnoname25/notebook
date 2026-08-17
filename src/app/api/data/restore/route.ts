import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { disposePreparedImport, prepareImport, restoreBackupData } from "@/lib/services/import-service";
import { writePortableArchive } from "@/lib/services/export-service";
import { uploadRoot } from "@/lib/storage";
import { withDataOperation } from "@/lib/operation-lock";
import { createNotification } from "@/lib/services/system-notification-service";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request); const user = await requireAdmin(); if (request.headers.get("x-notebook-confirmation") !== "RESTORE") throw new ApiError(400, "Введите RESTORE для подтверждения");
    return await withDataOperation("восстановление backup", async () => {
      const prepared = await prepareImport(request, "backup");
      const safetyDirectory = path.join(uploadRoot(), ".safety-backups"); await mkdir(safetyDirectory, { recursive: true }); const safetyName = `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.zip`; const safetyPath = path.join(safetyDirectory, safetyName);
      let safetyCreated = false;
      try { await writePortableArchive(user.id, safetyPath, { includeDeleted: true, includeHistory: true, backup: true }); safetyCreated = true; await restoreBackupData(user.id, prepared); await rm(safetyPath, { force: true }); await createNotification({ type: "restore_succeeded", severity: "success", title: "Восстановление завершено", message: "Данные восстановлены из загруженного backup." }).catch(() => undefined); return NextResponse.json({ ok: true }); }
      catch (error) { await createNotification({ type: "restore_failed", severity: "error", title: "Восстановление не завершено", message: safetyCreated ? "Safety backup сохранён; проверьте состояние данных." : "Backup не был применён.", dedupKey: "restore:failure" }).catch(() => undefined); console.error("Notebook restore failed", { safetyName: safetyCreated ? safetyName : undefined, category: error instanceof Error ? error.name : "unknown" }); throw new ApiError(500, safetyCreated ? `Restore не завершён. Safety backup сохранён: ${safetyName}` : "Restore не запускался: не удалось создать safety backup"); }
      finally { await disposePreparedImport(prepared); }
    });
  } catch (error) { return apiError(error); }
}
