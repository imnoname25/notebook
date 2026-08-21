import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { normalizeS3Prefix, normalizeWebdavDirectory, SETTINGS_ID, type SettingsUpdate } from "@/lib/application-settings";
import { encryptSettingSecret, settingsEncryptionAvailable } from "@/lib/settings-encryption";
import { parseAllowedCidrs } from "@/lib/live-widget-network-policy";

export async function getApplicationSettings() {
  return db.applicationSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} });
}

export function publicSettings(settings: Awaited<ReturnType<typeof getApplicationSettings>>) {
  const { webdavPasswordEncrypted: _webdavSecret, s3SecretAccessKeyEncrypted: _s3Secret, ...safe } = settings;
  return { ...safe, webdavPasswordConfigured: Boolean(_webdavSecret), s3SecretAccessKeyConfigured: Boolean(_s3Secret), settingsEncryptionAvailable: settingsEncryptionAvailable() };
}

export async function updateApplicationSettings(input: SettingsUpdate) {
  if (input.liveWidgetAllowedCidrs !== undefined) {
    try { parseAllowedCidrs(input.liveWidgetAllowedCidrs); }
    catch { throw new ApiError(400, "Некорректный список разрешённых CIDR"); }
  }
  if (input.webdavEnabled && !input.webdavUrl) {
    const current = await getApplicationSettings(); if (!current.webdavUrl) throw new ApiError(400, "Укажите WebDAV URL");
  }
  if (input.webdavPassword !== undefined && input.webdavPassword !== null && !settingsEncryptionAvailable()) throw new ApiError(409, "Для WebDAV password задайте SETTINGS_ENCRYPTION_KEY");
  if (input.s3Enabled && (!input.s3Bucket || !input.s3AccessKeyId)) { const current = await getApplicationSettings(); if (!(input.s3Bucket ?? current.s3Bucket) || !(input.s3AccessKeyId ?? current.s3AccessKeyId)) throw new ApiError(400, "Для S3 укажите bucket и access key"); }
  if (input.s3SecretAccessKey !== undefined && input.s3SecretAccessKey !== null && !settingsEncryptionAvailable()) throw new ApiError(409, "Для S3 secret key задайте SETTINGS_ENCRYPTION_KEY");
  if (input.webdavRemoteDirectory) { try { normalizeWebdavDirectory(input.webdavRemoteDirectory); } catch { throw new ApiError(400, "Некорректный WebDAV каталог"); } }
  if (input.s3Prefix !== undefined) { try { normalizeS3Prefix(input.s3Prefix); } catch { throw new ApiError(400, "Некорректный S3 prefix"); } }
  const { webdavPassword, s3SecretAccessKey, ...values } = input;
  return db.applicationSettings.upsert({
    where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...values, ...(webdavPassword ? { webdavPasswordEncrypted: encryptSettingSecret(webdavPassword) } : {}), ...(s3SecretAccessKey ? { s3SecretAccessKeyEncrypted: encryptSettingSecret(s3SecretAccessKey) } : {}) },
    update: { ...values, ...(webdavPassword === undefined ? {} : { webdavPasswordEncrypted: webdavPassword ? encryptSettingSecret(webdavPassword) : null }), ...(s3SecretAccessKey === undefined ? {} : { s3SecretAccessKeyEncrypted: s3SecretAccessKey ? encryptSettingSecret(s3SecretAccessKey) : null }) },
  });
}
