import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, validateRequestOrigin } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/validation";
import { authRateLimiter, authRateLimitKey } from "@/lib/auth/rate-limiter";
import { issueTwoFactorChallenge } from "@/lib/auth/two-factor-challenge";

const DUMMY_PASSWORD_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const input = credentialsSchema.parse(await readJson(request));
    const limitKey = authRateLimitKey(request.headers, input.email);
    const limit = authRateLimiter.check(limitKey);
    if (!limit.allowed) throw new ApiError(429, "Слишком много попыток входа. Повторите позже");
    const user = await db.user.findUnique({ where: { email: input.email } });
    const passwordValid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordValid) { authRateLimiter.recordFailure(limitKey); throw new ApiError(401, "Неверный email или пароль"); }
    authRateLimiter.clear(limitKey);
    if (user.totpEnabledAt) {
      if (!user.totpSecretEncrypted) throw new ApiError(500, "Настройка двухфакторной аутентификации повреждена");
      await issueTwoFactorChallenge(user.id);
      return NextResponse.json({ ok: true, requiresTwoFactor: true });
    }
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
