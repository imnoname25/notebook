import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { regenerateRecoveryCodes } from "@/lib/auth/two-factor-service";
import { twoFactorDisableSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const input = twoFactorDisableSchema.parse(await readJson(request));
    return NextResponse.json({ recoveryCodes: await regenerateRecoveryCodes(user.id, input.password, input.code) });
  } catch (error) {
    return apiError(error);
  }
}
