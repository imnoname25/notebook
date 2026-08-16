import { describe, expect, it } from "vitest";
import { recoverAdministrator } from "../../../scripts/admin-recovery-service.mjs";
import { hashPassword, verifyPassword } from "./password";

type State = {
  user: { id: string; passwordHash: string; totpEnabledAt: Date | null; totpSecretEncrypted: string | null; totpPendingSecretEncrypted: string | null; totpPendingCreatedAt: Date | null };
  sessions: { userId: string }[]; challenges: { userId: string }[]; recoveryCodes: { userId: string }[];
  notebooks: { id: string; title: string }[]; pages: { id: string; title: string; content: unknown[] }[];
};

function fakeDatabase(state: State) {
  const matches = (items: { userId: string }[], userId: string) => items.filter((item) => item.userId !== userId);
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === state.user.id ? { id: state.user.id } : null,
      update: async ({ data }: { data: Partial<State["user"]> }) => { Object.assign(state.user, data); return state.user; },
    },
    session: { deleteMany: async ({ where }: { where: { userId: string } }) => { const count = state.sessions.length; state.sessions = matches(state.sessions, where.userId); return { count: count - state.sessions.length }; } },
    authChallenge: { deleteMany: async ({ where }: { where: { userId: string } }) => { const count = state.challenges.length; state.challenges = matches(state.challenges, where.userId); return { count: count - state.challenges.length }; } },
    totpRecoveryCode: { deleteMany: async ({ where }: { where: { userId: string } }) => { const count = state.recoveryCodes.length; state.recoveryCodes = matches(state.recoveryCodes, where.userId); return { count: count - state.recoveryCodes.length }; } },
  };
  return { ...tx, $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx) };
}

async function fixture(): Promise<State> {
  return {
    user: { id: "admin", passwordHash: await hashPassword("old-password"), totpEnabledAt: new Date(), totpSecretEncrypted: "encrypted-secret", totpPendingSecretEncrypted: "pending", totpPendingCreatedAt: new Date() },
    sessions: [{ userId: "admin" }, { userId: "admin" }], challenges: [{ userId: "admin" }], recoveryCodes: [{ userId: "admin" }],
    notebooks: [{ id: "notebook", title: "Работа" }], pages: [{ id: "page", title: "Заметка", content: [{ type: "paragraph" }] }],
  };
}

describe("administrator recovery", () => {
  it("replaces the password with the canonical hash and revokes sessions", async () => {
    const state = await fixture(); const dataBefore = JSON.stringify({ notebooks: state.notebooks, pages: state.pages });
    await recoverAdministrator(fakeDatabase(state), state.user.id, { resetPassword: true, disableTotp: false, newPassword: "new-secure-password" });
    await expect(verifyPassword("new-secure-password", state.user.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("old-password", state.user.passwordHash)).resolves.toBe(false);
    expect(state.sessions).toHaveLength(0); expect(state.challenges).toHaveLength(0);
    expect(state.user.totpSecretEncrypted).toBe("encrypted-secret");
    expect(JSON.stringify({ notebooks: state.notebooks, pages: state.pages })).toBe(dataBefore);
  });

  it("fully disables TOTP and invalidates challenges and recovery codes", async () => {
    const state = await fixture(); const passwordHash = state.user.passwordHash; const dataBefore = JSON.stringify({ notebooks: state.notebooks, pages: state.pages });
    await recoverAdministrator(fakeDatabase(state), state.user.id, { resetPassword: false, disableTotp: true });
    expect(state.user).toMatchObject({ passwordHash, totpEnabledAt: null, totpSecretEncrypted: null, totpPendingSecretEncrypted: null, totpPendingCreatedAt: null });
    expect(state.sessions).toHaveLength(0); expect(state.challenges).toHaveLength(0); expect(state.recoveryCodes).toHaveLength(0);
    expect(JSON.stringify({ notebooks: state.notebooks, pages: state.pages })).toBe(dataBefore);
  });
});
