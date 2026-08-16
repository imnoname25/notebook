import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) { process.env.DATABASE_URL = databaseUrl; process.env.SETTINGS_ENCRYPTION_KEY = "22".repeat(32); }

describe.skipIf(!enabled)("TOTP two-factor authentication", () => {
  let db: typeof import("@/lib/db").db;
  let service: typeof import("./two-factor-service");
  let totp: typeof import("./totp");
  let userId = "";
  const password = "correct horse battery staple";

  beforeAll(async () => { ({ db } = await import("@/lib/db")); service = await import("./two-factor-service"); totp = await import("./totp"); });
  beforeEach(async () => { const { hashPassword } = await import("./password"); await db.user.deleteMany(); const user = await db.user.create({ data: { email: "totp@test.local", name: "TOTP", passwordHash: await hashPassword(password) } }); userId = user.id; });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it("enables with a valid code and keeps the secret encrypted at rest", async () => {
    const setup = await service.beginTwoFactorSetup(userId, "totp@test.local", password);
    await expect(service.enableTwoFactor(userId, "000000")).rejects.toMatchObject({ status: 400 });
    const codes = await service.enableTwoFactor(userId, totp.generateTotpCode(setup.secret));
    expect(codes).toHaveLength(10);
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.totpSecretEncrypted).toMatch(/^v1:/); expect(stored.totpSecretEncrypted).not.toContain(setup.secret);
  });

  it("consumes a recovery code once and can disable with a fresh TOTP", async () => {
    const setup = await service.beginTwoFactorSetup(userId, "totp@test.local", password);
    const codes = await service.enableTwoFactor(userId, totp.generateTotpCode(setup.secret));
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await service.verifyUserSecondFactor(userId, stored.totpSecretEncrypted!, codes[0]!)).toBe(true);
    expect(await service.verifyUserSecondFactor(userId, stored.totpSecretEncrypted!, codes[0]!)).toBe(false);
    await service.disableTwoFactor(userId, password, totp.generateTotpCode(setup.secret));
    expect((await service.getTwoFactorStatus(userId)).enabled).toBe(false);
  });
});
