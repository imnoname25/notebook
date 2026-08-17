import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type AuthStateClient = Pick<Prisma.TransactionClient, "session" | "authChallenge">;

export async function revokeUserAuthState(userId: string, client: AuthStateClient = db) {
  await Promise.all([
    client.session.deleteMany({ where: { userId } }),
    client.authChallenge.deleteMany({ where: { userId } }),
  ]);
}

export async function resetUserTwoFactor(userId: string) {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return;
    await tx.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: null,
        totpSecretEncrypted: null,
        totpPendingSecretEncrypted: null,
        totpPendingCreatedAt: null,
      },
    });
    await Promise.all([
      tx.totpRecoveryCode.deleteMany({ where: { userId } }),
      tx.session.deleteMany({ where: { userId } }),
      tx.authChallenge.deleteMany({ where: { userId } }),
    ]);
  });
}
