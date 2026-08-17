import { ApiError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { revokeUserAuthState } from "@/lib/auth/security-service";

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw new ApiError(401, "Неверный текущий пароль");
  if (await verifyPassword(newPassword, user.passwordHash)) throw new ApiError(409, "Новый пароль должен отличаться от текущего");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
    await revokeUserAuthState(userId, tx);
  });
}

export async function updateOwnProfile(userId: string, input: { name: string; email: string }) {
  const existing = await db.user.findFirst({ where: { email: input.email, id: { not: userId } }, select: { id: true } });
  if (existing) throw new ApiError(409, "Пользователь с таким email уже существует");
  try { return await db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!current) throw new ApiError(404, "Пользователь не найден");
    const emailChanged = current.email !== input.email;
    const user = await tx.user.update({ where: { id: userId }, data: input, select: { id: true, name: true, email: true, role: true } });
    if (emailChanged) await revokeUserAuthState(userId, tx);
    return { user, sessionRevoked: emailChanged };
  }); } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ApiError(409, "Пользователь с таким email уже существует");
    throw error;
  }
}
