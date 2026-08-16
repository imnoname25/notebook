import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { disableTwoFactor, getTwoFactorStatus } from "@/lib/auth/two-factor-service";
import { twoFactorDisableSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ twoFactor: await getTwoFactorStatus(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = twoFactorDisableSchema.parse(await readJson(request));
    await disableTwoFactor(user.id, input.password, input.code);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
