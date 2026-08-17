import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, validateRequestOrigin } from "@/lib/api";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { setupSchema } from "@/lib/validation";
import { authRateLimiter, authRateLimitKey } from "@/lib/auth/rate-limiter";

export async function POST(request: NextRequest) {
  const limiterRequest = request.clone();
  try {
    validateRequestOrigin(request);
    const input = setupSchema.parse(await readJson(request));
    const limitKey = authRateLimitKey(request.headers, input.email);
    if (!authRateLimiter.check(limitKey).allowed) throw new ApiError(429, "Слишком много попыток. Повторите позже");
    const user = await db.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new ApiError(409, "Первый пользователь уже создан");
      return tx.user.create({ data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password), role: "ADMIN" }, select: { id: true } });
    }, { isolationLevel: "Serializable" });
    await createSession(user.id);
    authRateLimiter.clear(limitKey);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError && error.status !== 409 && error.status !== 429) {
      try { const body = setupSchema.safeParse(await limiterRequest.json()); if (body.success) authRateLimiter.recordFailure(authRateLimitKey(request.headers, body.data.email)); } catch { /* malformed requests are handled by validation */ }
    }
    return apiError(error);
  }
}
