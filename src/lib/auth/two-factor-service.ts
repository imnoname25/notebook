import QRCode from "qrcode";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { decryptSettingSecret, encryptSettingSecret, settingsEncryptionAvailable } from "@/lib/settings-encryption";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeRecoveryCode, totpProvisioningUri, verifyTotpCode } from "@/lib/auth/totp";

export const TOTP_SETUP_LIFETIME_MS = 10 * 60 * 1000;

function encryptTotpSecret(secret: string) {
  return encryptSettingSecret(`totp-v1:${secret}`);
}

function decryptTotpSecret(ciphertext: string) {
  const value = decryptSettingSecret(ciphertext);
  if (!value.startsWith("totp-v1:")) throw new ApiError(500, "Хранилище двухфакторной аутентификации повреждено");
  return value.slice("totp-v1:".length);
}

async function requireValidPassword(userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true, totpEnabledAt: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new ApiError(401, "Неверный пароль");
  return user;
}

export async function getTwoFactorStatus(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, totpRecoveryCodes: { where: { usedAt: null }, select: { id: true } } },
  });
  if (!user) throw new ApiError(404, "Пользователь не найден");
  return {
    enabled: Boolean(user.totpEnabledAt),
    enabledAt: user.totpEnabledAt,
    recoveryCodesRemaining: user.totpRecoveryCodes.length,
    encryptionAvailable: settingsEncryptionAvailable(),
  };
}

export async function beginTwoFactorSetup(userId: string, email: string, password: string) {
  if (!settingsEncryptionAvailable()) throw new ApiError(409, "Для двухфакторной аутентификации задайте SETTINGS_ENCRYPTION_KEY");
  const user = await requireValidPassword(userId, password);
  if (user.totpEnabledAt) throw new ApiError(409, "Двухфакторная аутентификация уже включена");
  const secret = generateTotpSecret();
  const provisioningUri = totpProvisioningUri(secret, email);
  await db.user.update({
    where: { id: userId },
    data: { totpPendingSecretEncrypted: encryptTotpSecret(secret), totpPendingCreatedAt: new Date() },
  });
  return {
    secret,
    provisioningUri,
    qrCodeDataUrl: await QRCode.toDataURL(provisioningUri, { errorCorrectionLevel: "M", margin: 1, width: 240 }),
  };
}

async function replaceRecoveryCodes(userId: string) {
  const codes = generateRecoveryCodes();
  await db.$transaction([
    db.totpRecoveryCode.deleteMany({ where: { userId } }),
    db.totpRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })) }),
  ]);
  return codes;
}

export async function enableTwoFactor(userId: string, code: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { totpPendingSecretEncrypted: true, totpPendingCreatedAt: true },
  });
  if (!user?.totpPendingSecretEncrypted || !user.totpPendingCreatedAt) throw new ApiError(409, "Сначала начните настройку двухфакторной аутентификации");
  if (Date.now() - user.totpPendingCreatedAt.getTime() > TOTP_SETUP_LIFETIME_MS) {
    await db.user.update({ where: { id: userId }, data: { totpPendingSecretEncrypted: null, totpPendingCreatedAt: null } });
    throw new ApiError(410, "Время настройки истекло. Начните заново");
  }
  const secret = decryptTotpSecret(user.totpPendingSecretEncrypted);
  if (!verifyTotpCode(secret, code)) throw new ApiError(400, "Неверный одноразовый код");
  const recoveryCodes = generateRecoveryCodes();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpSecretEncrypted: user.totpPendingSecretEncrypted,
        totpPendingSecretEncrypted: null,
        totpPendingCreatedAt: null,
      },
    });
    await tx.totpRecoveryCode.deleteMany({ where: { userId } });
    await tx.totpRecoveryCode.createMany({ data: recoveryCodes.map((recoveryCode) => ({ userId, codeHash: hashRecoveryCode(recoveryCode) })) });
  });
  return recoveryCodes;
}

export async function verifyUserSecondFactor(userId: string, encryptedSecret: string, code: string) {
  if (/^\d{6}$/.test(code.trim())) return verifyTotpCode(decryptTotpSecret(encryptedSecret), code);
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 16) return false;
  const consumed = await db.totpRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
    data: { usedAt: new Date() },
  });
  return consumed.count === 1;
}

export async function disableTwoFactor(userId: string, password: string, code: string) {
  await requireValidPassword(userId, password);
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, totpSecretEncrypted: true } });
  if (!user?.totpEnabledAt || !user.totpSecretEncrypted) throw new ApiError(409, "Двухфакторная аутентификация не включена");
  if (!(await verifyUserSecondFactor(userId, user.totpSecretEncrypted, code))) throw new ApiError(401, "Неверный одноразовый или резервный код");
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { totpEnabledAt: null, totpSecretEncrypted: null, totpPendingSecretEncrypted: null, totpPendingCreatedAt: null },
    }),
    db.totpRecoveryCode.deleteMany({ where: { userId } }),
    db.authChallenge.deleteMany({ where: { userId } }),
  ]);
}

export async function regenerateRecoveryCodes(userId: string, password: string, code: string) {
  await requireValidPassword(userId, password);
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, totpSecretEncrypted: true } });
  if (!user?.totpEnabledAt || !user.totpSecretEncrypted) throw new ApiError(409, "Двухфакторная аутентификация не включена");
  if (!(await verifyUserSecondFactor(userId, user.totpSecretEncrypted, code))) throw new ApiError(401, "Неверный одноразовый или резервный код");
  return replaceRecoveryCodes(userId);
}
