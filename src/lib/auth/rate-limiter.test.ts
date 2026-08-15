import { describe, expect, it } from "vitest";
import { LOGIN_BLOCK_MS, LOGIN_FAILURE_LIMIT, MemoryAuthRateLimiter } from "./rate-limiter";

describe("authentication rate limiter", () => {
  it("blocks after the configured failures and resets after success", () => {
    let now = 1_000; const limiter = new MemoryAuthRateLimiter(() => now);
    for (let count = 0; count < LOGIN_FAILURE_LIMIT; count += 1) limiter.recordFailure("ip:user");
    expect(limiter.check("ip:user").allowed).toBe(false);
    limiter.clear("ip:user"); expect(limiter.check("ip:user").allowed).toBe(true);
    for (let count = 0; count < LOGIN_FAILURE_LIMIT; count += 1) limiter.recordFailure("ip:user");
    now += LOGIN_BLOCK_MS + 1; expect(limiter.check("ip:user").allowed).toBe(true);
  });
  it("isolates IP and login combinations", () => {
    const limiter = new MemoryAuthRateLimiter(() => 1_000);
    for (let count = 0; count < LOGIN_FAILURE_LIMIT; count += 1) limiter.recordFailure("one:user");
    expect(limiter.check("two:user").allowed).toBe(true); expect(limiter.check("one:other").allowed).toBe(true);
  });
});
