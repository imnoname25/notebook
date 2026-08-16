export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const TOTP_FAILURE_LIMIT = 5;
export const TOTP_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const TOTP_BLOCK_MS = 15 * 60 * 1000;

type Entry = { failures: number[]; blockedUntil?: number };
type RateLimitPolicy = { failureLimit: number; failureWindowMs: number; blockMs: number };
const LOGIN_POLICY: RateLimitPolicy = { failureLimit: LOGIN_FAILURE_LIMIT, failureWindowMs: LOGIN_FAILURE_WINDOW_MS, blockMs: LOGIN_BLOCK_MS };
const TOTP_POLICY: RateLimitPolicy = { failureLimit: TOTP_FAILURE_LIMIT, failureWindowMs: TOTP_FAILURE_WINDOW_MS, blockMs: TOTP_BLOCK_MS };

export interface AuthRateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds?: number };
  recordFailure(key: string): void;
  clear(key: string): void;
}

export class MemoryAuthRateLimiter implements AuthRateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now, private readonly policy: RateLimitPolicy = LOGIN_POLICY) {}

  check(key: string) {
    const timestamp = this.now();
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };
    if (entry.blockedUntil && entry.blockedUntil > timestamp) return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - timestamp) / 1000) };
    entry.failures = entry.failures.filter((failure) => failure > timestamp - this.policy.failureWindowMs);
    entry.blockedUntil = undefined;
    if (!entry.failures.length) this.entries.delete(key);
    return { allowed: true };
  }

  recordFailure(key: string) {
    const timestamp = this.now();
    const entry = this.entries.get(key) ?? { failures: [] };
    entry.failures = entry.failures.filter((failure) => failure > timestamp - this.policy.failureWindowMs);
    entry.failures.push(timestamp);
    if (entry.failures.length >= this.policy.failureLimit) entry.blockedUntil = timestamp + this.policy.blockMs;
    this.entries.set(key, entry);
  }

  clear(key: string) { this.entries.delete(key); }
}

const globalLimiter = globalThis as typeof globalThis & { notebookAuthRateLimiter?: MemoryAuthRateLimiter };
export const authRateLimiter = globalLimiter.notebookAuthRateLimiter ??= new MemoryAuthRateLimiter();
const globalTotpLimiter = globalThis as typeof globalThis & { notebookTotpRateLimiter?: MemoryAuthRateLimiter };
export const totpRateLimiter = globalTotpLimiter.notebookTotpRateLimiter ??= new MemoryAuthRateLimiter(Date.now, TOTP_POLICY);

export function authRateLimitKey(headers: Headers, identifier: string) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "unknown";
  return `${ip}:${identifier.trim().toLowerCase()}`;
}
