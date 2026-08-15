import path from "node:path";
import { apiError, requireUser } from "@/lib/api";
import { createDataTempDirectory } from "@/lib/archive";
import { fileDownloadResponse } from "@/lib/download";
import { writePortableArchive } from "@/lib/services/export-service";
import { withDataOperation } from "@/lib/operation-lock";

export async function GET() {
  try { const user = await requireUser(); return await withDataOperation("резервное копирование", async () => { const directory = await createDataTempDirectory("notebook-backup-"); const target = path.join(directory, "notebook-backup.zip"); try { await writePortableArchive(user.id, target, { includeDeleted: true, includeHistory: true, backup: true }); return fileDownloadResponse(target, "notebook-backup.zip", directory); } catch (error) { await import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })); throw error; } }); }
  catch (error) { return apiError(error); }
}
