import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(value: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Некорректный Base32 secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function generateTotpCode(secret: string, options: { timestamp?: number; digits?: number; periodSeconds?: number } = {}) {
  const timestamp = options.timestamp ?? Date.now();
  const digits = options.digits ?? TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const counter = Math.floor(timestamp / 1000 / periodSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

export function verifyTotpCode(secret: string, code: string, now = Date.now(), window = TOTP_WINDOW) {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const received = Buffer.from(normalized);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(generateTotpCode(secret, { timestamp: now + offset * TOTP_PERIOD_SECONDS * 1000 }));
    if (expected.length === received.length && timingSafeEqual(expected, received)) return true;
  }
  return false;
}

export function totpProvisioningUri(secret: string, account: string) {
  const label = encodeURIComponent(`Notebook:${account}`);
  const issuer = encodeURIComponent("Notebook");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(`notebook-recovery-v1:${normalizeRecoveryCode(code)}`).digest("hex");
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const value = encodeBase32(randomBytes(10));
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
  });
}
