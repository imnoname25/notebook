import { NextRequest, NextResponse } from "next/server";
import { apiError, validateRequestOrigin } from "@/lib/api";
import { deleteCurrentSession } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    await deleteCurrentSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
