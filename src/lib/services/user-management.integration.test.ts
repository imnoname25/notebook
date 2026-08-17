import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("user management security", () => {
  let db: typeof import("@/lib/db").db;
  let users: typeof import("./user-management-service");
  let account: typeof import("@/lib/auth/account-service");
  let password: typeof import("@/lib/auth/password");
  let adminId: string;

  beforeAll(async () => { ({ db } = await import("@/lib/db")); users = await import("./user-management-service"); account = await import("@/lib/auth/account-service"); password = await import("@/lib/auth/password"); });
  beforeEach(async () => {
    await db.user.deleteMany();
    const admin = await db.user.create({ data: { name: "Admin", email: "admin@test.local", role: "ADMIN", passwordHash: await password.hashPassword("old-password") } });
    adminId = admin.id;
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it("changes the current password, rejects the old password and revokes sessions without touching notes", async () => {
    const notebook = await db.notebook.create({ data: { userId: adminId, title: "Preserved" } });
    const now = new Date();
    await db.session.create({ data: { userId: adminId, tokenHash: "current", createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 60_000) } });
    await expect(account.changePassword(adminId, "wrong-password", "new-password")).rejects.toMatchObject({ status: 401 });
    await account.changePassword(adminId, "old-password", "new-password");
    const changed = await db.user.findUniqueOrThrow({ where: { id: adminId } });
    await expect(password.verifyPassword("new-password", changed.passwordHash)).resolves.toBe(true);
    await expect(password.verifyPassword("old-password", changed.passwordHash)).resolves.toBe(false);
    expect(await db.session.count({ where: { userId: adminId } })).toBe(0);
    expect(await db.notebook.findUnique({ where: { id: notebook.id } })).not.toBeNull();
  });

  it("creates normalized users, rejects duplicates and resets authentication state", async () => {
    const created = await users.createManagedUser(adminId, { name: "Second", email: "second@test.local", role: "USER", password: "temporary-password", mustChangePassword: true });
    await expect(users.createManagedUser(adminId, { name: "Duplicate", email: "second@test.local", role: "USER", password: "temporary-password", mustChangePassword: true })).rejects.toMatchObject({ status: 409 });
    const now = new Date();
    await db.user.update({ where: { id: created.id }, data: { totpEnabledAt: now, totpSecretEncrypted: "encrypted", totpPendingSecretEncrypted: "pending", totpPendingCreatedAt: now } });
    await db.session.create({ data: { userId: created.id, tokenHash: "second", createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 60_000) } });
    await db.authChallenge.create({ data: { userId: created.id, tokenHash: "challenge", expiresAt: new Date(now.getTime() + 60_000) } });
    await users.resetManagedUserTwoFactor(adminId, created.id);
    const reset = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(reset).toMatchObject({ totpEnabledAt: null, totpSecretEncrypted: null, totpPendingSecretEncrypted: null });
    expect(await db.session.count({ where: { userId: created.id } })).toBe(0);
    expect(await db.authChallenge.count({ where: { userId: created.id } })).toBe(0);
    await db.session.create({ data: { userId: created.id, tokenHash: "second-after-2fa", createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 60_000) } });
    await users.resetManagedUserPassword(adminId, created.id, "replacement-password", true);
    const passwordReset = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    await expect(password.verifyPassword("replacement-password", passwordReset.passwordHash)).resolves.toBe(true);
    expect(passwordReset.mustChangePassword).toBe(true);
    expect(await db.session.count({ where: { userId: created.id } })).toBe(0);
  });

  it("blocks login state and protects the last administrator", async () => {
    await expect(users.setUserDisabled(adminId, adminId, true)).rejects.toMatchObject({ status: 409 });
    await expect(users.updateManagedUser(adminId, adminId, { name: "Admin", email: "admin@test.local", role: "USER" })).rejects.toMatchObject({ status: 409 });
    const second = await users.createManagedUser(adminId, { name: "Second", email: "second@test.local", role: "USER", password: "temporary-password", mustChangePassword: false });
    await users.setUserDisabled(adminId, second.id, true);
    expect((await db.user.findUniqueOrThrow({ where: { id: second.id } })).disabledAt).not.toBeNull();
    await users.setUserDisabled(adminId, second.id, false);
    expect((await db.user.findUniqueOrThrow({ where: { id: second.id } })).disabledAt).toBeNull();
  });
});
