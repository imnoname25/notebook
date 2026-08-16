import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, validateRequestOrigin } from "@/lib/api";
import { createSession } from "@/lib/auth/session";
import { authRateLimitKey, totpRateLimiter } from "@/lib/auth/rate-limiter";
import { consumeTwoFactorChallenge, getTwoFactorChallenge, recordTwoFactorChallengeFailure } from "@/lib/auth/two-factor-challenge";
import { verifyUserSecondFactor } from "@/lib/auth/two-factor-service";
import { twoFactorCodeSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const { code } = twoFactorCodeSchema.parse(await readJson(request));
    const challenge = await getTwoFactorChallenge();
    if (!challenge?.user.totpEnabledAt || !challenge.user.totpSecretEncrypted) throw new ApiError(401, "Проверка входа истекла. Введите пароль ещё раз");
    const limitKey = authRateLimitKey(request.headers, `totp:${challenge.id}`);
    if (!totpRateLimiter.check(limitKey).allowed) throw new ApiError(429, "Слишком много попыток. Повторите позже");
    if (!(await verifyUserSecondFactor(challenge.userId, challenge.user.totpSecretEncrypted, code))) {
      totpRateLimiter.recordFailure(limitKey);
      await recordTwoFactorChallengeFailure(challenge.id);
      throw new ApiError(401, "Неверный одноразовый или резервный код");
    }
    if (!(await consumeTwoFactorChallenge(challenge.id))) throw new ApiError(401, "Проверка входа уже использована");
    totpRateLimiter.clear(limitKey);
    await createSession(challenge.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
