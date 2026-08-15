import path from "node:path";
import { apiError, requireUser } from "@/lib/api";
import { createDataTempDirectory } from "@/lib/archive";
import { fileDownloadResponse } from "@/lib/download";
import { writePortableArchive } from "@/lib/services/export-service";
import { withDataOperation } from "@/lib/operation-lock";

export async function GET() {
  try { const user = await requireUser(); return await withDataOperation("экспорт данных", async () => { const directory = await createDataTempDirectory("notebook-export-"); const target = path.join(directory, "notebook-all.zip"); try { await writePortableArchive(user.id, target, { includeDeleted: false, includeHistory: false, backup: false }); return fileDownloadResponse(target, "notebook-all-data.zip", directory); } catch (error) { await import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })); throw error; } }); }
  catch (error) { return apiError(error); }
}
