import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { withDataOperation } from "@/lib/operation-lock";
import { restoreUploadedBackup } from "@/lib/services/backup-restore-service";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireAdmin();
    if (request.headers.get("x-notebook-confirmation") !== "RESTORE")
      throw new ApiError(400, "Введите RESTORE для подтверждения");
    return await withDataOperation("восстановление backup", async () =>
      NextResponse.json(await restoreUploadedBackup(user.id, request)));
  } catch (error) { return apiError(error); }
}
