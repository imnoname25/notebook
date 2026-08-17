import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { resetUserTwoFactor, revokeUserAuthState } from "@/lib/auth/security-service";

export type ManagedUserInput = { name: string; email: string; role: "ADMIN" | "USER" };

function audit(event: string, actorUserId: string, targetUserId: string) {
  console.info("[security-event]", { event, actorUserId, targetUserId });
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function listUsers() {
  const now = new Date();
  return db.user.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, disabledAt: true,
      mustChangePassword: true, totpEnabledAt: true, createdAt: true,
      _count: { select: { sessions: { where: { expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } } } },
    },
  });
}

export async function createManagedUser(actorUserId: string, input: ManagedUserInput & { password: string; mustChangePassword: boolean }) {
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ApiError(409, "Пользователь с таким email уже существует");
  const passwordHash = await hashPassword(input.password);
  let user: { id: string; name: string; email: string; role: "ADMIN" | "USER" };
  try {
    user = await db.user.create({
      data: { name: input.name, email: input.email, role: input.role, passwordHash, mustChangePassword: input.mustChangePassword },
      select: { id: true, name: true, email: true, role: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError(409, "Пользователь с таким email уже существует");
    throw error;
  }
  audit("user.created", actorUserId, user.id);
  return user;
}

export async function updateManagedUser(actorUserId: string, targetUserId: string, input: ManagedUserInput) {
  const duplicate = await db.user.findFirst({ where: { email: input.email, id: { not: targetUserId } }, select: { id: true } });
  if (duplicate) throw new ApiError(409, "Пользователь с таким email уже существует");
  let result: { user: { id: string; name: string; email: string; role: "ADMIN" | "USER" }; emailChanged: boolean; roleChanged: boolean };
  try { result = await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, email: true, role: true, disabledAt: true } });
    if (!target) throw new ApiError(404, "Пользователь не найден");
    if (actorUserId === targetUserId && target.role === "ADMIN" && input.role !== "ADMIN") throw new ApiError(409, "Нельзя изменить собственную роль администратора");
    if (target.role === "ADMIN" && input.role !== "ADMIN") {
      const activeAdmins = await tx.user.count({ where: { role: "ADMIN", disabledAt: null } });
      if (!target.disabledAt && activeAdmins <= 1) throw new ApiError(409, "Нельзя понизить роль последнего администратора");
    }
    const emailChanged = target.email !== input.email;
    const user = await tx.user.update({ where: { id: targetUserId }, data: input, select: { id: true, name: true, email: true, role: true } });
    if (emailChanged) await revokeUserAuthState(targetUserId, tx);
    return { user, emailChanged, roleChanged: target.role !== input.role };
  }, { isolationLevel: "Serializable" }); } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError(409, "Пользователь с таким email уже существует");
    throw error;
  }
  if (result.emailChanged) audit("user.email_changed", actorUserId, targetUserId);
  if (result.roleChanged) audit("user.role_changed", actorUserId, targetUserId);
  return result;
}

export async function setUserDisabled(actorUserId: string, targetUserId: string, disabled: boolean) {
  if (disabled && actorUserId === targetUserId) throw new ApiError(409, "Нельзя заблокировать собственную учётную запись");
  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { role: true, disabledAt: true } });
    if (!target) throw new ApiError(404, "Пользователь не найден");
    if (disabled && target.role === "ADMIN" && !target.disabledAt) {
      const activeAdmins = await tx.user.count({ where: { role: "ADMIN", disabledAt: null } });
      if (activeAdmins <= 1) throw new ApiError(409, "Нельзя заблокировать последнего администратора");
    }
    await tx.user.update({ where: { id: targetUserId }, data: { disabledAt: disabled ? new Date() : null } });
    if (disabled) await revokeUserAuthState(targetUserId, tx);
  }, { isolationLevel: "Serializable" });
  audit(disabled ? "user.disabled" : "user.enabled", actorUserId, targetUserId);
}

export async function resetManagedUserPassword(actorUserId: string, targetUserId: string, password: string, mustChangePassword: boolean) {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) throw new ApiError(404, "Пользователь не найден");
    await tx.user.update({ where: { id: targetUserId }, data: { passwordHash, mustChangePassword } });
    await revokeUserAuthState(targetUserId, tx);
  });
  audit("user.password_reset", actorUserId, targetUserId);
}

export async function revokeManagedUserSessions(actorUserId: string, targetUserId: string) {
  if (!(await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } }))) throw new ApiError(404, "Пользователь не найден");
  await revokeUserAuthState(targetUserId);
  audit("user.sessions_revoked", actorUserId, targetUserId);
}

export async function resetManagedUserTwoFactor(actorUserId: string, targetUserId: string) {
  if (!(await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } }))) throw new ApiError(404, "Пользователь не найден");
  await resetUserTwoFactor(targetUserId);
  audit("user.two_factor_reset", actorUserId, targetUserId);
}
