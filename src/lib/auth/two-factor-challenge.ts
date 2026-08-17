import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const TWO_FACTOR_CHALLENGE_COOKIE = "notebook_2fa_challenge";
export const TWO_FACTOR_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
export const TWO_FACTOR_CHALLENGE_MAX_ATTEMPTS = 5;

function hashChallengeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function challengeCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false,
    path: "/",
    expires,
    priority: "high" as const,
  };
}

export async function issueTwoFactorChallenge(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_LIFETIME_MS);
  await db.$transaction([
    db.authChallenge.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lte: new Date() } }] } }),
    db.authChallenge.create({ data: { userId, tokenHash: hashChallengeToken(token), expiresAt } }),
  ]);
  (await cookies()).set(TWO_FACTOR_CHALLENGE_COOKIE, token, challengeCookieOptions(expiresAt));
}

export async function getTwoFactorChallenge() {
  const token = (await cookies()).get(TWO_FACTOR_CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  const challenge = await db.authChallenge.findUnique({
    where: { tokenHash: hashChallengeToken(token) },
    include: { user: { select: { id: true, email: true, totpEnabledAt: true, totpSecretEncrypted: true, disabledAt: true, mustChangePassword: true } } },
  });
  if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= TWO_FACTOR_CHALLENGE_MAX_ATTEMPTS) {
    if (challenge) await db.authChallenge.deleteMany({ where: { id: challenge.id } });
    (await cookies()).delete(TWO_FACTOR_CHALLENGE_COOKIE);
    return null;
  }
  return challenge;
}

export async function recordTwoFactorChallengeFailure(id: string) {
  const challenge = await db.authChallenge.update({ where: { id }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
  if (challenge.attempts >= TWO_FACTOR_CHALLENGE_MAX_ATTEMPTS) {
    await db.authChallenge.deleteMany({ where: { id } });
    (await cookies()).delete(TWO_FACTOR_CHALLENGE_COOKIE);
  }
}

export async function consumeTwoFactorChallenge(id: string) {
  const result = await db.authChallenge.deleteMany({ where: { id } });
  (await cookies()).delete(TWO_FACTOR_CHALLENGE_COOKIE);
  return result.count === 1;
}
