import { describe, expect, it } from "vitest";
import { decodeBase32, encodeBase32, generateRecoveryCodes, generateTotpCode, hashRecoveryCode, verifyTotpCode } from "@/lib/auth/totp";

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 vector", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890"));
    expect(generateTotpCode(secret, { timestamp: 59_000, digits: 8 })).toBe("94287082");
  });

  it("accepts only the small configured clock window", () => {
    const secret = encodeBase32(Buffer.from("notebook-test-secret"));
    const now = 1_700_000_000_000;
    expect(verifyTotpCode(secret, generateTotpCode(secret, { timestamp: now }), now)).toBe(true);
    expect(verifyTotpCode(secret, generateTotpCode(secret, { timestamp: now - 60_000 }), now)).toBe(false);
    expect(decodeBase32(secret).toString()).toBe("notebook-test-secret");
  });

  it("generates unique high-entropy recovery codes and stable hashes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toLowerCase().replaceAll("-", " ")));
    expect(codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code))).toBe(true);
  });
});
