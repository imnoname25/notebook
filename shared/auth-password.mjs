import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const KEY_LENGTH = 64;
export const SALT_BYTES = 16;

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/**
 * @param {string} password
 * @param {string} encoded
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex, extra] = encoded.split(":");
  if (algorithm !== "scrypt" || extra !== undefined || !/^[a-f0-9]{32}$/i.test(salt ?? "") || !/^[a-f0-9]{128}$/i.test(expectedHex ?? "")) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
