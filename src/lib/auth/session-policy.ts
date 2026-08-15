export const SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionTimes = { expiresAt: Date; absoluteExpiresAt: Date; lastUsedAt: Date };

export function sessionIsExpired(session: SessionTimes, now = new Date()) {
  return session.expiresAt <= now || session.absoluteExpiresAt <= now;
}

export function shouldTouchSession(session: Pick<SessionTimes, "lastUsedAt">, now = new Date()) {
  return now.getTime() - session.lastUsedAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

export function nextIdleExpiry(absoluteExpiresAt: Date, now = new Date()) {
  return new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + SESSION_IDLE_TIMEOUT_MS));
}
