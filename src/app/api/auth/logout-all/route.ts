import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { deleteAllUserSessions } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    await deleteAllUserSessions(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
