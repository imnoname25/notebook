export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;

type Entry = { failures: number[]; blockedUntil?: number };

export interface AuthRateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds?: number };
  recordFailure(key: string): void;
  clear(key: string): void;
}

export class MemoryAuthRateLimiter implements AuthRateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  check(key: string) {
    const timestamp = this.now();
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };
    if (entry.blockedUntil && entry.blockedUntil > timestamp) return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - timestamp) / 1000) };
    entry.failures = entry.failures.filter((failure) => failure > timestamp - LOGIN_FAILURE_WINDOW_MS);
    entry.blockedUntil = undefined;
    if (!entry.failures.length) this.entries.delete(key);
    return { allowed: true };
  }

  recordFailure(key: string) {
    const timestamp = this.now();
    const entry = this.entries.get(key) ?? { failures: [] };
    entry.failures = entry.failures.filter((failure) => failure > timestamp - LOGIN_FAILURE_WINDOW_MS);
    entry.failures.push(timestamp);
    if (entry.failures.length >= LOGIN_FAILURE_LIMIT) entry.blockedUntil = timestamp + LOGIN_BLOCK_MS;
    this.entries.set(key, entry);
  }

  clear(key: string) { this.entries.delete(key); }
}

const globalLimiter = globalThis as typeof globalThis & { notebookAuthRateLimiter?: MemoryAuthRateLimiter };
export const authRateLimiter = globalLimiter.notebookAuthRateLimiter ??= new MemoryAuthRateLimiter();

export function authRateLimitKey(headers: Headers, identifier: string) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "unknown";
  return `${ip}:${identifier.trim().toLowerCase()}`;
}
