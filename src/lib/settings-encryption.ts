import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/errors";

function encryptionKey() {
  const source = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!source) return null;
  const value = /^[a-f0-9]{64}$/i.test(source) ? Buffer.from(source, "hex") : Buffer.from(source, "base64");
  if (value.byteLength !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY должен содержать ровно 32 байта в hex или base64");
  return value;
}

export function settingsEncryptionAvailable() { return Boolean(encryptionKey()); }

export function encryptSettingSecret(secret: string) {
  const key = encryptionKey(); if (!key) throw new ApiError(409, "SETTINGS_ENCRYPTION_KEY не настроен");
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce); const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
  return `v1:${nonce.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSettingSecret(value: string) {
  const key = encryptionKey(); if (!key) throw new ApiError(409, "SETTINGS_ENCRYPTION_KEY не настроен");
  const [version, nonceValue, tagValue, ciphertextValue] = value.split(":"); if (version !== "v1" || !nonceValue || !tagValue || ciphertextValue === undefined) throw new ApiError(500, "Зашифрованная настройка повреждена");
  try { const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceValue, "base64url")); decipher.setAuthTag(Buffer.from(tagValue, "base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8"); }
  catch { throw new ApiError(500, "Не удалось расшифровать настройку"); }
}

