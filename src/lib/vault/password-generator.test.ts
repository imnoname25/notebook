import { describe, expect, it } from "vitest";
import { estimatePasswordStrength, generatePassword } from "./password-generator";

describe("vault password utilities", () => {
  it("generates locally and includes every selected character class", () => {
    const password = generatePassword({ length: 32, uppercase: true, lowercase: true, digits: true, symbols: true });
    expect(password).toHaveLength(32); expect(password).toMatch(/[A-Z]/); expect(password).toMatch(/[a-z]/); expect(password).toMatch(/\d/); expect(password).toMatch(/[^A-Za-z0-9]/);
  });
  it("rates a long mixed password higher than a short password", () => expect(estimatePasswordStrength("aB3!".repeat(6))).toBeGreaterThan(estimatePasswordStrength("password")));
});
