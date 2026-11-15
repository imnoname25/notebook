import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { receiveDeviceCapture } from "@/lib/saved-item-api";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return await receiveDeviceCapture(request, params); }
  catch (error) { return apiError(error); }
}
