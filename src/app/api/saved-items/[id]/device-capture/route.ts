import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { receiveDevicePreview } from "@/lib/saved-item-api";
import { deviceCaptureSchema } from "@/lib/saved-item-validation";
import { applySavedDeviceCapture } from "@/lib/services/saved-item-service";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return await receiveDevicePreview(request, params, deviceCaptureSchema, applySavedDeviceCapture); }
  catch (error) { return apiError(error); }
}
