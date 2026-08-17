import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { adminUserActionSchema } from "@/lib/validation";
import { resetManagedUserPassword, resetManagedUserTwoFactor, revokeManagedUserSessions, setUserDisabled } from "@/lib/services/user-management-service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    validateRequestOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = adminUserActionSchema.parse(await readJson(request));
    if (input.action === "disable") await setUserDisabled(admin.id, id, true);
    else if (input.action === "enable") await setUserDisabled(admin.id, id, false);
    else if (input.action === "revokeSessions") await revokeManagedUserSessions(admin.id, id);
    else if (input.action === "resetTwoFactor") await resetManagedUserTwoFactor(admin.id, id);
    else await resetManagedUserPassword(admin.id, id, input.password, input.mustChangePassword);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
