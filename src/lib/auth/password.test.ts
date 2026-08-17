import { describe, expect, it } from "vitest";
import { hashPassword, KEY_LENGTH, SALT_BYTES, verifyPassword } from "./password";

describe("password authentication", () => {
  it("hashes with a unique salt and verifies only the correct password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(KEY_LENGTH).toBe(64);
    expect(SALT_BYTES).toBe(16);
    await expect(verifyPassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(false);
  });
});
