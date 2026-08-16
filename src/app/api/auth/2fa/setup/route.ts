import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { beginTwoFactorSetup, enableTwoFactor } from "@/lib/auth/two-factor-service";
import { twoFactorCodeSchema, twoFactorSetupSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const { password } = twoFactorSetupSchema.parse(await readJson(request));
    return NextResponse.json({ setup: await beginTwoFactorSetup(user.id, user.email, password) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUser();
    const { code } = twoFactorCodeSchema.parse(await readJson(request));
    return NextResponse.json({ recoveryCodes: await enableTwoFactor(user.id, code) });
  } catch (error) {
    return apiError(error);
  }
}
