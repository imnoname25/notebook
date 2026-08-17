import { hashPassword } from "../shared/auth-password.mjs";

export async function recoverAdministrator(db, userId, options) {
  if (!options.resetPassword && !options.disableTotp) throw new Error("Не выбрано действие восстановления");
  if (options.resetPassword && (typeof options.newPassword !== "string" || options.newPassword.length < 8 || options.newPassword.length > 128)) throw new Error("Пароль должен содержать от 8 до 128 символов");

  const passwordHash = options.resetPassword ? await hashPassword(options.newPassword) : undefined;
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new Error("Пользователь не найден");
    await tx.user.update({
      where: { id: userId },
      data: {
        ...(passwordHash ? { passwordHash, mustChangePassword: false } : {}),
        ...(options.disableTotp ? { totpEnabledAt: null, totpSecretEncrypted: null, totpPendingSecretEncrypted: null, totpPendingCreatedAt: null } : {}),
      },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.authChallenge.deleteMany({ where: { userId } });
    if (options.disableTotp) await tx.totpRecoveryCode.deleteMany({ where: { userId } });
    return { passwordReset: options.resetPassword, totpDisabled: options.disableTotp };
  });
}
