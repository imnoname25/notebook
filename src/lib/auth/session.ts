import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { nextIdleExpiry, SESSION_ABSOLUTE_LIFETIME_MS, sessionIsExpired, shouldTouchSession } from "@/lib/auth/session-policy";

export const SESSION_COOKIE = "notebook_session";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  await cleanupExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
  const expiresAt = nextIdleExpiry(absoluteExpiresAt, now);
  await db.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt, absoluteExpiresAt, lastUsedAt: now } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false,
    path: "/",
    expires: absoluteExpiresAt,
    priority: "high",
  });
}

export async function cleanupExpiredSessions(now = new Date()) {
  return db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] } });
}

export async function deleteCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  store.delete(SESSION_COOKIE);
}

export async function deleteAllUserSessions(userId: string) {
  await revokeAllUserSessions(userId);
  (await cookies()).delete(SESSION_COOKIE);
}

export async function revokeAllUserSessions(userId: string) {
  return db.session.deleteMany({ where: { userId } });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, disabledAt: true, mustChangePassword: true } } },
  });
  const now = new Date();
  if (!session || sessionIsExpired(session, now) || session.user.disabledAt) {
    if (session) await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (shouldTouchSession(session, now)) {
    await db.session.updateMany({
      where: { id: session.id, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      data: { lastUsedAt: now, expiresAt: nextIdleExpiry(session.absoluteExpiresAt, now) },
    });
  }
  return session.user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
