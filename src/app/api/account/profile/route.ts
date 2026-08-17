import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAccountUser, validateRequestOrigin } from "@/lib/api";
import { updateOwnProfile } from "@/lib/auth/account-service";
import { clearSessionCookie } from "@/lib/auth/session";
import { accountProfileSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireAccountUser();
    return NextResponse.json({ user });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const current = await requireAccountUser();
    const result = await updateOwnProfile(current.id, accountProfileSchema.parse(await readJson(request)));
    if (result.sessionRevoked) await clearSessionCookie();
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
