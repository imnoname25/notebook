import { describe, expect, it } from "vitest";
import { nextIdleExpiry, SESSION_IDLE_TIMEOUT_MS, SESSION_TOUCH_INTERVAL_MS, sessionIsExpired, shouldTouchSession } from "./session-policy";

describe("session lifecycle policy", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");
  it("detects idle and absolute expiration", () => {
    expect(sessionIsExpired({ expiresAt: now, absoluteExpiresAt: new Date(now.getTime() + 1), lastUsedAt: now }, now)).toBe(true);
    expect(sessionIsExpired({ expiresAt: new Date(now.getTime() + 1), absoluteExpiresAt: now, lastUsedAt: now }, now)).toBe(true);
  });
  it("touches only after the central interval", () => {
    expect(shouldTouchSession({ lastUsedAt: new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS + 1) }, now)).toBe(false);
    expect(shouldTouchSession({ lastUsedAt: new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS) }, now)).toBe(true);
  });
  it("never extends idle expiry past absolute lifetime", () => {
    const absolute = new Date(now.getTime() + 1000);
    expect(nextIdleExpiry(absolute, now)).toEqual(absolute);
    expect(nextIdleExpiry(new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS * 2), now).getTime()).toBe(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
  });
});
