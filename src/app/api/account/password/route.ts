import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAccountUser, validateRequestOrigin } from "@/lib/api";
import { changePassword } from "@/lib/auth/account-service";
import { clearSessionCookie } from "@/lib/auth/session";
import { accountPasswordSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireAccountUser();
    const input = accountPasswordSchema.parse(await readJson(request));
    await changePassword(user.id, input.currentPassword, input.newPassword);
    await clearSessionCookie();
    console.info("[security-event]", { event: "password.changed", actorUserId: user.id, targetUserId: user.id });
    return NextResponse.json({ ok: true, sessionRevoked: true });
  } catch (error) {
    return apiError(error);
  }
}
