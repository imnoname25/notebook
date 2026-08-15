import { afterEach, describe, expect, it } from "vitest";
import { decryptSettingSecret, encryptSettingSecret, settingsEncryptionAvailable } from "./settings-encryption";

const original = process.env.SETTINGS_ENCRYPTION_KEY;
afterEach(() => { if (original === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY; else process.env.SETTINGS_ENCRYPTION_KEY = original; });
describe("encrypted settings", () => {
  it("uses AES-GCM with a random nonce", () => { process.env.SETTINGS_ENCRYPTION_KEY = "11".repeat(32); const left = encryptSettingSecret("secret"); const right = encryptSettingSecret("secret"); expect(left).not.toBe(right); expect(decryptSettingSecret(left)).toBe("secret"); expect(settingsEncryptionAvailable()).toBe(true); });
  it("rejects a wrong key and corrupted ciphertext", () => { process.env.SETTINGS_ENCRYPTION_KEY = "22".repeat(32); const encrypted = encryptSettingSecret("secret"); process.env.SETTINGS_ENCRYPTION_KEY = "33".repeat(32); expect(() => decryptSettingSecret(encrypted)).toThrow(); expect(() => decryptSettingSecret(`${encrypted}corrupt`)).toThrow(); });
  it("does not silently generate a key", () => { delete process.env.SETTINGS_ENCRYPTION_KEY; expect(settingsEncryptionAvailable()).toBe(false); expect(() => encryptSettingSecret("secret")).toThrow(); });
});

